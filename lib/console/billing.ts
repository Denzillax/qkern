/**
 * Die Monatsprojektion in Geld, wie die Console sie liest.
 *
 * Quelle ist `GET .../usage/billing` (BillingService.readBillingProjection):
 * `{ data: { kind: "projection", period, currency, lines, totalMicros,
 * total, unpricedMetrics } }`. Das Preisblatt hat keine eigene REST-Flaeche;
 * die bepreisten Zeilen der Projektion tragen den Preis, der am Ende der
 * Periode gilt. Ein Gueltigkeitsdatum liefert die Route nicht.
 *
 * Statuscodes (usageRouteError): 200 bereit, 503 mit "Usage Metering is
 * disabled" abgeschaltet, 503 sonst voruebergehend nicht erreichbar
 * (erschoepfter Verbindungspool), alles andere Fehler.
 */

export type BillingProjectionLine = {
  metric: string;
  unit: string;
  used: string;
  priced: boolean;
  unitPriceMicros: string | null;
  perUnits: string | null;
  amountMicros: string | null;
};

/** Eine Pauschale des laufenden Monats: eine Bezeichnung und ein Betrag. */
export type BillingProjectionCharge = {
  code: string;
  label: string;
  amountMicros: string;
};

export type BillingProjection = {
  period: string;
  currency: string | null;
  lines: BillingProjectionLine[];
  charges: BillingProjectionCharge[];
  totalMicros: string;
  unpricedMetrics: string[];
};

export type BillingProjectionState =
  | { state: "ready"; projection: BillingProjection }
  | { state: "disabled" }
  | { state: "unavailable" }
  | { state: "error"; message: string };

export const USAGE_METERING_DISABLED_ERROR = "Usage Metering is disabled";

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const MICROS = /^-?\d{1,30}$/;

function text(value: unknown): string | null { return typeof value === "string" ? value : null; }
function micros(value: unknown): string | null { return typeof value === "string" && MICROS.test(value) ? value : null; }

/** Ordnet Status und Body der Billing-Route einem Zustand zu; ein unerwarteter Body ist ein Fehler. */
export function billingProjectionState(status: number, payload: Record<string, unknown>): BillingProjectionState {
  if (status === 503) {
    return payload.error === USAGE_METERING_DISABLED_ERROR ? { state: "disabled" } : { state: "unavailable" };
  }
  const message = text(payload.error) ?? "";
  if (status !== 200) return { state: "error", message };
  const data = payload.data as Record<string, unknown> | null | undefined;
  if (!data || typeof data !== "object" || data.kind !== "projection" || !Array.isArray(data.lines)) {
    return { state: "error", message };
  }
  const period = text(data.period);
  const totalMicros = micros(data.totalMicros);
  if (!period || !PERIOD.test(period) || totalMicros === null) return { state: "error", message };
  const lines: BillingProjectionLine[] = [];
  for (const raw of data.lines as unknown[]) {
    if (!raw || typeof raw !== "object") return { state: "error", message };
    const line = raw as Record<string, unknown>;
    const metric = text(line.metric);
    if (!metric) return { state: "error", message };
    const priced = line.priced === true;
    lines.push({
      metric,
      unit: text(line.unit) ?? "",
      used: micros(line.used) ?? "0",
      priced,
      unitPriceMicros: priced ? micros(line.unitPriceMicros) : null,
      perUnits: priced ? micros(line.perUnits) : null,
      amountMicros: priced ? micros(line.amountMicros) : null,
    });
  }
  // Pauschalen sind seit 0080 Teil der Antwort. Eine Antwort ohne das Feld ist
  // kein Fehler, sondern eine Umgebung ohne Pauschale: Die Liste bleibt leer.
  const charges: BillingProjectionCharge[] = [];
  for (const raw of Array.isArray(data.charges) ? data.charges as unknown[] : []) {
    if (!raw || typeof raw !== "object") return { state: "error", message };
    const charge = raw as Record<string, unknown>;
    const code = text(charge.code);
    const label = text(charge.label);
    const amountMicros = micros(charge.amountMicros);
    if (!code || !label || amountMicros === null) return { state: "error", message };
    charges.push({ code, label, amountMicros });
  }
  return {
    state: "ready",
    projection: {
      period,
      currency: text(data.currency),
      lines,
      charges,
      totalMicros,
      unpricedMetrics: Array.isArray(data.unpricedMetrics)
        ? data.unpricedMetrics.filter((metric): metric is string => typeof metric === "string")
        : [],
    },
  };
}

