import type { Environment } from "@/lib/types";

/**
 * Die wirksamen Grenzen des Realtime-Transports (2.48), aus der Umgebung
 * gelesen und benannt.
 *
 * Es gibt keine Tabelle mit Realtime-Einstellungen und keine Zeile je
 * Projekt: Jede Grenze steht entweder in einer Umgebungsvariablen oder fest
 * im Code. Genau das meldet `origin`, und es gibt darum bewusst keinen
 * Ursprung `database` — ihn zu fuehren hiesse, eine Speicherung zu
 * behaupten, die es nicht gibt.
 *
 * Gelesen wird ausschliesslich die feste Liste unten. Kein Geheimnis, kein
 * Verbindungsstring und kein Token kann diesen Weg nehmen, weil kein
 * Variablenname ausserhalb dieser Liste je gelesen wird. `QKERN_REALTIME_
 * CURSOR_SECRET`, `QKERN_RUNTIME_DATABASE_URL` und die Origin-Liste stehen
 * deshalb nicht hier.
 *
 * Die Werte sind die dieses Prozesses. Der Realtime-Server laeuft als
 * eigener Prozess (`workers/realtime-runtime.mts`); startet er mit einer
 * anderen Umgebung, gelten dort seine Werte. Der Satz dazu steht in der
 * Console ueber der Tabelle und nicht im Kleingedruckten.
 */
export type RealtimeLimitOrigin = "environment" | "default" | "code";

export type RealtimeLimitUnit =
  | "connections"
  | "subscriptions"
  | "messages"
  | "events"
  | "bytes"
  | "milliseconds"
  | "levels"
  | "nodes"
  | "keys";

export type RealtimeLimitGroup = "transport" | "session" | "changes" | "retention" | "usage";

export type RealtimeLimitDefinition = {
  id: string;
  group: RealtimeLimitGroup;
  unit: RealtimeLimitUnit;
  /** Der Vorgabewert, den Runtime und Dienst ohne Angabe verwenden. */
  fallback: number;
  /**
   * Die Umgebungsvariable, falls es eine gibt. Fehlt sie, ist die Grenze im
   * Code festgelegt und laesst sich gar nicht setzen — das ist eine andere
   * Auskunft als "nicht gesetzt".
   */
  variable?: string;
  minimum?: number;
  maximum?: number;
};

/**
 * Die Grenzen in der Reihenfolge, in der sie eine Verbindung trifft: erst
 * der Transport, dann die Sitzung, dann die Aenderungen, dann das
 * Aufraeumen, zuletzt die Zaehlung.
 *
 * Die Vorgaben und Schranken sind aus `workers/realtime-runtime.mts`,
 * `websocket-server.ts`, `gateway.ts` und `service.ts` uebernommen; weicht
 * eine ab, faellt es im Vertrag `realtime-settings` auf.
 */
