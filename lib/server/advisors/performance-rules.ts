import {
  PERFORMANCE_CHECK_REASONS,
  PERFORMANCE_RULE_IDS,
  PERFORMANCE_RULES,
  PERFORMANCE_THRESHOLDS,
  type PerformanceCheckReason,
  type PerformanceRuleId,
  type PerformanceSeverity,
} from "@/lib/console/performance-advisor-texts";

/**
 * Die Regeln des Leistungsberaters (2.40), rein und ohne Ein- und Ausgabe.
 *
 * Eingabe ist die Statistik einer Umgebung: Scans, Zeilen, Aufraeumzeiten je
 * Tabelle und Scans und Groesse je Index. Das sind Zaehler des
 * Statistiksammlers, keine Daten aus den Tabellen. Jede Quelle kann fehlen;
 * dann steht in `checks`, welche Regel deshalb nicht lief und warum. Nichts
 * hier schreibt, nichts repariert, und nichts setzt einen Zaehler zurueck.
 * Gleiche Eingabe gibt gleiche Ausgabe, auch in derselben Reihenfolge.
 *
 * Jeder Befund ist ein Verdacht aus Zaehlern. Die Zaehler laufen seit dem
 * letzten Reset und seit dem Start des Clusters; eine frische Datenbank hat
 * gar keine. Deshalb sagen die Texte, was sie nicht wissen.
 */

export type PerformanceFinding = {
  id: string;
  rule: PerformanceRuleId;
  severity: PerformanceSeverity;
  object: { kind: "table" | "index" | "statement"; name: string };
  summary: string;
  remedy: string;
};

export type PerformanceCheck = { rule: PerformanceRuleId; ran: boolean; reason?: string };

export type PerformanceAdvisorTable = {
  name: string;
  seqScan: number;
  seqTupRead: number;
  idxScan: number;
  liveTuples: number;
  deadTuples: number;
  /** ISO-Zeitpunkt oder null, wenn Autovacuum die Tabelle nie angefasst hat. */
  lastAutovacuum: string | null;
  /** Letzte Stichprobe, manuell oder automatisch; null heisst: nie eine. */
  lastAnalyze: string | null;
};

export type PerformanceAdvisorIndex = {
  name: string;
  table: string;
  scans: number;
  sizeBytes: number;
  isUnique: boolean;
  isPrimary: boolean;
};

/**
 * Ein Eintrag aus `pg_stat_statements`, auf den sicheren Teil reduziert (2.57).
 *
 * Bis 2.56 hatte dieser Typ ein Feld `text`, das nie gefuellt wurde, weil
 * die Route die Sicht gar nicht las. Ein Feld, das einen Abfragetext tragen
 * koennte, ist jetzt ersatzlos weg: Was es nicht gibt, kann auch nicht aus
 * Versehen gefuellt werden. Der Befund nennt darum die normalisierte
 * Kennung, und die ist ein Hash ueber den Abfragebaum, kein Text.
 */
export type PerformanceAdvisorStatement = {
  id: string;
  totalTimeMs: number;
  calls: number;
};

type Unavailable = { unavailable: PerformanceCheckReason };

export type PerformanceAdvisorInput = {
  statistics: Unavailable | {
    schema: string;
    tables: PerformanceAdvisorTable[];
    indexes: PerformanceAdvisorIndex[];
    truncated: boolean;
  };
  statements: Unavailable | { entries: PerformanceAdvisorStatement[] };
};

export type PerformanceAdvisorResult = { findings: PerformanceFinding[]; checks: PerformanceCheck[] };

const SEVERITY_ORDER: Record<PerformanceSeverity, number> = { high: 0, medium: 1, low: 2 };

const TABLE_RULES: PerformanceRuleId[] = ["missing_index_suspected", "bloat_suspected", "never_analyzed"];

