import { describe, expect, it } from "vitest";
import {
  countStaleCron,
  evaluateHealthRules,
  HEALTH_REASON_STATES,
  type HealthAdvisorInput,
} from "@/lib/server/advisors/health-rules";
import {
  HEALTH_DETAILS,
  HEALTH_MEASURES,
  HEALTH_STATES,
  HEALTH_SUBSYSTEM_IDS,
  type HealthState,
} from "@/lib/console/health-advisor-texts";

/**
 * Das Regelmodul der Projekt-Gesundheit (2.44): rein, in fester Reihenfolge,
 * und ohne jede Stelle, an der etwas Geheimes in einen Beleg geraten koennte.
 */
const NOW = new Date("2026-09-26T12:00:00.000Z");

/** Eine Eingabe, in der jeder Teil erreichbar und eingerichtet ist. */
function healthy(overrides: Partial<HealthAdvisorInput> = {}): HealthAdvisorInput {
  return {
    now: NOW,
    database: { tables: 12 },
    dataApi: { exposedTables: 7 },
    auth: { providers: 2, signingKeys: 1 },
    storage: { buckets: 3 },
    compute: { functions: 2, sandboxConfigured: true },
    queuesCron: { queues: 1, cronDefinitions: 1, cronStale: 0 },
    realtime: { configured: true },
    vault: { connected: true },
    ...overrides,
  };
}

function stateOf(result: ReturnType<typeof evaluateHealthRules>, id: string): HealthState {
  return result.subsystems.find((subsystem) => subsystem.id === id)!.state;
}

