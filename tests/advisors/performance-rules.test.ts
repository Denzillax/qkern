import { describe, expect, it } from "vitest";
import {
  evaluatePerformanceRules,
  type PerformanceAdvisorIndex,
  type PerformanceAdvisorInput,
  type PerformanceAdvisorTable,
} from "@/lib/server/advisors/performance-rules";
import { PERFORMANCE_CHECK_REASONS, PERFORMANCE_RULE_IDS, PERFORMANCE_THRESHOLDS } from "@/lib/console/performance-advisor-texts";

/** Die Regeln des Leistungsberaters (2.40): jede feuert, jede schweigt, und die Schwelle selbst zaehlt schon. */
const limits = PERFORMANCE_THRESHOLDS;

function table(name: string, overrides: Partial<PerformanceAdvisorTable> = {}): PerformanceAdvisorTable {
  return {
    name, seqScan: 0, seqTupRead: 0, idxScan: 0, liveTuples: 0, deadTuples: 0,
    lastAutovacuum: "2026-09-20T00:00:00Z", lastAnalyze: "2026-09-20T00:00:00Z", ...overrides,
  };
}

function index(name: string, overrides: Partial<PerformanceAdvisorIndex> = {}): PerformanceAdvisorIndex {
  return { name, table: "orders", scans: 0, sizeBytes: limits.unusedIndexMinBytes, isUnique: false, isPrimary: false, ...overrides };
}

function input(overrides: Partial<PerformanceAdvisorInput> = {}): PerformanceAdvisorInput {
  return {
    statistics: { schema: "public", tables: [], indexes: [], truncated: false },
    statements: { unavailable: "statementsNotRead" },
    ...overrides,
  };
}

function statistics(tables: PerformanceAdvisorTable[], indexes: PerformanceAdvisorIndex[] = [], truncated = false): PerformanceAdvisorInput["statistics"] {
  return { schema: "public", tables, indexes, truncated };
}

const rules = (result: ReturnType<typeof evaluatePerformanceRules>) => result.findings.map((item) => `${item.rule}:${item.object.name}`);

