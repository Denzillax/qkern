import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlQueryable } from "@/lib/server/db/sql";
import type {
  DatabaseWebhookCouplingCensus,
  DatabaseWebhookCursorStore,
} from "@/lib/server/compute/database-webhook-bridge-runtime";
import type { WebhookOutboxScope } from "@/lib/server/compute/webhook-outbox";

type CursorDatabase = Pick<PostgresControlPlane, "withTenant">;

const MAX_POSITION = Number.MAX_SAFE_INTEGER;

/**
 * Die Position der Bruecke und die Zahl der Kopplungen je Umgebung (2.53).
 *
 * Beides liest dieselbe Rolle wie der Rest des Compute-Prozesses, und beides
 * unter derselben Mandantengrenze: `withTenant` setzt die Organisation, RLS
 * beantwortet den Rest. Ein eigener Leser mit weiteren Rechten waere hier
 * nichts als eine zweite Tuer.
 *
 * Der Leser heisst `service-role:database-webhooks`, genau wie der der
 * Kopplungen in 2.50 -- es ist derselbe Vorgang, nur die andere Haelfte davon.
 */
export class PostgresDatabaseWebhookCursorRepository
implements DatabaseWebhookCursorStore, DatabaseWebhookCouplingCensus {
  constructor(
    private readonly database: CursorDatabase,
    private readonly actorRef = "service-role:database-webhooks",
  ) {}

  /** 0 heisst "noch nie gelesen". Der Feed beginnt bei 1. */
  async load(scope: WebhookOutboxScope): Promise<number> {
    return await this.withTenant(scope, true, async (database) => {
      const result = await database.query<{ position: string | number }>(
        `SELECT position FROM project_database_webhook_cursors
          WHERE organization_id = $1 AND project_id = $2 AND environment = $3`,
        values(scope),
      );
      const row = result.rows[0];
      return row === undefined ? 0 : position(row.position);
    });
  }

  /**
   * Schreibt die Position, aber nie rueckwaerts.
   *
   * `GREATEST` steht in der Anweisung und nicht im Prozess: Zwei Instanzen mit
   * derselben Scope-Liste sind erlaubt, und die langsamere darf die schnellere
   * nicht zurueckdrehen. Im Prozess verglichen waere das ein Wettlauf zwischen
   * Lesen und Schreiben.
   */
  async save(scope: WebhookOutboxScope, next: number): Promise<void> {
    if (!Number.isSafeInteger(next) || next < 0 || next > MAX_POSITION) {
      throw new TypeError("A database webhook cursor position must be a bounded integer.");
    }
    await this.withTenant(scope, false, async (database) => {
      await database.query(
        `INSERT INTO project_database_webhook_cursors
           (organization_id, project_id, environment, position, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (organization_id, project_id, environment) DO UPDATE
           SET position = GREATEST(project_database_webhook_cursors.position, EXCLUDED.position),
               updated_at = now()`,
        [...values(scope), next],
      );
    });
  }

  /**
   * Wie viele Kopplungen diese Umgebung hat und wie viele davon ausloesen.
   *
   * Eine Abfrage fuer beide Zahlen. Getrennt gefragt koennten sie aus zwei
   * Augenblicken stammen und die Entdeckung eine Umgebung beschreiben, die es
   * so nie gab.
   */
  async couplingCounts(scope: WebhookOutboxScope): Promise<{ total: number; enabled: number }> {
    return await this.withTenant(scope, true, async (database) => {
      const result = await database.query<{ total: string; enabled: string }>(
        `SELECT count(*)::text AS total,
                (count(*) FILTER (WHERE w.enabled))::text AS enabled
           FROM project_database_webhooks b
           JOIN project_webhooks w
             ON w.organization_id = b.organization_id AND w.project_id = b.project_id
            AND w.environment = b.environment AND w.id = b.webhook_id
          WHERE b.organization_id = $1 AND b.project_id = $2 AND b.environment = $3`,
        values(scope),
      );
      const row = result.rows[0];
      return {
        total: row ? position(row.total) : 0,
        enabled: row ? position(row.enabled) : 0,
      };
    });
  }

  /**
   * Was die Konsole ueber den Stand der Bruecke zeigen darf (2.53).
   *
   * `null`, solange nie gelesen wurde -- und zwar wirklich `null` und nicht ein
   * erfundener Zeitpunkt. Die Ansicht sagt dann, dass die Bruecke diese
   * Umgebung noch nicht gelesen hat, statt eine Zahl zu zeigen, die nichts
   * bedeutet.
   *
   * Gelesen wird unter dem **Aufrufer** der Ansicht, nicht unter dem Leser der
   * Bruecke: Es ist eine Anzeige fuer einen Administrator, und sie soll
   * dieselbe Mandantengrenze passieren wie die Liste daneben.
   */
  async lastAdvance(
    principal: { organizationId: string; actorRef: string },
    scope: WebhookOutboxScope,
  ): Promise<{ position: number; updatedAt: string } | null> {
    const { organizationId, actorRef } = principal;
    return await this.database.withTenant({ organizationId, actorRef, readOnly: true },
      async (repositories) => {
        const result = await repositories.transaction.query<{
          position: string | number; updated_at: Date;
        }>(
          `SELECT position, updated_at FROM project_database_webhook_cursors
            WHERE organization_id = $1 AND project_id = $2 AND environment = $3`,
          values(scope),
        );
        const row = result.rows[0];
        if (!row) return null;
        return {
          position: position(row.position),
          updatedAt: new Date(row.updated_at).toISOString(),
        };
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

function values(scope: WebhookOutboxScope) {
  return [scope.organizationId, scope.projectId, scope.environment];
}

/** `bigint` erreicht den Treiber als Zeichenkette; ungeprueft wuerde daraus still `NaN`. */
function position(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError("A database webhook cursor position must be a bounded integer.");
  }
  return parsed;
}