/** "2026-09" → erster und letzter Kalendertag in UTC, als ISO-Datum. */
export function periodRange(period: string): { first: string; last: string } | null {
  if (!PERIOD.test(period)) return null;
  const [year, month] = period.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0));
  return { first: `${period}-01`, last: last.toISOString().slice(0, 10) };
}

/**
 * Der Ausblick auf die naechste Rechnung, abgeleitet aus der Periode.
 *
 * Warum hier kein Faelligkeitsdatum steht: Der Rechnungslauf nimmt nur eine
 * abgeschlossene Periode an (`closedPeriodWindow` in
 * `lib/server/usage/invoice-run.ts` wirft, solange das Fenster in der Zukunft
 * endet), und er laeuft als eigener Prozess, den ein Betreiber startet. Im
 * Backend gibt es keine Zeile, die einen Termin traegt, also kann die Console
 * keinen nennen. Ableitbar ist genau zweierlei, und beides steht in der
 * Ansicht mit seiner Herkunft: der letzte Tag der laufenden Periode und der
 * erste Tag, an dem sie als abgeschlossen gilt.
 */
export type NextInvoiceOutlook = {
  period: string;
  /** Letzter Kalendertag der Periode, in UTC. */
  periodLastDay: string;
  /** Erster Tag, an dem der Rechnungslauf die Periode annimmt, in UTC. */
  closedFrom: string;
};

export function nextInvoiceOutlook(period: string): NextInvoiceOutlook | null {
  const range = periodRange(period);
  if (!range) return null;
  const [year, month] = period.split("-").map(Number);
  // `month` ist eins-basiert, der Monatsindex null-basiert: `month` zeigt
  // damit schon auf den Folgemonat, und dessen erster Tag ist der Tag, an dem
  // die Periode vorbei ist.
  const closed = new Date(Date.UTC(year, month, 1));
  return { period, periodLastDay: range.last, closedFrom: closed.toISOString().slice(0, 10) };
}

/**
 * Die Zahlungsfrist einer ausgestellten Rechnung in Tagen, aus dem Dokument
 * selbst gerechnet.
 *
 * Die Frist steht nirgends als Zahl in der Console. Sie ist die Differenz
 * zwischen `issuedAt` und `dueAt`, und beide kommen aus der Rechnung. Eine
 * Konstante hier waere eine zweite Wahrheit neben dem DEFAULT aus Migration
 * 0044, und sie waere falsch, sobald der Betreiber ihn aendert.
 */
export function paymentTermDays(issuedAt: string, dueAt: string): number | null {
  const from = Date.parse(issuedAt);
  const to = Date.parse(dueAt);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
  return Math.round((to - from) / 86_400_000);
}

/**
 * Menge zu Grenze als Anteil, oder null, wenn es keine Grenze gibt.
 *
 * `null` ist kein Fehler, sondern die Auskunft der Route: Ohne Quota-Policy
 * traegt `limit` in `PublicUsageProjection` null, und ohne Grenze gibt es
 * nichts zu zeichnen. Die Ansicht haengt genau daran, ob ein Balken erscheint
 * -- ein Balken ohne Grenze waere ein Bild, das eine Zahl behauptet, die
 * niemand gesetzt hat.
 *
 * Gerechnet wird in BigInt und erst zuletzt geteilt. Eine Menge jenseits von
 * `Number.MAX_SAFE_INTEGER` (Egress in Bytes erreicht das) verliert sonst
 * Stellen, bevor der Anteil ueberhaupt entsteht.
 */
export function usageMeterRatio(used: string, limit: string | null): number | null {
  if (limit === null) return null;
  const ceiling = micros(limit);
  const amount = micros(used);
  if (ceiling === null || amount === null) return null;
  const top = BigInt(ceiling);
  if (top <= 0n) return null;
  const quantity = BigInt(amount);
  return Number(((quantity < 0n ? 0n : quantity) * 10_000n) / top) / 10_000;
}

/**
 * Die Breite des Balkens in Prozent, gekappt bei hundert.
 *
 * Gekappt, weil ein Balken breiter als seine Spur nichts zeigt; dass die
 * Grenze ueberschritten ist, sagt daneben der Anteil und der Zustand aus der
 * Route. Das Ergebnis ist eine CSS-Laenge und kein angezeigter Zahlenwert,
 * darum steht hier `Math.round` und nicht der Formatierer der Console.
 */
export function usageMeterWidth(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  return Math.min(100, Math.round(ratio * 1000) / 10);
}