export const REALTIME_LIMITS: readonly RealtimeLimitDefinition[] = [
  { id: "maxConnections", group: "transport", unit: "connections", fallback: 500, variable: "QKERN_REALTIME_MAX_CONNECTIONS", minimum: 1, maximum: 10_000 },
  { id: "maxMessageBytes", group: "transport", unit: "bytes", fallback: 32 * 1024, variable: "QKERN_REALTIME_MAX_MESSAGE_BYTES", minimum: 1024, maximum: 512 * 1024 },
  { id: "maxBufferedBytes", group: "transport", unit: "bytes", fallback: 256 * 1024, variable: "QKERN_REALTIME_MAX_BUFFERED_BYTES", minimum: 16 * 1024, maximum: 16 * 1024 * 1024 },
  { id: "authTimeoutMs", group: "transport", unit: "milliseconds", fallback: 5_000, variable: "QKERN_REALTIME_AUTH_TIMEOUT_MS", minimum: 1_000, maximum: 30_000 },
  { id: "heartbeatMs", group: "transport", unit: "milliseconds", fallback: 30_000, variable: "QKERN_REALTIME_HEARTBEAT_MS", minimum: 5_000, maximum: 120_000 },
  // Fest im Code: Der WebSocket-Server reicht weder Fenster noch Anzahl an
  // die Sitzung weiter. Wer die Nachrichtenrate aendern will, aendert
  // `gateway.ts` — keine Umgebungsvariable tut es.
  { id: "messagesPerWindow", group: "transport", unit: "messages", fallback: 100 },
  { id: "rateWindowMs", group: "transport", unit: "milliseconds", fallback: 10_000 },
  { id: "maxSubscriptions", group: "session", unit: "subscriptions", fallback: 32, variable: "QKERN_REALTIME_MAX_SUBSCRIPTIONS", minimum: 1, maximum: 128 },
  { id: "replayLimit", group: "session", unit: "events", fallback: 100, variable: "QKERN_REALTIME_REPLAY_LIMIT", minimum: 1, maximum: 500 },
  { id: "maxPayloadBytes", group: "session", unit: "bytes", fallback: 16 * 1024, variable: "QKERN_REALTIME_MAX_PAYLOAD_BYTES", minimum: 256, maximum: 256 * 1024 },
  { id: "maxPresenceBytes", group: "session", unit: "bytes", fallback: 4 * 1024, variable: "QKERN_REALTIME_MAX_PRESENCE_BYTES", minimum: 128, maximum: 32 * 1024 },
  { id: "payloadDepth", group: "session", unit: "levels", fallback: 10 },
  { id: "payloadNodes", group: "session", unit: "nodes", fallback: 2_000 },
  { id: "presenceKeys", group: "session", unit: "keys", fallback: 16 },
  { id: "presenceLimit", group: "session", unit: "keys", fallback: 200, variable: "QKERN_REALTIME_PRESENCE_LIMIT", minimum: 1, maximum: 1_000 },
  { id: "presenceLeaseMs", group: "session", unit: "milliseconds", fallback: 90_000, variable: "QKERN_REALTIME_PRESENCE_LEASE_MS", minimum: 2_000, maximum: 3_600_000 },
  { id: "presenceSweepMs", group: "session", unit: "milliseconds", fallback: 15_000, variable: "QKERN_REALTIME_PRESENCE_SWEEP_MS", minimum: 1_000, maximum: 600_000 },
  { id: "changePollMs", group: "changes", unit: "milliseconds", fallback: 500, variable: "QKERN_REALTIME_CHANGE_POLL_MS", minimum: 50, maximum: 60_000 },
  { id: "changeBatch", group: "changes", unit: "events", fallback: 100, variable: "QKERN_REALTIME_CHANGE_BATCH", minimum: 1, maximum: 500 },
  { id: "changeReconcileMs", group: "changes", unit: "milliseconds", fallback: 2_000, variable: "QKERN_REALTIME_CHANGE_RECONCILE_MS", minimum: 250, maximum: 60_000 },
  { id: "historyLimit", group: "changes", unit: "events", fallback: 100, variable: "QKERN_REALTIME_HISTORY_LIMIT", minimum: 1, maximum: 500 },
  { id: "historyMaxAgeMs", group: "changes", unit: "milliseconds", fallback: 86_400_000, variable: "QKERN_REALTIME_HISTORY_MAX_AGE_MS", minimum: 60_000, maximum: 86_400_000 * 90 },
  { id: "eventRetentionMs", group: "retention", unit: "milliseconds", fallback: 7 * 86_400_000, variable: "QKERN_REALTIME_EVENT_RETENTION_MS", minimum: 60_000, maximum: 90 * 86_400_000 },
  { id: "changeRetentionMs", group: "retention", unit: "milliseconds", fallback: 86_400_000, variable: "QKERN_REALTIME_CHANGE_RETENTION_MS", minimum: 60_000, maximum: 86_400_000 * 90 },
  { id: "presenceRetentionMs", group: "retention", unit: "milliseconds", fallback: 600_000, variable: "QKERN_REALTIME_PRESENCE_RETENTION_MS", minimum: 60_000, maximum: 86_400_000 },
  { id: "retentionIntervalMs", group: "retention", unit: "milliseconds", fallback: 3_600_000, variable: "QKERN_REALTIME_RETENTION_INTERVAL_MS", minimum: 1_000, maximum: 86_400_000 },
  { id: "usageFlushAt", group: "usage", unit: "messages", fallback: 500, variable: "QKERN_REALTIME_USAGE_FLUSH_AT", minimum: 1, maximum: 100_000 },
  { id: "usageFlushMs", group: "usage", unit: "milliseconds", fallback: 15_000, variable: "QKERN_REALTIME_USAGE_FLUSH_MS", minimum: 1_000, maximum: 300_000 },
];