describe("performance advisor rules", () => {
  it("reports nothing for a healthy schema and lists every rule in the checks", () => {
    const result = evaluatePerformanceRules(input({
      statistics: statistics(
        [table("orders", { seqScan: 4, seqTupRead: 400, idxScan: 9000, liveTuples: 50_000, deadTuples: 120 })],
        [index("orders_customer_idx", { scans: 8000, sizeBytes: 20 * limits.unusedIndexMinBytes })],
      ),
    }));
    expect(result.findings).toEqual([]);
    expect(result.checks.map((item) => item.rule)).toEqual([...PERFORMANCE_RULE_IDS]);
    expect(result.checks.filter((item) => !item.ran).map((item) => item.rule)).toEqual(["slow_statement"]);
    expect(result.checks.find((item) => item.rule === "slow_statement")).toEqual({
      rule: "slow_statement", ran: false, reason: PERFORMANCE_CHECK_REASONS.statementsNotRead,
    });
  });

  it("unused_index fires only for a big, unused, ordinary index", () => {
    const result = evaluatePerformanceRules(input({ statistics: statistics([], [
      index("a_unused"),
      index("b_primary", { isPrimary: true }),
      index("c_unique", { isUnique: true }),
      index("d_used", { scans: 1 }),
      index("e_small", { sizeBytes: limits.unusedIndexMinBytes - 1 }),
    ]) }));
    expect(rules(result)).toEqual(["unused_index:a_unused"]);
    expect(result.findings[0]).toMatchObject({ id: "unused_index:index:a_unused", severity: "low", object: { kind: "index", name: "a_unused" } });
    expect(result.findings[0].summary).toMatch(/Eine frische Datenbank hat noch keine Statistik/);
  });

  it("missing_index_suspected fires on the threshold and stays silent one step below it", () => {
    const fires = table("hot", { seqScan: limits.missingIndexMinSeqScans, idxScan: limits.missingIndexMinSeqScans / limits.missingIndexSeqToIdxFactor, liveTuples: limits.missingIndexMinLiveTuples });
    const result = evaluatePerformanceRules(input({ statistics: statistics([
      fires,
      { ...fires, name: "few_scans", seqScan: limits.missingIndexMinSeqScans - 1 },
      { ...fires, name: "indexed", idxScan: fires.idxScan + 1 },
      { ...fires, name: "small", liveTuples: limits.missingIndexMinLiveTuples - 1 },
    ]) }));
    expect(rules(result)).toEqual(["missing_index_suspected:hot"]);
    expect(result.findings[0].severity).toBe("medium");
    expect(result.findings[0].summary).toMatch(/ab 50 Scans/);
  });

  it("bloat_suspected needs both the absolute floor and the share of live rows", () => {
    const result = evaluatePerformanceRules(input({ statistics: statistics([
      table("a_bloated", { liveTuples: 5000, deadTuples: 1000 }),
      table("b_floor", { liveTuples: 10, deadTuples: limits.bloatMinDeadTuples - 1 }),
      table("c_share", { liveTuples: 100_000, deadTuples: 1500 }),
    ]) }));
    expect(rules(result)).toEqual(["bloat_suspected:a_bloated"]);
    expect(result.findings[0].severity).toBe("low");
  });

  it("never_analyzed fires only without any analyze and without any autovacuum", () => {
    const result = evaluatePerformanceRules(input({ statistics: statistics([
      table("a_untouched", { liveTuples: limits.neverAnalyzedMinLiveTuples, lastAnalyze: null, lastAutovacuum: null }),
      table("b_analyzed", { liveTuples: 10_000, lastAnalyze: "2026-09-25T10:00:00Z", lastAutovacuum: null }),
      table("c_vacuumed", { liveTuples: 10_000, lastAnalyze: null, lastAutovacuum: "2026-09-25T10:00:00Z" }),
      table("d_tiny", { liveTuples: limits.neverAnalyzedMinLiveTuples - 1, lastAnalyze: null, lastAutovacuum: null }),
    ]) }));
    expect(rules(result)).toEqual(["never_analyzed:a_untouched"]);
  });

  it("marks every rule of a missing statistics source as not run, with the reason", () => {
    const result = evaluatePerformanceRules(input({ statistics: { unavailable: "databaseDisabled" } }));
    expect(result.findings).toEqual([]);
    expect(result.checks.filter((item) => item.ran)).toEqual([]);
    for (const rule of ["missing_index_suspected", "bloat_suspected", "never_analyzed", "unused_index"] as const) {
      expect(result.checks.find((item) => item.rule === rule)?.reason, rule).toBe(PERFORMANCE_CHECK_REASONS.databaseDisabled);
    }
  });

  it("keeps running on a truncated statistics list and says so", () => {
    const result = evaluatePerformanceRules(input({
      statistics: statistics([table("a", { liveTuples: 5000, deadTuples: 4000 })], [index("i")], true),
    }));
    expect(rules(result)).toEqual(["bloat_suspected:a", "unused_index:i"]);
    for (const check of result.checks.filter((item) => item.rule !== "slow_statement")) {
      expect(check, check.rule).toEqual({ rule: check.rule, ran: true, reason: PERFORMANCE_CHECK_REASONS.statisticsTruncated });
    }
  });

  it("slow_statement takes the most expensive statements above the floor when a source is given", () => {
    const entries = [
      { id: "s1", totalTimeMs: 90_000, calls: 10, text: "SELECT $1" },
      { id: "s2", totalTimeMs: limits.slowStatementMinTotalMs, calls: 4000, text: null },
      { id: "s3", totalTimeMs: limits.slowStatementMinTotalMs - 1, calls: 2, text: "SELECT $2" },
    ];
    const result = evaluatePerformanceRules(input({ statements: { entries } }));
    expect(result.findings.map((item) => item.id)).toEqual(["slow_statement:statement:s1", "slow_statement:statement:s2"]);
    // Ohne sicheren Text nennt der Befund nur die Kennung.
    expect(result.findings.map((item) => item.object.name)).toEqual(["SELECT $1", "s2"]);
    expect(result.checks.find((item) => item.rule === "slow_statement")).toEqual({ rule: "slow_statement", ran: true });
    const unavailable = evaluatePerformanceRules(input({ statements: { unavailable: "statementsUnavailable" } }));
    expect(unavailable.checks.find((item) => item.rule === "slow_statement")).toEqual({
      rule: "slow_statement", ran: false, reason: PERFORMANCE_CHECK_REASONS.statementsUnavailable,
    });
  });

  it("sorts by severity, then by object, and is deterministic", () => {
    const build = (reverse: boolean) => {
      const tables = [
        table("zeta", { seqScan: 100, idxScan: 0, liveTuples: 5000 }),
        table("alpha", { seqScan: 100, idxScan: 0, liveTuples: 5000 }),
        table("mid", { liveTuples: 5000, deadTuples: 4000 }),
      ];
      const indexes = [index("i2"), index("i1")];
      return evaluatePerformanceRules(input({
        statistics: statistics(reverse ? [...tables].reverse() : tables, reverse ? [...indexes].reverse() : indexes),
      }));
    };
    const first = build(false);
    expect(first.findings.map((item) => `${item.severity}:${item.object.name}`)).toEqual([
      "medium:alpha", "medium:zeta", "low:i1", "low:i2", "low:mid",
    ]);
    expect(build(true)).toEqual(first);
  });
});
