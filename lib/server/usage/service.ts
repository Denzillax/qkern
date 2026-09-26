import { recognisedByName } from "@/lib/server/errors/identity";
import { createHash, randomUUID } from "node:crypto";
import type { ControlPlaneService } from "@/lib/server/control-plane/model";
import type { SqlQueryable } from "@/lib/server/db/sql";
import {
  UNENFORCEABLE_USAGE_METRICS,
  USAGE_METRIC_DEFINITIONS,
  USAGE_SERIES_BUCKETS,
  type PublicUsageDecision,
  type PublicUsageEvent,
  type PublicUsageProjection,
  type PublicUsageSeries,
  type UsageDecisionMode,
  type UsageMetric,
  type UsageSeriesBucket,
  type UsagePrincipal,
  type UsageQuotaMode,
  type UsageScope,
  type UsageSource,
  type UsageStatus,
} from "@/lib/server/usage/model";
import { UsageRepositoryConflictError, type UsageRepository } from "@/lib/server/usage/repository";
import type { UsageDecisionRecord } from "@/lib/server/usage/model";

/** Die Textform von PostgreSQL, nicht ISO-8601: `2026-08-06 21:04:11.123456+00`. */
const CURSOR_MARK = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;
const IDENTIFIER = /^[A-Za-z0-9._:-]{3,128}$/;
const SUBJECT = /^[A-Za-z0-9@+._:-]{1,320}$/;
const EVENT_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const MAX_QUANTITY = 1_000_000_000_000n;
const MAX_LIMIT = 9_000_000_000_000_000n;
const METRICS = new Set<UsageMetric>(Object.keys(USAGE_METRIC_DEFINITIONS) as UsageMetric[]);
const SOURCES = new Set<UsageSource>([
  "control_plane", "data_plane", "generated_data_api", "project_auth", "project_storage",
  "realtime", "project_queues", "compute", "mcp",
]);
const SOURCE_METRICS: Record<UsageSource, ReadonlySet<UsageMetric>> = {
  control_plane: new Set(["api_requests"]),
  data_plane: new Set(["api_requests", "database_row_reads"]),
  generated_data_api: new Set(["api_requests", "database_row_reads"]),
  project_auth: new Set(["api_requests"]),
  project_storage: new Set(["api_requests", "storage_egress_bytes"]),
  realtime: new Set(["realtime_messages"]),
  project_queues: new Set(["api_requests", "queue_operations"]),
  compute: new Set(["function_invocations"]),
  mcp: new Set(["api_requests"]),
};

export type UsageErrorCode =
  | "USAGE_METERING_DISABLED"
  | "USAGE_INVALID_INPUT"
  | "USAGE_ACCESS_DENIED"
  | "USAGE_RESOURCE_NOT_FOUND"
  | "USAGE_IDEMPOTENCY_CONFLICT"
  | "USAGE_POLICY_CONFLICT";

export class UsageError extends Error {
  constructor(readonly code: UsageErrorCode) { super(code); this.name = "UsageError"; }
}
recognisedByName(UsageError, "UsageError");

export class UsageService {
  private readonly now: () => Date;
  private readonly id: () => string;

  constructor(private readonly dependencies: {
    repository: UsageRepository;
    controlPlane?: Pick<ControlPlaneService, "getProjectEnvironment">;
    now?: () => Date;
    id?: () => string;
  }) {
    this.now = dependencies.now ?? (() => new Date());
    this.id = dependencies.id ?? (() => randomUUID());
  }

