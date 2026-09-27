/**
 * Berichte → Abfrage-Einblicke (2.67): der Plan einer einzelnen Abfrage.
 *
 * ## Was die Seite hält
 *
 * Sie zeigt den Plan, den der PostgreSQL-Planer für eine lesende Abfrage
 * aufstellt: welcher Knoten welche Relation anfasst, welcher Index dabei
 * greift, und welcher Knoten den grössten Teil der geschätzten Kosten trägt.
 * Das ist genau die Frage, die der Platzhalter versprochen hat.
 *
 * ## Was sie bewusst nicht hält, und warum
 *
 * Gelesen wird mit `EXPLAIN`, **ohne** `ANALYZE`. Der Unterschied ist nicht
 * kosmetisch: `EXPLAIN` stellt den Plan auf und gibt ihn zurück, `EXPLAIN
 * ANALYZE` führt die Abfrage dabei wirklich aus. Über eine Konsolenfläche
 * wäre das eine andere Zusage. Ein Knopf, der aussieht wie "erklär mir das",
 * würde dann eine Abfrage über die ganze Tabelle laufen lassen, Sperren
 * anfassen, den Cache umwälzen und die Zähler in `pg_stat_statements`
 * verschieben. Wer ausführen will, hat dafür den SQL-Editor, und dort steht
 * der Knopf auch so da: er führt aus. Diese Seite tut es nicht, und sie sagt
 * das im ersten Satz.
 *
 * Der Preis dieser Entscheidung wird ebenfalls gesagt: Alle Zahlen des Plans
 * sind **Schätzungen** aus den Statistiken des Planers, keine Messungen. Eine
 * geschätzte Zeilenzahl kann um Grössenordnungen danebenliegen, wenn die
 * Tabelle keine frische Stichprobe hat (genau der Befund `never_analyzed` des
 * Leistungsberaters). Die Kosten sind eine einheitenlose Zahl des Planers,
 * keine Millisekunden.
 *
 * Die einzige gemessene Zahl ist die Planungszeit (`SUMMARY ON`). Sie entsteht
 * beim Planen selbst, nicht beim Ausführen, und sie ist darum ehrlich zu haben.
 *
 * ## Warum kein eigener Leseweg
 *
 * Der Plan läuft über `ProjectDataPlaneService`, also über dieselbe Lesestelle,
 * die `environments/{environment}/query` benutzt: dieselbe aufgelöste
 * Verbindung, dieselbe Leserolle, dieselbe Grenzprüfung, `BEGIN READ ONLY`,
 * dieselben Zeitlimits. Es gibt keine zweite Verbindung und keine zweite
 * Rolle. Der Wächter `isReadOnlySql` prüft das Statement, bevor `EXPLAIN`
 * davorgesetzt wird; durchgelassen wird genau ein SELECT.
 *
 * ## Warum die Bedingungen der Knoten nicht mitkommen
 *
 * Ein Planknoten trägt Felder wie `Filter`, `Index Cond` oder `Hash Cond`, und
 * darin stehen die Literale der Abfrage wörtlich. Diese Seite überträgt sie
 * nicht. Der Plan verlässt die Datenbank als flache Liste aus Knotenart,
 * Relation, Indexname und Zahlen; die Bedingungstexte bleiben, wo sie
 * entstanden sind. Wer wissen will, wonach gefiltert wird, liest seine eigene
 * Abfrage: sie steht im Feld darüber.
 */

/** Höchstens so viele Knoten verlassen die Datenbank; darüber wird gekürzt. */
export const QUERY_PLAN_MAX_NODES = 60;
/** Dieselbe Grenze, die `isReadOnlySql` zieht. */
export const QUERY_PLAN_MAX_STATEMENT = 4_000;
/** Ab diesem Eigenanteil gilt ein Knoten als der teure Teil des Plans. */
export const QUERY_PLAN_HOT_SHARE = 0.2;

export type QueryPlanNode = Readonly<{
  /** Reihenfolge im Plan, von der Wurzel absteigend. */
  id: number;
  /** Tiefe im Baum; die Wurzel steht auf 0. */
  depth: number;
  /** Die Knotenart, wie PostgreSQL sie nennt, etwa "Seq Scan". */
  operation: string;
  /** Die angefasste Relation, falls der Knoten eine anfasst. */
  relation: string | null;
  /** Der benutzte Index, falls einer greift. */
  indexName: string | null;
  /** Geschätzte Kosten bis zur ersten Zeile, einheitenlos. */
  startupCost: number;
  /** Geschätzte Gesamtkosten dieses Teilbaums, einheitenlos. */
  totalCost: number;
  /** Gesamtkosten ohne die der Kinder. Das ist der eigene Beitrag. */
  ownCost: number;
  /** Eigener Beitrag im Verhältnis zu den Gesamtkosten der Wurzel. */
  costShare: number;
  /** Geschätzte Zeilen, die dieser Knoten liefert. */
  planRows: number;
  /** Geschätzte Breite einer Zeile in Bytes. */
  planWidth: number;
}>;

