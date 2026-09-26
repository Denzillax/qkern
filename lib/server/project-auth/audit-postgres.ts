import { AuditRepository } from "@/lib/server/db/repositories";
import type { SqlPool } from "@/lib/server/db/sql";
import { withTenantTransaction } from "@/lib/server/db/transaction";
import type {
  ProjectAuthAuditSeriesQuery,
  ProjectAuthAuditSeriesRecord,
} from "@/lib/server/project-auth/audit-series";
import {
  sanitizeProjectAuthAuditEvent,
  type ProjectAuthAuditEntry,
  type ProjectAuthAuditEvent,
  type ProjectAuthAuditMetadata,
  type ProjectAuthAuditPage,
  type ProjectAuthAuditSink,
} from "@/lib/server/project-auth/audit";
import type { ProjectAuthScope } from "@/lib/server/project-auth/model";

/**
 * Schreibt Project-Auth-Ereignisse ueber den Auth-Pool (`qkern_auth`) in die
 * Hash-Kette der Plattform.
 *
 * Der Weg ist derselbe wie fuer jeden anderen Eintrag: eine
 * Mandanten-Transaktion setzt `qkern.organization_id`, `AuditRepository`
 * schreibt, der Trigger `qkern_prepare_audit_log` aus 0002 verkettet. Die
 * Rechte dafuer vergibt 0046 (SELECT und INSERT auf audit_logs, begrenzt
 * durch die RLS-Policies auf die eigene Organisation).
 */
export class PostgresProjectAuthAuditSink implements ProjectAuthAuditSink {
  constructor(private readonly pool: SqlPool) {}

  async record(event: ProjectAuthAuditEvent): Promise<void> {
    const clean = sanitizeProjectAuthAuditEvent(event);
    await withTenantTransaction(this.pool, {
      organizationId: clean.scope.organizationId,
      actorRef: clean.actorRef,
      statementTimeoutMs: 5_000,
    }, async (transaction) => {
      await new AuditRepository(transaction).append({
        projectId: clean.scope.projectId,
        environment: clean.scope.environment,
        actorType: clean.actorType,
        actorRef: clean.actorRef,
        action: clean.action,
        resourceRef: clean.resourceRef,
        status: clean.status,
        metadata: clean.metadata,
      });
    });
  }

  async list(scope: ProjectAuthScope, input: { limit: number; cursor?: string }): Promise<ProjectAuthAuditPage> {
    return withTenantTransaction(this.pool, {
      organizationId: scope.organizationId,
      readOnly: true,
      statementTimeoutMs: 5_000,
    }, async (transaction) => {
      // Der Cursor ist die ID des letzten gezeigten Eintrags; seine Position
      // (created_at, id) liest die Abfrage selbst nach. So bleibt die volle
      // Zeitaufloesung der Datenbank erhalten, und ein fremder oder
      // unbekannter Cursor liefert schlicht nichts.
      const result = await transaction.query(
        `SELECT id, created_at, actor_type, actor_ref, action, resource_ref, status, redacted_metadata
         FROM audit_logs
         WHERE organization_id = $1
           AND project_id = $2::uuid
           AND environment = $3::qkern_environment
           AND starts_with(action, 'project_auth.')
           AND ($4::uuid IS NULL OR (created_at, id) < (
             SELECT cursor_row.created_at, cursor_row.id FROM audit_logs AS cursor_row
             WHERE cursor_row.organization_id = $1 AND cursor_row.id = $4::uuid))
         ORDER BY created_at DESC, id DESC
         LIMIT $5`,
        [transaction.organizationId, scope.projectId, scope.environment, input.cursor ?? null, input.limit + 1],
      );
      const events = result.rows.slice(0, input.limit).map(entryFromRow);
      return { events, nextCursor: result.rows.length > input.limit ? events[events.length - 1].id : null };
    });
  }

  /**
   * Die Zeitreihe (2.47) entsteht in der Datenbank: `date_trunc`, `GROUP BY`,
   * `ORDER BY`, ein `LIMIT`. Die Zeilen selbst bleiben unten: eine
   * Anmeldereihe ueber 90 Tage kann Hunderttausende Eintraege umfassen, und
   * keiner davon muesste je durch Node laufen, um vier Zahlen zu ergeben.
   *
   * `date_trunc` rechnet ausdruecklich in UTC. Ohne die Umrechnung schnitte
   * es in der Zeitzone der Sitzung, und die Eimergrenzen haengen dann an der
   * Konfiguration der Verbindung statt am Kalender. Die Eimergroesse ist ein
   * Parameter, kein eingesetzter Text; erlaubt sind nur `hour` und `day`,
   * geprueft vom Dienst gegen `PROJECT_AUTH_SERIES_BUCKETS`.
   *
   * Nichts hiervon traegt eine Adresse: gezaehlt werden `action` und
   * `status`, und beide sind vom Sanitizer auf harmlose Werte begrenzt.
   */
  async series(
    scope: ProjectAuthScope,
    input: ProjectAuthAuditSeriesQuery,
  ): Promise<ProjectAuthAuditSeriesRecord[]> {
    return withTenantTransaction(this.pool, {
      organizationId: scope.organizationId,
      readOnly: true,
      statementTimeoutMs: 5_000,
    }, async (transaction) => {
      const result = await transaction.query(
        `SELECT (date_trunc($4, created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS bucket_start,
                action,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status = 'failed') AS failed
         FROM audit_logs
         WHERE organization_id = $1
           AND project_id = $2::uuid
           AND environment = $3::qkern_environment
           AND starts_with(action, 'project_auth.')
           AND created_at >= $5
           AND created_at < $6
         GROUP BY 1, 2
         ORDER BY 1, 2
         LIMIT $7`,
        [transaction.organizationId, scope.projectId, scope.environment, input.bucket, input.from, input.to, input.limit],
      );
      return result.rows.map(seriesFromRow);
    });
  }
}

function seriesFromRow(row: Record<string, unknown>): ProjectAuthAuditSeriesRecord {
  const bucketStart = row.bucket_start instanceof Date ? row.bucket_start : new Date(String(row.bucket_start));
  return {
    bucketStart,
    action: String(row.action),
    total: count(row.total),
    failed: count(row.failed),
  };
}

/** `COUNT(*)` kommt als int8 und damit als Text aus dem Treiber. */
function count(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(String(value ?? 0));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function entryFromRow(row: Record<string, unknown>): ProjectAuthAuditEntry {
  const metadata: ProjectAuthAuditMetadata = {};
  const raw = row.redacted_metadata;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
        metadata[key] = value;
      }
    }
  }
  const createdAt = row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at));
  return {
    id: String(row.id),
    createdAt: createdAt.toISOString(),
    actorType: String(row.actor_type),
    actorRef: String(row.actor_ref),
    action: String(row.action),
    resourceRef: String(row.resource_ref),
    status: String(row.status),
    metadata,
  };
}
