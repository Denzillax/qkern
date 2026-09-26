import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PasswordHasher } from "@/lib/server/auth/password";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import { MemoryProjectAuthAuditSink } from "@/lib/server/project-auth/audit";
import { ProjectAuthSecretProtector, ProjectAuthTotp } from "@/lib/server/project-auth/mfa";
import { ProjectAuthOidcCatalog, ProjectAuthOidcClient } from "@/lib/server/project-auth/oidc";
import {
  DEFAULT_PROJECT_AUTH_RATE_LIMITS,
  parseProjectAuthRateLimits,
  projectAuthRateAllowed,
  projectAuthRateRetryAfterSeconds,
  projectAuthRateSubjectHash,
  projectAuthRateWindowStart,
  PROJECT_AUTH_RATE_LIMIT_BOUNDS,
  PROJECT_AUTH_RATE_LIMIT_KINDS,
} from "@/lib/server/project-auth/rate-limits";
import { MemoryProjectAuthRepository } from "@/lib/server/project-auth/repository";
import {
  NoopDevelopmentProjectAuthDelivery,
  ProjectAuthRateLimitError,
  ProjectAuthService,
} from "@/lib/server/project-auth/service";
import { ProjectAuthTokenService } from "@/lib/server/project-auth/tokens";

/**
 * Die Grenzen je Zeitfenster (2.56).
 *
 * Drei Ebenen, bewusst getrennt:
 *
 * 1. Die **reine Entscheidung** — sie hat keine Datenbank, keinen Zufall und
 *    keine Uhr ausser der, die man ihr gibt, also wird jeder Rand einzeln
 *    geprueft: einer unter der Grenze, genau auf der Grenze, einer darueber.
 * 2. Der **Dienst**, der sie anwendet, samt Fensterwechsel, Audit-Eintrag und
 *    der Frage, was die Antwort ueber eine Identitaet verraet.
 * 3. **Zwei Instanzen an einem Speicher**: zwei `ProjectAuthService` mit
 *    demselben Repository. Das ist die Form der Aussage; ihre PostgreSQL-
 *    Seite belegt der Fall
 *    "(2.56) refuses the login attempt that crosses the limit and lets the
 *    next window through" in postgres.integration.
 */
class FastHasher implements PasswordHasher {
  readonly dummyHash = "fast:dummy";
  async hash(password: string) { return `fast:${createHash("sha256").update(password).digest("hex")}`; }
  async verify(password: string, hash: string) { return hash === await this.hash(password); }
}

const scope = { organizationId: "org-1", projectId: "project-1", environment: "development" as const };
const PASSWORD = "a sufficiently long password";

type Clock = { value: Date };

function serviceOn(
  repository: MemoryProjectAuthRepository,
  clock: Clock,
  audit: MemoryProjectAuthAuditSink,
  label: string,
) {
  const { privateKey } = generateKeyPairSync("ed25519");
  let id = 0;
  let token = 0;
  return new ProjectAuthService({
    repository, audit, passwords: new FastHasher(),
    // Jede Instanz bekommt ihren eigenen Prozesszaehler — genau wie im
    // Betrieb. Er darf die Aussage dieses Tests nicht tragen, und darum
    // bekommt jeder Aufruf unten einen eigenen `rateLimitKey`.
    rateLimiter: new InMemoryRateLimiter(),
    tokens: new ProjectAuthTokenService({ kid: `rate-${label}`, privateKey }, "https://qkern.test"),
    mfa: new ProjectAuthTotp(), secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 9)),
    delivery: new NoopDevelopmentProjectAuthDelivery(), oidcCatalog: new ProjectAuthOidcCatalog([]),
    oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
    callbackBaseUrl: "https://qkern.test", allowedRedirectOrigins: new Set(["https://app.test"]),
    exposeDeliveryTokens: true, now: () => new Date(clock.value),
    id: () => `00000000-0000-4000-8000-${label}${String(++id).padStart(11, "0")}`,
    opaqueToken: (prefix) => `qk_${prefix}_${label}${String(++token).padStart(42, "z")}`,
  });
}

function fixture() {
  const repository = new MemoryProjectAuthRepository();
  const audit = new MemoryProjectAuthAuditSink();
  const clock: Clock = { value: new Date("2026-09-26T12:00:00.000Z") };
  return {
    repository, audit, clock,
    // Zwei Instanzen, ein Speicher. Genau die Lage, die der Zaehler im
    // Prozessspeicher vor 2.56 nicht abbilden konnte.
    first: serviceOn(repository, clock, audit, "a"),
    second: serviceOn(repository, clock, audit, "b"),
    setNow: (value: string) => { clock.value = new Date(value); },
  };
}

