import type { AuthSession, AuthUser } from "@/lib/server/auth/model";
import {
  DuplicateEmailError,
  type SessionRepository,
  type UserRepository,
} from "@/lib/server/auth/repositories";

function cloneUser(user: AuthUser): AuthUser {
  return { ...user, createdAt: new Date(user.createdAt), updatedAt: new Date(user.updatedAt) };
}

function cloneSession(session: AuthSession): AuthSession {
  return {
    ...session,
    createdAt: new Date(session.createdAt),
    expiresAt: new Date(session.expiresAt),
    revokedAt: session.revokedAt ? new Date(session.revokedAt) : null,
  };
}

export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, AuthUser>();
  private readonly idsByEmail = new Map<string, string>();

  async findByEmail(email: string): Promise<AuthUser | null> {
    const id = this.idsByEmail.get(email);
    const user = id ? this.users.get(id) : undefined;
    return user ? cloneUser(user) : null;
  }

  async findById(id: string): Promise<AuthUser | null> {
    const user = this.users.get(id);
    return user ? cloneUser(user) : null;
  }

  async create(user: AuthUser): Promise<AuthUser> {
    if (this.idsByEmail.has(user.email)) throw new DuplicateEmailError();
    const stored = cloneUser(user);
    this.users.set(stored.id, stored);
    this.idsByEmail.set(stored.email, stored.id);
    return cloneUser(stored);
  }
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly sessionsByTokenHash = new Map<string, AuthSession>();

  async create(session: AuthSession): Promise<AuthSession> {
    const stored = cloneSession(session);
    this.sessionsByTokenHash.set(stored.tokenHash, stored);
    return cloneSession(stored);
  }

  async findActiveByTokenHash(tokenHash: string, now: Date): Promise<AuthSession | null> {
    const session = this.sessionsByTokenHash.get(tokenHash);
    if (!session || session.revokedAt || session.expiresAt.getTime() <= now.getTime()) return null;
    return cloneSession(session);
  }

  async revokeByTokenHash(tokenHash: string, revokedAt: Date): Promise<boolean> {
    const session = this.sessionsByTokenHash.get(tokenHash);
    if (!session || session.revokedAt) return false;
    session.revokedAt = new Date(revokedAt);
    return true;
  }

  async revokeAllForUser(userId: string, revokedAt: Date): Promise<number> {
    let revoked = 0;
    for (const session of this.sessionsByTokenHash.values()) {
      if (session.userId === userId && !session.revokedAt) {
        session.revokedAt = new Date(revokedAt);
        revoked += 1;
      }
    }
    return revoked;
  }
}
