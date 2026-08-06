import { createHash, randomUUID } from "node:crypto";
import type { ControlPlaneService } from "@/lib/server/control-plane/model";
import type { SqlQueryable } from "@/lib/server/db/sql";
import {
  UNENFORCEABLE_USAGE_METRICS,
  USAGE_METRIC_DEFINITIONS,
  type PublicUsageDecision,
  type PublicUsageProjection,
  type UsageDecisionMode,
  type UsageMetric,
  type UsagePrincipal,
  type UsageQuotaMode,
  type UsageScope,
  type UsageSource,
  type UsageStatus,
} from "@/lib/server/usage/model";
import { UsageRepositoryConflictError, type UsageRepository } from "@/lib/server/usage/repository";

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

function parsePeriod(value: string | undefined, now: Date) {
  if (!value) return monthWindow(now);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new UsageError("USAGE_INVALID_INPUT");
  const start = new Date(`${value}-01T00:00:00.000Z`);
  const current = monthWindow(now).start;
  const oldest = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 23, 1));
  if (start > current || start < oldest) throw new UsageError("USAGE_INVALID_INPUT");
  return monthWindow(start);
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

function usageStatus(used: bigint, limit: bigint | null): UsageStatus {
  if (limit === null) return "unlimited";
  if (used > limit) return "exceeded";
  if (used === limit) return "exhausted";
  if (used * 100n >= limit * 80n) return "warning";
  return "ok";
}
function period(start: Date) { return start.toISOString().slice(0, 7); }
function maxBigInt(left: bigint, right: bigint) { return left > right ? left : right; }
function hash(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function mapError(error: unknown) {
  if (error instanceof UsageError) return error;
  if (error instanceof UsageRepositoryConflictError) return new UsageError(error.code);
  return error;
}
