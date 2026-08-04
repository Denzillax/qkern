export type AuthUser = {
  id: string;
  email: string;
  passwordHash: string;
  status: "active" | "disabled";
  createdAt: Date;
  updatedAt: Date;
};

export type AuthSession = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type PublicAuthUser = Pick<AuthUser, "id" | "email" | "status" | "createdAt">;

export function toPublicAuthUser(user: AuthUser): PublicAuthUser {
  return {
    id: user.id,
    email: user.email,
    status: user.status,
    createdAt: user.createdAt,
  };
}
