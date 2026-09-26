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
 * Metriken, für die ein hartes Limit nichts verhindern könnte.
 *
 * Es gibt zwei verschiedene Gründe dafür, und beide führen zum selben Schluss:
 *
 * **Nachträglich.** Wie viele Zeilen eine Abfrage liefert, weiss man nach der
 * Abfrage; wie viele Bytes eine Freigabe umfasst, nach dem Auflösen des
 * Objekts. Es gibt keinen Moment, in dem man mit dieser Zahl noch ablehnen
 * könnte.
 *
 * **Gebündelt.** `realtime_messages` wird gesammelt geschrieben, weil eine
 * Buchung je Nachricht den Realtime-Pfad ruinieren würde. Man kann keine
 * Nachricht ablehnen, die längst in einem offenen Stapel gezählt ist.
 *
 * In beiden Fällen könnte `enforce` nur noch aufhören zu zählen — und ein
 * Zähler, der stehen bleibt, während die Nutzung weiterläuft, ist schlimmer als
 * gar keiner. Deshalb wird der Modus für diese Metriken gar nicht erst
 * angenommen: Was nicht wirken kann, darf nicht setzbar sein.
 */
export const UNENFORCEABLE_USAGE_METRICS: ReadonlySet<UsageMetric> = new Set<UsageMetric>([
  "database_row_reads",
  "storage_egress_bytes",
  "realtime_messages",
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

/**
 * Die zwei erlaubten Eimergroessen einer Zeitreihe (2.45) und das Fenster,
 * das zu jeder gehoert.
 *
 * Das Fenster haengt an der Eimergroesse und nicht am Aufruf: Wer die Groesse
 * waehlt, waehlt damit auch, wie weit zurueck gelesen wird. Sonst koennte ein
 * Aufruf 90 Tage in Stundeneimer schneiden und der Datenbank 2160 Gruppen
 * abverlangen, nur weil zwei Zahlen frei kombinierbar waren.
 */
export const USAGE_SERIES_BUCKETS = {
  hour: { seconds: 3600, maxBuckets: 48 },
  day: { seconds: 86_400, maxBuckets: 90 },
} as const;

export type UsageSeriesBucket = keyof typeof USAGE_SERIES_BUCKETS;

/** Eine Gruppe, wie die Datenbank sie liefert: nur Eimer mit Ereignissen. */
export type UsageSeriesRecord = {
  bucketStart: Date;
  acceptedQuantity: bigint;
  rejectedQuantity: bigint;
  events: number;
};

/**
 * Die Reihe, wie die Console sie sieht: **jeder** Eimer des Fensters, auch
 * die leeren. Mengen bleiben Dezimalstrings, damit JavaScript nichts
 * abschneidet.
 */
export type PublicUsageSeries = {
  metric: UsageMetric;
  label: string;
  unit: UsageUnit;
  bucket: UsageSeriesBucket;
  windowStart: string;
  windowEnd: string;
  bucketCount: number;
  /** Die Aggregation lief in die Zeilengrenze; die Reihe ist unvollstaendig. */
  truncated: boolean;
  buckets: Array<{ start: string; accepted: string; rejected: string; events: number }>;
  totals: { accepted: string; rejected: string; events: number };
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

/**
 * Ein Ereignis, wie es ein Archiv sieht: die Entscheidung, nicht ihre Herkunft.
 *
 * Ohne Verifier und ohne Rohschlüssel — beide tragen für einen Abgleich nichts
 * bei. Mengen sind Dezimalstrings, damit JavaScript nichts abschneidet.
 */
export type PublicUsageEvent = {
  id: string;
  metric: UsageMetric;
  source: UsageSource;
  quantity: string;
  observedAt: string;
  period: string;
  accepted: boolean;
  rejectionCode: "QUOTA_EXCEEDED" | null;
  resultingQuantity: string;
  limitAtDecision: string | null;
  modeAtDecision: UsageDecisionMode;
  quotaRevision: number | null;
  recordedAt: string;
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
