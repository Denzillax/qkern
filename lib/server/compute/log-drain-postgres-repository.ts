import { ConflictError } from "@/lib/server/db/errors";
import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlQueryable, SqlValue } from "@/lib/server/db/sql";
import {
  LOG_DRAIN_SOURCES,
  type LogDrainDraft,
  type LogDrainRecord,
  type LogDrainSourceId,
} from "@/lib/console/log-drains";
import {
  ComputeDefinitionError,
  type ComputeDefinitionScope,
} from "@/lib/server/compute/definitions";
import type {
  LogDrainBinding,
  LogDrainBindingSource,
  LogDrainRepository,
  LogDrainSourceReader,
  LogDrainSourceRow,
} from "@/lib/server/compute/log-drains";
import type { WebhookOutboxScope } from "@/lib/server/compute/webhook-outbox";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import type { Environment } from "@/lib/types";

type LogDrainDatabase = Pick<PostgresControlPlane, "withTenant">;

type Row = {
  id: string;
  organization_id: string;
  project_id: string;
  environment: Environment;
  webhook_id: string;
  sources: string[];
  name: string;
  url: string;
  event_types: string[];
  signing_secret_ref: string;
  enabled: boolean;
  created_at: Date;
};

/**
 * Die Liste ist ein Join ueber beide Tabellen. Der Verbund selbst ist die
 * Aussage dieses Slices: eine vorhandene ausgehende Definition plus die
 * Quellen, die sie beliefern.
 *
 * `signing_secret_ref` steht in dieser Liste, ein Geheimniswert nicht --
 * `project_webhooks` hat keine Spalte dafuer, und es gibt sie auch sonst
 * nirgends in der Control Plane.
 */
const SELECT = `SELECT d.id, d.organization_id, d.project_id, d.environment, d.webhook_id,
    d.sources, w.name, w.url, w.event_types, w.signing_secret_ref, w.enabled, d.created_at
  FROM project_log_drains d
  JOIN project_webhooks w
    ON w.organization_id = d.organization_id AND w.project_id = d.project_id
   AND w.environment = d.environment AND w.id = d.webhook_id`;

const SCOPE = "d.organization_id = $1 AND d.project_id = $2 AND d.environment = $3";

