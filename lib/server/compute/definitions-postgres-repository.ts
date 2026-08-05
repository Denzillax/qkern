import { ConflictError } from "@/lib/server/db/errors";
import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlQueryable } from "@/lib/server/db/sql";
import {
  ComputeDefinitionError,
  type ComputeDefinitionRepository,
  type ComputeDefinitionScope,
  type CronDefinitionRecord,
  type WebhookDefinitionRecord,
  type WebhookDeliveryRecord,
} from "@/lib/server/compute/definitions";
import type { ProjectQueueJson, ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import type { Environment } from "@/lib/types";

type DefinitionDatabase = Pick<PostgresControlPlane, "withTenant">;

type CronRow = {
  id: string; organization_id: string; project_id: string; environment: Environment;
  name: string; expression: string; queue: string; payload: ProjectQueueJson;
  enabled: boolean; last_dispatched_at: Date | null; created_at: Date;
};

type WebhookRow = {
  id: string; organization_id: string; project_id: string; environment: Environment;
  name: string; url: string; event_types: string[]; signing_secret_ref: string;
  timeout_ms: number; max_attempts: number; enabled: boolean; created_at: Date;
};

type DeliveryRow = {
  id: string; webhook_id: string; event_type: string; status: WebhookDeliveryRecord["status"];
  attempt_count: number; last_failure_code: string | null; occurred_at: Date;
  available_at: Date; delivered_at: Date | null; dead_lettered_at: Date | null;
};

const CRON_COLUMNS = `id, organization_id, project_id, environment, name, expression, queue,
  payload, enabled, last_dispatched_at, created_at`;
const WEBHOOK_COLUMNS = `id, organization_id, project_id, environment, name, url, event_types,
  signing_secret_ref, timeout_ms, max_attempts, enabled, created_at`;

/**
 * Dauerhafte Cron- und Webhook-Definitionen über die tenantgebundene
 * Runtime-Transaktion.
 *
 * Nur `enabled` wird geschrieben. Migrationen 0031 und 0032 gewähren auch nicht
 * mehr: Ausdruck, Queue, Nutzlast, Ziel-URL und Signaturreferenz sind über das
 * Spaltenrecht unveränderlich, nicht über eine Prüfung in dieser Klasse. Ein
 * zweiter Schreiber könnte eine solche Prüfung umgehen; das Spaltenrecht nicht.
 */
export class PostgresComputeDefinitionRepository implements ComputeDefinitionRepository {
  constructor(private readonly database: DefinitionDatabase) {}

  async listCron(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope) {
    return await this.read(principal, async (database) => {
      const result = await database.query<CronRow>(
        `SELECT ${CRON_COLUMNS} FROM project_cron_definitions
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3
          ORDER BY name`, scopeValues(scope),
      );
      return result.rows.map(toCron);
    });
  }

  async createCron(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, input: {
    name: string; expression: string; queue: string; payload: ProjectQueueJson; enabled: boolean;
  }) {
    return await asConflict(this.write(principal, async (database) => {
      const result = await database.query<CronRow>(
        `INSERT INTO project_cron_definitions
           (organization_id, project_id, environment, name, expression, queue, payload, enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING ${CRON_COLUMNS}`,
        [...scopeValues(scope), input.name, input.expression, input.queue,
          input.payload as never, input.enabled],
      );
      const row = result.rows[0];
      if (!row) throw new ComputeDefinitionError("COMPUTE_CONFLICT");
      return toCron(row);
    }));
  }

  async getCron(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string) {
    return await this.read(principal, async (database) => {
      const result = await database.query<CronRow>(
        `SELECT ${CRON_COLUMNS} FROM project_cron_definitions
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4`,
        [...scopeValues(scope), id],
      );
      return result.rows[0] ? toCron(result.rows[0]) : null;
    });
  }

  async setCronEnabled(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    id: string, enabled: boolean) {
    return await this.write(principal, async (database) => {
      const result = await database.query<CronRow>(
        `UPDATE project_cron_definitions SET enabled=$5, updated_at=now()
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4
          RETURNING ${CRON_COLUMNS}`,
        [...scopeValues(scope), id, enabled],
      );
      return result.rows[0] ? toCron(result.rows[0]) : null;
    });
  }

  async deleteCron(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string) {
    return await this.write(principal, async (database) => {
      const result = await database.query<{ id: string }>(
        `DELETE FROM project_cron_definitions
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4
          RETURNING id`, [...scopeValues(scope), id],
      );
      return result.rows.length === 1;
    });
  }

  async listWebhooks(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope) {
    return await this.read(principal, async (database) => {
      const result = await database.query<WebhookRow>(
        `SELECT ${WEBHOOK_COLUMNS} FROM project_webhooks
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3
          ORDER BY name`, scopeValues(scope),
      );
      return result.rows.map(toWebhook);
    });
  }

  async createWebhook(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, input: {
    name: string; url: string; eventTypes: readonly string[]; signingSecretRef: string;
    timeoutMs: number; maxAttempts: number; enabled: boolean;
  }) {
    return await asConflict(this.write(principal, async (database) => {
      const result = await database.query<WebhookRow>(
        `INSERT INTO project_webhooks
           (organization_id, project_id, environment, name, url, event_types,
            signing_secret_ref, timeout_ms, max_attempts, enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING ${WEBHOOK_COLUMNS}`,
        [...scopeValues(scope), input.name, input.url, [...input.eventTypes],
          input.signingSecretRef, input.timeoutMs, input.maxAttempts, input.enabled],
      );
      const row = result.rows[0];
      if (!row) throw new ComputeDefinitionError("COMPUTE_CONFLICT");
      return toWebhook(row);
    }));
  }

  async getWebhook(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string) {
    return await this.read(principal, async (database) => {
      const result = await database.query<WebhookRow>(
        `SELECT ${WEBHOOK_COLUMNS} FROM project_webhooks
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4`,
        [...scopeValues(scope), id],
      );
      return result.rows[0] ? toWebhook(result.rows[0]) : null;
    });
  }

  async setWebhookEnabled(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    id: string, enabled: boolean) {
    return await this.write(principal, async (database) => {
      const result = await database.query<WebhookRow>(
        `UPDATE project_webhooks SET enabled=$5
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4
          RETURNING ${WEBHOOK_COLUMNS}`,
        [...scopeValues(scope), id, enabled],
      );
      return result.rows[0] ? toWebhook(result.rows[0]) : null;
    });
  }

  async deleteWebhook(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string) {
    return await this.write(principal, async (database) => {
      const result = await database.query<{ id: string }>(
        `DELETE FROM project_webhooks
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4
          RETURNING id`, [...scopeValues(scope), id],
      );
      return result.rows.length === 1;
    });
  }

  /** Bewusst ohne `payload`: Sie gehört dem Projekt, nicht der Übersicht. */
  async listDeliveries(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    webhookId: string, limit: number) {
    return await this.read(principal, async (database) => {
      const result = await database.query<DeliveryRow>(
        `SELECT id, webhook_id, event_type, status, attempt_count, last_failure_code,
                occurred_at, available_at, delivered_at, dead_lettered_at
           FROM project_webhook_deliveries
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND webhook_id=$4
          ORDER BY created_at DESC, id
          LIMIT $5`, [...scopeValues(scope), webhookId, limit],
      );
      return result.rows.map(toDelivery);
    });
  }

  private read<T>(principal: ProjectQueuePrincipal, work: (database: SqlQueryable) => Promise<T>) {
    return this.withTenant(principal, true, work);
  }

  private write<T>(principal: ProjectQueuePrincipal, work: (database: SqlQueryable) => Promise<T>) {
    return this.withTenant(principal, false, work);
  }

  private withTenant<T>(
    principal: ProjectQueuePrincipal,
    readOnly: boolean,
    work: (database: SqlQueryable) => Promise<T>,
  ): Promise<T> {
    return this.database.withTenant({
      organizationId: principal.organizationId, actorRef: principal.actorRef, readOnly,
    }, async (repositories) => work(repositories.transaction));
  }
}

/**
 * Ein zweiter Name derselben Art ist ein Konflikt, kein Serverfehler.
 *
 * Die Eindeutigkeit liegt als Constraint in der Datenbank und nicht als
 * Vorabprüfung im Dienst — zwei gleichzeitige Anfragen könnten eine solche
 * Prüfung sonst beide bestehen.
 */
async function asConflict<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof ConflictError) {
      throw new ComputeDefinitionError("COMPUTE_CONFLICT", { cause: error });
    }
    throw error;
  }
}

