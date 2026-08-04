import type { AuthSession, AuthUser } from "@/lib/server/auth/model";
import {
  DuplicateEmailError,
  type RegistrationRepository,
  type SessionRepository,
  type UserRepository,
} from "@/lib/server/auth/repositories";
import { InvalidRecordError, mapPostgresError } from "@/lib/server/db/errors";
import type { SqlPool, SqlQueryable, SqlQueryResult, SqlValue } from "@/lib/server/db/sql";

type DbRow = Record<string, unknown>;
type PostgresError = Error & { code?: string; constraint?: string };

function canonicalEmail(email: string): string {
  return email.trim().toLowerCase();
}

function timestamp(value: unknown, field: string): Date {
  const parsed = value instanceof Date ? new Date(value) : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new InvalidRecordError(`The database returned an invalid ${field}.`);
  return parsed;
}

function nullableTimestamp(value: unknown, field: string): Date | null {
  return value === null || value === undefined ? null : timestamp(value, field);
}

function userFromRow(row: DbRow): AuthUser {
  if (row.status !== "active" && row.status !== "disabled") {
    throw new InvalidRecordError("The database returned an invalid user status.");
  }
  return {
    id: String(row.id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    status: row.status,
    createdAt: timestamp(row.created_at, "user creation timestamp"),
    updatedAt: timestamp(row.updated_at, "user update timestamp"),
  };
}

function sessionFromRow(row: DbRow): AuthSession {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    tokenHash: String(row.token_hash),
    createdAt: timestamp(row.created_at, "session creation timestamp"),
    expiresAt: timestamp(row.expires_at, "session expiry timestamp"),
    revokedAt: nullableTimestamp(row.revoked_at, "session revocation timestamp"),
  };
}

function assertSessionTokenHash(tokenHash: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/.test(tokenHash)) {
    throw new InvalidRecordError("tokenHash must be a base64url-encoded SHA-256 digest.");
  }
}

async function query<Row extends DbRow>(
  database: SqlQueryable,
  text: string,
  values: readonly SqlValue[],
): Promise<SqlQueryResult<Row>> {
  try {
    return await database.query<Row>(text, values);
  } catch (error) {
    throw mapPostgresError(error);
  }
}

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly database: SqlQueryable) {}

  async findByEmail(email: string): Promise<AuthUser | null> {
    const result = await query(
      this.database,
      `SELECT id, email, password_hash, status, created_at, updated_at
       FROM users
       WHERE email = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [canonicalEmail(email)],
    );
    return result.rows[0] ? userFromRow(result.rows[0]) : null;
  }

  async findById(id: string): Promise<AuthUser | null> {
    const result = await query(
      this.database,
      `SELECT id, email, password_hash, status, created_at, updated_at
       FROM users
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [id],
    );
    return result.rows[0] ? userFromRow(result.rows[0]) : null;
  }

  async create(user: AuthUser): Promise<AuthUser> {
    try {
      const result = await this.database.query(
        `INSERT INTO users (id, email, password_hash, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, email, password_hash, status, created_at, updated_at`,
        [user.id, canonicalEmail(user.email), user.passwordHash, user.status, user.createdAt, user.updatedAt],
      );
      return userFromRow(result.rows[0]);
    } catch (error) {
      const postgresError = error as PostgresError;
      if (postgresError.code === "23505" && postgresError.constraint === "users_canonical_email_unique") {
        throw new DuplicateEmailError();
      }
      throw mapPostgresError(error);
    }
  }
}

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly database: SqlQueryable) {}

  async create(session: AuthSession): Promise<AuthSession> {
    assertSessionTokenHash(session.tokenHash);
    const result = await query(
      this.database,
      `INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, token_hash, created_at, expires_at, revoked_at`,
      [session.id, session.userId, session.tokenHash, session.createdAt, session.expiresAt, session.revokedAt],
    );
    return sessionFromRow(result.rows[0]);
  }

  async findActiveByTokenHash(tokenHash: string, now: Date): Promise<AuthSession | null> {
    assertSessionTokenHash(tokenHash);
    const result = await query(
      this.database,
      `SELECT id, user_id, token_hash, created_at, expires_at, revoked_at
       FROM auth_sessions
       WHERE token_hash = $1
         AND revoked_at IS NULL
         AND expires_at > $2
       LIMIT 1`,
      [tokenHash, now],
    );
    return result.rows[0] ? sessionFromRow(result.rows[0]) : null;
  }

  async revokeByTokenHash(tokenHash: string, revokedAt: Date): Promise<boolean> {
    assertSessionTokenHash(tokenHash);
    const result = await query(
      this.database,
      `UPDATE auth_sessions
       SET revoked_at = $2
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash, revokedAt],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async revokeAllForUser(userId: string, revokedAt: Date): Promise<number> {
    const result = await query(
      this.database,
      `UPDATE auth_sessions
       SET revoked_at = $2
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId, revokedAt],
    );
    return result.rowCount ?? 0;
  }
}

export class PostgresRegistrationRepository implements RegistrationRepository {
  constructor(private readonly pool: SqlPool) {}

  async create(user: AuthUser, session: AuthSession): Promise<{ user: AuthUser; session: AuthSession }> {
    const client = await this.pool.connect();
    let started = false;
    let released = false;
    try {
      await client.query("BEGIN");
      started = true;
      const createdUser = await new PostgresUserRepository(client).create(user);
      const createdSession = await new PostgresSessionRepository(client).create(session);
      await client.query("COMMIT");
      started = false;
      return { user: createdUser, session: createdSession };
    } catch (error) {
      if (started) {
        try { await client.query("ROLLBACK"); } catch { client.release(true); released = true; throw error; }
        started = false;
      }
      throw error;
    } finally {
      if (!released) client.release();
    }
  }
}
