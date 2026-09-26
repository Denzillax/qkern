import { recognisedByName } from "@/lib/server/errors/identity";
import { randomBytes, randomUUID } from "node:crypto";
import type { PasswordHasher } from "@/lib/server/auth/password";
import type { RateLimiter } from "@/lib/server/auth/rate-limit";
import type {
  ProjectAuthAssurance,
  ProjectAuthOidcIdentity,
  ProjectAuthOneTimePurpose,
  ProjectAuthScope,
  ProjectAuthSession,
  ProjectAuthSessionSummary,
  ProjectAuthUser,
  ProjectAuthUserStatus,
  PublicProjectAuthUser,
} from "@/lib/server/project-auth/model";
import { publicProjectAuthUser } from "@/lib/server/project-auth/model";
import {
  projectAuthUserRef,
  type ProjectAuthAuditEvent,
  type ProjectAuthAuditPage,
  type ProjectAuthAuditSink,
} from "@/lib/server/project-auth/audit";
import {
  buildProjectAuthAuditSeries,
  isProjectAuthSeriesBucket,
  projectAuthSeriesRowLimit,
  projectAuthSeriesWindow,
  type PublicProjectAuthAuditSeries,
} from "@/lib/server/project-auth/audit-series";
import { ProjectAuthSecretProtector, ProjectAuthTotp } from "@/lib/server/project-auth/mfa";
import {
  projectAuthMfaOutcome,
  projectAuthSessionUsable,
} from "@/lib/server/project-auth/mfa-enforcement";
import {
  ProjectAuthOidcCatalog,
  ProjectAuthOidcClient,
  ProjectAuthOidcError,
} from "@/lib/server/project-auth/oidc";
import {
  DuplicateProjectAuthIdentityError,
  type ProjectAuthRepository,
} from "@/lib/server/project-auth/repository";
import {
  hashProjectAuthToken,
  ProjectAuthTokenError,
  ProjectAuthTokenService,
  type ProjectAuthAccessClaims,
} from "@/lib/server/project-auth/tokens";

const REFRESH_TOKEN = /^qk_refresh_[A-Za-z0-9_-]{43}$/;
const CHALLENGE_TOKEN = /^qk_challenge_[A-Za-z0-9_-]{43}$/;
const ENROLLMENT_TOKEN = /^qk_enroll_[A-Za-z0-9_-]{43}$/;
const ONE_TIME_TOKEN = /^qk_(verify|magic|reset)_[A-Za-z0-9_-]{43}$/;
const OIDC_STATE_TOKEN = /^qk_oidc_[A-Za-z0-9_-]{43}$/;
const PASSWORD_RATE = { limit: 10, windowMs: 15 * 60 * 1_000 };
const EMAIL_RATE = { limit: 5, windowMs: 60 * 60 * 1_000 };
const MFA_RATE = { limit: 8, windowMs: 15 * 60 * 1_000 };
const AUDIT_CURSOR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProjectAuthDeliveryPurpose = "email_verification" | "magic_link" | "password_reset";
export type ProjectAuthDelivery = {
  scope: ProjectAuthScope;
  email: string;
  purpose: ProjectAuthDeliveryPurpose;
  token: string;
  redirectTo: string;
  expiresAt: Date;
};

export interface ProjectAuthDeliveryPort {
  deliver(message: ProjectAuthDelivery): Promise<void>;
}

export class DisabledProjectAuthDelivery implements ProjectAuthDeliveryPort {
  async deliver(): Promise<void> {
    throw new ProjectAuthError("DELIVERY_UNAVAILABLE");
  }
}

export class NoopDevelopmentProjectAuthDelivery implements ProjectAuthDeliveryPort {
  async deliver(): Promise<void> {}
}

export type ProjectAuthSessionResult = {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  tokenType: "Bearer";
  user: PublicProjectAuthUser;
};

export type ProjectAuthMfaRequired = {
  mfaRequired: true;
  challengeToken: string;
  expiresAt: string;
};

/**
 * Die Antwort auf eine Anmeldung, die stimmt, aber keine Sitzung ergeben
 * darf (2.52): Die Umgebung verlangt den zweiten Faktor, und dieser Nutzer
 * hat noch keinen bestaetigten.
 *
 * `mfaRequired` steht hier absichtlich auch: Beide Antworten sagen dasselbe
 * — ohne zweiten Faktor gibt es keine Sitzung. Der Unterschied ist, was der
 * Nutzer als Naechstes tun kann. Mit `challengeToken` bestaetigt er einen
 * Faktor, den er schon hat; mit `enrollmentToken` richtet er erst einen ein.
 * Der Einrichtungsschein oeffnet nur `auth/mfa/enroll`, sonst nichts.
 */
export type ProjectAuthMfaEnrollmentRequired = {
  mfaRequired: true;
  enrollmentRequired: true;
  enrollmentToken: string;
  expiresAt: string;
};

export type VerifiedProjectAuthPrincipal = {
  scope: ProjectAuthScope;
  user: ProjectAuthUser;
  session: ProjectAuthSession;
  claims: ProjectAuthAccessClaims;
};

/**
 * Wer mit einem Einrichtungsschein statt mit einer Sitzung kommt. Dieselben
 * zwei Felder, die `enrollMfa` und `confirmMfa` wirklich brauchen, plus der
 * Verifier des Scheins, damit das gelungene Bestaetigen ihn verbraucht.
 * `VerifiedProjectAuthPrincipal` passt ohne Weiteres darauf.
 */
export type ProjectAuthEnrollmentPrincipal = {
  scope: ProjectAuthScope;
  user: ProjectAuthUser;
  enrollmentGrantHash?: string;
};

/** Was die Console ueber den zweiten Faktor einer Umgebung sieht (2.52). */
export type PublicProjectAuthMfaPolicy = {
  required: boolean;
  updatedAt: string | null;
  users: number;
  enrolled: number;
  notEnrolled: number;
  factors: readonly ["totp"];
};

/** Wer in der Console handelt: die ID des Console-Nutzers, nie seine E-Mail. */
export type ProjectAuthAdminActor = { id: string };

type ProjectAuthSignInMethod = "password" | "magic_link" | "email_verification" | "oidc";

export type ProjectAuthAdminContext = {
  organizationId: string;
  actor: { id: string; ref: string };
};

export type ProjectAuthErrorCode =
  | "PROJECT_AUTH_DISABLED"
  | "INVALID_INPUT"
  | "ACCOUNT_EXISTS"
  | "INVALID_CREDENTIALS"
  | "EMAIL_NOT_VERIFIED"
  | "INVALID_TOKEN"
  | "TOKEN_REPLAYED"
  | "MFA_REQUIRED"
  | "INVALID_MFA"
  | "RATE_LIMITED"
  | "DELIVERY_UNAVAILABLE"
  | "RESOURCE_NOT_FOUND"
  | "AUDIT_UNAVAILABLE";

export class ProjectAuthError extends Error {
  /**
   * `cause` stays internal. Routes and MCP serialise `code` only, and the route
   * contract tests assert that no cause reaches a client.
   */
  constructor(
    readonly code: ProjectAuthErrorCode,
    readonly retryAfterSeconds?: number,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = "ProjectAuthError";
  }
}
recognisedByName(ProjectAuthError, "ProjectAuthError");