  async record(principal: UsagePrincipal, scope: UsageScope, input: {
    metric: UsageMetric;
    source: UsageSource;
    quantity: number | string | bigint;
    idempotencyKey: string;
    observedAt?: string | Date;
  }, transaction?: SqlQueryable): Promise<PublicUsageDecision> {
    assertPrincipal(principal, scope, "meter");
    if (!METRICS.has(input.metric) || !SOURCES.has(input.source) ||
        !SOURCE_METRICS[input.source]?.has(input.metric) || !EVENT_KEY.test(input.idempotencyKey)) {
      throw new UsageError("USAGE_INVALID_INPUT");
    }
    const quantity = positiveBigInt(input.quantity, MAX_QUANTITY);
    const now = this.now();
    const observedAt = input.observedAt === undefined ? new Date(now) : new Date(input.observedAt);
    if (!Number.isFinite(observedAt.getTime()) || observedAt.getTime() > now.getTime() + 5 * 60_000 ||
        observedAt.getTime() < now.getTime() - 7 * 86_400_000) {
      throw new UsageError("USAGE_INVALID_INPUT");
    }
    const window = monthWindow(observedAt);
    const eventKeyHash = hash(input.idempotencyKey);
    const eventFingerprint = hash([
      scope.organizationId, scope.projectId, scope.environment, input.metric, input.source,
      quantity.toString(), window.start.toISOString(),
    ].join("\n"));
    try {
      const decision = await this.dependencies.repository.consume(principal, {
        ...scope,
        id: this.id(),
        metric: input.metric,
        source: input.source,
        eventKeyHash,
        eventFingerprint,
        quantity,
        observedAt,
        windowStart: window.start,
        windowEnd: window.end,
      }, transaction);
      return publicDecision(decision);
    } catch (error) { throw mapError(error); }
  }

  async readProjection(
    principal: UsagePrincipal,
    scope: UsageScope,
    input: { period?: string } = {},
  ): Promise<PublicUsageProjection> {
    assertPrincipal(principal, scope, ["reader", "operator"]);
    await this.assertProject(principal, scope);
    const window = parsePeriod(input.period, this.now());
    const records = await this.dependencies.repository.readWindow(principal, scope, window.start, window.end);
    const byMetric = new Map(records.map((record) => [record.metric, record]));
    return {
      projectId: scope.projectId,
      environment: scope.environment,
      period: period(window.start),
      windowStart: window.start.toISOString(),
      windowEnd: window.end.toISOString(),
      metrics: (Object.keys(USAGE_METRIC_DEFINITIONS) as UsageMetric[]).map((metric) => {
        const record = byMetric.get(metric);
        const used = record?.quantity ?? 0n;
        const limit = record?.policy?.limit ?? null;
        const mode: UsageDecisionMode = record?.policy?.mode ?? "unlimited";
        return {
          metric,
          ...USAGE_METRIC_DEFINITIONS[metric],
          used: used.toString(),
          limit: limit?.toString() ?? null,
          remaining: limit === null ? null : maxBigInt(limit - used, 0n).toString(),
          mode,
          status: usageStatus(used, limit),
          revision: record?.policy?.revision ?? null,
        };
      }),
    };
  }

