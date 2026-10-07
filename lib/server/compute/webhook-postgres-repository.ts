import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlQueryable } from "@/lib/server/db/sql";
import type { WebhookDefinition } from "@/lib/server/compute/model";
import type { WebhookDefinitionSource } from "@/lib/server/compute/webhook-delivery-runtime";
import {
  WebhookOutboxError,
  type WebhookClaim,
  type WebhookOutboxEntry,
  type WebhookOutboxRepository,
  type WebhookOutboxScope,
} from "@/lib/server/compute/webhook-outbox";
import type { ProjectQueueJson } from "@/lib/server/project-queues/model";
import type { ProjectQueueTraceAnchor } from "@/lib/server/project-queues/trace";

type WebhookDatabase = Pick<PostgresControlPlane, "withTenant">;

type DeliveryRow = {
  id: string;
  webhook_id: string;
  event_type: string;
  payload: ProjectQueueJson;
  occurred_at: Date;
  attempt_count: number;
  trace_id: string | null;
  parent_span_id: string | null;
};

type DefinitionRow = {
  id: string;
  name: string;
  url: string;
  event_types: string[];
  signing_secret_ref: string;
  timeout_ms: number;
};

const COLUMNS =
  "id, webhook_id, event_type, payload, occurred_at, attempt_count, trace_id, parent_span_id";

/**
 * Gibt Zustellungen frei, deren Lease abgelaufen ist.
 *
 * Bis Release 1.19 fehlte dieser Schritt. Er fiel nicht auf, weil niemand
 * zustellte — erst mit dem Zustellprozess kann ein Prozess mitten in einem
 * Versuch abstürzen, und ohne Wiederaufnahme bliebe die Zustellung für immer
 * `in_flight`. Project Queues machen es an derselben Stelle genauso.
 *
 * Der Versuchszähler wurde beim Claim bereits erhöht; ein abgestürzter Zusteller
 * verbraucht also einen Versuch. Das ist gewollt: Sonst könnte ein Empfänger,
 * der den Prozess reproduzierbar zum Absturz bringt, endlos wiederholt werden.
 */
async function recoverExpiredLeases(
  database: SqlQueryable,
  scope: WebhookOutboxScope,
  now: Date,
): Promise<void> {
  await database.query(
    `UPDATE project_webhook_deliveries d
        SET status=CASE WHEN d.attempt_count >= w.max_attempts THEN 'dead_lettered' ELSE 'pending' END,
            available_at=CASE WHEN d.attempt_count >= w.max_attempts THEN d.available_at ELSE $4 END,
            lease_worker_id=NULL, lease_token_hash=NULL, lease_expires_at=NULL,
            last_failure_code='WEBHOOK_TIMEOUT',
            dead_lettered_at=CASE WHEN d.attempt_count >= w.max_attempts THEN $4 ELSE NULL END
       FROM project_webhooks w
      WHERE w.organization_id=d.organization_id AND w.project_id=d.project_id
        AND w.environment=d.environment AND w.id=d.webhook_id
        AND d.organization_id=$1 AND d.project_id=$2 AND d.environment=$3
        AND d.status='in_flight' AND d.lease_expires_at <= $4`,
    [scope.organizationId, scope.projectId, scope.environment, now],
  );
}

/**
 * Dauerhafte Webhook-Outbox.
 *
 * Der Claim folgt demselben Weg wie bei Project Queues: `FOR UPDATE SKIP
 * LOCKED` über die fälligen Zeilen, gefolgt von einem gezielten `UPDATE`, der
 * Worker, Lease-Verifier und Ablauf atomar setzt. Migration 0032 gewährt dafür
 * bereits das UPDATE-Recht und die UPDATE-Policy, die eine Sperrklausel
 * verlangt — die Lehre aus Release 1.9, hier vorbeugend angewandt.
 */
