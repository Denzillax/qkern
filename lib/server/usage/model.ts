import type { Environment } from "@/lib/types";

export const USAGE_METRIC_DEFINITIONS = {
  api_requests: { label: "API requests", unit: "operations" },
  database_row_reads: { label: "Database row reads", unit: "rows" },
  storage_egress_bytes: { label: "Storage egress", unit: "bytes" },
  realtime_messages: { label: "Realtime messages", unit: "operations" },
  queue_operations: { label: "Queue operations", unit: "operations" },
  function_invocations: { label: "Function invocations", unit: "operations" },
} as const;

export type UsageMetric = keyof typeof USAGE_METRIC_DEFINITIONS;

/**
 * Metriken, deren Menge erst feststeht, **wenn die Arbeit getan ist**.
 *
 * Wie viele Zeilen eine Abfrage liefert, weiss man nach der Abfrage; wie viele
 * Bytes eine Freigabe umfasst, nach dem Auflösen des Objekts. Ein hartes Limit
 * kann dort nichts mehr verhindern — es könnte nur noch aufhören zu zählen, und
 * ein Zähler, der stehen bleibt, während die Nutzung weiterläuft, ist schlimmer
 * als gar keiner.
 *
 * Deshalb wird `enforce` für diese Metriken gar nicht erst angenommen. Ein
 * Modus, der nicht wirken kann, darf nicht setzbar sein.
 */
export const POST_HOC_USAGE_METRICS: ReadonlySet<UsageMetric> = new Set<UsageMetric>([
  "database_row_reads",
  "storage_egress_bytes",
]);
export type UsageUnit = (typeof USAGE_METRIC_DEFINITIONS)[UsageMetric]["unit"];
export type UsageSource =
  | "control_plane"
  | "data_plane"
  | "generated_data_api"
  | "project_auth"
  | "project_storage"
  | "realtime"
  | "project_queues"
  | "compute"
  | "mcp";
export type UsageQuotaMode = "observe" | "enforce";
export type UsageDecisionMode = UsageQuotaMode | "unlimited";
export type UsageStatus = "unlimited" | "ok" | "warning" | "exhausted" | "exceeded";

export type UsageScope = {
  organizationId: string;
  projectId: string;
  environment: Environment;
};

export type UsagePrincipal = {
  organizationId: string;
  actorRef: string;
  subject: string;
  role: "reader" | "meter" | "operator";
};

export type UsageQuotaPolicy = UsageScope & {
  metric: UsageMetric;
  limit: bigint;
  mode: UsageQuotaMode;
  revision: number;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type UsageEventInput = UsageScope & {
  id: string;
  metric: UsageMetric;
  source: UsageSource;
  eventKeyHash: string;
  eventFingerprint: string;
  quantity: bigint;
  observedAt: Date;
  windowStart: Date;
  windowEnd: Date;
};

export type UsageDecisionRecord = UsageEventInput & {
  accepted: boolean;
  rejectionCode: "QUOTA_EXCEEDED" | null;
  resultingQuantity: bigint;
  limitAtDecision: bigint | null;
  modeAtDecision: UsageDecisionMode;
  quotaRevision: number | null;
  recordedAt: Date;
  deduplicated: boolean;
};

export type UsageWindowRecord = {
  metric: UsageMetric;
  quantity: bigint;
  policy: UsageQuotaPolicy | null;
};

export type PublicUsageDecision = {
  accepted: boolean;
  deduplicated: boolean;
  metric: UsageMetric;
  quantity: string;
  used: string;
  limit: string | null;
  remaining: string | null;
  mode: UsageDecisionMode;
  status: UsageStatus;
  rejectionCode: "QUOTA_EXCEEDED" | null;
  period: string;
  windowStart: string;
  windowEnd: string;
};

export type PublicUsageProjection = {
  projectId: string;
  environment: Environment;
  period: string;
  windowStart: string;
  windowEnd: string;
  metrics: Array<{
    metric: UsageMetric;
    label: string;
    unit: UsageUnit;
    used: string;
    limit: string | null;
    remaining: string | null;
    mode: UsageDecisionMode;
    status: UsageStatus;
    revision: number | null;
  }>;
};

export function sameUsageScope(left: UsageScope, right: UsageScope) {
  return left.organizationId === right.organizationId && left.projectId === right.projectId &&
    left.environment === right.environment;
}
