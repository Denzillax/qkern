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

export type BillingProjection = {
  period: string;
  currency: string | null;
  lines: BillingProjectionLine[];
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
  return {
    state: "ready",
    projection: {
      period,
      currency: text(data.currency),
      lines,
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