  /**
   * Die Zeitreihe einer Metrik (2.45): was gemessen wurde, ueber die Zeit.
   *
   * Aggregiert wird in der Datenbank. Die **leeren Eimer** entstehen hier, im
   * reinen Teil, und nicht in SQL mit `generate_series`. Zwei Gruende:
   *
   * 1. Die Datenbank liest dann nur, was wirklich da ist — ein Index-Scan
   *    ueber die Ereignisse eines Fensters statt ein Join gegen eine
   *    erzeugte Reihe. Auf einem belebten Projekt ist das der teure Teil.
   * 2. Fenster und Eimerzahl rechnet ohnehin dieser Dienst; wer sie kennt,
   *    kann die Luecken fuellen. Und hier ist es ohne Datenbank pruefbar.
   *
   * Das Fenster kommt aus der Eimergroesse, nicht aus dem Aufruf: 48 Stunden
   * oder 90 Tage, endend mit dem laufenden (noch unvollstaendigen) Eimer.
   *
   * Was die Reihe **nicht** ist: keine Antwortzeit, keine Fehlerrate und
   * keine Belegung. Ein Nutzungsereignis traegt eine Menge und einen
   * Zeitpunkt; mehr steht nicht darin. Und sie reicht nur so weit zurueck,
   * wie `usage_events` aufbewahrt wird.
   */
  async readSeries(principal: UsagePrincipal, scope: UsageScope, input: {
    metric?: string;
    bucket?: string;
  } = {}): Promise<PublicUsageSeries> {
    assertPrincipal(principal, scope, ["reader", "operator"]);
    await this.assertProject(principal, scope);
    const metric = input.metric as UsageMetric;
    const bucket = (input.bucket ?? "hour") as UsageSeriesBucket;
    if (!METRICS.has(metric) || !Object.hasOwn(USAGE_SERIES_BUCKETS, bucket)) {
      throw new UsageError("USAGE_INVALID_INPUT");
    }
    const read = this.dependencies.repository.readSeries?.bind(this.dependencies.repository);
    // Wie beim Export: Ein Port ohne Aggregation liefert keine leere Reihe.
    // Eine leere Reihe hiesse „nichts passiert", und das waere gelogen.
    if (!read) throw new UsageError("USAGE_METERING_DISABLED");

    const size = USAGE_SERIES_BUCKETS[bucket];
    const window = seriesWindow(bucket, this.now());
    const records = await read(principal, scope, {
      metric, bucket, from: window.start, to: window.end,
      // Eine Gruppe mehr als das Fenster fassen kann: So faellt auf, wenn die
      // Aggregation je mehr Eimer liefert, als hier gerechnet wurden.
      limit: size.maxBuckets + 1,
    });
    const truncated = records.length > size.maxBuckets;

    const byStart = new Map(records.map((record) => [record.bucketStart.getTime(), record]));
    let accepted = 0n;
    let rejected = 0n;
    let events = 0;
    const buckets = Array.from({ length: size.maxBuckets }, (_, index) => {
      const start = new Date(window.start.getTime() + index * size.seconds * 1000);
      const record = byStart.get(start.getTime());
      accepted += record?.acceptedQuantity ?? 0n;
      rejected += record?.rejectedQuantity ?? 0n;
      events += record?.events ?? 0;
      return {
        start: start.toISOString(),
        accepted: (record?.acceptedQuantity ?? 0n).toString(),
        rejected: (record?.rejectedQuantity ?? 0n).toString(),
        events: record?.events ?? 0,
      };
    });
    return {
      metric,
      ...USAGE_METRIC_DEFINITIONS[metric],
      bucket,
      windowStart: window.start.toISOString(),
      windowEnd: window.end.toISOString(),
      bucketCount: size.maxBuckets,
      truncated,
      buckets,
      totals: { accepted: accepted.toString(), rejected: rejected.toString(), events },
    };
  }

  /**
   * Gibt die Ereignisse eines Monats seitenweise heraus.
   *
   * `usage_events` ist die einzige Tabelle, die **absichtlich** wächst: Der
   * Trigger weist DELETE ab, weil sie zugleich der Beleg hinter jedem Zähler
   * und der Idempotenz-Speicher ist (siehe `docs/USAGE_METERING.md`). Wer sie
   * archivieren will, braucht einen Weg, sie zu lesen — diesen hier.
   *
   * Nur `operator`. Der Browser bekommt die Projektion, nicht die Einzelbelege:
   * Eine Ereignisliste zeigt Takt und Muster einer fremden Anwendung.
   *
   * **Die Verifier bleiben drin.** `eventKeyHash` und `eventFingerprint` sind
   * zwar schon Hashes, tragen aber für ein Archiv nichts bei und laden dazu
   * ein, Schlüssel zu raten. Was hier herauskommt, ist der Entscheid, nicht
   * seine Herkunft.
   */
  async exportEvents(principal: UsagePrincipal, scope: UsageScope, input: {
    period?: string;
    cursor?: { recordedAt: string; id: string } | null;
    limit?: number;
  } = {}): Promise<{
    period: string;
    events: PublicUsageEvent[];
    nextCursor: { recordedAt: string; id: string } | null;
  }> {
    assertPrincipal(principal, scope, "operator");
    await this.assertProject(principal, scope);
    const list = this.dependencies.repository.listEvents?.bind(this.dependencies.repository);
    // Ein Port ohne Export ist kein Fehler des Aufrufers, aber auch keine
    // leere Liste: Eine leere Antwort hiesse „nichts da", und das waere falsch.
    if (!list) throw new UsageError("USAGE_METERING_DISABLED");

    const window = parsePeriod(input.period, this.now());
    const limit = input.limit ?? 500;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new UsageError("USAGE_INVALID_INPUT");
    }
    // Der Cursor wird nicht umgerechnet, sondern durchgereicht. Jede Umrechnung
    // ueber `Date` kostet die Mikrosekunden von `recorded_at`, und ein
    // abgeschnittener Cursor liefert die letzte Zeile einer Seite noch einmal.
    let after: { recordedAt: string; id: string } | null = null;
    if (input.cursor) {
      if (!CURSOR_MARK.test(input.cursor.recordedAt) || !IDENTIFIER.test(input.cursor.id)) {
        throw new UsageError("USAGE_INVALID_INPUT");
      }
      after = { recordedAt: input.cursor.recordedAt, id: input.cursor.id };
    }

