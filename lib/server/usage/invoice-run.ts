import { RepositoryError, type RepositoryErrorCode } from "@/lib/server/db/errors";
import {
  safeRuntimeProbe,
  type RuntimeProbeObserver,
} from "@/lib/server/operations/runtime-probe";
import {
  USAGE_METRIC_DEFINITIONS,
  type UsageMetric,
} from "@/lib/server/usage/model";
import type { BillingRateCard } from "@/lib/server/usage/billing";
import type { PostgresControlPlane } from "@/lib/server/db/repositories";

/**
 * Der Rechnungslauf — Sprosse 2 der Paritätsleiter.
 *
 * Er unterscheidet sich von der Projektion aus `1.67.0` in genau einem Punkt:
 * Er friert ein. Das Fenster muss abgeschlossen sein, die Rechnung ist
 * append-only, und je (Projekt, Umgebung, Periode) entsteht höchstens eine —
 * die eindeutige Beschränkung aus Migration 0040 trägt die Idempotenz, nicht
 * dieser Code.
 *
 * Er läuft als eigener Prozess (`workers/billing-invoice-runtime.mts`) mit der
 * Worker-Rolle. Die Lektion der Sprint gilt auch hier: Ein Rechnungslauf, den
 * niemand startet, fakturiert nichts — deshalb gehört zum Slice der Prozess
 * und sein Arbeitsnachweis, nicht nur diese Klasse.
 */

export type BillingInvoiceLogEvent = Readonly<{
  event: "billing.invoice.issued" | "billing.invoice.exists" |
    "billing.invoice.skipped_no_rate_card" | "billing.invoice.run_completed" |
    "billing.invoice.run_failed";
  period?: string;
  projectId?: string;
  environment?: string;
  invoiceId?: string;
  totalMicros?: string;
  currency?: string;
  issued?: number;
  existing?: number;
  skipped?: number;
  /** Feste Codes, niemals Datenbankmeldungen — wie beim Provisioner seit 1.66. */
  reason?: RepositoryErrorCode | "UNKNOWN";
}>;

export type BillingInvoiceRunResult = Readonly<{
  period: string;
  issued: number;
  existing: number;
  skipped: number;
}>;

type CounterRow = { project_id: string; environment: string; metric: string; quantity: string };

export type BillingInvoiceRunOptions = {
  organizationId: string;
  runnerId: string;
  /** `YYYY-MM`; ohne Angabe der letzte abgeschlossene Monat. */
  period?: string;
  idleDelayMs?: number;
  maxIterations?: number;
  logger?: { log(event: BillingInvoiceLogEvent): void };
  probe?: RuntimeProbeObserver;
  now?: () => Date;
};

export class BillingInvoiceRun {
  private loopRunning = false;

  constructor(
    private readonly database: Pick<PostgresControlPlane, "withTenant">,
    private readonly options: BillingInvoiceRunOptions,
  ) {}

  private now() { return this.options.now?.() ?? new Date(); }