function finding(rule: PerformanceRuleId, kind: PerformanceFinding["object"]["kind"], name: string, key = name): PerformanceFinding {
  const text = PERFORMANCE_RULES[rule];
  return { id: `${rule}:${kind}:${key}`, rule, severity: text.severity, object: { kind, name }, summary: text.summary, remedy: text.remedy };
}

function check(rule: PerformanceRuleId, ran: boolean, reason?: PerformanceCheckReason): PerformanceCheck {
  return reason ? { rule, ran, reason: PERFORMANCE_CHECK_REASONS[reason] } : { rule, ran };
}

export function evaluatePerformanceRules(input: PerformanceAdvisorInput): PerformanceAdvisorResult {
  const findings: PerformanceFinding[] = [];
  const checks = new Map<PerformanceRuleId, PerformanceCheck>();
  const limits = PERFORMANCE_THRESHOLDS;

  if ("unavailable" in input.statistics) {
    for (const rule of [...TABLE_RULES, "unused_index" as const]) checks.set(rule, check(rule, false, input.statistics.unavailable));
  } else {
    const statistics = input.statistics;
    // Abgeschnittene Statistik: die gefundenen Befunde stimmen, es koennen nur
    // weitere fehlen. Anders als bei den Policies in 2.39 braucht keine Regel
    // hier die vollstaendige Liste, denn jeder Befund haengt an einer Zeile.
    const note: PerformanceCheckReason | undefined = statistics.truncated ? "statisticsTruncated" : undefined;

    for (const table of statistics.tables) {
      if (table.seqScan >= limits.missingIndexMinSeqScans &&
          table.idxScan * limits.missingIndexSeqToIdxFactor <= table.seqScan &&
          table.liveTuples >= limits.missingIndexMinLiveTuples) {
        findings.push(finding("missing_index_suspected", "table", table.name));
      }
      if (table.deadTuples >= limits.bloatMinDeadTuples &&
          table.deadTuples >= table.liveTuples * limits.bloatDeadShareOfLive) {
        findings.push(finding("bloat_suspected", "table", table.name));
      }
      if (table.lastAnalyze === null && table.lastAutovacuum === null &&
          table.liveTuples >= limits.neverAnalyzedMinLiveTuples) {
        findings.push(finding("never_analyzed", "table", table.name));
      }
    }
    for (const rule of TABLE_RULES) checks.set(rule, check(rule, true, note));

    for (const index of statistics.indexes) {
      if (!index.isPrimary && !index.isUnique && index.scans === 0 && index.sizeBytes >= limits.unusedIndexMinBytes) {
        findings.push(finding("unused_index", "index", index.name));
      }
    }
    checks.set("unused_index", check("unused_index", true, note));
  }

  if ("unavailable" in input.statements) {
    checks.set("slow_statement", check("slow_statement", false, input.statements.unavailable));
  } else {
    // Die teuersten zuerst, bei gleicher Zeit nach Kennung: dieselbe Eingabe in
    // anderer Reihenfolge waehlt dieselben Statements aus.
    const ranked = [...input.statements.entries]
      .filter((entry) => entry.totalTimeMs >= limits.slowStatementMinTotalMs)
      .sort((a, b) => b.totalTimeMs - a.totalTimeMs || compare(a.id, b.id))
      .slice(0, limits.slowStatementCount);
    for (const entry of ranked) findings.push(finding("slow_statement", "statement", entry.id));
    checks.set("slow_statement", check("slow_statement", true));
  }

  findings.sort((a, b) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    compare(a.object.name, b.object.name) ||
    compare(a.object.kind, b.object.kind) ||
    PERFORMANCE_RULE_IDS.indexOf(a.rule) - PERFORMANCE_RULE_IDS.indexOf(b.rule) ||
    compare(a.id, b.id));
  return { findings, checks: PERFORMANCE_RULE_IDS.map((rule) => checks.get(rule)!) };
}

/** Codepunkt-Vergleich statt `localeCompare`: unabhaengig von der Locale des Servers. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
