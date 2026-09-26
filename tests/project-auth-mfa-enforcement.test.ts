import { createHash, createHmac, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PasswordHasher } from "@/lib/server/auth/password";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import { MemoryProjectAuthAuditSink } from "@/lib/server/project-auth/audit";
import {
  projectAuthMfaOutcome,
  projectAuthSessionUsable,
} from "@/lib/server/project-auth/mfa-enforcement";
import { ProjectAuthSecretProtector, ProjectAuthTotp } from "@/lib/server/project-auth/mfa";
import { ProjectAuthOidcCatalog, ProjectAuthOidcClient } from "@/lib/server/project-auth/oidc";
import { MemoryProjectAuthRepository } from "@/lib/server/project-auth/repository";
import {
  NoopDevelopmentProjectAuthDelivery,
  ProjectAuthService,
  type ProjectAuthEnrollmentPrincipal,
} from "@/lib/server/project-auth/service";
import { hashProjectAuthToken, ProjectAuthTokenService } from "@/lib/server/project-auth/tokens";

/**
 * Der zweite Faktor je Projektumgebung (2.52).
 *
 * Zwei Ebenen, bewusst getrennt: die reine Entscheidung (sie hat keine
 * Datenbank und keinen Zufall, also wird sie fuer jede Lage einzeln
 * geprueft) und der Dienst, der sie an den drei Stellen anwendet, an denen
 * eine Sitzung brauchbar wird. Die PostgreSQL-Seite deckt der Fall "(2.52)"
 * in postgres.integration ab.
 */
class FastHasher implements PasswordHasher {
  readonly dummyHash = "fast:dummy";
  async hash(password: string) { return `fast:${createHash("sha256").update(password).digest("hex")}`; }
  async verify(password: string, hash: string) { return hash === await this.hash(password); }
}

const scope = { organizationId: "org-1", projectId: "project-1", environment: "development" as const };
const PASSWORD = "a sufficiently long password";

function fixture() {
  const repository = new MemoryProjectAuthRepository();
  const audit = new MemoryProjectAuthAuditSink();
  const { privateKey } = generateKeyPairSync("ed25519");
  let now = new Date("2026-09-26T12:00:00.000Z");
  let id = 0;
  let token = 0;
  const service = new ProjectAuthService({
    repository, audit, passwords: new FastHasher(), rateLimiter: new InMemoryRateLimiter(),
    tokens: new ProjectAuthTokenService({ kid: "mfa-enforcement", privateKey }, "https://qkern.test"),
    mfa: new ProjectAuthTotp(), secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 9)),
    delivery: new NoopDevelopmentProjectAuthDelivery(), oidcCatalog: new ProjectAuthOidcCatalog([]),
    oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
    callbackBaseUrl: "https://qkern.test", allowedRedirectOrigins: new Set(["https://app.test"]),
    exposeDeliveryTokens: true, now: () => new Date(now),
    id: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    opaqueToken: (prefix) => `qk_${prefix}_${String(++token).padStart(43, "z")}`,
  });
  return { service, repository, audit, setNow: (value: string) => { now = new Date(value); } };
}

/** Registriert, bestaetigt die Adresse und liefert die daraus entstandene Sitzung. */
async function verifiedAccount(built: ReturnType<typeof fixture>, email: string) {
  const signup = await built.service.signUp(scope, {
    email, password: PASSWORD, redirectTo: "https://app.test/callback", rateLimitKey: `signup-${email}`,
  });
  const session = await built.service.consumeEmailToken(scope, {
    token: signup.debugToken!, purpose: "email_verification",
  });
  if ("mfaRequired" in session) throw new Error("unexpected MFA");
  return session;
}

/** Richtet einen TOTP-Faktor ein und bestaetigt ihn mit einem echten Code. */
async function enrolledFactor(
  built: ReturnType<typeof fixture>,
  principal: ProjectAuthEnrollmentPrincipal,
  at: Date,
) {
  const enrollment = await built.service.enrollMfa(principal);
  // Ein echter Code aus demselben Geheimnis: Der Test faelscht keine
  // Bestaetigung, sonst pruefte er den Faktor gar nicht.
  const code = totp(enrollment.secret, at);
  await built.service.confirmMfa(principal, code);
  return { enrollment, code };
}

