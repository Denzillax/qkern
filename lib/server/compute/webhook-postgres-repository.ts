import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlQueryable } from "@/lib/server/db/sql";
import {
  WebhookOutboxError,
  type WebhookClaim,
  type WebhookOutboxEntry,
  type WebhookOutboxRepository,
  type WebhookOutboxScope,
} from "@/lib/server/compute/webhook-outbox";
import type { ProjectQueueJson } from "@/lib/server/project-queues/model";

type WebhookDatabase = Pick<PostgresControlPlane, "withTenant">;

type DeliveryRow = {
  id: string;
  webhook_id: string;
  event_type: string;
  payload: ProjectQueueJson;
  occurred_at: Date;
  attempt_count: number;
};

const COLUMNS = "id, webhook_id, event_type, payload, occurred_at, attempt_count";

/**
 * Dauerhafte Webhook-Outbox.
 *
 * Der Claim folgt demselben Weg wie bei Project Queues: `FOR UPDATE SKIP
 * LOCKED` über die fälligen Zeilen, gefolgt von einem gezielten `UPDATE`, der
 * Worker, Lease-Verifier und Ablauf atomar setzt. Migration 0032 gewährt dafür
 * bereits das UPDATE-Recht und die UPDATE-Policy, die eine Sperrklausel
 * verlangt — die Lehre aus Release 1.9, hier vorbeugend angewandt.
 */
export class PostgresWebhookOutboxRepository implements WebhookOutboxRepository {
  constructor(
    private readonly database: WebhookDatabase,
    private readonly actorRef = "service-role:webhooks",
  ) {}

  async enqueue(scope: WebhookOutboxScope, input: {
    id: string; webhookId: string; eventType: string; payload: ProjectQueueJson;
    occurredAt: Date; createdAt: Date;
  }): Promise<WebhookOutboxEntry> {
    return await this.withTenant(scope, false, async (database) => {
      const inserted = await database.query<DeliveryRow>(
        `INSERT INTO project_webhook_deliveries
           (id, organization_id, project_id, environment, webhook_id, event_type, payload,
            occurred_at, status, attempt_count, available_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',0,$9,$9)
         RETURNING ${COLUMNS}`,
        [input.id, scope.organizationId, scope.projectId, scope.environment, input.webhookId,
          input.eventType, input.payload as never, input.occurredAt, input.createdAt],
      );
      const row = inserted.rows[0];
      if (!row) throw new WebhookOutboxError("WEBHOOK_OUTBOX_CONFLICT");
      return toEntry(scope, row);
    });
  }

  async claim(scope: WebhookOutboxScope, input: {
    workerId: string; limit: number; now: Date; visibilityMs: number;
    leases: ReadonlyArray<{ token: string; tokenHash: string }>;
  }): Promise<WebhookClaim[]> {
    return await this.withTenant(scope, false, async (database) => {
      const due = await database.query<{ id: string }>(
        `SELECT id FROM project_webhook_deliveries
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3
            AND status='pending' AND available_at <= $4
          ORDER BY available_at, created_at, id
          LIMIT $5
          FOR UPDATE SKIP LOCKED`,
        [scope.organizationId, scope.projectId, scope.environment, input.now, input.limit],
      );

      const claims: WebhookClaim[] = [];
      const expiresAt = new Date(input.now.getTime() + input.visibilityMs);
      for (const [index, candidate] of due.rows.entries()) {
        const lease = input.leases[index];
        if (!lease) break;
        const updated = await database.query<DeliveryRow>(
          `UPDATE project_webhook_deliveries
              SET status='in_flight', attempt_count=attempt_count+1,
                  lease_worker_id=$5, lease_token_hash=$6, lease_expires_at=$7
            WHERE organization_id=$1 AND id=$2 AND status='pending' AND available_at <= $3
              AND project_id=$4
            RETURNING ${COLUMNS}`,
          [scope.organizationId, candidate.id, input.now, scope.projectId,
            input.workerId, lease.tokenHash, expiresAt],
        );
        const row = updated.rows[0];
        if (row) claims.push({ ...toEntry(scope, row), leaseToken: lease.token });
      }
      return claims;
    });
  }

  async settle(scope: WebhookOutboxScope, input: {
    deliveryId: string; workerId: string; tokenHash: string; now: Date;
    outcome: { status: "delivered" } | {
      status: "retry"; availableAt: Date; failureCode: string;
    } | { status: "dead_lettered"; failureCode: string };
  }): Promise<{ status: "delivered" | "retry" | "dead_lettered" }> {
    return await this.withTenant(scope, false, async (database) => {
      // Die Bedingung trifft Worker, Verifier und aktive Lease exakt. Ein
      // zurueckgekehrter Zusteller mit abgelaufener Lease findet keine Zeile.
      const guard = `organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4
        AND status='in_flight' AND lease_worker_id=$5 AND lease_token_hash=$6
        AND lease_expires_at > $7`;
      const base = [scope.organizationId, scope.projectId, scope.environment, input.deliveryId,
        input.workerId, input.tokenHash, input.now];

      const result = input.outcome.status === "delivered"
        ? await database.query(
          `UPDATE project_webhook_deliveries
              SET status='delivered', delivered_at=$7,
                  lease_worker_id=NULL, lease_token_hash=NULL, lease_expires_at=NULL
            WHERE ${guard} RETURNING id`, base)
        : input.outcome.status === "retry"
          ? await database.query(
            `UPDATE project_webhook_deliveries
                SET status='pending', available_at=$8, last_failure_code=$9,
                    lease_worker_id=NULL, lease_token_hash=NULL, lease_expires_at=NULL
              WHERE ${guard} RETURNING id`,
            [...base, input.outcome.availableAt, input.outcome.failureCode])
          : await database.query(
            `UPDATE project_webhook_deliveries
                SET status='dead_lettered', dead_lettered_at=$7, last_failure_code=$8,
                    lease_worker_id=NULL, lease_token_hash=NULL, lease_expires_at=NULL
              WHERE ${guard} RETURNING id`,
            [...base, input.outcome.failureCode]);

      if (result.rows.length === 0) throw new WebhookOutboxError("WEBHOOK_OUTBOX_LEASE_LOST");
      return { status: input.outcome.status };
    });
  }

  async maxAttempts(scope: WebhookOutboxScope, webhookId: string): Promise<number | null> {
    return await this.withTenant(scope, true, async (database) => {
      const result = await database.query<{ max_attempts: number }>(
        `SELECT max_attempts FROM project_webhooks
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4 AND enabled`,
        [scope.organizationId, scope.projectId, scope.environment, webhookId],
      );
      return result.rows[0]?.max_attempts ?? null;
    });
  }

  private withTenant<T>(
    scope: WebhookOutboxScope,
    readOnly: boolean,
    work: (database: SqlQueryable) => Promise<T>,
  ): Promise<T> {
    return this.database.withTenant({
      organizationId: scope.organizationId, actorRef: this.actorRef, readOnly,
    }, async (repositories) => work(repositories.transaction));
  }
}

function toEntry(scope: WebhookOutboxScope, row: DeliveryRow): WebhookOutboxEntry {
  return {
    ...scope,
    id: row.id,
    webhookId: row.webhook_id,
    eventType: row.event_type,
    payload: row.payload,
    occurredAt: new Date(row.occurred_at),
    attemptCount: row.attempt_count,
  };
}