    const records = await list(principal, scope, {
      windowStart: window.start, windowEnd: window.end, after, limit,
    });
    const last = records.at(-1);
    return {
      period: period(window.start),
      events: records.map(publicEvent),
      // Nur wenn die Seite voll war. Eine halbe Seite ist das Ende, und ein
      // Cursor darauf brächte den Aufrufer zu einer überflüssigen Runde.
      nextCursor: last && records.length === limit
        ? { recordedAt: last.recordedAtText, id: last.id }
        : null,
    };
  }

  async setQuota(principal: UsagePrincipal, scope: UsageScope, input: {
    metric: UsageMetric;
    limit: number | string | bigint;
    mode: UsageQuotaMode;
    expectedRevision: number | null;
  }) {
    assertPrincipal(principal, scope, "operator");
    await this.assertProject(principal, scope);
    if (!METRICS.has(input.metric) || !["observe", "enforce"].includes(input.mode) ||
        // Ein Modus, der bei dieser Metrik nicht wirken kann, wird nicht
        // angenommen. Sonst stünde in der Datenbank eine Zusage, die der
        // Betrieb stillschweigend nicht einhält.
        (input.mode === "enforce" && UNENFORCEABLE_USAGE_METRICS.has(input.metric)) ||
        (input.expectedRevision !== null && (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1))) {
      throw new UsageError("USAGE_INVALID_INPUT");
    }
    const now = this.now();
    try {
      const policy = await this.dependencies.repository.setPolicy(principal, {
        ...scope,
        metric: input.metric,
        limit: positiveBigInt(input.limit, MAX_LIMIT),
        mode: input.mode,
        updatedBy: principal.subject,
      }, input.expectedRevision, now);
      return {
        projectId: policy.projectId,
        environment: policy.environment,
        metric: policy.metric,
        limit: policy.limit.toString(),
        mode: policy.mode,
        revision: policy.revision,
        updatedAt: policy.updatedAt.toISOString(),
      };
    } catch (error) { throw mapError(error); }
  }

  private async assertProject(principal: UsagePrincipal, scope: UsageScope) {
    if (!this.dependencies.controlPlane) return;
    try {
      await this.dependencies.controlPlane.getProjectEnvironment({
        organizationId: scope.organizationId,
        actor: { id: principal.subject, ref: principal.actorRef, type: principal.role === "reader" ? "user" : "system" },
      }, scope.projectId, scope.environment);
    } catch { throw new UsageError("USAGE_RESOURCE_NOT_FOUND"); }
  }
}

function assertPrincipal(
  principal: UsagePrincipal,
  scope: UsageScope,
  roles: UsagePrincipal["role"] | UsagePrincipal["role"][],
) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (principal.organizationId !== scope.organizationId || !allowed.includes(principal.role) ||
      !IDENTIFIER.test(scope.projectId) || !["development", "staging", "production"].includes(scope.environment) ||
      !SUBJECT.test(principal.actorRef) || !SUBJECT.test(principal.subject)) {
    throw new UsageError("USAGE_ACCESS_DENIED");
  }
}