export type RealtimeLimit = {
  id: string;
  group: RealtimeLimitGroup;
  unit: RealtimeLimitUnit;
  /** `null`, wenn die Umgebung einen Wert traegt, den die Runtime ablehnt. */
  value: number | null;
  origin: RealtimeLimitOrigin;
  variable: string | null;
  minimum: number | null;
  maximum: number | null;
  /**
   * Wahr, wenn in der Variablen etwas steht, das keine ganze Zahl in den
   * Schranken ist. Die Runtime startet damit nicht; hier zu schweigen und
   * den Vorgabewert zu zeigen waere die gefaehrlichere Antwort.
   */
  invalid: boolean;
};

/** Was der Transport ueberhaupt tut, nicht wie weit. Drei Schalter, keine Adresse. */
export type RealtimeFeatures = {
  /** `QKERN_REALTIME_ENABLED`; ohne dieses Ja startet die Runtime nicht. */
  enabled: boolean;
  /** `QKERN_REALTIME_CHANGES_ENABLED`; ohne sie bleibt ein `changes:`-Abonnement leer. */
  changes: boolean;
  /** Dauerhafter Log statt `QKERN_REALTIME_EPHEMERAL_LOG`; nur er ueberlebt einen Neustart. */
  durableLog: boolean;
  /**
   * Dauerhafte Presence. Derselbe Schalter wie beim Log, und darum derselbe
   * Wert: Presence liegt in der Tabelle aus 0077, sobald der Log dauerhaft ist.
   * Zwei Schalter dafuer waeren zwei Halbzustaende, und einen davon gaebe es
   * nicht: Presence ohne Log hiesse eine Tabelle ohne Aufbewahrung.
   */
  durablePresence: boolean;
};

/**
 * Die Betriebszahlen, die der Dienst fuehrt — Verbindungen und Abonnements —
 * liegen im Realtime-Prozess und nur dort. Dieser Prozess haelt keinen
 * `RealtimeService`; sie hier zu melden hiesse, den Realtime-Server ueber
 * das Netz zu fragen. Das waere eine Wirkung, und die Route hat keine.
 */
export type RealtimeFigures = { available: false; reason: "separate_process" };

export type RealtimeSettings = {
  projectId: string;
  environment: Environment;
  limits: RealtimeLimit[];
  features: RealtimeFeatures;
  figures: RealtimeFigures;
};

export function realtimeLimits(env: Readonly<Record<string, string | undefined>>): RealtimeLimit[] {
  return REALTIME_LIMITS.map((definition) => {
    const base = {
      id: definition.id,
      group: definition.group,
      unit: definition.unit,
      variable: definition.variable ?? null,
      minimum: definition.minimum ?? null,
      maximum: definition.maximum ?? null,
    };
    const raw = definition.variable ? env[definition.variable] : undefined;
    if (raw === undefined || raw.trim() === "") {
      // Ohne Variable ist die Grenze im Code festgelegt, mit Variable aber
      // ohne Wert ist sie die Vorgabe. Zwei verschiedene Auskuenfte.
      return { ...base, value: definition.fallback, origin: definition.variable ? "default" as const : "code" as const, invalid: false };
    }
    const value = Number(raw);
    const minimum = definition.minimum ?? Number.NEGATIVE_INFINITY;
    const maximum = definition.maximum ?? Number.POSITIVE_INFINITY;
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      return { ...base, value: null, origin: "environment" as const, invalid: true };
    }
    return { ...base, value, origin: "environment" as const, invalid: false };
  });
}

export function realtimeFeatures(env: Readonly<Record<string, string | undefined>>): RealtimeFeatures {
  return {
    enabled: env.QKERN_REALTIME_ENABLED === "true",
    changes: env.QKERN_REALTIME_CHANGES_ENABLED === "true",
    durableLog: env.QKERN_REALTIME_EPHEMERAL_LOG !== "true",
    durablePresence: env.QKERN_REALTIME_EPHEMERAL_LOG !== "true",
  };
}

export function realtimeSettings(
  scope: { projectId: string; environment: Environment },
  env: Readonly<Record<string, string | undefined>> = process.env,
): RealtimeSettings {
  return {
    projectId: scope.projectId,
    environment: scope.environment,
    limits: realtimeLimits(env),
    features: realtimeFeatures(env),
    figures: { available: false, reason: "separate_process" },
  };
}
