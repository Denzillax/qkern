import { formatMoment, formatNumber } from "@/components/console/console-display";

/**
 * Ableitungen aus `console-display`, die mehrere Ansichten gleich brauchen
 * (2.65).
 *
 * `console-display` bindet die Einstellungen der Person an die Console. Was
 * hier steht, ist eine Handvoll Formen, die daraus immer wieder gleich gebaut
 * wurden: dieselbe Uhrzeit, dieselbe Abwehr gegen einen kaputten Zeitstempel,
 * dieselbe Groessenangabe. Sechs Ansichten hatten ihr eigenes `formatTime`,
 * vier ihr eigenes `bytes`, zwei ihr eigenes `positionTime`.
 */

/** Nur Stunde und Minute; die Aktivitaetslisten zeigen den Tag nicht. */
export function formatHourMinute(value: string): string {
  return formatMoment(value, "hourMinute");
}

/**
 * Ein Zeitpunkt, der aus einer Route kommt und kaputt sein kann. Ist er nicht
 * zu lesen, steht der rohe Wert da; eine erfundene Uhrzeit waere schlimmer als
 * ein unleserlicher String.
 */
export function formatMomentOrRaw(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : formatMoment(parsed);
}

/**
 * Eine Position ist `<zeitpunkt>#<id>` und undurchsichtig. Gezeigt wird ihr
 * Zeitanteil: Er sagt einem Menschen, bis wann gemeldet ist. Die Id dahinter
 * ist die Kennung eines Eintrags und beantwortet keine Frage, die in einer
 * Ansicht jemand stellt.
 */
export function positionMoment(position: string): string {
  const separator = position.indexOf("#");
  return formatMomentOrRaw(separator < 1 ? position : position.slice(0, separator));
}

/**
 * Eine Groesse in Byte, binaer gestuft. Gerundet wird hier, weil eine Quelle
 * auch Bruchteile liefern kann und ein halbes Byte niemandem hilft.
 */
export function formatBytes(value: number): string {
  if (value < 1024) return `${formatNumber(Math.round(value))} B`;
  if (value < 1024 * 1024) return `${formatNumber(Math.round(value / 1024))} KiB`;
  if (value < 1024 * 1024 * 1024) return `${formatNumber(Math.round(value / (1024 * 1024)))} MiB`;
  return `${formatNumber(Math.round(value / (1024 * 1024 * 1024)))} GiB`;
}

/**
 * Der Zeitpunkt eines Eimers in einer Zeitreihe. Stundeneimer zeigen Datum
 * und Uhrzeit, Tageseimer nur das Datum; drei Reihenansichten hatten dafuer
 * dieselbe Zeile.
 */
export function formatBucketMoment(value: string, bucket: "hour" | "day"): string {
  return formatMoment(value, bucket === "hour" ? "dateTime" : "dateShort");
}
