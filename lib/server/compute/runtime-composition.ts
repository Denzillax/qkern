import { ConfigurationError } from "@/lib/server/db/errors";
import { getPostgresPool } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { CronDispatcher } from "@/lib/server/compute/cron";
import { PostgresCronRepository } from "@/lib/server/compute/cron-postgres-repository";
import { CronScheduler } from "@/lib/server/compute/cron-scheduler";
import { WebhookDeliveryRuntime } from "@/lib/server/compute/webhook-delivery-runtime";
import { WebhookOutbox } from "@/lib/server/compute/webhook-outbox";
import { PostgresWebhookOutboxRepository } from "@/lib/server/compute/webhook-postgres-repository";
import { EnvWebhookSecretProvider, HmacWebhookSigner } from "@/lib/server/compute/webhook-signer";
import { FetchWebhookTransport } from "@/lib/server/compute/webhook-transport";
import { WebhookDeliverer, type WebhookSignerPort, type WebhookTransportPort } from
  "@/lib/server/compute/webhooks";
import { createProjectQueueServiceFromEnv } from "@/lib/server/project-queues/runtime";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";
import type { Environment } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENVIRONMENTS = new Set<Environment>(["development", "staging", "production"]);
const MAX_SCOPES = 32;

export type ComputeScopeConfig = Readonly<{
  organizationId: string;
  projectId: string;
  environment: Environment;
}>;

export type ComputeRuntimeDependencies = {
  signer?: WebhookSignerPort;
  transport?: WebhookTransportPort;
  /** Ersetzt den Standardtakt in Tests. */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Welche Projekte dieser Prozess bedient.
 *
 * **Bewusst ausdrücklich statt entdeckt.** Die Runtime-Rolle sieht durch RLS nur
 * die eigene Organisation; eine organisationsübergreifende Suche nach fälliger
 * Arbeit ginge nur mit einer Rolle, die alles sieht. Diese Rolle für einen
 * Dauerprozess einzuführen wäre eine größere Entscheidung als dieser Schnitt
 * trägt. Bis dahin trägt der Betreiber die Liste ein.
 */
export function computeScopesFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ComputeScopeConfig[] {
  const raw = env.QKERN_COMPUTE_SCOPES_JSON?.trim();
  if (!raw) throw new ConfigurationError("QKERN_COMPUTE_SCOPES_JSON is required.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigurationError("QKERN_COMPUTE_SCOPES_JSON must be valid JSON.");
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_SCOPES) {
    throw new ConfigurationError(`QKERN_COMPUTE_SCOPES_JSON must list 1 to ${MAX_SCOPES} scopes.`);
  }

  const seen = new Set<string>();
  return parsed.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ConfigurationError("QKERN_COMPUTE_SCOPES_JSON contains an invalid scope.");
    }
    const { organizationId, projectId, environment } = entry as Record<string, unknown>;
    if (typeof organizationId !== "string" || !UUID.test(organizationId) ||
        typeof projectId !== "string" || !UUID.test(projectId) ||
        typeof environment !== "string" || !ENVIRONMENTS.has(environment as Environment)) {
      throw new ConfigurationError("QKERN_COMPUTE_SCOPES_JSON contains an invalid scope.");
    }
    const key = `${organizationId}:${projectId}:${environment}`;
    if (seen.has(key)) throw new ConfigurationError("QKERN_COMPUTE_SCOPES_JSON contains a duplicate scope.");
    seen.add(key);
    return Object.freeze({
      organizationId, projectId, environment: environment as Environment,
    });
  });
}

export type ComputeRuntime = {
  run(signal: AbortSignal): Promise<void>;
  readonly scopes: readonly ComputeScopeConfig[];
};

/**
 * Der Prozess, der Cron und Webhook-Zustellung tatsächlich betreibt.
 *
 * Bis Release 1.19 waren beide Bibliotheken: Ein fälliges Cron-Vorkommen wurde
 * nie ausgelöst und eine hinterlegte Zustellung nie gesendet, weil niemand sie
 * aufrief. Dasselbe Muster hatte dieser Sprint schon beim Realtime-Poller und
 * beim dauerhaften Event-Log gefunden.
 */
