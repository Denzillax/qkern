import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import {
  getPostgresPool,
  postgresPoolConfigFromEnv,
  type PostgresPoolConfig,
} from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { ControlPlaneDataTargetResolver } from "@/lib/server/data-plane/runtime";
import { createGeneratedDataApiFromEnv } from "@/lib/server/data-plane/generated-runtime";
import {
  asListableProjectDatabaseCatalog,
  createProjectDatabaseCatalogFromEnv,
  probeProjectDatabaseCatalog,
  type ProjectDatabaseCatalogRuntime,
} from "@/lib/server/migrations/connection-catalog-runtime";
import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import { ProjectRealtimeAuthenticator } from "@/lib/server/realtime/auth";
import { RealtimeCursorCodec } from "@/lib/server/realtime/cursor";
import {
  PostgresRealtimeEventBus,
  type ListenConnection,
} from "@/lib/server/realtime/event-bus";
import { RealtimeChangePollerRegistry } from "@/lib/server/realtime/change-poller-registry";
import { GeneratedApiRealtimeChangeReader } from "@/lib/server/realtime/change-reader";
import { PrefixRealtimeAuthorization } from "@/lib/server/realtime/policy";
import { realtimeBindPlan } from "@/lib/server/realtime/production-gate";
import { PostgresRealtimeChangeSource } from "@/lib/server/realtime/postgres-change-source";
import { ControlPlaneRealtimeProjectConnection } from
  "@/lib/server/realtime/project-connection";
import { PostgresRealtimeEventLog } from "@/lib/server/realtime/postgres-repository";
import { MemoryRealtimeEventLog } from "@/lib/server/realtime/repository";
import type { RealtimeScope } from "@/lib/server/realtime/model";
import { RealtimeRetentionRuntime } from "@/lib/server/realtime/retention-runtime";
import { RealtimeService } from "@/lib/server/realtime/service";
import { createRealtimeWebSocketServer } from "@/lib/server/realtime/websocket-server";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";
import { BufferedUsageEmitter } from "@/lib/server/usage/buffered-emitter";
import { createUsageEmitterFromEnv } from "@/lib/server/usage/runtime";

if (process.env.QKERN_REALTIME_ENABLED !== "true") {
  throw new Error("QKERN Realtime is disabled. Set QKERN_REALTIME_ENABLED=true explicitly.");
}
// Das bedingungslose Production-Verbot ist seit 1.73 ein Tor mit benannten
// Bedingungen: dauerhafter Log, stabiles Cursor-Geheimnis, Aufbewahrung,
// https-Origins — und bei oeffentlichem Binding die TLS-Attestierung.
// Jede verletzte Bedingung nennt sich selbst, statt pauschal zu verbieten.
const bindPlan = realtimeBindPlan(process.env, [...allowedOrigins()]);
if (runtimeModeFromEnv(process.env) !== "postgres") {
  throw new Error("The standalone Realtime runtime requires PostgreSQL-backed Project API keys.");
}

// Bis Release 1.14 verwendete diese Runtime den Memory-Log, obwohl der
// dauerhafte Adapter seit 1.11 existiert und zertifiziert ist: Ereignisse gingen
// bei jedem Neustart verloren und erreichten keine zweite Instanz. Der
// dauerhafte Log ist jetzt der Default; der Memory-Log bleibt als ausdrueckliche
// Ausnahme fuer lokale Entwicklung ohne Datenbank erreichbar.
const ephemeralLog = process.env.QKERN_REALTIME_EPHEMERAL_LOG === "true";
const eventLog = ephemeralLog
  ? new MemoryRealtimeEventLog(integer("QKERN_REALTIME_HISTORY_PER_CHANNEL", 200, 1, 10_000))
  : new PostgresRealtimeEventLog(new PostgresControlPlane(getPostgresPool()));

