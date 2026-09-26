/**
 * Die Zeitreihe als Bild (2.45): eine reine Funktion, die aus den Eimern
 * einer Nutzungsreihe die Geometrie eines Balkendiagramms rechnet.
 *
 * Gleiche Bauart wie `schema-diagram` aus 2.41: kein React, keine Farbe,
 * keine Sprache. Die Ansicht setzt daraus das SVG zusammen und färbt es dort
 * mit den Variablen der Console. Gleiche Eingabe heisst
 * gleiche Ausgabe — kein Zufall, keine Uhrzeit, keine Messung am DOM. Genau
 * deshalb braucht die Reihe keine Diagrammbibliothek.
 *
 * Mengen kommen als Dezimalstrings herein und bleiben als Dezimalstrings in
 * den Beschriftungen: `storage_egress_bytes` kann über `Number.MAX_SAFE_INTEGER`
 * hinauslaufen, und eine Zahl, die im Bild um ein paar Bytes danebenliegt, ist
 * hinnehmbar — eine Zahl in der Tabelle, die danebenliegt, nicht. Für die
 * Höhe eines Balkens wird deshalb ein Verhältnis aus BigInt gerechnet und erst
 * danach in Pixel umgesetzt.
 *
 * Jeder Eimer bekommt zwei gestapelte Segmente: unten die angenommene Menge,
 * darüber die abgelehnte. Gestapelt und nicht nebeneinander, weil die Summe
 * die Frage ist („wie viel wurde gemessen") und die Ablehnung der Anteil
 * daran.
 */

export type UsageChartBucket = {
  /** ISO-8601, Beginn des Eimers. */
  start: string;
  accepted: string;
  rejected: string;
  events: number;
};

export type UsageChartSegment = { y: number; height: number };

export type UsageChartBar = {
  index: number;
  start: string;
  x: number;
  width: number;
  /** Unten: die angenommene Menge. */
  accepted: UsageChartSegment;
  /** Darüber: die abgelehnte Menge. */
  rejected: UsageChartSegment;
  /** Angenommen plus abgelehnt, exakt, als Dezimalstring. */
  total: string;
  events: number;
  /** Kein Ereignis in diesem Eimer; beide Segmente sind null hoch. */
  empty: boolean;
};

export type UsageChartTick = { value: string; y: number };
export type UsageChartLabel = { index: number; start: string; x: number };

export type UsageSeriesChart = {
  width: number;
  height: number;
  plot: { x: number; y: number; width: number; height: number };
  /** Grundlinie, auf der jeder Balken steht. */
  baselineY: number;
  /** Der höchste Eimer, exakt; bei einer leeren Reihe "0". */
  max: string;
  bars: UsageChartBar[];
  ticks: UsageChartTick[];
  labels: UsageChartLabel[];
  /** Kein einziger Eimer trägt eine Menge. */
  empty: boolean;
};

const WIDTH = 720;
const HEIGHT = 208;
const PAD_LEFT = 62;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 26;
/** Anteil der Eimerbreite, den der Balken einnimmt; der Rest ist Abstand. */
const BAR_SHARE = 0.72;
/** Mehr Beschriftungen an der Zeitachse überlappen einander. */
const MAX_LABELS = 8;
/** Auf Hundertstel gerundet: stabil, und im SVG nicht unterscheidbar. */
const round = (value: number) => Math.round(value * 100) / 100;

/** Dezimalstring zu BigInt; alles andere ist 0, nicht NaN. */
function quantity(value: string): bigint {
  return /^\d{1,30}$/.test(value) ? BigInt(value) : 0n;
}

/**
 * Anteil zweier BigInt als Zahl, über Zehntausendstel.
 *
 * `Number(a) / Number(b)` verlöre bei sehr grossen Mengen schon vor der
 * Division die letzten Stellen; hier bleibt die Division exakt und nur das
 * Ergebnis ist eine Zahl.
 */
function ratio(value: bigint, max: bigint): number {
  if (max <= 0n || value <= 0n) return 0;
  return Number((value * 10_000n) / max) / 10_000;
}

export function buildUsageSeriesChart(input: {
  buckets: ReadonlyArray<UsageChartBucket>;
  width?: number;
  height?: number;
}): UsageSeriesChart {
  const width = input.width ?? WIDTH;
  const height = input.height ?? HEIGHT;
  const plot = {
    x: PAD_LEFT,
    y: PAD_TOP,
    width: Math.max(width - PAD_LEFT - PAD_RIGHT, 1),
    height: Math.max(height - PAD_TOP - PAD_BOTTOM, 1),
  };
  const baselineY = plot.y + plot.height;

  const values = input.buckets.map((bucket) => ({
    accepted: quantity(bucket.accepted),
    rejected: quantity(bucket.rejected),
  }));
  let max = 0n;
  for (const value of values) {
    const total = value.accepted + value.rejected;
    if (total > max) max = total;
  }

  const slot = input.buckets.length > 0 ? plot.width / input.buckets.length : 0;
  const barWidth = round(Math.max(slot * BAR_SHARE, 1));
  const bars = input.buckets.map((bucket, index): UsageChartBar => {
    const value = values[index];
    const acceptedHeight = round(ratio(value.accepted, max) * plot.height);
    const rejectedHeight = round(ratio(value.rejected, max) * plot.height);
    const acceptedY = round(baselineY - acceptedHeight);
    return {
      index,
      start: bucket.start,
      x: round(plot.x + index * slot + (slot - barWidth) / 2),
      width: barWidth,
      accepted: { y: acceptedY, height: acceptedHeight },
      rejected: { y: round(acceptedY - rejectedHeight), height: rejectedHeight },
      total: (value.accepted + value.rejected).toString(),
      events: bucket.events,
      empty: bucket.events === 0,
    };
  });

  // Drei Marken: null, die Hälfte und der höchste Eimer. Die Hälfte wird
  // abgerundet, damit sie aus derselben Ganzzahlwelt stammt wie die Mengen.
  const ticks: UsageChartTick[] = max > 0n
    ? [
      { value: max.toString(), y: plot.y },
      { value: (max / 2n).toString(), y: round(plot.y + plot.height / 2) },
      { value: "0", y: baselineY },
    ]
    : [{ value: "0", y: baselineY }];

  const step = Math.max(1, Math.ceil(input.buckets.length / MAX_LABELS));
  const labels: UsageChartLabel[] = [];
  for (let index = 0; index < input.buckets.length; index += step) {
    labels.push({ index, start: input.buckets[index].start, x: round(plot.x + index * slot + slot / 2) });
  }

  return { width, height, plot, baselineY, max: max.toString(), bars, ticks, labels, empty: max === 0n };
}
