import { describe, expect, it } from "vitest";
import {
  BillingInvoicePeriodError,
  closedPeriodWindow,
  computeInvoice,
} from "@/lib/server/usage/invoice-run";
import { createBillingInvoiceRunFromEnv } from "@/lib/server/usage/invoice-composition";
import { ConfigurationError } from "@/lib/server/db/errors";
import type { UsageMetric } from "@/lib/server/usage/model";

/**
 * Periodenabschluss und Rechenzusagen des Rechnungslaufs, ohne Datenbank.
 *
 * Der Prozessnachweis mit echten Zaehlern, echten Preisen und der echten
 * Worker-Rolle steht in `tests/billing-invoice-postgres.integration.test.ts`.
 */

const NOW = new Date("2026-08-16T12:00:00.000Z");

function rates(entries: Array<[UsageMetric, bigint, bigint]>) {
  return new Map(entries.map(([metric, unitPriceMicros, perUnits]) => [metric, {
    metric, unitPriceMicros, perUnits, currency: "CHF",
  }]));
}

describe("closed period window", () => {
  it("defaults to the last closed month", () => {
    const window = closedPeriodWindow(undefined, NOW);
    expect(window.period).toBe("2026-07");
    expect(window.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("refuses the running month and the future", () => {
    // Eine Rechnung ueber ein offenes Fenster waere die Projektion aus 1.67
    // mit falschem Etikett.
    expect(() => closedPeriodWindow("2026-08", NOW)).toThrow(BillingInvoicePeriodError);
    expect(() => closedPeriodWindow("2027-01", NOW)).toThrow(BillingInvoicePeriodError);
    expect(() => closedPeriodWindow("2026-8", NOW)).toThrow(BillingInvoicePeriodError);
    expect(closedPeriodWindow("2026-07", NOW).period).toBe("2026-07");
  });

  it("is rejected at the configuration boundary of the composition", () => {
    expect(() => createBillingInvoiceRunFromEnv({
      QKERN_BILLING_INVOICES_ENABLED: "true",
      QKERN_BILLING_ORGANIZATION_ID: "5e0f1f9e-8c1a-4b52-9a5e-1b2c3d4e5f60",
      QKERN_BILLING_PERIOD: "2099-01",
    }, { now: () => NOW })).toThrow(ConfigurationError);
  });
});

describe("invoice arithmetic", () => {
  it("prices lines, floors to the micro and names the unpriced", () => {
    const computed = computeInvoice([
      { metric: "queue_operations", quantity: 1_000n },
      { metric: "storage_egress_bytes", quantity: 1_999_999_999n },
      { metric: "api_requests", quantity: 42n },
    ], rates([
      ["queue_operations", 250n, 1n],
      ["storage_egress_bytes", 90_000n, 1_000_000_000n],
    ]))!;

    expect(computed.currency).toBe("CHF");
    expect(computed.lines).toHaveLength(2);
    expect(computed.lines.find((line) => line.metric === "queue_operations")?.amountMicros).toBe(250_000n);
    // 1_999_999_999 × 90_000 / 1e9 → abgerundet, der Rest gehoert dem Kunden.
    expect(computed.lines.find((line) => line.metric === "storage_egress_bytes")?.amountMicros).toBe(179_999n);
    expect(computed.totalMicros).toBe(429_999n);
    expect(computed.unpriced).toEqual(["api_requests"]);
  });

  it("returns null when nothing has a price", () => {
    // Eine Rechnung ueber null waere eine Aussage, die niemand gemeint hat.
    expect(computeInvoice([{ metric: "api_requests", quantity: 5n }], rates([]))).toBeNull();
  });
});
