/**
 * Der Ladeweg der Rechnungs-Ansicht — als reine Funktion, damit er ohne
 * Browser-Testumgebung pruefbar ist.
 *
 * Die Lektion aus 1.75 (der SQL-Editor, der nie eine Route rief) gilt der
 * Console besonders: Diese Funktion ist die eine Stelle, die die
 * Invoices-Route wirklich aufruft; die React-Ansicht haengt sie nur ein.
 */

import { USAGE_METERING_DISABLED_ERROR } from "@/lib/console/billing";

/**
 * Eine Position, wie die Console sie liest — seit 0080 mit Bezeichnung.
 *
 * `metric` ist leer bei einer Pauschale; `kind` sagt es ausdruecklich, damit
 * die Ansicht nicht aus einer leeren Zeichenkette schliessen muss.
 */
export type ConsoleInvoiceLine = {
  lineKey: string;
  label: string;
  kind: "metered" | "flat";
  metric: string;
  amount: string;
};

export type ConsoleInvoice = {
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  total: string;
  /** Die Summe in Mikro-Einheiten; formatiert wird sie mit `formatMoneyMicros`. */
  totalMicros: string;
  unpricedMetrics: string[];
  dueAt: string;
  issuedAt: string;
  lines: ConsoleInvoiceLine[];
};

export type ConsoleInvoiceResult =
  | { state: "ready"; invoices: ConsoleInvoice[] }
  | { state: "disabled" }
  | { state: "unavailable" }
  | { state: "error" };

type WireInvoice = {
  invoiceNumber?: unknown; periodStart?: unknown; periodEnd?: unknown;
  currency?: unknown; total?: unknown; totalMicros?: unknown; unpricedMetrics?: unknown;
  dueAt?: unknown; issuedAt?: unknown;
  lines?: Array<{ lineKey?: unknown; label?: unknown; kind?: unknown; metric?: unknown; amount?: unknown }>;
};

/**
 * `periodEnd` ist exklusiv (Migration 0040: period_start + 1 Monat). Angezeigt
 * wird der letzte eingeschlossene Tag in UTC, wie beim laufenden Monat.
 */
export function inclusivePeriodEnd(periodEnd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return periodEnd;
  const day = new Date(`${periodEnd}T00:00:00.000Z`);
  if (Number.isNaN(day.getTime())) return periodEnd;
  return new Date(day.getTime() - 86_400_000).toISOString().slice(0, 10);
}

export async function loadConsoleInvoices(
  projectId: string,
  environment: string,
  fetcher: typeof fetch = fetch,
): Promise<ConsoleInvoiceResult> {
  try {
    const response = await fetcher(
      `/api/v1/projects/${projectId}/environments/${environment}/usage/invoices?limit=12`,
      { cache: "no-store" },
    );
    if (response.status === 503) {
      // Dieselbe 503 traegt zwei Bedeutungen (usageRouteError): abgeschaltetes
      // Metering oder ein erschoepfter Verbindungspool. Nur der Body trennt
      // sie; abgeschaltet heisst es nur, wenn der Body das sagt (wie billing.ts).
      const failure = (await response.json().catch(() => ({}))) as { error?: unknown } | null;
      return failure?.error === USAGE_METERING_DISABLED_ERROR ? { state: "disabled" } : { state: "unavailable" };
    }
    if (!response.ok) return { state: "error" };
    const body = (await response.json()) as { data?: WireInvoice[] };
    if (!Array.isArray(body.data)) return { state: "error" };
    return {
      state: "ready",
      invoices: body.data.map((invoice) => ({
        invoiceNumber: String(invoice.invoiceNumber ?? ""),
        periodStart: String(invoice.periodStart ?? ""),
        periodEnd: String(invoice.periodEnd ?? ""),
        currency: String(invoice.currency ?? ""),
        total: String(invoice.total ?? ""),
        totalMicros: typeof invoice.totalMicros === "string" && /^-?\d{1,30}$/.test(invoice.totalMicros)
          ? invoice.totalMicros : "",
        unpricedMetrics: Array.isArray(invoice.unpricedMetrics)
          ? invoice.unpricedMetrics.filter((metric): metric is string => typeof metric === "string") : [],
        dueAt: String(invoice.dueAt ?? ""),
        issuedAt: String(invoice.issuedAt ?? ""),
        lines: (invoice.lines ?? []).map((line) => ({
          lineKey: String(line.lineKey ?? ""),
          label: String(line.label ?? ""),
          kind: line.kind === "flat" ? "flat" as const : "metered" as const,
          metric: String(line.metric ?? ""),
          amount: String(line.amount ?? ""),
        })),
      })),
    };
  } catch {
    return { state: "error" };
  }
}
