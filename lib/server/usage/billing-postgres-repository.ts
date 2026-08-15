import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { UsageMetric, UsagePrincipal } from "@/lib/server/usage/model";
import { UsageError } from "@/lib/server/usage/service";
import {
  type BillingRateCard,
  type BillingRateCardRepository,
} from "@/lib/server/usage/billing";
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
