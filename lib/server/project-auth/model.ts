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

export type ProjectAuthOneTimePurpose =
  | "email_verification"
  | "magic_link"
  | "password_reset"
  | "oidc_state"
  | "mfa_challenge";

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
