import { ConfigurationError } from "@/lib/server/db/errors";
import { getAuthPostgresPool, getPostgresPool } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { CronDispatcher } from "@/lib/server/compute/cron";
import { PostgresCronRepository } from "@/lib/server/compute/cron-postgres-repository";
import { CronScheduler } from "@/lib/server/compute/cron-scheduler";
import { DatabaseWebhookBridgeRuntime } from
  "@/lib/server/compute/database-webhook-bridge-runtime";
import { PostgresDatabaseWebhookRepository } from
  "@/lib/server/compute/database-webhook-postgres-repository";
import { PostgresDatabaseWebhookCursorRepository } from
  "@/lib/server/compute/database-webhook-cursor-postgres-repository";
import { DashboardWebhookCollectorRuntime } from
  "@/lib/server/compute/dashboard-webhook-collector-runtime";
import { PostgresDashboardWebhookCursorRepository } from
  "@/lib/server/compute/dashboard-webhook-cursor-postgres-repository";
import {
  PostgresDashboardEventReader,
  PostgresDashboardWebhookRepository,
} from "@/lib/server/compute/dashboard-webhook-postgres-repository";
import { LogDrainCollectorRuntime } from "@/lib/server/compute/log-drain-collector-runtime";
import { PostgresLogDrainCursorRepository } from
  "@/lib/server/compute/log-drain-cursor-postgres-repository";
import {
  PostgresLogDrainRepository,
  PostgresLogDrainSourceReader,
} from "@/lib/server/compute/log-drain-postgres-repository";
import { PostgresRealtimeChangeSource, type ProjectConnection } from
  "@/lib/server/realtime/postgres-change-source";
import { WebhookDeliveryRuntime } from "@/lib/server/compute/webhook-delivery-runtime";
import { WebhookRetentionRuntime } from "@/lib/server/compute/webhook-retention-runtime";
import { WebhookOutbox } from "@/lib/server/compute/webhook-outbox";
import { PostgresWebhookOutboxRepository } from "@/lib/server/compute/webhook-postgres-repository";
import { createVaultWebhookSecretProviderFromEnv } from "@/lib/server/compute/webhook-secret-vault";
import { EnvWebhookSecretProvider, HmacWebhookSigner } from "@/lib/server/compute/webhook-signer";
import { FetchWebhookTransport } from "@/lib/server/compute/webhook-transport";
import { WebhookDeliverer, type WebhookSignerPort, type WebhookTransportPort } from
  "@/lib/server/compute/webhooks";
import { ProjectAuthExpiryRetentionRuntime } from
  "@/lib/server/project-auth/expiry-retention";
import { PostgresProjectAuthExpiryStore } from
  "@/lib/server/project-auth/expiry-retention-postgres";
import { safeRuntimeProbe, type RuntimeProbeObserver } from
  "@/lib/server/operations/runtime-probe";
import { createProjectQueueServiceFromEnv } from "@/lib/server/project-queues/runtime";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";
import {
  computeScopesFromEnv,
  ComputeScopeCensusRuntime,
  computeScopeOrganizationFromEnv,
  computeScopeSourceFromEnv,
  PostgresComputeScopeCatalog,
  type ComputeScopeCatalog,
  type ComputeScopeConfig,
  type ComputeScopeSource,
} from "@/lib/server/compute/scope-discovery";

/**
 * Die Bereiche dieses Prozesses wohnen seit 2.107 in `scope-discovery`, weil
 * sie dort nicht mehr nur aus der Umgebung kommen. Diese Datei gibt sie weiter
 * heraus: Jeder Aufrufer, der sie bisher hier geholt hat, holt sie weiter hier.
 */
export {
  computeScopesFromEnv,
  MAX_COMPUTE_SCOPES,
  resolveComputeScopes,
  type ComputeScopeConfig,
  type ComputeScopeSource,
} from "@/lib/server/compute/scope-discovery";

