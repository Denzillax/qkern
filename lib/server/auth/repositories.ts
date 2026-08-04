import type { AuthSession, AuthUser } from "@/lib/server/auth/model";

export class DuplicateEmailError extends Error {
  constructor() {
    super("DUPLICATE_EMAIL");
    this.name = "DuplicateEmailError";
  }
}

export interface UserRepository {
  findByEmail(email: string): Promise<AuthUser | null>;
  findById(id: string): Promise<AuthUser | null>;
  create(user: AuthUser): Promise<AuthUser>;
}

export interface SessionRepository {
  create(session: AuthSession): Promise<AuthSession>;
  findActiveByTokenHash(tokenHash: string, now: Date): Promise<AuthSession | null>;
  revokeByTokenHash(tokenHash: string, revokedAt: Date): Promise<boolean>;
  revokeAllForUser(userId: string, revokedAt: Date): Promise<number>;
}

export interface RegistrationRepository {
  create(user: AuthUser, session: AuthSession): Promise<{ user: AuthUser; session: AuthSession }>;
}
