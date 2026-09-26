/**
 * Die Texte des Leistungsberaters (2.40), deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `security-advisor-texts` aus 2.39: Der Server schreibt
 * diese Texte in jeden Befund und jede Pruefung, die Console uebersetzt sie
 * ueber ihren Katalog, der Schluessel ist der deutsche Text. Der Vertrag
 * `console-i18n-contract` liest diese Tabelle mit und verlangt fuer jeden Text
 * en, fr und it. Das Modul ist rein, damit Server und Console es
 * gleichermassen laden duerfen.
 *
 * Die Schwellen stehen in `PERFORMANCE_THRESHOLDS` und nur dort; jeder Text
 * nennt sie in Worten, damit ein Befund nachvollziehbar bleibt.
 */

export const PERFORMANCE_RULE_IDS = [
  "missing_index_suspected",
  "slow_statement",
  "unused_index",
  "bloat_suspected",
  "never_analyzed",
] as const;

export type PerformanceRuleId = (typeof PERFORMANCE_RULE_IDS)[number];
export type PerformanceSeverity = "high" | "medium" | "low";

/**
 * Die Schwellen aller Regeln. Eine Regel feuert ab dem Wert, nicht erst
 * darueber: genau auf der Schwelle gibt es einen Befund.
 */
export const PERFORMANCE_THRESHOLDS = {
  /** Ab dieser Groesse lohnt sich die Frage nach einem unbenutzten Index: 1 MiB. */
  unusedIndexMinBytes: 1_048_576,
  /** Sequenzielle Scans, ab denen eine Tabelle auffaellt. */
  missingIndexMinSeqScans: 50,
  /** Index-Scans duerfen hoechstens ein Zehntel der sequenziellen Scans sein. */
  missingIndexSeqToIdxFactor: 10,
  /** Unter so wenigen Zeilen ist der sequenzielle Scan meist der schnellste Weg. */
  missingIndexMinLiveTuples: 1_000,
  /** Absoluter Boden fuer tote Zeilen, damit kleine Tabellen schweigen. */
  bloatMinDeadTuples: 1_000,
  /** Anteil toter an lebenden Zeilen, ab dem die Regel feuert: ein Fuenftel. */
  bloatDeadShareOfLive: 0.2,
  /** Ohne so viele Zeilen kostet eine fehlende Stichprobe keinen Plan. */
  neverAnalyzedMinLiveTuples: 1_000,
  /** Gesamtzeit in Millisekunden, ab der ein Statement als teuer gilt. */
  slowStatementMinTotalMs: 10_000,
  /** Hoechstens so viele Statements, nach Gesamtzeit absteigend. */
  slowStatementCount: 5,
} as const;

export type PerformanceRuleText = {
  severity: PerformanceSeverity;
  title: string;
  summary: string;
  remedy: string;
  /** Was die Regel liest, fuer die Karte "Was geprueft wurde". */
  reads: string;
};