/**
 * Was der Compute-Prozess ueber seine Arbeit meldet.
 *
 * **Ein Index statt einer Id.** Die Startzeile des Prozesses nennt seit jeher
 * nur die Zahl der Scopes, und dabei bleibt es: Der Index zeigt in
 * `QKERN_COMPUTE_SCOPES_JSON`, die der Betreiber selbst gesetzt hat. Fuer ihn
 * ist er aufloesbar, fuer jeden anderen bedeutungslos.
 *
 * Gemeldet wird nur, was geschehen ist. Eine Runde ohne faelliges Vorkommen
 * schweigt — sonst schriebe der Prozess im Standardtakt alle 30 Sekunden je
 * Scope eine Zeile ueber nichts.
 */
export type ComputeRuntimeLogEvent = Readonly<{
  event: "compute.cron_round" | "compute.webhook_delivered" | "compute.webhook_failed"
  | "compute.database_webhook_round" | "compute.database_webhook_failed"
  | "compute.log_drain_round" | "compute.log_drain_failed"
  | "compute.dashboard_webhook_round" | "compute.dashboard_webhook_failed"
  | "compute.auth_retention_round" | "compute.auth_retention_failed"
  | "compute.scope_census" | "compute.scope_census_failed";
  /**
   * Der Index in der Liste der Bereiche dieses Prozesses. Die Zaehlung der
   * Bereiche (2.107) gehoert keinem einzelnen und traegt darum `-1`: Sie sagt
   * etwas ueber die Liste selbst, nicht ueber einen Eintrag darin.
   */
  scopeIndex: number;
  /**
   * Umgebungen der Organisation, die dieser Prozess nicht bedient (2.107), und
   * Bereiche dieses Prozesses, zu denen die Control Plane keine Umgebung
   * fuehrt. Zwei Zahlen, keine Kennung: Ein Projektname oder eine Id gehoert
   * nicht in dieses Log, wie bei jeder anderen Meldung hier.
   */
  unserved?: number;
  stale?: number;
  dispatched?: number;
  failures?: number;
  failureCode?: string;
  /**
   * Was der Aufraeumer abgelaufener Einmal-Artefakte (2.89) entfernt hat:
   * drei Zahlen, je Tabelle eine. Keine Id, keine Pruefsumme, keine Adresse
   * und kein Ruecksprungziel -- diese Zeile darf ueberall stehen, wo das
   * Prozesslog steht.
   */
  removed?: Readonly<{
    oneTimeTokens: number; oauthTokens: number; oauthCodes: number; samlAssertions: number;
  }>;
  /**
   * Zahl der eingereihten Zustellungen: von der Webhook-Bruecke (2.53), als
   * Ladung des Log-Drain-Sammlers (2.64) oder als Meldung des
   * Dashboard-Webhook-Sammlers (2.75).
   */
  enqueued?: number;
}>;

export interface ComputeRuntimeLogger {
  log(event: ComputeRuntimeLogEvent): void;
}