// Ohne Bus bleibt ein Broadcast auf diesen Prozess beschraenkt. Die
// Benachrichtigung traegt nur einen Verweis, nie eine Payload.
const eventBus = ephemeralLog ? undefined : new PostgresRealtimeEventBus({
  connect: async (): Promise<ListenConnection> => {
    // Dieselbe Verbindung wie die des Event-Logs, nur ohne Pool: `LISTEN`
    // belegt sie dauerhaft und gehoert deshalb nicht in einen. Sie liest ihre
    // Konfiguration aus derselben Quelle, damit sie auch dieselbe
    // TLS-Konfiguration bekommt.
    //
    // Bis zu diesem Slice baute sie sich ohne jede TLS-Angabe auf: Sie las die
    // Adresse selbst und liess `DATABASE_SSL` liegen. Gegen ein PostgreSQL, das
    // Klartext abweist (`hostnossl ... reject`), scheiterte sie darum, und weil
    // sie vor dem Lauschen aufgebaut wird und der dauerhafte Log unter
    // Production Pflicht ist, kam der Prozess dort nie hoch. Das war der Grund,
    // aus dem der Production-Start nie belegt werden konnte.
    const { connectionString, ssl } = postgresPoolConfigFromEnv(process.env);
    const { Client } = createRequire(import.meta.url)("pg") as {
      Client: new (config: { connectionString: string; ssl: PostgresPoolConfig["ssl"] })
      => ListenConnection & { connect(): Promise<void> };
    };
    const client = new Client({ connectionString, ssl });
    await client.connect();
    return client;
  },
});
// Postgres Changes sind opt-in. Ohne Reader bleibt ein `changes:`-Abonnement
// leer, statt ungeprueft Daten auszuliefern; ohne Registry pollt niemand, und
// die Funktion saehe vorhanden aus, ohne es zu sein.
//
// Der Weg zum Feed hat zwei Haelften, und beide brauchen dieselbe
// Projektdatenbank: Die Quelle liest `qkern_internal.change_feed`, der Leser
// holt die geaenderte Zeile je Abonnent durch die Generated Data API. Bis
// `2.68.0` baute dieser Prozess dafuer **zwei** Kataloge aus derselben
// Umgebungsvariablen auf, also zwei Pool-Saetze auf dieselben Datenbanken. Es
// ist jetzt einer, und er wird in beide Haelften eingespeist: Ein Katalog, der
// an zwei Stellen entsteht, kann an zwei Stellen unterschiedlich aussehen, und
// an genau diesen Angaben haengt die Rollengrenze.
//
// Unter Production kommt er aus derselben Fabrik wie der des
// Migrations-Prozesses, also vault-gestuetzt. Bis `2.68.0` gab es diesen Zweig
// hier nicht, und der Change Feed war unter Production darum tot.
const changesEnabled = process.env.QKERN_REALTIME_CHANGES_ENABLED === "true";
// Der Leser ist die Generated Data API. Ist sie abgeschaltet, wirft sie bei
// jedem Lesevorgang, der Leser faellt geschlossen und der Abonnent bekaeme
// dauerhaft nichts — ohne Fehler, ohne Hinweis. Das ist genau der stille
// Rutsch, den es nicht geben soll, also faellt der Start.
if (changesEnabled && process.env.QKERN_GENERATED_DATA_API_ENABLED !== "true") {
  throw new Error(
    "QKERN_REALTIME_CHANGES_ENABLED=true requires QKERN_GENERATED_DATA_API_ENABLED=true: "
    + "the change reader reads every row through the Generated Data API.",
  );
}
let projectCatalog: ProjectDatabaseCatalogRuntime | undefined;
if (changesEnabled) {
  projectCatalog = await createProjectDatabaseCatalogFromEnv(process.env, {
    // Die Bindungstabelle der Control Plane gehoert der Worker-Rolle. Dieser
    // Prozess laeuft mit der Laufzeitrolle und bekaeme sie nur durch ein
    // zusaetzliches Leserecht; er verlangt deshalb ausdrueckliche Bindungen.
    allowControlPlaneBindings: false,
    // Sonst steht dieser Prozess in `pg_stat_activity` als Migrator, und wer
    // dort eine haengende Verbindung sucht, sucht am falschen Prozess.
    clientName: "qkern-realtime",
    local: {
      allowFlag: "QKERN_ALLOW_LOCAL_PROJECT_DATA_API_CATALOG",
      catalogVariable: "QKERN_LOCAL_PROJECT_DATA_API_CATALOG_JSON",
      applicationName: "qkern-realtime-changes",
    },
  });
  // Vor dem Lauschen einmal bis zur Datenbank. Ein leerer Katalog oder ein
  // Vault, der nichts liefert, laesst den Start fallen.
  const references = await probeProjectDatabaseCatalog(
    asListableProjectDatabaseCatalog(projectCatalog),
  );
  console.error(`QKERN Realtime change feed catalog reached ${references.length} project database(s)`);
}
const changeReader = changesEnabled
  ? new GeneratedApiRealtimeChangeReader(
    await createGeneratedDataApiFromEnv(process.env, { connections: projectCatalog }) as never,
  )
  : undefined;