  /**
   * Fakturiert eine abgeschlossene Periode — idempotent.
   *
   * Alles in **einer** Tenant-Transaktion: Eine Rechnung ohne ihre Posten kann
   * so nicht entstehen, auch nicht durch einen Absturz zwischen zwei INSERTs.
   */
  async runOnce(): Promise<BillingInvoiceRunResult> {
    const window = closedPeriodWindow(this.options.period, this.now());
    const summary = await this.database.withTenant({
      organizationId: this.options.organizationId,
      actorRef: this.options.runnerId,
    }, async (repositories) => {
      const rates = await repositories.transaction.query<{
        metric: string; unit_price_micros: string; per_units: string; currency: string;
      }>(
        `SELECT DISTINCT ON (metric) metric, unit_price_micros::text AS unit_price_micros,
                per_units::text AS per_units, currency
         FROM billing_rate_cards
         WHERE organization_id = $1 AND effective_from < $2::date
         ORDER BY metric, effective_from DESC`,
        [this.options.organizationId, iso(window.end)],
      );
      const rateByMetric = new Map(rates.rows.map((row) => [row.metric as UsageMetric, {
        metric: row.metric as UsageMetric,
        unitPriceMicros: BigInt(row.unit_price_micros),
        perUnits: BigInt(row.per_units),
        currency: row.currency,
      }]));

      const counters = await repositories.transaction.query<CounterRow>(
        `SELECT project_id, environment, metric, quantity::text AS quantity
         FROM usage_counters
         WHERE organization_id = $1 AND window_start = $2::timestamptz AND quantity > 0
         ORDER BY project_id, environment, metric`,
        [this.options.organizationId, window.start.toISOString()],
      );

      const byEnvironment = new Map<string, CounterRow[]>();
      for (const row of counters.rows) {
        const key = `${row.project_id}/${row.environment}`;
        byEnvironment.set(key, [...(byEnvironment.get(key) ?? []), row]);
      }

      let issued = 0; let existing = 0; let skipped = 0;
      for (const rows of byEnvironment.values()) {
        const projectId = rows[0]!.project_id;
        const environment = rows[0]!.environment;
        const computed = computeInvoice(rows.map((row) => ({
          metric: row.metric as UsageMetric, quantity: BigInt(row.quantity),
        })), rateByMetric);
        if (!computed) {
          // Nutzung vorhanden, aber kein einziger Preis: Eine Rechnung ueber
          // null waere eine Aussage, die niemand gemeint hat.
          skipped += 1;
          safeLog(this.options.logger, {
            event: "billing.invoice.skipped_no_rate_card",
            period: window.period, projectId, environment,
          });
          continue;
        }
        await repositories.transaction.query("SAVEPOINT invoice_numbering");
        const inserted = await repositories.transaction.query<{ id: string }>(
          // Die Nummer entsteht im selben Statement wie die Rechnung: Der
          // Zaehler-Upsert serialisiert den Kreis je Organisation, und die
          // Rechnungen bleiben append-only — kein UPDATE traegt je eine
          // Nummer nach. Die CTE laeuft auch, wenn der aeussere INSERT im
          // ON CONFLICT verliert; deshalb steht das Ganze in einem SAVEPOINT,
          // und der Verlierer rollt seinen Zaehlerstand zurueck — eine
          // vergebene Nummer ohne Rechnung ist nicht ausdrueckbar.
          `WITH numbered AS (
             INSERT INTO billing_invoice_counters AS counter (organization_id, next_number)
             VALUES ($1, 1)
             ON CONFLICT (organization_id)
               DO UPDATE SET next_number = counter.next_number + 1
             RETURNING next_number
           )
           INSERT INTO billing_invoices
             (organization_id, project_id, environment, period_start, period_end,
              currency, total_micros, unpriced_metrics, issued_by, invoice_number)
           SELECT $1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, numbered.next_number
           FROM numbered
           ON CONFLICT (organization_id, project_id, environment, period_start) DO NOTHING
           RETURNING id, invoice_number`,
          [this.options.organizationId, projectId, environment, iso(window.start), iso(window.end),
            computed.currency, computed.totalMicros.toString(), computed.unpriced, this.options.runnerId],
        );
        const invoiceId = inserted.rows[0]?.id;
        if (!invoiceId) {
          await repositories.transaction.query("ROLLBACK TO SAVEPOINT invoice_numbering");
          existing += 1;
          safeLog(this.options.logger, {
            event: "billing.invoice.exists", period: window.period, projectId, environment,
          });
          continue;
        }
        await repositories.transaction.query("RELEASE SAVEPOINT invoice_numbering");
        for (const line of computed.lines) {
          await repositories.transaction.query(
            `INSERT INTO billing_invoice_lines
               (organization_id, invoice_id, metric, quantity, unit_price_micros, per_units, amount_micros)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [this.options.organizationId, invoiceId, line.metric, line.quantity.toString(),
              line.unitPriceMicros.toString(), line.perUnits.toString(), line.amountMicros.toString()],
          );
        }
        issued += 1;
        safeLog(this.options.logger, {
          event: "billing.invoice.issued", period: window.period, projectId, environment,
          invoiceId, totalMicros: computed.totalMicros.toString(), currency: computed.currency,
        });
      }
      return { period: window.period, issued, existing, skipped };
    });
    safeLog(this.options.logger, { event: "billing.invoice.run_completed", ...summary });
    return summary;
  }

  /** Die Schleife der anderen Prozesse: Probe, Runde, Wartezeit, Signal. */
  async run(signal: AbortSignal): Promise<void> {
    if (this.loopRunning) throw new Error("The billing invoice run is already running.");
    this.loopRunning = true;
    const idle = this.options.idleDelayMs ?? 3_600_000;
    let iterations = 0;
    safeRuntimeProbe(this.options.probe, "runtimeStarted");
    try {
      while (!signal.aborted) {
        try {
          await this.runOnce();
          safeRuntimeProbe(this.options.probe, "iterationSucceeded");
        } catch (error) {
          safeRuntimeProbe(this.options.probe, "iterationFailed");
          safeLog(this.options.logger, {
            event: "billing.invoice.run_failed",
            reason: error instanceof RepositoryError ? error.code : "UNKNOWN",
          });
        }
        iterations += 1;
        if (this.options.maxIterations !== undefined && iterations >= this.options.maxIterations) return;
        await delay(idle, signal);
      }
    } finally {
      this.loopRunning = false;
      safeRuntimeProbe(this.options.probe, "runtimeStopped");
    }
  }
}

export type ClosedPeriodWindow = { period: string; start: Date; end: Date };

/**
 * Nur abgeschlossene Perioden.
 *
 * Ohne Angabe der letzte abgeschlossene Monat. Mit Angabe wird geprueft, dass
 * das Fensterende nicht in der Zukunft und nicht im laufenden Monat liegt —
 * eine Rechnung ueber ein offenes Fenster waere die Projektion aus 1.67 mit
 * falschem Etikett.
 */
export function closedPeriodWindow(period: string | undefined, now: Date): ClosedPeriodWindow {
  let start: Date;
  if (period === undefined) {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  } else {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      throw new BillingInvoicePeriodError("QKERN_BILLING_PERIOD must look like YYYY-MM.");
    }
    start = new Date(`${period}-01T00:00:00.000Z`);
  }
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  if (end.getTime() > now.getTime()) {
    throw new BillingInvoicePeriodError("The billing invoice run only closes past periods.");
  }
  return { period: start.toISOString().slice(0, 7), start, end };
}

export class BillingInvoicePeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingInvoicePeriodError";
  }
}

export type InvoiceLine = {
  metric: UsageMetric;
  quantity: bigint;
  unitPriceMicros: bigint;
  perUnits: bigint;
  amountMicros: bigint;
};

/**
 * Posten und Summe einer Umgebung — reine Arithmetik, lokal getestet.
 *
 * `null`, wenn keine einzige Metrik einen Preis hat. Abgerundet auf den Mikro,
 * wie in der Projektion: der angebrochene Mikro-Franken gehoert dem Kunden.
 */
export function computeInvoice(
  counters: ReadonlyArray<{ metric: UsageMetric; quantity: bigint }>,
  rates: ReadonlyMap<UsageMetric, Pick<BillingRateCard, "metric" | "unitPriceMicros" | "perUnits" | "currency">>,
): { lines: InvoiceLine[]; unpriced: UsageMetric[]; currency: string; totalMicros: bigint } | null {
  const lines: InvoiceLine[] = [];
  const unpriced: UsageMetric[] = [];
  let totalMicros = 0n;
  let currency: string | null = null;
  for (const counter of counters) {
    if (!(counter.metric in USAGE_METRIC_DEFINITIONS) || counter.quantity <= 0n) continue;
    const rate = rates.get(counter.metric);
    if (!rate) { unpriced.push(counter.metric); continue; }
    const amountMicros = (counter.quantity * rate.unitPriceMicros) / rate.perUnits;
    lines.push({
      metric: counter.metric, quantity: counter.quantity,
      unitPriceMicros: rate.unitPriceMicros, perUnits: rate.perUnits, amountMicros,
    });
    totalMicros += amountMicros;
    currency ??= rate.currency;
  }
  if (currency === null) return null;
  return { lines, unpriced, currency, totalMicros };
}

function iso(date: Date) { return date.toISOString().slice(0, 10); }

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds);
    const onAbort = () => { cleanup(); resolve(); };
    function cleanup() { clearTimeout(timer); signal.removeEventListener("abort", onAbort); }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function safeLog(
  logger: { log(event: BillingInvoiceLogEvent): void } | undefined,
  event: BillingInvoiceLogEvent,
) {
  try { logger?.log(event); } catch { /* Observability never controls invoicing. */ }
}