function safeComputeLog(logger: ComputeRuntimeLogger | undefined, event: ComputeRuntimeLogEvent) {
  try { logger?.log(Object.freeze({ ...event })); }
  catch { /* Beobachtung ist keine Ausfuehrungsautoritaet. */ }
}

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
  /**
   * Nimmt die Ereignisse je Vorgang entgegen.
   *
   * Bis Release 1.53 bot diese Komposition **gar keine** Naht: Der Prozess
   * meldete seinen Start und danach nichts mehr. Die Probe aus 1.46 sagt, dass
   * es klemmt — nicht, was geschehen ist.
   */
  logger?: ComputeRuntimeLogger;
  /**
   * Die Verbindung zu den Projektdatenbanken, aus denen die Webhook-Bruecke
   * liest (2.53).
   *
   * Sie wird **eingereicht** und nicht hier gebaut, aus demselben Grund wie in
   * der Realtime-Runtime: Der Katalog entsteht asynchron aus der Umgebung, und
   * diese Fabrik ist synchron. Der Prozess baut ihn, diese Komposition
   * verdrahtet ihn. Ohne ihn bleibt die Bruecke aus, statt vorhanden
   * auszusehen und nichts zu tun.
   */
  projectConnection?: ProjectConnection;
  /**
   * Die Bereiche, die dieser Prozess bedient, schon aufgeloest (2.107).
   *
   * Sie werden **eingereicht** und nicht hier gebaut, aus demselben Grund wie
   * die Projektverbindung darueber: Die Entdeckung liest die Control Plane und
   * ist damit asynchron, diese Fabrik ist synchron. Der Prozess loest auf
   * (`resolveComputeScopes`), diese Komposition verdrahtet.
   *
   * Ohne sie gilt weiter die ausdrueckliche Liste aus der Umgebung. Ein
   * Aufrufer, der nichts einreicht, verhaelt sich wie vor 2.107.
   */
  scopes?: readonly ComputeScopeConfig[];
  /**
   * Woher die Umgebungen der Organisation gelesen werden, fuer die Zaehlung
   * (2.107). Ohne diesen Katalog baut die Komposition ihn selbst aus derselben
   * Verbindung, die sie ohnehin oeffnet; Tests reichen ihn ein.
   */
  scopeCatalog?: ComputeScopeCatalog;
};

