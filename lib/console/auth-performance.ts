/**
 * Auth-Leistung (2.71): der reine Teil hinter der Seite Auth → Auth-Leistung.
 *
 * Die Seite steht auf der Zeitreihe des Auth-Audits aus 2.47 und auf nichts
 * sonst. Es gibt keine zweite Abfrage, keinen zweiten Zaehler und vor allem
 * keine Dauer: Ein Audit-Eintrag traegt einen Zeitpunkt, eine Handlung, einen
 * Ausgang und eine Referenz. Eine Antwortzeit laesst sich daraus nicht
 * zurueckrechnen, und darum rechnet dieses Modul auch keine.
 *
 * Gerechnet wird genau zweierlei, beides aus Zahlen, die schon in der Reihe
 * stehen: der Anteil der gescheiterten an den protokollierten Handlungen, und
 * die Rangfolge der Handlungsarten nach der Zahl ihrer Fehlschlaege, jeweils
 * mit dem fruehesten Eimer des Fensters, in dem diese Art gescheitert ist.
 *
 * Kein React, keine Farbe, keine Sprache, keine Datenbank. Die Eingabe ist
 * strukturell beschrieben und nicht aus `lib/server` importiert, damit die
 * Ansicht den Serverbaum nicht mitzieht.
 */

import {
  PROJECT_AUTH_AUDIT_ACTION_IDS,
  type ProjectAuthAuditActionId,
} from "@/lib/console/auth-observability-texts";

/** So viel der Reihe aus 2.47, wie diese Seite wirklich liest. */
export type AuthPerformanceCounts = {
  total: number;
  failed: number;
  actions: Record<ProjectAuthAuditActionId, number>;
  failedActions: Record<ProjectAuthAuditActionId, number>;
};

export type AuthPerformanceBucket = AuthPerformanceCounts & { start: string };

export type AuthPerformanceSeries = {
  buckets: ReadonlyArray<AuthPerformanceBucket>;
  totals: AuthPerformanceCounts;
};

/**
 * Eine Zeile der Rangfolge: eine Handlungsart, ihre Zahlen im Fenster und der
 * Beginn des fruehesten Eimers, in dem sie gescheitert ist.
 */
export type AuthFailureRow = {
  id: ProjectAuthAuditActionId;
  total: number;
  failed: number;
  /** Bruch, nicht Prozent; die Ansicht formatiert. */
  share: number;
  /**
   * ISO-8601, Beginn des Eimers. Das ist **nicht** der Zeitpunkt des ersten
   * Fehlschlags, sondern der Anfang des Abschnitts, in dem er liegt: Feiner
   * loest die Reihe nicht auf, und eine Minute zu behaupten, die niemand
   * gezaehlt hat, waere erfunden.
   *
   * Das Fenster reicht nur 48 Stunden oder 90 Tage zurueck. Steht hier der
   * erste Eimer des Fensters, kann es genauso gut frueher angefangen haben;
   * die Ansicht sagt das dazu.
   */
  firstFailureStart: string;
};

/**
 * Der Anteil der gescheiterten Handlungen.
 *
 * Ohne Handlung gibt es keinen Anteil, und der ist dann null und nicht etwa
 * "gut": Null von null ist keine Aussage ueber die Anmeldung, sondern ueber
 * die Stille im Fenster. Die Ansicht schreibt das neben die Zahl.
 */
export function authFailureShare(counts: { total: number; failed: number }): number {
  if (!Number.isFinite(counts.total) || counts.total <= 0) return 0;
  return Math.min(Math.max(counts.failed, 0), counts.total) / counts.total;
}

/**
 * Die Handlungsarten, die im Fenster gescheitert sind, haeufigste zuerst.
 *
 * Sortiert wird nach der **Zahl** der Fehlschlaege und nicht nach dem Anteil.
 * Grund: Eine Art, die einmal vorkam und einmal scheiterte, hat den Anteil
 * eins und saesse sonst ueber einer Art mit vierhundert Fehlschlaegen von
 * tausend. Der Anteil steht in derselben Zeile daneben, wer danach sehen
 * will, sieht ihn. Bei gleicher Zahl entscheidet der Anteil, danach die feste
 * Reihenfolge der Handlungen, damit zwei Ladungen dieselbe Reihenfolge
 * ergeben.
 *
 * Arten ohne Fehlschlag stehen nicht in der Liste. Sie waeren eine Zeile mit
 * lauter Nullen, und die sagt nichts, was die Summen nicht schon sagen.
 */
export function authFailureRanking(series: AuthPerformanceSeries): AuthFailureRow[] {
  // Der frueheste Eimer je Art: die Eimer der Reihe stehen aufsteigend, der
  // erste Treffer ist darum der frueheste.
  const first = new Map<ProjectAuthAuditActionId, string>();
  for (const bucket of series.buckets) {
    for (const id of PROJECT_AUTH_AUDIT_ACTION_IDS) {
      if ((bucket.failedActions[id] ?? 0) > 0 && !first.has(id)) first.set(id, bucket.start);
    }
  }

  const rows: AuthFailureRow[] = [];
  for (const id of PROJECT_AUTH_AUDIT_ACTION_IDS) {
    const failed = series.totals.failedActions[id] ?? 0;
    const total = series.totals.actions[id] ?? 0;
    const start = first.get(id);
    // Ohne Eimer keine Zeile: Eine Summe ohne den Abschnitt, aus dem sie
    // stammt, hiesse "irgendwann", und das steht so nirgends.
    if (failed <= 0 || start === undefined) continue;
    rows.push({ id, total, failed, share: authFailureShare({ total, failed }), firstFailureStart: start });
  }

  const order = new Map(PROJECT_AUTH_AUDIT_ACTION_IDS.map((id, index) => [id, index]));
  return rows.sort((left, right) =>
    right.failed - left.failed ||
    right.share - left.share ||
    (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
}
