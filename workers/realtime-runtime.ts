import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { getPostgresPool } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import { ProjectRealtimeAuthenticator } from "@/lib/server/realtime/auth";
import { RealtimeCursorCodec } from "@/lib/server/realtime/cursor";
import {
  PostgresRealtimeEventBus,
  type ListenConnection,
} from "@/lib/server/realtime/event-bus";
import { PrefixRealtimeAuthorization } from "@/lib/server/realtime/policy";
import { PostgresRealtimeEventLog } from "@/lib/server/realtime/postgres-repository";
import { MemoryRealtimeEventLog } from "@/lib/server/realtime/repository";
import { RealtimeService } from "@/lib/server/realtime/service";
import { createRealtimeWebSocketServer } from "@/lib/server/realtime/websocket-server";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";

if (process.env.QKERN_REALTIME_ENABLED !== "true") {
  throw new Error("QKERN Realtime is disabled. Set QKERN_REALTIME_ENABLED=true explicitly.");
}
if (process.env.NODE_ENV === "production") {
  throw new Error("Realtime Alpha 1 transport is local-only. Production requires the documented TLS, persistent event-log and fan-out gates.");
}
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
    const connectionString = process.env.QKERN_RUNTIME_DATABASE_URL?.trim();
    if (!connectionString) throw new Error("QKERN_RUNTIME_DATABASE_URL is required for Realtime fan-out.");
    const { Client } = createRequire(import.meta.url)("pg") as {
      Client: new (config: { connectionString: string }) => ListenConnection & { connect(): Promise<void> };
    };
    const client = new Client({ connectionString });
    await client.connect();
    return client;
  },
});
const cursorSecret = process.env.QKERN_REALTIME_CURSOR_SECRET?.trim();
const cursorBytes = cursorSecret ? Buffer.from(cursorSecret, "base64url") : randomBytes(32);
const service = new RealtimeService({
  eventLog,
  eventBus,
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
  host: "127.0.0.1",
  port: integer("QKERN_REALTIME_PORT", 8788, 1, 65_535),
  maxConnections: integer("QKERN_REALTIME_MAX_CONNECTIONS", 500, 1, 10_000),
  maxMessageBytes: integer("QKERN_REALTIME_MAX_MESSAGE_BYTES", 32 * 1024, 1024, 512 * 1024),
  maxBufferedBytes: integer("QKERN_REALTIME_MAX_BUFFERED_BYTES", 256 * 1024, 16 * 1024, 16 * 1024 * 1024),
  authTimeoutMs: integer("QKERN_REALTIME_AUTH_TIMEOUT_MS", 5_000, 1_000, 30_000),
  heartbeatMs: integer("QKERN_REALTIME_HEARTBEAT_MS", 30_000, 5_000, 120_000),
});

await eventBus?.subscribe((reference) => { void service.deliverRemote(reference); });

// Postgres Changes sind in dieser Runtime noch nicht betriebsbereit.
// RealtimeChangePollerRegistry, PostgresRealtimeChangeSource und
// GeneratedApiRealtimeChangeReader existieren und sind zertifiziert, aber diese
// Runtime besitzt keinen Port, der je Scope eine Projektdatenbank aufloest. Ein
// `changes:`-Abonnement bleibt hier deshalb leer.
//
// Bewusst kein Platzhalter, der beim ersten Gebrauch wirft: Eine Verdrahtung,
// die vorhanden aussieht und dann abstuerzt, ist schlechter als eine fehlende.
// Zu verbinden sind ControlPlaneDataTargetResolver aus data-plane/runtime und
// der Katalog aus migrations/connection-catalog-env.

const port = await runtime.listen();
console.error(
  `QKERN Realtime listening on ws://127.0.0.1:${port} with protocol qkern.realtime.v1 `
  + `(${ephemeralLog ? "ephemeral log, single instance" : "durable log, cross-instance fan-out"})`,
);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await runtime.close();
  await eventBus?.close();
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
