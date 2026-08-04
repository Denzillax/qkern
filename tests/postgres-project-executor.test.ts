import { describe, expect, it } from "vitest";
import { sha256 } from "@/lib/server/control-plane/crypto";
import type { SqlPool, SqlPoolClient, SqlQueryResult, SqlValue } from "@/lib/server/db/sql";
import { PostgresProjectDatabaseExecutor } from "@/lib/server/migrations/postgres-executor";
import type { ProjectDatabaseExecutionInput } from "@/lib/server/migrations/executor";

const STATEMENT = "CREATE INDEX products_name_idx ON products(name)";
const HASH = sha256(STATEMENT);
const FENCE = {
  jobId: "11111111-1111-4111-8111-111111111111",
  fenceEpoch: "1",
  leaseToken: "22222222-2222-4222-8222-222222222222",
} as const;

class RecordingClient implements SqlPoolClient {
  readonly calls: Array<{ text: string; values?: readonly SqlValue[] }> = [];
  releasedWith?: Error | boolean;

  constructor(
    private readonly ledgerContainsHash = false,
    private readonly failOn?: { text: string; error: Error & { code?: string } },
    private readonly roleOverrides: Record<string, unknown> = {},
    private readonly ledgerOverrides: Record<string, unknown> = {},
    private readonly fenceOverrides: Record<string, unknown> = {},
    private readonly fenceRecordOverrides: Record<string, unknown> = {},
  ) {}