export function createComputeRuntimeFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: ComputeRuntimeDependencies = {},
): ComputeRuntime {
  if (env.QKERN_COMPUTE_RUNTIME_ENABLED !== "true") {
    throw new ConfigurationError("Set QKERN_COMPUTE_RUNTIME_ENABLED=true explicitly.");
  }
  if (runtimeModeFromEnv(env) !== "postgres") {
    throw new ConfigurationError("The compute runtime requires the PostgreSQL runtime mode.");
  }

  // Alle Pruefungen, die ohne Datenbank auskommen, stehen vor dem ersten Pool.
  // Sonst scheitert eine fehlerhafte Konfiguration an der Verbindung statt an
  // ihrem eigentlichen Fehler, und die Meldung zeigt in die falsche Richtung.
  const cronEnabled = env.QKERN_COMPUTE_CRON_ENABLED !== "false";
  const webhooksEnabled = env.QKERN_COMPUTE_WEBHOOKS_ENABLED !== "false";
  if (!cronEnabled && !webhooksEnabled) {
    throw new ConfigurationError("The compute runtime would do nothing with both loops disabled.");
  }
  const scopes = computeScopesFromEnv(env);
  const workerId = workerIdentity(env);
  const cronIntervalMs = integer(env.QKERN_COMPUTE_CRON_INTERVAL_MS, 30_000, 1_000, 900_000);
  const cronMaxCatchUp = integer(env.QKERN_COMPUTE_CRON_MAX_CATCH_UP, 5, 1, 100);
  const webhookBatch = integer(env.QKERN_COMPUTE_WEBHOOK_BATCH, 5, 1, 10);
  const webhookIdleMs = integer(env.QKERN_COMPUTE_WEBHOOK_IDLE_MS, 1_000, 50, 60_000);
  const visibilityMs = integer(env.QKERN_COMPUTE_WEBHOOK_VISIBILITY_MS, 30_000, 1_000, 900_000);

  const controlPlane = new PostgresControlPlane(getPostgresPool(env));

  const scheduler = cronEnabled ? new CronScheduler({
    repository: new PostgresCronRepository(controlPlane),
    dispatcher: new CronDispatcher(createProjectQueueServiceFromEnv(env)),
    maxCatchUp: cronMaxCatchUp,
    // Redigiert: der Fehler kann eine Datenbankmeldung oder einen Queue-Namen
    // tragen und gehoert nicht ins Log dieses Prozesses.
    onError: () => undefined,
  }) : undefined;

  // Ohne Signaturschluessel wird nicht zugestellt. Ein Zusteller, der
  // stillschweigend ohne Signatur sendet, waere schlimmer als einer, der gar
  // nicht startet: Der Empfaenger kann dann nicht mehr unterscheiden, ob eine
  // Nachricht wirklich von hier kommt.
  const signer = webhooksEnabled
    ? dependencies.signer ?? new HmacWebhookSigner(new EnvWebhookSecretProvider(env))
    : undefined;
  const transport = dependencies.transport ?? new FetchWebhookTransport();
  const deliverer = signer ? new WebhookDeliverer(signer, transport) : undefined;
  const webhooks = new PostgresWebhookOutboxRepository(controlPlane);
  const outbox = new WebhookOutbox({ repository: webhooks, visibilityMs });
  const sleep = dependencies.sleep;

  return {
    scopes,
    async run(signal: AbortSignal): Promise<void> {
      const loops: Promise<void>[] = [];
      const stops: Array<() => void> = [];

      for (const scope of scopes) {
        if (deliverer) {
          const runtime = new WebhookDeliveryRuntime({
            outbox,
            deliverer,
            definitions: webhooks,
            scope,
            workerId,
            batchSize: webhookBatch,
            idleIntervalMs: webhookIdleMs,
            onFailure: () => undefined,
            ...(sleep ? { sleep } : {}),
          });
          stops.push(() => runtime.stop());
          loops.push(runtime.run());
        }
        if (scheduler) {
          const principal: ProjectQueuePrincipal = {
            organizationId: scope.organizationId,
            actorRef: `service-role:cron:${scope.projectId}`,
            role: "service_role",
            subject: workerId,
          };
          loops.push(runCronLoop(scheduler, principal, scope, cronIntervalMs, signal, sleep));
        }
      }

      const onAbort = () => { for (const stop of stops) stop(); };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
      try {
        await Promise.all(loops);
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    },
  };
}

/**
 * Cron läuft im Takt, nicht in einer engen Schleife: Ein Vorkommen ist
 * minutengenau, und häufigeres Nachsehen erzeugt nur Last.
 */
async function runCronLoop(
  scheduler: CronScheduler,
  principal: ProjectQueuePrincipal,
  scope: ComputeScopeConfig,
  intervalMs: number,
  signal: AbortSignal,
  sleep?: (ms: number) => Promise<void>,
): Promise<void> {
  while (!signal.aborted) {
    try {
      await scheduler.run(principal, scope);
    } catch {
      // Der Scheduler faengt Fehler einzelner Definitionen bereits ab; hier
      // bleibt nur ein Fehler beim Lesen der Liste. Er darf den Takt nicht
      // beenden, und seine Meldung gehoert nicht ins Log.
    }
    if (signal.aborted) return;
    await (sleep ? sleep(intervalMs) : waitOrAbort(intervalMs, signal));
  }
}

function waitOrAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

function workerIdentity(env: Readonly<Record<string, string | undefined>>): string {
  const configured = env.QKERN_COMPUTE_WORKER_ID?.trim();
  const value = configured || `compute-${process.pid}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new ConfigurationError("QKERN_COMPUTE_WORKER_ID must be a bounded worker identity.");
  }
  return value;
}

function integer(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ConfigurationError(`A compute runtime setting must be an integer between ${min} and ${max}.`);
  }
  return value;
}