export type ProjectAuthServiceDependencies = {
  repository: ProjectAuthRepository;
  passwords: PasswordHasher;
  rateLimiter: RateLimiter;
  tokens: ProjectAuthTokenService;
  mfa: ProjectAuthTotp;
  secrets: ProjectAuthSecretProtector;
  delivery: ProjectAuthDeliveryPort;
  oidcCatalog: ProjectAuthOidcCatalog;
  oidcClient: ProjectAuthOidcClient;
  /** Optional: ohne Sink schreibt der Dienst keine Audit-Ereignisse. */
  audit?: ProjectAuthAuditSink;
  callbackBaseUrl: string;
  allowedRedirectOrigins: ReadonlySet<string>;
  exposeDeliveryTokens?: boolean;
  now?: () => Date;
  id?: () => string;
  opaqueToken?: (prefix: string) => string;
  refreshTtlMs?: number;
};

export class ProjectAuthService {
  private readonly now: () => Date;
  private readonly id: () => string;
  private readonly opaqueToken: (prefix: string) => string;
  private readonly refreshTtlMs: number;

  constructor(private readonly dependencies: ProjectAuthServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.id = dependencies.id ?? (() => randomUUID());
    this.opaqueToken = dependencies.opaqueToken ?? ((prefix) => `qk_${prefix}_${randomBytes(32).toString("base64url")}`);
    this.refreshTtlMs = dependencies.refreshTtlMs ?? 30 * 24 * 60 * 60 * 1_000;
    if (this.refreshTtlMs < 60 * 60 * 1_000 || this.refreshTtlMs > 90 * 24 * 60 * 60 * 1_000) {
      throw new ProjectAuthError("INVALID_INPUT");
    }
  }

  async signUp(scope: ProjectAuthScope, input: {
    email: string;
    password: string;
    userMetadata?: Record<string, unknown>;
    redirectTo: string;
    rateLimitKey: string;
  }): Promise<{ accepted: true; debugToken?: string }> {
    const now = this.now();
    await this.assertRateLimit(`project-signup:${scopeKey(scope)}:${input.rateLimitKey}`, EMAIL_RATE, now);
    assertScope(scope);
    const email = canonicalEmail(input.email);
    assertEmail(email);
    assertPassword(input.password);
    const redirectTo = this.redirect(input.redirectTo);
    if (await this.dependencies.repository.findUserByEmail(scope, email)) {
      throw new ProjectAuthError("ACCOUNT_EXISTS");
    }
    const metadata = boundedMetadata(input.userMetadata ?? {});
    const user: ProjectAuthUser = {
      ...scope, id: this.id(), email,
      passwordHash: await this.dependencies.passwords.hash(input.password),
      status: "active", emailVerifiedAt: null, userMetadata: metadata, appMetadata: {},
      createdAt: now, updatedAt: now,
    };
    try {
      await this.dependencies.repository.createUser(user);
    } catch (error) {
      if (error instanceof DuplicateProjectAuthIdentityError) throw new ProjectAuthError("ACCOUNT_EXISTS");
      throw error;
    }
    await this.recordAudit(this.userEvent(scope, "project_auth.signup.succeeded", user.id, "succeeded", { method: "password" }));
    const token = await this.issueDeliveryToken(scope, user, "email_verification", redirectTo, 30 * 60 * 1_000);
    return { accepted: true, ...(this.dependencies.exposeDeliveryTokens ? { debugToken: token } : {}) };
  }

  async requestMagicLink(scope: ProjectAuthScope, input: {
    email: string;
    redirectTo: string;
    createUser?: boolean;
    rateLimitKey: string;
  }): Promise<{ accepted: true; debugToken?: string }> {
    const now = this.now();
    await this.assertRateLimit(`project-magic:${scopeKey(scope)}:${input.rateLimitKey}`, EMAIL_RATE, now);
    assertScope(scope);
    const email = canonicalEmail(input.email);
    assertEmail(email);
    const redirectTo = this.redirect(input.redirectTo);
    let user = await this.dependencies.repository.findUserByEmail(scope, email);
    if (!user && input.createUser) {
      user = await this.dependencies.repository.createUser({
        ...scope, id: this.id(), email, passwordHash: null, status: "active",
        emailVerifiedAt: null, userMetadata: {}, appMetadata: {}, createdAt: now, updatedAt: now,
      }).catch((error) => {
        if (error instanceof DuplicateProjectAuthIdentityError) return null;
        throw error;
      });
      if (user) {
        await this.recordAudit(this.userEvent(scope, "project_auth.signup.succeeded", user.id, "succeeded", { method: "magic_link" }));
      }
      user ??= await this.dependencies.repository.findUserByEmail(scope, email);
    }
    let token: string | undefined;
    if (user?.status === "active") {
      token = await this.issueDeliveryToken(scope, user, "magic_link", redirectTo, 15 * 60 * 1_000);
    }
    return { accepted: true, ...(token && this.dependencies.exposeDeliveryTokens ? { debugToken: token } : {}) };
  }

  async requestPasswordReset(scope: ProjectAuthScope, input: {
    email: string;
    redirectTo: string;
    rateLimitKey: string;
  }): Promise<{ accepted: true; debugToken?: string }> {
    const now = this.now();
    await this.assertRateLimit(`project-reset:${scopeKey(scope)}:${input.rateLimitKey}`, EMAIL_RATE, now);
    assertScope(scope);
    const email = canonicalEmail(input.email);
    assertEmail(email);
    const redirectTo = this.redirect(input.redirectTo);
    const user = await this.dependencies.repository.findUserByEmail(scope, email);
    let token: string | undefined;
    if (user?.status === "active") {
      token = await this.issueDeliveryToken(scope, user, "password_reset", redirectTo, 15 * 60 * 1_000);
    }
    return { accepted: true, ...(token && this.dependencies.exposeDeliveryTokens ? { debugToken: token } : {}) };
  }

  async resetPassword(scope: ProjectAuthScope, input: { token: string; password: string }): Promise<{ reset: true }> {
    assertScope(scope);
    assertPassword(input.password);
    if (!ONE_TIME_TOKEN.test(input.token) || !input.token.startsWith("qk_reset_")) {
      throw new ProjectAuthError("INVALID_TOKEN");
    }
    const now = this.now();
    const consumed = await this.dependencies.repository.consumeOneTimeToken(
      scope, hashProjectAuthToken(input.token), "password_reset", now,
    );
    if (!consumed?.userId) throw new ProjectAuthError("INVALID_TOKEN");
    const updated = await this.dependencies.repository.updateUser(scope, consumed.userId, {
      passwordHash: await this.dependencies.passwords.hash(input.password), updatedAt: now,
    });
    if (!updated) throw new ProjectAuthError("INVALID_TOKEN");
    await this.dependencies.repository.revokeAllUserSessions(scope, updated.id, now);
    return { reset: true };
  }