export class PostgresWebhookOutboxRepository
implements WebhookOutboxRepository, WebhookDefinitionSource {
  constructor(
    private readonly database: WebhookDatabase,
    private readonly actorRef = "service-role:webhooks",
  ) {}

  async enqueue(scope: WebhookOutboxScope, input: {
    id: string; webhookId: string; eventType: string; payload: ProjectQueueJson;
    occurredAt: Date; createdAt: Date; trace: ProjectQueueTraceAnchor | null;
  }): Promise<WebhookOutboxEntry> {
    return await this.withTenant(scope, false, async (database) => {
      const inserted = await database.query<DeliveryRow>(
        `INSERT INTO project_webhook_deliveries
           (id, organization_id, project_id, environment, webhook_id, event_type, payload,
            occurred_at, status, attempt_count, available_at, created_at,
            trace_id, parent_span_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',0,$9,$9,$10,$11)
         RETURNING ${COLUMNS}`,
        [input.id, scope.organizationId, scope.projectId, scope.environment, input.webhookId,
          input.eventType, input.payload as never, input.occurredAt, input.createdAt,
          input.trace?.traceId ?? null, input.trace?.parentSpanId ?? null],
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
      await recoverExpiredLeases(database, scope, input.now);

      // Nur Zustellungen aktiver Definitionen. Ein Betreiber, der einen Webhook
      // abschaltet, will ihn pausieren — nicht, dass die Warteschlange
      // weiterlaeuft und die Versuche bis zum Dead Letter verbrennt. Beim
      // Wiedereinschalten laufen die geparkten Zustellungen weiter.
      const due = await database.query<{ id: string }>(
        `SELECT d.id FROM project_webhook_deliveries d
          WHERE d.organization_id=$1 AND d.project_id=$2 AND d.environment=$3
            AND d.status='pending' AND d.available_at <= $4
            -- Ein geloeschtes Projekt stellt nichts mehr zu (2.174); die
            -- Zustellungen bleiben liegen, bis der Abraeumer sie nimmt.
            AND EXISTS (SELECT 1 FROM projects AS project
                         WHERE project.organization_id = d.organization_id AND project.id = d.project_id
                           AND project.deleted_at IS NULL)
            AND EXISTS (
              SELECT 1 FROM project_webhooks w
               WHERE w.organization_id=d.organization_id AND w.project_id=d.project_id
                 AND w.environment=d.environment AND w.id=d.webhook_id AND w.enabled
            )
          ORDER BY d.available_at, d.created_at, d.id
          LIMIT $5
          FOR UPDATE OF d SKIP LOCKED`,
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

  /**
   * Aktive Definition einer Zustellung.
   *
   * Der Zustellprozess liest sie erst nach dem Claim, damit die Definition zum
   * Zeitpunkt des Sendens gilt und nicht die eines früheren Durchlaufs.
   */
  async find(scope: WebhookOutboxScope, webhookId: string): Promise<WebhookDefinition | null> {
    return await this.withTenant(scope, true, async (database) => {
      const result = await database.query<DefinitionRow>(
        `SELECT id, name, url, event_types, signing_secret_ref, timeout_ms
           FROM project_webhooks
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4 AND enabled`,
        [scope.organizationId, scope.projectId, scope.environment, webhookId],
      );
      const row = result.rows[0];
      if (!row) return null;
      return Object.freeze({
        ...scope,
        id: row.id,
        name: row.name,
        url: row.url,
        eventTypes: Object.freeze([...row.event_types]),
        signingSecretRef: row.signing_secret_ref,
        timeoutMs: row.timeout_ms,
      });
    });
  }

  /**
   * Entfernt abgeschlossene Zustellungen jenseits ihrer Aufbewahrung.
   *
   * **Wartende und laufende Zustellungen bleiben unberührt**, unabhängig von
   * ihrem Alter. Eine Zustellung, die noch aussteht, ist keine Altlast — sie zu
   * löschen wäre ein stiller Verlust genau der Nachricht, die noch ankommen
   * soll.
   *
   * Zugestellte und tote Zustellungen haben eigene Fenster. Eine tote ist der
   * Grund, warum ein Betreiber überhaupt in diese Tabelle schaut; sie darf
   * nicht mit dem Alltagsrauschen verschwinden.
   */
  async pruneDeliveries(scope: WebhookOutboxScope, input: {
    deliveredBefore: Date; deadLetteredBefore: Date;
  }): Promise<{ delivered: number; deadLettered: number }> {
    return await this.withTenant(scope, false, async (database) => {
      const removed = await database.query<{ status: string; count: string }>(
        `WITH deleted AS (
           DELETE FROM project_webhook_deliveries
            WHERE organization_id=$1 AND project_id=$2 AND environment=$3
              AND ((status='delivered' AND delivered_at < $4)
                OR (status='dead_lettered' AND dead_lettered_at < $5))
            RETURNING status
         ) SELECT status, count(*)::text AS count FROM deleted GROUP BY status`,
        [scope.organizationId, scope.projectId, scope.environment,
          input.deliveredBefore, input.deadLetteredBefore],
      );
      const byStatus = new Map(removed.rows.map((row) => [row.status, Number(row.count)]));
      return {
        delivered: byStatus.get("delivered") ?? 0,
        deadLettered: byStatus.get("dead_lettered") ?? 0,
      };
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
    // Die Form steht im CHECK aus 0082. Beide Werte oder keiner: Eine
    // Eltern-Span ohne Spur ist nach W3C nichts, und der Zusteller koennte aus
    // der Haelfte keine gueltige Kopfzeile bauen.
    trace: row.trace_id && row.parent_span_id
      ? Object.freeze({ traceId: row.trace_id, parentSpanId: row.parent_span_id })
      : null,
  };
}
