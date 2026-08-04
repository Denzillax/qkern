import { describe, expect, it } from "vitest";
import { PostgresRegistrationRepository, PostgresSessionRepository, PostgresUserRepository } from "@/lib/server/auth/postgres-repositories";
import { DuplicateEmailError } from "@/lib/server/auth/repositories";
import type { SqlPool, SqlPoolClient, SqlQueryable, SqlQueryResult, SqlValue } from "@/lib/server/db/sql";

const USER_ID = "b05b5e3f-8baf-4a6b-965d-d0087a6c7bca";
const SESSION_ID = "412cb46b-6313-4a74-8480-9d9e9e240e36";
const TOKEN_HASH = "A".repeat(43);
const CREATED_AT = new Date("2026-07-17T12:00:00.000Z");
const EXPIRES_AT = new Date("2026-08-17T12:00:00.000Z");

class QueueDatabase implements SqlQueryable {
  readonly calls: Array<{ text: string; values?: readonly SqlValue[] }> = [];

  constructor(private readonly responses: Array<Record<string, unknown>[] | Error>) {}

  async query<Row extends Record<string, unknown>>(
    text: string,
    values?: readonly SqlValue[],
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    const response = this.responses.shift() ?? [];
    if (response instanceof Error) throw response;
    return { rows: response as Row[], rowCount: response.length };
  }
}

const userRow = {
  id: USER_ID,
  email: "owner@example.com",
  password_hash: "$argon2id$test-only",
  status: "active",
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const sessionRow = {
  id: SESSION_ID,
  user_id: USER_ID,
  token_hash: TOKEN_HASH,
  created_at: CREATED_AT,
  expires_at: EXPIRES_AT,
  revoked_at: null,
};

class RegistrationPool implements SqlPool, SqlPoolClient {
  readonly calls: string[] = [];
  async connect() { return this; }
  async query<Row extends Record<string, unknown>>(text: string): Promise<SqlQueryResult<Row>> {
    this.calls.push(text.trim().split(/\s+/).slice(0, 3).join(" "));
    const rows = text.includes("INSERT INTO users") ? [userRow] : text.includes("INSERT INTO auth_sessions") ? [sessionRow] : [];
    return { rows: rows as unknown as Row[], rowCount: rows.length };
  }
  release() {}
  async end() {}
}

describe("PostgreSQL auth repositories", () => {
  it("canonicalizes email lookups and excludes soft-deleted users", async () => {
    const database = new QueueDatabase([[userRow]]);
    const user = await new PostgresUserRepository(database).findByEmail(" Owner@Example.COM ");

    expect(user?.email).toBe("owner@example.com");
    expect(database.calls[0].text).toContain("deleted_at IS NULL");
    expect(database.calls[0].values).toEqual(["owner@example.com"]);
  });

  it("maps only the canonical-email constraint to the auth duplicate error", async () => {
    const duplicate = Object.assign(new Error("duplicate"), {
      code: "23505",
      constraint: "users_canonical_email_unique",
    });
    const database = new QueueDatabase([duplicate]);
    const users = new PostgresUserRepository(database);

    await expect(users.create({
      id: USER_ID,
      email: "OWNER@example.com",
      passwordHash: "$argon2id$test-only",
      status: "active",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it("persists only a token hash and requires revocation and expiry checks", async () => {
    const database = new QueueDatabase([[sessionRow], [sessionRow]]);
    const sessions = new PostgresSessionRepository(database);
    await sessions.create({
      id: SESSION_ID,
      userId: USER_ID,
      tokenHash: TOKEN_HASH,
      createdAt: CREATED_AT,
      expiresAt: EXPIRES_AT,
      revokedAt: null,
    });
    const active = await sessions.findActiveByTokenHash(TOKEN_HASH, CREATED_AT);

    expect(active?.id).toBe(SESSION_ID);
    expect(database.calls[0].text).toContain("token_hash");
    expect(database.calls[0].text).not.toMatch(/\btoken\b(?!_hash)/);
    expect(database.calls[0].values).not.toContain("raw-bearer-token");
    expect(database.calls[1].text).toContain("revoked_at IS NULL");
    expect(database.calls[1].text).toContain("expires_at > $2");
  });

  it("rejects values that are not SHA-256 base64url token hashes", async () => {
    const sessions = new PostgresSessionRepository(new QueueDatabase([]));
    await expect(sessions.findActiveByTokenHash("raw-bearer-token", CREATED_AT)).rejects.toMatchObject({
      code: "INVALID_RECORD",
    });
  });

  it("revokes one or all sessions without changing already-revoked rows", async () => {
    const database = new QueueDatabase([[{}], [{}, {}]]);
    const sessions = new PostgresSessionRepository(database);

    await expect(sessions.revokeByTokenHash(TOKEN_HASH, CREATED_AT)).resolves.toBe(true);
    await expect(sessions.revokeAllForUser(USER_ID, CREATED_AT)).resolves.toBe(2);
    expect(database.calls[0].text).toContain("revoked_at IS NULL");
    expect(database.calls[1].text).toContain("revoked_at IS NULL");
  });

  it("creates a user and first session in one database transaction", async () => {
    const pool = new RegistrationPool();
    await new PostgresRegistrationRepository(pool).create({
      id: USER_ID, email: "owner@example.com", passwordHash: "$argon2id$test-only", status: "active",
      createdAt: CREATED_AT, updatedAt: CREATED_AT,
    }, {
      id: SESSION_ID, userId: USER_ID, tokenHash: TOKEN_HASH, createdAt: CREATED_AT, expiresAt: EXPIRES_AT, revokedAt: null,
    });
    expect(pool.calls).toEqual(["BEGIN", "INSERT INTO users", "INSERT INTO auth_sessions", "COMMIT"]);
  });
});