  async consumeEmailToken(scope: ProjectAuthScope, input: {
    token: string;
    purpose: "email_verification" | "magic_link";
  }): Promise<ProjectAuthSessionResult | ProjectAuthMfaRequired | ProjectAuthMfaEnrollmentRequired> {
    assertScope(scope);
    const prefix = input.purpose === "email_verification" ? "qk_verify_" : "qk_magic_";
    if (!ONE_TIME_TOKEN.test(input.token) || !input.token.startsWith(prefix)) {
      throw new ProjectAuthError("INVALID_TOKEN");
    }
    const now = this.now();
    const consumed = await this.dependencies.repository.consumeOneTimeToken(
      scope, hashProjectAuthToken(input.token), input.purpose, now,
    );
    if (!consumed?.userId) throw new ProjectAuthError("INVALID_TOKEN");
    let user = await this.dependencies.repository.findUserById(scope, consumed.userId);
    if (!user || user.status !== "active") throw new ProjectAuthError("INVALID_TOKEN");
    if (!user.emailVerifiedAt) {
      user = await this.dependencies.repository.updateUser(scope, user.id, {
        emailVerifiedAt: now, updatedAt: now,
      });
      if (!user) throw new ProjectAuthError("INVALID_TOKEN");
    }
    return this.beginAuthenticatedSession(scope, user, now, input.purpose);
  }

  async passwordSignIn(scope: ProjectAuthScope, input: {
    email: string;
    password: string;
    rateLimitKey: string;
  }): Promise<ProjectAuthSessionResult | ProjectAuthMfaRequired | ProjectAuthMfaEnrollmentRequired> {
    const now = this.now();
    await this.assertRateLimit(`project-password:${scopeKey(scope)}:${input.rateLimitKey}`, PASSWORD_RATE, now);
    assertScope(scope);
    const user = await this.dependencies.repository.findUserByEmail(scope, canonicalEmail(input.email));
    const valid = await this.dependencies.passwords.verify(
      input.password, user?.passwordHash ?? this.dependencies.passwords.dummyHash,
    );
    if (!user || !user.passwordHash || !valid || user.status !== "active") {
      // Eine unbekannte E-Mail erscheint als "anonymous", nie im Klartext.
      // Ein bekannter Nutzer erscheint mit seiner ID; das Audit liest nur die
      // Admin-Grenze, dort ist die ID ohnehin sichtbar.
      const reason = user && valid && user.passwordHash && user.status !== "active" ? "user_disabled" : "invalid_credentials";
      await this.recordAudit(user
        ? this.userEvent(scope, "project_auth.login.failed", user.id, "failed", { method: "password", reason })
        : {
          scope, action: "project_auth.login.failed", actorType: "app_user", actorRef: "anonymous",
          resourceRef: "project_auth_user:unknown", status: "failed", metadata: { method: "password", reason },
        });
      throw new ProjectAuthError("INVALID_CREDENTIALS");
    }
    if (!user.emailVerifiedAt) {
      await this.recordAudit(this.userEvent(scope, "project_auth.login.failed", user.id, "failed", {
        method: "password", reason: "email_not_verified",
      }));
      throw new ProjectAuthError("EMAIL_NOT_VERIFIED");
    }
    return this.beginAuthenticatedSession(scope, user, now, "password");
  }

  async refresh(scope: ProjectAuthScope, refreshToken: string): Promise<ProjectAuthSessionResult> {
    assertScope(scope);
    if (!REFRESH_TOKEN.test(refreshToken)) throw new ProjectAuthError("INVALID_TOKEN");
    const now = this.now();
    const current = await this.dependencies.repository.findSessionByRefreshHash(
      scope, hashProjectAuthToken(refreshToken),
    );
    if (!current) throw new ProjectAuthError("INVALID_TOKEN");
    const user = await this.dependencies.repository.findUserById(scope, current.userId);
    if (!user || user.status !== "active") {
      await this.dependencies.repository.revokeSessionFamily(scope, current.familyId, now, false);
      throw new ProjectAuthError("INVALID_TOKEN");
    }
    // Der zweite Ort, an dem eine Sitzung brauchbar wird (2.52). Beim
    // Einschalten des Schalters leben die bestehenden aal1-Sitzungen sonst
    // bis zum Ablauf ihres Refresh Tokens weiter, und der steht auf 30 Tagen.
    // Die Familie wird widerrufen und nicht bloss abgelehnt: Ein Refresh
    // Token, das nie wieder gelten darf, gehoert nicht in die Datenbank.
    if (!projectAuthSessionUsable({ required: await this.mfaRequired(scope), assurance: current.assurance })) {
      await this.dependencies.repository.revokeSessionFamily(scope, current.familyId, now, false);
      throw new ProjectAuthError("MFA_REQUIRED");
    }
    const nextToken = this.opaqueToken("refresh");
    if (!REFRESH_TOKEN.test(nextToken)) throw new ProjectAuthError("INVALID_INPUT");
    const next = this.session(scope, user.id, current.assurance, now, nextToken, current.familyId);
    const rotation = await this.dependencies.repository.rotateSession(scope, current.id, next, now);
    if (rotation === "replayed") throw new ProjectAuthError("TOKEN_REPLAYED");
    if (rotation !== "rotated") throw new ProjectAuthError("INVALID_TOKEN");
    return this.sessionResult(scope, user, next, nextToken, now);
  }

  async verifyAccess(scope: ProjectAuthScope, accessToken: string): Promise<VerifiedProjectAuthPrincipal> {
    assertScope(scope);
    let claims: ProjectAuthAccessClaims;
    try { claims = this.dependencies.tokens.verify(accessToken, scope, this.now()); }
    catch (error) {
      if (error instanceof ProjectAuthTokenError) throw new ProjectAuthError("INVALID_TOKEN");
      throw error;
    }
    const now = this.now();
    const session = await this.dependencies.repository.findActiveSessionById(scope, claims.session_id, now);
    const user = await this.dependencies.repository.findUserById(scope, claims.sub);
    if (!session || !user || user.status !== "active" || session.userId !== user.id ||
        session.assurance !== claims.aal || user.email !== claims.email) {
      throw new ProjectAuthError("INVALID_TOKEN");
    }
    // Die eigentliche Tuer (2.52): Hier kommt jede Nutzung eines Access
    // Tokens vorbei — Data API, Realtime, `auth/user`, `auth/mfa/enroll`.
    // Wird der Faktor verlangt, oeffnet nur `aal2`. Damit schliesst sich
    // auch das Restfenster von bis zu 15 Minuten, in dem ein vor dem
    // Einschalten ausgegebenes aal1-Token sonst noch gaelte. Der Preis ist
    // ein kleiner Lesezugriff je Anfrage, auf den Primaerschluessel.
    if (!projectAuthSessionUsable({ required: await this.mfaRequired(scope), assurance: session.assurance })) {
      throw new ProjectAuthError("MFA_REQUIRED");
    }
    return { scope, user, session, claims };
  }

  async logout(scope: ProjectAuthScope, refreshToken: string): Promise<void> {
    assertScope(scope);
    if (!REFRESH_TOKEN.test(refreshToken)) return;
    const session = await this.dependencies.repository.findSessionByRefreshHash(scope, hashProjectAuthToken(refreshToken));
    if (!session) return;
    await this.dependencies.repository.revokeSessionFamily(scope, session.familyId, this.now(), false);
    await this.recordAudit(this.userEvent(scope, "project_auth.logout", session.userId, "succeeded", { family: session.familyId }));
  }