/** Registriert und bestaetigt die Adresse, damit eine Anmeldung gelingen kann. */
async function verifiedAccount(built: ReturnType<typeof fixture>, email: string) {
  const signup = await built.first.signUp(scope, {
    email, password: PASSWORD, redirectTo: "https://app.test/callback", rateLimitKey: `signup-${email}`,
  });
  const session = await built.first.consumeEmailToken(scope, {
    token: signup.debugToken!, purpose: "email_verification",
  });
  if ("mfaRequired" in session) throw new Error("unexpected MFA");
  return session;
}

/** Die drei Grenzen dieser Umgebung setzen, mit einem Wert fuer alle. */
function limitsOf(max: number, windowSeconds: number) {
  return {
    sign_in: { max, windowSeconds },
    mail: { max, windowSeconds },
    refresh: { max, windowSeconds },
  };
}

describe("project auth rate limits", () => {
  it("lets one below and exactly the limit through and refuses the one above", () => {
    // Der Rand, um den es geht. `count` ist der Stand NACH dem Hochzaehlen:
    // Bei max 3 sind 1, 2 und 3 erlaubt, 4 nicht.
    expect(projectAuthRateAllowed({ count: 2, max: 3 })).toBe(true);
    expect(projectAuthRateAllowed({ count: 3, max: 3 })).toBe(true);
    expect(projectAuthRateAllowed({ count: 4, max: 3 })).toBe(false);
    // Und an der kleinstmoeglichen Grenze genauso.
    expect(projectAuthRateAllowed({ count: 1, max: 1 })).toBe(true);
    expect(projectAuthRateAllowed({ count: 2, max: 1 })).toBe(false);
  });

  it("puts a window start on a multiple of its length, whatever the clock says", () => {
    const window = 900;
    const start = projectAuthRateWindowStart(new Date("2026-09-26T12:07:31.412Z"), window);
    expect(start.toISOString()).toBe("2026-09-26T12:00:00.000Z");
    // Der letzte Augenblick des Fensters gehoert noch dazu, der erste des
    // naechsten nicht mehr.
    expect(projectAuthRateWindowStart(new Date("2026-09-26T12:14:59.999Z"), window).toISOString())
      .toBe("2026-09-26T12:00:00.000Z");
    expect(projectAuthRateWindowStart(new Date("2026-09-26T12:15:00.000Z"), window).toISOString())
      .toBe("2026-09-26T12:15:00.000Z");
    // Zwei Instanzen, zwei leicht verschiedene Uhren, ein Fensteranfang.
    // Das ist der Grund, warum sie dieselbe Zeile treffen.
    const a = projectAuthRateWindowStart(new Date("2026-09-26T12:03:00.000Z"), window);
    const b = projectAuthRateWindowStart(new Date("2026-09-26T12:12:44.000Z"), window);
    expect(a.getTime()).toBe(b.getTime());
  });

  it("never asks the caller to retry in zero seconds", () => {
    const windowStart = new Date("2026-09-26T12:00:00.000Z");
    expect(projectAuthRateRetryAfterSeconds({ windowStart, windowSeconds: 900, at: new Date("2026-09-26T12:00:00.000Z") })).toBe(900);
    expect(projectAuthRateRetryAfterSeconds({ windowStart, windowSeconds: 900, at: new Date("2026-09-26T12:14:59.500Z") })).toBe(1);
    // Auch wenn die Uhr schon hinter dem Fenster steht.
    expect(projectAuthRateRetryAfterSeconds({ windowStart, windowSeconds: 900, at: new Date("2026-09-26T12:20:00.000Z") })).toBe(1);
  });

  it("hashes the key and mixes scope and kind into it", () => {
    const base = { ...scope, kind: "sign_in" as const, subject: "user@example.test" };
    const hash = projectAuthRateSubjectHash(base);
    // Ein SHA-256 in base64url: 43 Zeichen, und darin steht die Adresse nicht.
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).not.toContain("user");
    expect(hash).not.toContain("@");
    // Deterministisch — sonst koennten zwei Instanzen nicht dieselbe Zeile
    // treffen.
    expect(projectAuthRateSubjectHash(base)).toBe(hash);
    // Dieselbe Adresse, andere Art: andere Zeile.
    expect(projectAuthRateSubjectHash({ ...base, kind: "mail" })).not.toBe(hash);
    // Dieselbe Adresse, andere Umgebung: andere Zeile.
    expect(projectAuthRateSubjectHash({ ...base, environment: "production" })).not.toBe(hash);
    expect(projectAuthRateSubjectHash({ ...base, projectId: "project-2" })).not.toBe(hash);
  });

  it("refuses every limit that lies outside its bounds, with a reason", () => {
    expect(parseProjectAuthRateLimits(DEFAULT_PROJECT_AUTH_RATE_LIMITS))
      .toEqual({ ok: true, limits: DEFAULT_PROJECT_AUTH_RATE_LIMITS });
    const cases: ReadonlyArray<readonly [unknown, string, string]> = [
      [null, "not_an_object", ""],
      ["nope", "not_an_object", ""],
      [[], "not_an_object", ""],
      [{ ...limitsOf(5, 900), other: { max: 1, windowSeconds: 60 } }, "unknown_kind", "other"],
      [{ mail: { max: 5, windowSeconds: 900 }, refresh: { max: 5, windowSeconds: 900 } }, "missing_kind", "sign_in"],
      [{ ...limitsOf(5, 900), mail: 5 }, "missing_kind", "mail"],
      [{ ...limitsOf(5, 900), sign_in: { max: 1.5, windowSeconds: 900 } }, "max_not_an_integer", "sign_in"],
      [{ ...limitsOf(5, 900), sign_in: { max: "3", windowSeconds: 900 } }, "max_not_an_integer", "sign_in"],
      // Null Versuche waeren kein Limit, sondern ein Ausschalter fuer die
      // Anmeldung; den gibt es woanders.
      [{ ...limitsOf(5, 900), sign_in: { max: 0, windowSeconds: 900 } }, "max_out_of_range", "sign_in"],
      [{ ...limitsOf(5, 900), refresh: { max: 10_001, windowSeconds: 900 } }, "max_out_of_range", "refresh"],
      [{ ...limitsOf(5, 900), mail: { max: 5, windowSeconds: 59 } }, "window_out_of_range", "mail"],
      [{ ...limitsOf(5, 900), mail: { max: 5, windowSeconds: 86_401 } }, "window_out_of_range", "mail"],
      [{ ...limitsOf(5, 900), mail: { max: 5, windowSeconds: 90.5 } }, "window_not_an_integer", "mail"],
    ];
    for (const [value, reason, field] of cases) {
      expect(parseProjectAuthRateLimits(value), JSON.stringify(value)).toEqual({ ok: false, reason, field });
    }
    // Genau auf den Raendern geht es.
    expect(parseProjectAuthRateLimits(limitsOf(PROJECT_AUTH_RATE_LIMIT_BOUNDS.max.min, PROJECT_AUTH_RATE_LIMIT_BOUNDS.windowSeconds.min)).ok).toBe(true);
    expect(parseProjectAuthRateLimits(limitsOf(PROJECT_AUTH_RATE_LIMIT_BOUNDS.max.max, PROJECT_AUTH_RATE_LIMIT_BOUNDS.windowSeconds.max)).ok).toBe(true);
  });

  it("starts an environment on the defaults without calling that a decision", async () => {
    const built = fixture();
    const read = await built.first.readRateLimits(scope);
    expect(read.limits).toEqual(DEFAULT_PROJECT_AUTH_RATE_LIMITS);
    expect(read.defaults).toEqual(DEFAULT_PROJECT_AUTH_RATE_LIMITS);
    expect(read.configured).toBe(false);
    expect(read.updatedAt).toBeNull();
    expect(read.kinds).toEqual([...PROJECT_AUTH_RATE_LIMIT_KINDS]);
  });

  it("refuses the sign-in that crosses the limit and lets the next window through", async () => {
    const built = fixture();
    await verifiedAccount(built, "user@example.test");
    await built.first.setRateLimits(scope, limitsOf(3, 900), { id: "admin-1" });

    // Drei Fehlversuche: erlaubt, also die uebliche Ablehnung wegen falscher
    // Zugangsdaten. Einer unter der Grenze, einer darunter, einer genau
    // darauf.
    for (const attempt of [1, 2, 3]) {
      await expect(built.first.passwordSignIn(scope, {
        email: "user@example.test", password: "wrong", rateLimitKey: `ip-${attempt}`,
      }), `attempt ${attempt}`).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
    // Der vierte ueberschreitet sie — und jetzt gilt die Grenze, nicht mehr
    // das Passwort. Auch das richtige Passwort kommt nicht mehr durch; das
    // ist der Preis und der Punkt.
    await expect(built.first.passwordSignIn(scope, {
      email: "user@example.test", password: PASSWORD, rateLimitKey: "ip-4",
    })).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 900 });

    // Das naechste Fenster laesst wieder durch, und zwar ohne dass jemand
    // etwas aufraeumen muesste.
    built.setNow("2026-09-26T12:15:00.000Z");
    const session = await built.first.passwordSignIn(scope, {
      email: "user@example.test", password: PASSWORD, rateLimitKey: "ip-5",
    });
    expect(session).toHaveProperty("accessToken");
  });

  it("counts the same key across two instances that share one store", async () => {
    const built = fixture();
    await verifiedAccount(built, "user@example.test");
    await built.first.setRateLimits(scope, limitsOf(2, 900), { id: "admin-1" });

    // Ein Versuch hier, einer dort: zusammen zwei, und die Grenze steht auf
    // zwei. Der dritte faellt, egal an welcher Instanz er ankommt. Vor 2.56
    // haette jede Instanz ihre eigenen zwei gehabt, also in Wahrheit vier.
    await expect(built.first.passwordSignIn(scope, {
      email: "user@example.test", password: "wrong", rateLimitKey: "ip-a",
    })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(built.second.passwordSignIn(scope, {
      email: "user@example.test", password: "wrong", rateLimitKey: "ip-b",
    })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    for (const [label, service] of [["first", built.first], ["second", built.second]] as const) {
      await expect(service.passwordSignIn(scope, {
        email: "user@example.test", password: PASSWORD, rateLimitKey: `ip-${label}`,
      }), label).rejects.toMatchObject({ code: "RATE_LIMITED" });
    }
    // Und die Einstellung, die die eine Instanz geschrieben hat, gilt fuer
    // die andere: Sie liest sie bei jedem Versuch neu.
    expect((await built.second.readRateLimits(scope)).limits.sign_in).toEqual({ max: 2, windowSeconds: 900 });
  });

  it("tells an attacker nothing about whether the identity exists", async () => {
    const built = fixture();
    await verifiedAccount(built, "known@example.test");
    await built.first.setRateLimits(scope, limitsOf(1, 900), { id: "admin-1" });

    // Ein Versuch je Adresse ist erlaubt, der zweite nicht — und zwar fuer
    // eine Adresse, die es gibt, genauso wie fuer eine, die es nicht gibt.
    for (const email of ["known@example.test", "unknown@example.test"]) {
      await expect(built.first.passwordSignIn(scope, { email, password: "wrong", rateLimitKey: `one-${email}` }), email)
        .rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
      await expect(built.first.passwordSignIn(scope, { email, password: "wrong", rateLimitKey: `two-${email}` }), email)
        .rejects.toMatchObject({ code: "RATE_LIMITED" });
    }
  });

  it("counts a refresh by session family and not by user", async () => {
    const built = fixture();
    const first = await verifiedAccount(built, "user@example.test");
    await built.first.setRateLimits(scope, limitsOf(2, 900), { id: "admin-1" });

    // Zwei Erneuerungen derselben Familie gehen, die dritte nicht.
    const second = await built.first.refresh(scope, first.refreshToken);
    const third = await built.second.refresh(scope, second.refreshToken);
    await expect(built.first.refresh(scope, third.refreshToken))
      .rejects.toMatchObject({ code: "RATE_LIMITED" });

    // Eine zweite Anmeldung ist eine zweite Familie und hat ihre eigene
    // Zaehlung — sonst sperrte ein aktives Geraet ein anderes aus.
    built.setNow("2026-09-26T12:01:00.000Z");
    const other = await built.first.passwordSignIn(scope, {
      email: "user@example.test", password: PASSWORD, rateLimitKey: "ip-other",
    });
    if ("mfaRequired" in other) throw new Error("unexpected MFA");
    expect(await built.first.refresh(scope, other.refreshToken)).toHaveProperty("accessToken");
  });

  it("shares one counter between sign-up, magic link and password reset", async () => {
    const built = fixture();
    await built.first.setRateLimits(scope, limitsOf(2, 3_600), { id: "admin-1" });
    // Zwei angeforderte Mails an dieselbe Adresse, auf zwei Wegen — die
    // dritte faellt, unabhaengig davon, welcher Weg sie anfordert.
    expect(await built.first.signUp(scope, {
      email: "user@example.test", password: PASSWORD,
      redirectTo: "https://app.test/callback", rateLimitKey: "ip-1",
    })).toMatchObject({ accepted: true });
    expect(await built.second.requestMagicLink(scope, {
      email: "user@example.test", redirectTo: "https://app.test/callback", rateLimitKey: "ip-2",
    })).toMatchObject({ accepted: true });
    await expect(built.first.requestPasswordReset(scope, {
      email: "user@example.test", redirectTo: "https://app.test/callback", rateLimitKey: "ip-3",
    })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    // Eine andere Adresse ist eine andere Zaehlung.
    expect(await built.first.requestMagicLink(scope, {
      email: "other@example.test", redirectTo: "https://app.test/callback", rateLimitKey: "ip-4",
    })).toMatchObject({ accepted: true });
  });

  it("writes an audit entry when a limit bites, without a key and without an address", async () => {
    const built = fixture();
    await built.first.setRateLimits(scope, limitsOf(1, 900), { id: "admin-1" });
    await built.first.requestMagicLink(scope, {
      email: "user@example.test", redirectTo: "https://app.test/callback", rateLimitKey: "ip-1",
    });
    await expect(built.first.requestMagicLink(scope, {
      email: "user@example.test", redirectTo: "https://app.test/callback", rateLimitKey: "ip-2",
    })).rejects.toMatchObject({ code: "RATE_LIMITED" });

    const page = await built.first.listAuditEvents(scope, 50);
    const blocked = page.events.filter((event) => event.action === "project_auth.rate_limit.blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({
      actorType: "system", actorRef: "system", status: "failed",
      resourceRef: "project_auth_environment:development",
      metadata: { kind: "mail", max: 1, windowSeconds: 900 },
    });
    // Weder die Adresse noch ihr Hash stehen in der Kette.
    const serialised = JSON.stringify(blocked);
    expect(serialised).not.toContain("@");
    expect(serialised).not.toContain("example.test");
    expect(serialised).not.toContain(projectAuthRateSubjectHash({
      ...scope, kind: "mail", subject: "user@example.test",
    }));

    // Und die Aenderung selbst steht mit den sechs Zahlen darin, ohne dass
    // eine davon den Sanitizer durchbrechen muesste.
    const changed = page.events.filter((event) => event.action === "project_auth.rate_limits.changed");
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({
      actorType: "admin", actorRef: "admin-1", status: "succeeded",
      metadata: {
        signInMax: 1, signInWindow: 900, mailMax: 1, mailWindow: 900,
        refreshMax: 1, refreshWindow: 900,
      },
    });
  });

  it("fails open when the counter itself fails and closed when it says no", async () => {
    const built = fixture();
    await verifiedAccount(built, "user@example.test");
    await built.first.setRateLimits(scope, limitsOf(1, 900), { id: "admin-1" });
    // Der Zaehler faellt aus. Die Anmeldung laeuft trotzdem weiter zur
    // Passwortpruefung; ein kaputter Zaehler ist kein Ausfall der Anmeldung.
    const broken = built.repository.countRateLimitAttempt.bind(built.repository);
    built.repository.countRateLimitAttempt = async () => { throw new Error("counter is down"); };
    const session = await built.first.passwordSignIn(scope, {
      email: "user@example.test", password: PASSWORD, rateLimitKey: "ip-broken",
    });
    expect(session).toHaveProperty("accessToken");
    // Mit heilem Zaehler schliesst dieselbe Lage wieder.
    built.repository.countRateLimitAttempt = broken;
    await expect(built.first.passwordSignIn(scope, {
      email: "user@example.test", password: PASSWORD, rateLimitKey: "ip-healthy",
    })).resolves.toHaveProperty("accessToken");
    await expect(built.first.passwordSignIn(scope, {
      email: "user@example.test", password: PASSWORD, rateLimitKey: "ip-healthy-2",
    })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("refuses to store a limit outside its bounds and leaves the stored one alone", async () => {
    const built = fixture();
    const stored = await built.first.setRateLimits(scope, limitsOf(7, 600), { id: "admin-1" });
    expect(stored.configured).toBe(true);
    expect(stored.limits.sign_in).toEqual({ max: 7, windowSeconds: 600 });
    await expect(built.first.setRateLimits(scope, { ...limitsOf(7, 600), sign_in: { max: 0, windowSeconds: 600 } }, { id: "admin-1" }))
      .rejects.toBeInstanceOf(ProjectAuthRateLimitError);
    expect((await built.second.readRateLimits(scope)).limits.sign_in).toEqual({ max: 7, windowSeconds: 600 });
  });

  it("leaves the switch of 2.52 and the list of 2.54 untouched", async () => {
    const built = fixture();
    await built.first.setReturnTargets(scope, ["https://app.test"], { id: "admin-1" });
    await built.first.setMfaRequired(scope, true, { id: "admin-1" });
    await built.first.setRateLimits(scope, limitsOf(4, 120), { id: "admin-1" });
    expect((await built.first.readReturnTargets(scope)).targets).toEqual(["https://app.test"]);
    expect((await built.first.readMfaPolicy(scope)).required).toBe(true);
    expect((await built.first.readRateLimits(scope)).limits.mail).toEqual({ max: 4, windowSeconds: 120 });
  });
});