export type QueryPlanReading = Readonly<{
  nodes: readonly QueryPlanNode[];
  /** Gesamtkosten der Wurzel, einheitenlos. */
  totalCost: number;
  /** Geschätzte Zeilen der Wurzel. */
  planRows: number;
  /** Gemessene Planungszeit in Millisekunden, falls PostgreSQL sie nennt. */
  planningTimeMs: number | null;
  /** Jeder Index, den der Plan benutzt, ohne Wiederholung. */
  indexes: readonly string[];
  /** Jede Relation, die sequenziell gelesen wird, ohne Wiederholung. */
  sequentialScans: readonly string[];
  /** Wurde der Baum bei `QUERY_PLAN_MAX_NODES` abgeschnitten? */
  truncated: boolean;
}>;

export type QueryPlanErrorReason = keyof typeof QUERY_PLAN_REASONS;

/** Gründe, die die Ansicht wörtlich zeigt. Keiner nennt ein Katalogdetail. */
export const QUERY_PLAN_REASONS = {
  NOT_READ_ONLY: "Das ist keine lesende Abfrage. Diese Seite erklärt genau ein SELECT, und sie nimmt nichts an, was schreiben könnte.",
  TOO_LONG: "Die Abfrage ist länger als 4000 Zeichen. Dieselbe Grenze gilt im SQL-Editor.",
  EMPTY: "Es steht keine Abfrage im Feld.",
  UNREADABLE_PLAN: "PostgreSQL hat geantwortet, aber nicht mit einem Plan in der erwarteten Form.",
  PLAN_REJECTED: "Die Abfrage lässt sich nicht planen. Meist fehlt eine Relation oder eine Spalte, oder die Leserolle darf sie nicht sehen.",
  DATABASE_DISABLED: "Die Projektdatenbank ist nicht angebunden.",
  DATABASE_NOT_READY: "Die Projektdatenbank ist für diese Umgebung noch nicht bereit.",
  DATABASE_UNAVAILABLE: "Die Projektdatenbank ist gerade nicht erreichbar.",
} as const;

export class QueryPlanError extends Error {
  constructor(readonly reason: QueryPlanErrorReason) {
    super(QUERY_PLAN_REASONS[reason]);
    this.name = "QueryPlanError";
  }
}

/**
 * Die Ehrlichkeitssaetze der Seite. Sie stehen hier und nicht in der Ansicht,
 * damit der Uebersetzungsvertrag sie findet und damit sie sich nicht beim
 * naechsten Umbau der Ansicht verlieren.
 */
export const QUERY_PLAN_NOT_EXECUTED = "Diese Seite führt Ihre Abfrage nicht aus. Sie fragt PostgreSQL nur nach dem Plan (EXPLAIN ohne ANALYZE), und PostgreSQL stellt den Plan auf, ohne eine einzige Zeile zu lesen.";
export const QUERY_PLAN_WHY_NO_ANALYZE = "EXPLAIN ANALYZE würde die Abfrage wirklich laufen lassen: Sperren, Cache, Zähler und Laufzeit inklusive. Über einen Knopf in der Console wäre das eine andere Zusage als die, die hier draufsteht. Wer ausführen will, nimmt den SQL-Editor, dort führt der Knopf aus.";
export const QUERY_PLAN_ESTIMATES = "Alle Zahlen ausser der Planungszeit sind Schätzungen des Planers aus seinen Statistiken, keine Messungen. Eine Tabelle ohne frische Stichprobe (ANALYZE) kann um Grössenordnungen danebenliegen.";
export const QUERY_PLAN_COST_UNIT = "Kosten sind eine einheitenlose Zahl des Planers, keine Millisekunden. Vergleichbar sind sie nur innerhalb eines Plans.";
export const QUERY_PLAN_OWN_COST = "Die Gesamtkosten eines Knotens enthalten die seiner Kinder. Der Anteil in der Spalte rechts ist darum der Eigenanteil: Gesamtkosten minus die der Kinder. Nur so zeigt die Liste, wo der Plan wirklich teuer wird.";
export const QUERY_PLAN_NO_CONDITIONS = "Die Bedingungen der Knoten (Filter, Index Cond, Hash Cond) überträgt diese Seite nicht. Sie tragen die Literale Ihrer Abfrage wörtlich, und die stehen ohnehin schon im Feld oben.";
export const QUERY_PLAN_SAME_DOOR = "Gelesen wird über dieselbe Stelle wie im SQL-Editor: dieselbe Leserolle, dieselbe Grenzprüfung, eine Transaktion mit BEGIN READ ONLY und denselben Zeitlimits. Es entsteht keine zweite Verbindung und keine zweite Rolle.";
export const QUERY_PLAN_PLANNING_TIME = "Die Planungszeit ist die einzige gemessene Zahl hier. Sie entsteht beim Planen, nicht beim Ausführen.";
export const QUERY_PLAN_UNKNOWN_NODE = "Diese Knotenart erklärt QKERN nicht. Sie steht hier mit dem Namen, den PostgreSQL ihr gibt, statt mit einer erfundenen Beschreibung.";

