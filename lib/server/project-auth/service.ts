import { recognisedByName } from "@/lib/server/errors/identity";
import { randomBytes, randomUUID } from "node:crypto";
import type { PasswordHasher } from "@/lib/server/auth/password";
import type { RateLimiter } from "@/lib/server/auth/rate-limit";
import {
  DEFAULT_PROJECT_AUTH_RATE_LIMITS,
  parseProjectAuthRateLimits,
  projectAuthRateAllowed,
  projectAuthRateRetryAfterSeconds,
  projectAuthRateSubjectHash,
  projectAuthRateWindowStart,
  PROJECT_AUTH_RATE_LIMIT_BOUNDS,
  PROJECT_AUTH_RATE_LIMIT_KINDS,
  type ProjectAuthRateLimitKind,
  type ProjectAuthRateLimitRejection,
  type ProjectAuthRateLimits,
} from "@/lib/server/project-auth/rate-limits";
import {
  DEFAULT_PROJECT_AUTH_PASSWORD_PROTECTION,
  parseProjectAuthPasswordProtection,
  projectAuthBuiltInLeakList,
  projectAuthPasswordIsLeaked,
  publicProjectAuthLeakList,
  PROJECT_AUTH_PASSWORD_MIN_LENGTH_BOUNDS,
  PROJECT_AUTH_PASSWORD_NOTICES,
  type ProjectAuthLeakList,
  type ProjectAuthPasswordProtection,
  type ProjectAuthPasswordProtectionRejection,
  type PublicProjectAuthLeakList,
} from "@/lib/server/project-auth/password-leaks";
import type {
  ProjectAuthAssurance,
  ProjectAuthOidcIdentity,
  ProjectAuthOneTimePurpose,
  ProjectAuthPasskey,
  ProjectAuthScope,
  ProjectAuthSession,
  ProjectAuthSessionSummary,
  ProjectAuthUser,
  ProjectAuthUserStatus,
  PublicProjectAuthPasskey,
  PublicProjectAuthUser,
} from "@/lib/server/project-auth/model";
import { publicProjectAuthPasskey, publicProjectAuthUser } from "@/lib/server/project-auth/model";
import {
  PASSKEY_ALGORITHMS,
  verifyPasskeyAssertion,
  verifyPasskeyRegistration,
} from "@/lib/server/project-auth/passkeys";
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
  effectiveProjectAuthReturnTargets,
  parseProjectAuthReturnTargets,
  projectAuthReturnTargetAllowed,
  PROJECT_AUTH_RETURN_TARGET_LIMIT,
  type ProjectAuthReturnTargetRejection,
} from "@/lib/server/project-auth/return-targets";
import {
  DEFAULT_PROJECT_AUTH_HOOKS,
  parseProjectAuthHooks,
  projectAuthClaimsHookPayload,
  projectAuthClaimsHookVerdict,
  projectAuthSignInHookPayload,
  projectAuthSignInHookVerdict,
  PROJECT_AUTH_HOOK_BOUNDS,
  PROJECT_AUTH_HOOK_POINTS,
  PROJECT_AUTH_RESERVED_CLAIMS,
  type ProjectAuthClaimValue,
  type ProjectAuthHookMethod,
  type ProjectAuthHookPort,
  type ProjectAuthHookReason,
  type ProjectAuthHookRefusal,
  type ProjectAuthHookRejection,
  type ProjectAuthHooks,
} from "@/lib/server/project-auth/hooks";
import {
  parseProjectAuthThirdPartyProvider,
  verifyProjectAuthThirdPartyToken,
  PROJECT_AUTH_THIRD_PARTY_ALGORITHM_IDS,
  PROJECT_AUTH_THIRD_PARTY_BOUNDS,
  PROJECT_AUTH_THIRD_PARTY_FORBIDDEN_ROLE,
  PROJECT_AUTH_THIRD_PARTY_OWN_CLAIMS,
  PROJECT_AUTH_THIRD_PARTY_ROLES,
  type ProjectAuthThirdPartyIdentity,
  type ProjectAuthThirdPartyProvider,
  type ProjectAuthThirdPartyRefusal,
  type ProjectAuthThirdPartyRejection,
} from "@/lib/server/project-auth/third-party";
import type { ProjectAuthThirdPartyKeyPort } from "@/lib/server/project-auth/third-party-keys";
import {
  checkProjectAuthOAuthAuthorize,
  parseProjectAuthOAuthAuthorize,
  parseProjectAuthOAuthClient,
  parseProjectAuthOAuthConsent,
  parseProjectAuthOAuthExchange,
  projectAuthOAuthConsentHolds,
  projectAuthOAuthVerifierMatches,
  PROJECT_AUTH_OAUTH_BOUNDS,
  PROJECT_AUTH_OAUTH_CHALLENGE_METHOD,
  PROJECT_AUTH_OAUTH_CODE,
  PROJECT_AUTH_OAUTH_FORBIDDEN_ROLE,
  PROJECT_AUTH_OAUTH_GRANT,
  PROJECT_AUTH_OAUTH_ROLE,
  PROJECT_AUTH_OAUTH_SCOPES,
  PROJECT_AUTH_OAUTH_TOKEN,
  PROJECT_AUTH_OAUTH_UNSUPPORTED_GRANTS,
  type ProjectAuthOAuthAuthorizeRejection,
  type ProjectAuthOAuthClient,
  type ProjectAuthOAuthClientRejection,
  type ProjectAuthOAuthConsent,
  type ProjectAuthOAuthConsentRejection,
  type ProjectAuthOAuthExchangeRejection,
  type ProjectAuthOAuthIdentity,
  type ProjectAuthOAuthRefusal,
  type ProjectAuthOAuthToken,
} from "@/lib/server/project-auth/oauth";
import {
  hashProjectAuthToken,
  ProjectAuthTokenError,
  ProjectAuthTokenService,
  type ProjectAuthAccessClaims,
} from "@/lib/server/project-auth/tokens";

const REFRESH_TOKEN = /^qk_refresh_[A-Za-z0-9_-]{43}$/;
const CHALLENGE_TOKEN = /^qk_challenge_[A-Za-z0-9_-]{43}$/;
/**
 * Der Schein fuer eine WebAuthn-Herausforderung (2.79).
 *
 * Die 43 Zeichen hinter dem Praefix **sind** die Herausforderung: base64url von
 * 32 zufaelligen Byte, genau der Wert, den der Browser in die Client-Daten
 * schreibt und mitunterschreibt. Der Aufrufer bekommt beides in einem Feld,
 * damit er nichts zusammensetzen muss; der Server verbraucht den Schein in der
 * Datenbank und vergleicht die Herausforderung daneben noch einmal gegen die
 * Client-Daten. Zwei Pruefungen aus einem Wert, und beide sind noetig: Die
 * erste macht die Einmaligkeit, die zweite bindet die Unterschrift daran.
 */
const PASSKEY_TOKEN = /^qk_pkey_[A-Za-z0-9_-]{43}$/;
const PASSKEY_TOKEN_PREFIX = "qk_pkey_";
/** Wie lange eine Herausforderung gilt. Kurz, weil sie einen Handgriff traegt. */
const PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1_000;
const PASSKEY_RATE = { limit: 20, windowMs: 15 * 60 * 1_000 };
const ENROLLMENT_TOKEN = /^qk_enroll_[A-Za-z0-9_-]{43}$/;
const ONE_TIME_TOKEN = /^qk_(verify|magic|reset)_[A-Za-z0-9_-]{43}$/;
const OIDC_STATE_TOKEN = /^qk_oidc_[A-Za-z0-9_-]{43}$/;
const PASSWORD_RATE = { limit: 10, windowMs: 15 * 60 * 1_000 };
const EMAIL_RATE = { limit: 5, windowMs: 60 * 60 * 1_000 };
const MFA_RATE = { limit: 8, windowMs: 15 * 60 * 1_000 };
const AUDIT_CURSOR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Die Form einer UUID, fuer IDs, die aus einer Anfrage kommen (2.79). */
const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * Eine ausgegebene WebAuthn-Herausforderung (2.79).
 *
 * `challenge` und `challengeToken` tragen denselben Zufall: Der Browser
 * unterschreibt `challenge`, der Server loest `challengeToken` in der Datenbank
 * ein. Beides steht hier, damit der Aufrufer nichts ableiten muss.
 *
 * `relyingParties` ist die Liste der erlaubten Herkuenfte samt der Domaene, die
 * je Herkunft als `rp.id` gilt. Eine Liste und kein einzelner Wert, weil der
 * Server nicht weiss, von welcher der erlaubten Herkuenfte der Aufrufer kommt;
 * der Browser weiss es und nimmt den Eintrag, der zu ihm passt. Schickt er
 * danach eine andere Herkunft zurueck, faellt sie bei der Pruefung durch.
 */
export type PublicProjectAuthPasskeyChallenge = {
  challengeToken: string;
  challenge: string;
  relyingParties: Array<{ origin: string; rpId: string }>;
  algorithms: ReadonlyArray<{ type: "public-key"; alg: number }>;
  expiresAt: string;
};

