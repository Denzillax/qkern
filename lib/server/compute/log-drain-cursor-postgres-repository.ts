import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlQueryable } from "@/lib/server/db/sql";
import { LOG_DRAIN_SOURCES, type LogDrainSourceId } from "@/lib/console/log-drains";
import type { ComputeDefinitionScope } from "@/lib/server/compute/definitions";
import type { LogDrainCensus } from "@/lib/server/compute/log-drain-collector-runtime";
import type {
  LogDrainCollectorStateSource,
  LogDrainCursorStore,
  LogDrainForward,
} from "@/lib/server/compute/log-drains";
import type { WebhookOutboxScope } from "@/lib/server/compute/webhook-outbox";

type CursorDatabase = Pick<PostgresControlPlane, "withTenant">;

const MAX_POSITION = 512;

/**
 * Die Position des Sammlers und die Zahl der Drains je Umgebung (2.64).
 *
 * Beides liest dieselbe Rolle wie der Rest des Compute-Prozesses, und beides
 * unter derselben Mandantengrenze: `withTenant` setzt die Organisation, RLS
 * beantwortet den Rest. Ein eigener Leser mit weiteren Rechten waere hier
 * nichts als eine zweite Tuer.
 *
 * Der Leser heisst `service-role:log-drains`, genau wie der der Kopplungen und
 * der Quellen in 2.54 -- es ist derselbe Vorgang, nur ein weiterer Teil davon.
 */