/**
 * Was eine Knotenart bedeutet, in einem Satz.
 *
 * Die Liste ist bewusst kurz: Sie deckt die Arten ab, die in einer Abfrage
 * aus der Console vorkommen. Eine unbekannte Art wird mit ihrem
 * PostgreSQL-Namen gezeigt und ohne Erklaerung, statt mit einer erfundenen.
 */
export const QUERY_PLAN_NODE_MEANINGS: Readonly<Record<string, string>> = Object.freeze({
  "Seq Scan": "Liest die Tabelle von vorne bis hinten. Bei kleinen Tabellen ist das der schnellste Weg, bei grossen der teuerste.",
  "Index Scan": "Sucht über einen Index und holt die gefundenen Zeilen aus der Tabelle nach.",
  "Index Only Scan": "Beantwortet die Frage allein aus dem Index, ohne die Tabelle anzufassen. Das geht nur, wenn die Sichtbarkeitskarte aktuell ist.",
  "Bitmap Heap Scan": "Holt die Zeilen, die der Bitmap-Index-Scan darunter markiert hat, in Tabellenreihenfolge statt in Indexreihenfolge.",
  "Bitmap Index Scan": "Sammelt erst alle Treffer eines Index als Bitmap, statt jede Zeile einzeln nachzuholen. Lohnt sich bei vielen Treffern.",
  "Nested Loop": "Geht die linke Seite durch und sucht für jede Zeile passende auf der rechten. Günstig, solange die linke Seite klein bleibt.",
  "Hash Join": "Baut aus der einen Seite eine Hash-Tabelle im Speicher und prüft die andere dagegen.",
  "Merge Join": "Läuft zwei sortierte Seiten parallel ab. Verlangt Sortierung, meist aus einem Index oder einem Sort darunter.",
  "Hash": "Baut die Hash-Tabelle für den Hash Join darüber auf.",
  "Sort": "Sortiert das Zwischenergebnis. Passt es nicht in den Arbeitsspeicher, weicht PostgreSQL auf die Platte aus.",
  "Incremental Sort": "Sortiert nur noch innerhalb von Gruppen, die schon vorsortiert ankommen.",
  "Aggregate": "Fasst Zeilen zusammen, etwa zu count, sum oder max.",
  "HashAggregate": "Gruppiert über eine Hash-Tabelle, ohne vorher zu sortieren.",
  "GroupAggregate": "Gruppiert sortierte Eingaben, ohne Hash-Tabelle.",
  "Limit": "Bricht ab, sobald genug Zeilen da sind.",
  "Gather": "Sammelt die Ergebnisse paralleler Arbeiter wieder ein.",
  "Gather Merge": "Sammelt die Ergebnisse paralleler Arbeiter ein und hält dabei die Sortierung.",
  "Materialize": "Legt ein Zwischenergebnis ab, damit der Knoten darüber es mehrfach lesen kann.",
  "Append": "Hängt die Ergebnisse mehrerer Teilbäume aneinander, etwa bei partitionierten Tabellen.",
  "Result": "Liefert ein Ergebnis, das ohne Tabellenzugriff feststeht.",
  "CTE Scan": "Liest ein zuvor berechnetes WITH-Zwischenergebnis.",
  "Subquery Scan": "Liest das Ergebnis einer Unterabfrage.",
  "Function Scan": "Liest die Zeilen, die eine Funktion liefert.",
  "Values Scan": "Liest eine im Statement geschriebene Werteliste.",
});

type RawPlanNode = {
  "Node Type"?: unknown;
  "Relation Name"?: unknown;
  "Index Name"?: unknown;
  "Startup Cost"?: unknown;
  "Total Cost"?: unknown;
  "Plan Rows"?: unknown;
  "Plan Width"?: unknown;
  "CTE Name"?: unknown;
  "Alias"?: unknown;
  Plans?: unknown;
};

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function trimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  // Ein Name aus dem Katalog bleibt kurz; alles darueber ist keiner mehr.
  return trimmed === "" || trimmed.length > 128 ? null : trimmed;
}