export type ComputeRuntime = {
  run(signal: AbortSignal): Promise<void>;
  readonly scopes: readonly ComputeScopeConfig[];
  /** Ob die Webhook-Bruecke (2.53) in diesem Prozess laeuft. Fuer die Startzeile. */
  readonly databaseWebhookBridge: boolean;
  /** Ob der Log-Drain-Sammler (2.64) in diesem Prozess laeuft. Fuer die Startzeile. */
  readonly logDrainCollector: boolean;
  /** Ob der Dashboard-Webhook-Sammler (2.75) in diesem Prozess laeuft. */
  readonly dashboardWebhookCollector: boolean;
  /**
   * Ob der Aufraeumer abgelaufener Einmal-Artefakte (2.89) in diesem Prozess
   * laeuft. Fuer die Startzeile: Ein Prozess, der ihn stumm laufen liesse,
   * waere von einem ohne ihn nicht zu unterscheiden.
   */
  readonly authRetention: boolean;
  /** Woher die Bereiche dieses Prozesses kommen (2.107). Fuer die Startzeile. */
  readonly scopeSource: ComputeScopeSource;
  /**
   * Ob die Zaehlung der Bereiche (2.107) laeuft. Sie laeuft genau dann, wenn
   * die Organisation dieses Prozesses genannt ist -- und ob sie laeuft,
   * entscheidet, ob eine vergessene Umgebung auffaellt.
   */
  readonly scopeCensus: boolean;
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
  // Die Webhook-Bruecke (2.53) ist ausdruecklich anzuschalten, wie Postgres
  // Changes in der Realtime-Runtime: Sie oeffnet Verbindungen zu
  // Kundendatenbanken, und das soll niemand versehentlich einschalten.
  const databaseWebhooksEnabled = env.QKERN_COMPUTE_DATABASE_WEBHOOKS_ENABLED === "true";
  if (databaseWebhooksEnabled && !webhooksEnabled) {
    // Sonst reiht die Bruecke Zustellungen ein, die in diesem Prozess niemand
    // abholt. Eine wachsende Outbox ohne Zusteller ist schlimmer als eine
    // abgeschaltete Bruecke.
    throw new ConfigurationError(
      "The database webhook bridge needs the webhook delivery loop in the same process.");
  }
  if (databaseWebhooksEnabled && !dependencies.projectConnection) {
    throw new ConfigurationError(
      "The database webhook bridge requires a project database connection.");
  }
  // Der Log-Drain-Sammler (2.64) ist ausdruecklich anzuschalten, wie die
  // Bruecke daneben: Er schickt Protokollzeilen an ein Ziel im Internet, und
  // das soll niemand versehentlich einschalten. Eine Projektdatenbank braucht
  // er nicht -- alle fuenf Quellen liegen in der Control Plane.
  const logDrainsEnabled = env.QKERN_COMPUTE_LOG_DRAINS_ENABLED === "true";
  if (logDrainsEnabled && !webhooksEnabled) {
    // Sonst reiht der Sammler Ladungen ein, die in diesem Prozess niemand
    // abholt. Eine wachsende Outbox ohne Zusteller ist schlimmer als ein
    // abgeschalteter Sammler.
    throw new ConfigurationError(
      "The log drain collector needs the webhook delivery loop in the same process.");
  }
  // Der Dashboard-Webhook-Sammler (2.75) ist ausdruecklich anzuschalten, wie
  // der Sammler daneben: Er schickt Ereignisse des Projekts an ein Ziel im
  // Internet, und das soll niemand versehentlich einschalten. Eine
  // Projektdatenbank braucht er nicht -- die Audit-Kette liegt in der Control
  // Plane.
  const dashboardWebhooksEnabled = env.QKERN_COMPUTE_DASHBOARD_WEBHOOKS_ENABLED === "true";
  if (dashboardWebhooksEnabled && !webhooksEnabled) {
    // Sonst reiht der Sammler Meldungen ein, die in diesem Prozess niemand
    // abholt. Eine wachsende Outbox ohne Zusteller ist schlimmer als ein
    // abgeschalteter Sammler.
    throw new ConfigurationError(
      "The dashboard webhook collector needs the webhook delivery loop in the same process.");
  }
  // Eingereichte Bereiche gewinnen; ohne sie bleibt es bei der Liste aus der
  // Umgebung. Die Entdeckung (2.107) laeuft im Prozess, weil sie liest.
  const scopes = dependencies.scopes && dependencies.scopes.length > 0
    ? Object.freeze([...dependencies.scopes])
    : computeScopesFromEnv(env);
  // Genannt heisst gezaehlt: Wer die Organisation dieses Prozesses angibt,
  // bekommt die Zaehlung, auch am festen Weg. Gerade dort ist sie etwas wert --
  // eine Umgebung, die in der Liste fehlt, faellt sonst niemandem auf.
  const scopeOrganizationId = computeScopeOrganizationFromEnv(env);
  const scopeSource = computeScopeSourceFromEnv(env);
  const scopeCensusIntervalMs = integer(
    env.QKERN_COMPUTE_SCOPE_CENSUS_INTERVAL_MS, 300_000, 1_000, 86_400_000);
  const workerId = workerIdentity(env);
  // Der Aufraeumer abgelaufener Einmal-Artefakte (2.89) laeuft, wenn ihn
  // niemand ausdruecklich abschaltet -- wie Cron und die Zustellung daneben,
  // und anders als Bruecke und Sammler. Der Unterschied hat einen Grund: Die
  // beiden Sammler schicken Daten ins Internet, dieser Aufraeumer loescht
  // Zeilen in derselben Datenbank. Ausdruecklich anzuschalten waere hier die
  // Wiederholung des Fehlers, den dieses Projekt schon dreimal gemacht hat:
  // gebaut, zertifiziert und untaetig.
  //
  // Er braucht die Auth-Verbindung. Fehlt sie, faellt der Start mit einer
  // Meldung, die sagt, was zu tun ist -- ein stilles Ueberspringen waere genau
  // der Zustand, den 0062 offen benannt hat.
  const authRetentionEnabled = env.QKERN_COMPUTE_AUTH_RETENTION_ENABLED !== "false";
  if (authRetentionEnabled && !env.QKERN_AUTH_DATABASE_URL?.trim()) {
    throw new ConfigurationError(
      "The project auth retention sweep needs QKERN_AUTH_DATABASE_URL, "
      + "or set QKERN_COMPUTE_AUTH_RETENTION_ENABLED=false.");
  }
  // 24 Stunden Frist nach dem Ablauf. Die Begruendung steht an der Klasse:
  // laenger als die laengste Lebensdauer eines dieser Artefakte (zwoelf
  // Stunden beim OAuth-Token) und lang genug fuer einen ganzen Betriebstag
  // Fehlersuche.
  const authRetentionGraceMs = integer(env.QKERN_COMPUTE_AUTH_RETENTION_GRACE_MS,
    86_400_000, 60_000, 365 * 86_400_000);
  const authRetentionBatch = integer(env.QKERN_COMPUTE_AUTH_RETENTION_BATCH, 500, 1, 5_000);
  const authRetentionMaxBatches = integer(
    env.QKERN_COMPUTE_AUTH_RETENTION_MAX_BATCHES, 10, 1, 1_000);
  const authRetentionIntervalMs = integer(env.QKERN_COMPUTE_AUTH_RETENTION_INTERVAL_MS,
    3_600_000, 1_000, 86_400_000);
  const cronIntervalMs = integer(env.QKERN_COMPUTE_CRON_INTERVAL_MS, 30_000, 1_000, 900_000);
  const cronMaxCatchUp = integer(env.QKERN_COMPUTE_CRON_MAX_CATCH_UP, 5, 1, 100);
  const webhookBatch = integer(env.QKERN_COMPUTE_WEBHOOK_BATCH, 5, 1, 10);
  const webhookIdleMs = integer(env.QKERN_COMPUTE_WEBHOOK_IDLE_MS, 1_000, 50, 60_000);
  const visibilityMs = integer(env.QKERN_COMPUTE_WEBHOOK_VISIBILITY_MS, 30_000, 1_000, 900_000);
  // Der Takt der Bruecke (2.53), benannt wie der der Zustellung und mit
  // denselben Grenzen wie die Realtime-Gegenstuecke.
  const bridgeBatch = integer(env.QKERN_COMPUTE_DATABASE_WEBHOOK_BATCH, 100, 1, 500);
  const bridgeMaxBatches = integer(env.QKERN_COMPUTE_DATABASE_WEBHOOK_MAX_BATCHES, 10, 1, 100);
  const bridgeIdleMs = integer(env.QKERN_COMPUTE_DATABASE_WEBHOOK_POLL_MS, 1_000, 50, 60_000);
  const bridgeErrorMs = integer(env.QKERN_COMPUTE_DATABASE_WEBHOOK_ERROR_MS, 5_000, 100, 300_000);
  const bridgeDiscoveryMs = integer(
    env.QKERN_COMPUTE_DATABASE_WEBHOOK_DISCOVERY_MS, 30_000, 250, 3_600_000);
  // Der Takt des Sammlers (2.64), benannt wie der der Bruecke und mit
  // denselben Grenzen. Die beiden Groessen, die es hier zusaetzlich gibt,
  // beschreiben die Buendelung: Eine Ladung geht hinaus, wenn sie voll ist
  // **oder** wenn sie alt genug ist.
  const drainBatchEntries = integer(
    env.QKERN_COMPUTE_LOG_DRAIN_BATCH_ENTRIES, 100, 1, 1_000);
  const drainBatchAgeMs = integer(
    env.QKERN_COMPUTE_LOG_DRAIN_BATCH_AGE_MS, 60_000, 1_000, 3_600_000);
  const drainReadLimit = integer(env.QKERN_COMPUTE_LOG_DRAIN_READ_LIMIT, 200, 1, 1_000);
  const drainIdleMs = integer(env.QKERN_COMPUTE_LOG_DRAIN_POLL_MS, 1_000, 50, 60_000);
  const drainErrorMs = integer(env.QKERN_COMPUTE_LOG_DRAIN_ERROR_MS, 5_000, 100, 300_000);
  const drainDiscoveryMs = integer(
    env.QKERN_COMPUTE_LOG_DRAIN_DISCOVERY_MS, 30_000, 250, 3_600_000);
  // Der Takt des Dashboard-Webhook-Sammlers (2.75), benannt wie der der
  // Sammler daneben und mit denselben Grenzen. Eine Buendelung gibt es hier
  // nicht, darum auch keine Groesse und kein Alter einer Ladung.
  const dashboardReadLimit = integer(
    env.QKERN_COMPUTE_DASHBOARD_WEBHOOK_READ_LIMIT, 100, 1, 1_000);
  const dashboardIdleMs = integer(env.QKERN_COMPUTE_DASHBOARD_WEBHOOK_POLL_MS, 1_000, 50, 60_000);
  const dashboardErrorMs = integer(
    env.QKERN_COMPUTE_DASHBOARD_WEBHOOK_ERROR_MS, 5_000, 100, 300_000);
  const dashboardDiscoveryMs = integer(
    env.QKERN_COMPUTE_DASHBOARD_WEBHOOK_DISCOVERY_MS, 30_000, 250, 3_600_000);

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

  // Die Bruecke (2.53): ein Leser fuer alle Umgebungen dieses Prozesses, mit
  // der Reihenfolge der Scope-Liste und einer dauerhaften Position je Umgebung.
  const cursors = databaseWebhooksEnabled
    ? new PostgresDatabaseWebhookCursorRepository(controlPlane)
    : undefined;
  const bridgeRuntime = cursors && dependencies.projectConnection
    ? new DatabaseWebhookBridgeRuntime({
      scopes,
      source: new PostgresRealtimeChangeSource(dependencies.projectConnection),
      bindings: new PostgresDatabaseWebhookRepository(controlPlane),
      census: cursors,
      cursors,
      outbox,
      batchSize: bridgeBatch,
      maxBatches: bridgeMaxBatches,
      idleIntervalMs: bridgeIdleMs,
      errorIntervalMs: bridgeErrorMs,
      discoveryIntervalMs: bridgeDiscoveryMs,
      // Redigiert wie beim Zusteller: ein fester Code und der Scope-Index,
      // keine Datenbankmeldung, keine Id, kein Endpunkt.
      onFailure: (failureCode, scopeIndex) => {
        safeRuntimeProbe(dependencies.probe, "iterationFailed");
        safeComputeLog(dependencies.logger, {
          event: "compute.database_webhook_failed", scopeIndex, failureCode,
        });
      },
      onEnqueued: (scopeIndex, enqueued) => safeComputeLog(dependencies.logger, {
        event: "compute.database_webhook_round", scopeIndex, enqueued,
      }),
    })
    : undefined;

  // Der Sammler (2.64): ein Leser fuer alle Umgebungen dieses Prozesses, mit
  // der Reihenfolge der Scope-Liste und einer dauerhaften Position je Drain
  // und Quelle. Die Kopplungen und die Quellen liest er mit denselben beiden
  // Repositories, die 2.54 gebaut hat.
  const drainCursors = logDrainsEnabled
    ? new PostgresLogDrainCursorRepository(controlPlane)
    : undefined;
  const drainRuntime = drainCursors ? new LogDrainCollectorRuntime({
    scopes,
    reader: new PostgresLogDrainSourceReader(controlPlane),
    drains: new PostgresLogDrainRepository(controlPlane),
    census: drainCursors,
    cursors: drainCursors,
    outbox,
    maxBatchEntries: drainBatchEntries,
    maxBatchAgeMs: drainBatchAgeMs,
    readLimit: drainReadLimit,
    idleIntervalMs: drainIdleMs,
    errorIntervalMs: drainErrorMs,
    discoveryIntervalMs: drainDiscoveryMs,
    // Redigiert wie bei der Bruecke: ein fester Code und der Scope-Index,
    // keine Datenbankmeldung, keine Id, kein Endpunkt.
    onFailure: (failureCode, scopeIndex) => {
      safeRuntimeProbe(dependencies.probe, "iterationFailed");
      safeComputeLog(dependencies.logger, {
        event: "compute.log_drain_failed", scopeIndex, failureCode,
      });
    },
    onEnqueued: (scopeIndex, enqueued) => safeComputeLog(dependencies.logger, {
      event: "compute.log_drain_round", scopeIndex, enqueued,
    }),
  }) : undefined;

  // Der Dashboard-Webhook-Sammler (2.75): ein Leser fuer alle Umgebungen dieses
  // Prozesses, mit der Reihenfolge der Scope-Liste und einer dauerhaften
  // Position je Webhook und Ereignisart.
  const dashboardCursors = dashboardWebhooksEnabled
    ? new PostgresDashboardWebhookCursorRepository(controlPlane)
    : undefined;
  const dashboardRuntime = dashboardCursors ? new DashboardWebhookCollectorRuntime({
    scopes,
    reader: new PostgresDashboardEventReader(controlPlane),
    bindings: new PostgresDashboardWebhookRepository(controlPlane),
    census: dashboardCursors,
    cursors: dashboardCursors,
    outbox,
    readLimit: dashboardReadLimit,
    idleIntervalMs: dashboardIdleMs,
    errorIntervalMs: dashboardErrorMs,
    discoveryIntervalMs: dashboardDiscoveryMs,
    // Redigiert wie bei den Sammlern daneben: ein fester Code und der
    // Scope-Index, keine Datenbankmeldung, keine Id, kein Endpunkt.
    onFailure: (failureCode, scopeIndex) => {
      safeRuntimeProbe(dependencies.probe, "iterationFailed");
      safeComputeLog(dependencies.logger, {
        event: "compute.dashboard_webhook_failed", scopeIndex, failureCode,
      });
    },
    onEnqueued: (scopeIndex, enqueued) => safeComputeLog(dependencies.logger, {
      event: "compute.dashboard_webhook_round", scopeIndex, enqueued,
    }),
  }) : undefined;

  // Der Aufraeumer (2.89): dieselben Umgebungen, die dieser Prozess ohnehin
  // bedient, und die Auth-Verbindung, weil nur `qkern_auth` diese drei Tabellen
  // sieht. Er wohnt hier und nicht in einem eigenen Prozess, weil ein zweiter
  // Dauerprozess eine zweite Stelle waere, die jemand starten muss -- und weil
  // dieser Prozess bereits einen Aufraeumer betreibt (Webhook-Zustellungen).
  const authRetention = authRetentionEnabled ? new ProjectAuthExpiryRetentionRuntime({
    store: new PostgresProjectAuthExpiryStore(getAuthPostgresPool(env)),
    scopes,
    graceMs: authRetentionGraceMs,
    batchSize: authRetentionBatch,
    maxBatches: authRetentionMaxBatches,
    intervalMs: authRetentionIntervalMs,
    // Vier Zahlen und der Index der Umgebung. Der Index zeigt in
    // `QKERN_COMPUTE_SCOPES_JSON`, die der Betreiber selbst gesetzt hat.
    onPruned: (scopeIndex, removed) => safeComputeLog(dependencies.logger, {
      event: "compute.auth_retention_round", scopeIndex, removed,
    }),
    onFailure: (scopeIndex) => {
      safeRuntimeProbe(dependencies.probe, "iterationFailed");
      safeComputeLog(dependencies.logger, {
        event: "compute.auth_retention_failed", scopeIndex,
        failureCode: "auth_retention_failed",
      });
    },
    ...(sleep ? { sleep } : {}),
  }) : undefined;

  // Die Zaehlung der Bereiche (2.107). Sie greift nicht ein; sie macht das
  // Fehlende sichtbar. Die Begruendung, warum sie nicht selbst einen Bereich
  // hinzunimmt, steht an `ComputeScopeCensusRuntime`.
  const scopeCensus = scopeOrganizationId ? new ComputeScopeCensusRuntime({
    catalog: dependencies.scopeCatalog ?? new PostgresComputeScopeCatalog(controlPlane),
    organizationId: scopeOrganizationId,
    scopes,
    intervalMs: scopeCensusIntervalMs,
    // Zwei Zahlen und kein Bereich: `-1` sagt, dass diese Zeile die Liste
    // meint und keinen Eintrag darin.
    onCensus: (counted) => safeComputeLog(dependencies.logger, {
      event: "compute.scope_census", scopeIndex: -1,
      unserved: counted.unserved, stale: counted.stale,
    }),
    onFailure: () => {
      safeRuntimeProbe(dependencies.probe, "iterationFailed");
      safeComputeLog(dependencies.logger, {
        event: "compute.scope_census_failed", scopeIndex: -1,
        failureCode: "scope_census_failed",
      });
    },
    ...(sleep ? { sleep } : {}),
  }) : undefined;

  return {
    scopes,
    scopeSource,
    scopeCensus: Boolean(scopeCensus),
    databaseWebhookBridge: Boolean(bridgeRuntime),
    logDrainCollector: Boolean(drainRuntime),
    dashboardWebhookCollector: Boolean(dashboardRuntime),
    authRetention: Boolean(authRetention),
    async run(signal: AbortSignal): Promise<void> {
      const loops: Promise<void>[] = [];
      const stops: Array<() => void> = [];

      if (dashboardRuntime) {
        stops.push(() => dashboardRuntime.stop());
        loops.push(dashboardRuntime.run());
      }
      if (drainRuntime) {
        stops.push(() => drainRuntime.stop());
        loops.push(drainRuntime.run());
      }
      if (bridgeRuntime) {
        stops.push(() => bridgeRuntime.stop());
        loops.push(bridgeRuntime.run());
      }
      if (retention) {
        stops.push(() => retention.stop());
        loops.push(retention.run());
      }
      if (authRetention) {
        stops.push(() => authRetention.stop());
        loops.push(authRetention.run());
      }
      if (scopeCensus) {
        stops.push(() => scopeCensus.stop());
        loops.push(scopeCensus.run());
      }

      for (const [scopeIndex, scope] of scopes.entries()) {
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
            onDelivered: () => safeComputeLog(dependencies.logger, {
              event: "compute.webhook_delivered", scopeIndex,
            }),
            onFailure: (code) => {
              safeRuntimeProbe(dependencies.probe, "iterationFailed");
              safeComputeLog(dependencies.logger, {
                event: "compute.webhook_failed", scopeIndex, failureCode: code,
              });
            },
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
            dependencies.probe, cronFailures, dependencies.logger, scopeIndex,
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
  logger?: ComputeRuntimeLogger,
  scopeIndex = 0,
): Promise<void> {
  while (!signal.aborted) {
    try {
      const before = failures?.count ?? 0;
      const result = await scheduler.run(principal, scope);
      const failed = (failures?.count ?? 0) - before;
      // Erfolg nur, wenn in dieser Runde keine Definition gescheitert ist.
      // Sonst waere die Meldung eine Behauptung ueber etwas, das nicht
      // stattgefunden hat.
      safeRuntimeProbe(probe, failed === 0 ? "iterationSucceeded" : "iterationFailed");
      // Nur Runden, in denen etwas geschehen ist. Eine leere Runde zu melden
      // hiesse, den Takt zu protokollieren statt die Arbeit.
      if (result.dispatched > 0 || failed > 0) {
        safeComputeLog(logger, {
          event: "compute.cron_round", scopeIndex, dispatched: result.dispatched, failures: failed,
        });
      }
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
