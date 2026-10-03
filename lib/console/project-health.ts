import { HEALTH_STATES, type HealthState, type HealthSubsystemId } from "@/lib/console/health-advisor-texts";

/**
 * Der Zustandsblock der Projekt-Uebersicht (2.136), rein gerechnet.
 *
 * Die Uebersicht hatte bis hierher eine Karte "Dienststatus", die gar keinen
 * Status kannte: Sie sagte "Noch nicht verbunden" und nahm damit die halbe
 * Seite ein. Die Lesung, die es wirklich gibt, liegt an einer anderen Stelle,
 * naemlich hinter `advisors/health`; dieselbe Antwort, die
 * `health-advisor-view` zeigt. Dieses Modul uebersetzt sie in die fuenf
 * Zeilen, die ein Betreiber beim Oeffnen sehen will, und zwar ohne zu raten.
 *
 * Der ganze Zweck ist die eine Regel: Gruen steht nur, wo gemessen wurde.
 * `ok` heisst in `health-advisor-texts`, dass der Dienst gefragt wurde und
 * geantwortet hat, und nur das ist eine Messung. `configured` heisst, dass
 * etwas hinterlegt ist und niemand gefragt hat; das ist in dieser Uebersicht
 * grau, nicht gruen. Darum steht hier auch keine zweite Tonleiter: die Toene
 * haengen am Zustand des Servers und nicht an der Laune der Ansicht.
 *
 * Rein heisst: kein React, kein `fetch`, keine Farbe ausser dem Tonnamen. Der
 * Vertrag `console-overview-contract` kann das Modul darum ohne Umgebung
 * fahren.
 */

/** Die fuenf Dienste der Uebersicht, in der Reihenfolge der Zeilen. */
export const OVERVIEW_SERVICES = ["database", "auth", "storage", "realtime", "data_api"] as const satisfies ReadonlyArray<HealthSubsystemId>;
export type OverviewServiceId = (typeof OVERVIEW_SERVICES)[number];

/**
 * So kommt die Antwort der Route an: lose getippt, weil sie aus dem Netz
 * kommt. Ein Zustand, den `HEALTH_STATES` nicht kennt, gilt weiter unten als
 * keine Lesung; so faellt eine neue Serverfassung nicht als Gruen auf.
 */
export type HealthEvidenceReading = { measure?: unknown; count?: unknown };
export type HealthSubsystemReading = { id?: unknown; state?: unknown; evidence?: unknown };

export type OverviewTone = "green" | "amber" | "red" | "neutral";

/** Eine Zeile des Blocks. `state === null` heisst: fuer diesen Dienst liegt keine Lesung vor. */
export type OverviewRow = { id: OverviewServiceId; state: HealthState | null; tone: OverviewTone };

/**
 * Die Zustaende, die eine Messung sind. Es ist genau einer.
 *
 * Diese Liste ist der Punkt, an dem die Zusage haengt. Wer `configured` hier
 * eintraegt, macht aus "es ist etwas hinterlegt" ein gruenes Licht, und genau
 * das hat 2.44 schon einmal als Unwahrheit notiert.
 */
const MEASURED: ReadonlyArray<HealthState> = ["ok"];

/** Wurde dieser Dienst gefragt und hat er geantwortet? */
export function isMeasured(state: HealthState | null): boolean {
  return state !== null && MEASURED.includes(state);
}

/**
 * Der Ton einer Zeile.
 *
 * Gruen nur bei einer Messung. Rot nur bei `degraded`, denn das ist der eine
 * Zustand, der heisst: eingerichtet und antwortet trotzdem nicht. Gelb bei
 * `unknown`, weil eine Probe, die nicht laufen konnte, kein Urteil ist. Alles
 * andere ist grau: eine Entscheidung ist keine Stoerung.
 */
export function toneForState(state: HealthState | null): OverviewTone {
  if (state === null) return "neutral";
  if (isMeasured(state)) return "green";
  if (state === "degraded") return "red";
  if (state === "unknown") return "amber";
  return "neutral";
}

function knownState(value: unknown): HealthState | null {
  return typeof value === "string" && (HEALTH_STATES as ReadonlyArray<string>).includes(value) ? value as HealthState : null;
}

function readingFor(subsystems: ReadonlyArray<HealthSubsystemReading> | null, id: OverviewServiceId): HealthSubsystemReading | null {
  if (subsystems === null) return null;
  return subsystems.find((item) => item.id === id) ?? null;
}

/** Die fuenf Zeilen. Ohne Antwort sind alle fuenf grau, und das ist die Wahrheit. */
export function overviewRows(subsystems: ReadonlyArray<HealthSubsystemReading> | null): OverviewRow[] {
  return OVERVIEW_SERVICES.map((id) => {
    const state = knownState(readingFor(subsystems, id)?.state);
    return { id, state, tone: toneForState(state) };
  });
}

/**
 * Darf die Uebersicht einen grossen Kasten aufziehen?
 *
 * Nur fuer `degraded`. Ein nicht eingerichteter Dienst ist eine Entscheidung
 * des Betreibers und keine Nachricht, die ueber allem stehen muss; eine Probe,
 * die nicht laufen konnte, sagt nichts, worauf man handeln kann. Beides bleibt
 * eine ruhige Zeile.
 */
export function needsOperatorAction(rows: ReadonlyArray<OverviewRow>): boolean {
  return rows.some((row) => row.tone === "red");
}

/**
 * Eine Zahl aus dem Beleg eines Dienstes, oder `null`, wenn sie nicht gelesen
 * wurde. `count` ist in der Antwort ausdruecklich `number | null`, und ein
 * `null` ist keine Null.
 */
export function measureCount(
  subsystems: ReadonlyArray<HealthSubsystemReading> | null,
  id: OverviewServiceId,
  measure: string,
): number | null {
  const evidence = readingFor(subsystems, id)?.evidence;
  if (!Array.isArray(evidence)) return null;
  for (const entry of evidence as ReadonlyArray<HealthEvidenceReading>) {
    if (entry.measure === measure && typeof entry.count === "number") return entry.count;
  }
  return null;
}

/**
 * Ist dieses Projekt leer?
 *
 * `known` ist die wichtigere der beiden Angaben: Sie sagt, ob die Frage
 * ueberhaupt beantwortet ist. Ohne alle drei Zahlen bleibt sie unbeantwortet,
 * und dann zeigt die Uebersicht keinen Schnellstart. Geraten wird hier nichts;
 * ein fehlender Beleg ist keine Null.
 *
 * Was fehlt und warum es fehlt: Eine Zahl angelegter Nutzer liegt in keiner
 * Lesung, die diese Seite hat. Die Probe von Auth liest die Anmeldeanbieter
 * und die Signaturschluessel, nicht die Nutzertabelle. Darum steht hier
 * `providers`: Ohne einen Anmeldeanbieter kann sich niemand anmelden, also hat
 * das Projekt auch keine angemeldeten Nutzer. Das ist weniger, als die Frage
 * verlangt, aber es ist gelesen und nicht geraten.
 */
export type ProjectEmptiness = {
  known: boolean;
  empty: boolean;
  tables: number | null;
  buckets: number | null;
  providers: number | null;
};

export function projectEmptiness(subsystems: ReadonlyArray<HealthSubsystemReading> | null): ProjectEmptiness {
  const tables = measureCount(subsystems, "database", "tables");
  const buckets = measureCount(subsystems, "storage", "buckets");
  const providers = measureCount(subsystems, "auth", "providers");
  const known = tables !== null && buckets !== null && providers !== null;
  return { known, empty: known && tables === 0 && buckets === 0 && providers === 0, tables, buckets, providers };
}