/**
 * Macht aus der JSON-Antwort von `EXPLAIN (FORMAT JSON)` eine flache Liste.
 *
 * Das Eingabeformat ist ein Array mit genau einem Eintrag, und dieser Eintrag
 * traegt unter `Plan` die Wurzel des Baums. Alles andere ist ein Grund fuer
 * `UNREADABLE_PLAN`: Diese Funktion raet nicht.
 */
export function readQueryPlan(raw: unknown): QueryPlanReading {
  const container = Array.isArray(raw) ? raw[0] : raw;
  if (container === null || typeof container !== "object") throw new QueryPlanError("UNREADABLE_PLAN");
  const root = (container as { Plan?: unknown }).Plan;
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    throw new QueryPlanError("UNREADABLE_PLAN");
  }

  const rootCost = finiteNumber((root as RawPlanNode)["Total Cost"]);
  const nodes: QueryPlanNode[] = [];
  let truncated = false;

  // Vorordnung, iterativ statt rekursiv: ein Plan aus einer fremden Abfrage
  // bestimmt die Tiefe, und ein tiefer Baum soll den Server nicht ueber den
  // Aufrufstapel kippen.
  const stack: Array<{ node: RawPlanNode; depth: number }> = [{ node: root as RawPlanNode, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (nodes.length >= QUERY_PLAN_MAX_NODES) { truncated = true; break; }

    const children = Array.isArray(current.node.Plans)
      ? current.node.Plans.filter((child): child is RawPlanNode =>
        child !== null && typeof child === "object" && !Array.isArray(child))
      : [];
    const totalCost = finiteNumber(current.node["Total Cost"]);
    const childCost = children.reduce((sum, child) => sum + finiteNumber(child["Total Cost"]), 0);
    // Der Eigenanteil kann durch Rundung der Schaetzung knapp unter null
    // rutschen; negativ waere er als Anteil eine Luege.
    const ownCost = Math.max(0, totalCost - childCost);

    nodes.push(Object.freeze({
      id: nodes.length,
      depth: current.depth,
      operation: trimmedString(current.node["Node Type"]) ?? "Unbekannt",
      relation: trimmedString(current.node["Relation Name"]) ?? trimmedString(current.node["CTE Name"]),
      indexName: trimmedString(current.node["Index Name"]),
      startupCost: finiteNumber(current.node["Startup Cost"]),
      totalCost,
      ownCost,
      costShare: rootCost > 0 ? ownCost / rootCost : 0,
      planRows: finiteNumber(current.node["Plan Rows"]),
      planWidth: finiteNumber(current.node["Plan Width"]),
    }));

    // Umgekehrt auf den Stapel, damit das erste Kind zuerst herauskommt.
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], depth: current.depth + 1 });
    }
  }
  if (stack.length > 0) truncated = true;

  const planningTime = (container as { "Planning Time"?: unknown })["Planning Time"];

  return Object.freeze({
    nodes: Object.freeze(nodes),
    totalCost: rootCost,
    planRows: finiteNumber((root as RawPlanNode)["Plan Rows"]),
    planningTimeMs: typeof planningTime === "number" && Number.isFinite(planningTime) ? planningTime : null,
    indexes: Object.freeze([...new Set(nodes.flatMap((node) => node.indexName === null ? [] : [node.indexName]))]),
    sequentialScans: Object.freeze([...new Set(nodes.flatMap((node) =>
      node.operation === "Seq Scan" && node.relation !== null ? [node.relation] : []))]),
    truncated,
  });
}

/**
 * Der Knoten, an dem der Plan teuer wird: der groesste Eigenanteil, und nur
 * dann, wenn er ueberhaupt ins Gewicht faellt. Gibt es keinen solchen Knoten,
 * ist das eine Aussage und keine Luecke: Die Kosten verteilen sich.
 */
export function hottestQueryPlanNode(reading: QueryPlanReading): QueryPlanNode | null {
  let hottest: QueryPlanNode | null = null;
  for (const node of reading.nodes) {
    if (node.costShare < QUERY_PLAN_HOT_SHARE) continue;
    if (hottest === null || node.costShare > hottest.costShare) hottest = node;
  }
  return hottest;
}

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function queryInsightsTexts(): string[] {
  return [
    ...Object.values(QUERY_PLAN_REASONS),
    ...Object.values(QUERY_PLAN_NODE_MEANINGS),
    QUERY_PLAN_NOT_EXECUTED, QUERY_PLAN_WHY_NO_ANALYZE, QUERY_PLAN_ESTIMATES,
    QUERY_PLAN_COST_UNIT, QUERY_PLAN_OWN_COST, QUERY_PLAN_NO_CONDITIONS,
    QUERY_PLAN_SAME_DOOR, QUERY_PLAN_PLANNING_TIME, QUERY_PLAN_UNKNOWN_NODE,
  ];
}
