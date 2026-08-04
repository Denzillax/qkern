import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlQueryable, SqlValue } from "@/lib/server/db/sql";
import type {
  UsageDecisionMode,
  UsageDecisionRecord,
  UsageEventInput,
  UsageMetric,
  UsagePrincipal,
  UsageQuotaMode,
  UsageQuotaPolicy,
  UsageScope,
  UsageSource,
  UsageWindowRecord,
} from "@/lib/server/usage/model";
import { USAGE_METRIC_DEFINITIONS } from "@/lib/server/usage/model";
import { UsageRepositoryConflictError, type UsageRepository } from "@/lib/server/usage/repository";

type UsageDatabase = Pick<PostgresControlPlane, "withTenant">;
type Row = Record<string, unknown>;

export class PostgresUsageRepository implements UsageRepository {
  readonly durability = "durable" as const;

  constructor(private readonly database: UsageDatabase) {}

  consume(principal: UsagePrincipal, event: UsageEventInput) {
    return this.withTenant(principal, false, async (database) => {
      await database.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `${event.organizationId}:${event.projectId}:${event.environment}:${event.eventKeyHash}`,
      ]);
      const existing = await database.query(`${EVENT_SELECT}
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND event_key_hash=$4
        LIMIT 1`, [...scopeValues(event), event.eventKeyHash]);
      if (existing.rows[0]) {
        const decision = eventFromRow(existing.rows[0]);
        if (decision.eventFingerprint !== event.eventFingerprint) {
          throw new UsageRepositoryConflictError("USAGE_IDEMPOTENCY_CONFLICT");
        }
        return { ...decision, deduplicated: true };
      }

      const policyResult = await database.query(`${POLICY_SELECT}
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND metric=$4
        FOR SHARE`, [...scopeValues(event), event.metric]);
      const policy = policyResult.rows[0] ? policyFromRow(policyResult.rows[0]) : null;
      await database.query(`INSERT INTO usage_counters
        (organization_id,project_id,environment,metric,window_start,window_end,quantity,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,0,$7)
        ON CONFLICT (organization_id,project_id,environment,metric,window_start) DO NOTHING`, [
        ...scopeValues(event), event.metric, event.windowStart, event.windowEnd, event.observedAt,
      ]);
      const counter = await database.query<{ quantity: unknown }>(`SELECT quantity
        FROM usage_counters
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND metric=$4 AND window_start=$5
        FOR UPDATE`, [...scopeValues(event), event.metric, event.windowStart]);
      const used = int8(counter.rows[0]?.quantity, "usage quantity");
      const proposed = used + event.quantity;
      const accepted = !policy || policy.mode === "observe" || proposed <= policy.limit;
      const resultingQuantity = accepted ? proposed : used;
      if (accepted) {
        await database.query(`UPDATE usage_counters SET quantity=$6,updated_at=GREATEST(updated_at,$7)
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND metric=$4 AND window_start=$5`, [
          ...scopeValues(event), event.metric, event.windowStart, resultingQuantity.toString(), event.observedAt,
        ]);
      }
      const inserted = await database.query(`INSERT INTO usage_events
        (id,organization_id,project_id,environment,metric,source,event_key_hash,event_fingerprint,
         quantity,observed_at,window_start,window_end,accepted,rejection_code,resulting_quantity,
         limit_at_decision,mode_at_decision,quota_revision)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        RETURNING ${EVENT_COLUMNS}`, [
        event.id, ...scopeValues(event), event.metric, event.source, event.eventKeyHash,
        event.eventFingerprint, event.quantity.toString(), event.observedAt, event.windowStart, event.windowEnd,
        accepted, accepted ? null : "QUOTA_EXCEEDED", resultingQuantity.toString(),
        policy?.limit.toString() ?? null, policy?.mode ?? "unlimited", policy?.revision ?? null,
      ]);
      return { ...eventFromRow(inserted.rows[0]), deduplicated: false };
    });
  }

  readWindow(
    principal: UsagePrincipal,
    scope: UsageScope,
    windowStart: Date,
    _windowEnd: Date,
  ) {
    return this.withTenant(principal, true, async (database) => {
      const [policies, counters] = await Promise.all([
        database.query(`${POLICY_SELECT}
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3`, scopeValues(scope)),
        database.query<{ metric: unknown; quantity: unknown }>(`SELECT metric,quantity FROM usage_counters
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND window_start=$4`, [
          ...scopeValues(scope), windowStart,
        ]),
      ]);
      const policyByMetric = new Map(policies.rows.map((row) => {
        const policy = policyFromRow(row);
        return [policy.metric, policy];
      }));
      const quantityByMetric = new Map(counters.rows.map((row) => [
        metric(row.metric), int8(row.quantity, "usage quantity"),
      ]));
      return (Object.keys(USAGE_METRIC_DEFINITIONS) as UsageMetric[]).map<UsageWindowRecord>((name) => ({
        metric: name,
        quantity: quantityByMetric.get(name) ?? 0n,
        policy: policyByMetric.get(name) ?? null,
      }));
    });
  }

  setPolicy(
    principal: UsagePrincipal,
    input: Omit<UsageQuotaPolicy, "revision" | "createdAt" | "updatedAt">,
    expectedRevision: number | null,
    now: Date,
  ) {
    return this.withTenant(principal, false, async (database, audit) => {
      const currentResult = await database.query(`${POLICY_SELECT}
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND metric=$4
        FOR UPDATE`, [...scopeValues(input), input.metric]);
      const current = currentResult.rows[0] ? policyFromRow(currentResult.rows[0]) : null;
      if ((current && current.revision !== expectedRevision) || (!current && expectedRevision !== null)) {
        throw new UsageRepositoryConflictError("USAGE_POLICY_CONFLICT");
      }
      let result;
      if (current) {
        result = await database.query(`UPDATE usage_quota_policies
          SET quota_limit=$5,mode=$6,revision=revision+1,updated_by=$7,updated_at=$8
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND metric=$4
          RETURNING ${POLICY_COLUMNS}`, [
          ...scopeValues(input), input.metric, input.limit.toString(), input.mode, input.updatedBy, now,
        ]);
      } else {
        try {
          result = await database.query(`INSERT INTO usage_quota_policies
            (organization_id,project_id,environment,metric,quota_limit,mode,revision,updated_by,created_at,updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$8)
            RETURNING ${POLICY_COLUMNS}`, [
            ...scopeValues(input), input.metric, input.limit.toString(), input.mode, input.updatedBy, now,
          ]);
        } catch (error) {
          if ((error as { code?: string }).code === "23505") {
            throw new UsageRepositoryConflictError("USAGE_POLICY_CONFLICT");
          }
          throw error;
        }
      }
      const policy = policyFromRow(result.rows[0]);
      await audit?.append({
        projectId: input.projectId,
        environment: input.environment,
        actorType: "system",
        actorRef: principal.actorRef,
        action: "usage.quota.updated",
        resourceRef: `${input.projectId}:${input.environment}:${input.metric}`,
        status: "success",
        metadata: { metric: input.metric, limit: input.limit.toString(), mode: input.mode, revision: policy.revision },
      });
      return policy;
    });
  }

  private withTenant<T>(
    principal: UsagePrincipal,
    readOnly: boolean,
    work: (database: SqlQueryable, audit?: { append(input: Record<string, unknown>): Promise<unknown> }) => Promise<T>,
  ): Promise<T> {
    return this.database.withTenant({
      organizationId: principal.organizationId,
      actorRef: principal.actorRef,
      readOnly,
    }, async (repositories) => work(repositories.transaction, repositories.audit as never));
  }
}

