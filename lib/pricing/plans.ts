/**
 * Die Tarife von QKERN, an einer Stelle (2.135).
 *
 * Dieses Modul ist absichtlich frei von React und von next: Die oeffentliche
 * Preisseite liest es, und die Console soll dieselben Betraege spaeter lesen
 * koennen, ohne eine Komponente zu importieren. Zwei Listen mit Preisen waeren
 * zwei Wahrheiten, und eine davon wuerde veralten.
 *
 * Gerechnet wird in Mikro-Einheiten als BigInt, wie im ganzen Backend und wie
 * in `lib/console/money.ts` beschrieben. Eine Gleitkommazahl kommt hier nicht
 * vor, auch nicht fuer die Anzeige: Formatiert wird ueber
 * `formatMoneyMicros`, damit die Preisseite und die Rechnung derselben Regel
 * folgen und nicht zwei Zahlenformate entstehen.
 *
 * Was hier NICHT steht, und zwar mit Absicht: technische Grenzen. Solange die
 * Tariflimits nicht festgelegt sind, waere jede Zahl fuer Speicher, Anfragen
 * oder Nutzer erfunden. Jeder Tarif beschreibt stattdessen seine Zielgruppe,
 * und die Worte dazu liegen in `lib/i18n/pricing.ts`.
 */

import { formatMoneyMicros } from "@/lib/console/money";

export const PRICING_CURRENCY = "CHF";

const MICROS_PER_UNIT = 1_000_000n;

/** Ganze Franken in Mikro-Einheiten, ohne Zwischenschritt ueber eine Gleitkommazahl. */
function francs(amount: bigint): bigint {
  return amount * MICROS_PER_UNIT;
}

export const PRICING_PLAN_IDS = ["free", "launch", "pro", "scale", "business"] as const;
export type PricingPlanId = (typeof PRICING_PLAN_IDS)[number];

/**
 * Wohin ein Tarif-Knopf fuehrt.
 *
 * Es gibt heute keinen Bestellweg: Billing hat keine Zahlungsanbindung (siehe
 * die offenen Punkte auf der Startseite). Darum kennt dieser Typ nur zwei
 * Faelle, und ein Checkout ist nicht darstellbar. `register` fuehrt in die
 * Registrierung, `contact` fuehrt zu einem Gespraech.
 *
 * `mailto` ist `null`, solange keine Vertriebsadresse feststeht. Eine erfundene
 * Adresse wuerde ins Leere laufen, also zeigt die Seite in diesem Fall einen
 * Hinweis statt eines toten Links. Sobald die Adresse bekannt ist, ist das hier
 * eine Zeile.
 */
export type PricingCta =
  | { kind: "register"; href: "/register" }
  | { kind: "contact"; mailto: string | null };

export type PricingPlan = {
  id: PricingPlanId;
  /** Monatspreis in Mikro-Einheiten von `PRICING_CURRENCY`. */
  monthlyMicros: bigint;
  /** Der Preis ist ein Einstiegspreis ("ab"), nicht der endgueltige Betrag. */
  fromPrice: boolean;
  /** Genau ein Tarif darf hervorgehoben sein, sonst hebt sich keiner hervor. */
  mostPopular: boolean;
  /** Direkt waehlbar, also ueber die Registrierung erreichbar. */
  selectable: boolean;
  cta: PricingCta;
};

/**
 * Die Reihenfolge in diesem Array ist die Reihenfolge auf der Seite. Sie steigt
 * mit dem Preis, damit der Leser nicht springen muss.
 */
export const PRICING_PLANS: readonly PricingPlan[] = [
  { id: "free", monthlyMicros: francs(0n), fromPrice: false, mostPopular: false, selectable: true, cta: { kind: "register", href: "/register" } },
  { id: "launch", monthlyMicros: francs(9n), fromPrice: false, mostPopular: false, selectable: true, cta: { kind: "register", href: "/register" } },
  { id: "pro", monthlyMicros: francs(29n), fromPrice: false, mostPopular: true, selectable: true, cta: { kind: "register", href: "/register" } },
  { id: "scale", monthlyMicros: francs(79n), fromPrice: false, mostPopular: false, selectable: true, cta: { kind: "register", href: "/register" } },
  // Business ist nicht direkt waehlbar: Umfang und Support werden besprochen,
  // nicht angeklickt.
  { id: "business", monthlyMicros: francs(199n), fromPrice: true, mostPopular: false, selectable: false, cta: { kind: "contact", mailto: null } },
];

export function findPricingPlan(id: PricingPlanId): PricingPlan {
  const plan = PRICING_PLANS.find((entry) => entry.id === id);
  if (!plan) throw new Error(`Unbekannter Tarif: ${id}`);
  return plan;
}

/**
 * Der Betrag allein, etwa "CHF 29".
 *
 * Die Rechnung folgt `formatMoneyMicros`, also derselben BigInt-Division wie
 * der Rechnungslauf. Bei ganzen Franken fallen die beiden Nullen nach dem Punkt
 * weg: Auf einer Preisseite steht ein Monatspreis als ganze Zahl, waehrend eine
 * Rechnungszeile die Rappen braucht. Ein Betrag mit Rappen behaelt sie.
 */
export function formatPlanAmount(micros: bigint): string {
  const exact = formatMoneyMicros(micros, PRICING_CURRENCY);
  return exact.endsWith(".00") ? exact.slice(0, -3) : exact;
}

/**
 * Die ganze Preiszeile, etwa "CHF 29 / Monat" oder "ab CHF 199 / Monat".
 *
 * Die Worte kommen von aussen herein, damit dieses Modul keine Sprache kennen
 * muss und trotzdem nur eine Stelle den Preis zusammensetzt.
 */
export function formatPlanPrice(plan: PricingPlan, words: { from: string; perMonth: string }): string {
  const amount = formatPlanAmount(plan.monthlyMicros);
  return `${plan.fromPrice ? `${words.from} ` : ""}${amount} ${words.perMonth}`;
}
