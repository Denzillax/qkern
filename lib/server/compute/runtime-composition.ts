import { ConfigurationError } from "@/lib/server/db/errors";
import { getPostgresPool } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { CronDispatcher } from "@/lib/server/compute/cron";
import { PostgresCronRepository } from "@/lib/server/compute/cron-postgres-repository";
import { CronScheduler } from "@/lib/server/compute/cron-scheduler";
import { WebhookDeliveryRuntime } from "@/lib/server/compute/webhook-delivery-runtime";
import { WebhookRetentionRuntime } from "@/lib/server/compute/webhook-retention-runtime";
import { WebhookOutbox } from "@/lib/server/compute/webhook-outbox";
import { PostgresWebhookOutboxRepository } from "@/lib/server/compute/webhook-postgres-repository";
import { createVaultWebhookSecretProviderFromEnv } from "@/lib/server/compute/webhook-secret-vault";
import { EnvWebhookSecretProvider, HmacWebhookSigner } from "@/lib/server/compute/webhook-signer";
import { FetchWebhookTransport } from "@/lib/server/compute/webhook-transport";
import { WebhookDeliverer, type WebhookSignerPort, type WebhookTransportPort } from
  "@/lib/server/compute/webhooks";
import { safeRuntimeProbe, type RuntimeProbeObserver } from
  "@/lib/server/operations/runtime-probe";
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
  /**
   * Nimmt Erfolg und Fehlschlag jeder Runde entgegen.
   *
   * Ohne diesen Beobachter ist eine Schleife, die jede Sekunde scheitert, von
   * einer untaetigen nicht zu unterscheiden. Genau daran hat Release 1.45 eine
   * Stunde verloren: Der Prozess meldete seinen Start und schwieg danach.
   */
  probe?: RuntimeProbeObserver;
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

  // Der Scheduler faengt Fehler einzelner Definitionen selbst ab und kehrt
  // normal zurueck. Ohne diesen Zaehler meldete die Schleife danach Erfolg und
  // loeschte den eben gesetzten Fehlschlag wieder — eine Runde, in der jede
  // Definition scheitert, saehe aus wie eine gelungene.
  const cronFailures = { count: 0 };
  const scheduler = cronEnabled ? new CronScheduler({
    repository: new PostgresCronRepository(controlPlane),
    dispatcher: new CronDispatcher(createProjectQueueServiceFromEnv(env)),
    maxCatchUp: cronMaxCatchUp,
    // Redigiert: der Fehler kann eine Datenbankmeldung oder einen Queue-Namen
    // tragen und gehoert nicht ins Log dieses Prozesses. Gezaehlt wird er
    // trotzdem — sonst sieht eine Schleife, in der jede Definition scheitert,
    // von aussen aus wie eine, die nichts zu tun hat.
    onError: () => {
      cronFailures.count += 1;
      safeRuntimeProbe(dependencies.probe, "iterationFailed");
    },
  }) : undefined;

  // Ohne Signaturschluessel wird nicht zugestellt. Ein Zusteller, der
  // stillschweigend ohne Signatur sendet, waere schlimmer als einer, der gar
  // nicht startet: Der Empfaenger kann dann nicht mehr unterscheiden, ob eine
  // Nachricht wirklich von hier kommt.
  // Der Vault hat Vorrang. Ist er konfiguriert, wird der Umgebungs-Provider
  // gar nicht erst gebaut — sonst koennte ein vergessener lokaler Schluessel in
  // einer Produktionsumgebung stillschweigend gewinnen.
  const signer = webhooksEnabled
    ? dependencies.signer ?? new HmacWebhookSigner(
      createVaultWebhookSecretProviderFromEnv(env) ?? new EnvWebhookSecretProvider(env),
    )
    : undefined;
  const transport = dependencies.transport ?? new FetchWebhookTransport();
  const deliverer = signer ? new WebhookDeliverer(signer, transport) : undefined;
  const webhooks = new PostgresWebhookOutboxRepository(controlPlane);
  const outbox = new WebhookOutbox({ repository: webhooks, visibilityMs });
  const sleep = dependencies.sleep;

  // `project_webhook_deliveries` wuchs seit Release 1.19 unbegrenzt: Eine
  // zugestellte Zeile blieb fuer immer liegen. Aufgefallen ist das erst, als
  // Release 1.37 dieselbe Luecke beim Realtime-Event-Log geschlossen hat.
  //
  // Der Aufraeumer laeuft hier, weil dieser Prozess die Scopes ohnehin kennt —
  // und weil er derselbe ist, der die Zeilen erzeugt.
  const retention = webhooksEnabled ? new WebhookRetentionRuntime({
    repository: webhooks,
    scopes,
    deliveredRetentionMs: integer(env.QKERN_COMPUTE_WEBHOOK_DELIVERED_RETENTION_MS,
      7 * 86_400_000, 60_000, 365 * 86_400_000),
    // Laenger, und zwar bewusst: Eine tote Zustellung ist der Grund, warum
    // jemand ueberhaupt in diese Tabelle schaut.
    deadLetterRetentionMs: integer(env.QKERN_COMPUTE_WEBHOOK_DEAD_LETTER_RETENTION_MS,
      30 * 86_400_000, 60_000, 365 * 86_400_000),
    intervalMs: integer(env.QKERN_COMPUTE_WEBHOOK_RETENTION_INTERVAL_MS,
      3_600_000, 1_000, 86_400_000),
    ...(sleep ? { sleep } : {}),
  }) : undefined;

  return {
    scopes,
    async run(signal: AbortSignal): Promise<void> {
      const loops: Promise<void>[] = [];
      const stops: Array<() => void> = [];

      if (retention) {
        stops.push(() => retention.stop());
        loops.push(retention.run());
      }

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
            // Redigiert wie bisher — aber nicht mehr stumm: Der Beobachter
            // erfaehrt den Fehlschlag, ohne seinen Inhalt zu sehen.
            onFailure: () => safeRuntimeProbe(dependencies.probe, "iterationFailed"),
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
          loops.push(runCronLoop(
            scheduler, principal, scope, cronIntervalMs, signal, sleep,
            dependencies.probe, cronFailures,
          ));
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
  probe?: RuntimeProbeObserver,
  failures?: { count: number },
): Promise<void> {
  while (!signal.aborted) {
    try {
      const before = failures?.count ?? 0;
      await scheduler.run(principal, scope);
      // Erfolg nur, wenn in dieser Runde keine Definition gescheitert ist.
      // Sonst waere die Meldung eine Behauptung ueber etwas, das nicht
      // stattgefunden hat.
      safeRuntimeProbe(probe,
        (failures?.count ?? 0) === before ? "iterationSucceeded" : "iterationFailed");
    } catch {
      // Der Scheduler faengt Fehler einzelner Definitionen bereits ab; hier
      // bleibt nur ein Fehler beim Lesen der Liste. Er darf den Takt nicht
      // beenden, und seine Meldung gehoert nicht ins Log — gezaehlt wird er.
      safeRuntimeProbe(probe, "iterationFailed");
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
