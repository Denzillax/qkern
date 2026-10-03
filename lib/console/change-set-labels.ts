/**
 * Die Worte fuer Zustand und Risiko eines Change Sets (2.145).
 *
 * **Warum ein eigenes Modul.** Dieselben acht Woerter standen an zwei Stellen
 * verschieden da: Die Migrationsliste uebersetzte den Zustand ueber eine eigene
 * Tabelle, der Verlauf des SQL-Editors zeigte ihn roh als `pending` oder
 * `critical`. Zwei Ansichten, die dasselbe Feld zeigen, duerfen es nicht
 * verschieden benennen; wer `applied` einmal als "angewendet" und einmal als
 * `applied` liest, haelt es fuer zwei Sachen.
 *
 * **Warum die Rohwerte stehen bleiben duerfen.** Ein Zustand, den dieses Modul
 * nicht kennt, kommt unveraendert zurueck statt zu verschwinden. Ein neuer
 * Zustand im Backend soll in der Console auffallen und nicht leer sein.
 *
 * Die Texte gehen durch `t()` in der Ansicht; dieses Modul ist rein und kennt
 * die Uebersetzung nicht. `changeSetLabelTexts` gibt alle Worte heraus, damit
 * der i18n-Vertrag sie findet, denn ein `t(variable)` sieht er im Quelltext
 * nicht.
 */
/**
 * Die Zustaende stammen aus der Migrationsliste, die sie seit Langem fuehrt;
 * sie sind nicht neu erfunden, sondern umgezogen. Darum auch `validating` und
 * `applying`, die als Zwischenschritte selten zu sehen sind.
 */
const STATUS: Record<string, string> = {
  draft: "Entwurf",
  validating: "wird geprüft",
  // `ready` fehlte (2.164): Die Migrationsliste zeigte es roh. Es ist der
  // Zustand nach der Pruefung und vor der Freigabe.
  ready: "geprüft",
  pending_approval: "wartet auf Freigabe",
  approved: "freigegeben",
  rejected: "abgelehnt",
  queued: "eingereiht",
  applying: "wird angewendet",
  applied: "angewendet",
  failed: "fehlgeschlagen",
  rolled_back: "zurückgerollt",
};

const RISK: Record<string, string> = {
  low: "gering",
  medium: "mittel",
  high: "hoch",
  critical: "kritisch",
};

/**
 * Der Zustand einer Freigabe (2.157). Er ist nicht der Zustand des Change Sets
 * dahinter, sondern der der Entscheidung, und hat darum eigene vier Werte. Die
 * Freigabeseite zeigte ihn roh als `pending`, gleich neben "Risiko medium".
 */
const APPROVAL_STATUS: Record<string, string> = {
  pending: "offen",
  approved: "freigegeben",
  rejected: "abgelehnt",
  expired: "abgelaufen",
};

export function approvalStatusLabel(status: string): string {
  return APPROVAL_STATUS[status] ?? status;
}

export function changeSetStatusLabel(status: string): string {
  return STATUS[status] ?? status;
}

export function changeSetRiskLabel(risk: string): string {
  return RISK[risk] ?? risk;
}

export function changeSetLabelTexts(): string[] {
  // "freigegeben" und "abgelehnt" sind Zustand eines Change Sets und einer
  // Freigabe zugleich; uebersetzt wird jedes Wort einmal.
  return [...new Set([...Object.values(STATUS), ...Object.values(RISK), ...Object.values(APPROVAL_STATUS)])];
}