export const PERFORMANCE_RULES: Record<PerformanceRuleId, PerformanceRuleText> = {
  missing_index_suspected: {
    severity: "medium",
    title: "Index fehlt vermutlich",
    summary: "Die Tabelle wird oft sequenziell gelesen (ab 50 Scans), kaum über einen Index (höchstens ein Zehntel der sequenziellen Scans) und hat mindestens 1000 lebende Zeilen. Das ist ein Verdacht aus Zählern, kein Beweis: welche Spalte fehlt, sagen die Zähler nicht.",
    remedy: "Die häufigen Abfragen dieser Tabelle mit EXPLAIN ansehen und einen Index auf die Spalten der WHERE-Bedingung als Change Set anlegen. Bei kleinen oder selten gelesenen Tabellen ist der sequenzielle Scan schneller als jeder Index.",
    reads: "Sequenzielle Scans, Index-Scans und lebende Zeilen je Tabelle aus pg_stat_user_tables.",
  },
  slow_statement: {
    severity: "medium",
    title: "Teures Statement",
    summary: "Ein Statement trägt in pg_stat_statements die höchste Gesamtzeit (ab 10 Sekunden summiert, höchstens die fünf teuersten). Der Befund nennt nur die normalisierte Kennung; den Abfragetext liest QKERN nicht, weil ein Utility-Befehl seine Literale behält.",
    remedy: "Das Statement über seine Kennung in pg_stat_statements nachschlagen, mit EXPLAIN (ANALYZE) nachrechnen und entweder die Abfrage oder die Indizes ändern. Ein Statement mit vielen Aufrufen ist teuer, auch wenn ein einzelner Lauf schnell ist.",
    reads: "Aus pg_stat_statements nur Zeilen der eigenen Datenbank, und je Zeile nur die normalisierte Kennung, die Zahl der Aufrufe und die Gesamtzeit. Nie die Spalte query.",
  },
  unused_index: {
    severity: "low",
    title: "Unbenutzter Index",
    summary: "Dieser Index ist weder Primärschlüssel noch unique, zählt null Scans und belegt mindestens 1 MiB. Er kostet Platz und bremst jedes INSERT und UPDATE. Eine frische Datenbank hat noch keine Statistik, deshalb braucht dieser Befund ein System, das schon im Betrieb war.",
    remedy: "Erst nachsehen, wie lange die Zähler laufen (sie starten bei jedem Reset und bei jedem neuen Cluster neu), dann den Index als Change Set löschen. Ein Index für einen seltenen Bericht kann richtig sein, obwohl er fast nie zählt.",
    reads: "Indizes des Schemas public mit Scans, Grösse und ob sie Primärschlüssel oder unique sind.",
  },
  bloat_suspected: {
    severity: "low",
    title: "Tote Zeilen sammeln sich",
    summary: "Die Tabelle trägt mindestens 1000 tote Zeilen und mindestens ein Fünftel so viele tote wie lebende. Tote Zeilen kosten Platz und machen jeden Scan langsamer, bis Autovacuum sie aufräumt. Die Zahlen sind Schätzungen des Statistiksammlers.",
    remedy: "Prüfen, ob Autovacuum für diese Tabelle greift, notfalls VACUUM (ANALYZE) laufen lassen und die Autovacuum-Schwellen der Tabelle senken.",
    reads: "Lebende und tote Zeilen je Tabelle aus pg_stat_user_tables.",
  },
  never_analyzed: {
    severity: "low",
    title: "Tabelle ohne Stichprobe",
    summary: "Die Tabelle hat mindestens 1000 lebende Zeilen, aber weder eine Stichprobe (ANALYZE, auch die automatische) noch einen Autovacuum-Lauf. Ohne Stichprobe schätzt der Planer die Zeilen aus einer Vorgabe und wählt leicht den falschen Plan.",
    remedy: "ANALYZE auf die Tabelle laufen lassen und prüfen, ob Autovacuum für dieses Schema aktiv ist.",
    reads: "Zeitpunkt der letzten Stichprobe und des letzten Autovacuum je Tabelle.",
  },
};

/** Warum eine Regel nicht oder nur teilweise lief. */
export const PERFORMANCE_CHECK_REASONS = {
  databaseDisabled: "Die Projektdatenbank ist nicht angebunden.",
  databaseNotReady: "Die Projektdatenbank ist noch nicht bereit.",
  databaseUnavailable: "Die Projektdatenbank ist gerade nicht erreichbar.",
  statisticsTruncated: "Nur die ersten 200 Tabellen und 400 Indizes des Schemas geprüft.",
  statementsUnavailable: "pg_stat_statements ist in dieser Datenbank nicht installiert oder für die Leserolle nicht lesbar.",
} as const;

export type PerformanceCheckReason = keyof typeof PERFORMANCE_CHECK_REASONS;

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function performanceAdvisorTexts(): string[] {
  return [
    ...Object.values(PERFORMANCE_RULES).flatMap((rule) => [rule.title, rule.summary, rule.remedy, rule.reads]),
    ...Object.values(PERFORMANCE_CHECK_REASONS),
  ];
}
