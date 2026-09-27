import { ConflictError } from "@/lib/server/db/errors";
import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlQueryable, SqlValue } from "@/lib/server/db/sql";
import {
  DASHBOARD_EVENT_DEFINITIONS,
  DASHBOARD_EVENT_KINDS,
  type DashboardEventKind,
  type DashboardWebhookDraft,
  type DashboardWebhookRecord,
} from "@/lib/console/dashboard-webhooks";
import {
  ComputeDefinitionError,
  type ComputeDefinitionScope,
} from "@/lib/server/compute/definitions";
import type {
  DashboardEventReader,
  DashboardEventRow,
  DashboardWebhookBinding,
  DashboardWebhookBindingSource,
  DashboardWebhookRepository,
} from "@/lib/server/compute/dashboard-webhooks";
import type { WebhookOutboxScope } from "@/lib/server/compute/webhook-outbox";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import type { Environment } from "@/lib/types";

type DashboardWebhookDatabase = Pick<PostgresControlPlane, "withTenant">;

type Row = {
  id: string;
  organization_id: string;
  project_id: string;
  environment: Environment;
  webhook_id: string;
  kinds: string[];
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
 * Ereignisarten, die sie beliefern.
 *
 * `signing_secret_ref` steht in dieser Liste, ein Geheimniswert nicht --
 * `project_webhooks` hat keine Spalte dafuer, und es gibt sie auch sonst
 * nirgends in der Control Plane.
 */
const SELECT = `SELECT h.id, h.organization_id, h.project_id, h.environment, h.webhook_id,
    h.kinds, w.name, w.url, w.event_types, w.signing_secret_ref, w.enabled, h.created_at
  FROM project_dashboard_webhooks h
  JOIN project_webhooks w
    ON w.organization_id = h.organization_id AND w.project_id = h.project_id
   AND w.environment = h.environment AND w.id = h.webhook_id`;

const SCOPE = "h.organization_id = $1 AND h.project_id = $2 AND h.environment = $3";

export class PostgresDashboardWebhookRepository
implements DashboardWebhookRepository, DashboardWebhookBindingSource {
  constructor(
    private readonly database: DashboardWebhookDatabase,
    /** Der Sammler ist kein Mensch; er bekommt seinen eigenen Namen. */
    private readonly collectorActorRef = "service-role:dashboard-webhooks",
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
          `${SELECT} WHERE ${SCOPE} AND h.id = $4`, [...scopeValues(scope), id]);
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
   * den Datenbank-Webhooks und den Log-Drains: Ein Ziel fuer Benachrichtigungen
   * hat keinen Grund, ein anderes Zeitbudget zu brauchen als ein anderes Ziel.
   */
  async create(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    draft: DashboardWebhookDraft): Promise<DashboardWebhookRecord> {
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
          `INSERT INTO project_dashboard_webhooks
             (organization_id, project_id, environment, webhook_id, kinds)
           VALUES ($1,$2,$3,$4,$5)`,
          [...scopeValues(scope), webhookId, [...draft.kinds]],
        );

        const created = await database.query<Row>(
          `${SELECT} WHERE ${SCOPE} AND h.webhook_id = $4`, [...scopeValues(scope), webhookId]);
        const row = created.rows[0];
        if (!row) throw new ComputeDefinitionError("COMPUTE_CONFLICT");
        return toRecord(row);
      }));
  }

  /**
   * Der Schalter sitzt auf der Definition aus 0032. 0057 gewaehrt der
   * Laufzeitrolle bewusst kein UPDATE: Die Ereignisarten bleiben, wie sie
   * angelegt wurden.
   */
  async setEnabled(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string,
    enabled: boolean): Promise<DashboardWebhookRecord | null> {
    return await this.withTenant(principal.organizationId, principal.actorRef, false,
      async (database) => {
        const updated = await database.query<{ webhook_id: string }>(
          `UPDATE project_webhooks w
              SET enabled = $5
             FROM project_dashboard_webhooks h
            WHERE h.organization_id = $1 AND h.project_id = $2 AND h.environment = $3
              AND h.id = $4 AND w.organization_id = h.organization_id
              AND w.project_id = h.project_id AND w.environment = h.environment
              AND w.id = h.webhook_id
            RETURNING h.webhook_id`,
          [...scopeValues(scope), id, enabled],
        );
        if (updated.rows.length === 0) return null;
        const result = await database.query<Row>(
          `${SELECT} WHERE ${SCOPE} AND h.id = $4`, [...scopeValues(scope), id]);
        const row = result.rows[0];
        return row ? toRecord(row) : null;
      });
  }

  /**
   * Die aktiven Kopplungen fuer den Sammler.
   *
   * Nur Zeilen, deren Webhook eingeschaltet ist. Ein abgeschalteter
   * Dashboard-Webhook soll nicht einmal eine wartende Meldung erzeugen -- sonst
   * staute sich waehrend der Pause genau das an, was das Abschalten verhindern
   * soll, und beim Einschalten liefe es auf einmal los.
   */
  async activeDashboardWebhooks(scope: WebhookOutboxScope): Promise<DashboardWebhookBinding[]> {
    return await this.withTenant(scope.organizationId, this.collectorActorRef, true,
      async (database) => {
        const result = await database.query<{
          webhook_id: string; kinds: string[]; schema_version: number;
        }>(
          `SELECT h.webhook_id, h.kinds, h.schema_version
             FROM project_dashboard_webhooks h
             JOIN project_webhooks w
               ON w.organization_id = h.organization_id AND w.project_id = h.project_id
              AND w.environment = h.environment AND w.id = h.webhook_id
            WHERE ${SCOPE} AND w.enabled
            ORDER BY h.webhook_id`,
          scopeValues(scope),
        );
        return result.rows.map((row) => Object.freeze({
          webhookId: row.webhook_id,
          kinds: Object.freeze(row.kinds.filter(isKind)),
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
 * Liest die Audit-Kette der Control Plane, je Ereignisart in genau der
 * Projektion, die die Audit-Ansicht der Console zeigt.
 *
 * Die Abfrage nennt ihre Spalten einzeln, und **welche** Metadatenschluessel
 * ueberhaupt aus der Zeile kommen, entscheidet ebenfalls die Abfrage. Das ist
 * die zweite Verteidigungslinie hinter der Whitelist in
 * `lib/console/dashboard-webhooks`: Die Whitelist entscheidet, was hinausgeht,
 * aber ein Wert, der gar nicht gelesen wird, kann auch nicht versehentlich in
 * einem Fehlerpfad landen. `SELECT *` gibt es hier nirgends, und
 * `redacted_metadata` wird nie ganz gelesen.
 *
 * Nicht gelesen werden `actor_ref` und `actor_type`: Die Referenz des Akteurs
 * soll dieser Weg nicht einmal in der Hand halten. `previous_hash` und
 * `entry_hash` bleiben ebenfalls liegen -- die Kette ist der Beweis in der
 * Console, nicht ein Feld in einer Benachrichtigung.
 *
 * Gelesen wird aufsteigend nach Zeit, waehrend die Console absteigend liest: Ein
 * Ziel bekommt seine Ereignisse in der Reihenfolge, in der sie passiert sind.
 * Die Ordnung `(created_at, id)` ist dieselbe, die 0002 als
 * `audit_logs_chain_idx` fuehrt und nach der 0047 die Kette bildet.
 */
export class PostgresDashboardEventReader implements DashboardEventReader {
  constructor(
    private readonly database: DashboardWebhookDatabase,
    private readonly actorRef = "service-role:dashboard-webhooks",
  ) {}

  async tip(scope: WebhookOutboxScope, kind: DashboardEventKind): Promise<string | null> {
    const rows = await this.query(scope, kind, { after: null, limit: 1, newestFirst: true });
    return rows[0]?.cursor ?? null;
  }

  async read(scope: WebhookOutboxScope, kind: DashboardEventKind, input: {
    after: string | null; limit: number;
  }): Promise<readonly DashboardEventRow[]> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000) {
      throw new ComputeDefinitionError("COMPUTE_INVALID_INPUT");
    }
    return await this.query(scope, kind, { ...input, newestFirst: false });
  }

  private async query(scope: WebhookOutboxScope, kind: DashboardEventKind, input: {
    after: string | null; limit: number; newestFirst: boolean;
  }): Promise<DashboardEventRow[]> {
    const definition = DASHBOARD_EVENT_DEFINITIONS[kind];
    const cursor = input.newestFirst ? null : parseCursor(input.after);
    const direction = input.newestFirst ? "DESC" : "ASC";
    return await this.database.withTenant({
      organizationId: scope.organizationId, actorRef: this.actorRef, readOnly: true,
    }, async (repositories) => {
      const values: SqlValue[] = [
        ...scopeValues(scope),
        [...definition.auditActions],
        [...definition.metadataFields],
      ];
      /**
       * Der Vergleich steht als Zeilenvergleich in SQL: `(zeit, id) > (zeit, id)`
       * ordnet auch zwei Eintraege derselben Mikrosekunde eindeutig. Ohne den
       * zweiten Teil koennte ein Lauf einen von ihnen ueberspringen -- und genau
       * dieses Rennen hat 0047 an der Kette selbst geschlossen.
       */
      let after = "";
      if (cursor) {
        values.push(cursor.at, cursor.id);
        after = ` AND (created_at, id) > ($${values.length - 1}::timestamptz,`
          + ` $${values.length}::uuid)`;
      }
      values.push(input.limit);
      const limit = `$${values.length}`;

      const result = await repositories.transaction.query<{
        id: string; created_at: Date; created_at_exact: string; action: string; status: string;
        environment: Environment; project_id: string; resource_ref: string;
        metadata: Record<string, unknown> | null;
      }>(
        // Nur die erlaubten Metadatenschluessel verlassen die Datenbank. Steht
        // keiner auf der Liste, ist das Ergebnis NULL -- und nicht ein Objekt,
        // das jemand spaeter doch noch auspackt.
        //
        // `created_at_exact` traegt Mikrosekunden und ist der Zeitanteil der
        // Position. Nicht `toISOString`: Das kuerzt auf Millisekunden, und eine
        // gekuerzte Position ist kleiner als die Zeile, aus der sie stammt --
        // der naechste Lauf faende dieselbe Zeile wieder gross genug und
        // meldete sie erneut, Lauf fuer Lauf. Fixe Laenge und UTC, damit die
        // Byte-Ordnung der Spalte in 0057 mit der Zeitordnung uebereinstimmt.
        // `::text` waere hier falsch: PostgreSQL schreibt den Versatz
        // zweistellig (`+00`), und mit einem angehaengten `Z` entstuende ein
        // ungueltiges Datum.
        `SELECT id, created_at, action, status, environment, project_id, resource_ref,
                to_char(created_at AT TIME ZONE 'UTC',
                        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_exact,
                (SELECT jsonb_object_agg(pair.key, pair.value)
                   FROM jsonb_each(redacted_metadata) AS pair
                  WHERE pair.key = ANY ($5::text[])) AS metadata
           FROM audit_logs
          WHERE organization_id = $1 AND project_id = $2::uuid
            AND environment = $3::qkern_environment
            AND action = ANY ($4::text[])
            ${after}
          ORDER BY created_at ${direction}, id ${direction}
          LIMIT ${limit}`, values);

      return result.rows.map((row) => {
        const record: Record<string, unknown> = {
          id: row.id,
          createdAt: iso(row.created_at),
          action: row.action,
          status: row.status,
          environment: row.environment,
          projectId: row.project_id,
          resource: row.resource_ref,
        };
        // Die Metadaten wandern unter ihrem eigenen Namen in die Zeile, und nur
        // die Schluessel, die die Abfrage ueberhaupt zurueckgegeben hat. Ein
        // Schluessel, der eine Huelle ueberschreiben wuerde, kommt nicht durch:
        // Die Feldnamen der Huelle stehen in derselben Positivliste, und ein
        // Metadatenschluessel mit demselben Namen wuerde denselben Wert
        // beschreiben.
        for (const [key, value] of Object.entries(row.metadata ?? {})) {
          if (!definition.metadataFields.includes(key)) continue;
          record[key] = value;
        }
        return frozenRow({ cursor: formatCursor(row.created_at_exact, row.id), record });
      });
    });
  }
}

/** Jede gelesene Zeile wird an genau einer Stelle eingefroren. */
function frozenRow(row: DashboardEventRow): DashboardEventRow {
  return Object.freeze({ cursor: row.cursor, record: Object.freeze({ ...row.record }) });
}

function iso(value: Date): string {
  return new Date(value).toISOString();
}

/**
 * Die Position einer Zeile: ihr Zeitpunkt mit Mikrosekunden, dann ihre Kennung.
 *
 * Der Zeitanteil kommt aus `to_char` und nicht aus `Date.prototype.toISOString`,
 * weil letzteres auf Millisekunden kuerzt. Eine gekuerzte Position waere
 * kleiner als die Zeile, aus der sie stammt, und der Zeilenvergleich `(zeit, id)
 * > (zeit, id)` liesse dieselbe Zeile bei jedem Lauf wieder durch.
 */
function formatCursor(at: string, id: string): string {
  return `${at}#${id}`;
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
  if (!Number.isFinite(Date.parse(at)) || !UUID.test(id)) return null;
  return { at, id };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function scopeValues(scope: { organizationId: string; projectId: string; environment: string }) {
  return [scope.organizationId, scope.projectId, scope.environment];
}

function isKind(value: string): value is DashboardEventKind {
  return (DASHBOARD_EVENT_KINDS as readonly string[]).includes(value);
}

function toRecord(row: Row): DashboardWebhookRecord {
  return Object.freeze({
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    environment: row.environment,
    webhookId: row.webhook_id,
    name: row.name,
    url: row.url,
    kinds: Object.freeze(row.kinds.filter(isKind)),
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