const changeSource = changesEnabled
  ? new PostgresRealtimeChangeSource(new ControlPlaneRealtimeProjectConnection(
    new ControlPlaneDataTargetResolver(controlPlaneService),
    projectCatalog!,
  ))
  : undefined;

const cursorSecret = process.env.QKERN_REALTIME_CURSOR_SECRET?.trim();
const cursorBytes = cursorSecret ? Buffer.from(cursorSecret, "base64url") : randomBytes(32);
// Gebündelt, nicht je Nachricht: Eine Control-Plane-Transaktion pro Broadcast
// wäre auf diesem Pfad ein absehbarer Fehler. Der Puffer wird beim
// Herunterfahren geschrieben; ein harter Absturz verliert ihn, und das ist die
// gewählte Richtung — lieber zu wenig zählen als zu viel.
const usage = new BufferedUsageEmitter({
  inner: createUsageEmitterFromEnv("realtime"),
  flushAtQuantity: integer("QKERN_REALTIME_USAGE_FLUSH_AT", 500, 1, 100_000),
});
const usageFlushTimer = setInterval(() => { void usage.flush(); },
  integer("QKERN_REALTIME_USAGE_FLUSH_MS", 15_000, 1_000, 300_000));
usageFlushTimer.unref();

const service = new RealtimeService({
  eventLog,
  eventBus,
  changeReader,
  usage,
  authorization: new PrefixRealtimeAuthorization(),
  cursor: new RealtimeCursorCodec(cursorBytes),
  maxSubscriptionsPerConnection: integer("QKERN_REALTIME_MAX_SUBSCRIPTIONS", 32, 1, 128),
  replayLimit: integer("QKERN_REALTIME_REPLAY_LIMIT", 100, 1, 500),
  maxPayloadBytes: integer("QKERN_REALTIME_MAX_PAYLOAD_BYTES", 16 * 1024, 256, 256 * 1024),
  maxPresenceBytes: integer("QKERN_REALTIME_MAX_PRESENCE_BYTES", 4 * 1024, 128, 32 * 1024),
});
const runtime = createRealtimeWebSocketServer({
  authenticator: new ProjectRealtimeAuthenticator(projectApiKeyService, () => getProjectAuthService()),
  service,
  allowedOrigins: allowedOrigins(),
  host: bindPlan.host,
  port: integer("QKERN_REALTIME_PORT", 8788, 1, 65_535),
  maxConnections: integer("QKERN_REALTIME_MAX_CONNECTIONS", 500, 1, 10_000),
  maxMessageBytes: integer("QKERN_REALTIME_MAX_MESSAGE_BYTES", 32 * 1024, 1024, 512 * 1024),
  maxBufferedBytes: integer("QKERN_REALTIME_MAX_BUFFERED_BYTES", 256 * 1024, 16 * 1024, 16 * 1024 * 1024),
  authTimeoutMs: integer("QKERN_REALTIME_AUTH_TIMEOUT_MS", 5_000, 1_000, 30_000),
  heartbeatMs: integer("QKERN_REALTIME_HEARTBEAT_MS", 30_000, 5_000, 120_000),
});

await eventBus?.subscribe((reference) => { void service.deliverRemote(reference); });

let changeRegistry: RealtimeChangePollerRegistry | undefined;
let reconcileTimer: ReturnType<typeof setInterval> | undefined;

if (changeSource) {
  changeRegistry = new RealtimeChangePollerRegistry({
    source: changeSource,
    audience: service,
    idleIntervalMs: integer("QKERN_REALTIME_CHANGE_POLL_MS", 500, 50, 60_000),
    batchSize: integer("QKERN_REALTIME_CHANGE_BATCH", 100, 1, 500),
    // Redigiert: der Fehler kann eine Datenbankmeldung enthalten und gehoert
    // nicht ins Log dieses Prozesses.
    onError: () => undefined,
  });
  const registry = changeRegistry;
  reconcileTimer = setInterval(() => {
    try { registry.reconcile(); } catch { /* Scope-Grenze; naechster Takt versucht erneut */ }
  }, integer("QKERN_REALTIME_CHANGE_RECONCILE_MS", 2_000, 250, 60_000));
}

