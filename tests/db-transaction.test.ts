import { describe, expect, it } from "vitest";
import {
  InvalidTenantContextError,
  PersistenceError,
  TransactionConflictError,
} from "@/lib/server/db/errors";
import type { SqlPool, SqlPoolClient, SqlQueryResult, SqlValue } from "@/lib/server/db/sql";
import { withTenantTransaction } from "@/lib/server/db/transaction";

const ORGANIZATION_ID = "0d9423d9-7437-4f66-898a-86275e6598fb";

class RecordingClient implements SqlPoolClient {
  readonly calls: Array<{ text: string; values?: readonly SqlValue[] }> = [];
  released: Error | boolean | undefined;

  async query<Row extends Record<string, unknown>>(
    text: string,
    values?: readonly SqlValue[],
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    return { rows: [] as Row[], rowCount: 0 };
  }

  release(error?: Error | boolean): void {
    this.released = error ?? false;
  }
}

class RecordingPool implements SqlPool {
  connectCalls = 0;
  constructor(readonly client = new RecordingClient()) {}

  async connect(): Promise<SqlPoolClient> {
    this.connectCalls += 1;
    return this.client;
  }

  async query<Row extends Record<string, unknown>>(): Promise<SqlQueryResult<Row>> {
    return { rows: [] as Row[], rowCount: 0 };
  }

  async end(): Promise<void> {}
}

describe("tenant transaction", () => {
  it("sets transaction-local tenant, actor and timeout before repository work", async () => {
    const pool = new RecordingPool();
    const result = await withTenantTransaction(
      pool,
      { organizationId: ORGANIZATION_ID, actorRef: "codex", statementTimeoutMs: 2_500 },
      async (transaction) => {
        expect(transaction.organizationId).toBe(ORGANIZATION_ID);
        await transaction.query("SELECT id FROM projects WHERE organization_id = $1", [ORGANIZATION_ID]);
        return "done";
      },
    );

    expect(result).toBe("done");
    expect(pool.client.calls.map(({ text }) => text)).toEqual([
      "BEGIN",
      "SELECT set_config('qkern.organization_id', $1, true), set_config('qkern.actor_ref', $2, true), set_config('statement_timeout', $3, true)",
      "SELECT id FROM projects WHERE organization_id = $1",
      "COMMIT",
    ]);
    expect(pool.client.calls[1].values).toEqual([ORGANIZATION_ID, "codex", "2500"]);
    expect(pool.client.released).toBe(false);
  });

  it("rolls back, releases and classifies an operation error", async () => {
    const pool = new RecordingPool();
    const promise = withTenantTransaction(pool, { organizationId: ORGANIZATION_ID }, async () => {
      throw new Error("database internals");
    });

    await expect(promise).rejects.toBeInstanceOf(PersistenceError);
    expect(pool.client.calls.at(-1)?.text).toBe("ROLLBACK");
    expect(pool.client.released).toBe(false);
  });

  it("maps retryable PostgreSQL transaction conflicts", async () => {
    const pool = new RecordingPool();
    const conflict = Object.assign(new Error("serialization failure"), { code: "40001" });
    await expect(withTenantTransaction(pool, { organizationId: ORGANIZATION_ID }, async () => {
      throw conflict;
    })).rejects.toMatchObject({ code: "TRANSACTION_CONFLICT", retryable: true });
    await expect(Promise.reject(new TransactionConflictError())).rejects.toBeInstanceOf(TransactionConflictError);
  });

  it("rejects a non-UUID tenant before taking a connection", async () => {
    const pool = new RecordingPool();
    await expect(withTenantTransaction(pool, { organizationId: "org_demo" }, async () => undefined))
      .rejects.toBeInstanceOf(InvalidTenantContextError);
    expect(pool.connectCalls).toBe(0);
  });
});
