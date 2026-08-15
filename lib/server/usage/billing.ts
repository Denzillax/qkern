import {
  USAGE_METRIC_DEFINITIONS,
  type UsageMetric,
  type UsagePrincipal,
  type UsageScope,
} from "@/lib/server/usage/model";
import { UsageError, parsePeriod, period } from "@/lib/server/usage/service";
import type { UsageRepository } from "@/lib/server/usage/repository";
import type { ControlPlaneService } from "@/lib/server/control-plane/model";

/**
 * Preise und Monatsprojektion — die erste Sprosse der Paritätsleiter.
 *
 * Alle sechs Metriken melden seit `1.33.0`; einen Preis hatte keine. Dieses
 * Modul gibt ihnen einen und rechnet aus den echten Zählern einen projizierten
 * Monatsbetrag.
 *
 * Was es ausdrücklich **nicht** ist: eine Rechnung. Die Projektion trägt
 * `kind: "projection"`, hat weder Nummer noch Fälligkeit und entsteht aus dem
 * lebenden Zähler eines offenen Fensters. Ein Rechnungslauf mit
 * Periodenabschluss ist Sprosse 2 der Leiter und bewusst nicht hier.
 */

/** Ein Preis ist ein Bruch: `unitPriceMicros` je `perUnits` Einheiten. */
export type BillingRateCard = Readonly<{
  metric: UsageMetric;
  unitPriceMicros: bigint;
  perUnits: bigint;
  currency: string;
  effectiveFrom: string;
  createdBy: string;
}>;

export type BillingRateCardInput = Readonly<{
  metric: UsageMetric;
  unitPriceMicros: bigint;
  perUnits?: bigint;
  currency: string;
  effectiveFrom: string;
}>;

export interface BillingRateCardRepository {
  insert(principal: UsagePrincipal, card: BillingRateCard & { organizationId: string }): Promise<BillingRateCard>;
  /** Je Metrik die jüngste Zeile, deren `effectiveFrom` nicht nach `at` liegt. */
  effectiveRates(principal: UsagePrincipal, organizationId: string, at: Date): Promise<BillingRateCard[]>;
  /** Alle bereits verwendeten Währungen der Organisation. */
  currencies(principal: UsagePrincipal, organizationId: string): Promise<string[]>;
}

export type BillingProjectionLine = Readonly<{
  metric: UsageMetric;
  label: string;
  unit: string;
  used: string;
  priced: boolean;
  unitPriceMicros: string | null;
  perUnits: string | null;
  /** Mikro-Einheiten der Währung, abgerundet — nie zugunsten des Anbieters. */
  amountMicros: string | null;
  amount: string | null;
}>;

export type BillingProjection = Readonly<{
  kind: "projection";
  projectId: string;
  environment: string;
  period: string;
  currency: string | null;
  lines: BillingProjectionLine[];
  totalMicros: string;
  total: string;
  unpricedMetrics: UsageMetric[];
}>;

const CURRENCY = /^[A-Z]{3}$/;
const EFFECTIVE_FROM = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const MAX_PRICE = 1_000_000_000_000n;

export class BillingService {
  constructor(private readonly dependencies: {
    rateCards: BillingRateCardRepository;
    usage: Pick<UsageRepository, "readWindow">;
    controlPlane?: Pick<ControlPlaneService, "getProjectEnvironment">;
    now?: () => Date;
  }) {}

  private now() { return this.dependencies.now?.() ?? new Date(); }

  /**
   * Nur Operatoren setzen Preise, und nur anfügend.
   *
   * Der Browser darf hier genauso wenig heran wie an Quota-Policies — eine
   * kaufmännische Autorität ist keine Projektfläche. Die REST-Grenze bietet
   * deshalb ausschliesslich die lesende Projektion an.
   */
  async setRate(principal: UsagePrincipal, input: BillingRateCardInput): Promise<BillingRateCard> {
    if (principal.role !== "operator") throw new UsageError("USAGE_ACCESS_DENIED");
    if (!(input.metric in USAGE_METRIC_DEFINITIONS)) throw new UsageError("USAGE_INVALID_INPUT");
    const perUnits = input.perUnits ?? 1n;
    if (input.unitPriceMicros < 1n || input.unitPriceMicros > MAX_PRICE ||
        perUnits < 1n || perUnits > MAX_PRICE) {
      throw new UsageError("USAGE_INVALID_INPUT");
    }
    if (!CURRENCY.test(input.currency)) throw new UsageError("USAGE_INVALID_INPUT");
    if (!EFFECTIVE_FROM.test(input.effectiveFrom)) throw new UsageError("USAGE_INVALID_INPUT");
    // Eine Währung je Organisation. Erzwungen wird das hier und nicht in der
    // Datenbank; die Lücke steht in der Release Note offen.
    const used = await this.dependencies.rateCards.currencies(principal, principal.organizationId);
    if (used.some((currency) => currency !== input.currency)) {
      throw new UsageError("USAGE_POLICY_CONFLICT");
    }
    return this.dependencies.rateCards.insert(principal, {
      organizationId: principal.organizationId,
      metric: input.metric,
      unitPriceMicros: input.unitPriceMicros,
      perUnits,
      currency: input.currency,
      effectiveFrom: input.effectiveFrom,
      createdBy: principal.subject,
    });
  }