  async enrollMfa(principal: ProjectAuthEnrollmentPrincipal): Promise<{
    factorId: string;
    secret: string;
    uri: string;
    recoveryCodes: string[];
  }> {
    const now = this.now();
    const enrollment = this.dependencies.mfa.createEnrollment({
      issuer: `QKERN ${principal.scope.projectId}`, account: principal.user.email,
    });
    const factorId = this.id();
    await this.dependencies.repository.upsertMfaFactor({
      ...principal.scope, id: factorId, userId: principal.user.id,
      encryptedSecret: this.dependencies.secrets.encrypt(enrollment.secret),
      recoveryCodeHashes: enrollment.recoveryCodes.map((code) => this.dependencies.secrets.recoveryHash(code)),
      createdAt: now, verifiedAt: null,
    });
    return { factorId, ...enrollment };
  }

  async confirmMfa(principal: ProjectAuthEnrollmentPrincipal, code: string): Promise<{ verified: true }> {
    const factor = await this.dependencies.repository.getMfaFactor(principal.scope, principal.user.id);
    if (!factor || factor.verifiedAt || !this.dependencies.mfa.verify(
      this.dependencies.secrets.decrypt(factor.encryptedSecret), code, this.now(),
    )) throw new ProjectAuthError("INVALID_MFA");
    await this.dependencies.repository.upsertMfaFactor({ ...factor, verifiedAt: this.now() });
    // Der Einrichtungsschein hat seinen Zweck erfuellt und wird verbraucht.
    // Ab jetzt fuehrt der Weg wieder ueber eine richtige Anmeldung, die nun
    // mit einer Challenge endet und eine aal2-Sitzung ergibt.
    if (principal.enrollmentGrantHash) {
      await this.dependencies.repository.consumeOneTimeToken(
        principal.scope, principal.enrollmentGrantHash, "mfa_enrollment", this.now(),
      );
    }
    await this.recordAudit(this.userEvent(principal.scope, "project_auth.mfa.enrolled", principal.user.id, "succeeded", { factor: "totp" }));
    return { verified: true };
  }

  /**
   * Loest einen Einrichtungsschein auf, ohne ihn zu verbrauchen (2.52).
   *
   * Der Schein oeffnet genau zwei Aufrufe: Geheimnis holen und Code
   * bestaetigen. Er traegt weder Rolle noch Ablaufzeit eines Access Tokens
   * und laesst sich nirgends sonst vorzeigen; `presentedProjectAccessToken`
   * lehnt jedes `qk_`-Token als Bearer ab, und keine andere Route kennt
   * diesen Weg.
   *
   * Wer schon einen bestaetigten Faktor hat, bekommt hier nichts: Sein
   * Schein waere ein zweiter Weg an der Challenge vorbei.
   */
  async resolveMfaEnrollment(scope: ProjectAuthScope, token: string): Promise<ProjectAuthEnrollmentPrincipal> {
    assertScope(scope);
    if (!ENROLLMENT_TOKEN.test(token)) throw new ProjectAuthError("INVALID_TOKEN");
    const tokenHash = hashProjectAuthToken(token);
    const grant = await this.dependencies.repository.findActiveOneTimeToken(
      scope, tokenHash, "mfa_enrollment", this.now(),
    );
    if (!grant?.userId) throw new ProjectAuthError("INVALID_TOKEN");
    const user = await this.dependencies.repository.findUserById(scope, grant.userId);
    if (!user || user.status !== "active") throw new ProjectAuthError("INVALID_TOKEN");
    const factor = await this.dependencies.repository.getMfaFactor(scope, user.id);
    if (factor?.verifiedAt) throw new ProjectAuthError("INVALID_TOKEN");
    return { scope, user, enrollmentGrantHash: tokenHash };
  }

  /**
   * Was die Console ueber den zweiten Faktor dieser Umgebung sieht (2.52):
   * der Schalter, wann er zuletzt bewegt wurde, und wie viele App-Nutzer
   * einen bestaetigten Faktor haben. `notEnrolled` ist die Differenz und
   * damit genau die Zahl der Nutzer, die beim Einschalten zuerst durch die
   * Einrichtung muessen.
   *
   * `factors` nennt, was es heute gibt, und das ist einer: TOTP. WebAuthn
   * und Passkeys stehen nicht darin, weil sie nicht existieren.
   */
  async readMfaPolicy(scope: ProjectAuthScope): Promise<PublicProjectAuthMfaPolicy> {
    assertScope(scope);
    const settings = await this.dependencies.repository.readSettings(scope);
    const counts = await this.dependencies.repository.countMfaEnrolment(scope);
    return mfaPolicy(settings?.mfaRequired ?? false, settings?.updatedAt ?? null, counts);
  }

  /**
   * Bewegt den Schalter. Jede Aenderung schreibt einen Audit-Eintrag; darin
   * steht die Handlung und der neue Zustand, sonst nichts — der Sanitizer
   * laesst Adressen und Schluessel ohnehin nicht durch, und es gaebe hier
   * auch keine.
   */
  async setMfaRequired(
    scope: ProjectAuthScope,
    required: boolean,
    admin?: ProjectAuthAdminActor,
  ): Promise<PublicProjectAuthMfaPolicy> {
    assertScope(scope);
    if (typeof required !== "boolean") throw new ProjectAuthError("INVALID_INPUT");
    const settings = await this.dependencies.repository.writeMfaRequired(scope, required, this.now());
    await this.recordAudit({
      scope, action: "project_auth.mfa.enforcement_changed",
      actorType: admin ? "admin" : "system", actorRef: admin ? admin.id : "system",
      resourceRef: `project_auth_environment:${scope.environment}`,
      status: "succeeded", metadata: { required },
    });
    const counts = await this.dependencies.repository.countMfaEnrolment(scope);
    return mfaPolicy(settings.mfaRequired, settings.updatedAt, counts);
  }

  async verifyMfaChallenge(scope: ProjectAuthScope, input: {
    challengeToken: string;
    code: string;
    rateLimitKey: string;
  }): Promise<ProjectAuthSessionResult> {
    const now = this.now();
    await this.assertRateLimit(`project-mfa:${scopeKey(scope)}:${input.rateLimitKey}`, MFA_RATE, now);
    assertScope(scope);
    if (!CHALLENGE_TOKEN.test(input.challengeToken)) throw new ProjectAuthError("INVALID_MFA");
    const challenge = await this.dependencies.repository.consumeOneTimeToken(
      scope, hashProjectAuthToken(input.challengeToken), "mfa_challenge", now,
    );
    if (!challenge?.userId) throw new ProjectAuthError("INVALID_MFA");
    const user = await this.dependencies.repository.findUserById(scope, challenge.userId);
    const factor = await this.dependencies.repository.getMfaFactor(scope, challenge.userId);
    if (!user || user.status !== "active" || !factor?.verifiedAt) throw new ProjectAuthError("INVALID_MFA");
    const validTotp = this.dependencies.mfa.verify(
      this.dependencies.secrets.decrypt(factor.encryptedSecret), input.code, now,
    );
    const validRecovery = validTotp ? false : await this.dependencies.repository.consumeRecoveryCode(
      scope, user.id, this.dependencies.secrets.recoveryHash(input.code),
    );
    if (!validTotp && !validRecovery) {
      await this.recordAudit(this.userEvent(scope, "project_auth.login.failed", user.id, "failed", {
        method: "mfa", reason: "invalid_mfa",
      }));
      throw new ProjectAuthError("INVALID_MFA");
    }
    const result = await this.createSessionResult(scope, user, "aal2", now);
    // Die Anmeldung mit zweitem Faktor endet hier: ein Ereignis fuer den
    // Faktor, eines fuer die Anmeldung, damit ein Filter auf Anmeldungen
    // auch diese findet.
    const factorKind = validTotp ? "totp" : "recovery_code";
    await this.recordAudit(this.userEvent(scope, "project_auth.mfa.verified", user.id, "succeeded", { factor: factorKind }));
    await this.recordAudit(this.userEvent(scope, "project_auth.login.succeeded", user.id, "succeeded", {
      method: "mfa", factor: factorKind, assurance: "aal2",
    }));
    return result;
  }

