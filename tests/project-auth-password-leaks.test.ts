import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PasswordHasher } from "@/lib/server/auth/password";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import { MemoryProjectAuthAuditSink } from "@/lib/server/project-auth/audit";
import { ProjectAuthSecretProtector, ProjectAuthTotp } from "@/lib/server/project-auth/mfa";
import { ProjectAuthOidcCatalog, ProjectAuthOidcClient } from "@/lib/server/project-auth/oidc";
import {
  DEFAULT_PROJECT_AUTH_PASSWORD_PROTECTION,
  parseProjectAuthLeakList,
  parseProjectAuthPasswordProtection,
  projectAuthBuiltInLeakList,
  projectAuthPasswordDigest,
  projectAuthPasswordIsLeaked,
  publicProjectAuthLeakList,
  PROJECT_AUTH_BUILT_IN_LEAKED_PASSWORDS,
  PROJECT_AUTH_BUILT_IN_LEAK_SOURCE,
  PROJECT_AUTH_LEAK_LIST_BOUNDS,
  PROJECT_AUTH_PASSWORD_MIN_LENGTH_BOUNDS,
  type ProjectAuthLeakList,
} from "@/lib/server/project-auth/password-leaks";
import { MemoryProjectAuthRepository } from "@/lib/server/project-auth/repository";
import { leakedPasswordListFromEnv } from "@/lib/server/project-auth/runtime";
import {
  NoopDevelopmentProjectAuthDelivery,
  ProjectAuthPasswordProtectionError,
  ProjectAuthService,
} from "@/lib/server/project-auth/service";
import { ProjectAuthTokenService } from "@/lib/server/project-auth/tokens";
import { ConfigurationError } from "@/lib/server/db/errors";

/**
 * Passwoerter gegen bekannte Lecks (2.53).
 *
 * Vier Ebenen, bewusst getrennt:
 *
 * 1. Die **reine Entscheidung** — Digest rechnen, kuerzen, nachschlagen. Keine
 *    Datenbank, kein Netz, keine Uhr.
 * 2. Das **Listenformat**: was eine Datei tragen darf und was sie ablehnt.
 * 3. Der **Lader**, der aus der Prozessumgebung eine Liste macht und bei einer
 *    fehlenden oder kaputten Datei nicht startet.
 * 4. Der **Dienst**, der die Regel an beiden Stellen anwendet, an denen ein
 *    Passwort gesetzt wird — samt der Frage, ob das Passwort dabei irgendwo
 *    auftaucht. Die PostgreSQL-Seite belegt der Fall
 *    "(2.60) refuses a known leaked password at sign-up when the project
 *    requires it" in postgres.integration.
 */
class FastHasher implements PasswordHasher {
  readonly dummyHash = "fast:dummy";
  async hash(password: string) { return `fast:${createHash("sha256").update(password).digest("hex")}`; }
  async verify(password: string, hash: string) { return hash === await this.hash(password); }
}

const scope = { organizationId: "org-1", projectId: "project-1", environment: "development" as const };

/** Ein Passwort, das lang genug ist und in keiner Liste dieses Tests steht. */
const CLEAN_PASSWORD = "eine ausreichend lange Parole ohne Leck";
/** Ein Passwort, das lang genug ist und in die Listen dieses Tests gelegt wird. */
const LEAKED_PASSWORD = "correct horse battery staple";

function listOf(passwords: readonly string[], prefixLength = 40): ProjectAuthLeakList {
  const text = passwords
    .map((password) => `${projectAuthPasswordDigest(password, "sha1").slice(0, prefixLength)}:7`)
    .join("\n");
  const parsed = parseProjectAuthLeakList(text, "sha1");
  if (!parsed.ok) throw new Error(`unexpected rejection ${parsed.reason}`);
  return parsed.list;
}

