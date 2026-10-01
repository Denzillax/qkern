import type { ProjectQueueJson, ProjectQueueScope } from "@/lib/server/project-queues/model";
import type { ProjectQueueTraceAnchor } from "@/lib/server/project-queues/trace";

export type ComputeScope = ProjectQueueScope;

export type FunctionDefinition = ComputeScope & Readonly<{
  id: string;
  name: string;
  runtime: "nodejs24";
  image: string;
  entrypoint: string;
  timeoutMs: number;
  memoryMiB: number;
  maxConcurrency: number;
  egressOrigins: readonly string[];
  secretRefs: readonly string[];
}>;

export type FunctionInvocation = Readonly<{
  id: string;
  functionId: string;
  payload: ProjectQueueJson;
  requestedAt: string;
}>;

export type FunctionInvocationResult = Readonly<{
  statusCode: number;
  headers: Readonly<Record<string, string>>;
  body: ProjectQueueJson;
}>;

export type WebhookDefinition = ComputeScope & Readonly<{
  id: string;
  name: string;
  url: string;
  eventTypes: readonly string[];
  signingSecretRef: string;
  timeoutMs: number;
}>;

export type WebhookDelivery = Readonly<{
  id: string;
  webhookId: string;
  eventType: string;
  occurredAt: string;
  payload: ProjectQueueJson;
  /**
   * Der Anschluss an die Spur, die diese Zustellung ausgeloest hat (2.125).
   *
   * Fehlt er, geht keine Kopfzeile `traceparent` hinaus. Das ist die Haelfte der
   * Entscheidung aus Migration 0082: QKERN erfindet keine Spur-Id, auch nicht
   * hier. Eine erfundene waere draussen eine Spur mit einem Teilnehmer.
   */
  trace?: ProjectQueueTraceAnchor | null;
}>;

export type CronDefinition = ComputeScope & Readonly<{
  id: string;
  name: string;
  expression: string;
  queue: string;
  payload: ProjectQueueJson;
  enabled: boolean;
  /** IANA-Zeitzone des Zeitplans (2.66). Fehlt sie, rechnet der Plan in UTC. */
  timeZone?: string;
}>;