function scopeValues(scope: ComputeDefinitionScope) {
  return [scope.organizationId, scope.projectId, scope.environment];
}

function toCron(row: CronRow): CronDefinitionRecord {
  return Object.freeze({
    organizationId: row.organization_id,
    projectId: row.project_id,
    environment: row.environment,
    id: row.id,
    name: row.name,
    expression: row.expression,
    queue: row.queue,
    payload: row.payload,
    enabled: row.enabled,
    lastDispatchedAt: row.last_dispatched_at === null
      ? null : new Date(row.last_dispatched_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  });
}

function toWebhook(row: WebhookRow): WebhookDefinitionRecord {
  return Object.freeze({
    organizationId: row.organization_id,
    projectId: row.project_id,
    environment: row.environment,
    id: row.id,
    name: row.name,
    url: row.url,
    eventTypes: Object.freeze([...row.event_types]),
    signingSecretRef: row.signing_secret_ref,
    timeoutMs: row.timeout_ms,
    maxAttempts: row.max_attempts,
    enabled: row.enabled,
    createdAt: new Date(row.created_at).toISOString(),
  });
}

function toDelivery(row: DeliveryRow): WebhookDeliveryRecord {
  const settled = row.delivered_at ?? row.dead_lettered_at;
  return Object.freeze({
    id: row.id,
    webhookId: row.webhook_id,
    eventType: row.event_type,
    status: row.status,
    attemptCount: row.attempt_count,
    lastFailureCode: row.last_failure_code,
    occurredAt: new Date(row.occurred_at).toISOString(),
    availableAt: new Date(row.available_at).toISOString(),
    settledAt: settled === null ? null : new Date(settled).toISOString(),
  });
}