function positiveBigInt(value: number | string | bigint, max: bigint) {
  let parsed: bigint;
  try {
    if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error();
    if (typeof value === "string" && !/^[1-9][0-9]{0,15}$/.test(value)) throw new Error();
    parsed = BigInt(value);
  } catch { throw new UsageError("USAGE_INVALID_INPUT"); }
  if (parsed < 1n || parsed > max) throw new UsageError("USAGE_INVALID_INPUT");
  return parsed;
}

export function parsePeriod(value: string | undefined, now: Date) {
  if (!value) return monthWindow(now);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new UsageError("USAGE_INVALID_INPUT");
  const start = new Date(`${value}-01T00:00:00.000Z`);
  const current = monthWindow(now).start;
  const oldest = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 23, 1));
  if (start > current || start < oldest) throw new UsageError("USAGE_INVALID_INPUT");
  return monthWindow(start);
}

/**
 * Das Fenster einer Reihe: es endet mit dem Ende des laufenden Eimers und
 * reicht so viele Eimer zurueck, wie die Groesse erlaubt.
 *
 * Gerechnet wird in UTC-Millisekunden. Stunde und Tag haben dort eine feste
 * Laenge; eine Zeitzone mit Sommerzeit haette sie nicht, und dann waere ein
 * „Tag" mal 23 und mal 25 Eimerbreiten lang.
 */
export function seriesWindow(bucket: UsageSeriesBucket, now: Date) {
  const size = USAGE_SERIES_BUCKETS[bucket];
  const step = size.seconds * 1000;
  const end = new Date(Math.floor(now.getTime() / step) * step + step);
  return { start: new Date(end.getTime() - size.maxBuckets * step), end };
}

function monthWindow(value: Date) {
  const start = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
  const end = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1));
  return { start, end };
}

function publicDecision(decision: Awaited<ReturnType<UsageRepository["consume"]>>): PublicUsageDecision {
  const limit = decision.limitAtDecision;
  return {
    accepted: decision.accepted,
    deduplicated: decision.deduplicated,
    metric: decision.metric,
    quantity: decision.quantity.toString(),
    used: decision.resultingQuantity.toString(),
    limit: limit?.toString() ?? null,
    remaining: limit === null ? null : maxBigInt(limit - decision.resultingQuantity, 0n).toString(),
    mode: decision.modeAtDecision,
    status: usageStatus(decision.resultingQuantity, limit),
    rejectionCode: decision.rejectionCode,
    period: period(decision.windowStart),
    windowStart: decision.windowStart.toISOString(),
    windowEnd: decision.windowEnd.toISOString(),
  };
}

function publicEvent(record: UsageDecisionRecord): PublicUsageEvent {
  return {
    id: record.id,
    metric: record.metric,
    source: record.source,
    quantity: record.quantity.toString(),
    observedAt: record.observedAt.toISOString(),
    period: period(record.windowStart),
    accepted: record.accepted,
    rejectionCode: record.rejectionCode,
    resultingQuantity: record.resultingQuantity.toString(),
    limitAtDecision: record.limitAtDecision?.toString() ?? null,
    modeAtDecision: record.modeAtDecision,
    quotaRevision: record.quotaRevision,
    recordedAt: record.recordedAt.toISOString(),
  };
}

function usageStatus(used: bigint, limit: bigint | null): UsageStatus {
  if (limit === null) return "unlimited";
  if (used > limit) return "exceeded";
  if (used === limit) return "exhausted";
  if (used * 100n >= limit * 80n) return "warning";
  return "ok";
}
export function period(start: Date) { return start.toISOString().slice(0, 7); }
function maxBigInt(left: bigint, right: bigint) { return left > right ? left : right; }
function hash(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function mapError(error: unknown) {
  if (error instanceof UsageError) return error;
  if (error instanceof UsageRepositoryConflictError) return new UsageError(error.code);
  return error;
}
