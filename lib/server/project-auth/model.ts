import type { Environment } from "@/lib/types";
import type {
  ProjectAuthRateLimitKind,
  ProjectAuthRateLimits,
} from "@/lib/server/project-auth/rate-limits";
import type { ProjectAuthPasswordProtection } from "@/lib/server/project-auth/password-leaks";
import type { ProjectAuthHooks } from "@/lib/server/project-auth/hooks";

export type ProjectAuthScope = {
  organizationId: string;
  projectId: string;
  environment: Environment;
};

export type ProjectAuthUserStatus = "active" | "disabled";

export type ProjectAuthUser = ProjectAuthScope & {
  id: string;
  email: string;
  passwordHash: string | null;
  status: ProjectAuthUserStatus;
  emailVerifiedAt: Date | null;
  userMetadata: Record<string, unknown>;
  appMetadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicProjectAuthUser = Omit<ProjectAuthUser, "passwordHash" | "organizationId">;

export type ProjectAuthAssurance = "aal1" | "aal2";

export type ProjectAuthSession = ProjectAuthScope & {
  id: string;
  userId: string;
  familyId: string;
  refreshTokenHash: string;
  assurance: ProjectAuthAssurance;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBySessionId: string | null;
  compromisedAt: Date | null;
};

/**
 * Was die Admin-Sicht von einer Sitzung zeigt (2.34). Bewusst ohne den
 * Verifier des Refresh Tokens und ohne Scope-Spalten: die Liste verlaesst
 * den Server und darf nichts enthalten, womit sich eine Sitzung nachbauen
 * oder einem anderen Mandanten zuordnen liesse.
 */
export type ProjectAuthSessionSummary = {
  id: string;
  familyId: string;
  assurance: ProjectAuthAssurance;
  createdAt: Date;
  expiresAt: Date;
  replacedBySessionId: string | null;
};

export type ProjectAuthOneTimePurpose =
  | "email_verification"
  | "magic_link"
  | "password_reset"
  | "oidc_state"
  /**
   * Die offene SAML-AuthnRequest (2.99). Sie traegt keinen Nutzer und wird
   * **nicht** verbraucht: Der Riegel gegen eine zweite Einreichung derselben
   * Assertion liegt in project_auth_saml_assertions, nicht hier. Eine
   * verbrauchte Anfrage haette die zweite Einreichung mit dem falschen Grund
   * abgewiesen und den eigentlichen Riegel nie gezeigt.
   */
  | "saml_request"
  | "mfa_challenge"
  | "mfa_enrollment"
  /**
   * Die Herausforderung fuer einen neuen Passkey (2.79). Getrennt von der
   * Herausforderung der Anmeldung, weil sonst eine Herausforderung, die ein
   * angemeldeter Nutzer fuer ein neues Geraet geholt hat, an der Anmeldung
   * einloesbar waere.
   */
  | "passkey_registration"
  /** Die Herausforderung fuer eine Anmeldung mit Passkey (2.79), ohne Nutzer. */
  | "passkey_authentication";

export type ProjectAuthOneTimeToken = ProjectAuthScope & {
  id: string;
  userId: string | null;
  purpose: ProjectAuthOneTimePurpose;
  tokenHash: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
};

export type ProjectAuthMfaFactor = ProjectAuthScope & {
  id: string;
  userId: string;
  encryptedSecret: string;
  recoveryCodeHashes: string[];
  createdAt: Date;
  verifiedAt: Date | null;
};

/**
 * Ein abgelegter Passkey (2.79).
 *
 * Es gibt kein Gegenstueck zu `encryptedSecret` des zweiten Faktors, und das
 * ist der Punkt: Hier liegt ein **oeffentlicher** Schluessel. Der private Teil
 * verlaesst den Authenticator nie, auch nicht auf dem Weg hierher.
 *
 * `signCount` ist der Stand, den der Authenticator bei der letzten Benutzung
 * genannt hat. Er wandert bei jeder Anmeldung mit, weil die naechste Anmeldung
 * ihn braucht: Ein Stand, der nicht gewachsen ist, heisst geklonter Schluessel.
 * Ein Authenticator, der keinen Zaehler fuehrt, laesst ihn auf 0.
 */
export type ProjectAuthPasskey = ProjectAuthScope & {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  algorithm: number;
  signCount: number;
  userVerified: boolean;
  attestationFormat: string;
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
};

/**
 * Was die Liste eines Nutzers und die Uebersicht der Console von einem Passkey
 * zeigen. Ohne Scope-Spalten und **ohne den oeffentlichen Schluessel**: Er ist
 * kein Geheimnis, aber er hat in einer Liste nichts zu suchen, die nur sagen
 * soll, welche Geraete es gibt.
 */
export type PublicProjectAuthPasskey = {
  id: string;
  credentialId: string;
  algorithm: number;
  signCount: number;
  userVerified: boolean;
  attestationFormat: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export function publicProjectAuthPasskey(passkey: ProjectAuthPasskey): PublicProjectAuthPasskey {
  return {
    id: passkey.id,
    credentialId: passkey.credentialId,
    algorithm: passkey.algorithm,
    signCount: passkey.signCount,
    userVerified: passkey.userVerified,
    attestationFormat: passkey.attestationFormat,
    label: passkey.label,
    createdAt: new Date(passkey.createdAt).toISOString(),
    lastUsedAt: passkey.lastUsedAt ? new Date(passkey.lastUsedAt).toISOString() : null,
  };
}

/** Wie viele App-Nutzer einen Passkey haben und wie viele Passkeys es gibt (2.79). */
export type ProjectAuthPasskeyCount = {
  users: number;
  passkeys: number;
  usersWithPasskey: number;
};

/**
 * Was eine Projektumgebung ueber ihre Anmeldung festlegt (2.52, erweitert in
 * 2.54). Die Zeile fehlt, solange niemand etwas angefasst hat; eine fehlende
 * Zeile heisst "nicht erzwungen" und "nicht verengt".
 *
 * `returnTargets` sind die erlaubten Ruecksprungziele als exakte Herkuenfte.
 * Eine leere Liste verengt nichts: Dann gilt allein die aeussere Grenze aus
 * der Prozessumgebung. Weiten kann die Liste sie nie.
 */
export type ProjectAuthSettings = ProjectAuthScope & {
  mfaRequired: boolean;
  returnTargets: string[];
  /**
   * Die Grenzen je Zeitfenster (2.56). Eine fehlende Zeile heisst hier
   * "Vorgabe", nicht "keine Grenze": Ohne Einstellung gelten
   * `DEFAULT_PROJECT_AUTH_RATE_LIMITS`, und die sind genau das, was der
   * Dienst vor 2.56 im Prozessspeicher hielt.
   */
  rateLimits: ProjectAuthRateLimits;
  /**
   * Der Passwortschutz (2.53). Eine fehlende Zeile heisst "aus": Ohne
   * Einstellung gilt `DEFAULT_PROJECT_AUTH_PASSWORD_PROTECTION`, also keine
   * Pruefung gegen Lecks und die 12 Zeichen, die der Dienst ohnehin verlangt.
   * Die Liste selbst steht nie hier und nie in der Datenbank.
   */
  passwordProtection: ProjectAuthPasswordProtection;
  /**
   * Die Auth-Hooks (2.77). Eine fehlende Zeile heisst "kein Hook an keinem
   * Punkt": Ohne Einstellung gilt `DEFAULT_PROJECT_AUTH_HOOKS`, und dann ruft
   * die Anmeldung nichts und verhaelt sich wie vor 2.77. Ein Punkt ohne
   * hinterlegte Function ist derselbe Zustand, darum gibt es keinen Schalter
   * daneben.
   */
  hooks: ProjectAuthHooks;
  updatedAt: Date;
};

/**
 * Was ein Versuch beim Zaehler hinterlaesst (2.56): der Stand **nach** dem
 * Hochzaehlen und der Anfang des Fensters, in dem gezaehlt wurde. Mehr
 * braucht die Entscheidung nicht, und mehr gibt die Zaehltabelle auch nicht
 * her — der Schluessel selbst steht dort nur als Hash.
 */
export type ProjectAuthRateCount = {
  kind: ProjectAuthRateLimitKind;
  attempts: number;
  windowStart: Date;
};

/** Wie viele App-Nutzer es gibt und wie viele davon einen bestaetigten Faktor haben. */
export type ProjectAuthMfaEnrolmentCount = {
  users: number;
  enrolled: number;
};

/**
 * Eine schon benutzte SAML-Assertion (2.99).
 *
 * Es steht nur die `ID` hier und kein Inhalt: Der Riegel muss wissen, ob diese
 * Assertion schon einmal eine Sitzung erzeugt hat, und sonst nichts. Keine
 * Adresse, kein Subject, kein XML. `expiresAt` ist das `NotOnOrAfter` der
 * Assertion; danach darf die Zeile weg, weil eine abgelaufene Assertion schon
 * am Zeitfenster scheitert.
 */
export type ProjectAuthSamlAssertion = ProjectAuthScope & {
  id: string;
  provider: string;
  assertionId: string;
  usedAt: Date;
  expiresAt: Date;
};

export type ProjectAuthOidcIdentity = ProjectAuthScope & {
  id: string;
  userId: string;
  provider: string;
  subject: string;
  createdAt: Date;
  lastSignInAt: Date;
};

export function publicProjectAuthUser(user: ProjectAuthUser): PublicProjectAuthUser {
  const { passwordHash: _passwordHash, organizationId: _organizationId, ...publicUser } = user;
  return {
    ...publicUser,
    emailVerifiedAt: publicUser.emailVerifiedAt ? new Date(publicUser.emailVerifiedAt) : null,
    createdAt: new Date(publicUser.createdAt),
    updatedAt: new Date(publicUser.updatedAt),
    userMetadata: { ...publicUser.userMetadata },
    appMetadata: { ...publicUser.appMetadata },
  };
}
