import { ConflictError } from "@/lib/server/db/errors";
import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlQueryable } from "@/lib/server/db/sql";
import {
  DATABASE_WEBHOOK_SCHEMA,
  type DatabaseWebhookDraft,
  type DatabaseWebhookEvent,
  type DatabaseWebhookRecord,
} from "@/lib/console/database-webhooks";
import {
  ComputeDefinitionError,
  type ComputeDefinitionScope,
} from "@/lib/server/compute/definitions";
import type { DatabaseWebhookRepository } from
  "@/lib/server/compute/database-webhook-definitions";
import type {
  DatabaseWebhookBinding,
  DatabaseWebhookBindingSource,
} from "@/lib/server/compute/database-webhook-bridge";
import type { WebhookOutboxScope } from "@/lib/server/compute/webhook-outbox";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import type { Environment } from "@/lib/types";

type DatabaseWebhookDatabase = Pick<PostgresControlPlane, "withTenant">;

type Row = {
  id: string;
  organization_id: string;
  project_id: string;
  environment: Environment;
  webhook_id: string;
  schema_name: string;
  table_name: string;
  events: string[];
  name: string;
  url: string;
  event_types: string[];
  signing_secret_ref: string;
  enabled: boolean;
  created_at: Date;
};

/**
 * Die Liste ist ein Join ueber beide Tabellen. Der Verbund selbst ist die
 * Aussage dieses Slices: eine ausgehende Definition plus die Tabelle und die
 * Operationen, die sie ausloesen.
 *
 * `signing_secret_ref` steht in dieser Liste, ein Geheimniswert nicht —
 * `project_webhooks` hat keine Spalte dafuer, und es gibt sie auch sonst
 * nirgends in der Control Plane.
 */
const SELECT = `SELECT b.id, b.organization_id, b.project_id, b.environment, b.webhook_id,
    b.schema_name, b.table_name, b.events, w.name, w.url, w.event_types,
    w.signing_secret_ref, w.enabled, b.created_at
  FROM project_database_webhooks b
  JOIN project_webhooks w
    ON w.organization_id = b.organization_id AND w.project_id = b.project_id
   AND w.environment = b.environment AND w.id = b.webhook_id`;

const SCOPE = "b.organization_id = $1 AND b.project_id = $2 AND b.environment = $3";

