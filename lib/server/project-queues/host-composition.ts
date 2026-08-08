import { randomUUID } from "node:crypto";
import { createFunctionInvocationServiceFromEnv } from "@/lib/server/compute/definitions-runtime";
import { ConfigurationError } from "@/lib/server/db/errors";
import { ProjectQueueFunctionDispatch } from "@/lib/server/project-queues/function-dispatch";
import {
  ProjectQueueHostRuntime,
  type ProjectQueueBinding,
  type ProjectQueueHostEntry,
} from "@/lib/server/project-queues/host-runtime";
import { createProjectQueueServiceFromEnv } from "@/lib/server/project-queues/runtime";
import type { RuntimeProbeObserver } from "@/lib/server/operations/runtime-probe";
import type { Environment } from "@/lib/types";

const NAME = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;

/**
 * Baut den Queue-Wirt aus der Umgebung.
 *
 * `ProjectQueueWorker` gibt es seit Alpha 1, und bis Release 1.42 hat ihn kein
 * Prozess je gestartet: Nachrichten liessen sich einreihen, aber nichts
 * verarbeitete sie. Gefunden hat das nicht Handarbeit, sondern der
 * Erreichbarkeitsvertrag — der Worker war das einzige Modul in `lib/server`,
 * das kein Prozesseinstieg erreicht.
 */
export function createProjectQueueHostFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: { probe?: RuntimeProbeObserver } = {},
) {
  if (env.QKERN_QUEUE_WORKER_ENABLED !== "true") {
    throw new ConfigurationError("Set QKERN_QUEUE_WORKER_ENABLED=true explicitly.");
  }
  // Alles, was ohne Datenbank pruefbar ist, steht vor dem ersten Pool: Sonst
  // scheitert eine fehlerhafte Bindung an der Verbindung statt an sich selbst.
  const bindings = queueBindingsFromEnv(env);
  if (bindings.length === 0) {
    throw new ConfigurationError("QKERN_QUEUE_WORKER_BINDINGS_JSON must name at least one binding.");
  }

  const service = createProjectQueueServiceFromEnv(env);
  const functions = createFunctionInvocationServiceFromEnv(env);
  const instance = `queue-host:${randomUUID()}`;

  const entries: ProjectQueueHostEntry[] = bindings.map((binding, index) => {
    // Ein Principal je Bindung, an genau ihren Scope gebunden. Ein geteilter
    // Principal ueber mehrere Organisationen waere die Grenze, die RLS traegt,
    // von aussen wieder aufgeweicht.
    const principal = {
      organizationId: binding.organizationId,
      actorRef: `system:${instance}`,
      role: "service_role" as const,
      subject: instance,
    };
    return {
      binding,
      principal,
      workerId: `${instance}:${index}`,
      handler: new ProjectQueueFunctionDispatch({
        functions,
        principal,
        scope: {
          organizationId: binding.organizationId,
          projectId: binding.projectId,
          environment: binding.environment,
        },
        functionName: binding.functionName,
      }),
    };
  });

  return {
    bindings,
    runtime: new ProjectQueueHostRuntime({
      service,
      entries,
      idleDelayMs: integer(env.QKERN_QUEUE_WORKER_IDLE_MS, 1_000, 10, 60_000),
      errorDelayMs: integer(env.QKERN_QUEUE_WORKER_ERROR_MS, 2_000, 10, 60_000),
      probe: dependencies.probe,
    }),
  };
}

/**
 * Liest die Bindungen. Eine unlesbare Liste ist ein Konfigurationsfehler und
 * wird nicht stillschweigend zu "keine Bindungen": Sonst laeuft der Prozess
 * weiter und verarbeitet nie etwas — genau der Zustand, den dieses Release
 * beendet.
 */
export function queueBindingsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): ProjectQueueBinding[] {
  const raw = env.QKERN_QUEUE_WORKER_BINDINGS_JSON?.trim();
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new ConfigurationError("QKERN_QUEUE_WORKER_BINDINGS_JSON must be valid JSON."); }
  if (!Array.isArray(parsed) || parsed.length > 100) {
    throw new ConfigurationError(
      "QKERN_QUEUE_WORKER_BINDINGS_JSON must be an array of at most 100 bindings.",
    );
  }
  const seen = new Set<string>();
  return parsed.map((entry) => {
    const value = entry as Partial<ProjectQueueBinding>;
    if (typeof value.organizationId !== "string" || typeof value.projectId !== "string" ||
        !["development", "staging", "production"].includes(String(value.environment)) ||
        typeof value.queue !== "string" || !NAME.test(value.queue) ||
        typeof value.functionName !== "string" || !NAME.test(value.functionName)) {
      throw new ConfigurationError(
        "QKERN_QUEUE_WORKER_BINDINGS_JSON entries need organizationId, projectId, environment, queue and functionName.",
      );
    }
    // Zwei Worker desselben Prozesses auf derselben Queue waeren kein Fehler
    // der Queue — die Lease traegt das —, aber immer ein Fehler der
    // Konfiguration: Gemeint war fast sicher etwas anderes.
    const key = `${value.organizationId}/${value.projectId}/${value.environment}/${value.queue}`;
    if (seen.has(key)) {
      throw new ConfigurationError("QKERN_QUEUE_WORKER_BINDINGS_JSON binds one queue twice.");
    }
    seen.add(key);
    return {
      organizationId: value.organizationId,
      projectId: value.projectId,
      environment: value.environment as Environment,
      queue: value.queue,
      functionName: value.functionName,
    };
  });
}

function integer(raw: string | undefined, fallback: number, minimum: number, maximum: number) {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ConfigurationError(`Queue host interval must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}
