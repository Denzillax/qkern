import type { Environment } from "@/lib/types";

export type ProjectQueueScope = {
  organizationId: string;
  projectId: string;
  environment: Environment;
};

export type ProjectQueueRole = "admin" | "authenticated" | "anon" | "service_role";

export type ProjectQueuePrincipal = {
  organizationId: string;
  actorRef: string;
  role: ProjectQueueRole;
  subject: string;
};

export type ProjectQueueJson = null | boolean | number | string | ProjectQueueJson[] | {
  [key: string]: ProjectQueueJson;
};

export type ProjectQueueEnqueuePolicy = "authenticated" | "service";

export type ProjectQueue = ProjectQueueScope & {
  id: string;
  name: string;
  enqueuePolicy: ProjectQueueEnqueuePolicy;
  maxAttempts: number;
  visibilityTimeoutSeconds: number;
  retryBaseSeconds: number;
  retryMaxSeconds: number;
  dedupeWindowSeconds: number;
  retentionSeconds: number;
  maxPendingMessages: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ProjectQueueMessageStatus = "available" | "in_flight" | "completed" | "dead_lettered";
export type ProjectQueueFailureCode =
  | "HANDLER_ERROR"
  | "HANDLER_TIMEOUT"
  | "DEPENDENCY_UNAVAILABLE"
  | "INVALID_PAYLOAD"
  | "LEASE_EXPIRED";

export type ProjectQueueMessage = ProjectQueueScope & {
  id: string;
  queueId: string;
  payload: ProjectQueueJson;
  status: ProjectQueueMessageStatus;
  ownerSubject: string;
  dedupeKeyHash: string | null;
  attemptCount: number;
  availableAt: Date;
  leaseWorkerId: string | null;
  leaseTokenHash: string | null;
  leaseSequence: number;
  leaseExpiresAt: Date | null;
  lastFailureCode: ProjectQueueFailureCode | null;
  createdAt: Date;
  completedAt: Date | null;
  deadLetteredAt: Date | null;
  replayedFromMessageId: string | null;
};

export type ProjectQueueDeadLetter = {
  id: string;
  queue: string;
  attempt: number;
  failureCode: ProjectQueueFailureCode;
  createdAt: string;
  deadLetteredAt: string;
  replayed: boolean;
};

export type PublicProjectQueue = Omit<ProjectQueue,
  "organizationId" | "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };

export type ProjectQueueEnqueueReceipt = {
  id: string;
  queue: string;
  status: ProjectQueueMessageStatus;
  availableAt: string;
  deduplicated: boolean;
};

export type ProjectQueueClaim = {
  id: string;
  queue: string;
  payload: ProjectQueueJson;
  attempt: number;
  leaseSequence: number;
  leaseToken: string;
  leaseExpiresAt: string;
  createdAt: string;
  /**
   * Der Anschluss an die Spur dieser Nachricht, in W3C-Kopfzeilenform (2.124).
   *
   * `null`, wenn die Nachricht ohne `traceparent` eingereiht wurde. QKERN
   * erfindet dann keine Spur-Id; die Begruendung steht in Migration 0082. Der
   * Eltern-Span ist die `claimed`-Station dieses Claims und nicht der Span des
   * Einreichers, siehe `projectQueueClaimTraceparent`.
   *
   * Hier steht nie ein Geheimnis: Spur-Id und Span-Id sind beide oeffentlich
   * lesbare Beobachtungswerte, und ein Lease-Token oder Dedupe-Verifikator kommt
   * hier auch nicht versehentlich mit hinein, weil der Wert aus genau zwei
   * Hexfeldern gebaut wird.
   */
  traceparent: string | null;
};

export type ProjectQueueStatus = {
  queue: string;
  available: number;
  scheduled: number;
  inFlight: number;
  completed: number;
  deadLettered: number;
  oldestAvailableAt: string | null;
};

export function publicProjectQueue(queue: ProjectQueue): PublicProjectQueue {
  const { organizationId: _organizationId, ...visible } = queue;
  return { ...visible, createdAt: queue.createdAt.toISOString(), updatedAt: queue.updatedAt.toISOString() };
}

export function sameProjectQueueScope(left: ProjectQueueScope, right: ProjectQueueScope) {
  return left.organizationId === right.organizationId && left.projectId === right.projectId &&
    left.environment === right.environment;
}