function fixture(options: { leakedPasswords?: ProjectAuthLeakList } = {}) {
  const repository = new MemoryProjectAuthRepository();
  const audit = new MemoryProjectAuthAuditSink();
  const { privateKey } = generateKeyPairSync("ed25519");
  let id = 0;
  let token = 0;
  const service = new ProjectAuthService({
    repository, audit, passwords: new FastHasher(),
    leakedPasswords: options.leakedPasswords,
    rateLimiter: new InMemoryRateLimiter(),
    tokens: new ProjectAuthTokenService({ kid: "leaks", privateKey }, "https://qkern.test"),
    mfa: new ProjectAuthTotp(), secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 9)),
    delivery: new NoopDevelopmentProjectAuthDelivery(), oidcCatalog: new ProjectAuthOidcCatalog([]),
    oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
    callbackBaseUrl: "https://qkern.test", allowedRedirectOrigins: new Set(["https://app.test"]),
    exposeDeliveryTokens: true, now: () => new Date("2026-09-26T12:00:00.000Z"),
    id: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    opaqueToken: (prefix) => `qk_${prefix}_${String(++token).padStart(43, "z")}`,
  });
  return { repository, audit, service };
}

let temporary = "";
function listFile(name: string, contents: string): string {
  temporary ||= mkdtempSync(path.join(tmpdir(), "qkern-leaks-"));
  const file = path.join(temporary, name);
  writeFileSync(file, contents, "utf8");
  return file;
}

