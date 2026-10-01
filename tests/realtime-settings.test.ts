import { describe, expect, it } from "vitest";
import {
  REALTIME_LIMITS,
  realtimeFeatures,
  realtimeLimits,
  realtimeSettings,
} from "@/lib/server/realtime/settings";

/**
 * Die Grenzen des Realtime-Transports (2.48) werden aus der Umgebung
 * zusammengesetzt, nicht behauptet. Der Test prueft genau die drei Faelle,
 * die in der Console unterschiedlich aussehen muessen: gesetzt, nicht
 * gesetzt, und gesetzt mit Unsinn. Und er prueft, dass kein Geheimnis den
 * Weg nach draussen findet.
 */
const scope = { projectId: "project", environment: "development" as const };

function limit(env: Record<string, string | undefined>, id: string) {
  const found = realtimeLimits(env).find((entry) => entry.id === id);
  expect(found, id).toBeDefined();
  return found!;
}

describe("realtime settings", () => {
  it("names the environment as origin when the variable carries a value", () => {
    const found = limit({ QKERN_REALTIME_MAX_CONNECTIONS: "1200" }, "maxConnections");
    expect(found).toMatchObject({
      value: 1200, origin: "environment", unit: "connections",
      variable: "QKERN_REALTIME_MAX_CONNECTIONS", invalid: false,
    });
  });

  it("falls back to the default and says so when the variable is missing", () => {
    const found = limit({}, "maxConnections");
    expect(found).toMatchObject({ value: 500, origin: "default", invalid: false });
    // Eine leere Variable ist keine Angabe.
    expect(limit({ QKERN_REALTIME_MAX_CONNECTIONS: "  " }, "maxConnections").origin).toBe("default");
  });

  it("separates a limit without any variable from a limit whose variable is unset", () => {
    const rate = limit({}, "messagesPerWindow");
    expect(rate).toMatchObject({ value: 100, origin: "code", variable: null, invalid: false });
    // Die Nachrichtenrate ist im Gateway festgelegt; der WebSocket-Server
    // reicht sie nicht durch, und keine Umgebungsvariable erreicht sie.
    expect(limit({ QKERN_REALTIME_MESSAGES_PER_WINDOW: "5000" }, "messagesPerWindow").value).toBe(100);
    expect(limit({}, "rateWindowMs")).toMatchObject({ value: 10_000, origin: "code" });
  });

  it("reports an unusable value as invalid instead of pretending the default applies", () => {
    for (const raw of ["0", "10001", "abc", "12.5", "-1"]) {
      const found = limit({ QKERN_REALTIME_MAX_CONNECTIONS: raw }, "maxConnections");
      expect(found, raw).toMatchObject({ value: null, origin: "environment", invalid: true });
    }
  });

  it("keeps every default and bound the runtime itself uses", () => {
    const defaults = new Map(REALTIME_LIMITS.map((entry) => [entry.id, entry]));
    expect(defaults.get("maxMessageBytes")).toMatchObject({ fallback: 32 * 1024, minimum: 1024, maximum: 512 * 1024 });
    expect(defaults.get("maxBufferedBytes")).toMatchObject({ fallback: 256 * 1024 });
    expect(defaults.get("maxSubscriptions")).toMatchObject({ fallback: 32, maximum: 128 });
    expect(defaults.get("replayLimit")).toMatchObject({ fallback: 100, maximum: 500 });
    expect(defaults.get("maxPayloadBytes")).toMatchObject({ fallback: 16 * 1024 });
    expect(defaults.get("maxPresenceBytes")).toMatchObject({ fallback: 4 * 1024 });
    expect(defaults.get("heartbeatMs")).toMatchObject({ fallback: 30_000, minimum: 5_000, maximum: 120_000 });
    expect(defaults.get("eventRetentionMs")).toMatchObject({ fallback: 7 * 86_400_000 });
    expect(defaults.get("changeRetentionMs")).toMatchObject({ fallback: 86_400_000 });
    // Jede Grenze traegt eine Einheit und eine Gruppe, keine ist doppelt.
    expect(new Set(REALTIME_LIMITS.map((entry) => entry.id)).size).toBe(REALTIME_LIMITS.length);
    for (const entry of REALTIME_LIMITS) {
      expect(entry.unit, entry.id).toMatch(/\S/);
      expect(entry.group, entry.id).toMatch(/\S/);
      if (entry.variable) expect(entry.variable, entry.id).toMatch(/^QKERN_REALTIME_[A-Z_]+$/);
    }
  });

  it("reads the four switches without ever reading an address", () => {
    expect(realtimeFeatures({})).toEqual({
      enabled: false, changes: false, durableLog: true, durablePresence: true,
    });
    expect(realtimeFeatures({
      QKERN_REALTIME_ENABLED: "true",
      QKERN_REALTIME_CHANGES_ENABLED: "true",
      QKERN_REALTIME_EPHEMERAL_LOG: "true",
    })).toEqual({
      enabled: true, changes: true, durableLog: false, durablePresence: false,
    });
    // Nur das ausdrueckliche Ja zaehlt, wie in der Runtime.
    expect(realtimeFeatures({ QKERN_REALTIME_ENABLED: "1" }).enabled).toBe(false);
  });

  it("lets no secret, no connection string and no origin list into the answer", () => {
    const env = {
      QKERN_REALTIME_CURSOR_SECRET: "c3VwZXItZ2VoZWlt",
      QKERN_RUNTIME_DATABASE_URL: "postgres://user:hunter2@db.internal:5432/qkern",
      QKERN_REALTIME_ALLOWED_ORIGINS: "https://console.example",
      QKERN_REALTIME_RETENTION_SCOPES_JSON: '[{"organizationId":"org","projectId":"p","environment":"development"}]',
      QKERN_LOCAL_PROJECT_DATA_API_CATALOG_JSON: '{"dsn":"postgres://secret"}',
      QKERN_REALTIME_MAX_CONNECTIONS: "42",
    };
    const serialized = JSON.stringify(realtimeSettings(scope, env));
    for (const secret of ["c3VwZXItZ2VoZWlt", "hunter2", "postgres://", "console.example", "dsn"]) {
      expect(serialized, secret).not.toContain(secret);
    }
    // Variablennamen ja, Werte nein — der Name ist die Auskunft, wo zu drehen ist.
    expect(serialized).toContain("QKERN_REALTIME_MAX_CONNECTIONS");
    expect(serialized).not.toContain("QKERN_REALTIME_CURSOR_SECRET");
  });

  it("says plainly that it has no operating figures instead of showing zeros", () => {
    const settings = realtimeSettings(scope, {});
    expect(settings.figures).toEqual({ available: false, reason: "separate_process" });
    expect(settings.projectId).toBe("project");
    expect(settings.environment).toBe("development");
    expect(settings.limits.length).toBe(REALTIME_LIMITS.length);
    // Es gibt keinen Ursprung `database`: keine Grenze steht in einer Tabelle.
    expect(new Set(settings.limits.map((entry) => entry.origin))).toEqual(new Set(["default", "code"]));
  });
});
