import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Realtime standalone runtime contract", () => {
  it("is explicit, loopback-only and refuses the incomplete production topology", async () => {
    const source = await readFile(new URL("../workers/realtime-runtime.mts", import.meta.url), "utf8");
    expect(source).toContain('QKERN_REALTIME_ENABLED !== "true"');
    expect(source).toContain('process.env.NODE_ENV === "production"');
    expect(source).toContain('runtimeModeFromEnv(process.env) !== "postgres"');
    expect(source).toContain('host: "127.0.0.1"');
    expect(source).toContain("QKERN_REALTIME_ALLOWED_ORIGINS");
    expect(source).toContain("QKERN_REALTIME_MAX_BUFFERED_BYTES");
    expect(source).not.toContain('host: "0.0.0.0"');
  });

  it("uses the durable event log by default and the ephemeral one only on request", async () => {
    // Bis Release 1.14 lief die Runtime auf dem Memory-Log, obwohl der
    // dauerhafte Adapter seit 1.11 zertifiziert war: Ereignisse gingen bei
    // jedem Neustart verloren und erreichten keine zweite Instanz.
    const source = await readFile(new URL("../workers/realtime-runtime.mts", import.meta.url), "utf8");
    expect(source).toContain("new PostgresRealtimeEventLog(new PostgresControlPlane(getPostgresPool()))");
    expect(source).toContain('QKERN_REALTIME_EPHEMERAL_LOG === "true"');
    // Der Memory-Log darf nur hinter dem ausdruecklichen Opt-in stehen, nie als
    // stiller Rückfall.
    const memoryIndex = source.indexOf("new MemoryRealtimeEventLog");
    const optInIndex = source.indexOf("ephemeralLog");
    expect(memoryIndex).toBeGreaterThan(optInIndex);
    expect(optInIndex).toBeGreaterThan(-1);
  });

  it("connects the cross-instance bus and closes it on shutdown", async () => {
    const source = await readFile(new URL("../workers/realtime-runtime.mts", import.meta.url), "utf8");
    expect(source).toContain("new PostgresRealtimeEventBus(");
    expect(source).toContain("void service.deliverRemote(reference)");
    expect(source).toContain("await eventBus?.close()");
  });

  it("wires Postgres Changes behind an explicit opt-in and stops them on shutdown", async () => {
    // Bis Release 1.15 blieb ein `changes:`-Abonnement hier leer: Registry,
    // Quelle und Reader waren zertifiziert, aber die Runtime besass keinen
    // Port, der je Scope eine Projektdatenbank aufloest.
    const source = await readFile(new URL("../workers/realtime-runtime.mts", import.meta.url), "utf8");
    expect(source).toContain('QKERN_REALTIME_CHANGES_ENABLED === "true"');
    expect(source).toContain("new ControlPlaneRealtimeProjectConnection(");
    expect(source).toContain("new RealtimeChangePollerRegistry(");
    expect(source).toContain("await changeRegistry?.stop()");
    expect(source).toContain("clearInterval(reconcileTimer)");
    // Ohne Opt-in darf weder ein Reader noch eine Quelle entstehen.
    expect(source).toContain("const changeReader = changesEnabled");
    expect(source).toContain("const changeSource = changesEnabled");
  });

  it("keeps poller errors out of this process log", async () => {
    // Eine Datenbankmeldung kann Tabellennamen oder Werte enthalten.
    const source = await readFile(new URL("../workers/realtime-runtime.mts", import.meta.url), "utf8");
    expect(source).toContain("onError: () => undefined");
  });

  it("exposes the runtime through the package script without embedding credentials", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts.realtime).toBe("node --import tsx workers/realtime-runtime.mts");
    expect(packageJson.scripts.realtime).not.toMatch(/qk_(public|service)_/);
  });
});