export class PostgresDatabaseWebhookRepository
implements DatabaseWebhookRepository, DatabaseWebhookBindingSource {
  constructor(
    private readonly database: DatabaseWebhookDatabase,
    /** Der Leser der Bruecke ist kein Mensch; er bekommt seinen eigenen Namen. */
    private readonly bridgeActorRef = "service-role:database-webhooks",
  ) {}

  async list(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope) {
    return await this.withTenant(principal.organizationId, principal.actorRef, true,
      async (database) => {
        const result = await database.query<Row>(
          `${SELECT} WHERE ${SCOPE} ORDER BY w.name`, scopeValues(scope));
        return result.rows.map(toRecord);
      });
  }

  async get(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string) {
    return await this.withTenant(principal.organizationId, principal.actorRef, true,
      async (database) => {
        const result = await database.query<Row>(
          `${SELECT} WHERE ${SCOPE} AND b.id = $4`, [...scopeValues(scope), id]);
        const row = result.rows[0];
        return row ? toRecord(row) : null;
      });
  }

  /**
   * Definition und Kopplung in **einer** Transaktion.
   *
   * Getrennt geschrieben koennte der zweite Schritt scheitern und einen
   * Webhook hinterlassen, den niemand ausloest und den diese Flaeche nicht mehr
   * findet — sichtbar nur unter Functions & Jobs, ohne Erklaerung, wie er
   * dorthin kam.
   *
   * `timeout_ms` und `max_attempts` bleiben auf ihren Vorgaben aus 0032. Diese
   * Flaeche bietet sie nicht an: Ein Datenbank-Webhook hat keinen Grund, ein
   * anderes Zeitbudget zu brauchen als ein anderer, und jede Einstellung, die
   * niemand begruendet, ist eine, die spaeter jemand falsch setzt.
   */
  async create(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    draft: DatabaseWebhookDraft): Promise<DatabaseWebhookRecord> {
    return await asConflict(this.withTenant(principal.organizationId, principal.actorRef, false,
      async (database) => {
        const webhook = await database.query<{ id: string }>(
          `INSERT INTO project_webhooks
             (organization_id, project_id, environment, name, url, event_types,
              signing_secret_ref, enabled)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id`,
          [...scopeValues(scope), draft.name, draft.url, [...draft.eventTypes],
            draft.signingSecretRef, draft.enabled],
        );
        const webhookId = webhook.rows[0]?.id;
        if (!webhookId) throw new ComputeDefinitionError("COMPUTE_CONFLICT");

        await database.query(
          `INSERT INTO project_database_webhooks
             (organization_id, project_id, environment, webhook_id, schema_name, table_name, events)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [...scopeValues(scope), webhookId, draft.schema, draft.table, [...draft.events]],
        );

        const created = await database.query<Row>(
          `${SELECT} WHERE ${SCOPE} AND b.webhook_id = $4`, [...scopeValues(scope), webhookId]);
        const row = created.rows[0];
        if (!row) throw new ComputeDefinitionError("COMPUTE_CONFLICT");
        return toRecord(row);
      }));
  }

  /**
   * Der Schalter sitzt auf der Definition aus 0032. 0048 gewaehrt der
   * Laufzeitrolle bewusst kein UPDATE: Tabelle und Ereignisse bleiben, wie sie
   * angelegt wurden.
   */
  async setEnabled(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string,
    enabled: boolean): Promise<DatabaseWebhookRecord | null> {
    return await this.withTenant(principal.organizationId, principal.actorRef, false,
      async (database) => {
        const updated = await database.query<{ webhook_id: string }>(
          `UPDATE project_webhooks w
              SET enabled = $5
             FROM project_database_webhooks b
            WHERE b.organization_id = $1 AND b.project_id = $2 AND b.environment = $3
              AND b.id = $4 AND w.organization_id = b.organization_id
              AND w.project_id = b.project_id AND w.environment = b.environment
              AND w.id = b.webhook_id
            RETURNING b.webhook_id`,
          [...scopeValues(scope), id, enabled],
        );
        if (updated.rows.length === 0) return null;
        const result = await database.query<Row>(
          `${SELECT} WHERE ${SCOPE} AND b.id = $4`, [...scopeValues(scope), id]);
        const row = result.rows[0];
        return row ? toRecord(row) : null;
      });
  }

  /**
   * Die aktiven Kopplungen fuer die Bruecke.
   *
   * Nur Zeilen, deren Webhook eingeschaltet ist. Ein abgeschalteter Webhook
   * soll nicht einmal eine wartende Zustellung erzeugen — sonst staute sich
   * waehrend der Pause genau das an, was die Pause verhindern sollte, und beim
   * Einschalten liefe es auf einmal los.
   */
  async activeBindings(scope: WebhookOutboxScope): Promise<DatabaseWebhookBinding[]> {
    return await this.withTenant(scope.organizationId, this.bridgeActorRef, true,
      async (database) => {
        const result = await database.query<{
          webhook_id: string; schema_name: string; table_name: string; events: string[];
        }>(
          `SELECT b.webhook_id, b.schema_name, b.table_name, b.events
             FROM project_database_webhooks b
             JOIN project_webhooks w
               ON w.organization_id = b.organization_id AND w.project_id = b.project_id
              AND w.environment = b.environment AND w.id = b.webhook_id
            WHERE ${SCOPE} AND w.enabled
            ORDER BY b.webhook_id`,
          scopeValues(scope),
        );
        return result.rows.map((row) => Object.freeze({
          webhookId: row.webhook_id,
          schema: row.schema_name,
          table: row.table_name,
          events: Object.freeze(row.events.filter(isEvent)),
        }));
      });
  }

  private withTenant<T>(
    organizationId: string,
    actorRef: string,
    readOnly: boolean,
    work: (database: SqlQueryable) => Promise<T>,
  ): Promise<T> {
    return this.database.withTenant({ organizationId, actorRef, readOnly },
      async (repositories) => work(repositories.transaction));
  }
}

function scopeValues(scope: { organizationId: string; projectId: string; environment: string }) {
  return [scope.organizationId, scope.projectId, scope.environment];
}

function isEvent(value: string): value is DatabaseWebhookEvent {
  return value === "insert" || value === "update" || value === "delete";
}

function toRecord(row: Row): DatabaseWebhookRecord {
  return Object.freeze({
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    environment: row.environment,
    webhookId: row.webhook_id,
    name: row.name,
    schema: row.schema_name || DATABASE_WEBHOOK_SCHEMA,
    table: row.table_name,
    events: Object.freeze(row.events.filter(isEvent)),
    eventTypes: Object.freeze([...row.event_types]),
    url: row.url,
    signingSecretRef: row.signing_secret_ref,
    enabled: row.enabled,
    createdAt: new Date(row.created_at).toISOString(),
  });
}

/** Ein zweiter Name ist ein Konflikt, kein Serverfehler — wie in 1.20. */
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
