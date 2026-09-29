import { ConflictError } from "@/lib/server/db/errors";
import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlQueryable } from "@/lib/server/db/sql";
import {
  ComputeDefinitionError,
  type ComputeDefinitionRepository,
  type ComputeDefinitionScope,
  type CronDefinitionRecord,
  type FunctionDefinitionRecord,
  type FunctionInvocationLogPage,
  type FunctionInvocationLogQuery,
  type FunctionInvocationOutput,
  type FunctionInvocationRecord,
  type FunctionOutputLogPage,
  type FunctionOutputLogQuery,
  type WebhookDefinitionRecord,
  type WebhookDeliveryRecord,
} from "@/lib/server/compute/definitions";
import type { CronOccurrenceMessageRow } from "@/lib/server/compute/cron-occurrences";
import type { FunctionOutputLine, FunctionOutputRecord } from "@/lib/server/compute/function-output";
import type { ProjectQueueJson, ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import type { Environment } from "@/lib/types";

type DefinitionDatabase = Pick<PostgresControlPlane, "withTenant">;

type CronRow = {
  id: string; organization_id: string; project_id: string; environment: Environment;
  name: string; expression: string; queue: string; payload: ProjectQueueJson;
  enabled: boolean; time_zone: string; last_dispatched_at: Date | null; created_at: Date;
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

type OccurrenceMessageRow = {
  dedupe_key_hash: string;
  status: "available" | "in_flight" | "completed" | "dead_lettered";
  attempt_count: number;
  created_at: Date;
  completed_at: Date | null;
  dead_lettered_at: Date | null;
};

type FunctionRow = {
  id: string; organization_id: string; project_id: string; environment: Environment;
  name: string; runtime: "nodejs24"; image: string; entrypoint: string;
  timeout_ms: number; memory_mib: number; max_concurrency: number;
  egress_origins: string[]; secret_refs: string[]; enabled: boolean; created_at: Date;
};

const CRON_COLUMNS = `id, organization_id, project_id, environment, name, expression, queue,
  payload, enabled, time_zone, last_dispatched_at, created_at`;
const FUNCTION_COLUMNS = `id, organization_id, project_id, environment, name, runtime, image,
  entrypoint, timeout_ms, memory_mib, max_concurrency, egress_origins, secret_refs, enabled,
  created_at`;
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
    timeZone: string;
  }) {
    return await asConflict(this.write(principal, async (database) => {
      const result = await database.query<CronRow>(
        `INSERT INTO project_cron_definitions
           (organization_id, project_id, environment, name, expression, queue, payload, enabled,
            time_zone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING ${CRON_COLUMNS}`,
        [...scopeValues(scope), input.name, input.expression, input.queue,
          input.payload as never, input.enabled, input.timeZone],
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

  /**
   * Nachrichten zu bekannten Dedupe-Verifikatoren, fuer das Cron-Log (2.42).
   *
   * Gelesen wird ausschliesslich Zustand, Versuchszahl und Zeit — **keine
   * Nutzlast**, kein `dedupe_key_hash` mehr als der Aufrufer selbst
   * mitgebracht hat, keine Lease-Referenz. Ein leeres Array an Verifikatoren
   * fragt die Datenbank gar nicht erst.
   *
   * `dedupe_window_seconds` kommt mit: Nach seinem Ablauf setzt die Queue den
   * Verifikator auf NULL (0026), und erst damit kann das Log ein ehrliches
   * "nicht mehr rekonstruierbar" von einem "fehlt" unterscheiden.
   */
  async listCronOccurrenceMessages(
    principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, queue: string,
    dedupeKeyHashes: readonly string[],
  ) {
    return await this.read(principal, async (database) => {
      const found = await database.query<{ id: string; dedupe_window_seconds: number }>(
        `SELECT id, dedupe_window_seconds FROM project_queues
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND name=$4`,
        [...scopeValues(scope), queue],
      );
      const row = found.rows[0];
      if (!row) return { dedupeWindowSeconds: null, messages: [] };
      if (dedupeKeyHashes.length === 0) {
        return { dedupeWindowSeconds: Number(row.dedupe_window_seconds), messages: [] };
      }
      const messages = await database.query<OccurrenceMessageRow>(
        `SELECT dedupe_key_hash, status, attempt_count, created_at, completed_at, dead_lettered_at
           FROM project_queue_messages
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND queue_id=$4
            AND dedupe_key_hash = ANY($5::text[])
          ORDER BY created_at ASC, dedupe_key_hash ASC`,
        [...scopeValues(scope), row.id, [...dedupeKeyHashes]],
      );
      return {
        dedupeWindowSeconds: Number(row.dedupe_window_seconds),
        messages: messages.rows.map(toOccurrenceMessage),
      };
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

  async listFunctions(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope) {
    return await this.read(principal, async (database) => {
      const result = await database.query<FunctionRow>(
        `SELECT ${FUNCTION_COLUMNS} FROM project_functions
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3
          ORDER BY name`, scopeValues(scope),
      );
      return result.rows.map(toFunction);
    });
  }

  async deployFunction(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    id: string, image: string): Promise<number> {
    return await this.database.withTenant({
      organizationId: principal.organizationId, actorRef: principal.actorRef, readOnly: false,
    }, async (repositories) => {
      const result = await repositories.transaction.query<{ revision: number }>(
        "SELECT qkern_deploy_project_function($1, $2) AS revision", [id, image]);
      const revision = result.rows[0]?.revision;
      if (!Number.isSafeInteger(revision) || (revision as number) < 1) {
        throw new Error("deployment returned no revision");
      }
      // Der Audit-Eintrag entsteht in **derselben** Transaktion wie die Tuer:
      // Ein Deployment ohne Audit ist vom Dienstweg aus nicht ausdrueckbar,
      // und die Hash-Kette fuellt der Trigger aus 0002 wie fuer jeden Eintrag.
      await repositories.audit.append({
        projectId: scope.projectId,
        environment: scope.environment,
        actorType: "user",
        actorRef: principal.actorRef,
        action: "project.compute.function.deployed",
        resourceRef: id,
        status: "success",
        metadata: { image, revision },
      });
      return revision as number;
    });
  }

  async recordFunctionInvocation(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    functionId: string, entry: FunctionInvocationRecord): Promise<void> {
    await this.write(principal, async (database) => {
      await database.query(
        `INSERT INTO project_function_invocations
           (organization_id, project_id, environment, function_id, invocation_id, invoked_by,
            started_at, duration_ms, outcome, status_code, error_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [...scopeValues(scope), functionId, entry.invocationId, entry.invokedBy, entry.startedAt,
          entry.durationMs, entry.outcome, entry.statusCode, entry.errorCode]);
    });
  }

  /**
   * Die Inhaltslogs eines Aufrufs (2.98), eine Zeile je Aufruf.
   *
   * Die Zeilen liegen als jsonb in der Zeile, nicht als eigene Tabelle je
   * Logzeile: Ein Aufruf schreibt sie auf einmal, ein Leser holt sie auf
   * einmal, und die Grenzen (500 Zeilen, 64 KiB) halten die Zeile klein. Die
   * Zahlen daneben sind fuer die Liste, die ohne die Zeilen auskommt.
   */
  async recordFunctionInvocationOutput(principal: ProjectQueuePrincipal,
    scope: ComputeDefinitionScope, functionId: string, invocationId: string,
    output: FunctionOutputRecord): Promise<void> {
    await this.write(principal, async (database) => {
      await database.query(
        `INSERT INTO project_function_invocation_output
           (organization_id, project_id, environment, function_id, invocation_id,
            line_count, stdout_lines, stderr_lines, byte_count, truncated, dropped_lines, lines)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
        [...scopeValues(scope), functionId, invocationId, output.lineCount, output.stdoutLines,
          output.stderrLines, output.byteCount, output.truncated, output.droppedLines,
          JSON.stringify(output.lines)]);
    });
  }

  async getInvocationOutput(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    invocationId: string): Promise<FunctionInvocationOutput | null> {
    return await this.read(principal, async (database) => {
      // Der Aufruf zuerst: Ein Aufruf ohne Ausgabe ist ein eigener Zustand,
      // kein Fehlen.
      const result = await database.query<{
        function_id: string; function_name: string; started_at: string;
        outcome: "completed" | "failed";
        line_count: number | null; stdout_lines: number | null; stderr_lines: number | null;
        byte_count: number | null; truncated: boolean | null; dropped_lines: number | null;
        lines: FunctionOutputLine[] | null;
      }>(
        `SELECT log.function_id, fn.name AS function_name, log.started_at::text AS started_at,
                log.outcome, out.line_count, out.stdout_lines, out.stderr_lines, out.byte_count,
                out.truncated, out.dropped_lines, out.lines
         FROM project_function_invocations AS log
         JOIN project_functions AS fn
           ON fn.organization_id = log.organization_id AND fn.project_id = log.project_id
          AND fn.environment = log.environment AND fn.id = log.function_id
         LEFT JOIN project_function_invocation_output AS out
           ON out.organization_id = log.organization_id AND out.invocation_id = log.invocation_id
         WHERE log.organization_id = $1 AND log.project_id = $2 AND log.environment = $3
           AND log.invocation_id = $4`,
        [...scopeValues(scope), invocationId]);
      const row = result.rows[0];
      if (!row) return null;
      return Object.freeze({
        invocationId, functionId: row.function_id, functionName: row.function_name,
        startedAt: row.started_at, outcome: row.outcome,
        output: row.line_count === null || row.lines === null ? null : Object.freeze({
          lines: Object.freeze(row.lines.map((line) => Object.freeze({ ...line }))),
          lineCount: row.line_count,
          stdoutLines: row.stdout_lines ?? 0,
          stderrLines: row.stderr_lines ?? 0,
          byteCount: row.byte_count ?? 0,
          truncated: row.truncated ?? false,
          droppedLines: row.dropped_lines ?? 0,
        }),
      });
    });
  }

  /**
   * Alle Inhaltslogs einer Umgebung (2.98), neueste zuerst, ohne die Zeilen.
   * `hasMore` aus einer Zeile mehr, wie beim Aufrufprotokoll.
   */
  async listOutputLog(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    query: FunctionOutputLogQuery): Promise<FunctionOutputLogPage> {
    return await this.read(principal, async (database) => {
      const page = await database.query<{
        invocation_id: string; function_id: string; function_name: string; started_at: string;
        recorded_at: string; outcome: "completed" | "failed"; line_count: number;
        stdout_lines: number; stderr_lines: number; byte_count: number; truncated: boolean;
        dropped_lines: number;
      }>(
        `SELECT out.invocation_id, out.function_id, fn.name AS function_name,
                log.started_at::text AS started_at, out.recorded_at::text AS recorded_at,
                log.outcome, out.line_count, out.stdout_lines, out.stderr_lines, out.byte_count,
                out.truncated, out.dropped_lines
         FROM project_function_invocation_output AS out
         JOIN project_function_invocations AS log
           ON log.organization_id = out.organization_id AND log.invocation_id = out.invocation_id
         JOIN project_functions AS fn
           ON fn.organization_id = out.organization_id AND fn.project_id = out.project_id
          AND fn.environment = out.environment AND fn.id = out.function_id
         WHERE out.organization_id = $1 AND out.project_id = $2 AND out.environment = $3
           AND ($4::uuid IS NULL OR out.function_id = $4::uuid)
         ORDER BY out.recorded_at DESC, out.invocation_id DESC
         LIMIT $5 OFFSET $6`,
        [...scopeValues(scope), query.functionId, query.limit + 1, query.offset]);
      const rows = page.rows.slice(0, query.limit).map((row) => Object.freeze({
        invocationId: row.invocation_id, functionId: row.function_id,
        functionName: row.function_name, startedAt: row.started_at, recordedAt: row.recorded_at,
        outcome: row.outcome, lineCount: row.line_count, stdoutLines: row.stdout_lines,
        stderrLines: row.stderr_lines, byteCount: row.byte_count, truncated: row.truncated,
        droppedLines: row.dropped_lines,
      }));
      return Object.freeze({
        rows: Object.freeze(rows), limit: query.limit, offset: query.offset,
        hasMore: page.rows.length > query.limit,
      });
    });
  }

  async listFunctionInvocations(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    functionId: string, limit: number): Promise<FunctionInvocationRecord[]> {
    return await this.read(principal, async (database) => {
      const result = await database.query<{
        invocation_id: string; invoked_by: string; started_at: string; duration_ms: number;
        outcome: "completed" | "failed"; status_code: number | null; error_code: string | null;
      }>(
        `SELECT invocation_id, invoked_by, started_at::text AS started_at, duration_ms, outcome,
                status_code, error_code
         FROM project_function_invocations
         WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND function_id = $4
         ORDER BY started_at DESC, invocation_id DESC
         LIMIT $5`,
        [...scopeValues(scope), functionId, limit]);
      return result.rows.map((row) => ({
        invocationId: row.invocation_id, invokedBy: row.invoked_by, startedAt: row.started_at,
        durationMs: row.duration_ms, outcome: row.outcome, statusCode: row.status_code, errorCode: row.error_code,
      }));
    });
  }

  /**
   * Das Aufrufprotokoll einer Umgebung ueber alle Functions (2.51).
   *
   * Zwei Abfragen in einer Transaktion: die Seite und die Zaehlung je
   * Ausgang. Gezaehlt wird in der Datenbank; die Zeilen dafuer nach
   * JavaScript zu holen, um sie dort zu zaehlen, waere bei 10'000 Aufrufen
   * genau der Fehler, den der Seitenschnitt vermeiden soll.
   *
   * Der Ausgangsfilter gilt nur fuer die Seite, nicht fuer die Zaehlung:
   * Sonst koennte die Ansicht neben "nur fehlgeschlagene" nie sagen, wie
   * viele Aufrufe es insgesamt gab.
   *
   * `hasMore` kommt aus einer Zeile mehr statt aus einem zweiten COUNT ueber
   * die gefilterte Menge: Die Frage ist "gibt es noch eine Seite", nicht
   * "wie viele".
   */
  async listInvocationLog(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    query: FunctionInvocationLogQuery): Promise<FunctionInvocationLogPage> {
    return await this.read(principal, async (database) => {
      const page = await database.query<{
        function_id: string; function_name: string; invocation_id: string; invoked_by: string;
        started_at: string; duration_ms: number; outcome: "completed" | "failed";
        status_code: number | null; error_code: string | null;
      }>(
        `SELECT log.function_id, fn.name AS function_name, log.invocation_id, log.invoked_by,
                log.started_at::text AS started_at, log.duration_ms, log.outcome,
                log.status_code, log.error_code
         FROM project_function_invocations AS log
         JOIN project_functions AS fn
           ON fn.organization_id = log.organization_id AND fn.project_id = log.project_id
          AND fn.environment = log.environment AND fn.id = log.function_id
         WHERE log.organization_id = $1 AND log.project_id = $2 AND log.environment = $3
           AND ($4::uuid IS NULL OR log.function_id = $4::uuid)
           AND ($5::text IS NULL OR log.outcome = $5::text)
         ORDER BY log.started_at DESC, log.invocation_id DESC
         LIMIT $6 OFFSET $7`,
        [...scopeValues(scope), query.functionId, query.outcome, query.limit + 1, query.offset]);

      const counts = await database.query<{ outcome: "completed" | "failed"; total: string }>(
        `SELECT outcome, count(*)::text AS total
         FROM project_function_invocations
         WHERE organization_id = $1 AND project_id = $2 AND environment = $3
           AND ($4::uuid IS NULL OR function_id = $4::uuid)
         GROUP BY outcome`,
        [...scopeValues(scope), query.functionId]);

      const rows = page.rows.slice(0, query.limit).map((row) => Object.freeze({
        functionId: row.function_id, functionName: row.function_name,
        invocationId: row.invocation_id, invokedBy: row.invoked_by, startedAt: row.started_at,
        durationMs: row.duration_ms, outcome: row.outcome, statusCode: row.status_code,
        errorCode: row.error_code,
      }));
      const total = (outcome: "completed" | "failed") =>
        Number(counts.rows.find((row) => row.outcome === outcome)?.total ?? "0");
      return Object.freeze({
        rows: Object.freeze(rows),
        limit: query.limit,
        offset: query.offset,
        hasMore: page.rows.length > query.limit,
        counts: Object.freeze({ completed: total("completed"), failed: total("failed") }),
      });
    });
  }

  async listFunctionDeployments(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    id: string) {
    return await this.read(principal, async (database) => {
      const result = await database.query<{
        revision: number; image: string; deployed_by: string; deployed_at: string;
      }>(
        `SELECT revision, image, deployed_by, deployed_at::text AS deployed_at
         FROM project_function_deployments
         WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND function_id = $4
         ORDER BY revision DESC
         LIMIT 100`,
        [...scopeValues(scope), id]);
      return result.rows.map((row) => ({
        revision: row.revision,
        image: row.image,
        deployedBy: row.deployed_by,
        deployedAt: row.deployed_at,
      }));
    });
  }

  async createFunction(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, input: {
    name: string; image: string; entrypoint: string; timeoutMs: number; memoryMiB: number;
    maxConcurrency: number; egressOrigins: readonly string[]; secretRefs: readonly string[];
    enabled: boolean;
  }) {
    return await asConflict(this.write(principal, async (database) => {
      const result = await database.query<FunctionRow>(
        `INSERT INTO project_functions
           (organization_id, project_id, environment, name, runtime, image, entrypoint,
            timeout_ms, memory_mib, max_concurrency, egress_origins, secret_refs, enabled)
         VALUES ($1,$2,$3,$4,'nodejs24',$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING ${FUNCTION_COLUMNS}`,
        [...scopeValues(scope), input.name, input.image, input.entrypoint, input.timeoutMs,
          input.memoryMiB, input.maxConcurrency, [...input.egressOrigins],
          [...input.secretRefs], input.enabled],
      );
      const row = result.rows[0];
      if (!row) throw new ComputeDefinitionError("COMPUTE_CONFLICT");
      return toFunction(row);
    }));
  }

  async getFunction(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string) {
    return await this.read(principal, async (database) => {
      const result = await database.query<FunctionRow>(
        `SELECT ${FUNCTION_COLUMNS} FROM project_functions
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4`,
        [...scopeValues(scope), id],
      );
      return result.rows[0] ? toFunction(result.rows[0]) : null;
    });
  }

  /** Nur aktive Definitionen: Ein abgeschalteter Name ist kein Ziel. */
  async findFunctionByName(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    name: string) {
    return await this.read(principal, async (database) => {
      const result = await database.query<FunctionRow>(
        `SELECT ${FUNCTION_COLUMNS} FROM project_functions
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND name=$4 AND enabled`,
        [...scopeValues(scope), name],
      );
      return result.rows[0] ? toFunction(result.rows[0]) : null;
    });
  }

  async setFunctionEnabled(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    id: string, enabled: boolean) {
    return await this.write(principal, async (database) => {
      const result = await database.query<FunctionRow>(
        `UPDATE project_functions SET enabled=$5
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4
          RETURNING ${FUNCTION_COLUMNS}`,
        [...scopeValues(scope), id, enabled],
      );
      return result.rows[0] ? toFunction(result.rows[0]) : null;
    });
  }

  async deleteFunction(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string) {
    return await this.write(principal, async (database) => {
      const result = await database.query<{ id: string }>(
        `DELETE FROM project_functions
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4
          RETURNING id`, [...scopeValues(scope), id],
      );
      return result.rows.length === 1;
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
    timeZone: row.time_zone,
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

function toFunction(row: FunctionRow): FunctionDefinitionRecord {
  return Object.freeze({
    organizationId: row.organization_id,
    projectId: row.project_id,
    environment: row.environment,
    id: row.id,
    name: row.name,
    runtime: row.runtime,
    image: row.image,
    entrypoint: row.entrypoint,
    timeoutMs: row.timeout_ms,
    memoryMiB: row.memory_mib,
    maxConcurrency: row.max_concurrency,
    egressOrigins: Object.freeze([...row.egress_origins]),
    secretRefs: Object.freeze([...row.secret_refs]),
    enabled: row.enabled,
    createdAt: new Date(row.created_at).toISOString(),
  });
}

/** Der Zustand der Queue in der Sprache des Logs. */
function toOccurrenceMessage(row: OccurrenceMessageRow): CronOccurrenceMessageRow {
  const state = row.status === "available" ? "pending"
    : row.status === "in_flight" ? "in_flight"
      : row.status === "completed" ? "done" : "dead_letter";
  const settled = row.completed_at ?? row.dead_lettered_at;
  return {
    dedupeKeyHash: row.dedupe_key_hash,
    state,
    attempts: row.attempt_count,
    enqueuedAt: new Date(row.created_at),
    settledAt: settled === null ? null : new Date(settled),
  };
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