// Aufraeumen hat jetzt einen Besitzer. Beide `prune`-Pfade existierten seit
// Release 1.13 beziehungsweise 1.15, und niemand rief sie auf: Der Poller tut es
// ausdruecklich nicht, weil eine Instanz nicht weiss, was andere noch brauchen.
// Damit war die Aufgabe benannt und blieb liegen.
//
// Welche Projekte aufgeraeumt werden, steht ausdruecklich in der Umgebung — wie
// bei `QKERN_COMPUTE_SCOPES_JSON` und aus demselben Grund: RLS gibt keine
// organisationsuebergreifende Suche her. Die Abonnements dieser Instanz waeren
// der falsche Massstab, denn gerade das Projekt ohne Zuhoerer waechst
// unbeobachtet.
const retentionScopes = parseRetentionScopes(process.env.QKERN_REALTIME_RETENTION_SCOPES_JSON);
// Der Memory-Log kennt keine Aufbewahrung: Er verliert ohnehin alles beim
// Neustart. Aufraeumen gibt es nur, wo etwas dauerhaft liegt.
const retention = retentionScopes.length > 0 && !ephemeralLog
  ? new RealtimeRetentionRuntime({
    eventLog: eventLog as PostgresRealtimeEventLog,
    changeSource,
    scopes: retentionScopes,
    eventRetentionMs: integer("QKERN_REALTIME_EVENT_RETENTION_MS", 7 * 86_400_000, 60_000, 90 * 86_400_000),
    changeRetentionMs: integer("QKERN_REALTIME_CHANGE_RETENTION_MS", 86_400_000, 60_000, 90 * 86_400_000),
    intervalMs: integer("QKERN_REALTIME_RETENTION_INTERVAL_MS", 3_600_000, 1_000, 86_400_000),
  })
  : undefined;
const retentionLoop = retention?.run();

const port = await runtime.listen();
console.error(
  `QKERN Realtime listening on ws://${bindPlan.host}:${port} with protocol qkern.realtime.v1 `
  + `(${ephemeralLog ? "ephemeral log, single instance" : "durable log, cross-instance fan-out"})`,
);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (reconcileTimer) clearInterval(reconcileTimer);
  clearInterval(usageFlushTimer);
  retention?.stop();
  await retentionLoop;
  await changeRegistry?.stop();
  await runtime.close();
  // Nach dem Schliessen der Verbindungen: Was bis zuletzt gezaehlt wurde, soll
  // noch ankommen.
  await usage.stop();
  await eventBus?.close();
  // Zuletzt der Projektdatenbank-Katalog: Er besitzt seine Pools, und unter
  // Production haengt an jedem ein Vault-Zugangsdatum, das nicht laenger als
  // der Prozess leben soll.
  await projectCatalog?.close().catch(() => undefined);
}
process.once("SIGINT", () => { void stop(); });
process.once("SIGTERM", () => { void stop(); });

function integer(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function allowedOrigins() {
  const values = (process.env.QKERN_REALTIME_ALLOWED_ORIGINS ?? "http://localhost:3000")
    .split(",").map((value) => value.trim()).filter(Boolean);
  if (!values.length || values.length > 20 || new Set(values).size !== values.length) {
    throw new Error("QKERN_REALTIME_ALLOWED_ORIGINS must contain 1 to 20 exact origins.");
  }
  return new Set(values.map((value) => {
    const url = new URL(value);
    if ((!(["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol === "http:") &&
        url.protocol !== "https:") || url.origin !== value || url.username || url.password) {
      throw new Error("QKERN_REALTIME_ALLOWED_ORIGINS contains an invalid origin.");
    }
    return url.origin;
  }));
}

/**
 * Liest die Scope-Liste fuer die Aufbewahrung. Eine unlesbare Liste ist ein
 * Konfigurationsfehler und wird nicht stillschweigend zu "keine Scopes":
 * Sonst laeuft der Prozess weiter und raeumt nie auf.
 */
function parseRetentionScopes(raw: string | undefined): RealtimeScope[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("QKERN_REALTIME_RETENTION_SCOPES_JSON must be valid JSON."); }
  if (!Array.isArray(parsed) || parsed.length > 200) {
    throw new Error("QKERN_REALTIME_RETENTION_SCOPES_JSON must be an array of at most 200 scopes.");
  }
  return parsed.map((entry) => {
    const scope = entry as Partial<RealtimeScope>;
    if (typeof scope.organizationId !== "string" || typeof scope.projectId !== "string" ||
        !["development", "staging", "production"].includes(String(scope.environment))) {
      throw new Error("QKERN_REALTIME_RETENTION_SCOPES_JSON entries need organizationId, projectId and environment.");
    }
    return {
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      environment: scope.environment as RealtimeScope["environment"],
    };
  });
}
