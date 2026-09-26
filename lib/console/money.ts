/**
 * Geldbetraege der Console, aus einer Quelle.
 *
 * Das Backend rechnet in Mikro-Einheiten der Waehrung (BigInt, als
 * Dezimalstring auf dem Draht). Die Console zeigt daraus zwei Formen:
 *
 * - `formatMoneyMicros`: auf Rappen abgerundet, Richtung null, etwa
 *   "CHF 12.34" fuer 12.349999. Fuer Summen und Rechnungsbetraege. Der
 *   Grund: Rechnungen runden zugunsten des Kunden ab (Rechnungslauf und
 *   Projektion rechnen mit BigInt-Division), und die Anzeige darf nicht mehr
 *   zeigen als der Ledger. Auch ein negativer Betrag wird Richtung null
 *   gekuerzt, sein Betrag waechst also nie.
 * - `formatUnitPriceMicros`: ohne Rundung, mindestens zwei und hoechstens
 *   sechs Nachkommastellen, etwa "CHF 0.00025". Ein Stueckpreis unter einem
 *   Rappen darf nicht als "CHF 0.00" erscheinen.
 *
 * Gerechnet wird nur mit BigInt; eine Gleitkommazahl kommt nie vor. Die
 * Tausendergruppierung liefert Intl.NumberFormat("de-CH").
 */

const MICROS_PER_UNIT = 1_000_000n;
const MICROS_PER_CENT = 10_000n;
const GROUPING = new Intl.NumberFormat("de-CH");

/** Liest Mikro-Einheiten als BigInt; alles andere als eine Ganzzahl ergibt null. */
export function parseMicros(value: string | bigint | null | undefined): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value !== "string" || !/^-?\d{1,30}$/.test(value)) return null;
  return BigInt(value);
}

function compose(currency: string, negative: boolean, whole: bigint, fraction: string): string {
  const sign = negative ? "-" : "";
  return `${currency} ${sign}${GROUPING.format(whole)}.${fraction}`;
}

/** Mikro-Einheiten auf Rappen abgerundet, Richtung null: 12_349_999 → "CHF 12.34". */
export function formatMoneyMicros(micros: string | bigint, currency: string): string {
  const value = parseMicros(micros);
  if (value === null) return `${currency} –`;
  const negative = value < 0n;
  const cents = (negative ? -value : value) / MICROS_PER_CENT;
  const whole = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, "0");
  return compose(currency, negative && cents > 0n, whole, fraction);
}

/** Ein Stueckpreis ohne Rundung: 250 → "CHF 0.00025", 90_000 → "CHF 0.09". */
export function formatUnitPriceMicros(micros: string | bigint, currency: string): string {
  const value = parseMicros(micros);
  if (value === null) return `${currency} –`;
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / MICROS_PER_UNIT;
  const fraction = (absolute % MICROS_PER_UNIT).toString().padStart(6, "0").replace(/0{1,4}$/, "");
  return compose(currency, negative && absolute > 0n, whole, fraction.padEnd(2, "0"));
}
