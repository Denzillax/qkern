/**
 * Der Ladeweg der Rechnungs-Ansicht — als reine Funktion, damit er ohne
 * Browser-Testumgebung pruefbar ist.
 *
 * Die Lektion aus 1.75 (der SQL-Editor, der nie eine Route rief) gilt der
 * Console besonders: Diese Funktion ist die eine Stelle, die die
 * Invoices-Route wirklich aufruft; die React-Ansicht haengt sie nur ein.
 */

export type ConsoleInvoiceLine = { metric: string; amount: string };

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
  lines?: Array<{ metric?: unknown; amount?: unknown }>;
};

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
      // Metering oder ein erschoepfter Verbindungspool. Nur der Body trennt sie.
      const failure = (await response.json().catch(() => ({}))) as { error?: unknown } | null;
      return failure?.error === "Usage unavailable" ? { state: "unavailable" } : { state: "disabled" };
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
          metric: String(line.metric ?? ""), amount: String(line.amount ?? ""),
        })),
      })),
    };
  } catch {
    return { state: "error" };
  }
}
