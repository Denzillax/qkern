import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlQueryable } from "@/lib/server/db/sql";
import { DASHBOARD_EVENT_KINDS, type DashboardEventKind } from "@/lib/console/dashboard-webhooks";
import type { ComputeDefinitionScope } from "@/lib/server/compute/definitions";
import type { DashboardWebhookCensus } from
  "@/lib/server/compute/dashboard-webhook-collector-runtime";
import type {
  DashboardWebhookCollectorStateSource,
  DashboardWebhookCursorStore,
  DashboardWebhookNotification,
} from "@/lib/server/compute/dashboard-webhooks";
import type { WebhookOutboxScope } from "@/lib/server/compute/webhook-outbox";

type CursorDatabase = Pick<PostgresControlPlane, "withTenant">;

const MAX_POSITION = 512;

/**
 * Die Position des Sammlers und die Zahl der Dashboard-Webhooks je Umgebung
 * (2.75).
 *
 * Beides liest dieselbe Rolle wie der Rest des Compute-Prozesses, und beides
 * unter derselben Mandantengrenze: `withTenant` setzt die Organisation, RLS
 * beantwortet den Rest. Ein eigener Leser mit weiteren Rechten waere hier nichts
 * als eine zweite Tuer.
 *
 * Der Leser heisst `service-role:dashboard-webhooks`, genau wie der der
 * Kopplungen und der der Audit-Kette -- es ist derselbe Vorgang, nur ein
 * weiterer Teil davon.
 */
