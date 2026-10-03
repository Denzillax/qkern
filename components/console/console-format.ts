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

/**
 * Ein Geheimnis in der Form `qk_service_••••••••7Jk9` (2.137).
 *
 * **Warum ueberhaupt maskiert.** Ein Service Key steht nur einmal auf dem
 * Schirm, und genau dann oft in einem geteilten Bildschirm oder vor einer
 * Kamera. Die Maske zeigt, was zum Wiedererkennen reicht: welcher Art der
 * Key ist und welche vier Zeichen am Ende stehen. Kopieren braucht das Auge
 * nicht, der Knopf nimmt den ganzen Wert.
 *
 * **Warum acht Punkte und nicht so viele wie Zeichen.** Die Laenge eines
 * Geheimnisses ist selbst eine Auskunft. Acht Punkte sagen "hier fehlt
 * etwas" und nicht "hier fehlen 39 Zeichen".
 */
export function maskSecret(value: string): string {
  // `qk_<art>_<43 Zeichen>`: Die Art bleibt lesbar, sie ist kein Geheimnis.
  const kind = /^(qk_(?:public|service)_)(.+)$/.exec(value);
  const [visible, body] = kind === null ? ["", value] : [kind[1], kind[2]];
  // Zu kurz zum Teilen: dann gar nichts zeigen, nicht die Haelfte.
  if (body.length < 8) return `${visible}${"•".repeat(8)}`;
  return `${visible}${"•".repeat(8)}${body.slice(-4)}`;
}