describe("health rules", () => {
  it("reports every subsystem in a fixed order and calls a healthy environment ok", () => {
    const result = evaluateHealthRules(healthy());
    expect(result.subsystems.map((subsystem) => subsystem.id)).toEqual([...HEALTH_SUBSYSTEM_IDS]);
    expect(result.subsystems.every((subsystem) => subsystem.state === "ok")).toBe(true);
    expect(result.overall).toBe("ok");
    expect(result.counts).toEqual({ ok: 8, off: 0, unconfigured: 0, unknown: 0, degraded: 0 });
    expect(result.subsystems[0].detail).toBe(HEALTH_DETAILS.databaseCatalogRead);
    expect(result.subsystems[0].evidence).toEqual([
      { measure: "tables", label: HEALTH_MEASURES.tables, count: 12 },
    ]);
  });

  it("produces each of the five states from the input that deserves it", () => {
    const result = evaluateHealthRules(healthy({
      // abgeschaltet
      database: { unavailable: "disabled" },
      // nicht eingerichtet: die Data API gibt keine Tabelle frei
      dataApi: { exposedTables: 0 },
      // gestoert: ohne Signaturschluessel kann der Dienst kein Token ausstellen
      auth: { providers: 1, signingKeys: 0 },
      // unbekannt: die Rolle darf die Buckets nicht lesen
      storage: { unavailable: "forbidden" },
    }));
    expect(stateOf(result, "database")).toBe("off");
    expect(stateOf(result, "data_api")).toBe("unconfigured");
    expect(stateOf(result, "auth")).toBe("degraded");
    expect(stateOf(result, "storage")).toBe("unknown");
    expect(stateOf(result, "compute")).toBe("ok");
    expect(new Set(result.subsystems.map((subsystem) => subsystem.state)).size).toBe(5);
  });

  it("makes the overall verdict the worst state present, never an average", () => {
    expect(evaluateHealthRules(healthy({ database: { unavailable: "disabled" } })).overall).toBe("off");
    expect(evaluateHealthRules(healthy({
      database: { unavailable: "disabled" }, storage: { buckets: 0 },
    })).overall).toBe("unconfigured");
    expect(evaluateHealthRules(healthy({
      database: { unavailable: "disabled" }, storage: { buckets: 0 }, compute: { unavailable: "consoleOnly" },
    })).overall).toBe("unknown");
    // Ein einziger gestoerter Teil schlaegt sieben erreichbare.
    const degraded = evaluateHealthRules(healthy({ queuesCron: { queues: 2, cronDefinitions: 2, cronStale: 1 } }));
    expect(degraded.overall).toBe("degraded");
    expect(degraded.counts.ok).toBe(7);
    expect(degraded.subsystems.find((subsystem) => subsystem.id === "queues_cron")!.detail)
      .toBe(HEALTH_DETAILS.cronNeverDispatched);
  });

  it("says unknown with a reason instead of guessing when a probe could not run", () => {
    for (const reason of ["forbidden", "consoleOnly", "noProbe"] as const) {
      const result = evaluateHealthRules(healthy({ compute: { unavailable: reason } }));
      const compute = result.subsystems.find((subsystem) => subsystem.id === "compute")!;
      expect(compute.state).toBe("unknown");
      expect(compute.detail).toBe(HEALTH_DETAILS[reason]);
      expect(compute.evidence).toHaveLength(1);
      expect(compute.evidence[0].count).toBeNull();
    }
    // Jeder Grund hat einen Zustand, und keiner davon ist "ok".
    for (const state of Object.values(HEALTH_REASON_STATES)) expect(state).not.toBe("ok");
  });

  it("separates a switched-off service from an unconfigured and an unreachable one", () => {
    expect(stateOf(evaluateHealthRules(healthy({ storage: { unavailable: "disabled" } })), "storage")).toBe("off");
    expect(stateOf(evaluateHealthRules(healthy({ storage: { unavailable: "notReady" } })), "storage")).toBe("unconfigured");
    expect(stateOf(evaluateHealthRules(healthy({ storage: { unavailable: "unavailable" } })), "storage")).toBe("degraded");
    expect(stateOf(evaluateHealthRules(healthy({ realtime: { configured: false } })), "realtime")).toBe("unconfigured");
    expect(stateOf(evaluateHealthRules(healthy({ vault: { connected: false } })), "vault")).toBe("unconfigured");
    expect(stateOf(evaluateHealthRules(healthy({ compute: { functions: 1, sandboxConfigured: false } })), "compute")).toBe("unconfigured");
  });

  it("gives the same answer twice, in the same order", () => {
    const input = healthy({ auth: { unavailable: "forbidden" }, dataApi: { exposedTables: 0 } });
    expect(JSON.stringify(evaluateHealthRules(input))).toBe(JSON.stringify(evaluateHealthRules(input)));
    const counted = HEALTH_STATES.reduce((sum, state) => sum + evaluateHealthRules(input).counts[state], 0);
    expect(counted).toBe(HEALTH_SUBSYSTEM_IDS.length);
  });

  it("carries only fixed texts and numbers, so no secret fits into a report", () => {
    const details = new Set<string>(Object.values(HEALTH_DETAILS));
    const labels = new Set<string>(Object.values(HEALTH_MEASURES));
    const measures = new Set<string>(Object.keys(HEALTH_MEASURES));
    const inputs: HealthAdvisorInput[] = [
      healthy(),
      healthy({
        database: { unavailable: "unavailable" }, dataApi: { unavailable: "notReady" },
        auth: { providers: 0, signingKeys: 0 }, storage: { buckets: 0 },
        compute: { functions: 0, sandboxConfigured: false },
        queuesCron: { queues: 0, cronDefinitions: 0, cronStale: 0 },
        realtime: { configured: false }, vault: { unavailable: "forbidden" },
      }),
    ];
    for (const input of inputs) {
      for (const subsystem of evaluateHealthRules(input).subsystems) {
        expect(details.has(subsystem.detail), subsystem.detail).toBe(true);
        for (const evidence of subsystem.evidence) {
          expect(measures.has(evidence.measure)).toBe(true);
          expect(labels.has(evidence.label), evidence.label).toBe(true);
          expect(evidence.count === null || Number.isInteger(evidence.count)).toBe(true);
        }
        expect(Object.keys(subsystem).sort()).toEqual(["detail", "evidence", "id", "state"]);
      }
    }
  });

  it("counts a cron definition as stale only after its own interval has passed twice over", () => {
    const definition = {
      expression: "0 * * * *", enabled: true,
      createdAt: "2026-09-26T09:05:00.000Z", lastDispatchedAt: null,
    };
    // Erstes Vorkommen 10:00, zweites 11:00. Um 10:30 ist noch nichts zu sagen.
    expect(countStaleCron([definition], new Date("2026-09-26T10:30:00.000Z"))).toBe(0);
    expect(countStaleCron([definition], new Date("2026-09-26T11:00:00.000Z"))).toBe(1);
    // Ausgeloest, abgeschaltet oder mit unbrauchbarem Ausdruck: kein Befund.
    expect(countStaleCron([{ ...definition, lastDispatchedAt: "2026-09-26T10:00:00.000Z" }], NOW)).toBe(0);
    expect(countStaleCron([{ ...definition, enabled: false }], NOW)).toBe(0);
    expect(countStaleCron([{ ...definition, expression: "kein Ausdruck" }], NOW)).toBe(0);
    expect(countStaleCron([{ ...definition, createdAt: "nicht datierbar" }], NOW)).toBe(0);
    expect(countStaleCron([], NOW)).toBe(0);
  });
});