/** Was die Console ueber die Passkeys einer Umgebung sieht (2.79). */
export type PublicProjectAuthPasskeyPolicy = {
  users: number;
  passkeys: number;
  usersWithPasskey: number;
  usersWithoutPasskey: number;
  relyingParties: Array<{ origin: string; rpId: string }>;
  algorithms: ReadonlyArray<{ type: "public-key"; alg: number }>;
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

/**
 * Was die Console ueber die Ruecksprungziele einer Umgebung sieht (2.54).
 *
 * Drei Listen, und der Unterschied ist der Punkt: `outerBound` ist, was der
 * Betrieb erlaubt; `targets` ist, was diese Umgebung davon uebrig laesst;
 * `effective` ist, was daraus wirklich gilt. Bei leerer `targets` sind
 * `outerBound` und `effective` gleich.
 */
export type PublicProjectAuthReturnTargets = {
  targets: string[];
  outerBound: string[];
  effective: string[];
  limit: number;
  updatedAt: string | null;
};

/**
 * Was die Console ueber die Grenzen je Zeitfenster einer Umgebung sieht
 * (2.56).
 *
 * `limits` sind die geltenden Werte, `defaults` die Vorgaben und `bounds` die
 * Raender, innerhalb derer sich beide Zahlen bewegen duerfen. Die Console
 * braucht alle drei: die Vorgaben, um sagen zu koennen, was "unveraendert"
 * heisst, und die Raender, um eine Eingabe abzulehnen, bevor sie eine Route
 * ablehnt.
 *
 * `configured` sagt, ob diese Umgebung ueberhaupt je etwas eingestellt hat.
 * Ohne Zeile gelten die Vorgaben, und das ist etwas anderes als "jemand hat
 * die Vorgaben eingetragen" — obwohl beides gleich wirkt, soll die Seite
 * nicht behaupten, jemand haette hier etwas entschieden.
 */
export type PublicProjectAuthRateLimits = {
  limits: ProjectAuthRateLimits;
  defaults: ProjectAuthRateLimits;
  bounds: typeof PROJECT_AUTH_RATE_LIMIT_BOUNDS;
  kinds: readonly ProjectAuthRateLimitKind[];
  configured: boolean;
  updatedAt: string | null;
};

/**
 * Was die Console vom Passwortschutz dieser Umgebung sieht (2.53).
 *
 * `list` beschreibt die geladene Leckliste: woher sie stammt und wie viele
 * Eintraege sie traegt. Nie ein Pfad und nie ein Eintrag — ein Dateipfad des
 * Servers hat in der Console nichts zu suchen.
 */
export type PublicProjectAuthPasswordProtection = {
  protection: ProjectAuthPasswordProtection;
  defaults: ProjectAuthPasswordProtection;
  bounds: { minLength: typeof PROJECT_AUTH_PASSWORD_MIN_LENGTH_BOUNDS };
  notices: readonly string[];
  list: PublicProjectAuthLeakList;
  configured: boolean;
  updatedAt: string | null;
};

/** Die Ablehnung einer Einstellung des Passwortschutzes, mit Grund und Feld. */
/**
 * Die Auth-Hooks einer Umgebung, wie die Console sie sieht (2.77).
 *
 * Mitgeliefert werden die Raender, die Punkte, die reservierten Namen und der
 * Satz, was bei einem Ausfall gilt. Die Console soll das nicht aus eigenem
 * Wissen behaupten muessen: Was reserviert ist, entscheidet der Dienst.
 */
export type PublicProjectAuthHooks = {
  hooks: ProjectAuthHooks;
  defaults: ProjectAuthHooks;
  bounds: typeof PROJECT_AUTH_HOOK_BOUNDS;
  points: readonly string[];
  reservedClaims: readonly string[];
  /** Was bei einem Ausfall gilt, je Punkt. Heute an beiden `deny`. */
  failureMode: Record<"sign_in" | "access_token_claims", "deny">;
  configured: boolean;
  updatedAt: string | null;
};

/**
 * Die fremden Anbieter einer Umgebung, wie die Console sie sieht (2.80).
 *
 * Mitgeliefert werden die Liste, die erlaubten Rollen, die verbotene Rolle, die
 * Positivliste der Verfahren und die Raender. Die Console soll nichts davon aus
 * eigenem Wissen behaupten muessen: Welche Verfahren geprueft werden und welche
 * Rolle ein fremdes Token hoechstens bekommt, entscheidet der Dienst.
 */
export type PublicProjectAuthThirdParty = {
  providers: Array<{
    id: string;
    name: string;
    issuer: string;
    jwksUri: string;
    audiences: string[];
    subjectClaim: string;
    roleClaim: string | null;
    defaultRole: string;
    createdAt: string;
  }>;
  roles: readonly string[];
  /** Die Rolle, die ein fremdes Token nie bekommt. Ausdruecklich genannt, nicht bloss weggelassen. */
  forbiddenRole: string;
  algorithms: readonly string[];
  /** Die Ansprueche, die QKERN selbst setzt und darum nicht aus einem fremden Token uebernimmt. */
  ownClaims: readonly string[];
  bounds: typeof PROJECT_AUTH_THIRD_PARTY_BOUNDS;
  /** Ob in dieser Umgebung ueberhaupt ein fremder Anbieter hinterlegt ist. */
  configured: boolean;
};

export class ProjectAuthThirdPartyError extends Error {
  constructor(
    readonly reason: ProjectAuthThirdPartyRejection | "duplicate",
    readonly field: string,
  ) {
    super("Invalid Project Auth third party provider");
    this.name = "ProjectAuthThirdPartyError";
  }
}
recognisedByName(ProjectAuthThirdPartyError, "ProjectAuthThirdPartyError");

/**
 * Der OAuth-Server einer Umgebung, wie die Console ihn sieht (2.82).
 *
 * Mitgeliefert werden die Clients, die Bereiche mit ihrer Bedeutung, die Rolle,
 * die ein Token bekommt, die Rolle, die es nie bekommt, die nicht gebauten
 * Verfahren und die Raender. Die Console soll nichts davon aus eigenem Wissen
 * behaupten muessen: Welche Bereiche es gibt und welche Rolle ein fremder
 * Client bekommt, entscheidet der Dienst, und wenn sich das einmal aendert,
 * aendert sich diese Zeile und nicht ein Satz in einer Ansicht.
 */
export type PublicProjectAuthOAuthServer = {
  clients: Array<{
    id: string;
    name: string;
    redirectUris: string[];
    scopes: string[];
    createdAt: string;
  }>;
  /**
   * Die Zustimmungen dieser Umgebung (2.92), die geltenden und die
   * widerrufenen, je mit Client, Nutzer, Bereichen und Zeitpunkt.
   *
   * Kein Token, kein Code, keine Pruefsumme: Die Console soll zeigen, wer wem
   * was erlaubt hat, und nichts, womit sich eine Anfrage stellen liesse.
   */
  consents: Array<{
    id: string;
    clientId: string;
    clientName: string;
    userId: string;
    email: string;
    scopes: string[];
    grantedAt: string;
    revokedAt: string | null;
  }>;
  /** Ob die Liste der Zustimmungen am Rand abgeschnitten wurde. */
  consentsTruncated: boolean;
  /**
   * Die ausgegebenen Token dieser Umgebung (2.93), je mit Client, Nutzer,
   * Bereichen, Zeitpunkt und Ablauf.
   *
   * Ohne das Token und ohne seine Pruefsumme. Was hier steht, reicht, um zu
   * sehen, was offen ist, und zu nichts sonst; die abgelaufenen sind daran zu
   * erkennen, dass ihr Ablauf in der Vergangenheit liegt, und sie werden
   * mitgezeigt, weil ihre Zeilen bis zum Aufraeumer wirklich noch da sind.
   */
  tokens: Array<{
    id: string;
    clientId: string;
    clientName: string;
    userId: string;
    email: string;
    consentId: string | null;
    scopes: string[];
    createdAt: string;
    expiresAt: string;
  }>;
  /** Ob die Liste der Token am Rand abgeschnitten wurde. */
  tokensTruncated: boolean;
  scopes: readonly string[];
  /** Die Rolle, die jedes Token dieses Ablaufs in der Zeilensicherheit bekommt. */
  role: string;
  /** Die Rolle, die es nie bekommt. Ausdruecklich genannt, nicht bloss weggelassen. */
  forbiddenRole: string;
  /** Die Verfahren, die dieser Server nicht kennt, mit Namen. */
  unsupportedGrants: readonly string[];
  /** Das einzige Verfahren, und die einzige Art der Pruefsumme. */
  grant: string;
  challengeMethod: string;
  bounds: typeof PROJECT_AUTH_OAUTH_BOUNDS;
  /** Ob in dieser Umgebung ueberhaupt ein Client hinterlegt ist. */
  configured: boolean;
};

export class ProjectAuthOAuthError extends Error {
  constructor(
    readonly reason:
      | ProjectAuthOAuthClientRejection
      | ProjectAuthOAuthAuthorizeRejection
      | ProjectAuthOAuthConsentRejection
      | ProjectAuthOAuthExchangeRejection
      | "duplicate",
    readonly field: string,
  ) {
    super("Invalid Project Auth OAuth request");
    this.name = "ProjectAuthOAuthError";
  }
}
recognisedByName(ProjectAuthOAuthError, "ProjectAuthOAuthError");

export class ProjectAuthHookError extends Error {
  constructor(
    readonly reason: ProjectAuthHookRejection,
    readonly field: string,
  ) {
    super("Invalid Project Auth hook");
    this.name = "ProjectAuthHookError";
  }
}
recognisedByName(ProjectAuthHookError, "ProjectAuthHookError");

export class ProjectAuthPasswordProtectionError extends Error {
  constructor(
    readonly reason: ProjectAuthPasswordProtectionRejection,
    readonly field: string,
  ) {
    super("Invalid Project Auth password protection");
    this.name = "ProjectAuthPasswordProtectionError";
  }
}
recognisedByName(ProjectAuthPasswordProtectionError, "ProjectAuthPasswordProtectionError");

/** Die Ablehnung einer Grenze, mit Grund und der Art, die sie ausgeloest hat. */
export class ProjectAuthRateLimitError extends Error {
  constructor(
    readonly reason: ProjectAuthRateLimitRejection,
    readonly field: string,
  ) {
    super("Invalid Project Auth rate limit");
    this.name = "ProjectAuthRateLimitError";
  }
}
recognisedByName(ProjectAuthRateLimitError, "ProjectAuthRateLimitError");

/** Die Ablehnung eines Eintrags, mit Grund und dem Wert, der sie ausgeloest hat. */
export class ProjectAuthReturnTargetError extends Error {
  constructor(
    readonly reason: ProjectAuthReturnTargetRejection,
    readonly value: string,
  ) {
    super("Invalid Project Auth return target");
    this.name = "ProjectAuthReturnTargetError";
  }
}
recognisedByName(ProjectAuthReturnTargetError, "ProjectAuthReturnTargetError");

/** Wer in der Console handelt: die ID des Console-Nutzers, nie seine E-Mail. */
export type ProjectAuthAdminActor = { id: string };

type ProjectAuthSignInMethod = "password" | "magic_link" | "email_verification" | "oidc" | "passkey";

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
  // Eine Antwort des Browsers auf eine WebAuthn-Herausforderung ist nicht
  // durchgekommen (2.79). Ein eigener Code und nicht INVALID_MFA, weil ein
  // Passkey hier ein **erster** Faktor ist: Wer ihn abgewiesen bekommt, ist
  // nicht halb angemeldet, sondern gar nicht. Warum genau, sagt die Antwort
  // nicht; der Grund steht im Audit.
  | "INVALID_PASSKEY"
  | "RATE_LIMITED"
  // Das gewaehlte Passwort steht in der Leckliste dieser Installation (2.53).
  // Dass es das tut, ist handelbar und kein Geheimnis: Wer es eingibt, kennt
  // es bereits. Wie oft und woher sagt dieser Code nicht — das weiss die
  // Pruefung selbst nicht, weil sie nur Digests vergleicht.
  | "LEAKED_PASSWORD"
  // Dasselbe Ereignis, nur wortkarg: Das Passwort genuegt den Regeln dieses
  // Projekts nicht. Diesen Code bekommt, wer die Mindestlaenge unterschreitet,
  // und wer ein bekanntes Passwort waehlt, falls die Umgebung auf `generic`
  // steht.
  | "WEAK_PASSWORD"
  | "DELIVERY_UNAVAILABLE"
  | "RESOURCE_NOT_FOUND"
  // Ein Auth-Hook (2.77) hat die Anmeldung abgewiesen. Der Hook hat
  // geantwortet, und er hat `deny` gesagt; das ist eine Entscheidung des
  // Projekts und keine Stoerung. Warum, sagt diese Antwort nicht: Den Grund
  // kennt der hinterlegte Code, nicht QKERN.
  | "HOOK_DENIED"
  // Ein Auth-Hook hat nicht geantwortet, nicht rechtzeitig geantwortet oder
  // etwas geantwortet, das keine Antwort ist. Beide Punkte fallen geschlossen:
  // Es entsteht keine Sitzung und kein Token. Das ist die unbequeme Haelfte
  // dieses Schnitts, und sie steht woertlich auf der Seite Auth-Hooks.
  | "HOOK_UNAVAILABLE"
  // Ein Auth-Hook hat etwas verlangt, das er nicht verlangen darf: einen
  // reservierten Anspruch, einen nicht erklaerten Anspruch oder einen Wert
  // ausserhalb der Grenzen. Auch hier entsteht kein Token; der Anspruch wird
  // nicht stillschweigend uebergangen.
  | "HOOK_REJECTED"
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
  /**
   * Die Leckliste (2.53), einmal geladen und im Prozessspeicher gehalten.
   * Ohne Angabe die eingebaute Liste; die ist klein und kuerzer als die 12
   * Zeichen, die ohnehin verlangt werden — sie gibt dem Schalter ein
   * definiertes Verhalten, keinen Schutz.
   */
  leakedPasswords?: ProjectAuthLeakList;
  rateLimiter: RateLimiter;
  tokens: ProjectAuthTokenService;
  mfa: ProjectAuthTotp;
  secrets: ProjectAuthSecretProtector;
  delivery: ProjectAuthDeliveryPort;
  oidcCatalog: ProjectAuthOidcCatalog;
  oidcClient: ProjectAuthOidcClient;
  /** Optional: ohne Sink schreibt der Dienst keine Audit-Ereignisse. */
  audit?: ProjectAuthAuditSink;
  /**
   * Der Weg zu den hinterlegten Functions (2.77).
   *
   * Ohne Port gibt es keinen Weg zu einem Container. Ein Punkt **ohne**
   * eingetragene Function merkt davon nichts und ruft weiterhin nichts. Ein
   * Punkt **mit** eingetragener Function faellt dann geschlossen, genau wie bei
   * jeder anderen fehlenden Antwort: Ein Hook, den niemand rufen kann, hat
   * nicht geantwortet, und ein fehlender Aufrufweg ist kein Grund, eine
   * eingetragene Regel stillschweigend zu uebergehen. Wer Project Auth ohne
   * Compute betreibt, traegt keinen Hook ein.
   */
  hooks?: ProjectAuthHookPort;
  /**
   * Der Weg zum Schluesselsatz eines fremden Ausstellers (2.80).
   *
   * Ohne Port prueft der Dienst kein fremdes Token: Eine Signatur, die niemand
   * nachrechnen kann, ist keine geprufte Signatur, und "ungeprueft annehmen"
   * ist keine Betriebsart. Ein Projekt ohne hinterlegten Anbieter merkt davon
   * nichts.
   */
  thirdPartyKeys?: ProjectAuthThirdPartyKeyPort;
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
    // Die Grenze aus der Datenbank, nach der Identitaet gezaehlt (2.56), und
    // zwar bevor irgendetwas nachgeschlagen wird: Sonst unterschiede sich die
    // Antwort fuer eine bekannte und eine unbekannte Adresse.
    await this.assertStoredRateLimit(scope, "mail", email, now);
    assertPassword(input.password);
    // Der Passwortschutz dieser Umgebung (2.53), und zwar hier, im Dienst,
    // bevor gehasht und bevor nachgeschlagen wird. Nicht in der Console und
    // nicht in der Route: Es gibt mehr als eine Tuer zu dieser Stelle, und
    // eine Regel, die an einer Tuer haengt, ist keine Regel.
    await this.assertPasswordProtection(scope, input.password);
    const redirectTo = await this.returnTarget(scope, input.redirectTo);
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
    await this.assertStoredRateLimit(scope, "mail", email, now);
    const redirectTo = await this.returnTarget(scope, input.redirectTo);
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
    await this.assertStoredRateLimit(scope, "mail", email, now);
    const redirectTo = await this.returnTarget(scope, input.redirectTo);
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
    // Dieselbe Regel auf dem zweiten Weg, auf dem ein Passwort gesetzt wird.
    // Sie steht vor dem Einloesen des Tokens: Ein abgelehntes Passwort soll
    // den Zuruecksetz-Schein nicht verbrauchen, sonst muesste der Nutzer eine
    // neue Mail anfordern, nur weil er ein bekanntes Passwort getippt hat.
    await this.assertPasswordProtection(scope, input.password);
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
    const email = canonicalEmail(input.email);
    // Die Grenze aus der Datenbank, nach der Identitaet gezaehlt (2.56). Sie
    // steht vor dem Nachschlagen und vor dem Pruefen des Passworts: Ein
    // Angreifer soll aus einer 429 nicht lesen koennen, ob es die Adresse
    // gibt, und ein Raten soll schon vor dem teuren Argon2 enden.
    await this.assertStoredRateLimit(scope, "sign_in", email, now);
    const user = await this.dependencies.repository.findUserByEmail(scope, email);
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
    // Die Grenze aus der Datenbank, nach der Sitzungsfamilie gezaehlt (2.56).
    // Sie steht hinter dem Nachschlagen und nicht davor, weil es vorher keine
    // Familie gibt: Ein zufaellig geratenes Refresh Token gehoert zu keiner
    // und ist schon eine Zeile darueber abgewiesen. Gezaehlt wird also das,
    // was zaehlbar ist — wie oft eine echte Anmeldung ihr Token erneuert.
    await this.assertStoredRateLimit(scope, "refresh", current.familyId, now);
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
    // Die Erneuerung ist keine Anmeldung: Der Punkt `sign_in` laeuft hier
    // absichtlich nicht, der Punkt `access_token_claims` aber schon, mit
    // `reason: "refresh"`.
    //
    // Er laeuft **vor** `rotateSession`, und das ist keine Feinheit. Nach der
    // Rotation ist das alte Refresh Token widerrufen; ein Hook, der danach
    // faellt, haette die Sitzungsfamilie erledigt, weil es kein neues Token
    // gibt und das alte nie wieder gilt. So faellt bloss dieser eine Versuch,
    // die Familie bleibt stehen, und der naechste Versuch nach einem Neustart
    // des Containers kommt durch. Ein Neustart soll keine Sitzung kosten.
    const claims = await this.hookClaims(scope, user, current.assurance, "refresh", now);
    const nextToken = this.opaqueToken("refresh");
    if (!REFRESH_TOKEN.test(nextToken)) throw new ProjectAuthError("INVALID_INPUT");
    const next = this.session(scope, user.id, current.assurance, now, nextToken, current.familyId);
    const rotation = await this.dependencies.repository.rotateSession(scope, current.id, next, now);
    if (rotation === "replayed") throw new ProjectAuthError("TOKEN_REPLAYED");
    if (rotation !== "rotated") throw new ProjectAuthError("INVALID_TOKEN");
    return this.sessionResult(scope, user, next, nextToken, now, claims);
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

  /**
   * Die erlaubten Ruecksprungziele dieser Umgebung (2.54), zusammen mit der
   * aeusseren Grenze, gegen die sie gelten. Die Console braucht beide, sonst
   * koennte sie nicht zeigen, warum ein Eintrag abgelehnt wurde.
   */
  async readReturnTargets(scope: ProjectAuthScope): Promise<PublicProjectAuthReturnTargets> {
    assertScope(scope);
    const settings = await this.dependencies.repository.readSettings(scope);
    const targets = settings?.returnTargets ?? [];
    return {
      targets: [...targets],
      outerBound: [...this.dependencies.allowedRedirectOrigins],
      effective: effectiveProjectAuthReturnTargets(this.dependencies.allowedRedirectOrigins, targets),
      limit: PROJECT_AUTH_RETURN_TARGET_LIMIT,
      updatedAt: settings ? settings.updatedAt.toISOString() : null,
    };
  }

  /**
   * Ersetzt die Liste ganz. Jeder Eintrag muss die strenge Form haben und
   * innerhalb der aeusseren Grenze liegen; ein Eintrag ausserhalb wird
   * abgelehnt, nicht weggelassen — eine stille Filterung hiesse, dass die
   * Console etwas anderes speichert, als dort stand.
   *
   * Eine Aenderung ist ein Schreibzugriff und schreibt einen Audit-Eintrag.
   * Darin steht, wie viele Ziele es danach sind, nicht welche: Die
   * Metadaten-Regel des Audits laesst ohnehin kein `//` und keinen Doppelpunkt
   * in Folge durch, und die Liste selbst steht in der Tabelle.
   */
  async setReturnTargets(
    scope: ProjectAuthScope,
    targets: readonly unknown[],
    admin?: ProjectAuthAdminActor,
  ): Promise<PublicProjectAuthReturnTargets> {
    assertScope(scope);
    if (!Array.isArray(targets)) throw new ProjectAuthError("INVALID_INPUT");
    const parsed = parseProjectAuthReturnTargets(targets, this.dependencies.allowedRedirectOrigins);
    if (!parsed.ok) throw new ProjectAuthReturnTargetError(parsed.reason, parsed.value);
    const settings = await this.dependencies.repository.writeReturnTargets(scope, parsed.targets, this.now());
    await this.recordAudit({
      scope, action: "project_auth.return_targets.changed",
      actorType: admin ? "admin" : "system", actorRef: admin ? admin.id : "system",
      resourceRef: `project_auth_environment:${scope.environment}`,
      status: "succeeded", metadata: { count: parsed.targets.length },
    });
    return {
      targets: [...settings.returnTargets],
      outerBound: [...this.dependencies.allowedRedirectOrigins],
      effective: effectiveProjectAuthReturnTargets(
        this.dependencies.allowedRedirectOrigins, settings.returnTargets,
      ),
      limit: PROJECT_AUTH_RETURN_TARGET_LIMIT,
      updatedAt: settings.updatedAt.toISOString(),
    };
  }

  /**
   * Der Passwortschutz dieser Umgebung (2.53), zusammen mit den Vorgaben, den
   * Raendern und dem, was ueber die geladene Leckliste gesagt werden darf.
   * Ohne Zeile in `project_auth_settings` gelten die Vorgaben und
   * `configured` ist falsch.
   */
  async readPasswordProtection(scope: ProjectAuthScope): Promise<PublicProjectAuthPasswordProtection> {
    assertScope(scope);
    const settings = await this.dependencies.repository.readSettings(scope);
    return publicPasswordProtection(
      settings?.passwordProtection,
      settings?.updatedAt ?? null,
      Boolean(settings),
      this.leakList(),
    );
  }

  /**
   * Setzt den Passwortschutz. Alle drei Werte zusammen, aus demselben Grund
   * wie bei den Grenzen: Ein Koerper mit nur einem liesse offen, was mit den
   * anderen geschehen soll.
   *
   * Jede Aenderung schreibt einen Audit-Eintrag. Darin stehen der Schalter,
   * die Mindestlaenge und der Wortlaut — und, weil es zur Aussage gehoert,
   * woher die geltende Liste stammt und wie viele Eintraege sie traegt. Nie
   * ein Passwort, nie ein Digest, nie ein Pfad.
   */
  async setPasswordProtection(
    scope: ProjectAuthScope,
    protection: unknown,
    admin?: ProjectAuthAdminActor,
  ): Promise<PublicProjectAuthPasswordProtection> {
    assertScope(scope);
    const parsed = parseProjectAuthPasswordProtection(protection);
    if (!parsed.ok) throw new ProjectAuthPasswordProtectionError(parsed.reason, parsed.field);
    const list = this.leakList();
    const settings = await this.dependencies.repository.writePasswordProtection(
      scope, parsed.protection, this.now(),
    );
    await this.recordAudit({
      scope, action: "project_auth.password_protection.changed",
      actorType: admin ? "admin" : "system", actorRef: admin ? admin.id : "system",
      resourceRef: `project_auth_environment:${scope.environment}`,
      status: "succeeded",
      metadata: {
        // `leakCheck` und nicht `leakedPasswordCheck`: Die Schwaerzung in
        // `redactSensitive` trifft jeden Schluessel, der "password" enthaelt,
        // und machte aus dem Wahrheitswert ein "[REDACTED]". Die Regel bleibt
        // grob und richtig; der Eintrag bekommt einen Namen, der nichts
        // verspricht, was er nicht ist.
        leakCheck: parsed.protection.leakedPasswordCheck,
        minLength: parsed.protection.minLength,
        notice: parsed.protection.notice,
        listSource: list.source,
        listEntries: list.entries,
      },
    });
    return publicPasswordProtection(
      settings.passwordProtection, settings.updatedAt, true, list,
    );
  }

  /**
   * Die Auth-Hooks dieser Umgebung (2.77), zusammen mit den Vorgaben, den
   * Raendern, den reservierten Namen und dem, was bei einem Ausfall gilt. Ohne
   * Zeile in `project_auth_settings` ruft nichts, und `configured` ist falsch.
   */
  async readAuthHooks(scope: ProjectAuthScope): Promise<PublicProjectAuthHooks> {
    assertScope(scope);
    const settings = await this.dependencies.repository.readSettings(scope);
    return publicHooks(settings?.hooks, settings?.updatedAt ?? null, Boolean(settings));
  }

  /**
   * Setzt beide Punkte. Beide zusammen, weil ein Koerper mit nur einem offen
   * liesse, was mit dem anderen geschehen soll.
   *
   * Jede Aenderung schreibt einen Audit-Eintrag, und zwar mit dem, was zaehlt:
   * je Punkt der Name der Function (oder dass keine eingetragen ist), die Frist
   * und, beim Anspruchs-Hook, die erklaerten Namen. Die Namen sind keine
   * Geheimnisse, sie stehen danach in jedem Token. Was **nicht** darin steht,
   * ist eine Nutzlast, ein Anspruchswert oder eine Adresse: Diese Zeile sagt,
   * wer gerufen werden darf, nicht was dabei herauskam.
   */
  async setAuthHooks(
    scope: ProjectAuthScope,
    hooks: unknown,
    admin?: ProjectAuthAdminActor,
  ): Promise<PublicProjectAuthHooks> {
    assertScope(scope);
    const parsed = parseProjectAuthHooks(hooks);
    if (!parsed.ok) throw new ProjectAuthHookError(parsed.reason, parsed.field);
    const settings = await this.dependencies.repository.writeAuthHooks(scope, parsed.hooks, this.now());
    await this.recordAudit({
      scope, action: "project_auth.hooks.changed",
      actorType: admin ? "admin" : "system", actorRef: admin ? admin.id : "system",
      resourceRef: `project_auth_environment:${scope.environment}`,
      status: "succeeded",
      // `claimsFunction` und nicht `accessTokenFunction`: Die Schwaerzung in
      // `redactSensitive` trifft jeden Schluessel, der "token" enthaelt, und
      // machte aus dem Namen ein "[REDACTED]". Die Regel bleibt grob und
      // richtig; der Eintrag bekommt Namen, die nichts verbergen, was kein
      // Geheimnis ist. Ein Funktionsname und eine Anspruchsliste sind keine:
      // Die Liste steht danach in jedem Token.
      metadata: {
        signInFunction: parsed.hooks.signIn.functionName ?? "none",
        signInTimeoutMs: parsed.hooks.signIn.timeoutMs,
        claimsFunction: parsed.hooks.accessTokenClaims.functionName ?? "none",
        claimsTimeoutMs: parsed.hooks.accessTokenClaims.timeoutMs,
        // Getrennt mit einem Punkt und nicht mit einem Komma: Die Bereinigung
        // der Audit-Kette laesst in einem Metadatenwert nur `[A-Za-z0-9_:.-]`
        // durch, und ein Wert mit einem Komma faellt dort **still** weg. Ein
        // ungewohntes Trennzeichen ist besser als eine Zeile, in der die
        // erklaerten Ansprueche unbemerkt fehlen. Eine leere Liste ist ein
        // leerer Wert und kein fehlender Schluessel.
        claimsAllowed: parsed.hooks.accessTokenClaims.claims.join("."),
      },
    });
    return publicHooks(settings.hooks, settings.updatedAt, true);
  }

  /* ---------------------------------------------------------------- *
   * Fremde Anbieter (2.80)
   * ---------------------------------------------------------------- */

  /**
   * Die hinterlegten fremden Anbieter dieser Umgebung, samt den Grenzen und der
   * Entscheidung, welche Rolle ein fremdes Token hoechstens bekommt.
   */
  async listThirdPartyProviders(scope: ProjectAuthScope): Promise<PublicProjectAuthThirdParty> {
    assertScope(scope);
    const providers = await this.dependencies.repository.listThirdPartyProviders(scope);
    return publicThirdParty(providers);
  }

  /**
   * Legt einen fremden Anbieter an.
   *
   * Eine Grenze steht hier und nicht in der Datenbank, weil die Datenbank sie
   * nicht kennen kann: die Zahl der Anbieter je Umgebung. Jeder zusaetzliche
   * Eintrag ist eine zusaetzliche Vertrauensbeziehung, und die Liste soll
   * ueberschaubar bleiben; zehn ist dieselbe Zahl, die der OIDC-Katalog seit
   * 2.29 zulaesst.
   *
   * Was hier **nicht** geprueft wird, und warum das nicht fehlt: Ein Eintrag
   * darf denselben Aussteller nennen, den QKERN selbst benutzt. Er wuerde damit
   * nichts gewinnen. Die Data API prueft ein vorgelegtes Token zuerst als
   * eigenes; erst wenn das scheitert, kommt dieser Weg. Und selbst dann bleibt
   * die Obergrenze `authenticated`, denn die haengt am Eintrag und nicht am
   * Token. Ein Verbot waere hier eine Regel, die nichts verhindert, und eine
   * solche Regel verdeckt, wo der Schutz wirklich sitzt.
   *
   * Der Audit-Eintrag traegt Name, Aussteller, Schluesselsatz, Publikum und die
   * Rollenabbildung. Nichts davon ist ein Geheimnis: Der Aussteller steht in
   * jedem Token, der Schluesselsatz ist eine oeffentliche Adresse, und die Rolle
   * ist die Entscheidung, die dieser Eintrag trifft. Genau darum steht sie dort.
   */
  async createThirdPartyProvider(
    scope: ProjectAuthScope,
    input: unknown,
    admin?: ProjectAuthAdminActor,
  ): Promise<PublicProjectAuthThirdParty> {
    assertScope(scope);
    const parsed = parseProjectAuthThirdPartyProvider(input);
    if (!parsed.ok) throw new ProjectAuthThirdPartyError(parsed.reason, parsed.field);
    const existing = await this.dependencies.repository.listThirdPartyProviders(scope);
    if (existing.length >= PROJECT_AUTH_THIRD_PARTY_BOUNDS.providers.max) {
      throw new ProjectAuthThirdPartyError("too_many_providers", "providers");
    }
    const now = this.now();
    let created: ProjectAuthThirdPartyProvider;
    try {
      created = await this.dependencies.repository.createThirdPartyProvider(
        scope, { ...parsed.provider, id: this.id() }, now,
      );
    } catch (error) {
      if (error instanceof DuplicateProjectAuthIdentityError) {
        throw new ProjectAuthThirdPartyError("duplicate", "issuer");
      }
      throw error;
    }
    await this.recordAudit({
      scope, action: "project_auth.third_party_provider.created",
      actorType: admin ? "admin" : "system", actorRef: admin ? admin.id : "system",
      resourceRef: `project_auth_third_party:${created.id}`,
      status: "succeeded",
      metadata: {
        provider: created.name,
        issuer: created.issuer,
        jwks: created.jwksUri,
        // Getrennt mit einem Leerzeichen statt mit einem Komma: Die Bereinigung
        // der Audit-Kette laesst in einem Metadatenwert nur `[A-Za-z0-9_:.-]`
        // durch, und ein Wert mit einem Komma faellt dort **still** weg. Ein
        // ungewohntes Trennzeichen ist besser als eine Zeile, in der das
        // erwartete Publikum unbemerkt fehlt.
        audiences: created.audiences.join(" "),
        subjectClaim: created.subjectClaim,
        roleClaim: created.roleClaim ?? "none",
        defaultRole: created.defaultRole,
      },
    });
    return publicThirdParty(await this.dependencies.repository.listThirdPartyProviders(scope));
  }

  /**
   * Entfernt einen fremden Anbieter.
   *
   * Das ist der einzige Widerruf, den es hier gibt, und er ist grob: Er nimmt
   * nicht ein Token zurueck, sondern alle. Ab dem naechsten Aufruf findet die
   * Pruefung keinen Eintrag mehr zu diesem Aussteller, und jedes Token dieses
   * Dienstes faellt, auch die noch gueltigen. Feiner geht es nicht, weil QKERN
   * kein Token widerrufen kann, das es nicht ausgegeben hat.
   */
  async deleteThirdPartyProvider(
    scope: ProjectAuthScope,
    providerId: string,
    admin?: ProjectAuthAdminActor,
  ): Promise<PublicProjectAuthThirdParty> {
    assertScope(scope);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(providerId)) {
      throw new ProjectAuthError("INVALID_INPUT");
    }
    const removed = await this.dependencies.repository.deleteThirdPartyProvider(scope, providerId);
    if (!removed) throw new ProjectAuthError("RESOURCE_NOT_FOUND");
    await this.recordAudit({
      scope, action: "project_auth.third_party_provider.removed",
      actorType: admin ? "admin" : "system", actorRef: admin ? admin.id : "system",
      resourceRef: `project_auth_third_party:${providerId}`,
      status: "succeeded",
      metadata: { provider: providerId },
    });
    return publicThirdParty(await this.dependencies.repository.listThirdPartyProviders(scope));
  }

  /* ---------------------------------------------------------------- *
   * OAuth-Server (2.82)
   * ---------------------------------------------------------------- */

  /**
   * Die hinterlegten OAuth-Clients dieser Umgebung, samt den Bereichen, der
   * Rolle und den Grenzen.
   */
  async listOAuthClients(scope: ProjectAuthScope): Promise<PublicProjectAuthOAuthServer> {
    assertScope(scope);
    return this.oauthServerView(scope);
  }

  /**
   * Der Stand dieser Flaeche: Clients und Zustimmungen in einer Antwort.
   *
   * An einer Stelle, weil jede schreibende Methode denselben Stand
   * zurueckgibt, und weil die Console sonst zwei Aufrufe braeuchte, um eine
   * Seite zu zeichnen. Eine Zeile mehr als der Rand wird geholt, damit die
   * Antwort sagen kann, dass sie abgeschnitten ist.
   */
  private async oauthServerView(scope: ProjectAuthScope): Promise<PublicProjectAuthOAuthServer> {
    const [clients, consents, tokens] = await Promise.all([
      this.dependencies.repository.listOAuthClients(scope),
      this.dependencies.repository.listOAuthConsents(
        scope, PROJECT_AUTH_OAUTH_BOUNDS.consents.max + 1,
      ),
      this.dependencies.repository.listOAuthTokens(
        scope, PROJECT_AUTH_OAUTH_BOUNDS.tokens.max + 1,
      ),
    ]);
    return publicOAuthServer(clients, consents, tokens);
  }

  /**
   * Eine Zustimmung erteilen (2.92).
   *
   * **Wer sie erteilt.** Der Nutzer aus seinem eigenen Access Token, genau wie
   * beim Anlauf, und nie eine Kennung aus dem Rumpf. Was diese Zeile belegt,
   * steht im Kopf von `oauth.ts` und auf der Seite, und es ist schmaler als
   * eine Zustimmungsseite: dass ein Aufrufer mit dem gueltigen Token dieses
   * Nutzers genau diese Bereiche ausdruecklich genannt hat, zu diesem
   * Zeitpunkt, in einer Anfrage, die nichts anderes tut. Nicht belegt ist, dass
   * ein Mensch eine Liste gelesen hat; QKERN hat keine eigene Zustimmungsseite,
   * und diese Methode tut nicht so, als haette es eine.
   *
   * **Warum das eine eigene Route ist und nicht Teil des Anlaufs.** Legte der
   * Anlauf die Zustimmung nebenbei mit an, waere die Zustimmung wieder das,
   * was sie in 2.82 war: eine Behauptung der Anwendung, nur mit einer Zeile
   * daneben. Getrennt ist sie eine eigene Handlung mit eigener Audit-Zeile, und
   * der Anlauf kann sich auf etwas berufen, das vorher da war.
   *
   * **Zweimal dasselbe ist einmal.** Dieselben Bereiche, derselbe Client,
   * derselbe Nutzer: dieselbe Zeile, mit ihrem urspruenglichen Zeitpunkt. Der
   * Teilindex aus 0064 haelt das auch dann, wenn zwei Anfragen gleichzeitig
   * kommen; die zweite faellt in den Fehler und liest danach die Zeile der
   * ersten.
   */
  async grantOAuthConsent(
    scope: ProjectAuthScope,
    accessToken: string,
    input: unknown,
  ): Promise<{
    consentId: string;
    clientName: string;
    scopes: string[];
    grantedAt: string;
  }> {
    assertScope(scope);
    const parsed = parseProjectAuthOAuthConsent(input);
    if (!parsed.ok) throw new ProjectAuthOAuthError(parsed.reason, parsed.field);
    // Erst der Nutzer, dann der Client, dieselbe Reihenfolge wie beim Anlauf:
    // Ein Aufrufer ohne gueltiges Token soll nicht erfahren, welche Clients es
    // gibt.
    const principal = await this.verifyAccess(scope, accessToken);
    const client = await this.dependencies.repository.findOAuthClientByName(
      scope, parsed.request.clientName,
    );
    if (!client) throw new ProjectAuthOAuthError("client_unknown", "clientId");
    // Niemand kann mehr erlauben, als der Client fuehrt. Keine stille Kuerzung,
    // aus demselben Grund wie beim Anlauf: Eine gekuerzte Zustimmung saehe fuer
    // die Anwendung wie ein Erfolg aus, und der Nutzer haette etwas erlaubt,
    // was er so nicht gelesen hat.
    if (!parsed.request.scopes.every((entry) => client.scopes.includes(entry))) {
      throw new ProjectAuthOAuthError("scope_not_granted", "scopes");
    }
    const now = this.now();
    const existing = await this.dependencies.repository.findOAuthConsent(
      scope, client.id, principal.user.id, parsed.request.scopes,
    );
    let consent = existing;
    if (!consent) {
      try {
        consent = await this.dependencies.repository.createOAuthConsent(scope, {
          id: this.id(), clientId: client.id, userId: principal.user.id,
          scopes: parsed.request.scopes, grantedAt: now,
        });
      } catch (error) {
        if (!(error instanceof DuplicateProjectAuthIdentityError)) throw error;
        // Zwei gleichzeitige Zustimmungen. Die Zeile der anderen ist dieselbe
        // Zustimmung, also wird sie gelesen und nicht als Fehler gemeldet.
        consent = await this.dependencies.repository.findOAuthConsent(
          scope, client.id, principal.user.id, parsed.request.scopes,
        );
        if (!consent) throw error;
      }
    }
    // Die Audit-Zeile nur fuer die wirklich neue Zustimmung. Eine zweite
    // Erteilung ist keine Aenderung, und eine Kette, die Nichtaenderungen
    // mitschreibt, macht aus jedem Programmstart eine Handlung.
    if (!existing) {
      await this.recordAudit({
        scope, action: "project_auth.oauth_consent.granted",
        actorType: "app_user", actorRef: projectAuthUserRef(principal.user.id),
        resourceRef: `project_auth_oauth_consent:${consent.id}`,
        status: "succeeded",
        metadata: { client: client.name, scopes: consent.scopes.join(" ") },
      });
    }
    return {
      consentId: consent.id,
      clientName: client.name,
      scopes: [...consent.scopes],
      grantedAt: consent.grantedAt.toISOString(),
    };
  }

  /**
   * Eine Zustimmung widerrufen (2.92).
   *
   * **Sofort, und die Token dieser Zustimmung gelten nicht mehr.** Das braucht
   * keinen zweiten Schritt: Ein Token gilt, weil eine Zeile existiert, und seit
   * 0064 zusaetzlich nur, solange seine Zustimmung gilt. `verifyOAuthToken`
   * liest beides in einer Abfrage.
   *
   * **Die Zeile bleibt stehen**, mit ihrem Zeitpunkt und ihrem
   * Widerrufszeitpunkt. Dieselbe Entscheidung wie bei den S3-Schluesseln aus
   * 2.78: Wer widerruft, will die Spur behalten. Die Tabelle hat fuer diese
   * Rolle gar kein DELETE.
   *
   * Ein zweiter Widerruf derselben Zustimmung ist `RESOURCE_NOT_FOUND` und
   * nicht ein zweiter Erfolg: Sonst schriebe jeder Klick einen neuen Zeitpunkt,
   * und der Zeitpunkt des Widerrufs waere der des letzten Klicks statt der des
   * Widerrufs.
   */
  async revokeOAuthConsent(
    scope: ProjectAuthScope,
    consentId: string,
    admin?: ProjectAuthAdminActor,
  ): Promise<PublicProjectAuthOAuthServer> {
    assertScope(scope);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(consentId)) {
      throw new ProjectAuthError("INVALID_INPUT");
    }
    const revoked = await this.dependencies.repository.revokeOAuthConsent(
      scope, consentId, this.now(),
    );
    if (!revoked) throw new ProjectAuthError("RESOURCE_NOT_FOUND");
    await this.recordAudit({
      scope, action: "project_auth.oauth_consent.revoked",
      actorType: admin ? "admin" : "system", actorRef: admin ? admin.id : "system",
      resourceRef: `project_auth_oauth_consent:${revoked.id}`,
      status: "succeeded",
      metadata: { user: revoked.userId, scopes: revoked.scopes.join(" ") },
    });
    return this.oauthServerView(scope);
  }

  /**
   * Genau ein Token widerrufen (2.93).
   *
   * **Die Luecke, die das schliesst.** Bis hierher fiel ein Token nur zusammen
   * mit etwas Groesserem: mit dem Widerruf seiner Zustimmung, also mit allen
   * Token derselben Erlaubnis, oder mit dem Entfernen des Clients, also mit
   * allen Token aller Nutzer. Ein einzelnes Token, das in falsche Haende
   * geraten ist, war damit nur zu stoppen, indem man einem Nutzer seine
   * Erlaubnis nahm oder eine ganze Anwendung abschaltete.
   *
   * **Und er ist ein Loeschen, anders als beim Widerruf einer Zustimmung.** Ein
   * Token gilt, weil eine Zeile existiert; faellt die Zeile, gilt es nicht
   * mehr. Die Spur bleibt trotzdem: die Zustimmung, an der es hing, steht
   * weiter da, und der Widerruf schreibt eine Audit-Zeile mit Nutzer, Client
   * und Bereichen. Eine Spalte `revoked_at` am Token waere eine zweite
   * Bedingung im heissen Weg, die jemand vergessen kann; eine fehlende Zeile
   * kann niemand vergessen.
   *
   * **Die Zustimmung bleibt gueltig**, und das ist keine Nachlaessigkeit: Wer
   * ein Token zurueckzieht, sagt, dass dieses Geheimnis nichts mehr taugt,
   * nicht, dass der Nutzer seine Erlaubnis zurueckgenommen hat. Die Anwendung
   * darf sich darum ein neues holen. Wer beides will, widerruft die
   * Zustimmung; die Seite sagt diesen Unterschied an beiden Knoepfen.
   *
   * Ein zweiter Widerruf desselben Tokens ist `RESOURCE_NOT_FOUND`, wie bei der
   * Zustimmung: Es ist nichts mehr da, was zurueckzunehmen waere.
   */
  async revokeOAuthToken(
    scope: ProjectAuthScope,
    tokenId: string,
    admin?: ProjectAuthAdminActor,
  ): Promise<PublicProjectAuthOAuthServer> {
    assertScope(scope);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tokenId)) {
      throw new ProjectAuthError("INVALID_INPUT");
    }
    const revoked = await this.dependencies.repository.revokeOAuthToken(scope, tokenId);
    if (!revoked) throw new ProjectAuthError("RESOURCE_NOT_FOUND");
    await this.recordAudit({
      scope, action: "project_auth.oauth_token.revoked",
      actorType: admin ? "admin" : "system", actorRef: admin ? admin.id : "system",
      resourceRef: `project_auth_oauth_token:${revoked.id}`,
      status: "succeeded",
      metadata: { user: revoked.userId, scopes: revoked.scopes.join(" ") },
    });
    return this.oauthServerView(scope);
  }

  /**
   * Legt einen OAuth-Client an.
   *
   * Eine Grenze steht hier und nicht in der Datenbank, weil die Datenbank sie
   * nicht kennen kann: die Zahl der Clients je Umgebung. Jeder zusaetzliche
   * Client ist eine laufende Erlaubnis, im Namen von Nutzern dieses Projekts zu
   * arbeiten, und die Liste soll ueberschaubar bleiben.
   *
   * **Es gibt kein Geheimnis zurueckzugeben**, und darum gibt diese Methode
   * keines. Sie antwortet mit der Liste nach der Aenderung, wie ihre Geschwister
   * aus 2.77 und 2.80. Wer hier ein Geheimnis erwartet, sucht den vertraulichen
   * Client, und den gibt es nicht: Der Grund steht in `oauth.ts` und in
   * Migration 0062.
   *
   * Der Audit-Eintrag traegt Name, Anzahl der Ruecksprungziele und die Bereiche.
   * Nichts davon ist ein Geheimnis: Der Name steht in jeder Anfrage der
   * Anwendung, und die Bereiche sind die Erlaubnis, die dieser Eintrag erteilt.
   * Die Ziele selbst stehen nicht darin, weil die Bereinigung der Audit-Kette aus
   * einer Adresse ohnehin nur Bruchstuecke durchliesse; wer sie sehen will,
   * liest die Liste in der Console.
   */
  async createOAuthClient(
    scope: ProjectAuthScope,
    input: unknown,
    admin?: ProjectAuthAdminActor,
  ): Promise<PublicProjectAuthOAuthServer> {
    assertScope(scope);
    const parsed = parseProjectAuthOAuthClient(input);
    if (!parsed.ok) throw new ProjectAuthOAuthError(parsed.reason, parsed.field);
    const existing = await this.dependencies.repository.listOAuthClients(scope);
    if (existing.length >= PROJECT_AUTH_OAUTH_BOUNDS.clients.max) {
      throw new ProjectAuthOAuthError("too_many_clients", "clients");
    }
    const now = this.now();
    let created: ProjectAuthOAuthClient;
    try {
      created = await this.dependencies.repository.createOAuthClient(
        scope, { ...parsed.client, id: this.id() }, now,
      );
    } catch (error) {
      if (error instanceof DuplicateProjectAuthIdentityError) {
        throw new ProjectAuthOAuthError("duplicate", "name");
      }
      throw error;
    }
    await this.recordAudit({
      scope, action: "project_auth.oauth_client.created",
      actorType: admin ? "admin" : "system", actorRef: admin ? admin.id : "system",
      resourceRef: `project_auth_oauth_client:${created.id}`,
      status: "succeeded",
      metadata: {
        client: created.name,
        redirectTargets: created.redirectUris.length,
        // Getrennt mit einem Leerzeichen und nicht mit einem Komma: Die
        // Bereinigung der Audit-Kette laesst in einem Metadatenwert kein Komma
        // durch, und ein Wert mit einem Komma faellt dort **still** weg.
        scopes: created.scopes.join(" "),
      },
    });
    return this.oauthServerView(scope);
  }

  /**
   * Entfernt einen OAuth-Client, und damit seine Codes und seine Token.
   *
   * Das ist der einzige Widerruf dieser Flaeche, und er ist grob: Er nimmt nicht
   * ein Token zurueck, sondern alle Token dieses Clients, von allen Nutzern. Das
   * ist Absicht und keine Sparsamkeit: Ein Nutzer hat einer **Anwendung**
   * zugestimmt, nicht einem Token, das er nie gesehen hat. Wer eine einzelne
   * Zustimmung zurueckziehen will, findet hier nichts dafuer, und die Seite sagt
   * das.
   */
  async deleteOAuthClient(
    scope: ProjectAuthScope,
    clientId: string,
    admin?: ProjectAuthAdminActor,
  ): Promise<PublicProjectAuthOAuthServer> {
    assertScope(scope);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
      throw new ProjectAuthError("INVALID_INPUT");
    }
    const removed = await this.dependencies.repository.deleteOAuthClient(scope, clientId);
    if (!removed) throw new ProjectAuthError("RESOURCE_NOT_FOUND");
    await this.recordAudit({
      scope, action: "project_auth.oauth_client.removed",
      actorType: admin ? "admin" : "system", actorRef: admin ? admin.id : "system",
      resourceRef: `project_auth_oauth_client:${clientId}`,
      status: "succeeded",
      metadata: { client: clientId },
    });
    return this.oauthServerView(scope);
  }

  /**
   * Die Zustimmung: Ein angemeldeter Nutzer dieses Projekts erlaubt einem
   * Client, in seinem Namen zu arbeiten, und bekommt einen Code dafuer.
   *
   * **Der Nutzer kommt aus seinem eigenen Access Token und nicht aus der
   * Anfrage.** Das ist die tragende Zeile dieser Methode. Wer zustimmt, ist der,
   * der sich bei QKERN angemeldet hat, und keine Kennung, die im Rumpf steht.
   * Eine Kennung im Rumpf waere die Erlaubnis, im Namen eines Fremden
   * zuzustimmen.
   *
   * **QKERN antwortet mit JSON und nicht mit einem 302.** Zurueck gehen der
   * Code, das Ruecksprungziel und der `state`; die Anwendung baut ihre Adresse
   * selbst. Dieselbe Grenze zieht 2.54 bei den Ruecksprungzielen der Anmeldung,
   * und sie steht dort mit demselben Grund: Ein Ziel, das ein Dienst selbst
   * anspringt, ist eine Flaeche, auf der jede Luecke in der Pruefung sofort ein
   * offener Umleiter ist.
   *
   * **Was hier nicht passiert:** Es entsteht keine Zustimmungsseite von QKERN.
   * Die Anwendung, in der der Nutzer angemeldet ist, zeigt ihm, was er erlaubt,
   * und ruft danach diese Route. Das ist ehrlich gesagt eine Verlagerung: QKERN
   * kann nicht beweisen, dass der Nutzer eine Liste gesehen hat. Was QKERN
   * beweisen kann, prueft es: dass der Nutzer angemeldet ist, dass der Client
   * hinterlegt ist, dass das Ziel eines seiner Ziele ist und dass die Bereiche
   * in seinen Bereichen liegen.
   *
   * **Und seit 2.92 eines mehr:** dass zu genau diesen Bereichen eine geltende
   * Zustimmung dieses Nutzers fuer diesen Client in der Datenbank steht. Ohne
   * sie gibt es keinen Code, und die Ablehnung heisst `consent_missing`. Damit
   * ist die Zustimmung eine Tatsache mit Zeitpunkt statt einer Behauptung der
   * Anwendung, auch ohne eigene Seite. Der Code haengt an dieser einen Zeile,
   * und darum trifft ein Widerruf spaeter genau ihn und das Token daraus.
   */
  async authorizeOAuth(
    scope: ProjectAuthScope,
    accessToken: string,
    input: unknown,
  ): Promise<{
    code: string;
    codeExpiresAt: string;
    redirectUri: string;
    state: string | null;
    scopes: string[];
    clientName: string;
  }> {
    assertScope(scope);
    const parsed = parseProjectAuthOAuthAuthorize(input);
    if (!parsed.ok) throw new ProjectAuthOAuthError(parsed.reason, parsed.field);
    // Erst der Nutzer, dann der Client. Die Reihenfolge ist Absicht: Ein
    // Aufrufer ohne gueltiges Token soll nicht erfahren, welche Clients es gibt.
    const principal = await this.verifyAccess(scope, accessToken);
    const client = await this.dependencies.repository.findOAuthClientByName(scope, parsed.request.clientName);
    if (!client) throw new ProjectAuthOAuthError("client_unknown", "clientId");
    const checked = checkProjectAuthOAuthAuthorize(parsed.request, client);
    if (!checked.ok) throw new ProjectAuthOAuthError(checked.reason, checked.field);
    // Die Zustimmung, und zwar zu genau diesen Bereichen. Der Grund fuer
    // "genau" steht bei `projectAuthOAuthConsentCovers`: Ein Vergleich auf
    // Teilmengen liesse mehrere Zeilen als Treffer zu, und dann entschiede die
    // Reihenfolge der Zeilen, an welcher der Code haengt.
    const consent = await this.dependencies.repository.findOAuthConsent(
      scope, client.id, principal.user.id, parsed.request.scopes,
    );
    if (!consent) throw new ProjectAuthOAuthError("consent_missing", "scopes");
    const now = this.now();
    const code = this.opaqueToken("oauthcode");
    if (!PROJECT_AUTH_OAUTH_CODE.test(code)) throw new ProjectAuthError("INVALID_INPUT");
    const expiresAt = new Date(now.getTime() + PROJECT_AUTH_OAUTH_BOUNDS.codeTtlSeconds * 1000);
    const stored = await this.dependencies.repository.createOAuthCode(scope, {
      id: this.id(), clientId: client.id, userId: principal.user.id, consentId: consent.id,
      redirectUri: parsed.request.redirectUri, scopes: parsed.request.scopes,
      codeHash: hashProjectAuthToken(code), codeChallenge: parsed.request.codeChallenge,
      createdAt: now, expiresAt,
    });
    await this.recordAudit({
      scope, action: "project_auth.oauth_code.issued",
      actorType: "app_user", actorRef: projectAuthUserRef(principal.user.id),
      resourceRef: `project_auth_oauth_code:${stored.id}`,
      status: "succeeded",
      metadata: { client: client.name, scopes: stored.scopes.join(" ") },
    });
    return {
      code,
      codeExpiresAt: stored.expiresAt.toISOString(),
      redirectUri: stored.redirectUri,
      // Unveraendert zurueck, und nur zurueck. QKERN liest den `state` nicht und
      // legt nichts darin ab: Er gehoert der Anwendung, und sie prueft mit ihm,
      // dass der Ruecksprung zu ihrem eigenen Anlauf gehoert.
      state: parsed.request.state,
      scopes: [...stored.scopes],
      clientName: client.name,
    };
  }

  /**
   * Das Einloesen: Aus einem Code wird ein Token, genau einmal.
   *
   * Die Reihenfolge der Pruefungen ist die Zusage dieser Methode:
   *
   * 1. **Der Code wird verbraucht, bevor irgendetwas anderes geprueft wird.**
   *    Finden und Verbrauchen passieren in einer Anweisung (siehe
   *    `consumeOAuthCode`). Ein zweites Einloesen findet darum keinen Code mehr,
   *    auch nicht, wenn beide Anfragen gleichzeitig kommen, und auch nicht, wenn
   *    die erste danach an der Pruefsumme gescheitert ist. Das ist der
   *    wesentliche Punkt: Ein Code, der einmal vorgezeigt wurde, ist verbraucht,
   *    gleich wie es weitergeht. Wer ihn erst nach erfolgreicher Pruefung
   *    verbrauchte, liesse einem Angreifer beliebig viele Versuche mit dem
   *    Prueftext.
   * 2. **Dann der Client.** Ein Code, der zu einem anderen Client gehoert, faellt
   *    hier, und der Code ist trotzdem weg.
   * 3. **Dann das Ruecksprungziel**, Zeichen fuer Zeichen gegen den Wert, unter
   *    dem der Code ausgegeben wurde.
   * 4. **Dann der Prueftext**, gegen die gespeicherte Pruefsumme, in fester
   *    Zeit.
   *
   * Jede Ablehnung ist derselbe Fehler nach draussen: `INVALID_TOKEN`, also 401
   * und "Authentication failed". Ein Aufrufer, der erfaehrt, ob sein Ziel oder
   * sein Prueftext nicht gepasst hat, bekommt ein Werkzeug zum Probieren; wer
   * den Grund braucht, ist der Betreiber, und er liest ihn im Audit. Die eine
   * Ausnahme ist das zweite Einloesen: Es bekommt `TOKEN_REPLAYED`, weil das
   * derselbe Ausgang mit einem eigenen Namen im Audit ist und der Aufrufer davon
   * nichts erfaehrt, was er nicht schon weiss.
   */
  async exchangeOAuthCode(
    scope: ProjectAuthScope,
    input: unknown,
  ): Promise<{
    accessToken: string;
    tokenType: "Bearer";
    expiresIn: number;
    expiresAt: string;
    scopes: string[];
    clientName: string;
  }> {
    assertScope(scope);
    const parsed = parseProjectAuthOAuthExchange(input);
    if (!parsed.ok) throw new ProjectAuthOAuthError(parsed.reason, parsed.field);
    const request = parsed.request;
    const now = this.now();
    const consumed = await this.dependencies.repository.consumeOAuthCode(
      scope, hashProjectAuthToken(request.code), now,
    );
    if (!consumed) {
      // Kein Code, ein abgelaufener Code oder ein zweites Einloesen. Die drei
      // sind hier nicht auseinanderzuhalten, und sie muessen es auch nicht sein:
      // Nach draussen ist es dasselbe, und im Audit steht der Versuch.
      await this.recordAudit({
        scope, action: "project_auth.oauth_token.refused",
        actorType: "system", actorRef: "system",
        resourceRef: `project_auth_oauth_client:${request.clientName}`,
        status: "failed", metadata: { reason: "code_not_redeemable", client: request.clientName },
      });
      throw new ProjectAuthError("TOKEN_REPLAYED");
    }
    const client = await this.dependencies.repository.findOAuthClientByName(scope, request.clientName);
    const refuse = async (reason: string): Promise<never> => {
      await this.recordAudit({
        scope, action: "project_auth.oauth_token.refused",
        actorType: "system", actorRef: "system",
        resourceRef: `project_auth_oauth_code:${consumed.id}`,
        status: "failed", metadata: { reason, client: request.clientName },
      });
      throw new ProjectAuthError("INVALID_TOKEN");
    };
    if (!client || client.id !== consumed.clientId) return refuse("client_mismatch");
    if (consumed.redirectUri !== request.redirectUri) return refuse("redirect_uri_mismatch");
    if (!projectAuthOAuthVerifierMatches({
      codeVerifier: request.codeVerifier, codeChallenge: consumed.codeChallenge,
    })) return refuse("verifier_mismatch");
    // Der Nutzer muss es noch geben und aktiv sein. Ein Code ueberlebt eine
    // Sperrung um bis zu eine Minute, und eine Minute ist genug, um ein Token zu
    // holen, das zwoelf Stunden gilt.
    const user = await this.dependencies.repository.findUserById(scope, consumed.userId);
    if (!user || user.status !== "active") return refuse("user_unavailable");
    // Und die Zustimmung muss noch gelten (2.92). Ein Code ueberlebt einen
    // Widerruf sonst um bis zu eine Minute, und eine Minute reicht, um ein
    // Token zu holen, das eine Stunde gilt. Ein Code ohne Zustimmung ist einer
    // aus der Zeit vor Migration 0064; er wird nicht mehr eingeloest.
    const consent = consumed.consentId === null ? null
      : await this.dependencies.repository.findOAuthConsentById(scope, consumed.consentId);
    if (consent === null || !projectAuthOAuthConsentHolds(consent)) return refuse("consent_revoked");
    const token = this.opaqueToken("oauth");
    if (!PROJECT_AUTH_OAUTH_TOKEN.test(token)) throw new ProjectAuthError("INVALID_INPUT");
    const expiresAt = new Date(now.getTime() + PROJECT_AUTH_OAUTH_BOUNDS.tokenTtlSeconds * 1000);
    const issued = await this.dependencies.repository.createOAuthToken(scope, {
      id: this.id(), clientId: client.id, userId: user.id, codeId: consumed.id,
      consentId: consent.id,
      tokenHash: hashProjectAuthToken(token), scopes: consumed.scopes,
      createdAt: now, expiresAt,
    });
    await this.recordAudit({
      scope, action: "project_auth.oauth_token.issued",
      actorType: "app_user", actorRef: projectAuthUserRef(user.id),
      resourceRef: `project_auth_oauth_token:${issued.id}`,
      status: "succeeded",
      metadata: { client: client.name, scopes: issued.scopes.join(" ") },
    });
    return {
      accessToken: token,
      tokenType: "Bearer",
      expiresIn: PROJECT_AUTH_OAUTH_BOUNDS.tokenTtlSeconds,
      expiresAt: issued.expiresAt.toISOString(),
      scopes: [...issued.scopes],
      clientName: client.name,
      // Kein `refreshToken` in dieser Antwort, und keines mit dem Wert `null`.
      // Ein Feld, das immer leer ist, laedt dazu ein, es eines Tages zu fuellen,
      // ohne dass jemand die Entscheidung dahinter noch einmal trifft.
    };
  }

  /**
   * Prueft ein vorgelegtes OAuth-Token (2.82).
   *
   * Das Token ist undurchsichtig: Gueltig ist es, weil eine Zeile existiert, und
   * nicht, weil eine Unterschrift stimmt. Geprueft wird darum in dieser
   * Reihenfolge: Form, Zeile, Uhr.
   *
   * Die Form zuerst, und zwar bevor die Datenbank gefragt wird. Ein Aufrufer,
   * der Muell schickt, soll keine Abfrage kosten, und die Pruefsumme eines
   * Wertes, der nie ein Token war, hat in keiner Abfrage etwas zu suchen.
   *
   * **Die Rolle wird nicht gelesen, sondern gesetzt.** Sie kommt aus
   * `PROJECT_AUTH_OAUTH_ROLE` und nicht aus der Zeile, und darum gibt es keinen
   * Wert in dieser Datenbank, der ein Token auf `service_role` heben koennte.
   * Das ist derselbe Gedanke wie bei den fremden Anbietern (2.80), nur schaerfer:
   * Dort gab es eine Spalte mit zwei erlaubten Werten, hier gibt es gar keine.
   */
  async verifyOAuthToken(
    scope: ProjectAuthScope,
    token: string,
  ): Promise<{ ok: true; identity: ProjectAuthOAuthIdentity }
    | { ok: false; reason: ProjectAuthOAuthRefusal }> {
    assertScope(scope);
    if (typeof token !== "string" || token.length > PROJECT_AUTH_OAUTH_BOUNDS.tokenLength ||
        !PROJECT_AUTH_OAUTH_TOKEN.test(token)) {
      return { ok: false, reason: "malformed" };
    }
    const found = await this.dependencies.repository.findOAuthTokenByHash(
      scope, hashProjectAuthToken(token),
    );
    if (!found) return { ok: false, reason: "unknown" };
    if (found.token.expiresAt <= this.now()) return { ok: false, reason: "expired" };
    // Die Zustimmung hinter diesem Token (2.92). Sie kommt aus derselben
    // Abfrage wie das Token, kostet also nichts zusaetzlich, und sie ist der
    // Grund, warum ein Widerruf sofort wirkt statt beim naechsten Ablauf. Ein
    // Token ohne Zustimmung faellt ebenfalls: Es ist eines aus der Zeit vor
    // Migration 0064, und ein Token ohne Zustimmung ist genau das, was dieser
    // Schnitt abschafft.
    if (!projectAuthOAuthConsentHolds(found.consent)) return { ok: false, reason: "revoked" };
    const user = await this.dependencies.repository.findUserById(scope, found.token.userId);
    // Ein gesperrter oder geloeschter Nutzer laesst das Token fallen. Ohne diese
    // Zeile waere eine Sperrung unter Auth → Nutzer eine Sperrung nur fuer die
    // eigene Anwendung des Projekts, und ein fremder Client arbeitete weiter im
    // Namen eines Menschen, dem das Projekt den Zugang genommen hat.
    if (!user || user.status !== "active") return { ok: false, reason: "unknown" };
    return {
      ok: true,
      identity: {
        clientId: found.token.clientId,
        clientName: found.clientName,
        userId: found.token.userId,
        email: user.email,
        scopes: [...found.token.scopes],
        role: PROJECT_AUTH_OAUTH_ROLE,
        expiresAt: found.token.expiresAt,
      },
    };
  }

  /**
   * Prueft ein fremdes Token und gibt Identitaet und Rolle zurueck (2.80).
   *
   * **Warum der Aussteller aus dem ungeprueften Token gelesen wird:** Um die
   * Unterschrift zu pruefen, braucht QKERN den Schluesselsatz, und um den zu
   * kennen, braucht es den Anbieter. Die einzige Angabe, mit der ein Token
   * seinen Anbieter nennt, ist `iss`. Gelesen wird er darum vor der Pruefung,
   * und er wird dabei als das behandelt, was er ist: eine Behauptung. Er dient
   * nur dem Nachschlagen. Danach prueft `verifyProjectAuthThirdPartyToken`
   * denselben Anspruch noch einmal gegen den gefundenen Eintrag, und zwar nach
   * der Signatur. Ein Token mit einem erfundenen `iss` findet keinen Eintrag;
   * ein Token, das einen fremden Eintrag nennt, faellt an dessen Schluesselsatz.
   *
   * **Was bei fehlendem Schluesselsatz gilt:** Ablehnung. Ein Aussteller, dessen
   * Satz nicht zu holen ist, ist ein Aussteller, dessen Token heute nicht
   * geprueft werden kann, und ungeprueft annehmen ist keine Betriebsart. Das
   * heisst auch: Ein Ausfall beim Anbieter sperrt die Nutzer dieses Anbieters
   * aus, und die Console sagt diesen Satz.
   *
   * **Der zweite Versuch:** Findet die Pruefung im gehaltenen Schluesselsatz
   * keinen passenden Schluessel, wird einmal auf einen frischen bestanden. Ohne
   * das waere ein gedrehter Schluessel bis zum Ablauf der Frist ein Ausfall. Der
   * Mindestabstand dafuer steckt im Port, nicht hier: Er soll auch fuer einen
   * zweiten Aufrufer gelten.
   */
  async verifyThirdPartyToken(
    scope: ProjectAuthScope,
    token: string,
  ): Promise<{ ok: true; identity: ProjectAuthThirdPartyIdentity }
    | { ok: false; reason: ProjectAuthThirdPartyRefusal | "no_provider" | "no_key_set" }> {
    assertScope(scope);
    const keys = this.dependencies.thirdPartyKeys;
    if (!keys) return { ok: false, reason: "no_key_set" };
    const issuer = unverifiedIssuer(token);
    if (!issuer) return { ok: false, reason: "no_provider" };
    const provider = await this.dependencies.repository.findThirdPartyProviderByIssuer(scope, issuer);
    if (!provider) return { ok: false, reason: "no_provider" };
    const held = await keys.keys(provider.jwksUri);
    if (!held) return { ok: false, reason: "no_key_set" };
    const first = verifyProjectAuthThirdPartyToken(token, provider, held, this.now());
    if (first.ok) return first;
    if (first.reason !== "no_matching_key" && first.reason !== "key_type_mismatch") return first;
    const fresh = await keys.refresh(provider.jwksUri);
    if (!fresh || fresh === held) return first;
    return verifyProjectAuthThirdPartyToken(token, provider, fresh, this.now());
  }

  /**
   * Der Punkt `sign_in` (2.77), und er steht genau dort, wo er wirken kann:
   * vor `createSession`, also bevor eine Sitzung in der Datenbank existiert.
   *
   * **Wo er nicht steht, und warum das gesagt werden muss:** nicht in `refresh`.
   * Eine Erneuerung ist keine Anmeldung. Wer diesen Hook einschaltet oder seine
   * Regel verschaerft, aendert damit, wer sich **das naechste Mal** anmelden
   * darf, und beendet keine laufende Sitzung. Wer eine laufende Sitzung beenden
   * will, widerruft sie unter Auth → Sitzungen.
   *
   * **Was bei keiner Antwort gilt:** Es entsteht keine Sitzung. Geschlossen,
   * ohne Ausnahme. Ein Gatter, das im Zweifel durchlaesst, ist Zierde, und wer
   * es offen wollte, braeuchte den Punkt nicht.
   *
   * Im Audit landen beide Faelle getrennt: `denied` heisst, der hinterlegte
   * Code hat entschieden; alles andere heisst, er hat es nicht getan. Fuer den
   * Nutzer ist das Ergebnis dasselbe, fuer den Betreiber nicht.
   */
  private async assertSignInHook(
    scope: ProjectAuthScope,
    user: ProjectAuthUser,
    assurance: ProjectAuthAssurance,
    method: ProjectAuthHookMethod,
    now: Date,
  ): Promise<void> {
    const binding = await this.hookBinding(scope, "signIn");
    if (!binding) return;
    const answer = await this.callHook(scope, "sign_in", binding, projectAuthSignInHookPayload({
      projectId: scope.projectId, environment: scope.environment, userId: user.id,
      email: user.email, emailVerified: Boolean(user.emailVerifiedAt),
      method, assurance, attemptedAt: now,
    }));
    const verdict = projectAuthSignInHookVerdict(answer);
    if (verdict.allowed) return;
    await this.recordAudit(this.userEvent(scope, "project_auth.hook.refused", user.id, "failed", {
      point: "sign_in", function: binding.functionName, reason: verdict.reason,
    }));
    throw new ProjectAuthError(verdict.reason === "denied" ? "HOOK_DENIED" : "HOOK_UNAVAILABLE");
  }

  /**
   * Der Punkt `access_token_claims` (2.77), gerufen bei **jeder** Ausgabe eines
   * Access Token.
   *
   * Dass er auch bei der Erneuerung laeuft, ist keine Bequemlichkeit, sondern
   * der Unterschied zwischen einem Anspruch und einer Begruessung: Ein Access
   * Token lebt 15 Minuten. Ein Hook, der nur bei der Anmeldung laeuft, liesse
   * die Ansprueche nach einer Viertelstunde stillschweigend verschwinden, und
   * die Policies dahinter lesen den Unterschied nicht.
   *
   * Abgewiesen wird geschlossen und **laut**: Ein Hook, der einen reservierten
   * Anspruch setzen will, bekommt kein Token, und der Versuch steht im Audit.
   * Der Anspruch wird nicht uebergangen. Ein uebergangener Anspruch waere eine
   * Meinungsverschiedenheit darueber, wer dieser Nutzer ist, die niemand
   * bemerkt.
   */
  private async hookClaims(
    scope: ProjectAuthScope,
    user: ProjectAuthUser,
    assurance: ProjectAuthAssurance,
    reason: ProjectAuthHookReason,
    now: Date,
  ): Promise<Record<string, ProjectAuthClaimValue>> {
    const binding = await this.hookBinding(scope, "accessTokenClaims");
    if (!binding) return {};
    const answer = await this.callHook(scope, "access_token_claims", binding, projectAuthClaimsHookPayload({
      projectId: scope.projectId, environment: scope.environment, userId: user.id,
      email: user.email, emailVerified: Boolean(user.emailVerifiedAt),
      assurance, reason, issuedAt: now,
    }));
    const verdict = projectAuthClaimsHookVerdict(answer, binding.claims);
    if (verdict.ok) return verdict.claims;
    await this.recordAudit(this.userEvent(scope, "project_auth.hook.refused", user.id, "failed", {
      point: "access_token_claims", function: binding.functionName, reason: verdict.reason,
      // Der Name des beanstandeten Anspruchs, nie sein Wert: Der Name ist die
      // Aussage (`role` ist reserviert), der Wert waere die Nutzlast.
      ...(verdict.claim ? { claim: verdict.claim } : {}),
    }));
    throw new ProjectAuthError(hookRefusalCode(verdict.reason));
  }

  /**
   * Die geltende Bindung eines Punktes, oder `null`, wenn dieser Punkt nichts
   * ruft.
   *
   * Gelesen wird bei jedem Aufruf frisch, wie beim Aufrufdienst auch: Ein
   * zwischengespeichertes Bild liesse einen abgeschalteten Hook weiterlaufen,
   * und ein Betreiber, der einen Hook abschaltet, will ihn abgeschaltet haben.
   *
   * Ein Lesefehler auf den Einstellungen faellt hier als Fehler nach oben und
   * wird **nicht** zu "kein Hook". Anders als beim Zaehler (2.56), der bei
   * eigenem Fehler oeffnet: Hier waere das Oeffnen das Gegenteil dessen, was
   * eingestellt ist.
   */
  private async hookBinding(
    scope: ProjectAuthScope,
    point: "signIn" | "accessTokenClaims",
  ): Promise<{ functionName: string; timeoutMs: number; claims: string[] } | null> {
    const settings = await this.dependencies.repository.readSettings(scope);
    const hooks = settings?.hooks ?? DEFAULT_PROJECT_AUTH_HOOKS;
    const binding = point === "signIn" ? hooks.signIn : hooks.accessTokenClaims;
    if (!binding.functionName) return null;
    return {
      functionName: binding.functionName,
      timeoutMs: binding.timeoutMs,
      claims: point === "accessTokenClaims" ? [...hooks.accessTokenClaims.claims] : [],
    };
  }

  /**
   * Der Aufruf selbst, ueber den Port und damit ueber den vorhandenen
   * Aufrufdienst. Ohne Port gibt es keinen Weg zu einem Container; dann hat der
   * eingetragene Hook nicht geantwortet, und mehr ist dazu nicht zu sagen.
   */
  private async callHook(
    scope: ProjectAuthScope,
    point: (typeof PROJECT_AUTH_HOOK_POINTS)[number],
    binding: { functionName: string; timeoutMs: number },
    payload: ReturnType<typeof projectAuthSignInHookPayload> | ReturnType<typeof projectAuthClaimsHookPayload>,
  ) {
    const port = this.dependencies.hooks;
    if (!port) return { answered: false as const, error: "no_invocation_path" };
    return port.call({
      point, organizationId: scope.organizationId, projectId: scope.projectId,
      environment: scope.environment, functionName: binding.functionName,
      timeoutMs: binding.timeoutMs, payload,
    });
  }

  /** Die geltende Leckliste: die hinterlegte, sonst die eingebaute. */
  private leakList(): ProjectAuthLeakList {
    return this.dependencies.leakedPasswords ?? projectAuthBuiltInLeakList();
  }

  /**
   * Die Pruefung selbst (2.53), an genau einer Stelle und von beiden Wegen
   * aufgerufen, an denen ein Passwort gesetzt wird.
   *
   * Reihenfolge: erst die Laenge, dann die Liste. Das ist nicht beliebig —
   * die Laenge kostet nichts, und ein zu kurzes Passwort soll nicht erst
   * durch einen Digest laufen.
   *
   * Was hier **nicht** passiert: Es wird nichts protokolliert, das das
   * Passwort traegt. Der Audit-Eintrag nennt den Grund und die Herkunft der
   * Liste; der geworfene Fehler traegt einen Code und sonst nichts. Das
   * Passwort selbst verlaesst diese Methode nirgends.
   *
   * Und es wird **nicht** geoeffnet, wenn etwas schiefgeht. Anders als beim
   * Zaehler aus 2.56: Der Zaehler ist eine Schicht vor der Tuer und darf bei
   * einem Fehler durchlassen; diese Pruefung entscheidet, welches Passwort
   * ein Konto bekommt, und ein Lesefehler auf den Einstellungen macht daraus
   * keine Erlaubnis. Er faellt als Fehler nach oben durch, wie bei
   * `returnTarget` auch.
   */
  private async assertPasswordProtection(scope: ProjectAuthScope, password: string): Promise<void> {
    const settings = await this.dependencies.repository.readSettings(scope);
    const protection = settings?.passwordProtection ?? DEFAULT_PROJECT_AUTH_PASSWORD_PROTECTION;
    if (password.length < protection.minLength) {
      await this.recordAudit(this.passwordRefusal(scope, "too_short", protection.minLength));
      throw new ProjectAuthError("WEAK_PASSWORD");
    }
    if (!protection.leakedPasswordCheck) return;
    const list = this.leakList();
    if (!projectAuthPasswordIsLeaked(list, password)) return;
    await this.recordAudit({
      scope, action: "project_auth.password.refused",
      actorType: "app_user", actorRef: "anonymous",
      resourceRef: `project_auth_environment:${scope.environment}`,
      status: "failed",
      // Der Grund, die Herkunft der Liste und ihre Groesse. Kein Passwort,
      // kein Digest, kein Praefix, keine Adresse: Wer diese Zeile liest,
      // erfaehrt, dass eine Registrierung an der Leckpruefung scheiterte, und
      // nicht, woran.
      metadata: { reason: "known_leak", listSource: list.source, listEntries: list.entries },
    });
    // Der Wortlaut ist eine Einstellung der Umgebung. `named` nennt das Leck,
    // weil das handelbar ist; `generic` sagt nur, dass die Regeln nicht
    // erfuellt sind. Keiner der beiden sagt, wie oft oder woher.
    throw new ProjectAuthError(protection.notice === "named" ? "LEAKED_PASSWORD" : "WEAK_PASSWORD");
  }

  private passwordRefusal(
    scope: ProjectAuthScope,
    reason: "too_short",
    minLength: number,
  ): ProjectAuthAuditEvent {
    return {
      scope, action: "project_auth.password.refused",
      actorType: "app_user", actorRef: "anonymous",
      resourceRef: `project_auth_environment:${scope.environment}`,
      status: "failed", metadata: { reason, minLength },
    };
  }

  /**
   * Die Grenzen je Zeitfenster dieser Umgebung (2.56), zusammen mit den
   * Vorgaben und den Raendern. Ohne Zeile in `project_auth_settings` sind die
   * Grenzen die Vorgaben und `configured` ist falsch.
   */
  async readRateLimits(scope: ProjectAuthScope): Promise<PublicProjectAuthRateLimits> {
    assertScope(scope);
    const settings = await this.dependencies.repository.readSettings(scope);
    return publicRateLimits(settings?.rateLimits, settings?.updatedAt ?? null, Boolean(settings));
  }

  /**
   * Setzt alle drei Grenzen. Alle drei zusammen, weil ein Koerper mit nur
   * einer Art offen liesse, was mit den anderen geschehen soll, und
   * "unveraendert lassen" eine Annahme waere, die niemand aufgeschrieben hat.
   *
   * Jede Aenderung schreibt einen Audit-Eintrag. Darin stehen die sechs
   * Zahlen danach und sonst nichts — kein Schluessel, keine Adresse, keine
   * Zaehlerstaende. Die Zahlen sind keine Geheimnisse; wer sie kennt, weiss,
   * wie oft er es versuchen darf, und das steht ohnehin in der Antwort.
   */
  async setRateLimits(
    scope: ProjectAuthScope,
    limits: unknown,
    admin?: ProjectAuthAdminActor,
  ): Promise<PublicProjectAuthRateLimits> {
    assertScope(scope);
    const parsed = parseProjectAuthRateLimits(limits);
    if (!parsed.ok) throw new ProjectAuthRateLimitError(parsed.reason, parsed.field);
    const settings = await this.dependencies.repository.writeRateLimits(scope, parsed.limits, this.now());
    await this.recordAudit({
      scope, action: "project_auth.rate_limits.changed",
      actorType: admin ? "admin" : "system", actorRef: admin ? admin.id : "system",
      resourceRef: `project_auth_environment:${scope.environment}`,
      status: "succeeded",
      metadata: {
        signInMax: parsed.limits.sign_in.max, signInWindow: parsed.limits.sign_in.windowSeconds,
        mailMax: parsed.limits.mail.max, mailWindow: parsed.limits.mail.windowSeconds,
        refreshMax: parsed.limits.refresh.max, refreshWindow: parsed.limits.refresh.windowSeconds,
      },
    });
    return publicRateLimits(settings.rateLimits, settings.updatedAt, true);
  }

  /**
   * Die Durchsetzung (2.56). Der tragende Teil dieses Slices, und die
   * Entscheidungen darin sind einzeln begruendet:
   *
   * **Gezaehlt wird in der Datenbank**, nicht im Prozessspeicher. Mehr als
   * eine Instanz ist ein erlaubter Betrieb; ein Zaehler im Speicher gaebe bei
   * n Instanzen in Wahrheit das n-Fache der eingestellten Grenze frei und
   * faenge nach jedem Neustart bei null an.
   *
   * **Gezaehlt wird nach dem richtigen Schluessel**: bei einer Anmeldung nach
   * der Identitaet, bei einer Erneuerung nach der Sitzungsfamilie. Nie nach
   * einer IP-Adresse allein — ein Angreifer wechselt sie, ein ganzes Buero
   * teilt sich eine, und sie waere personenbezogene Bestandsdaten in einer
   * Zaehltabelle. Der Schluessel geht ausserdem nur als SHA-256 hinein; in
   * `project_auth_rate_counters` steht keine Adresse.
   *
   * **Auf der Grenze wird geschlossen, auf einem Fehler des Zaehlers
   * geoeffnet.** Das ist die unbequeme Haelfte und darum ausgeschrieben: Wer
   * die Grenze erreicht, wird abgewiesen, ohne Ausnahme. Wer sie nicht
   * erreicht, weil der Zaehler selbst kaputt ist — ein Fehler beim Lesen der
   * Einstellungen oder beim Hochzaehlen —, darf weiter. Der Grund ist, dass
   * dieser Zaehler eine Schutzschicht ist und keine Tuer: Die Tuer ist die
   * Passwortpruefung, und die steht unberuehrt dahinter. Waere es umgekehrt,
   * machte ein Fehler in der Zaehltabelle die ganze Anmeldung der Umgebung
   * unbrauchbar — aus einem Schutz vor Raten wuerde ein Ausfall fuer alle.
   * Der Fehler faellt dabei nicht unter den Tisch: Er landet als Zeile im
   * Betriebsprotokoll.
   *
   * **Die Antwort verraet nichts.** `RATE_LIMITED` ist dieselbe Antwort fuer
   * eine bekannte und eine unbekannte Adresse, weil gezaehlt wird, bevor
   * irgendetwas nachgeschlagen wurde. Ein Angreifer lernt aus einer 429
   * darum nur, dass er zu oft gefragt hat.
   */
  private async assertStoredRateLimit(
    scope: ProjectAuthScope,
    kind: ProjectAuthRateLimitKind,
    subject: string,
    now: Date,
  ): Promise<void> {
    let retryAfterSeconds: number;
    let max: number;
    let windowSeconds: number;
    try {
      const settings = await this.dependencies.repository.readSettings(scope);
      const limit = (settings?.rateLimits ?? DEFAULT_PROJECT_AUTH_RATE_LIMITS)[kind];
      const windowStart = projectAuthRateWindowStart(now, limit.windowSeconds);
      const counted = await this.dependencies.repository.countRateLimitAttempt(scope, {
        kind,
        subjectHash: projectAuthRateSubjectHash({ ...scope, kind, subject }),
        windowStart,
      });
      if (projectAuthRateAllowed({ count: counted.attempts, max: limit.max })) return;
      max = limit.max;
      windowSeconds = limit.windowSeconds;
      retryAfterSeconds = projectAuthRateRetryAfterSeconds({
        windowStart: counted.windowStart, windowSeconds: limit.windowSeconds, at: now,
      });
    } catch (error) {
      // Offen auf einem Fehler des Zaehlers, geschlossen auf der Grenze. Der
      // Versuch geht weiter zur eigentlichen Pruefung; ohne diese Zeile waere
      // eine kaputte Zaehltabelle ein Totalausfall der Anmeldung.
      console.error("Project Auth rate counter was not consulted", {
        kind, error: error instanceof Error ? error.name : "unknown",
      });
      return;
    }
    // Ausserhalb des try, damit die eigene Ablehnung nicht in den Fang faellt,
    // der auf einen Fehler des Zaehlers oeffnet.
    await this.recordAudit({
      scope, action: "project_auth.rate_limit.blocked",
      actorType: "system", actorRef: "system",
      resourceRef: `project_auth_environment:${scope.environment}`,
      status: "failed",
      // Kein Schluessel, kein Hash, keine Adresse. Der Sanitizer liesse eine
      // Adresse ohnehin nicht durch; ein Hash waere ein Pseudonym der
      // Adresse und hat in der Kette genauso wenig zu suchen. Was hier steht,
      // ist die Art, die Grenze und das Fenster — genug, um zu sehen, dass
      // und welche Grenze gegriffen hat.
      metadata: { kind, max, windowSeconds },
    });
    throw new ProjectAuthError("RATE_LIMITED", retryAfterSeconds);
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
    const result = await this.createSessionResult(scope, user, "aal2", now, "mfa");
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
   * Eine Herausforderung fuer einen neuen Passkey (2.79).
   *
   * Nur fuer einen Nutzer, der schon da ist: Wer hier ankommt, hat eine
   * brauchbare Sitzung, also ein Access Token, das `verifyAccess` angenommen
   * hat. Ein Passkey ist damit nichts, womit man ein Konto anlegt, sondern
   * etwas, das ein bestehendes Konto dazubekommt. Das ist die kleinere Flaeche:
   * Eine Registrierung ohne vorherige Anmeldung waere ein zweiter Weg, ein
   * Konto zu erzeugen, und der erste (`signUp`) prueft die Adresse.
   *
   * Die Kennungen der vorhandenen Passkeys gehen mit hinaus, damit der Browser
   * sie in `excludeCredentials` legen kann und derselbe Authenticator nicht
   * zweimal registriert wird. Sie sind keine Geheimnisse, und der Aufrufer ist
   * der Nutzer, dem sie gehoeren.
   */
  async beginPasskeyRegistration(
    principal: ProjectAuthEnrollmentPrincipal,
  ): Promise<PublicProjectAuthPasskeyChallenge & { existingCredentialIds: string[] }> {
    assertScope(principal.scope);
    const now = this.now();
    const challenge = await this.issuePasskeyChallenge(
      principal.scope, "passkey_registration", principal.user.id, now,
    );
    const existing = await this.dependencies.repository.listPasskeys(principal.scope, principal.user.id);
    return { ...challenge, existingCredentialIds: existing.map((passkey) => passkey.credentialId) };
  }

  /**
   * Die Antwort des Browsers auf eine Registrierung, geprueft und abgelegt.
   *
   * Die Herausforderung wird **zuerst** verbraucht und danach geprueft. Diese
   * Reihenfolge ist der Kern: Waere es umgekehrt, liesse sich dieselbe
   * Herausforderung beliebig oft mit einer falschen Antwort probieren, und der
   * Angreifer bekaeme so viele Versuche, wie er will. So bekommt er genau einen.
   */
  async completePasskeyRegistration(principal: ProjectAuthEnrollmentPrincipal, input: {
    challengeToken: string;
    attestationObject: string;
    clientDataJSON: string;
    label: string;
  }): Promise<PublicProjectAuthPasskey> {
    assertScope(principal.scope);
    const now = this.now();
    const label = typeof input.label === "string" ? input.label.trim() : "";
    if (label.length < 1 || label.length > 64) throw new ProjectAuthError("INVALID_INPUT");
    const challenge = await this.consumePasskeyChallenge(
      principal.scope, input.challengeToken, "passkey_registration", now,
    );
    // Die Herausforderung gehoerte diesem Nutzer. Ohne diese Zeile koennte ein
    // Nutzer eine Herausforderung eines anderen einloesen und sich damit einen
    // Passkey in dessen Konto legen.
    if (challenge.userId !== principal.user.id) {
      await this.recordPasskeyRefusal(principal.scope, principal.user.id, "registration", "challenge_mismatch");
      throw new ProjectAuthError("INVALID_PASSKEY");
    }
    const verdict = verifyPasskeyRegistration({
      attestationObject: input.attestationObject,
      clientDataJSON: input.clientDataJSON,
      challenge: challenge.challenge,
      allowedOrigins: this.dependencies.allowedRedirectOrigins,
    });
    if (!verdict.ok) {
      await this.recordPasskeyRefusal(principal.scope, principal.user.id, "registration", verdict.reason);
      throw new ProjectAuthError("INVALID_PASSKEY");
    }
    let stored: ProjectAuthPasskey;
    try {
      stored = await this.dependencies.repository.createPasskey({
        ...principal.scope, id: this.id(), userId: principal.user.id,
        credentialId: verdict.value.credentialId, publicKey: verdict.value.publicKey,
        algorithm: verdict.value.algorithm, signCount: verdict.value.signCount,
        userVerified: verdict.value.userVerified, attestationFormat: verdict.value.attestationFormat,
        label, createdAt: now, lastUsedAt: null,
      });
    } catch (error) {
      // Dasselbe Geraet zweimal. Kein 500, sondern die Auskunft, dass es diesen
      // Passkey schon gibt.
      if (error instanceof DuplicateProjectAuthIdentityError) throw new ProjectAuthError("ACCOUNT_EXISTS");
      throw error;
    }
    await this.recordAudit(this.userEvent(principal.scope, "project_auth.passkey.registered", principal.user.id, "succeeded", {
      // Kein oeffentlicher Schluessel und keine Kennung in der Spur: Beides ist
      // kein Geheimnis, aber beides ist ein Kennzeichen eines Geraets, und die
      // Kette soll Geraete nicht wiedererkennbar machen. Was hier steht, ist
      // genug, um zu sehen, was registriert wurde.
      algorithm: verdict.value.algorithm, attestation: verdict.value.attestationFormat,
      userVerified: verdict.value.userVerified,
    }));
    return publicProjectAuthPasskey(stored);
  }

  /**
   * Eine Herausforderung fuer eine Anmeldung mit Passkey (2.79).
   *
   * Ohne Nutzer und ohne Adresse: Wer sich mit einem Passkey anmeldet, sagt
   * vorher nicht, wer er ist; der Server erfaehrt es aus der Kennung, die die
   * Antwort mitbringt. Darum gibt es hier auch nichts nachzuschlagen, und darum
   * verraet diese Route nicht, welche Adressen es gibt.
   */
  async beginPasskeySignIn(scope: ProjectAuthScope, input: {
    rateLimitKey: string;
  }): Promise<PublicProjectAuthPasskeyChallenge> {
    const now = this.now();
    await this.assertRateLimit(`project-passkey:${scopeKey(scope)}:${input.rateLimitKey}`, PASSKEY_RATE, now);
    assertScope(scope);
    return this.issuePasskeyChallenge(scope, "passkey_authentication", null, now);
  }

  /**
   * Die Anmeldung mit einem Passkey.
   *
   * Der Weg zur Sitzung ist **derselbe** wie bei der Anmeldung mit Passwort:
   * `beginAuthenticatedSession`, und damit `createSessionResult` und damit der
   * Punkt `sign_in` (2.77). Eine Anmeldung, die an dieser Stelle einen eigenen
   * Weg nimmt, ist eine Anmeldung, an der die Regeln der Umgebung nicht gelten;
   * der erzwungene zweite Faktor (2.52) greift hier genauso, und ein Nutzer mit
   * bestaetigtem TOTP bekommt auch nach einem Passkey erst eine Challenge.
   *
   * Warum aal1 und nicht aal2: Ein Passkey mit Benutzerbestaetigung ist zwar
   * praktisch zwei Faktoren, aber `aal2` heisst in QKERN "ein bestaetigter
   * zweiter Faktor liegt vor", und das ist eine andere Aussage. Sie hier zu
   * vergeben hiesse, den erzwungenen zweiten Faktor still zu umgehen.
   */
  async completePasskeySignIn(scope: ProjectAuthScope, input: {
    challengeToken: string;
    credentialId: string;
    authenticatorData: string;
    clientDataJSON: string;
    signature: string;
    rateLimitKey: string;
  }): Promise<ProjectAuthSessionResult | ProjectAuthMfaRequired | ProjectAuthMfaEnrollmentRequired> {
    const now = this.now();
    await this.assertRateLimit(`project-passkey:${scopeKey(scope)}:${input.rateLimitKey}`, PASSKEY_RATE, now);
    assertScope(scope);
    if (typeof input.credentialId !== "string" || !/^[A-Za-z0-9_-]{16,1364}$/.test(input.credentialId)) {
      throw new ProjectAuthError("INVALID_PASSKEY");
    }
    // Die Grenze aus der Datenbank, nach Kennung gezaehlt (2.56), und zwar vor
    // dem Nachschlagen: Aus einer 429 soll niemand lesen koennen, ob es diesen
    // Passkey gibt.
    await this.assertStoredRateLimit(scope, "sign_in", `passkey:${input.credentialId}`, now);
    const challenge = await this.consumePasskeyChallenge(
      scope, input.challengeToken, "passkey_authentication", now,
    );
    const passkey = await this.dependencies.repository.findPasskeyByCredentialId(scope, input.credentialId);
    if (!passkey) {
      await this.recordPasskeyRefusal(scope, null, "authentication", "credential_unknown");
      throw new ProjectAuthError("INVALID_PASSKEY");
    }
    const verdict = verifyPasskeyAssertion({
      authenticatorData: input.authenticatorData,
      clientDataJSON: input.clientDataJSON,
      signature: input.signature,
      challenge: challenge.challenge,
      allowedOrigins: this.dependencies.allowedRedirectOrigins,
      credential: {
        publicKey: passkey.publicKey, algorithm: passkey.algorithm, signCount: passkey.signCount,
      },
    });
    if (!verdict.ok) {
      await this.recordPasskeyRefusal(scope, passkey.userId, "authentication", verdict.reason);
      throw new ProjectAuthError("INVALID_PASSKEY");
    }
    // Der Zaehler wird geschrieben, **bevor** es eine Sitzung gibt, und das
    // Schreiben ist selbst eine Bedingung: Es gelingt nur, wenn der Stand noch
    // der ist, den die Pruefung gelesen hat. Zwei gleichzeitige Anmeldungen mit
    // derselben Unterschrift kommen so genau einmal durch, auch wenn beide
    // dieselbe Zeile gelesen haben.
    const advanced = await this.dependencies.repository.advancePasskeyCounter(scope, passkey.id, {
      fromSignCount: passkey.signCount, toSignCount: verdict.value.signCount, usedAt: now,
    });
    if (!advanced) {
      await this.recordPasskeyRefusal(scope, passkey.userId, "authentication", "sign_count_regressed");
      throw new ProjectAuthError("INVALID_PASSKEY");
    }
    const user = await this.dependencies.repository.findUserById(scope, passkey.userId);
    if (!user || user.status !== "active") {
      await this.recordAudit(this.userEvent(scope, "project_auth.login.failed", passkey.userId, "failed", {
        method: "passkey", reason: "user_disabled",
      }));
      throw new ProjectAuthError("INVALID_PASSKEY");
    }
    // Kein Blick auf `emailVerifiedAt` an dieser Stelle, und das ist Absicht:
    // Der Passkey ist der Beweis, und er haengt nicht an einer Adresse. Ein
    // Nutzer konnte diesen Passkey nur registrieren, wenn er eine brauchbare
    // Sitzung hatte, und die bekam er nur mit bestaetigter Adresse.
    await this.recordAudit(this.userEvent(scope, "project_auth.passkey.verified", user.id, "succeeded", {
      userVerified: verdict.value.userVerified, signCount: verdict.value.signCount,
    }));
    return this.beginAuthenticatedSession(scope, user, now, "passkey");
  }

  /** Die Passkeys des angemeldeten Nutzers, ohne oeffentliche Schluessel. */
  async listPasskeys(principal: ProjectAuthEnrollmentPrincipal): Promise<PublicProjectAuthPasskey[]> {
    assertScope(principal.scope);
    const passkeys = await this.dependencies.repository.listPasskeys(principal.scope, principal.user.id);
    return passkeys.map(publicProjectAuthPasskey);
  }

  /**
   * Einen Passkey entfernen, und zwar wirklich: Die Zeile ist danach weg.
   *
   * Der Nutzer steht im Loeschbefehl selbst; ein Passkey eines anderen Nutzers
   * wird nicht getroffen und ergibt eine 404. Was hier **nicht** geprueft wird:
   * ob es der letzte ist. Ein Nutzer darf sich seinen letzten Passkey nehmen,
   * denn er hat weiterhin Passwort oder Magic Link; ein Server, der das
   * verhindert, haelt jemanden an einem Geraet fest, das er nicht mehr hat.
   */
  async removePasskey(
    principal: ProjectAuthEnrollmentPrincipal,
    passkeyId: string,
  ): Promise<{ removed: true }> {
    assertScope(principal.scope);
    // Die Form der ID steht hier und nicht nur in der Route: Die Spalte ist
    // `uuid`, und eine Zeichenkette, die keine ist, waere in PostgreSQL ein
    // Umwandlungsfehler und damit eine 500 auf einer Anfrage, die nur eine 404
    // verdient. Eine Regel, die an einer Tuer haengt, ist keine Regel.
    if (!UUID_VALUE.test(passkeyId)) throw new ProjectAuthError("RESOURCE_NOT_FOUND");
    const removed = await this.dependencies.repository.deletePasskey(
      principal.scope, principal.user.id, passkeyId,
    );
    if (!removed) throw new ProjectAuthError("RESOURCE_NOT_FOUND");
    await this.recordAudit(this.userEvent(principal.scope, "project_auth.passkey.removed", principal.user.id, "succeeded", {
      passkey: passkeyId,
    }));
    return { removed: true };
  }

  /**
   * Was die Console ueber die Passkeys dieser Umgebung sieht (2.79): drei Zahlen
   * und die Liste der Herkuenfte, gegen die geprueft wird. Keine Kennung, kein
   * Schluessel, kein Nutzer: Die Uebersicht soll sagen, ob Passkeys benutzt
   * werden, und nicht, von wem.
   */
  async readPasskeyPolicy(scope: ProjectAuthScope): Promise<PublicProjectAuthPasskeyPolicy> {
    assertScope(scope);
    const counts = await this.dependencies.repository.countPasskeys(scope);
    return {
      users: counts.users,
      passkeys: counts.passkeys,
      usersWithPasskey: counts.usersWithPasskey,
      usersWithoutPasskey: Math.max(0, counts.users - counts.usersWithPasskey),
      relyingParties: this.passkeyRelyingParties(),
      algorithms: PASSKEY_ALGORITHMS,
    };
  }

  /**
   * Die erlaubten Herkuenfte und die Domaene, die je Herkunft als `rp.id` gilt.
   *
   * Es ist dieselbe Liste, die auch die Ruecksprungziele begrenzt
   * (`QKERN_PROJECT_AUTH_REDIRECT_ORIGINS`), und das mit Absicht: Zwei Listen
   * mit derselben Bedeutung gehen auseinander, und dann prueft die eine etwas
   * anderes als die andere. Eine Umgebung, die ihre Ruecksprungziele weiter
   * verengt (2.54), verengt damit die Passkeys **nicht**: Diese Liste ist die
   * aeussere Grenze der Installation, und eine Herkunft, die dort nicht steht,
   * kommt hier nicht durch.
   */
  private passkeyRelyingParties(): Array<{ origin: string; rpId: string }> {
    return [...this.dependencies.allowedRedirectOrigins].map((origin) => ({
      origin, rpId: new URL(origin).hostname,
    }));
  }

  /** Gibt eine Herausforderung aus und legt ihren Verifier in die Datenbank. */
  private async issuePasskeyChallenge(
    scope: ProjectAuthScope,
    purpose: "passkey_registration" | "passkey_authentication",
    userId: string | null,
    now: Date,
  ): Promise<PublicProjectAuthPasskeyChallenge> {
    const token = this.opaqueToken("pkey");
    if (!PASSKEY_TOKEN.test(token)) throw new ProjectAuthError("INVALID_INPUT");
    const expiresAt = new Date(now.getTime() + PASSKEY_CHALLENGE_TTL_MS);
    await this.dependencies.repository.createOneTimeToken({
      ...scope, id: this.id(), userId, purpose,
      tokenHash: hashProjectAuthToken(token), metadata: {}, createdAt: now,
      expiresAt, consumedAt: null,
    });
    return {
      challengeToken: token,
      challenge: token.slice(PASSKEY_TOKEN_PREFIX.length),
      relyingParties: this.passkeyRelyingParties(),
      algorithms: PASSKEY_ALGORITHMS,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Loest eine Herausforderung ein und verbraucht sie dabei.
   *
   * Verbraucht wird in der Datenbank, mit einem UPDATE, das `consumed_at` nur
   * setzt, wenn es noch NULL ist, und nur dann eine Zeile zurueckgibt. Das ist
   * die Stelle, die eine wiederverwendete Herausforderung abweist, und sie tut
   * es auch dann, wenn zwei Anfragen gleichzeitig kommen: Genau eine bekommt
   * die Zeile.
   *
   * Der `purpose` steht im WHERE und nicht in einer Pruefung danach: Eine
   * Herausforderung fuer eine Registrierung hat an der Anmeldung nichts zu
   * suchen, und ein Nachschlagen, das sie erst findet, waere ein Nachschlagen,
   * das sie verbraucht.
   */
  private async consumePasskeyChallenge(
    scope: ProjectAuthScope,
    token: string,
    purpose: "passkey_registration" | "passkey_authentication",
    now: Date,
  ): Promise<{ challenge: string; userId: string | null }> {
    if (typeof token !== "string" || !PASSKEY_TOKEN.test(token)) {
      throw new ProjectAuthError("INVALID_PASSKEY");
    }
    const consumed = await this.dependencies.repository.consumeOneTimeToken(
      scope, hashProjectAuthToken(token), purpose, now,
    );
    if (!consumed) {
      await this.recordPasskeyRefusal(
        scope, null, purpose === "passkey_registration" ? "registration" : "authentication", "challenge_spent",
      );
      throw new ProjectAuthError("INVALID_PASSKEY");
    }
    return { challenge: token.slice(PASSKEY_TOKEN_PREFIX.length), userId: consumed.userId };
  }

  /**
   * Eine abgewiesene Antwort in der Kette. Der Grund steht im Klartext, weil er
   * genau das ist, was hinterher niemand mehr rekonstruieren kann:
   * `origin_not_allowed` ist ein Angriff, `sign_count_regressed` ein geklonter
   * Schluessel und `challenge_spent` ein Wiedereinspielversuch. Was nicht
   * dabeisteht, ist die Herkunft, die der Angreifer genannt hat, und die
   * Kennung des Schluessels.
   */
  private async recordPasskeyRefusal(
    scope: ProjectAuthScope,
    userId: string | null,
    stage: "registration" | "authentication",
    reason: string,
  ): Promise<void> {
    await this.recordAudit(userId
      ? this.userEvent(scope, "project_auth.passkey.refused", userId, "failed", { stage, reason })
      : {
        scope, action: "project_auth.passkey.refused", actorType: "app_user", actorRef: "anonymous",
        resourceRef: "project_auth_user:unknown", status: "failed", metadata: { stage, reason },
      });
  }

  /**
   * Die konfigurierten OIDC-Provider — als Projektion, nie als Durchreichung.
   *
   * Der Katalog kannte `list()` seit 1.76; gerufen hat es bis 1.83 niemand —
   * weder Console noch App konnten die Auswahl aufzaehlen. Nach aussen gehen
   * Slug, Issuer und seit 2.57 ein abgeleitetes Ja/Nein. Client-ID,
   * Endpunkte und der Name der Secret-Umgebungsvariablen bleiben drinnen.
   *
   * `requiresVerifiedEmail` ist die eine Angabe, die der Sicherheitsberater
   * fuer `auth_provider_unverified_email` braucht (2.39 hat die Regel
   * genau deshalb nie laufen lassen). Sie ist ein `boolean`, abgeleitet aus
   * `emailVerification`, und kein Durchreichen eines Feldes: Ein `boolean`
   * hat keine Stelle, an der ein Secret, eine Adresse oder eine Client-ID
   * stehen koennte. Die oeffentliche Provider-Route verengt trotzdem weiter
   * auf Slug und Issuer; die Haltung eines Anbieters geht niemanden etwas
   * an, der noch nicht angemeldet ist.
   */
  listOidcProviders(): Array<{ id: string; issuer: string; requiresVerifiedEmail: boolean }> {
    return this.dependencies.oidcCatalog.list().flatMap((id) => {
      const provider = this.dependencies.oidcCatalog.get(id);
      return provider
        ? [{ id: provider.id, issuer: provider.issuer, requiresVerifiedEmail: provider.emailVerification !== "trusted" }]
        : [];
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
    const redirectTo = await this.returnTarget(scope, input.redirectTo);
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
    const result = await this.createSessionResult(scope, user, "aal1", now, method);
    await this.recordAudit(this.userEvent(scope, "project_auth.login.succeeded", user.id, "succeeded", {
      method, ...(provider ? { provider } : {}), assurance: "aal1",
    }));
    return result;
  }

  /**
   * Die einzige Stelle, an der eine Sitzung aus einer Anmeldung entsteht: beide
   * Wege dorthin (mit und ohne zweitem Faktor) laufen hier zusammen. Darum
   * steht der Punkt `sign_in` (2.77) hier und nicht in jedem Anmeldeweg
   * einzeln; eine Regel, die an einer Tuer haengt, ist keine Regel.
   *
   * Reihenfolge: **beide** Hooks, dann `createSession`. Ein abgewiesener
   * Versuch soll keine Zeile in `project_auth_sessions` hinterlassen. Dass auch
   * der Anspruchs-Hook davor steht, hat der Zertifizierungsfall (2.77)
   * erzwungen: Stand er dahinter, blieb nach einem Hook, der einen reservierten
   * Anspruch wollte, eine Sitzung ohne Token zurueck. Eine Sitzung, zu der es
   * nie ein Token gab, ist ein Rest und keine Anmeldung.
   */
  private async createSessionResult(
    scope: ProjectAuthScope,
    user: ProjectAuthUser,
    assurance: ProjectAuthAssurance,
    now: Date,
    method: ProjectAuthHookMethod,
  ): Promise<ProjectAuthSessionResult> {
    await this.assertSignInHook(scope, user, assurance, method, now);
    const claims = await this.hookClaims(scope, user, assurance, "sign_in", now);
    const refreshToken = this.opaqueToken("refresh");
    if (!REFRESH_TOKEN.test(refreshToken)) throw new ProjectAuthError("INVALID_INPUT");
    const session = this.session(scope, user.id, assurance, now, refreshToken, this.id());
    await this.dependencies.repository.createSession(session);
    return this.sessionResult(scope, user, session, refreshToken, now, claims);
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

  /**
   * Die einzige Stelle, an der ein Access Token entsteht: die neue Anmeldung und
   * die Erneuerung laufen beide hier durch.
   *
   * Die Ansprueche des Hooks (2.77) kommen als Argument herein und werden hier
   * nicht geholt. Beide Aufrufer holen sie **vor** ihrem Schreibzugriff, weil
   * ein Hook, der abweist, nichts kosten soll: keine Sitzungszeile bei der
   * Anmeldung und keine widerrufene Familie bei der Erneuerung. Dass der Punkt
   * beide Wege trifft und darum auch nach der fuenfzehnten Minute noch wirkt,
   * bleibt davon unberuehrt.
   */
  private sessionResult(
    scope: ProjectAuthScope,
    user: ProjectAuthUser,
    session: ProjectAuthSession,
    refreshToken: string,
    now: Date,
    claims: Record<string, ProjectAuthClaimValue>,
  ): ProjectAuthSessionResult {
    const access = this.dependencies.tokens.issue(scope, user, session, now, claims);
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

  /**
   * Die einzige Stelle, an der ein Ruecksprungziel angenommen wird (2.54).
   *
   * Vorher stand hier nur die aeussere Grenze aus der Prozessumgebung. Jetzt
   * kommt die Liste der Projektumgebung dazu, und zwar als Verengung: Der
   * Wert muss in der aeusseren Grenze liegen **und**, falls die Umgebung eine
   * nicht leere Liste fuehrt, auch in dieser. Eine leere Liste verengt nicht.
   *
   * Warum das reicht, um alles zu erfassen: QKERN schickt selbst nie einen
   * 302 an ein Ruecksprungziel. Der Wert wandert genau an zwei Orte — als
   * `redirect_to` in den Link einer Aktionsmail und in den verschluesselten
   * OIDC-Flow-Zustand — und beide Wege fuehren durch diese Methode, bevor
   * irgendetwas gespeichert oder versendet wird.
   */
  private async returnTarget(scope: ProjectAuthScope, value: string): Promise<string> {
    if (typeof value !== "string" || value.length > 2_048) throw new ProjectAuthError("INVALID_INPUT");
    const settings = await this.dependencies.repository.readSettings(scope);
    const allowed = projectAuthReturnTargetAllowed({
      value,
      outerBound: this.dependencies.allowedRedirectOrigins,
      allowList: settings?.returnTargets ?? [],
    });
    if (!allowed) throw new ProjectAuthError("INVALID_INPUT");
    return new URL(value).toString();
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
  readReturnTargets(): never { return this.disabled(); }
  setReturnTargets(): never { return this.disabled(); }
  readRateLimits(): never { return this.disabled(); }
  setRateLimits(): never { return this.disabled(); }
  readPasswordProtection(): never { return this.disabled(); }
  setPasswordProtection(): never { return this.disabled(); }
  readAuthHooks(): never { return this.disabled(); }
  setAuthHooks(): never { return this.disabled(); }
  listThirdPartyProviders(): never { return this.disabled(); }
  createThirdPartyProvider(): never { return this.disabled(); }
  deleteThirdPartyProvider(): never { return this.disabled(); }
  listOAuthClients(): never { return this.disabled(); }
  createOAuthClient(): never { return this.disabled(); }
  deleteOAuthClient(): never { return this.disabled(); }
  authorizeOAuth(): never { return this.disabled(); }
  exchangeOAuthCode(): never { return this.disabled(); }
  verifyOAuthToken(): never { return this.disabled(); }
  verifyThirdPartyToken(): never { return this.disabled(); }
  verifyMfaChallenge(): never { return this.disabled(); }
  beginPasskeyRegistration(): never { return this.disabled(); }
  completePasskeyRegistration(): never { return this.disabled(); }
  beginPasskeySignIn(): never { return this.disabled(); }
  completePasskeySignIn(): never { return this.disabled(); }
  listPasskeys(): never { return this.disabled(); }
  removePasskey(): never { return this.disabled(); }
  readPasskeyPolicy(): never { return this.disabled(); }
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

/**
 * Die Auth-Hooks, wie sie nach aussen gehen (2.77).
 *
 * `failureMode` steht hier und nicht in der Console: Was bei einem Ausfall
 * gilt, entscheidet der Dienst, und die Seite soll es nicht aus eigenem Wissen
 * behaupten. Heute steht an beiden Punkten `deny`, und wenn das einmal nicht
 * mehr stimmt, aendert sich diese Zeile und nicht ein Satz in einer Ansicht.
 */
/**
 * Die Auskunft ueber die fremden Anbieter (2.80).
 *
 * Mitgeliefert werden die Rollen, die verbotene Rolle, die Verfahren und die
 * Raender. Nichts davon ist eine Kopie fuer die Bequemlichkeit: Die Console soll
 * nicht behaupten muessen, dass `service_role` ausgeschlossen ist oder dass
 * `HS256` nicht geprueft wird. Beides entscheidet dieses Modul, und beides sagt
 * es hier.
 */
function publicThirdParty(providers: readonly ProjectAuthThirdPartyProvider[]): PublicProjectAuthThirdParty {
  return {
    providers: providers.map((provider) => ({
      id: provider.id, name: provider.name, issuer: provider.issuer, jwksUri: provider.jwksUri,
      audiences: [...provider.audiences], subjectClaim: provider.subjectClaim,
      roleClaim: provider.roleClaim, defaultRole: provider.defaultRole,
      createdAt: provider.createdAt.toISOString(),
    })),
    roles: [...PROJECT_AUTH_THIRD_PARTY_ROLES],
    forbiddenRole: PROJECT_AUTH_THIRD_PARTY_FORBIDDEN_ROLE,
    algorithms: [...PROJECT_AUTH_THIRD_PARTY_ALGORITHM_IDS],
    ownClaims: [...PROJECT_AUTH_THIRD_PARTY_OWN_CLAIMS],
    bounds: PROJECT_AUTH_THIRD_PARTY_BOUNDS,
    configured: providers.length > 0,
  };
}

/**
 * Die Auskunft ueber den OAuth-Server (2.82).
 *
 * Mitgeliefert werden die Bereiche, die Rolle, die verbotene Rolle, die nicht
 * gebauten Verfahren und die Raender. Nichts davon ist eine Kopie fuer die
 * Bequemlichkeit: Die Console soll nicht behaupten muessen, dass `service_role`
 * ausgeschlossen ist oder dass es kein Refresh Token gibt. Beides entscheidet
 * dieser Dienst, und beides sagt er hier.
 */
function publicOAuthServer(
  clients: readonly ProjectAuthOAuthClient[],
  // Eine Zeile mehr, als die Console zeigt: Daran und nur daran ist zu sehen,
  // dass die Liste abgeschnitten ist. Ein Zaehler ueber die ganze Tabelle waere
  // eine zweite Abfrage fuer eine Zahl, die niemand braucht.
  consents: ReadonlyArray<ProjectAuthOAuthConsent & { clientName: string; email: string }> = [],
  tokens: ReadonlyArray<ProjectAuthOAuthToken & { clientName: string; email: string }> = [],
): PublicProjectAuthOAuthServer {
  const shown = consents.slice(0, PROJECT_AUTH_OAUTH_BOUNDS.consents.max);
  const shownTokens = tokens.slice(0, PROJECT_AUTH_OAUTH_BOUNDS.tokens.max);
  return {
    clients: clients.map((client) => ({
      id: client.id, name: client.name,
      redirectUris: [...client.redirectUris], scopes: [...client.scopes],
      createdAt: client.createdAt.toISOString(),
    })),
    consents: shown.map((consent) => ({
      id: consent.id, clientId: consent.clientId, clientName: consent.clientName,
      userId: consent.userId, email: consent.email, scopes: [...consent.scopes],
      grantedAt: consent.grantedAt.toISOString(),
      revokedAt: consent.revokedAt === null ? null : consent.revokedAt.toISOString(),
    })),
    consentsTruncated: consents.length > shown.length,
    tokens: shownTokens.map((token) => ({
      id: token.id, clientId: token.clientId, clientName: token.clientName,
      userId: token.userId, email: token.email, consentId: token.consentId,
      scopes: [...token.scopes],
      createdAt: token.createdAt.toISOString(),
      expiresAt: token.expiresAt.toISOString(),
    })),
    tokensTruncated: tokens.length > shownTokens.length,
    scopes: [...PROJECT_AUTH_OAUTH_SCOPES],
    role: PROJECT_AUTH_OAUTH_ROLE,
    forbiddenRole: PROJECT_AUTH_OAUTH_FORBIDDEN_ROLE,
    unsupportedGrants: [...PROJECT_AUTH_OAUTH_UNSUPPORTED_GRANTS],
    grant: PROJECT_AUTH_OAUTH_GRANT,
    challengeMethod: PROJECT_AUTH_OAUTH_CHALLENGE_METHOD,
    bounds: PROJECT_AUTH_OAUTH_BOUNDS,
    configured: clients.length > 0,
  };
}

/**
 * Der behauptete Aussteller eines Tokens, nur zum Nachschlagen.
 *
 * Die Funktion heisst so, wie sie ist. Was sie liefert, ist ungeprueft: ein
 * Stueck base64url, das jeder schreiben kann. Es taugt, um eine Zeile zu
 * finden, und zu nichts sonst. Die Pruefung vergleicht denselben Anspruch noch
 * einmal, nach der Signatur.
 */
function unverifiedIssuer(token: string): string | null {
  if (typeof token !== "string" || token.length > PROJECT_AUTH_THIRD_PARTY_BOUNDS.tokenLength) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    if (!claims || typeof claims !== "object" || Array.isArray(claims)) return null;
    const issuer = (claims as { iss?: unknown }).iss;
    return typeof issuer === "string" && issuer.length > 0 && issuer.length <= 512 ? issuer : null;
  } catch {
    return null;
  }
}

function publicHooks(
  hooks: ProjectAuthHooks | undefined,
  updatedAt: Date | null,
  configured: boolean,
): PublicProjectAuthHooks {
  const effective = hooks ?? DEFAULT_PROJECT_AUTH_HOOKS;
  return {
    hooks: {
      signIn: { ...effective.signIn },
      accessTokenClaims: {
        ...effective.accessTokenClaims,
        claims: [...effective.accessTokenClaims.claims],
      },
    },
    defaults: {
      signIn: { ...DEFAULT_PROJECT_AUTH_HOOKS.signIn },
      accessTokenClaims: {
        ...DEFAULT_PROJECT_AUTH_HOOKS.accessTokenClaims,
        claims: [...DEFAULT_PROJECT_AUTH_HOOKS.accessTokenClaims.claims],
      },
    },
    bounds: PROJECT_AUTH_HOOK_BOUNDS,
    points: PROJECT_AUTH_HOOK_POINTS,
    reservedClaims: PROJECT_AUTH_RESERVED_CLAIMS,
    failureMode: { sign_in: "deny", access_token_claims: "deny" },
    configured,
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
  };
}

/**
 * Welcher Fehlercode zu welcher Ablehnung gehoert.
 *
 * Unterschieden wird genau eines: Hat der Hook gegen den Vertrag gehandelt
 * (`HOOK_REJECTED`), oder hat er nicht geantwortet (`HOOK_UNAVAILABLE`)? Der
 * Aufrufer soll aus einem Fehlschlag lesen koennen, ob die Umgebung ein
 * Betriebsproblem hat oder der hinterlegte Code eines.
 */
function hookRefusalCode(reason: ProjectAuthHookRefusal): ProjectAuthErrorCode {
  return ["no_answer", "bad_status", "body_not_an_object"].includes(reason)
    ? "HOOK_UNAVAILABLE"
    : "HOOK_REJECTED";
}

function publicPasswordProtection(
  protection: ProjectAuthPasswordProtection | undefined,
  updatedAt: Date | null,
  configured: boolean,
  list: ProjectAuthLeakList,
): PublicProjectAuthPasswordProtection {
  const effective = protection ?? DEFAULT_PROJECT_AUTH_PASSWORD_PROTECTION;
  return {
    protection: { ...effective },
    defaults: { ...DEFAULT_PROJECT_AUTH_PASSWORD_PROTECTION },
    bounds: { minLength: PROJECT_AUTH_PASSWORD_MIN_LENGTH_BOUNDS },
    notices: PROJECT_AUTH_PASSWORD_NOTICES,
    list: publicProjectAuthLeakList(list),
    configured,
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
  };
}

function publicRateLimits(
  limits: ProjectAuthRateLimits | undefined,
  updatedAt: Date | null,
  configured: boolean,
): PublicProjectAuthRateLimits {
  const effective = limits ?? DEFAULT_PROJECT_AUTH_RATE_LIMITS;
  return {
    limits: {
      sign_in: { ...effective.sign_in },
      mail: { ...effective.mail },
      refresh: { ...effective.refresh },
    },
    defaults: {
      sign_in: { ...DEFAULT_PROJECT_AUTH_RATE_LIMITS.sign_in },
      mail: { ...DEFAULT_PROJECT_AUTH_RATE_LIMITS.mail },
      refresh: { ...DEFAULT_PROJECT_AUTH_RATE_LIMITS.refresh },
    },
    bounds: PROJECT_AUTH_RATE_LIMIT_BOUNDS,
    kinds: PROJECT_AUTH_RATE_LIMIT_KINDS,
    configured,
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
  };
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