  async query<Row extends Record<string, unknown>>(text: string, values?: readonly SqlValue[]): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    if (this.failOn && text === this.failOn.text) throw this.failOn.error;
    if (text.includes("FROM pg_roles AS role")) {
      return { rows: [{
        rolname: "qkern_project_migrator", session_user: "qkern_project_migrator", database_name: "project_database",
        rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false,
        rolreplication: false, privileged_member: false, unexpected_member: false,
        ...this.roleOverrides,
      }] as unknown as Row[], rowCount: 1 };
    }
    if (text.includes("migration_fences") && text.includes("FROM pg_class relation")) {
      return { rows: [{
        relkind: "r", relpersistence: "p", owned_by_current_user: false,
        member_of_relation_owner: false, member_of_schema_owner: false, has_user_triggers: false,
        has_user_rules: false, row_security: false, can_select: true, can_insert: true,
        can_update_allowed_columns: true, has_dangerous_table_privileges: false, can_create_in_schema: false,
        has_exact_columns: true, has_exact_column_types: true, has_job_primary_key: true, has_epoch_check: true, has_hash_check: true,
        has_unexpected_table_acl: false, has_unexpected_column_acl: false, has_unexpected_schema_acl: false, owner_name: "qkern_ledger_owner",
        owner_can_login: false, owner_is_privileged: false, owner_has_memberships: false, owner_matches_schema: true,
        ...this.fenceOverrides,
      }] as unknown as Row[], rowCount: 1 };
    }
    if (text.includes("FROM pg_class AS relation")) {
      return { rows: [{
        relkind: "r", relpersistence: "p", owned_by_current_user: false,
        member_of_relation_owner: false, member_of_schema_owner: false,
        has_user_triggers: false, has_user_rules: false, row_security: false,
        can_select: true, can_insert: true, has_dangerous_table_privileges: false, can_create_in_schema: false,
        has_change_set_uuid: true, has_statement_hash_text: true, has_applied_at_timestamp: true,
        has_exact_columns: true, has_change_set_primary_key: true, has_hash_check: true,
        has_unexpected_table_acl: false, has_unexpected_schema_acl: false,
        owner_name: "qkern_ledger_owner", owner_can_login: false, owner_is_privileged: false,
        owner_has_memberships: false, owner_matches_schema: true,
        ...this.ledgerOverrides,
      }] as unknown as Row[], rowCount: 1 };
    }
    if (text.startsWith("SELECT statement_sha256")) {
      const rows = this.ledgerContainsHash ? [{ statement_sha256: HASH }] : [];
      return { rows: rows as unknown as Row[], rowCount: rows.length };
    }
    if (text.startsWith("INSERT INTO qkern_internal.migration_fences") ||
        text.includes("FROM qkern_internal.migration_fences WHERE job_id")) {
      return { rows: [{
        fence_epoch: FENCE.fenceEpoch, lease_token: FENCE.leaseToken, statement_sha256: HASH,
        ...this.fenceRecordOverrides,
      }] as unknown as Row[], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  release(error?: Error | boolean): void { this.releasedWith = error; }
}

function pool(client: RecordingClient): SqlPool {
  return {
    connect: async () => client,
    query: async () => ({ rows: [], rowCount: 0 }),
    end: async () => undefined,
  };
}

function executor(client: RecordingClient) {
  const target = new PostgresProjectDatabaseExecutor({
    resolve: () => ({
      pool: pool(client), expectedRole: "qkern_project_migrator", expectedDatabase: "project_database",
      expectedLedgerOwner: "qkern_ledger_owner",
    }),
  });
  return {
    execute: (input: Omit<ProjectDatabaseExecutionInput, keyof typeof FENCE>) => target.execute({ ...input, ...FENCE }),
    reconcile: (input: Omit<Parameters<typeof target.reconcile>[0], keyof typeof FENCE>) => target.reconcile({ ...input, ...FENCE }),
  };
}

describe("PostgreSQL project database executor", () => {
  it("classifies resolver failures as safely retryable before any execution starts", async () => {
    const guarded = new PostgresProjectDatabaseExecutor({ resolve: () => { throw new Error("vault unavailable"); } });
    await expect(guarded.execute({
      databaseInstanceRef: "managed:database-1", changeSetId: "change-1", statement: STATEMENT, statementSha256: HASH, ...FENCE,
    })).rejects.toMatchObject({
      code: "PROJECT_DATABASE_RESOLUTION_FAILED", outcome: "not_started", retryable: true,
    });
  });

  it("applies one verified statement and its ledger record in the same bounded transaction", async () => {
    const client = new RecordingClient();
    await expect(executor(client).execute({
      databaseInstanceRef: "managed:database-1", changeSetId: "change-1", statement: STATEMENT, statementSha256: HASH,
    })).resolves.toEqual({ status: "applied" });

    const texts = client.calls.map((call) => call.text);
    expect(texts).toContain("SET LOCAL statement_timeout = '15s'");
    expect(texts).toContain("SET LOCAL lock_timeout = '3s'");
    expect(texts).toContain(STATEMENT);
    expect(texts.some((text) => text.startsWith("INSERT INTO qkern_internal.migration_ledger"))).toBe(true);
    expect(texts.at(-1)).toBe("COMMIT");
    expect(client.releasedWith).toBe(false);
  });

  it("uses the target ledger to make a repeated hash idempotent", async () => {
    const client = new RecordingClient(true);
    await expect(executor(client).execute({
      databaseInstanceRef: "managed:database-1", changeSetId: "change-1", statement: STATEMENT, statementSha256: HASH,
    })).resolves.toEqual({ status: "already_applied" });
    expect(client.calls.some((call) => call.text === STATEMENT)).toBe(false);
    expect(client.calls.at(-1)?.text).toBe("COMMIT");
  });

  it("reconciles an existing ledger entry without executing the migration statement", async () => {
    const client = new RecordingClient(true);
    await expect(executor(client).reconcile({
      databaseInstanceRef: "managed:database-1", changeSetId: "change-1", statementSha256: HASH,
    })).resolves.toEqual({ status: "applied" });
    expect(client.calls.some((call) => call.text === STATEMENT)).toBe(false);
    expect(client.calls.some((call) => call.text.startsWith("INSERT INTO qkern_internal"))).toBe(false);
    expect(client.calls.at(-1)?.text).toBe("COMMIT");
  });

  it("reports a missing ledger entry without executing or inserting anything", async () => {
    const client = new RecordingClient(false);
    await expect(executor(client).reconcile({
      databaseInstanceRef: "managed:database-1", changeSetId: "change-1", statementSha256: HASH,
    })).resolves.toEqual({ status: "not_applied" });
    expect(client.calls.some((call) => call.text === STATEMENT)).toBe(false);
    expect(client.calls.some((call) => call.text.startsWith("INSERT INTO qkern_internal"))).toBe(false);
    expect(client.calls.at(-1)?.text).toBe("COMMIT");
  });

  it("classifies a known lock failure as safely rolled back and retryable", async () => {
    const failure = Object.assign(new Error("lock unavailable"), { code: "55P03" });
    const client = new RecordingClient(false, { text: STATEMENT, error: failure });
    await expect(executor(client).execute({
      databaseInstanceRef: "managed:database-1", changeSetId: "change-1", statement: STATEMENT, statementSha256: HASH,
    })).rejects.toMatchObject({ code: "55P03", outcome: "rolled_back", retryable: true });
    expect(client.calls.at(-1)?.text).toBe("ROLLBACK");
  });

  it("never retries an ambiguous commit and discards its connection", async () => {
    const client = new RecordingClient(false, { text: "COMMIT", error: new Error("connection lost") });
    await expect(executor(client).execute({
      databaseInstanceRef: "managed:database-1", changeSetId: "change-1", statement: STATEMENT, statementSha256: HASH,
    })).rejects.toMatchObject({ code: "MIGRATION_FENCE_COMMIT_OUTCOME_UNKNOWN", outcome: "unknown", retryable: false });
    expect(client.calls.filter((call) => call.text === "ROLLBACK")).toHaveLength(0);
    expect(client.releasedWith).toBe(true);
  });

  it("rejects a connection whose active login differs from the catalog-bound migration role", async () => {
    const client = new RecordingClient(false, undefined, { rolname: "unexpected_login" });
    await expect(executor(client).execute({
      databaseInstanceRef: "managed:database-1", changeSetId: "change-1", statement: STATEMENT, statementSha256: HASH,
    })).rejects.toMatchObject({ code: "INVALID_PROJECT_DATABASE_ROLE", outcome: "not_started" });
    expect(client.calls.some((call) => call.text === "BEGIN")).toBe(false);
  });

  it("rejects dangerous role memberships before starting a transaction", async () => {
    const client = new RecordingClient(false, undefined, { privileged_member: true });
    await expect(executor(client).execute({
      databaseInstanceRef: "managed:database-1", changeSetId: "change-1", statement: STATEMENT, statementSha256: HASH,
    })).rejects.toMatchObject({ code: "INVALID_PROJECT_DATABASE_ROLE", outcome: "not_started" });
    expect(client.calls.some((call) => call.text === "BEGIN")).toBe(false);
  });

  it("rejects a privileged session login that switched into the expected current role", async () => {
    const client = new RecordingClient(false, undefined, { session_user: "database_owner" });
    await expect(executor(client).execute({
      databaseInstanceRef: "managed:database-1", changeSetId: "change-1", statement: STATEMENT, statementSha256: HASH,
    })).rejects.toMatchObject({ code: "INVALID_PROJECT_DATABASE_ROLE", outcome: "not_started" });
    expect(client.calls.some((call) => call.text === "BEGIN")).toBe(false);
  });

  it("rejects a pool connected to a database other than the immutable catalog binding", async () => {
    const client = new RecordingClient(false, undefined, { database_name: "other_project" });
    await expect(executor(client).execute({
      databaseInstanceRef: "managed:database-1", changeSetId: "change-1", statement: STATEMENT, statementSha256: HASH,
    })).rejects.toMatchObject({ code: "INVALID_PROJECT_DATABASE_ROLE", outcome: "not_started" });
    expect(client.calls.some((call) => call.text === "BEGIN")).toBe(false);
  });

  it("rolls back when the pre-provisioned ledger grants destructive privileges", async () => {
    const client = new RecordingClient(false, undefined, {}, { has_dangerous_table_privileges: true });
    await expect(executor(client).execute({
      databaseInstanceRef: "managed:database-1", changeSetId: "change-1", statement: STATEMENT, statementSha256: HASH,
    })).rejects.toMatchObject({ code: "INVALID_MIGRATION_LEDGER", outcome: "rolled_back" });
    expect(client.calls.at(-1)?.text).toBe("ROLLBACK");
  });

  it("rolls back when the pre-provisioned ledger does not have the expected primary key", async () => {
    const client = new RecordingClient(false, undefined, {}, { has_change_set_primary_key: false });
    await expect(executor(client).execute({
      databaseInstanceRef: "managed:database-1", changeSetId: "change-1", statement: STATEMENT, statementSha256: HASH,
    })).rejects.toMatchObject({ code: "INVALID_MIGRATION_LEDGER", outcome: "rolled_back" });
    expect(client.calls.at(-1)?.text).toBe("ROLLBACK");
  });

  it("rolls back for an unlogged ledger or membership in its owner role", async () => {
    for (const ledgerOverrides of [{ relpersistence: "u" }, { member_of_relation_owner: true }]) {
      const client = new RecordingClient(false, undefined, {}, ledgerOverrides);
      await expect(executor(client).execute({
        databaseInstanceRef: "managed:database-1", changeSetId: "change-1", statement: STATEMENT, statementSha256: HASH,
      })).rejects.toMatchObject({ code: "INVALID_MIGRATION_LEDGER", outcome: "rolled_back" });
      expect(client.calls.at(-1)?.text).toBe("ROLLBACK");
    }
  });

  it("fails closed before writing a fence when the protected fence ACL is unsafe", async () => {
    const client = new RecordingClient(false, undefined, {}, {}, { has_dangerous_table_privileges: true });
    await expect(executor(client).execute({
      databaseInstanceRef: "managed:database-1", changeSetId: "change-1", statement: STATEMENT, statementSha256: HASH,
    })).rejects.toMatchObject({ code: "INVALID_MIGRATION_FENCE", outcome: "rolled_back", fenceStatus: "unknown" });
    expect(client.calls.some((call) => call.text.startsWith("INSERT INTO qkern_internal.migration_fences"))).toBe(false);
    expect(client.calls.at(-1)?.text).toBe("ROLLBACK");
  });

  it("persists the fence in a transaction before opening the statement transaction", async () => {
    const client = new RecordingClient();
    await executor(client).execute({
      databaseInstanceRef: "managed:database-1", changeSetId: "change-1", statement: STATEMENT, statementSha256: HASH,
    });
    const texts = client.calls.map((call) => call.text);
    const fenceInsert = texts.findIndex((text) => text.startsWith("INSERT INTO qkern_internal.migration_fences"));
    const fenceCommit = texts.indexOf("COMMIT", fenceInsert);
    const statement = texts.indexOf(STATEMENT);
    expect(fenceInsert).toBeGreaterThan(-1);
    expect(fenceCommit).toBeGreaterThan(fenceInsert);
    expect(statement).toBeGreaterThan(fenceCommit);
    expect(texts.slice(fenceCommit + 1, statement)).toContain("BEGIN");
  });

  it("rejects a stale worker when the target already contains a higher durable fence", async () => {
    const client = new RecordingClient(false, undefined, {}, {}, {}, { fence_epoch: "2" });
    await expect(executor(client).execute({
      databaseInstanceRef: "managed:database-1", changeSetId: "change-1", statement: STATEMENT, statementSha256: HASH,
    })).rejects.toMatchObject({
      code: "MIGRATION_FENCE_SUPERSEDED", outcome: "rolled_back", fenceStatus: "superseded", retryable: false,
    });
    expect(client.calls.some((call) => call.text === STATEMENT)).toBe(false);
    expect(client.calls.at(-1)?.text).toBe("ROLLBACK");
  });

  it("rejects transaction-control SQL before resolving a project database", async () => {
    let resolutions = 0;
    const guarded = new PostgresProjectDatabaseExecutor({
      resolve: () => {
        resolutions += 1;
        return {
          pool: pool(new RecordingClient()), expectedRole: "qkern_project_migrator", expectedDatabase: "project_database",
          expectedLedgerOwner: "qkern_ledger_owner",
        };
      },
    });
    await expect(guarded.execute({
      databaseInstanceRef: "managed:database-1", changeSetId: "change-1", statement: "COMMIT", statementSha256: sha256("COMMIT"), ...FENCE,
    })).rejects.toMatchObject({ code: "INVALID_EXECUTION_INPUT", outcome: "not_started" });
    expect(resolutions).toBe(0);
  });
});