const POLICY_COLUMNS = "organization_id,project_id,environment,metric,quota_limit,mode,revision,updated_by,created_at,updated_at";
const POLICY_SELECT = `SELECT ${POLICY_COLUMNS} FROM usage_quota_policies`;
const EVENT_COLUMNS = `id,organization_id,project_id,environment,metric,source,event_key_hash,event_fingerprint,
  quantity,observed_at,window_start,window_end,accepted,rejection_code,resulting_quantity,
  limit_at_decision,mode_at_decision,quota_revision,recorded_at`;
const EVENT_SELECT = `SELECT ${EVENT_COLUMNS} FROM usage_events`;

function policyFromRow(row: Row): UsageQuotaPolicy {
  const mode = String(row.mode);
  if (mode !== "observe" && mode !== "enforce") throw new Error("Invalid usage quota mode");
  return {
    organizationId: String(row.organization_id),
    projectId: String(row.project_id),
    environment: environment(row.environment),
    metric: metric(row.metric),
    limit: int8(row.quota_limit, "quota limit"),
    mode,
    revision: positiveInteger(row.revision, "quota revision"),
    updatedBy: String(row.updated_by),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

function eventFromRow(row: Row): UsageDecisionRecord {
  const mode = String(row.mode_at_decision) as UsageDecisionMode;
  const source = String(row.source) as UsageSource;
  if (!["unlimited", "observe", "enforce"].includes(mode)) throw new Error("Invalid usage decision mode");
  if (!new Set(["control_plane", "data_plane", "generated_data_api", "project_auth", "project_storage",
    "realtime", "project_queues", "compute", "mcp"]).has(source)) throw new Error("Invalid usage source");
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    projectId: String(row.project_id),
    environment: environment(row.environment),
    metric: metric(row.metric),
    source,
    eventKeyHash: sha256(row.event_key_hash),
    eventFingerprint: sha256(row.event_fingerprint),
    quantity: int8(row.quantity, "event quantity"),
    observedAt: date(row.observed_at),
    windowStart: date(row.window_start),
    windowEnd: date(row.window_end),
    accepted: Boolean(row.accepted),
    rejectionCode: row.rejection_code === null ? null : "QUOTA_EXCEEDED",
    resultingQuantity: int8(row.resulting_quantity, "resulting quantity"),
    limitAtDecision: row.limit_at_decision === null ? null : int8(row.limit_at_decision, "decision limit"),
    modeAtDecision: mode,
    quotaRevision: row.quota_revision === null ? null : positiveInteger(row.quota_revision, "quota revision"),
    recordedAt: date(row.recorded_at),
    deduplicated: false,
  };
}

function scopeValues(scope: UsageScope): SqlValue[] {
  return [scope.organizationId, scope.projectId, scope.environment];
}
function date(value: unknown) {
  const parsed = value instanceof Date ? new Date(value) : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid usage timestamp");
  return parsed;
}
function int8(value: unknown, field: string) {
  const text = String(value);
  if (!/^(0|[1-9][0-9]{0,18})$/.test(text)) throw new Error(`Invalid ${field}`);
  const parsed = BigInt(text);
  if (parsed > 9_223_372_036_854_775_807n) throw new Error(`Invalid ${field}`);
  return parsed;
}
function positiveInteger(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Invalid ${field}`);
  return parsed;
}
function metric(value: unknown): UsageMetric {
  const name = String(value) as UsageMetric;
  if (!(name in USAGE_METRIC_DEFINITIONS)) throw new Error("Invalid usage metric");
  return name;
}
function environment(value: unknown): UsageScope["environment"] {
  if (value !== "development" && value !== "staging" && value !== "production") {
    throw new Error("Invalid usage environment");
  }
  return value;
}
function sha256(value: unknown) {
  const text = String(value);
  if (!/^[0-9a-f]{64}$/.test(text)) throw new Error("Invalid usage verifier");
  return text;
}