/** TOTP wie RFC 6238, dieselbe Rechnung wie `ProjectAuthTotp`, nur nach aussen. */
function totp(secret: string, now: Date): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const decoded: number[] = [];
  for (const character of secret) {
    value = (value << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) { decoded.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now.getTime() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(decoded)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

describe("project auth MFA enforcement decision", () => {
  it("asks for a challenge whenever the user has a confirmed factor, switch or no switch", () => {
    const factor = { verifiedAt: new Date("2026-09-01T00:00:00.000Z") };
    expect(projectAuthMfaOutcome({ required: true, factor })).toBe("challenge");
    expect(projectAuthMfaOutcome({ required: false, factor })).toBe("challenge");
  });

  it("treats an enrolled but unconfirmed factor as no factor at all", () => {
    const factor = { verifiedAt: null };
    expect(projectAuthMfaOutcome({ required: true, factor })).toBe("enrollment_required");
    expect(projectAuthMfaOutcome({ required: false, factor })).toBe("session");
  });

  it("gives a session without a factor only while the switch is off", () => {
    expect(projectAuthMfaOutcome({ required: false, factor: null })).toBe("session");
    expect(projectAuthMfaOutcome({ required: true, factor: null })).toBe("enrollment_required");
  });

  it("calls an existing session usable only at aal2 once the switch is on", () => {
    expect(projectAuthSessionUsable({ required: false, assurance: "aal1" })).toBe(true);
    expect(projectAuthSessionUsable({ required: false, assurance: "aal2" })).toBe(true);
    expect(projectAuthSessionUsable({ required: true, assurance: "aal1" })).toBe(false);
    expect(projectAuthSessionUsable({ required: true, assurance: "aal2" })).toBe(true);
  });
});

describe("project auth MFA enforcement in the service", () => {
  it("reads and writes the switch, counts enrolment and records only the new state", async () => {
    const built = fixture();
    const initial = await built.service.readMfaPolicy(scope);
    expect(initial).toMatchObject({ required: false, updatedAt: null, users: 0, enrolled: 0, notEnrolled: 0 });
    expect(initial.factors).toEqual(["totp"]);

    const session = await verifiedAccount(built, "first@example.test");
    await verifiedAccount(built, "second@example.test");
    const principal = await built.service.verifyAccess(scope, session.accessToken);
    await enrolledFactor(built, principal, new Date("2026-09-26T12:00:00.000Z"));

    expect(await built.service.readMfaPolicy(scope)).toMatchObject({
      required: false, users: 2, enrolled: 1, notEnrolled: 1,
    });

    const changed = await built.service.setMfaRequired(scope, true, { id: "console-user-1" });
    expect(changed).toMatchObject({ required: true, users: 2, enrolled: 1, notEnrolled: 1 });
    expect(changed.updatedAt).toBe("2026-09-26T12:00:00.000Z");

    const page = await built.audit.list(scope, { limit: 20 });
    const entry = page.events.find((event) => event.action === "project_auth.mfa.enforcement_changed");
    expect(entry).toMatchObject({
      actorType: "admin", actorRef: "console-user-1", status: "succeeded",
      resourceRef: "project_auth_environment:development", metadata: { required: true },
    });
    // Kein Schluessel, keine Adresse, kein Token in der Kette.
    expect(JSON.stringify(entry)).not.toContain("@");
    expect(JSON.stringify(entry)).not.toMatch(/qk_/);
  });

  it("refuses a boolean that is not one", async () => {
    const built = fixture();
    await expect(built.service.setMfaRequired(scope, "true" as never))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("yields no session at all for a user without a factor and lets that user enrol", async () => {
    const built = fixture();
    const first = await verifiedAccount(built, "nofactor@example.test");
    const principal = await built.service.verifyAccess(scope, first.accessToken);
    await built.service.setMfaRequired(scope, true, { id: "console-user-1" });

    const login = await built.service.passwordSignIn(scope, {
      email: "nofactor@example.test", password: PASSWORD, rateLimitKey: "enforced-login",
    });
    if (!("enrollmentRequired" in login)) throw new Error("expected an enrolment grant");
    expect(login).toMatchObject({ mfaRequired: true, enrollmentRequired: true });
    expect(login.enrollmentToken).toMatch(/^qk_enroll_/);
    expect(login).not.toHaveProperty("accessToken");
    expect(login).not.toHaveProperty("refreshToken");
    // Keine Sitzung, nirgends: Die Admin-Liste sieht keine einzige aktive.
    expect((await built.service.listSessions(scope, principal.user.id)).sessions
      .filter((entry) => entry.assurance === "aal1" && entry.id !== principal.session.id)).toEqual([]);

    // Der Schein oeffnet die Einrichtung, und sonst nichts.
    const grant = await built.service.resolveMfaEnrollment(scope, login.enrollmentToken);
    expect(grant.user.id).toBe(principal.user.id);
    const { code } = await enrolledFactor(built, grant, new Date("2026-09-26T12:00:00.000Z"));
    expect(code).toMatch(/^\d{6}$/);
    // Verbraucht: derselbe Schein oeffnet nichts mehr.
    await expect(built.service.resolveMfaEnrollment(scope, login.enrollmentToken))
      .rejects.toMatchObject({ code: "INVALID_TOKEN" });

    // Und jetzt endet die Anmeldung mit einer Challenge statt mit einem Schein.
    const second = await built.service.passwordSignIn(scope, {
      email: "nofactor@example.test", password: PASSWORD, rateLimitKey: "enforced-login-2",
    });
    expect(second).toMatchObject({ mfaRequired: true });
    expect(second).toHaveProperty("challengeToken");
  });

  it("stops an aal1 session that existed before the switch, at the access token and at the refresh", async () => {
    const built = fixture();
    const session = await verifiedAccount(built, "before@example.test");
    // Vor dem Einschalten: brauchbar.
    expect((await built.service.verifyAccess(scope, session.accessToken)).claims.aal).toBe("aal1");

    await built.service.setMfaRequired(scope, true, { id: "console-user-1" });

    await expect(built.service.verifyAccess(scope, session.accessToken))
      .rejects.toMatchObject({ code: "MFA_REQUIRED" });
    await expect(built.service.refresh(scope, session.refreshToken))
      .rejects.toMatchObject({ code: "MFA_REQUIRED" });
    // Die Familie ist widerrufen, nicht bloss abgelehnt: Auch das Ausschalten
    // holt sie nicht zurueck. Das erneute Vorzeigen gilt jetzt als Wiedergabe.
    await built.service.setMfaRequired(scope, false, { id: "console-user-1" });
    await expect(built.service.refresh(scope, session.refreshToken))
      .rejects.toMatchObject({ code: "TOKEN_REPLAYED" });
    await expect(built.service.verifyAccess(scope, session.accessToken))
      .rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("keeps an aal2 session usable and never refuses anything while the switch is off", async () => {
    const built = fixture();
    const first = await verifiedAccount(built, "withfactor@example.test");
    const principal = await built.service.verifyAccess(scope, first.accessToken);
    await enrolledFactor(built, principal, new Date("2026-09-26T12:00:00.000Z"));
    await built.service.setMfaRequired(scope, true, { id: "console-user-1" });

    const login = await built.service.passwordSignIn(scope, {
      email: "withfactor@example.test", password: PASSWORD, rateLimitKey: "aal2-login",
    });
    if (!("challengeToken" in login)) throw new Error("expected a challenge");
    const factor = await built.repository.getMfaFactor(scope, principal.user.id);
    const secret = new ProjectAuthSecretProtector(Buffer.alloc(32, 9)).decrypt(factor!.encryptedSecret);
    const code = totp(secret, new Date("2026-09-26T12:00:00.000Z"));
    const aal2 = await built.service.verifyMfaChallenge(scope, {
      challengeToken: login.challengeToken, code, rateLimitKey: "aal2-code",
    });
    expect((await built.service.verifyAccess(scope, aal2.accessToken)).claims.aal).toBe("aal2");
    const rotated = await built.service.refresh(scope, aal2.refreshToken);
    expect((await built.service.verifyAccess(scope, rotated.accessToken)).claims.aal).toBe("aal2");
  });

  it("refuses an enrolment grant that is foreign, expired, replayed or pointless", async () => {
    const built = fixture();
    await verifiedAccount(built, "grant@example.test");
    await built.service.setMfaRequired(scope, true, { id: "console-user-1" });
    const login = await built.service.passwordSignIn(scope, {
      email: "grant@example.test", password: PASSWORD, rateLimitKey: "grant-login",
    });
    if (!("enrollmentRequired" in login)) throw new Error("expected an enrolment grant");

    // Falsche Form, fremder Scope, abgelaufen.
    await expect(built.service.resolveMfaEnrollment(scope, "qk_refresh_" + "a".repeat(43)))
      .rejects.toMatchObject({ code: "INVALID_TOKEN" });
    await expect(built.service.resolveMfaEnrollment(
      { ...scope, projectId: "project-2" }, login.enrollmentToken,
    )).rejects.toMatchObject({ code: "INVALID_TOKEN" });

    built.setNow("2026-09-26T12:16:00.000Z");
    await expect(built.service.resolveMfaEnrollment(scope, login.enrollmentToken))
      .rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("stores the grant only as a verifier and hands out no session material with it", async () => {
    const built = fixture();
    await verifiedAccount(built, "verifier@example.test");
    await built.service.setMfaRequired(scope, true, { id: "console-user-1" });
    const login = await built.service.passwordSignIn(scope, {
      email: "verifier@example.test", password: PASSWORD, rateLimitKey: "verifier-login",
    });
    if (!("enrollmentRequired" in login)) throw new Error("expected an enrolment grant");
    const stored = await built.repository.findActiveOneTimeToken(
      scope, hashProjectAuthToken(login.enrollmentToken), "mfa_enrollment", new Date("2026-09-26T12:00:00.000Z"),
    );
    expect(stored?.tokenHash).toBe(hashProjectAuthToken(login.enrollmentToken));
    expect(stored?.tokenHash).not.toBe(login.enrollmentToken);
    expect(JSON.stringify(stored)).not.toContain(login.enrollmentToken);
  });
});
