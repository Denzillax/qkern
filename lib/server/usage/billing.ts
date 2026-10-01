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

/**
 * Eine Pauschale — das zweite append-only Blatt aus Migration 0080.
 *
 * Das Preisblatt sagt, was eine Einheit einer Metrik kostet. Eine Pauschale
 * sagt, was ein Projekt im Monat kostet, ohne jede Einheit. Deshalb hängt sie
 * an (Projekt, Umgebung, Code) und nicht an einer Metrik, und deshalb liegt
 * sie in eigenen Zeilen: Eine Tabelle für beide Fragen hätte in jeder Zeile
 * eine Hälfte leerer Spalten.
 *
 * `amountMicros` 0 beendet sie. Löschen gibt es nicht, append-only heisst
 * append-only, und eine Pauschale über null schreibt keine Rechnungszeile.
 */
export type BillingCharge = Readonly<{
  projectId: string;
  environment: string;
  code: string;
  label: string;
  amountMicros: bigint;
  currency: string;
  effectiveFrom: string;
  createdBy: string;
}>;

export type BillingChargeInput = Readonly<{
  projectId: string;
  environment: string;
  code: string;
  label: string;
  amountMicros: bigint;
  currency: string;
  effectiveFrom: string;
}>;

export interface BillingChargeRepository {
  insert(principal: UsagePrincipal, charge: BillingCharge & { organizationId: string }): Promise<BillingCharge>;
  /**
   * Je (Projekt, Umgebung, Code) die jüngste Zeile, deren `effectiveFrom`
   * nicht nach `at` liegt — beendete Pauschalen mit Betrag 0 eingeschlossen,
   * damit der Aufrufer sieht, dass es sie gab.
   */
  effectiveCharges(
    principal: UsagePrincipal,
    scope: Pick<UsageScope, "organizationId" | "projectId" | "environment">,
    at: Date,
  ): Promise<BillingCharge[]>;
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

/** Eine Pauschale in der Projektion: ein Betrag, eine Bezeichnung, kein Verbrauch. */
export type BillingProjectionCharge = Readonly<{
  code: string;
  label: string;
  amountMicros: string;
  amount: string;
}>;

export type BillingProjection = Readonly<{
  kind: "projection";
  projectId: string;
  environment: string;
  period: string;
  currency: string | null;
  lines: BillingProjectionLine[];
  /** Die wirksamen Pauschalen dieser Umgebung; beendete stehen nicht darin. */
  charges: BillingProjectionCharge[];
  totalMicros: string;
  total: string;
  unpricedMetrics: UsageMetric[];
}>;

/**
 * Eine Position auf einer Rechnung — seit Migration 0080 mit Bezeichnung.
 *
 * `lineKey` ist der stabile Schlüssel der Position (`metric:<kennung>` oder
 * `charge:<code>`); er trägt die Eindeutigkeit innerhalb einer Rechnung. Bei
 * einer Pauschale ist `metric` null und die Menge 1: Der Betrag bleibt
 * gerechnet, eine Formel für alle Positionen.
 */
export type BillingInvoiceLine = Readonly<{
  lineKey: string;
  label: string;
  kind: "metered" | "flat";
  metric: UsageMetric | null;
  quantity: string;
  unitPriceMicros: string;
  perUnits: string;
  amountMicros: string;
  amount: string;
}>;

export type BillingInvoiceSummary = Readonly<{
  id: string;
  /** Lueckenlos je Organisation, vergeben im Rechnungslauf (Migration 0044). */
  invoiceNumber: string;
  /** Fest 30 Tage nach Ausstellung — per DEFAULT vergeben, von niemandem schreibbar. */
  dueAt: string;
  projectId: string;
  environment: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  totalMicros: string;
  total: string;
  unpricedMetrics: string[];
  issuedAt: string;
  lines: BillingInvoiceLine[];
}>;

export interface BillingInvoiceReader {
  listInvoices(
    principal: UsagePrincipal,
    scope: UsageScope,
    limit: number,
  ): Promise<BillingInvoiceSummary[]>;
}

const CURRENCY = /^[A-Z]{3}$/;
const EFFECTIVE_FROM = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const MAX_PRICE = 1_000_000_000_000n;
/** Dieselbe Form wie der CHECK in Migration 0080. */
const CHARGE_CODE = /^[a-z0-9][a-z0-9-]{0,58}$/;

export class BillingService {
  constructor(private readonly dependencies: {
    rateCards: BillingRateCardRepository;
    usage: Pick<UsageRepository, "readWindow">;
    /** Ohne Leser gibt es keine Rechnungsliste — und keinen stillen Ersatz. */
    invoices?: BillingInvoiceReader;
    /** Ohne Blatt gibt es keine Pauschalen, und die Projektion sagt das. */
    charges?: BillingChargeRepository;
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
    // Datenbank; die Lücke steht in der Release Note offen. Seit 0080 zählen
    // die Pauschalen mit: Sonst könnte eine Rechnung zwei Währungen tragen.
    await this.assertSingleCurrency(principal, input.currency);
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

  /**
   * Setzt eine Pauschale — wie ein Preis: nur ein Operator, nur anfügend.
   *
   * Eine Pauschale ist eine kaufmännische Zusage an ein Projekt, und damit
   * dieselbe Autorität wie ein Preis. Der Browser kommt deshalb auch hier
   * nicht heran: Es gibt keine REST-Fläche, die schreibt.
   *
   * Beendet wird eine Pauschale mit `amountMicros: 0n` und einem späteren
   * `effectiveFrom`. Das ist der einzige Weg, weil es in einem append-only
   * Blatt keinen anderen gibt.
   */
  async setCharge(principal: UsagePrincipal, input: BillingChargeInput): Promise<BillingCharge> {
    if (principal.role !== "operator") throw new UsageError("USAGE_ACCESS_DENIED");
    if (!this.dependencies.charges) throw new UsageError("USAGE_METERING_DISABLED");
    if (!CHARGE_CODE.test(input.code)) throw new UsageError("USAGE_INVALID_INPUT");
    const label = input.label.trim();
    if (label.length < 1 || label.length > 200) throw new UsageError("USAGE_INVALID_INPUT");
    if (input.amountMicros < 0n || input.amountMicros > MAX_PRICE) {
      throw new UsageError("USAGE_INVALID_INPUT");
    }
    if (!CURRENCY.test(input.currency)) throw new UsageError("USAGE_INVALID_INPUT");
    if (!EFFECTIVE_FROM.test(input.effectiveFrom)) throw new UsageError("USAGE_INVALID_INPUT");
    await this.assertProject(principal, {
      organizationId: principal.organizationId,
      projectId: input.projectId,
      environment: input.environment as UsageScope["environment"],
    });
    await this.assertSingleCurrency(principal, input.currency);
    return this.dependencies.charges.insert(principal, {
      organizationId: principal.organizationId,
      projectId: input.projectId,
      environment: input.environment,
      code: input.code,
      label,
      amountMicros: input.amountMicros,
      currency: input.currency,
      effectiveFrom: input.effectiveFrom,
      createdBy: principal.subject,
    });
  }

  /** Eine Währung je Organisation, über Preisblatt und Pauschalen hinweg. */
  private async assertSingleCurrency(principal: UsagePrincipal, currency: string) {
    const used = [
      ...await this.dependencies.rateCards.currencies(principal, principal.organizationId),
      ...this.dependencies.charges
        ? await this.dependencies.charges.currencies(principal, principal.organizationId)
        : [],
    ];
    if (used.some((existing) => existing !== currency)) {
      throw new UsageError("USAGE_POLICY_CONFLICT");
    }
  }

  /**
   * Die ausgestellten Rechnungen — die Leseflaeche, die seit 1.68 offen stand.
   *
   * Der Rechnungslauf schreibt mit der Worker-Rolle; gelesen wird mit der
   * Laufzeitrolle ueber das Leserecht aus Migration 0040. Was hier
   * zurueckkommt, ist das eingefrorene Dokument: append-only, mit Posten,
   * neueste Periode zuerst.
   */
  async listInvoices(
    principal: UsagePrincipal,
    scope: UsageScope,
    input: { limit?: number } = {},
  ): Promise<BillingInvoiceSummary[]> {
    if (!["reader", "operator"].includes(principal.role) ||
        principal.organizationId !== scope.organizationId) {
      throw new UsageError("USAGE_ACCESS_DENIED");
    }
    const limit = input.limit ?? 24;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new UsageError("USAGE_INVALID_INPUT");
    }
    await this.assertProject(principal, scope);
    if (!this.dependencies.invoices) throw new UsageError("USAGE_METERING_DISABLED");
    return this.dependencies.invoices.listInvoices(principal, scope, limit);
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
    const at = new Date(window.end.getTime() - 1);
    const [records, rates, charges] = await Promise.all([
      this.dependencies.usage.readWindow(principal, scope, window.start, window.end),
      // Massgeblich ist der Preis am Fensterende: Wer mitten im Monat den
      // Preis ändert, ändert die Projektion des ganzen Monats — die ehrliche
      // Vereinfachung, solange es keinen Periodenabschluss gibt. Sie steht in
      // der Release Note.
      this.dependencies.rateCards.effectiveRates(principal, scope.organizationId, at),
      // Dieselbe Stichtagsregel für die Pauschalen: Die Projektion soll
      // dasselbe sagen, was der Rechnungslauf später schreibt.
      this.dependencies.charges?.effectiveCharges(principal, scope, at) ?? Promise.resolve([]),
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

    // Eine beendete Pauschale (Betrag 0) steht in keiner Projektion: Sie
    // schreibt auch keine Rechnungszeile, und eine Zeile über null wäre eine
    // Aussage, die niemand gemeint hat.
    const billableCharges = charges.filter((charge) => charge.amountMicros > 0n);
    for (const charge of billableCharges) totalMicros += charge.amountMicros;

    return {
      kind: "projection",
      projectId: scope.projectId,
      environment: scope.environment,
      period: period(window.start),
      // Ohne Preisblatt kann die Währung von einer Pauschale kommen: Ein
      // Projekt mit einer Pauschale und ohne Nutzung hat einen Betrag.
      currency: rates[0]?.currency ?? billableCharges[0]?.currency ?? null,
      lines,
      charges: billableCharges.map((charge) => ({
        code: charge.code,
        label: charge.label,
        amountMicros: charge.amountMicros.toString(),
        amount: decimal(charge.amountMicros),
      })),
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
export function microsToDecimal(micros: bigint): string { return decimal(micros); }

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

/** Dasselbe für Pauschalen: dieselben Zusagen, kein Bestand. */
export class MemoryBillingChargeRepository implements BillingChargeRepository {
  private readonly charges: (BillingCharge & { organizationId: string })[] = [];

  async insert(_principal: UsagePrincipal, charge: BillingCharge & { organizationId: string }) {
    if (this.charges.some((existing) => existing.organizationId === charge.organizationId &&
        existing.projectId === charge.projectId && existing.environment === charge.environment &&
        existing.code === charge.code && existing.effectiveFrom === charge.effectiveFrom)) {
      throw new UsageError("USAGE_POLICY_CONFLICT");
    }
    this.charges.push(charge);
    return charge;
  }

  async effectiveCharges(
    _principal: UsagePrincipal,
    scope: Pick<UsageScope, "organizationId" | "projectId" | "environment">,
    at: Date,
  ) {
    const cutoff = at.toISOString().slice(0, 10);
    const byCode = new Map<string, BillingCharge>();
    for (const charge of [...this.charges].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))) {
      if (charge.organizationId !== scope.organizationId || charge.projectId !== scope.projectId ||
          charge.environment !== scope.environment || charge.effectiveFrom > cutoff) continue;
      byCode.set(charge.code, charge);
    }
    return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  async currencies(_principal: UsagePrincipal, organizationId: string) {
    return [...new Set(this.charges
      .filter((charge) => charge.organizationId === organizationId)
      .map((charge) => charge.currency))];
  }
}
