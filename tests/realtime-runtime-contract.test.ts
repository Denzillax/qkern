import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Realtime standalone runtime contract", () => {
  it("is explicit, loopback by default and gates production through named conditions", async () => {
    // Bis 1.72 stand hier ein bedingungsloses Production-Verbot. Seit 1.73
    // traegt das Tor in production-gate.ts jede Bedingung einzeln; der Vertrag
    // verlangt, dass der Prozess durch genau dieses Tor geht und keinen
    // festen Nicht-Loopback-Host kennt.
    const source = await readFile(new URL("../workers/realtime-runtime.mts", import.meta.url), "utf8");
    expect(source).toContain('QKERN_REALTIME_ENABLED !== "true"');
    expect(source).toContain("realtimeBindPlan(process.env");
    expect(source).toContain("host: bindPlan.host");
    expect(source).toContain('runtimeModeFromEnv(process.env) !== "postgres"');
    expect(source).toContain("QKERN_REALTIME_ALLOWED_ORIGINS");
    expect(source).toContain("QKERN_REALTIME_MAX_BUFFERED_BYTES");
    expect(source).not.toContain('host: "0.0.0.0"');

    const gate = await readFile(new URL("../lib/server/realtime/production-gate.ts", import.meta.url), "utf8");
    for (const condition of ["QKERN_REALTIME_PUBLIC_BIND", "QKERN_REALTIME_EPHEMERAL_LOG",
      "QKERN_REALTIME_CURSOR_SECRET", "QKERN_REALTIME_RETENTION_SCOPES_JSON",
      "QKERN_REALTIME_TLS_TERMINATED"]) {
      expect(gate, `Das Production-Tor verliert die Bedingung ${condition}`).toContain(condition);
    }
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

  it("gives the fan-out connection the same TLS configuration as the event log", async () => {
    // Die `LISTEN`-Verbindung las bis zu diesem Slice ihre Adresse selbst und
    // liess `DATABASE_SSL` liegen. Gegen ein PostgreSQL, das Klartext abweist,
    // scheiterte sie, und weil sie vor dem Lauschen aufgebaut wird, kam der
    // Prozess unter Production nie hoch. Eine Adresse ohne Konfiguration waere
    // derselbe Fehler noch einmal.
    const source = await readFile(new URL("../workers/realtime-runtime.mts", import.meta.url), "utf8");
    expect(source).toContain("postgresPoolConfigFromEnv(process.env)");
    expect(source).toContain("new Client({ connectionString, ssl })");
    expect(source).not.toContain("new Client({ connectionString })");
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
