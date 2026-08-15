import {
  ConnectionUnavailableError,
  InvalidTenantContextError,
  RepositoryError,
  ResourceNotFoundError,
  mapPostgresError,
} from "@/lib/server/db/errors";
import type { SqlPool, SqlPoolClient, SqlQueryResult, SqlValue } from "@/lib/server/db/sql";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TenantContext = {
  organizationId: string;
  actorRef?: string;
  statementTimeoutMs?: number;
  readOnly?: boolean;
};

export interface TenantTransaction {
  readonly organizationId: string;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly SqlValue[],
  ): Promise<SqlQueryResult<Row>>;
}

class ScopedTenantTransaction implements TenantTransaction {
  constructor(readonly organizationId: string, private readonly client: SqlPoolClient) {}

  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly SqlValue[],
  ): Promise<SqlQueryResult<Row>> {
    return this.client.query<Row>(text, values);
  }
}

export function assertOrganizationId(organizationId: string): void {
  if (!UUID.test(organizationId)) throw new InvalidTenantContextError();
}

export function assertTenantResourceId(expectedOrganizationId: string, resourceOrganizationId: string): void {
  assertOrganizationId(resourceOrganizationId);
  if (resourceOrganizationId !== expectedOrganizationId) {
    // Do not reveal whether a cross-tenant resource exists.
    throw new ResourceNotFoundError();
  }
}

export async function withTenantTransaction<T>(
  pool: SqlPool,
  context: TenantContext,
  operation: (transaction: TenantTransaction) => Promise<T>,
): Promise<T> {
  assertOrganizationId(context.organizationId);
  if (context.statementTimeoutMs !== undefined &&
      (!Number.isInteger(context.statementTimeoutMs) || context.statementTimeoutMs < 100 || context.statementTimeoutMs > 120_000)) {
    throw new InvalidTenantContextError("statementTimeoutMs must be between 100 and 120000 milliseconds.");
  }

  let client: SqlPoolClient | undefined;
  let transactionStarted = false;
  try {
    // Das Holen der Verbindung wird eigens gefangen. Hier ist eindeutig, was
    // gescheitert ist — keine Abfrage, sondern der Pool —, und nur hier laesst
    // sich das ohne Textvergleich am Treiberfehler feststellen.
    try {
      client = await pool.connect();
    } catch (error) {
      throw new ConnectionUnavailableError(error);
    }
    await client.query(context.readOnly ? "BEGIN TRANSACTION READ ONLY" : "BEGIN");
    transactionStarted = true;
    await client.query(
      "SELECT set_config('qkern.organization_id', $1, true), set_config('qkern.actor_ref', $2, true), set_config('statement_timeout', $3, true)",
      [
        context.organizationId,
        context.actorRef?.slice(0, 200) ?? "system",
        String(context.statementTimeoutMs ?? 15_000),
      ],
    );
    const result = await operation(new ScopedTenantTransaction(context.organizationId, client));
    await client.query("COMMIT");
    transactionStarted = false;
    return result;
  } catch (error) {
    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve and classify the original failure. The broken client is discarded below.
        client.release(true);
        client = undefined;
      }
    }
    throw fromTransaction(error);
  } finally {
    client?.release();
  }
}

/**
 * Classifies a failure that escaped a tenant transaction.
 *
 * Errors raised by the operation itself must survive this boundary. Mapping
 * them unconditionally turned every domain contract into a generic
 * PERSISTENCE_ERROR, so `QUEUE_LEASE_LOST`, `STORAGE_CONFLICT` and
 * `STORAGE_QUOTA_EXCEEDED` never reached their callers. The masking stayed
 * invisible until the adapters ran against a real database, because the memory
 * adapters do not pass through a transaction at all.
 *
 * A dedicated error class is the signal: it carries a domain contract, so it is
 * rethrown untouched. A bare `Error`, a non-Error throw, a PostgreSQL failure
 * (always carrying `severity`) and a Node socket failure (`EXXX` code) carry no
 * such contract and are classified as infrastructure failures.
 */
function fromTransaction(error: unknown): unknown {
  if (error instanceof RepositoryError) return error;
  if (!(error instanceof Error) || error.constructor === Error) return mapPostgresError(error);
  const candidate = error as { severity?: unknown; code?: unknown };
  const fromDriver = typeof candidate.severity === "string"
    || (typeof candidate.code === "string" && /^E[A-Z0-9_]+$/.test(candidate.code));
  return fromDriver ? mapPostgresError(error) : error;
}
