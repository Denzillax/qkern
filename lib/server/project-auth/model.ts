import type { Environment } from "@/lib/types";

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
  | "mfa_challenge"
  | "mfa_enrollment";

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
  updatedAt: Date;
};

/** Wie viele App-Nutzer es gibt und wie viele davon einen bestaetigten Faktor haben. */
export type ProjectAuthMfaEnrolmentCount = {
  users: number;
  enrolled: number;
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