describe("project auth password leaks", () => {
  /* ---------------------------------------------------------------- *
   * 1. Die reine Entscheidung
   * ---------------------------------------------------------------- */

  it("refuses a password that stands in the list and accepts one that does not", () => {
    const list = listOf([LEAKED_PASSWORD]);
    expect(projectAuthPasswordIsLeaked(list, LEAKED_PASSWORD)).toBe(true);
    expect(projectAuthPasswordIsLeaked(list, CLEAN_PASSWORD)).toBe(false);
    // Der Vergleich ist auf das Zeichen genau: ein Zeichen mehr ist ein
    // anderes Passwort und ein anderer Digest.
    expect(projectAuthPasswordIsLeaked(list, `${LEAKED_PASSWORD} `)).toBe(false);
    expect(projectAuthPasswordIsLeaked(list, LEAKED_PASSWORD.toUpperCase())).toBe(false);
  });

  it("matches on a prefix as short as the format allows and on a full digest alike", () => {
    for (const prefixLength of [PROJECT_AUTH_LEAK_LIST_BOUNDS.prefixLength.min, 20, 40]) {
      const list = listOf([LEAKED_PASSWORD], prefixLength);
      expect(list.prefixLength, `prefix ${prefixLength}`).toBe(prefixLength);
      expect(projectAuthPasswordIsLeaked(list, LEAKED_PASSWORD), `prefix ${prefixLength}`).toBe(true);
      expect(projectAuthPasswordIsLeaked(list, CLEAN_PASSWORD), `prefix ${prefixLength}`).toBe(false);
    }
  });

  it("computes the digest in the shape the well-known lists use", () => {
    // Gross geschriebenes Hex, und beide Algorithmen in ihrer Laenge.
    expect(projectAuthPasswordDigest("password", "sha1")).toMatch(/^[0-9A-F]{40}$/);
    expect(projectAuthPasswordDigest("password", "sha256")).toMatch(/^[0-9A-F]{64}$/);
    // Der bekannte SHA-1 von "password" -- die Zeile, an der man sieht, dass
    // hier wirklich SHA-1 gerechnet wird und nicht irgendetwas.
    expect(projectAuthPasswordDigest("password", "sha1"))
      .toBe("5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8");
  });

  /* ---------------------------------------------------------------- *
   * 2. Die eingebaute Liste
   * ---------------------------------------------------------------- */

  it("ships exactly 25 built-in entries from one named source and says so", () => {
    expect(PROJECT_AUTH_BUILT_IN_LEAKED_PASSWORDS).toHaveLength(25);
    expect(new Set(PROJECT_AUTH_BUILT_IN_LEAKED_PASSWORDS).size).toBe(25);
    expect(PROJECT_AUTH_BUILT_IN_LEAK_SOURCE).toContain("SplashData");
    expect(PROJECT_AUTH_BUILT_IN_LEAK_SOURCE).toContain("2019");
    const list = projectAuthBuiltInLeakList();
    expect(list).toMatchObject({ source: "built_in", algorithm: "sha1", prefixLength: 40, entries: 25 });
    // Jeder Eintrag ist wirklich getroffen, und ein Nicht-Eintrag nicht.
    for (const password of PROJECT_AUTH_BUILT_IN_LEAKED_PASSWORDS) {
      expect(projectAuthPasswordIsLeaked(list, password), password).toBe(true);
    }
    expect(projectAuthPasswordIsLeaked(list, LEAKED_PASSWORD)).toBe(false);
    // Und die unbequeme Haelfte, hier als Zusicherung und nicht als Fussnote:
    // Alle 25 sind kuerzer als die 12 Zeichen, die der Dienst ohnehin
    // verlangt. Ohne Listendatei lehnt die Pruefung darum nichts ab, was die
    // Laengenregel nicht schon ablehnt.
    for (const password of PROJECT_AUTH_BUILT_IN_LEAKED_PASSWORDS) {
      expect(password.length, password).toBeLessThan(12);
    }
    // Was die Console darueber erfaehrt: Herkunft, Groesse, Quelle -- und kein
    // Eintrag.
    const shown = publicProjectAuthLeakList(list);
    expect(shown).toEqual({
      source: "built_in", algorithm: "sha1", prefixLength: 40,
      entries: 25, builtInEntries: 25, builtInSource: PROJECT_AUTH_BUILT_IN_LEAK_SOURCE,
    });
    const serialised = JSON.stringify(shown);
    for (const password of PROJECT_AUTH_BUILT_IN_LEAKED_PASSWORDS) {
      expect(serialised, password).not.toContain(password);
    }
  });

  it("caches the built-in list instead of hashing it again on every call", () => {
    expect(projectAuthBuiltInLeakList()).toBe(projectAuthBuiltInLeakList());
  });

  /* ---------------------------------------------------------------- *
   * 3. Das Listenformat
   * ---------------------------------------------------------------- */

  it("reads the format the well-known lists ship, comments and counters included", () => {
    const digest = projectAuthPasswordDigest(LEAKED_PASSWORD, "sha1");
    const parsed = parseProjectAuthLeakList([
      "# eine Liste mit Kommentar",
      "",
      `${digest}:1234`,
      `   ${projectAuthPasswordDigest("zweites", "sha1").toLowerCase()}   `,
      "",
    ].join("\r\n"), "sha1");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.list.entries).toBe(2);
    // Klein geschriebenes Hex wird angenommen und gross gespeichert.
    expect([...parsed.list.digests].every((entry) => /^[0-9A-F]{40}$/.test(entry))).toBe(true);
    expect(projectAuthPasswordIsLeaked(parsed.list, LEAKED_PASSWORD)).toBe(true);
    // Die Anzahl aus der Zeile wird verworfen und nirgends behalten: Eine
    // Ablehnung soll nie sagen, wie oft ein Passwort vorkommt.
    expect(JSON.stringify([...parsed.list.digests])).not.toContain("1234");
  });

  it("refuses a malformed list with a reason and a line number", () => {
    const good = projectAuthPasswordDigest(LEAKED_PASSWORD, "sha1");
    const cases: ReadonlyArray<[string, string, number]> = [
      ["", "empty", 1],
      ["# nur Kommentar\n\n", "empty", 3],
      [`${good}\nNICHT HEX HIER DRIN\n`, "not_hex", 2],
      [`${good}\nDEADBEEF\n`, "prefix_too_short", 2],
      [`${good}\n${good}${good}\n`, "prefix_too_long", 2],
      [`${good}\n${good.slice(0, 20)}\n`, "mixed_prefix_length", 2],
    ];
    for (const [text, reason, line] of cases) {
      const parsed = parseProjectAuthLeakList(text, "sha1");
      expect(parsed.ok, reason).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.reason, text.slice(0, 20)).toBe(reason);
      expect(parsed.line, reason).toBe(line);
    }
  });

  it("holds a bound on the list so a wrong file cannot eat the process", () => {
    expect(PROJECT_AUTH_LEAK_LIST_BOUNDS.entries).toBe(1_000_000);
    expect(PROJECT_AUTH_LEAK_LIST_BOUNDS.bytes).toBe(16 * 1024 * 1024);
    const oversized = "A".repeat(PROJECT_AUTH_LEAK_LIST_BOUNDS.bytes + 1);
    const parsed = parseProjectAuthLeakList(oversized, "sha1");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("too_large");
  });

  it("accepts sha256 entries when the list is declared as sha256", () => {
    const digest = projectAuthPasswordDigest(LEAKED_PASSWORD, "sha256");
    const parsed = parseProjectAuthLeakList(digest, "sha256");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.list).toMatchObject({ algorithm: "sha256", prefixLength: 64, entries: 1 });
    expect(projectAuthPasswordIsLeaked(parsed.list, LEAKED_PASSWORD)).toBe(true);
    // Derselbe Text als sha1 gelesen waere zu lang: 64 Hexzeichen passen in
    // keinen SHA-1.
    const asSha1 = parseProjectAuthLeakList(digest, "sha1");
    expect(asSha1.ok).toBe(false);
  });

  /* ---------------------------------------------------------------- *
   * 4. Der Lader
   * ---------------------------------------------------------------- */

  it("falls back to the built-in list only when no file is configured", () => {
    expect(leakedPasswordListFromEnv({})).toBe(projectAuthBuiltInLeakList());
    expect(leakedPasswordListFromEnv({ QKERN_PROJECT_AUTH_LEAKED_PASSWORD_FILE: "   " }))
      .toBe(projectAuthBuiltInLeakList());
  });

  it("loads a configured file and reads its entries", () => {
    const file = listFile("good.txt", `# qkern\n${projectAuthPasswordDigest(LEAKED_PASSWORD, "sha1")}:9\n`);
    const list = leakedPasswordListFromEnv({ QKERN_PROJECT_AUTH_LEAKED_PASSWORD_FILE: file });
    expect(list).toMatchObject({ source: "file", algorithm: "sha1", entries: 1 });
    expect(projectAuthPasswordIsLeaked(list, LEAKED_PASSWORD)).toBe(true);
  });

  it("refuses to start on a missing or malformed file instead of falling back quietly", () => {
    // Ein stiller Rueckfall auf die eingebaute Liste hiesse, eine
    // eingeschaltete Pruefung weiterlaufen zu lassen, die nichts mehr prueft.
    expect(() => leakedPasswordListFromEnv({
      QKERN_PROJECT_AUTH_LEAKED_PASSWORD_FILE: path.join(temporary || tmpdir(), "gibt-es-nicht.txt"),
    })).toThrow(ConfigurationError);
    const broken = listFile("broken.txt", "NICHT HEX\n");
    let thrown: unknown;
    try { leakedPasswordListFromEnv({ QKERN_PROJECT_AUTH_LEAKED_PASSWORD_FILE: broken }); }
    catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(ConfigurationError);
    // Der Fehler nennt Grund und Zeile -- und nicht den Pfad.
    expect((thrown as Error).message).toContain("not_hex");
    expect((thrown as Error).message).toContain("line 1");
    expect((thrown as Error).message).not.toContain(broken);
    // Ein unbekannter Algorithmus ist genauso ein Konfigurationsfehler.
    expect(() => leakedPasswordListFromEnv({
      QKERN_PROJECT_AUTH_LEAKED_PASSWORD_FILE: listFile("md5.txt", "A".repeat(32)),
      QKERN_PROJECT_AUTH_LEAKED_PASSWORD_ALGORITHM: "md5",
    })).toThrow(ConfigurationError);
  });

  /* ---------------------------------------------------------------- *
   * 5. Die Einstellung
   * ---------------------------------------------------------------- */

  it("defaults to off, to twelve characters and to naming the leak", () => {
    expect(DEFAULT_PROJECT_AUTH_PASSWORD_PROTECTION)
      .toEqual({ leakedPasswordCheck: false, minLength: 12, notice: "named" });
    expect(PROJECT_AUTH_PASSWORD_MIN_LENGTH_BOUNDS).toEqual({ min: 12, max: 128 });
  });

  it("refuses every shape of a wrong setting with a stable reason and the field", () => {
    const cases: ReadonlyArray<[unknown, string, string]> = [
      [null, "not_an_object", ""],
      ["yes", "not_an_object", ""],
      [[], "not_an_object", ""],
      [{ leakedPasswordCheck: true, minLength: 12, notice: "named", extra: 1 }, "unknown_field", "extra"],
      [{ minLength: 12, notice: "named" }, "check_not_a_boolean", "leakedPasswordCheck"],
      [{ leakedPasswordCheck: "true", minLength: 12, notice: "named" }, "check_not_a_boolean", "leakedPasswordCheck"],
      [{ leakedPasswordCheck: true, minLength: 12.5, notice: "named" }, "min_length_not_an_integer", "minLength"],
      [{ leakedPasswordCheck: true, minLength: 11, notice: "named" }, "min_length_out_of_range", "minLength"],
      [{ leakedPasswordCheck: true, minLength: 129, notice: "named" }, "min_length_out_of_range", "minLength"],
      [{ leakedPasswordCheck: true, minLength: 12, notice: "loud" }, "unknown_notice", "notice"],
    ];
    for (const [input, reason, field] of cases) {
      const parsed = parseProjectAuthPasswordProtection(input);
      expect(parsed.ok, reason).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.reason, JSON.stringify(input)).toBe(reason);
      expect(parsed.field, reason).toBe(field);
    }
    const good = parseProjectAuthPasswordProtection({
      leakedPasswordCheck: true, minLength: 16, notice: "generic",
    });
    expect(good).toEqual({
      ok: true, protection: { leakedPasswordCheck: true, minLength: 16, notice: "generic" },
    });
  });

  /* ---------------------------------------------------------------- *
   * 6. Der Dienst
   * ---------------------------------------------------------------- */

  it("reads the defaults while the environment never stored a setting", async () => {
    const built = fixture();
    expect(await built.service.readPasswordProtection(scope)).toMatchObject({
      protection: { leakedPasswordCheck: false, minLength: 12, notice: "named" },
      configured: false, updatedAt: null,
      list: { source: "built_in", entries: 25 },
    });
  });

  it("refuses a known leaked password at sign-up and at a password reset", async () => {
    const built = fixture({ leakedPasswords: listOf([LEAKED_PASSWORD]) });
    await built.service.setPasswordProtection(scope, {
      leakedPasswordCheck: true, minLength: 12, notice: "named",
    }, { id: "admin-1" });

    // Die Registrierung: das bekannte Passwort abgelehnt, das unbekannte nicht.
    await expect(built.service.signUp(scope, {
      email: "opfer@example.test", password: LEAKED_PASSWORD,
      redirectTo: "https://app.test/callback", rateLimitKey: "a",
    })).rejects.toMatchObject({ code: "LEAKED_PASSWORD" });
    const signUp = await built.service.signUp(scope, {
      email: "opfer@example.test", password: CLEAN_PASSWORD,
      redirectTo: "https://app.test/callback", rateLimitKey: "b",
    });
    expect(signUp.accepted).toBe(true);

    // Das Zuruecksetzen: dieselbe Regel auf dem zweiten Weg. Der Schein wird
    // dabei nicht verbraucht -- das abgelehnte Passwort kostet den Nutzer
    // keine neue Mail.
    await built.service.consumeEmailToken(scope, {
      token: signUp.debugToken!, purpose: "email_verification",
    });
    const reset = await built.service.requestPasswordReset(scope, {
      email: "opfer@example.test", redirectTo: "https://app.test/callback", rateLimitKey: "c",
    });
    await expect(built.service.resetPassword(scope, {
      token: reset.debugToken!, password: LEAKED_PASSWORD,
    })).rejects.toMatchObject({ code: "LEAKED_PASSWORD" });
    expect(await built.service.resetPassword(scope, {
      token: reset.debugToken!, password: `${CLEAN_PASSWORD} zwei`,
    })).toEqual({ reset: true });
  });

  it("lets a known password through while the check is switched off", async () => {
    const built = fixture({ leakedPasswords: listOf([LEAKED_PASSWORD]) });
    // Ohne Zeile in den Einstellungen: die Vorgabe, und die ist aus.
    const signUp = await built.service.signUp(scope, {
      email: "ohne-pruefung@example.test", password: LEAKED_PASSWORD,
      redirectTo: "https://app.test/callback", rateLimitKey: "a",
    });
    expect(signUp.accepted).toBe(true);
    // Ausdruecklich ausgeschaltet: genauso.
    await built.service.setPasswordProtection(scope, {
      leakedPasswordCheck: false, minLength: 12, notice: "named",
    }, { id: "admin-1" });
    expect(await built.service.signUp(scope, {
      email: "auch-ohne@example.test", password: LEAKED_PASSWORD,
      redirectTo: "https://app.test/callback", rateLimitKey: "b",
    })).toMatchObject({ accepted: true });
  });

  it("enforces the minimum length of the environment above the floor of the service", async () => {
    const built = fixture();
    await built.service.setPasswordProtection(scope, {
      leakedPasswordCheck: false, minLength: 20, notice: "named",
    }, { id: "admin-1" });
    // 12 Zeichen genuegen dem Dienst, aber nicht dieser Umgebung.
    await expect(built.service.signUp(scope, {
      email: "kurz@example.test", password: "zwoelfzeich",
      redirectTo: "https://app.test/callback", rateLimitKey: "a",
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(built.service.signUp(scope, {
      email: "kurz@example.test", password: "dreizehnzeich",
      redirectTo: "https://app.test/callback", rateLimitKey: "b",
    })).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    expect(await built.service.signUp(scope, {
      email: "lang@example.test", password: "einundzwanzig Zeichen lang",
      redirectTo: "https://app.test/callback", rateLimitKey: "c",
    })).toMatchObject({ accepted: true });
  });

  it("says less when the environment asks for a generic wording", async () => {
    const built = fixture({ leakedPasswords: listOf([LEAKED_PASSWORD]) });
    await built.service.setPasswordProtection(scope, {
      leakedPasswordCheck: true, minLength: 12, notice: "generic",
    }, { id: "admin-1" });
    await expect(built.service.signUp(scope, {
      email: "leise@example.test", password: LEAKED_PASSWORD,
      redirectTo: "https://app.test/callback", rateLimitKey: "a",
    })).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
  });

  it("writes an audit entry for the change and for the refusal, with no password in it", async () => {
    const built = fixture({ leakedPasswords: listOf([LEAKED_PASSWORD]) });
    await built.service.setPasswordProtection(scope, {
      leakedPasswordCheck: true, minLength: 14, notice: "named",
    }, { id: "admin-1" });
    await expect(built.service.signUp(scope, {
      email: "opfer@example.test", password: LEAKED_PASSWORD,
      redirectTo: "https://app.test/callback", rateLimitKey: "a",
    })).rejects.toMatchObject({ code: "LEAKED_PASSWORD" });

    const page = await built.service.listAuditEvents(scope, 50);
    const changed = page.events.filter((event) => event.action === "project_auth.password_protection.changed");
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({
      actorType: "admin", actorRef: "admin-1", status: "succeeded",
      resourceRef: "project_auth_environment:development",
      metadata: {
        leakCheck: true, minLength: 14, notice: "named",
        listSource: "file", listEntries: 1,
      },
    });
    const refused = page.events.filter((event) => event.action === "project_auth.password.refused");
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({
      actorType: "app_user", actorRef: "anonymous", status: "failed",
      metadata: { reason: "known_leak", listSource: "file", listEntries: 1 },
    });
    // Weder das Passwort noch sein Digest noch die Adresse stehen in der Kette.
    const serialised = JSON.stringify(page.events);
    expect(serialised).not.toContain(LEAKED_PASSWORD);
    expect(serialised).not.toContain(projectAuthPasswordDigest(LEAKED_PASSWORD, "sha1"));
    expect(serialised).not.toContain("@");
  });

  /* ---------------------------------------------------------------- *
   * 7. Und die Zusage, auf die es am Ende ankommt
   * ---------------------------------------------------------------- */

  describe("with every console channel watched", () => {
    const channels = ["log", "info", "warn", "error", "debug", "trace"] as const;
    const written: string[] = [];

    beforeEach(() => {
      written.length = 0;
      for (const channel of channels) {
        vi.spyOn(console, channel).mockImplementation((...args: unknown[]) => {
          written.push(args.map((value) => {
            try { return typeof value === "string" ? value : JSON.stringify(value); }
            catch { return String(value); }
          }).join(" "));
        });
      }
    });

    afterEach(() => { vi.restoreAllMocks(); });

    it("never writes the password into a log line or an error, on either path", async () => {
      const built = fixture({ leakedPasswords: listOf([LEAKED_PASSWORD]) });
      await built.service.setPasswordProtection(scope, {
        leakedPasswordCheck: true, minLength: 12, notice: "named",
      }, { id: "admin-1" });

      const errors: unknown[] = [];
      for (const attempt of [1, 2]) {
        try {
          await built.service.signUp(scope, {
            email: `opfer-${attempt}@example.test`, password: LEAKED_PASSWORD,
            redirectTo: "https://app.test/callback", rateLimitKey: `a${attempt}`,
          });
        } catch (error) { errors.push(error); }
      }
      try {
        await built.service.resetPassword(scope, {
          token: `qk_reset_${"y".repeat(43)}`, password: LEAKED_PASSWORD,
        });
      } catch (error) { errors.push(error); }
      expect(errors).toHaveLength(3);

      // Der Fehler traegt einen Code und sonst nichts: keine Nachricht mit dem
      // Passwort, kein Feld damit, kein `cause` damit.
      for (const error of errors) {
        const shown = [
          (error as Error).message, (error as Error).stack ?? "",
          JSON.stringify(error, Object.getOwnPropertyNames(error as object)),
        ].join("\n");
        expect(shown).not.toContain(LEAKED_PASSWORD);
        expect(shown).not.toContain(projectAuthPasswordDigest(LEAKED_PASSWORD, "sha1"));
      }
      // Und keine Zeile auf irgendeinem Kanal von console traegt es.
      for (const line of written) {
        expect(line).not.toContain(LEAKED_PASSWORD);
        expect(line).not.toContain(projectAuthPasswordDigest(LEAKED_PASSWORD, "sha1"));
      }
      // Auch die Kette nicht, und auch nicht die Antwort der Leseroute.
      expect(JSON.stringify(await built.service.listAuditEvents(scope, 50)))
        .not.toContain(LEAKED_PASSWORD);
      expect(JSON.stringify(await built.service.readPasswordProtection(scope)))
        .not.toContain(LEAKED_PASSWORD);
    });
  });

  it("refuses a wrong setting through the service with the typed error", async () => {
    const built = fixture();
    await expect(built.service.setPasswordProtection(scope, { leakedPasswordCheck: true }))
      .rejects.toBeInstanceOf(ProjectAuthPasswordProtectionError);
    await expect(built.service.setPasswordProtection(scope, { leakedPasswordCheck: true }))
      .rejects.toMatchObject({ reason: "min_length_not_an_integer", field: "minLength" });
  });

  it("leaves the neighbouring settings of the same row untouched", async () => {
    const built = fixture();
    await built.service.setMfaRequired(scope, true, { id: "admin-1" });
    await built.service.setReturnTargets(scope, ["https://app.test"], { id: "admin-1" });
    await built.service.setRateLimits(scope, {
      sign_in: { max: 3, windowSeconds: 900 },
      mail: { max: 5, windowSeconds: 3600 },
      refresh: { max: 2, windowSeconds: 900 },
    }, { id: "admin-1" });
    await built.service.setPasswordProtection(scope, {
      leakedPasswordCheck: true, minLength: 20, notice: "generic",
    }, { id: "admin-1" });
    const settings = await built.repository.readSettings(scope);
    expect(settings).toMatchObject({
      mfaRequired: true,
      returnTargets: ["https://app.test"],
      rateLimits: { sign_in: { max: 3, windowSeconds: 900 } },
      passwordProtection: { leakedPasswordCheck: true, minLength: 20, notice: "generic" },
    });
    // Und umgekehrt: Der Schalter aus 2.52 fasst den Passwortschutz nicht an.
    await built.service.setMfaRequired(scope, false, { id: "admin-1" });
    expect((await built.repository.readSettings(scope))?.passwordProtection)
      .toEqual({ leakedPasswordCheck: true, minLength: 20, notice: "generic" });
  });
});