export class PostgresLogDrainRepository implements LogDrainRepository, LogDrainBindingSource {
  constructor(
    private readonly database: LogDrainDatabase,
    /** Der Sammler ist kein Mensch; er bekommt seinen eigenen Namen. */
    private readonly collectorActorRef = "service-role:log-drains",
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
          `${SELECT} WHERE ${SCOPE} AND d.id = $4`, [...scopeValues(scope), id]);
        const row = result.rows[0];
        return row ? toRecord(row) : null;
      });
  }

  /**
   * Definition und Kopplung in **einer** Transaktion.
   *
   * Getrennt geschrieben koennte der zweite Schritt scheitern und einen Webhook
   * hinterlassen, den niemand beliefert und den diese Flaeche nicht mehr findet
   * -- sichtbar nur unter Functions & Jobs, ohne Erklaerung, wie er dorthin kam.
   *
   * `timeout_ms` und `max_attempts` bleiben auf ihren Vorgaben aus 0032, wie bei
   * den Datenbank-Webhooks: Ein Log-Ziel hat keinen Grund, ein anderes
   * Zeitbudget zu brauchen als ein anderes Ziel.
   */
  async create(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    draft: LogDrainDraft): Promise<LogDrainRecord> {
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
          `INSERT INTO project_log_drains
             (organization_id, project_id, environment, webhook_id, sources)
           VALUES ($1,$2,$3,$4,$5)`,
          [...scopeValues(scope), webhookId, [...draft.sources]],
        );

        const created = await database.query<Row>(
          `${SELECT} WHERE ${SCOPE} AND d.webhook_id = $4`, [...scopeValues(scope), webhookId]);
        const row = created.rows[0];
        if (!row) throw new ComputeDefinitionError("COMPUTE_CONFLICT");
        return toRecord(row);
      }));
  }

  /**
   * Der Schalter sitzt auf der Definition aus 0032. 0054 gewaehrt der
   * Laufzeitrolle bewusst kein UPDATE: Die Quellen bleiben, wie sie angelegt
   * wurden.
   */
  async setEnabled(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string,
    enabled: boolean): Promise<LogDrainRecord | null> {
    return await this.withTenant(principal.organizationId, principal.actorRef, false,
      async (database) => {
        const updated = await database.query<{ webhook_id: string }>(
          `UPDATE project_webhooks w
              SET enabled = $5
             FROM project_log_drains d
            WHERE d.organization_id = $1 AND d.project_id = $2 AND d.environment = $3
              AND d.id = $4 AND w.organization_id = d.organization_id
              AND w.project_id = d.project_id AND w.environment = d.environment
              AND w.id = d.webhook_id
            RETURNING d.webhook_id`,
          [...scopeValues(scope), id, enabled],
        );
        if (updated.rows.length === 0) return null;
        const result = await database.query<Row>(
          `${SELECT} WHERE ${SCOPE} AND d.id = $4`, [...scopeValues(scope), id]);
        const row = result.rows[0];
        return row ? toRecord(row) : null;
      });
  }

  /**
   * Die aktiven Drains fuer den Sammler.
   *
   * Nur Zeilen, deren Webhook eingeschaltet ist. Ein abgeschalteter Drain soll
   * nicht einmal eine wartende Ladung erzeugen -- sonst staute sich waehrend
   * der Pause genau das an, was die Pause verhindern sollte, und beim
   * Einschalten liefe es auf einmal los.
   */
  async activeDrains(scope: WebhookOutboxScope): Promise<LogDrainBinding[]> {
    return await this.withTenant(scope.organizationId, this.collectorActorRef, true,
      async (database) => {
        const result = await database.query<{
          webhook_id: string; sources: string[]; schema_version: number;
        }>(
          `SELECT d.webhook_id, d.sources, d.schema_version
             FROM project_log_drains d
             JOIN project_webhooks w
               ON w.organization_id = d.organization_id AND w.project_id = d.project_id
              AND w.environment = d.environment AND w.id = d.webhook_id
            WHERE ${SCOPE} AND w.enabled
            ORDER BY d.webhook_id`,
          scopeValues(scope),
        );
        return result.rows.map((row) => Object.freeze({
          webhookId: row.webhook_id,
          sources: Object.freeze(row.sources.filter(isSource)),
          schemaVersion: row.schema_version,
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

/**
 * Liest die Quellen eines Drains -- jede in genau der Projektion, die die
 * zugehoerige Console-Ansicht zeigt.
 *
 * Jede Abfrage nennt ihre Spalten einzeln. Das ist die zweite Verteidigungslinie
 * hinter der Whitelist in `lib/console/log-drains`: Die Whitelist entscheidet,
 * was hinausgeht, aber eine Spalte, die gar nicht gelesen wird, kann auch nicht
 * versehentlich in einem Fehlerpfad landen. `SELECT *` gibt es hier nirgends.
 *
 * Gelesen wird aufsteigend nach Zeit, waehrend die Console absteigend liest:
 * Ein Ziel bekommt seine Ereignisse in der Reihenfolge, in der sie passiert
 * sind. Die Felder sind dieselben; die Reihenfolge ist keine Auskunft mehr oder
 * weniger.
 */
export class PostgresLogDrainSourceReader implements LogDrainSourceReader {
  constructor(
    private readonly database: LogDrainDatabase,
    private readonly actorRef = "service-role:log-drains",
  ) {}

  async tip(scope: WebhookOutboxScope, source: LogDrainSourceId): Promise<string | null> {
    const rows = await this.query(scope, source, { after: null, limit: 1, newestFirst: true });
    return rows[0]?.cursor ?? null;
  }

  async read(scope: WebhookOutboxScope, source: LogDrainSourceId, input: {
    after: string | null; limit: number;
  }): Promise<readonly LogDrainSourceRow[]> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000) {
      throw new ComputeDefinitionError("COMPUTE_INVALID_INPUT");
    }
    return await this.query(scope, source, { ...input, newestFirst: false });
  }

  private async query(scope: WebhookOutboxScope, source: LogDrainSourceId, input: {
    after: string | null; limit: number; newestFirst: boolean;
  }): Promise<LogDrainSourceRow[]> {
    const cursor = input.newestFirst ? null : parseCursor(input.after);
    const direction = input.newestFirst ? "DESC" : "ASC";
    /**
     * Der Vergleich steht als Zeilenvergleich in SQL: `(zeit, id) > (zeit, id)`
     * ordnet auch zwei Zeilen derselben Mikrosekunde eindeutig. Ohne den zweiten
     * Teil koennte ein Lauf eine von ihnen ueberspringen.
     *
     * Die Casts stehen ausdruecklich da: In einem Zeilenvergleich leitet
     * PostgreSQL den Typ eines Parameters nicht aus der Nachbarspalte ab.
     */
    const after = (time: string, id: string, idType: "uuid" | "text") =>
      cursor ? ` AND (${time}, ${id}) > ($4::timestamptz, $5::${idType})` : "";
    return await this.database.withTenant({
      organizationId: scope.organizationId, actorRef: this.actorRef, readOnly: true,
    }, async (repositories) => {
      const database = repositories.transaction;
      const values: SqlValue[] = [...scopeValues(scope)];
      if (cursor) values.push(cursor.at, cursor.id);
      values.push(input.limit);
      const limit = `$${values.length}`;

      switch (source) {
        case "auth_audit": {
          const result = await database.query<{
            id: string; created_at: Date; action: string; actor_type: string;
            resource_ref: string; status: string;
          }>(
            `SELECT id, created_at, action, actor_type, resource_ref, status
               FROM audit_logs
              WHERE organization_id = $1 AND project_id = $2::uuid
                AND environment = $3::qkern_environment
                AND starts_with(action, 'project_auth.')
                ${after("created_at", "id", "uuid")}
              ORDER BY created_at ${direction}, id ${direction}
              LIMIT ${limit}`, values);
          return result.rows.map((row) => frozenRow({
            cursor: formatCursor(row.created_at, row.id),
            record: {
              id: row.id,
              createdAt: iso(row.created_at),
              action: row.action,
              actorType: row.actor_type,
              resourceRef: row.resource_ref,
              status: row.status,
            },
          }));
        }
        case "function_invocations": {
          const result = await database.query<{
            id: string; function_id: string; function_name: string; invocation_id: string;
            started_at: Date; duration_ms: number; outcome: string;
            status_code: number | null; error_code: string | null;
          }>(
            `SELECT i.id, i.function_id, f.name AS function_name, i.invocation_id, i.started_at,
                    i.duration_ms, i.outcome, i.status_code, i.error_code
               FROM project_function_invocations i
               JOIN project_functions f
                 ON f.organization_id = i.organization_id AND f.project_id = i.project_id
                AND f.environment = i.environment AND f.id = i.function_id
              WHERE i.organization_id = $1 AND i.project_id = $2::uuid
                AND i.environment = $3::qkern_environment
                ${after("i.started_at", "i.id", "uuid")}
              ORDER BY i.started_at ${direction}, i.id ${direction}
              LIMIT ${limit}`, values);
          return result.rows.map((row) => frozenRow({
            cursor: formatCursor(row.started_at, row.id),
            record: {
              functionId: row.function_id,
              functionName: row.function_name,
              invocationId: row.invocation_id,
              startedAt: iso(row.started_at),
              durationMs: row.duration_ms,
              outcome: row.outcome,
              statusCode: row.status_code,
              errorCode: row.error_code,
            },
          }));
        }
        case "storage_objects": {
          const result = await database.query<{
            id: string; bucket_name: string; object_key: string; size_bytes: string;
            content_type: string; status: string; created_at: Date;
            delete_after: Date | null; deleted_at: Date | null;
          }>(
            `SELECT o.id, b.name AS bucket_name, o.object_key, o.size_bytes::text AS size_bytes,
                    o.content_type, o.status, o.created_at, o.delete_after, o.deleted_at
               FROM project_storage_objects o
               JOIN project_storage_buckets b
                 ON b.organization_id = o.organization_id AND b.project_id = o.project_id
                AND b.environment = o.environment AND b.id = o.bucket_id
              WHERE o.organization_id = $1 AND o.project_id = $2::uuid
                AND o.environment = $3::qkern_environment
                ${after("o.created_at", "o.id", "uuid")}
              ORDER BY o.created_at ${direction}, o.id ${direction}
              LIMIT ${limit}`, values);
          return result.rows.map((row) => frozenRow({
            cursor: formatCursor(row.created_at, row.id),
            record: {
              id: row.id,
              bucketName: row.bucket_name,
              key: row.object_key,
              sizeBytes: Number(row.size_bytes),
              contentType: row.content_type,
              status: row.status,
              createdAt: iso(row.created_at),
              deleteAfter: row.delete_after ? iso(row.delete_after) : null,
              deletedAt: row.deleted_at ? iso(row.deleted_at) : null,
            },
          }));
        }
        case "webhook_deliveries": {
          // Nur **abgeschlossene** Zustellungen, und sie tragen den Zeitpunkt
          // des Abschlusses als Position. Eine wartende Zustellung wechselt
          // ihren Zustand noch; sie zu senden hiesse, denselben Vorgang zweimal
          // mit verschiedenem Ausgang zu melden.
          //
          // Und: die Zustellungen der Drains selbst bleiben draussen. Ohne diese
          // Bedingung erzeugte jede weitergeleitete Ladung eine neue
          // Zustellzeile, die beim naechsten Lauf wieder weitergeleitet wuerde
          // -- eine Rueckkopplung, die von aussen wie ein Angriff auf das
          // eigene Ziel aussieht.
          const result = await database.query<{
            id: string; event_type: string; status: string; attempt_count: number;
            last_failure_code: string | null; occurred_at: Date; settled_at: Date;
          }>(
            `SELECT v.id, v.event_type, v.status, v.attempt_count, v.last_failure_code,
                    v.occurred_at, COALESCE(v.delivered_at, v.dead_lettered_at) AS settled_at
               FROM project_webhook_deliveries v
              WHERE v.organization_id = $1 AND v.project_id = $2::uuid
                AND v.environment = $3::qkern_environment
                AND v.status IN ('delivered', 'dead_lettered')
                AND NOT EXISTS (
                  SELECT 1 FROM project_log_drains d
                   WHERE d.organization_id = v.organization_id AND d.project_id = v.project_id
                     AND d.environment = v.environment AND d.webhook_id = v.webhook_id)
                ${after("COALESCE(v.delivered_at, v.dead_lettered_at)", "v.id", "uuid")}
              ORDER BY COALESCE(v.delivered_at, v.dead_lettered_at) ${direction}, v.id ${direction}
              LIMIT ${limit}`, values);
          return result.rows.map((row) => frozenRow({
            cursor: formatCursor(row.settled_at, row.id),
            record: {
              id: row.id,
              eventType: row.event_type,
              status: row.status,
              attemptCount: row.attempt_count,
              lastFailureCode: row.last_failure_code,
              occurredAt: iso(row.occurred_at),
              settledAt: iso(row.settled_at),
            },
          }));
        }
        case "usage_series": {
          // Dieselbe Rechnung wie die Zeitreihe der Console (2.45): `date_trunc`
          // in UTC, `GROUP BY`, `ORDER BY` -- in der Datenbank, nicht in Node.
          // Ein einzelnes Nutzungsereignis geht nie hinaus; die Console zeigt
          // keines, und sein Idempotenz-Hash waere fuer ein Ziel ohnehin nur
          // eine Kennung, die niemand aufloesen kann.
          //
          // Nur **abgeschlossene** Stunden. Die laufende Stunde waechst noch,
          // und ein Empfaenger haette zwei Zeilen fuer dasselbe Fenster mit
          // verschiedenen Zahlen.
          const result = await database.query<{
            bucket_start: Date; metric: string; accepted: string; rejected: string; events: string;
          }>(
            `SELECT bucket_start, metric, accepted, rejected, events FROM (
               SELECT (date_trunc('hour', observed_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
                        AS bucket_start,
                      metric,
                      COALESCE(SUM(quantity) FILTER (WHERE accepted), 0)::text AS accepted,
                      COALESCE(SUM(quantity) FILTER (WHERE NOT accepted), 0)::text AS rejected,
                      COUNT(*)::text AS events
                 FROM usage_events
                WHERE organization_id = $1 AND project_id = $2::uuid
                  AND environment = $3::qkern_environment
                  AND observed_at < date_trunc('hour', now())
                GROUP BY 1, 2
             ) AS series
              WHERE true ${after("series.bucket_start", "series.metric", "text")}
              ORDER BY series.bucket_start ${direction}, series.metric ${direction}
              LIMIT ${limit}`, values);
          return result.rows.map((row) => frozenRow({
            // Die Position eines Eimers ist sein Beginn und die Metrik; eine
            // Zeilen-Id gibt es fuer eine Gruppe nicht.
            cursor: `${iso(row.bucket_start)}#${row.metric}`,
            record: {
              metric: row.metric,
              bucket: "hour",
              start: iso(row.bucket_start),
              accepted: row.accepted,
              rejected: row.rejected,
              events: Number(row.events),
            },
          }));
        }
      }
    });
  }
}

/** Jede gelesene Zeile wird an genau einer Stelle eingefroren. */
function frozenRow(row: LogDrainSourceRow): LogDrainSourceRow {
  return Object.freeze({ cursor: row.cursor, record: Object.freeze({ ...row.record }) });
}

function iso(value: Date): string {
  return new Date(value).toISOString();
}

function formatCursor(at: Date, id: string): string {
  return `${iso(at)}#${id}`;
}

/**
 * Der Cursor ist `<zeitpunkt>#<id>`. Er ist undurchsichtig, aber nicht
 * vertrauenswuerdig: Ein unbrauchbarer Cursor waere ein Programmierfehler und
 * wird zu `null` -- der Lauf beginnt dann bei der Spitze, statt eine ungueltige
 * Grenze in die Abfrage zu tragen.
 */
function parseCursor(value: string | null): { at: string; id: string } | null {
  if (typeof value !== "string") return null;
  const separator = value.indexOf("#");
  if (separator < 1) return null;
  const at = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (!Number.isFinite(Date.parse(at)) || id.length === 0 || id.length > 128) return null;
  return { at, id };
}

function scopeValues(scope: { organizationId: string; projectId: string; environment: string }) {
  return [scope.organizationId, scope.projectId, scope.environment];
}

function isSource(value: string): value is LogDrainSourceId {
  return (LOG_DRAIN_SOURCES as readonly string[]).includes(value);
}

function toRecord(row: Row): LogDrainRecord {
  return Object.freeze({
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    environment: row.environment,
    webhookId: row.webhook_id,
    name: row.name,
    url: row.url,
    sources: Object.freeze(row.sources.filter(isSource)),
    eventTypes: Object.freeze([...row.event_types]),
    signingSecretRef: row.signing_secret_ref,
    enabled: row.enabled,
    createdAt: iso(row.created_at),
  });
}

/** Ein zweiter Name ist ein Konflikt, kein Serverfehler -- wie in 1.20. */
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