  /**
   * Die konfigurierten OIDC-Provider — als Projektion, nie als Durchreichung.
   *
   * Der Katalog kannte `list()` seit 1.76; gerufen hat es bis 1.83 niemand —
   * weder Console noch App konnten die Auswahl aufzaehlen. Nach aussen gehen
   * genau zwei Felder: Slug und Issuer. Client-ID, Endpunkte und der Name der
   * Secret-Umgebungsvariablen bleiben drinnen.
   */
  listOidcProviders(): Array<{ id: string; issuer: string }> {
    return this.dependencies.oidcCatalog.list().flatMap((id) => {
      const provider = this.dependencies.oidcCatalog.get(id);
      return provider ? [{ id: provider.id, issuer: provider.issuer }] : [];
    });
  }

  async startOidc(scope: ProjectAuthScope, input: {
    provider: string;
    redirectTo: string;
    rateLimitKey: string;
  }): Promise<{ authorizationUrl: string; expiresAt: string }> {
    const now = this.now();
    await this.assertRateLimit(`project-oidc:${scopeKey(scope)}:${input.rateLimitKey}`, EMAIL_RATE, now);
    assertScope(scope);
    const provider = this.dependencies.oidcCatalog.get(input.provider);
    if (!provider) throw new ProjectAuthError("RESOURCE_NOT_FOUND");
    const redirectTo = this.redirect(input.redirectTo);
    const callbackUri = this.oidcCallbackUri(scope, provider.id);
    const state = this.opaqueToken("oidc");
    if (!OIDC_STATE_TOKEN.test(state)) throw new ProjectAuthError("INVALID_INPUT");
    const authorization = this.dependencies.oidcClient.createAuthorization(provider, { callbackUri, state });
    const flow = this.dependencies.secrets.encrypt(JSON.stringify({
      codeVerifier: authorization.codeVerifier,
      nonce: authorization.nonce,
      callbackUri,
      redirectTo,
    }));
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1_000);
    await this.dependencies.repository.createOneTimeToken({
      ...scope, id: this.id(), userId: null, purpose: "oidc_state",
      tokenHash: hashProjectAuthToken(state), metadata: { provider: provider.id, flow },
      createdAt: now, expiresAt, consumedAt: null,
    });
    return { authorizationUrl: authorization.url, expiresAt: expiresAt.toISOString() };
  }

  async completeOidc(scope: ProjectAuthScope, input: {
    provider: string;
    state: string;
    code: string;
  }): Promise<ProjectAuthSessionResult | ProjectAuthMfaRequired | ProjectAuthMfaEnrollmentRequired> {
    assertScope(scope);
    if (!OIDC_STATE_TOKEN.test(input.state)) throw new ProjectAuthError("INVALID_TOKEN");
    const provider = this.dependencies.oidcCatalog.get(input.provider);
    if (!provider) throw new ProjectAuthError("RESOURCE_NOT_FOUND");
    const now = this.now();
    const state = await this.dependencies.repository.consumeOneTimeToken(
      scope, hashProjectAuthToken(input.state), "oidc_state", now,
    );
    if (!state || state.metadata.provider !== provider.id || typeof state.metadata.flow !== "string") {
      throw new ProjectAuthError("INVALID_TOKEN");
    }
    const flow = this.parseOidcFlow(this.dependencies.secrets.decrypt(state.metadata.flow));
    let claims;
    try {
      claims = await this.dependencies.oidcClient.exchange(provider, {
        code: input.code, codeVerifier: flow.codeVerifier, nonce: flow.nonce, callbackUri: flow.callbackUri,
      });
    } catch (error) {
      if (error instanceof ProjectAuthOidcError) {
        await this.recordAudit({
          scope, action: "project_auth.login.failed", actorType: "app_user", actorRef: "anonymous",
          resourceRef: "project_auth_user:unknown", status: "failed",
          metadata: { method: "oidc", provider: provider.id, reason: "invalid_credentials" },
        });
        throw new ProjectAuthError("INVALID_CREDENTIALS");
      }
      throw error;
    }
    const email = canonicalEmail(claims.email);
    assertEmail(email);
    const identity = await this.dependencies.repository.findOidcIdentity(scope, provider.id, claims.subject);
    let user = identity ? await this.dependencies.repository.findUserById(scope, identity.userId) : null;
    if (!user) {
      user = await this.dependencies.repository.findUserByEmail(scope, email);
      if (!user) {
        user = await this.dependencies.repository.createUser({
          ...scope, id: this.id(), email, passwordHash: null, status: "active", emailVerifiedAt: now,
          userMetadata: claims.name ? { name: claims.name } : {},
          appMetadata: { providers: [provider.id] }, createdAt: now, updatedAt: now,
        });
        await this.recordAudit(this.userEvent(scope, "project_auth.signup.succeeded", user.id, "succeeded", {
          method: "oidc", provider: provider.id,
        }));
      } else if (!user.emailVerifiedAt) {
        user = await this.dependencies.repository.updateUser(scope, user.id, {
          emailVerifiedAt: now, updatedAt: now,
        });
      }
      if (!user) throw new ProjectAuthError("INVALID_CREDENTIALS");
      const oidcIdentity: ProjectAuthOidcIdentity = {
        ...scope, id: this.id(), userId: user.id, provider: provider.id, subject: claims.subject,
        createdAt: now, lastSignInAt: now,
      };
      try { await this.dependencies.repository.createOidcIdentity(oidcIdentity); }
      catch (error) {
        if (!(error instanceof DuplicateProjectAuthIdentityError)) throw error;
        const winner = await this.dependencies.repository.findOidcIdentity(scope, provider.id, claims.subject);
        if (!winner || winner.userId !== user.id) throw new ProjectAuthError("INVALID_CREDENTIALS");
      }
    }
    if (user.status !== "active") {
      await this.recordAudit(this.userEvent(scope, "project_auth.login.failed", user.id, "failed", {
        method: "oidc", provider: provider.id, reason: "user_disabled",
      }));
      throw new ProjectAuthError("INVALID_CREDENTIALS");
    }
    return this.beginAuthenticatedSession(scope, user, now, "oidc", provider.id);
  }

  async resolveOidcScope(input: {
    projectId: string;
    environment: ProjectAuthScope["environment"];
    state: string;
  }): Promise<ProjectAuthScope> {
    if (!input.projectId || input.projectId.length > 128 ||
        !["development", "staging", "production"].includes(input.environment) ||
        !OIDC_STATE_TOKEN.test(input.state)) throw new ProjectAuthError("INVALID_TOKEN");
    const scope = await this.dependencies.repository.findActiveOneTimeTokenScope(
      input.projectId, input.environment, hashProjectAuthToken(input.state), "oidc_state", this.now(),
    );
    if (!scope) throw new ProjectAuthError("INVALID_TOKEN");
    return scope;
  }

  jwks() { return this.dependencies.tokens.jwks(); }

  async listUsers(scope: ProjectAuthScope, limit = 50, cursor?: string): Promise<{
    users: PublicProjectAuthUser[];
    nextCursor: string | null;
  }> {
    assertScope(scope);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (cursor && cursor.length > 128)) {
      throw new ProjectAuthError("INVALID_INPUT");
    }
    const rows = await this.dependencies.repository.listUsers(scope, limit + 1, cursor);
    return {
      users: rows.slice(0, limit).map(publicProjectAuthUser),
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  }

  async updateUser(scope: ProjectAuthScope, userId: string, input: {
    status?: ProjectAuthUserStatus;
    appMetadata?: Record<string, unknown>;
  }, admin?: ProjectAuthAdminActor): Promise<PublicProjectAuthUser> {
    assertScope(scope);
    if (!userId || userId.length > 128 || (input.status === undefined && input.appMetadata === undefined) ||
        (input.status !== undefined && !["active", "disabled"].includes(input.status))) {
      throw new ProjectAuthError("INVALID_INPUT");
    }
    const now = this.now();
    const updated = await this.dependencies.repository.updateUser(scope, userId, {
      ...(input.status ? { status: input.status } : {}),
      ...(input.appMetadata ? { appMetadata: boundedMetadata(input.appMetadata) } : {}),
      updatedAt: now,
    });
    if (!updated) throw new ProjectAuthError("RESOURCE_NOT_FOUND");
    if (input.status === "disabled") await this.dependencies.repository.revokeAllUserSessions(scope, userId, now);
    // Nur was sich geaendert hat, nie der Inhalt von app_metadata: dort
    // koennen Anwendungen beliebige Claims ablegen.
    await this.recordAudit(this.adminEvent(scope, "project_auth.user.updated", userId, admin, {
      ...(input.status ? { status: input.status } : {}),
      ...(input.appMetadata ? { appMetadataChanged: true } : {}),
    }));
    return publicProjectAuthUser(updated);
  }

  /**
   * Aktive Sitzungen eines App-Nutzers fuer die Console (2.34). Ein Nutzer,
   * den es in diesem Scope nicht gibt, ist 404, auch wenn er in einem
   * anderen Projekt existiert.
   */
  async listSessions(scope: ProjectAuthScope, userId: string): Promise<{ sessions: ProjectAuthSessionSummary[] }> {
    assertScope(scope);
    assertAdminId(userId);
    const now = this.now();
    await this.requireUser(scope, userId);
    return { sessions: await this.dependencies.repository.listActiveSessions(scope, userId, now) };
  }

  /**
   * Beendet eine Sitzung. Widerrufen wird die ganze Refresh-Familie, nicht
   * nur die eine Zeile: jede Zeile einer Familie stammt aus derselben
   * Anmeldung, und nur so ist sicher, dass kein aelteres oder parallel
   * rotiertes Refresh Token dieser Anmeldung weiterlebt. Andere Familien
   * desselben Nutzers bleiben unberuehrt. `revoked` zaehlt die beendeten
   * aktiven Sitzungen; eine Familie hat davon hoechstens eine.
   */
  async revokeSession(
    scope: ProjectAuthScope,
    userId: string,
    sessionId: string,
    admin?: ProjectAuthAdminActor,
  ): Promise<{ revoked: number }> {
    assertScope(scope);
    assertAdminId(userId);
    assertAdminId(sessionId);
    const now = this.now();
    const session = await this.dependencies.repository.findActiveSessionById(scope, sessionId, now);
    // Eine Sitzung eines anderen Nutzers sieht aus wie eine, die es nicht
    // gibt: kein Unterschied zwischen fremd und unbekannt nach aussen.
    if (!session || session.userId !== userId) throw new ProjectAuthError("RESOURCE_NOT_FOUND");
    await this.dependencies.repository.revokeSessionFamily(scope, session.familyId, now, false);
    await this.recordAudit(this.adminEvent(scope, "project_auth.session.revoked", userId, admin, {
      family: session.familyId, revokedCount: 1,
    }));
    return { revoked: 1 };
  }

  /** Beendet alle Sitzungen eines Nutzers, ohne ihn zu deaktivieren. */
  async revokeAllSessions(scope: ProjectAuthScope, userId: string, admin?: ProjectAuthAdminActor): Promise<{ revoked: number }> {
    assertScope(scope);
    assertAdminId(userId);
    const now = this.now();
    await this.requireUser(scope, userId);
    const revoked = await this.dependencies.repository.revokeAllUserSessions(scope, userId, now);
    await this.recordAudit(this.adminEvent(scope, "project_auth.sessions.revoked_all", userId, admin, { revokedCount: revoked }));
    return { revoked };
  }

  /**
   * Der Auth-Auszug aus der Audit-Kette fuer die Console (2.35): nur
   * `project_auth.*` im exakten Scope, neueste zuerst. Ohne Sink gibt es
   * nichts zu lesen, und das ist ehrlich eine leere Liste.
   */
  async listAuditEvents(scope: ProjectAuthScope, limit = 50, cursor?: string): Promise<ProjectAuthAuditPage> {
    assertScope(scope);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (cursor !== undefined && !AUDIT_CURSOR.test(cursor))) {
      throw new ProjectAuthError("INVALID_INPUT");
    }
    if (!this.dependencies.audit) return { events: [], nextCursor: null };
    return this.dependencies.audit.list(scope, { limit, ...(cursor ? { cursor } : {}) });
  }

  /**
   * Die Zeitreihe des Auth-Audits (2.47): wie viele Handlungen je Abschnitt,
   * je Art, und wie viele davon gescheitert sind.
   *
   * Aggregiert wird in der Datenbank; die leeren Eimer entstehen im reinen
   * Teil (`audit-series`). Das Fenster kommt aus der Eimergroesse und nicht
   * aus dem Aufruf: 48 Stunden oder 90 Tage, endend mit dem laufenden und
   * darum noch unvollstaendigen Eimer.
   *
   * Ohne Audit-Sink, oder mit einem Sink, der nicht aggregieren kann, gibt
   * es keine Reihe, und der Aufrufer erfaehrt das. Eine leere Reihe hiesse
   * "es hat sich niemand angemeldet", und das waere gelogen.
   */
  async readAuditSeries(scope: ProjectAuthScope, input: { bucket?: string } = {}): Promise<PublicProjectAuthAuditSeries> {
    assertScope(scope);
    const bucket = input.bucket ?? "hour";
    if (!isProjectAuthSeriesBucket(bucket)) throw new ProjectAuthError("INVALID_INPUT");
    const read = this.dependencies.audit?.series?.bind(this.dependencies.audit);
    if (!read) throw new ProjectAuthError("AUDIT_UNAVAILABLE");
    // Einmal abgelesen und danach festgehalten: Faellt die Uhr zwischen
    // Abfrage und Aufbau ueber eine Eimergrenze, passten Fenster und Eimer
    // nicht mehr zusammen.
    const now = this.now();
    const window = projectAuthSeriesWindow(bucket, now);
    // Eine Zeile mehr, als das Fenster tragen kann: So faellt auf, wenn die
    // Aggregation je mehr Gruppen liefert, als hier gerechnet wurden.
    const records = await read(scope, {
      bucket, from: window.start, to: window.end, limit: projectAuthSeriesRowLimit(bucket) + 1,
    });
    return buildProjectAuthAuditSeries({ bucket, now, records });
  }

  /** Verlangt diese Umgebung den zweiten Faktor? Keine Zeile heisst nein. */
  private async mfaRequired(scope: ProjectAuthScope): Promise<boolean> {
    return (await this.dependencies.repository.readSettings(scope))?.mfaRequired ?? false;
  }

  private async requireUser(scope: ProjectAuthScope, userId: string): Promise<void> {
    const user = await this.dependencies.repository.findUserById(scope, userId);
    if (!user) throw new ProjectAuthError("RESOURCE_NOT_FOUND");
  }

  /**
   * Schreibt ein Audit-Ereignis, ohne den Auth-Fluss je zu brechen.
   *
   * Abwaegung: Faellt der Sink aus (Datenbank weg, Rechte fehlen), gelingt
   * die Anmeldung trotzdem, und es bleibt eine Luecke im Audit. Eine Luecke
   * ist besser als ein Ausfall aller Anmeldungen. Die Kette selbst bleibt
   * dabei intakt: Es wird schlicht nichts geschrieben, kein halber Eintrag.
   * Geloggt werden nur Aktion und Fehlerklasse, keine Daten des Ereignisses.
   */
  private async recordAudit(event: ProjectAuthAuditEvent): Promise<void> {
    const sink = this.dependencies.audit;
    if (!sink) return;
    try {
      await sink.record(event);
    } catch (error) {
      console.error("Project Auth audit event was not recorded", {
        action: event.action,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  private userEvent(
    scope: ProjectAuthScope,
    action: string,
    userId: string,
    status: ProjectAuthAuditEvent["status"],
    metadata: NonNullable<ProjectAuthAuditEvent["metadata"]>,
  ): ProjectAuthAuditEvent {
    return {
      scope, action, actorType: "app_user", actorRef: projectAuthUserRef(userId),
      resourceRef: projectAuthUserRef(userId), status, metadata,
    };
  }

  private adminEvent(
    scope: ProjectAuthScope,
    action: string,
    userId: string,
    admin: ProjectAuthAdminActor | undefined,
    metadata: NonNullable<ProjectAuthAuditEvent["metadata"]>,
  ): ProjectAuthAuditEvent {
    return {
      scope, action, actorType: admin ? "admin" : "system", actorRef: admin ? admin.id : "system",
      resourceRef: projectAuthUserRef(userId), status: "succeeded", metadata,
    };
  }

  private async beginAuthenticatedSession(
    scope: ProjectAuthScope,
    user: ProjectAuthUser,
    now: Date,
    method: ProjectAuthSignInMethod,
    provider?: string,
  ): Promise<ProjectAuthSessionResult | ProjectAuthMfaRequired | ProjectAuthMfaEnrollmentRequired> {
    const factor = await this.dependencies.repository.getMfaFactor(scope, user.id);
    // Der Schalter der Umgebung wird nur gelesen, wenn es ueberhaupt darauf
    // ankommt: Wer einen bestaetigten Faktor hat, bekommt so oder so eine
    // Challenge. Das spart den Lesezugriff auf dem haeufigsten Weg.
    const required = factor?.verifiedAt ? false : await this.mfaRequired(scope);
    const outcome = projectAuthMfaOutcome({ required, factor });
    if (outcome === "challenge") {
      const challengeToken = this.opaqueToken("challenge");
      if (!CHALLENGE_TOKEN.test(challengeToken)) throw new ProjectAuthError("INVALID_INPUT");
      const expiresAt = new Date(now.getTime() + 5 * 60 * 1_000);
      await this.dependencies.repository.createOneTimeToken({
        ...scope, id: this.id(), userId: user.id, purpose: "mfa_challenge",
        tokenHash: hashProjectAuthToken(challengeToken), metadata: {}, createdAt: now,
        expiresAt, consumedAt: null,
      });
      // Noch keine Anmeldung: die zaehlt erst, wenn der zweite Faktor stimmt.
      return { mfaRequired: true, challengeToken, expiresAt: expiresAt.toISOString() };
    }
    if (outcome === "enrollment_required") {
      // Hier entsteht bewusst **keine** Sitzung, keine Zeile in
      // project_auth_sessions und kein Access Token. Der Nutzer bekommt nur
      // einen Schein, mit dem er `auth/mfa/enroll` erreicht. Ohne diesen Weg
      // sperrte das Einschalten des Schalters jeden aus, der noch keinen
      // Faktor hat — und das waere beim ersten Mal jeder.
      const enrollmentToken = this.opaqueToken("enroll");
      if (!ENROLLMENT_TOKEN.test(enrollmentToken)) throw new ProjectAuthError("INVALID_INPUT");
      const expiresAt = new Date(now.getTime() + 15 * 60 * 1_000);
      await this.dependencies.repository.createOneTimeToken({
        ...scope, id: this.id(), userId: user.id, purpose: "mfa_enrollment",
        tokenHash: hashProjectAuthToken(enrollmentToken), metadata: {}, createdAt: now,
        expiresAt, consumedAt: null,
      });
      await this.recordAudit(this.userEvent(scope, "project_auth.login.failed", user.id, "failed", {
        method, ...(provider ? { provider } : {}), reason: "mfa_enrollment_required",
      }));
      return {
        mfaRequired: true, enrollmentRequired: true, enrollmentToken,
        expiresAt: expiresAt.toISOString(),
      };
    }
    const result = await this.createSessionResult(scope, user, "aal1", now);
    await this.recordAudit(this.userEvent(scope, "project_auth.login.succeeded", user.id, "succeeded", {
      method, ...(provider ? { provider } : {}), assurance: "aal1",
    }));
    return result;
  }

  private async createSessionResult(
    scope: ProjectAuthScope,
    user: ProjectAuthUser,
    assurance: ProjectAuthAssurance,
    now: Date,
  ): Promise<ProjectAuthSessionResult> {
    const refreshToken = this.opaqueToken("refresh");
    if (!REFRESH_TOKEN.test(refreshToken)) throw new ProjectAuthError("INVALID_INPUT");
    const session = this.session(scope, user.id, assurance, now, refreshToken, this.id());
    await this.dependencies.repository.createSession(session);
    return this.sessionResult(scope, user, session, refreshToken, now);
  }

  private session(
    scope: ProjectAuthScope,
    userId: string,
    assurance: ProjectAuthAssurance,
    now: Date,
    refreshToken: string,
    familyId: string,
  ): ProjectAuthSession {
    return {
      ...scope, id: this.id(), userId, familyId,
      refreshTokenHash: hashProjectAuthToken(refreshToken), assurance,
      createdAt: now, expiresAt: new Date(now.getTime() + this.refreshTtlMs),
      revokedAt: null, replacedBySessionId: null, compromisedAt: null,
    };
  }

  private sessionResult(
    scope: ProjectAuthScope,
    user: ProjectAuthUser,
    session: ProjectAuthSession,
    refreshToken: string,
    now: Date,
  ): ProjectAuthSessionResult {
    const access = this.dependencies.tokens.issue(scope, user, session, now);
    return {
      accessToken: access.accessToken,
      accessTokenExpiresAt: access.accessTokenExpiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: session.expiresAt.toISOString(),
      tokenType: "Bearer",
      user: publicProjectAuthUser(user),
    };
  }

  private async issueDeliveryToken(
    scope: ProjectAuthScope,
    user: ProjectAuthUser,
    purpose: ProjectAuthDeliveryPurpose,
    redirectTo: string,
    ttlMs: number,
  ): Promise<string> {
    const prefix = purpose === "email_verification" ? "verify" : purpose === "magic_link" ? "magic" : "reset";
    const token = this.opaqueToken(prefix);
    if (!ONE_TIME_TOKEN.test(token)) throw new ProjectAuthError("INVALID_INPUT");
    const now = this.now();
    const expiresAt = new Date(now.getTime() + ttlMs);
    await this.dependencies.repository.createOneTimeToken({
      ...scope, id: this.id(), userId: user.id, purpose, tokenHash: hashProjectAuthToken(token),
      metadata: { redirectTo }, createdAt: now, expiresAt, consumedAt: null,
    });
    await this.dependencies.delivery.deliver({ scope, email: user.email, purpose, token, redirectTo, expiresAt });
    return token;
  }

  private redirect(value: string): string {
    try {
      const url = new URL(value);
      if (!this.dependencies.allowedRedirectOrigins.has(url.origin) || url.username || url.password || url.hash) {
        throw new Error("invalid");
      }
      return url.toString();
    } catch {
      throw new ProjectAuthError("INVALID_INPUT");
    }
  }

  private oidcCallbackUri(scope: ProjectAuthScope, provider: string): string {
    try {
      const base = new URL(this.dependencies.callbackBaseUrl);
      const localHttp = base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname);
      if ((base.protocol !== "https:" && !localHttp) || base.username || base.password || base.search || base.hash) {
        throw new Error("invalid");
      }
      return new URL(
        `/api/v1/projects/${scope.projectId}/environments/${scope.environment}/auth/oidc/${provider}/callback`,
        base.origin,
      ).toString();
    } catch {
      throw new ProjectAuthError("INVALID_INPUT");
    }
  }

  private parseOidcFlow(encoded: string): {
    codeVerifier: string;
    nonce: string;
    callbackUri: string;
    redirectTo: string;
  } {
    try {
      const parsed = JSON.parse(encoded) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object" ||
          typeof parsed.codeVerifier !== "string" || typeof parsed.nonce !== "string" ||
          typeof parsed.callbackUri !== "string" || typeof parsed.redirectTo !== "string") {
        throw new Error("invalid");
      }
      return parsed as ReturnType<ProjectAuthService["parseOidcFlow"]>;
    } catch {
      throw new ProjectAuthError("INVALID_TOKEN");
    }
  }

  private async assertRateLimit(
    key: string,
    policy: { limit: number; windowMs: number },
    now: Date,
  ): Promise<void> {
    const decision = await this.dependencies.rateLimiter.consume(key, policy, now);
    if (!decision.allowed) throw new ProjectAuthError("RATE_LIMITED", decision.retryAfterSeconds);
  }
}

export class DisabledProjectAuthService {
  private disabled(): never { throw new ProjectAuthError("PROJECT_AUTH_DISABLED"); }
  signUp(): never { return this.disabled(); }
  requestMagicLink(): never { return this.disabled(); }
  requestPasswordReset(): never { return this.disabled(); }
  resetPassword(): never { return this.disabled(); }
  consumeEmailToken(): never { return this.disabled(); }
  passwordSignIn(): never { return this.disabled(); }
  refresh(): never { return this.disabled(); }
  verifyAccess(): never { return this.disabled(); }
  logout(): never { return this.disabled(); }
  enrollMfa(): never { return this.disabled(); }
  confirmMfa(): never { return this.disabled(); }
  resolveMfaEnrollment(): never { return this.disabled(); }
  readMfaPolicy(): never { return this.disabled(); }
  setMfaRequired(): never { return this.disabled(); }
  verifyMfaChallenge(): never { return this.disabled(); }
  startOidc(): never { return this.disabled(); }
  completeOidc(): never { return this.disabled(); }
  resolveOidcScope(): never { return this.disabled(); }
  jwks(): never { return this.disabled(); }
  listUsers(): never { return this.disabled(); }
  updateUser(): never { return this.disabled(); }
  listSessions(): never { return this.disabled(); }
  revokeSession(): never { return this.disabled(); }
  revokeAllSessions(): never { return this.disabled(); }
  listAuditEvents(): never { return this.disabled(); }
  readAuditSeries(): never { return this.disabled(); }
}

function mfaPolicy(
  required: boolean,
  updatedAt: Date | null,
  counts: { users: number; enrolled: number },
): PublicProjectAuthMfaPolicy {
  return {
    required,
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
    users: counts.users,
    enrolled: counts.enrolled,
    // Nie negativ, auch wenn beide Zahlen aus zwei Unterabfragen stammen und
    // zwischen ihnen ein Nutzer verschwinden koennte.
    notEnrolled: Math.max(counts.users - counts.enrolled, 0),
    factors: ["totp"],
  };
}

function canonicalEmail(email: string): string { return email.trim().toLowerCase(); }

function assertEmail(email: string): void {
  if (email.length < 3 || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ProjectAuthError("INVALID_INPUT");
  }
}

function assertPassword(password: string): void {
  if (password.length < 12 || password.length > 256) throw new ProjectAuthError("INVALID_INPUT");
}

function assertAdminId(id: string): void {
  if (!id || id.length > 128) throw new ProjectAuthError("INVALID_INPUT");
}

function assertScope(scope: ProjectAuthScope): void {
  if (!scope.organizationId || scope.organizationId.length > 128 || !scope.projectId || scope.projectId.length > 128 ||
      !["development", "staging", "production"].includes(scope.environment)) {
    throw new ProjectAuthError("INVALID_INPUT");
  }
}

function boundedMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new ProjectAuthError("INVALID_INPUT");
  try {
    const encoded = JSON.stringify(metadata);
    if (Buffer.byteLength(encoded, "utf8") > 512) throw new Error("too large");
    const parsed = JSON.parse(encoded) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    return parsed as Record<string, unknown>;
  } catch {
    throw new ProjectAuthError("INVALID_INPUT");
  }
}

function scopeKey(scope: ProjectAuthScope): string {
  return `${scope.organizationId}:${scope.projectId}:${scope.environment}`;
}