export class PostgresLogDrainCursorRepository
implements LogDrainCursorStore, LogDrainCensus, LogDrainCollectorStateSource {
  constructor(
    private readonly database: CursorDatabase,
    private readonly actorRef = "service-role:log-drains",
  ) {}

  /** `null` heisst "noch nie gesammelt"; die leere Zeichenkette "von Anfang an". */
  async load(scope: WebhookOutboxScope, webhookId: string, source: LogDrainSourceId):
  Promise<string | null> {
    assertSource(source);
    return await this.withTenant(scope, true, async (database) => {
      const result = await database.query<{ position: string }>(
        `SELECT position FROM project_log_drain_cursors
          WHERE organization_id = $1 AND project_id = $2 AND environment = $3
            AND webhook_id = $4 AND source = $5`,
        [...values(scope), webhookId, source],
      );
      const row = result.rows[0];
      return row === undefined ? null : text(row.position);
    });
  }

  /**
   * Haelt den Anfangsstand fest -- einmal, und nie wieder.
   *
   * `DO NOTHING`, nicht `DO UPDATE`: Gibt es schon eine Zeile, hat eine andere
   * Instanz sie eben angelegt oder sie stammt aus einem frueheren Lauf. Sie zu
   * ueberschreiben hiesse, auf die inzwischen gewachsene Spitze zu springen
   * und alles dazwischen zu ueberspringen.
   *
   * `forwarded_at` bleibt dabei leer. Es ist noch nichts hinausgegangen, und
   * die Console soll das auch so sagen.
   */
  async begin(scope: WebhookOutboxScope, webhookId: string, source: LogDrainSourceId,
    position: string): Promise<void> {
    assertSource(source);
    text(position);
    await this.withTenant(scope, false, async (database) => {
      await database.query(
        `INSERT INTO project_log_drain_cursors
           (organization_id, project_id, environment, webhook_id, source, position, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (organization_id, project_id, environment, webhook_id, source)
           DO NOTHING`,
        [...values(scope), webhookId, source, position],
      );
    });
  }

  /**
   * Schreibt die Position einer eingereihten Ladung, aber nie rueckwaerts.
   *
   * `GREATEST` steht in der Anweisung und nicht im Prozess: Zwei Instanzen mit
   * derselben Scope-Liste sind erlaubt, und die langsamere darf die schnellere
   * nicht zurueckdrehen. Im Prozess verglichen waere das ein Wettlauf zwischen
   * Lesen und Schreiben.
   *
   * Verglichen wird byteweise, weil die Spalte `COLLATE "C"` traegt. Nur diese
   * Ordnung stimmt mit `(zeitpunkt, id)` ueberein, nach der der Leser sortiert.
   */
  async advance(scope: WebhookOutboxScope, webhookId: string, source: LogDrainSourceId,
    position: string): Promise<void> {
    assertSource(source);
    text(position);
    await this.withTenant(scope, false, async (database) => {
      await database.query(
        `INSERT INTO project_log_drain_cursors
           (organization_id, project_id, environment, webhook_id, source, position,
            forwarded_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now(), now())
         ON CONFLICT (organization_id, project_id, environment, webhook_id, source) DO UPDATE
           SET position = GREATEST(project_log_drain_cursors.position, EXCLUDED.position),
               forwarded_at = now(),
               updated_at = now()`,
        [...values(scope), webhookId, source, position],
      );
    });
  }

  /**
   * Wie viele Drains diese Umgebung hat und wie viele davon weiterleiten.
   *
   * Eine Abfrage fuer beide Zahlen. Getrennt gefragt koennten sie aus zwei
   * Augenblicken stammen und die Entdeckung eine Umgebung beschreiben, die es
   * so nie gab.
   */
  async drainCounts(scope: WebhookOutboxScope): Promise<{ total: number; enabled: number }> {
    return await this.withTenant(scope, true, async (database) => {
      const result = await database.query<{ total: string; enabled: string }>(
        `SELECT count(*)::text AS total,
                (count(*) FILTER (WHERE w.enabled))::text AS enabled
           FROM project_log_drains d
           JOIN project_webhooks w
             ON w.organization_id = d.organization_id AND w.project_id = d.project_id
            AND w.environment = d.environment AND w.id = d.webhook_id
          WHERE d.organization_id = $1 AND d.project_id = $2 AND d.environment = $3`,
        values(scope),
      );
      const row = result.rows[0];
      return { total: row ? count(row.total) : 0, enabled: row ? count(row.enabled) : 0 };
    });
  }

  /**
   * Was die Console ueber den Stand des Sammlers zeigen darf (2.64).
   *
   * Je Drain und Quelle eine Zeile, und nur, wenn wirklich schon einmal
   * weitergeleitet wurde. Eine leere Antwort heisst "noch nie" -- und zwar
   * wirklich, statt eines erfundenen Zeitpunkts.
   *
   * Gelesen wird unter dem **Aufrufer** der Ansicht, nicht unter dem Leser des
   * Sammlers: Es ist eine Anzeige fuer einen Administrator, und sie soll
   * dieselbe Mandantengrenze passieren wie die Liste daneben.
   */
  async lastForwards(
    principal: { organizationId: string; actorRef: string },
    scope: ComputeDefinitionScope,
  ): Promise<LogDrainForward[]> {
    const { organizationId, actorRef } = principal;
    return await this.database.withTenant({ organizationId, actorRef, readOnly: true },
      async (repositories) => {
        const result = await repositories.transaction.query<{
          webhook_id: string; source: string; position: string; forwarded_at: Date;
        }>(
          `SELECT webhook_id, source, position, forwarded_at
             FROM project_log_drain_cursors
            WHERE organization_id = $1 AND project_id = $2 AND environment = $3
              AND forwarded_at IS NOT NULL
            ORDER BY webhook_id, source`,
          values(scope),
        );
        return result.rows.filter((row) => isSource(row.source)).map((row) => Object.freeze({
          webhookId: row.webhook_id,
          source: row.source as LogDrainSourceId,
          position: text(row.position),
          updatedAt: new Date(row.forwarded_at).toISOString(),
        }));
      });
  }

  private withTenant<T>(
    scope: WebhookOutboxScope,
    readOnly: boolean,
    work: (database: SqlQueryable) => Promise<T>,
  ): Promise<T> {
    return this.database.withTenant(
      { organizationId: scope.organizationId, actorRef: this.actorRef, readOnly },
      async (repositories) => work(repositories.transaction),
    );
  }
}

function values(scope: { organizationId: string; projectId: string; environment: string }) {
  return [scope.organizationId, scope.projectId, scope.environment];
}

function isSource(value: string): value is LogDrainSourceId {
  return (LOG_DRAIN_SOURCES as readonly string[]).includes(value);
}

/**
 * Die Quelle steht im Schluessel einer Zeile. Eine Quelle, die die feste Liste
 * nicht kennt, kommt hier gar nicht erst an die Datenbank -- die Migration
 * wiese sie ebenfalls ab, aber sie waere dann schon eine Anweisung.
 */
function assertSource(source: string): void {
  if (!isSource(source)) throw new TypeError("A log drain cursor names a known source.");
}

function text(value: string): string {
  if (typeof value !== "string" || value.length > MAX_POSITION) {
    throw new TypeError("A log drain cursor position must be a bounded string.");
  }
  return value;
}

/** `count(*)` erreicht den Treiber als Zeichenkette; ungeprueft wuerde daraus still `NaN`. */
function count(value: string): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError("A log drain census must be a bounded integer.");
  }
  return parsed;
}
