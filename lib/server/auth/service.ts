import { recognisedByName } from "@/lib/server/errors/identity";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AuthSession, AuthUser, PublicAuthUser } from "@/lib/server/auth/model";
import { toPublicAuthUser } from "@/lib/server/auth/model";
import type { PasswordHasher } from "@/lib/server/auth/password";
import type { RateLimiter } from "@/lib/server/auth/rate-limit";
import type { RegistrationRepository, SessionRepository, UserRepository } from "@/lib/server/auth/repositories";
import { DuplicateEmailError } from "@/lib/server/auth/repositories";

export type AuthServiceDependencies = {
  users: UserRepository;
  sessions: SessionRepository;
  passwords: PasswordHasher;
  rateLimiter: RateLimiter;
  registration?: RegistrationRepository;
  now?: () => Date;
  token?: () => string;
  id?: () => string;
  sessionTtlMs?: number;
};

export type AuthResult = {
  user: PublicAuthUser;
  session: Pick<AuthSession, "id" | "createdAt" | "expiresAt">;
  token: string;
};

export type AuthErrorCode = "ACCOUNT_EXISTS" | "INVALID_CREDENTIALS" | "INVALID_SESSION" | "RATE_LIMITED";

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = "AuthError";
  }
}
recognisedByName(AuthError, "AuthError");

/**
 * Erkennt einen AuthError an Name und Code, nicht an der Klassenidentitaet.
 *
 * Die Auth-Laufzeit liegt im Dev-Modus auf `globalThis` und ueberlebt jeden
 * Hot-Reload; die Klasse `AuthError` wird dabei neu geladen. Ein Fehler aus
 * der alten Laufzeit fiel beim `instanceof` der neuen Routen durch, und aus
 * einem 401 mit Weiterleitung zum Login wurde ein 500 "Console-Daten nicht
 * verfuegbar" (2.8). Dieselbe Falle droht ueberall, wo zwei Modulgraphen
 * denselben Fehler werfen und fangen.
 */
export function isAuthError(error: unknown, code?: AuthErrorCode): error is AuthError {
  if (!(error instanceof Error) || error.name !== "AuthError") return false;
  const candidate = error as Error & { code?: unknown };
  if (typeof candidate.code !== "string") return false;
  return code === undefined || candidate.code === code;
}

const REGISTER_RATE = { limit: 5, windowMs: 60 * 60 * 1_000 };
const LOGIN_RATE = { limit: 10, windowMs: 15 * 60 * 1_000 };

function canonicalEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export class AuthService {
  private readonly now: () => Date;
  private readonly token: () => string;
  private readonly id: () => string;
  private readonly sessionTtlMs: number;

  constructor(private readonly dependencies: AuthServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.token = dependencies.token ?? (() => randomBytes(32).toString("base64url"));
    this.id = dependencies.id ?? (() => randomUUID());
    this.sessionTtlMs = dependencies.sessionTtlMs ?? 30 * 24 * 60 * 60 * 1_000;
  }

  async register(input: { email: string; password: string; rateLimitKey: string }): Promise<AuthResult> {
    const now = this.now();
    await this.assertRateLimit(`register:${input.rateLimitKey}`, REGISTER_RATE, now);
    const email = canonicalEmail(input.email);
    if (await this.dependencies.users.findByEmail(email)) throw new AuthError("ACCOUNT_EXISTS");

    const user: AuthUser = {
      id: this.id(),
      email,
      passwordHash: await this.dependencies.passwords.hash(input.password),
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    const { token, session } = this.buildSession(user, now);
    try {
      if (this.dependencies.registration) {
        await this.dependencies.registration.create(user, session);
      } else {
        await this.dependencies.users.create(user);
        await this.dependencies.sessions.create(session);
      }
    } catch (error) {
      if (error instanceof DuplicateEmailError) throw new AuthError("ACCOUNT_EXISTS");
      throw error;
    }
    return { user: toPublicAuthUser(user), session: this.publicSession(session), token };
  }

  async login(input: { email: string; password: string; rateLimitKey: string }): Promise<AuthResult> {
    const now = this.now();
    await this.assertRateLimit(`login:${input.rateLimitKey}`, LOGIN_RATE, now);
    const user = await this.dependencies.users.findByEmail(canonicalEmail(input.email));
    const validPassword = await this.dependencies.passwords.verify(
      input.password,
      user?.passwordHash ?? this.dependencies.passwords.dummyHash,
    );
    if (!user || !validPassword || user.status !== "active") throw new AuthError("INVALID_CREDENTIALS");
    return this.createSession(user, now);
  }

  async getSession(token: string): Promise<{ user: PublicAuthUser; session: Pick<AuthSession, "id" | "createdAt" | "expiresAt"> }> {
    const now = this.now();
    const session = await this.dependencies.sessions.findActiveByTokenHash(hashSessionToken(token), now);
    if (!session) throw new AuthError("INVALID_SESSION");
    const user = await this.dependencies.users.findById(session.userId);
    if (!user || user.status !== "active") {
      await this.dependencies.sessions.revokeByTokenHash(session.tokenHash, now);
      throw new AuthError("INVALID_SESSION");
    }
    return { user: toPublicAuthUser(user), session: this.publicSession(session) };
  }

  async logout(token: string): Promise<void> {
    await this.dependencies.sessions.revokeByTokenHash(hashSessionToken(token), this.now());
  }

  async revokeAllSessions(userId: string): Promise<number> {
    return this.dependencies.sessions.revokeAllForUser(userId, this.now());
  }

  private async createSession(user: AuthUser, now: Date): Promise<AuthResult> {
    const { token, session } = this.buildSession(user, now);
    await this.dependencies.sessions.create(session);
    return { user: toPublicAuthUser(user), session: this.publicSession(session), token };
  }

  private buildSession(user: AuthUser, now: Date): { token: string; session: AuthSession } {
    const token = this.token();
    const session: AuthSession = {
      id: this.id(),
      userId: user.id,
      tokenHash: hashSessionToken(token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.sessionTtlMs),
      revokedAt: null,
    };
    return { token, session };
  }

  private publicSession(session: AuthSession): Pick<AuthSession, "id" | "createdAt" | "expiresAt"> {
    return { id: session.id, createdAt: session.createdAt, expiresAt: session.expiresAt };
  }

  private async assertRateLimit(key: string, policy: { limit: number; windowMs: number }, now: Date): Promise<void> {
    const decision = await this.dependencies.rateLimiter.consume(key, policy, now);
    if (!decision.allowed) throw new AuthError("RATE_LIMITED", decision.retryAfterSeconds);
  }
}
