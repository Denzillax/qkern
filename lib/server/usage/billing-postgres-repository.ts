import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { UsageMetric, UsagePrincipal } from "@/lib/server/usage/model";
import { UsageError } from "@/lib/server/usage/service";
import {
  microsToDecimal,
  type BillingInvoiceLine,
  type BillingInvoiceReader,
  type BillingInvoiceSummary,
  type BillingRateCard,
  type BillingRateCardRepository,
} from "@/lib/server/usage/billing";
import type { UsageScope } from "@/lib/server/usage/model";
import { ConflictError } from "@/lib/server/db/errors";

const CARD_COLUMNS = `
  metric, unit_price_micros::text AS unit_price_micros, per_units::text AS per_units,
  currency, effective_from::text AS effective_from, created_by`;

type CardRow = {
  metric: string;
  unit_price_micros: string;
  per_units: string;
  currency: string;
  effective_from: string;
  created_by: string;
};

/** Preisblatt gegen echtes PostgreSQL, durch dieselbe Tenant-Transaktion wie Usage. */
export class PostgresBillingRateCardRepository implements BillingRateCardRepository {
  constructor(private readonly database: Pick<PostgresControlPlane, "withTenant">) {}

  insert(principal: UsagePrincipal, card: BillingRateCard & { organizationId: string }) {
    return this.database.withTenant(
      { organizationId: principal.organizationId, actorRef: principal.actorRef },
      async (repositories) => {
        try {
          const result = await repositories.transaction.query<CardRow>(
            `INSERT INTO billing_rate_cards
               (organization_id, metric, unit_price_micros, per_units, currency, effective_from, created_by)
             VALUES ($1, $2, $3, $4, $5, $6::date, $7)
             RETURNING ${CARD_COLUMNS}`,
            [card.organizationId, card.metric, card.unitPriceMicros.toString(),
              card.perUnits.toString(), card.currency, card.effectiveFrom, card.createdBy],
          );
          return cardFromRow(result.rows[0]!);
        } catch (error) {
          // Zweimal derselbe Stichtag fuer dieselbe Metrik ist ein Konflikt
          // des Preisblatts, kein Infrastrukturfehler.
          if (error instanceof ConflictError) throw new UsageError("USAGE_POLICY_CONFLICT");
          throw error;
        }
      });
  }

  effectiveRates(principal: UsagePrincipal, organizationId: string, at: Date) {
    return this.database.withTenant(
      { organizationId, actorRef: principal.actorRef, readOnly: true },
      async (repositories) => {
        // Je Metrik die juengste Zeile, deren Stichtag nicht nach `at` liegt.
        // `DESC` traegt die Zusage „der neueste Preis gilt" — die
        // Mutationsprobe dieses Releases dreht genau dieses Wort um.
        const result = await repositories.transaction.query<CardRow>(
          `SELECT DISTINCT ON (metric) ${CARD_COLUMNS}
           FROM billing_rate_cards
           WHERE organization_id = $1 AND effective_from <= $2::date
           ORDER BY metric, effective_from DESC`,
          [organizationId, at.toISOString().slice(0, 10)],
        );
        return result.rows.map(cardFromRow);
      });
  }

  currencies(principal: UsagePrincipal, organizationId: string) {
    return this.database.withTenant(
      { organizationId, actorRef: principal.actorRef, readOnly: true },
      async (repositories) => {
        const result = await repositories.transaction.query<{ currency: string }>(
          "SELECT DISTINCT currency FROM billing_rate_cards WHERE organization_id = $1",
          [organizationId],
        );
        return result.rows.map((row) => row.currency);
      });
  }
}

function cardFromRow(row: CardRow): BillingRateCard {
  return {
    metric: row.metric as UsageMetric,
    unitPriceMicros: BigInt(row.unit_price_micros),
    perUnits: BigInt(row.per_units),
    currency: row.currency,
    effectiveFrom: row.effective_from,
    createdBy: row.created_by,
  };
}

/**
 * Liest ausgestellte Rechnungen mit der Laufzeitrolle.
 *
 * Zwei Abfragen statt eines Joins: Die Posten haengen an ihren Rechnungen,
 * und eine Rechnung ohne Posten (alles unbepreist) bleibt trotzdem sichtbar.
 * Die Mandantengrenze traegt die RLS aus Migration 0040 — die Lektion aus
 * 1.37 und 1.60: vom Adapter aus laesst sie sich nicht brechen.
 */
export class PostgresBillingInvoiceReader implements BillingInvoiceReader {
  constructor(private readonly database: Pick<PostgresControlPlane, "withTenant">) {}

  listInvoices(principal: UsagePrincipal, scope: UsageScope, limit: number) {
    return this.database.withTenant(
      { organizationId: scope.organizationId, actorRef: principal.actorRef, readOnly: true },
      async (repositories) => {
        const invoices = await repositories.transaction.query<{
          id: string; invoice_number: string; due_at: string;
          project_id: string; environment: string;
          period_start: string; period_end: string; currency: string;
          total_micros: string; unpriced_metrics: string[]; issued_at: string;
        }>(
          `SELECT id, invoice_number::text AS invoice_number, due_at::text AS due_at,
                  project_id, environment, period_start::text AS period_start,
                  period_end::text AS period_end, currency, total_micros::text AS total_micros,
                  unpriced_metrics, issued_at::text AS issued_at
           FROM billing_invoices
           WHERE organization_id = $1 AND project_id = $2 AND environment = $3
           ORDER BY period_start DESC
           LIMIT $4`,
          [scope.organizationId, scope.projectId, scope.environment, limit],
        );
        if (invoices.rows.length === 0) return [];
        const lines = await repositories.transaction.query<{
          invoice_id: string; metric: string; quantity: string;
          unit_price_micros: string; per_units: string; amount_micros: string;
        }>(
          `SELECT invoice_id, metric, quantity::text AS quantity,
                  unit_price_micros::text AS unit_price_micros,
                  per_units::text AS per_units, amount_micros::text AS amount_micros
           FROM billing_invoice_lines
           WHERE organization_id = $1 AND invoice_id = ANY($2::uuid[])
           ORDER BY metric`,
          [scope.organizationId, invoices.rows.map((row) => row.id)],
        );
        const byInvoice = new Map<string, BillingInvoiceLine[]>();
        for (const line of lines.rows) {
          const entry: BillingInvoiceLine = {
            metric: line.metric as BillingInvoiceLine["metric"],
            quantity: line.quantity,
            unitPriceMicros: line.unit_price_micros,
            perUnits: line.per_units,
            amountMicros: line.amount_micros,
            amount: microsToDecimal(BigInt(line.amount_micros)),
          };
          byInvoice.set(line.invoice_id, [...(byInvoice.get(line.invoice_id) ?? []), entry]);
        }
        return invoices.rows.map((row): BillingInvoiceSummary => ({
          id: row.id,
          invoiceNumber: row.invoice_number,
          dueAt: row.due_at,
          projectId: row.project_id,
          environment: row.environment,
          periodStart: row.period_start,
          periodEnd: row.period_end,
          currency: row.currency,
          totalMicros: row.total_micros,
          total: microsToDecimal(BigInt(row.total_micros)),
          unpricedMetrics: [...row.unpriced_metrics],
          issuedAt: row.issued_at,
          lines: byInvoice.get(row.id) ?? [],
        }));
      });
  }
}
