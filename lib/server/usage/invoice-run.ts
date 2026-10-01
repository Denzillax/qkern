import { recognisedByName } from "@/lib/server/errors/identity";
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
 *
 * ## Mehr als sechs Positionen (Migration 0080)
 *
 * Eine Rechnung trug bis dahin höchstens sechs Zeilen, eine je Metrik, weil
 * `UNIQUE (invoice_id, metric)` die Position an die Metrik band. Seit 0080
 * trägt jede Position einen stabilen Schlüssel — `metric:<kennung>` oder
 * `charge:<code>` — und die Eindeutigkeit hängt an ihm. Der Unterschied ist
 * wichtig für die Zusage dieses Laufs: Die Idempotenz über zwei Läufe hinweg
 * trägt weiterhin allein die eindeutige Beschränkung auf der **Rechnung**.
 * Verliert der zweite Lauf dort im ON CONFLICT, schreibt er keine einzige
 * Position, weil die Posten erst nach der gewonnenen Rechnung entstehen. Der
 * Schlüssel je Position verhindert etwas anderes: dass eine Rechnung dieselbe
 * Sache zweimal nennt.
 *
 * Eine Pauschale kommt zu ihrem Betrag mit einer Menge von 1 und einer
 * Bezugsgrösse von 1. Es gibt keinen Positionstyp mit eingetragenem Betrag;
 * jeder Betrag auf einer Rechnung bleibt nachrechenbar.
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
  /**
   * Pauschalen, die der Lauf nicht fakturiert hat, weil ihre Waehrung nicht
   * die der Rechnung ist. Der Dienst laesst sie nicht entstehen; faende der
   * Lauf eine, waere Schweigen die schlechteste Antwort.
   */
  mismatchedCharges?: string[];
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
type ChargeRow = {
  project_id: string; environment: string; code: string; label: string;
  amount_micros: string; currency: string;
};

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

      // Die wirksamen Pauschalen des Fensters, je (Projekt, Umgebung, Code)
      // die juengste Zeile mit Stichtag vor dem Fensterende — dieselbe Regel
      // wie beim Preisblatt. Beendete (Betrag 0) kommen mit und fallen erst in
      // der Komposition heraus; eine beendete Pauschale ist kein Grund, eine
      // Umgebung ganz auszulassen, aber auch keine Zeile.
      const charges = await repositories.transaction.query<ChargeRow>(
        `SELECT DISTINCT ON (project_id, environment, code)
                project_id, environment, code, label,
                amount_micros::text AS amount_micros, currency
         FROM billing_charges
         WHERE organization_id = $1 AND effective_from < $2::date
         ORDER BY project_id, environment, code, effective_from DESC`,
        [this.options.organizationId, iso(window.end)],
      );

      // Zaehler **und** Pauschalen bestimmen, welche Umgebungen der Lauf
      // besucht. Vor 0080 fuehrten nur die Zaehler; ein Projekt mit einer
      // Pauschale und ohne jede Nutzung haette nie eine Rechnung gesehen.
      const byEnvironment = new Map<string, { projectId: string; environment: string;
        counters: CounterRow[]; charges: ChargeRow[] }>();
      const bucket = (projectId: string, environment: string) => {
        const key = `${projectId}/${environment}`;
        const found = byEnvironment.get(key) ??
          { projectId, environment, counters: [], charges: [] };
        byEnvironment.set(key, found);
        return found;
      };
      for (const row of counters.rows) bucket(row.project_id, row.environment).counters.push(row);
      for (const row of charges.rows) bucket(row.project_id, row.environment).charges.push(row);

      let issued = 0; let existing = 0; let skipped = 0;
      for (const group of byEnvironment.values()) {
        const projectId = group.projectId;
        const environment = group.environment;
        const computed = computeInvoice(group.counters.map((row) => ({
          metric: row.metric as UsageMetric, quantity: BigInt(row.quantity),
        })), rateByMetric, group.charges.map((row) => ({
          code: row.code, label: row.label,
          amountMicros: BigInt(row.amount_micros), currency: row.currency,
        })));
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
          // `line_key` ist der stabile Schluessel der Position: `metric:<kennung>`
          // oder `charge:<code>`. Er traegt die Eindeutigkeit innerhalb der
          // Rechnung (Migration 0080), und er ist abgeleitet, nicht erzeugt —
          // derselbe Monat, dieselbe Quelle, derselbe Schluessel.
          await repositories.transaction.query(
            `INSERT INTO billing_invoice_lines
               (organization_id, invoice_id, line_key, label, metric, quantity,
                unit_price_micros, per_units, amount_micros)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [this.options.organizationId, invoiceId, line.lineKey, line.label, line.metric,
              line.quantity.toString(), line.unitPriceMicros.toString(),
              line.perUnits.toString(), line.amountMicros.toString()],
          );
        }
        issued += 1;
        safeLog(this.options.logger, {
          event: "billing.invoice.issued", period: window.period, projectId, environment,
          invoiceId, totalMicros: computed.totalMicros.toString(), currency: computed.currency,
          ...computed.mismatchedCharges.length > 0
            ? { mismatchedCharges: computed.mismatchedCharges } : {},
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
recognisedByName(BillingInvoicePeriodError, "BillingInvoicePeriodError");

/**
 * Eine Position einer Rechnung — seit 0080 mit stabilem Schluessel und
 * Bezeichnung.
 *
 * `metric` ist `null` bei einer Pauschale. Die Menge ist dann 1 und die
 * Bezugsgroesse 1: Der Betrag bleibt gerechnet, eine Formel fuer alle
 * Positionen.
 */
export type InvoiceLine = {
  lineKey: string;
  label: string;
  metric: UsageMetric | null;
  quantity: bigint;
  unitPriceMicros: bigint;
  perUnits: bigint;
  amountMicros: bigint;
};

export type InvoiceCharge = {
  code: string;
  label: string;
  amountMicros: bigint;
  currency: string;
};

/**
 * Posten und Summe einer Umgebung — reine Arithmetik, lokal getestet.
 *
 * `null`, wenn weder eine Metrik einen Preis hat noch eine Pauschale gilt.
 * Abgerundet auf den Mikro, wie in der Projektion: der angebrochene
 * Mikro-Franken gehoert dem Kunden.
 *
 * Die Waehrung kommt vom Preisblatt, wenn es eine bepreiste Metrik gibt, sonst
 * von der ersten geltenden Pauschale. Eine Pauschale in einer anderen Waehrung
 * faellt heraus statt die Rechnung zu vermischen; erzeugen kann sie der Dienst
 * nicht, der eine Waehrung je Organisation durchsetzt (`assertSingleCurrency`).
 */
export function computeInvoice(
  counters: ReadonlyArray<{ metric: UsageMetric; quantity: bigint }>,
  rates: ReadonlyMap<UsageMetric, Pick<BillingRateCard, "metric" | "unitPriceMicros" | "perUnits" | "currency">>,
  charges: ReadonlyArray<InvoiceCharge> = [],
): {
  lines: InvoiceLine[]; unpriced: UsageMetric[]; currency: string;
  totalMicros: bigint; mismatchedCharges: string[];
} | null {
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
      lineKey: `metric:${counter.metric}`,
      label: USAGE_METRIC_DEFINITIONS[counter.metric].label,
      metric: counter.metric, quantity: counter.quantity,
      unitPriceMicros: rate.unitPriceMicros, perUnits: rate.perUnits, amountMicros,
    });
    totalMicros += amountMicros;
    currency ??= rate.currency;
  }
  // Die Pauschalen in einer festen Reihenfolge, damit zwei Laeufe desselben
  // Monats dieselbe Rechnung ergeben wuerden — und damit die Waehrung einer
  // reinen Pauschalenrechnung nicht von der Lesereihenfolge abhaengt.
  const mismatchedCharges: string[] = [];
  for (const charge of [...charges].sort((left, right) => left.code.localeCompare(right.code))) {
    if (charge.amountMicros <= 0n) continue;
    currency ??= charge.currency;
    if (charge.currency !== currency) { mismatchedCharges.push(charge.code); continue; }
    lines.push({
      lineKey: `charge:${charge.code}`,
      label: charge.label,
      metric: null,
      quantity: 1n,
      unitPriceMicros: charge.amountMicros,
      perUnits: 1n,
      amountMicros: charge.amountMicros,
    });
    totalMicros += charge.amountMicros;
  }
  if (currency === null) return null;
  return { lines, unpriced, currency, totalMicros, mismatchedCharges };
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
