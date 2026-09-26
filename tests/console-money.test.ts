import { describe, expect, it } from "vitest";
import { formatMoneyMicros, formatUnitPriceMicros, parseMicros } from "@/lib/console/money";

/**
 * Das eine Geldformat der Console. Das Backend liefert Mikro-Einheiten als
 * Dezimalstring; die Console rundet Summen auf Rappen ab, Richtung null, wie
 * der Rechnungslauf (die Anzeige zeigt nie mehr als der Ledger), und zeigt
 * Stueckpreise ungerundet. Die Tausendergruppierung kommt aus
 * Intl.NumberFormat("de-CH"); ihr Zeichen haengt an den ICU-Daten, deshalb
 * vergleicht der Test dort mit derselben Quelle.
 */
const group = (value: bigint) => new Intl.NumberFormat("de-CH").format(value);

describe("console money", () => {
  it("formats micros as an amount with the currency in front", () => {
    expect(formatMoneyMicros("12340000", "CHF")).toBe("CHF 12.34");
    expect(formatMoneyMicros(12_340_000n, "EUR")).toBe("EUR 12.34");
    expect(formatMoneyMicros("430000", "CHF")).toBe("CHF 0.43");
    expect(formatMoneyMicros("1234567890000", "CHF")).toBe(`CHF ${group(1_234_567n)}.89`);
  });

  it("rounds down to the cent like the invoice run and keeps zero unsigned", () => {
    expect(formatMoneyMicros("25000", "CHF")).toBe("CHF 0.02");
    expect(formatMoneyMicros("12349999", "CHF")).toBe("CHF 12.34");
    expect(formatMoneyMicros("12999999", "CHF")).toBe("CHF 12.99");
    expect(formatMoneyMicros("12345000", "CHF")).toBe("CHF 12.34");
    expect(formatMoneyMicros("999999999", "CHF")).toBe("CHF 999.99");
    expect(formatMoneyMicros("1000000000", "CHF")).toBe(`CHF ${group(1000n)}.00`);
    expect(formatMoneyMicros("0", "CHF")).toBe("CHF 0.00");
    expect(formatMoneyMicros("9999", "CHF")).toBe("CHF 0.00");
  });

  it("truncates negative amounts toward zero, so the magnitude never grows", () => {
    expect(formatMoneyMicros("-12349999", "CHF")).toBe("CHF -12.34");
    expect(formatMoneyMicros("-12999999", "CHF")).toBe("CHF -12.99");
    expect(formatMoneyMicros("-9999", "CHF")).toBe("CHF 0.00");
  });

  it("shows a unit price without rounding it away", () => {
    expect(formatUnitPriceMicros("250", "CHF")).toBe("CHF 0.00025");
    expect(formatUnitPriceMicros("90000", "CHF")).toBe("CHF 0.09");
    expect(formatUnitPriceMicros("1", "CHF")).toBe("CHF 0.000001");
    expect(formatUnitPriceMicros("1500000", "CHF")).toBe("CHF 1.50");
    expect(formatUnitPriceMicros("123456789", "CHF")).toBe("CHF 123.456789");
    expect(formatUnitPriceMicros("0", "CHF")).toBe("CHF 0.00");
  });

  it("refuses anything that is not an integer of micros", () => {
    expect(parseMicros("12.5")).toBeNull();
    expect(parseMicros("")).toBeNull();
    expect(parseMicros(null)).toBeNull();
    expect(parseMicros("1e6")).toBeNull();
    expect(formatMoneyMicros("0.025000", "CHF")).toBe("CHF –");
    expect(formatUnitPriceMicros("abc", "CHF")).toBe("CHF –");
  });
});