  async readBillingProjection(
    principal: UsagePrincipal,
    scope: UsageScope,
    input: { period?: string } = {},
  ): Promise<BillingProjection> {
    if (!["reader", "operator"].includes(principal.role) ||
        principal.organizationId !== scope.organizationId) {
      throw new UsageError("USAGE_ACCESS_DENIED");
    }
    await this.assertProject(principal, scope);
    const window = parsePeriod(input.period, this.now());
    const [records, rates] = await Promise.all([
      this.dependencies.usage.readWindow(principal, scope, window.start, window.end),
      // Massgeblich ist der Preis am Fensterende: Wer mitten im Monat den
      // Preis ändert, ändert die Projektion des ganzen Monats — die ehrliche
      // Vereinfachung, solange es keinen Periodenabschluss gibt. Sie steht in
      // der Release Note.
      this.dependencies.rateCards.effectiveRates(
        principal, scope.organizationId, new Date(window.end.getTime() - 1)),
    ]);
    const usedByMetric = new Map(records.map((record) => [record.metric, record.quantity]));
    const rateByMetric = new Map(rates.map((rate) => [rate.metric, rate]));

    let totalMicros = 0n;
    const unpriced: UsageMetric[] = [];
    const lines = (Object.keys(USAGE_METRIC_DEFINITIONS) as UsageMetric[]).map((metric) => {
      const used = usedByMetric.get(metric) ?? 0n;
      const rate = rateByMetric.get(metric);
      if (!rate) {
        unpriced.push(metric);
        return {
          metric, ...USAGE_METRIC_DEFINITIONS[metric], used: used.toString(),
          priced: false, unitPriceMicros: null, perUnits: null, amountMicros: null, amount: null,
        };
      }
      // BigInt-Division rundet bei nichtnegativen Werten ab: der angebrochene
      // Mikro-Franken gehört dem Kunden.
      const amountMicros = (used * rate.unitPriceMicros) / rate.perUnits;
      totalMicros += amountMicros;
      return {
        metric, ...USAGE_METRIC_DEFINITIONS[metric], used: used.toString(),
        priced: true,
        unitPriceMicros: rate.unitPriceMicros.toString(),
        perUnits: rate.perUnits.toString(),
        amountMicros: amountMicros.toString(),
        amount: decimal(amountMicros),
      };
    });

    return {
      kind: "projection",
      projectId: scope.projectId,
      environment: scope.environment,
      period: period(window.start),
      currency: rates[0]?.currency ?? null,
      lines,
      totalMicros: totalMicros.toString(),
      total: decimal(totalMicros),
      unpricedMetrics: unpriced,
    };
  }

  private async assertProject(principal: UsagePrincipal, scope: UsageScope) {
    if (!this.dependencies.controlPlane) return;
    try {
      await this.dependencies.controlPlane.getProjectEnvironment({
        organizationId: scope.organizationId,
        actor: { id: principal.subject, ref: principal.actorRef, type: principal.role === "reader" ? "user" : "system" },
      }, scope.projectId, scope.environment);
    } catch { throw new UsageError("USAGE_RESOURCE_NOT_FOUND"); }
  }
}

/** `123456789` Mikro → `"123.456789"`. Dezimalstring, nie ein Float. */
function decimal(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n).toString().padStart(6, "0");
  return `${whole.toString()}.${fraction}`;
}

/** Memory-Adapter für lokale Tests — dieselben Zusagen, kein Bestand. */
export class MemoryBillingRateCardRepository implements BillingRateCardRepository {
  private readonly cards: (BillingRateCard & { organizationId: string })[] = [];

  async insert(principal: UsagePrincipal, card: BillingRateCard & { organizationId: string }) {
    if (this.cards.some((existing) => existing.organizationId === card.organizationId &&
        existing.metric === card.metric && existing.effectiveFrom === card.effectiveFrom)) {
      throw new UsageError("USAGE_POLICY_CONFLICT");
    }
    this.cards.push(card);
    return card;
  }

  async effectiveRates(_principal: UsagePrincipal, organizationId: string, at: Date) {
    const cutoff = at.toISOString().slice(0, 10);
    const byMetric = new Map<UsageMetric, BillingRateCard>();
    for (const card of [...this.cards].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))) {
      if (card.organizationId !== organizationId || card.effectiveFrom > cutoff) continue;
      byMetric.set(card.metric, card);
    }
    return [...byMetric.values()];
  }

  async currencies(_principal: UsagePrincipal, organizationId: string) {
    return [...new Set(this.cards
      .filter((card) => card.organizationId === organizationId)
      .map((card) => card.currency))];
  }
}