export class PostgresDashboardWebhookCursorRepository
implements DashboardWebhookCursorStore, DashboardWebhookCensus,
  DashboardWebhookCollectorStateSource {
  constructor(
    private readonly database: CursorDatabase,
    private readonly actorRef = "service-role:dashboard-webhooks",
  ) {}

  /** `null` heisst "noch nie gesammelt"; die leere Zeichenkette "von Anfang an". */
  async load(scope: WebhookOutboxScope, webhookId: string, kind: DashboardEventKind):
  Promise<string | null> {
    assertKind(kind);
    return await this.withTenant(scope, true, async (database) => {
      const result = await database.query<{ position: string }>(
        `SELECT position FROM project_dashboard_webhook_cursors
          WHERE organization_id = $1 AND project_id = $2 AND environment = $3
            AND webhook_id = $4 AND kind = $5`,
        [...values(scope), webhookId, kind],
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
   * ueberschreiben hiesse, auf die inzwischen gewachsene Spitze zu springen und
   * alles dazwischen zu ueberspringen.
   *
   * `notified_at` bleibt dabei leer. Es ist noch nichts hinausgegangen, und die
   * Console soll das auch so sagen.
   */
  async begin(scope: WebhookOutboxScope, webhookId: string, kind: DashboardEventKind,
    position: string): Promise<void> {
    assertKind(kind);
    text(position);
    await this.withTenant(scope, false, async (database) => {
      await database.query(
        `INSERT INTO project_dashboard_webhook_cursors
           (organization_id, project_id, environment, webhook_id, kind, position, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (organization_id, project_id, environment, webhook_id, kind)
           DO NOTHING`,
        [...values(scope), webhookId, kind, position],
      );
    });
  }

  /**
   * Schreibt die Position einer eingereihten Meldung, aber nie rueckwaerts.
   *
   * `GREATEST` steht in der Anweisung und nicht im Prozess: Zwei Instanzen mit
   * derselben Scope-Liste sind erlaubt, und die langsamere darf die schnellere
   * nicht zurueckdrehen. Im Prozess verglichen waere das ein Wettlauf zwischen
   * Lesen und Schreiben.
   *
   * Verglichen wird byteweise, weil die Spalte `COLLATE "C"` traegt. Nur diese
   * Ordnung stimmt mit `(created_at, id)` ueberein, nach der der Leser sortiert.
   */
  async advance(scope: WebhookOutboxScope, webhookId: string, kind: DashboardEventKind,
    position: string): Promise<void> {
    assertKind(kind);
    text(position);
    await this.withTenant(scope, false, async (database) => {
      await database.query(
        `INSERT INTO project_dashboard_webhook_cursors
           (organization_id, project_id, environment, webhook_id, kind, position,
            notified_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now(), now())
         ON CONFLICT (organization_id, project_id, environment, webhook_id, kind) DO UPDATE
           SET position = GREATEST(project_dashboard_webhook_cursors.position,
                                   EXCLUDED.position),
               notified_at = now(),
               updated_at = now()`,
        [...values(scope), webhookId, kind, position],
      );
    });
  }

  /**
   * Wie viele Dashboard-Webhooks diese Umgebung hat und wie viele davon melden.
   *
   * Eine Abfrage fuer beide Zahlen. Getrennt gefragt koennten sie aus zwei
   * Augenblicken stammen und die Entdeckung eine Umgebung beschreiben, die es so
   * nie gab.
   */
  async dashboardWebhookCounts(scope: WebhookOutboxScope):
  Promise<{ total: number; enabled: number }> {
    return await this.withTenant(scope, true, async (database) => {
      const result = await database.query<{ total: string; enabled: string }>(
        `SELECT count(*)::text AS total,
                (count(*) FILTER (WHERE w.enabled))::text AS enabled
           FROM project_dashboard_webhooks h
           JOIN project_webhooks w
             ON w.organization_id = h.organization_id AND w.project_id = h.project_id
            AND w.environment = h.environment AND w.id = h.webhook_id
          WHERE h.organization_id = $1 AND h.project_id = $2 AND h.environment = $3`,
        values(scope),
      );
      const row = result.rows[0];
      return { total: row ? count(row.total) : 0, enabled: row ? count(row.enabled) : 0 };
    });
  }

  /**
   * Was die Console ueber den Stand des Sammlers zeigen darf.
   *
   * Je Webhook und Ereignisart eine Zeile, und nur, wenn wirklich schon einmal
   * gemeldet wurde. Eine leere Antwort heisst "noch nie" -- und zwar wirklich,
   * statt eines erfundenen Zeitpunkts.
   *
   * Gelesen wird unter dem **Aufrufer** der Ansicht, nicht unter dem Leser des
   * Sammlers: Es ist eine Anzeige fuer einen Administrator, und sie soll
   * dieselbe Mandantengrenze passieren wie die Liste daneben.
   */
  async lastNotifications(
    principal: { organizationId: string; actorRef: string },
    scope: ComputeDefinitionScope,
  ): Promise<DashboardWebhookNotification[]> {
    const { organizationId, actorRef } = principal;
    return await this.database.withTenant({ organizationId, actorRef, readOnly: true },
      async (repositories) => {
        const result = await repositories.transaction.query<{
          webhook_id: string; kind: string; position: string; notified_at: Date;
        }>(
          `SELECT webhook_id, kind, position, notified_at
             FROM project_dashboard_webhook_cursors
            WHERE organization_id = $1 AND project_id = $2 AND environment = $3
              AND notified_at IS NOT NULL
            ORDER BY webhook_id, kind`,
          values(scope),
        );
        return result.rows.filter((row) => isKind(row.kind)).map((row) => Object.freeze({
          webhookId: row.webhook_id,
          kind: row.kind as DashboardEventKind,
          position: text(row.position),
          notifiedAt: new Date(row.notified_at).toISOString(),
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

function isKind(value: string): value is DashboardEventKind {
  return (DASHBOARD_EVENT_KINDS as readonly string[]).includes(value);
}

/**
 * Die Ereignisart steht im Schluessel einer Zeile. Eine Art, die die feste Liste
 * nicht kennt, kommt hier gar nicht erst an die Datenbank -- die Migration wiese
 * sie ebenfalls ab, aber sie waere dann schon eine Anweisung.
 */
function assertKind(kind: string): void {
  if (!isKind(kind)) throw new TypeError("A dashboard webhook cursor names a known event kind.");
}

function text(value: string): string {
  if (typeof value !== "string" || value.length > MAX_POSITION) {
    throw new TypeError("A dashboard webhook cursor position must be a bounded string.");
  }
  return value;
}

/** `count(*)` erreicht den Treiber als Zeichenkette; ungeprueft wuerde daraus still `NaN`. */
function count(value: string): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError("A dashboard webhook census must be a bounded integer.");
  }
  return parsed;
}
