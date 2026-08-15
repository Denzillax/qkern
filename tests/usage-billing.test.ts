import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BillingService,
  MemoryBillingRateCardRepository,
} from "@/lib/server/usage/billing";
import type { UsagePrincipal, UsageScope } from "@/lib/server/usage/model";
import type { UsageRepository } from "@/lib/server/usage/repository";
import { UsageError } from "@/lib/server/usage/service";

/**
 * Die Rechenzusagen der Projektion, ohne Datenbank.
 *
 * Was hier steht, gilt Wort fuer Wort auch gegen PostgreSQL — dort belegt
 * `tests/usage-billing-postgres.integration.test.ts` dieselben Zusagen mit
 * echten Zaehlern, echter RLS und der echten Rolle.
 */

const organizationId = randomUUID();
const scope: UsageScope = { organizationId, projectId: randomUUID(), environment: "development" };
const operator: UsagePrincipal = {
  organizationId, actorRef: "system:billing", subject: "billing-operator", role: "operator",
};
const reader: UsagePrincipal = {
  organizationId, actorRef: "reader@qkern.test", subject: randomUUID(), role: "reader",
};

/** Fixe Zaehlerstaende statt eines Zufalls: Die Erwartungen rechnen nach. */
function usageWith(quantities: Partial<Record<string, bigint>>): Pick<UsageRepository, "readWindow"> {
  return {
    readWindow: async () =>
      Object.entries(quantities).map(([metric, quantity]) => ({
        metric: metric as never,
        quantity: quantity!,
        policy: null,
      })),
  };
}

function service(quantities: Partial<Record<string, bigint>>, now = new Date("2026-08-16T12:00:00Z")) {
  return new BillingService({
    rateCards: new MemoryBillingRateCardRepository(),
    usage: usageWith(quantities),
    now: () => now,
  });
}

describe("billing projection", () => {
  it("multiplies counters with the effective rate and floors to the micro", async () => {
    const billing = service({ api_requests: 1_000_000n, storage_egress_bytes: 5_000_000_000n });
    await billing.setRate(operator, {
      metric: "api_requests", unitPriceMicros: 2n, currency: "CHF", effectiveFrom: "2026-01-01",
    });
    // CHF 0.09 je Gigabyte: 90000 Mikro je 1e9 Bytes.
    await billing.setRate(operator, {
      metric: "storage_egress_bytes", unitPriceMicros: 90_000n, perUnits: 1_000_000_000n,
      currency: "CHF", effectiveFrom: "2026-01-01",
    });

    const projection = await billing.readBillingProjection(reader, scope);
    expect(projection.kind).toBe("projection");
    const api = projection.lines.find((line) => line.metric === "api_requests")!;
    expect(api.amountMicros).toBe("2000000");
    expect(api.amount).toBe("2.000000");
    const egress = projection.lines.find((line) => line.metric === "storage_egress_bytes")!;
    expect(egress.amountMicros).toBe("450000");
    expect(egress.amount).toBe("0.450000");
    expect(projection.totalMicros).toBe("2450000");
    expect(projection.total).toBe("2.450000");
    expect(projection.currency).toBe("CHF");
  });

  it("rounds the broken micro down, in favour of the customer", async () => {
    const billing = service({ storage_egress_bytes: 1_999_999_999n });
    await billing.setRate(operator, {
      metric: "storage_egress_bytes", unitPriceMicros: 90_000n, perUnits: 1_000_000_000n,
      currency: "CHF", effectiveFrom: "2026-01-01",
    });
    const projection = await billing.readBillingProjection(reader, scope);
    // 1_999_999_999 × 90_000 / 1e9 = 179_999.99991 → 179_999, nie 180_000.
    expect(projection.lines.find((line) => line.metric === "storage_egress_bytes")?.amountMicros)
      .toBe("179999");
  });

  it("lets the newest effective price win and ignores future prices", async () => {
    const billing = service({ api_requests: 10n });
    await billing.setRate(operator, {
      metric: "api_requests", unitPriceMicros: 1n, currency: "CHF", effectiveFrom: "2026-01-01",
    });
    await billing.setRate(operator, {
      metric: "api_requests", unitPriceMicros: 5n, currency: "CHF", effectiveFrom: "2026-08-01",
    });
    // Ein Preis von morgen ist heute keiner.
    await billing.setRate(operator, {
      metric: "api_requests", unitPriceMicros: 9n, currency: "CHF", effectiveFrom: "2026-10-01",
    });
    const projection = await billing.readBillingProjection(reader, scope);
    expect(projection.lines.find((line) => line.metric === "api_requests")?.unitPriceMicros).toBe("5");
  });

  it("reports unpriced metrics instead of silently skipping them", async () => {
    const billing = service({ api_requests: 10n });
    await billing.setRate(operator, {
      metric: "api_requests", unitPriceMicros: 1n, currency: "CHF", effectiveFrom: "2026-01-01",
    });
    const projection = await billing.readBillingProjection(reader, scope);
    expect(projection.unpricedMetrics).toContain("queue_operations");
    const unpriced = projection.lines.find((line) => line.metric === "queue_operations")!;
    expect(unpriced.priced).toBe(false);
    expect(unpriced.amount).toBeNull();
  });

  it("refuses a second currency and a non-operator writer", async () => {
    const billing = service({});
    await billing.setRate(operator, {
      metric: "api_requests", unitPriceMicros: 1n, currency: "CHF", effectiveFrom: "2026-01-01",
    });
    await expect(billing.setRate(operator, {
      metric: "queue_operations", unitPriceMicros: 1n, currency: "EUR", effectiveFrom: "2026-01-01",
    })).rejects.toMatchObject({ code: "USAGE_POLICY_CONFLICT" });
    await expect(billing.setRate(reader, {
      metric: "queue_operations", unitPriceMicros: 1n, currency: "CHF", effectiveFrom: "2026-01-01",
    })).rejects.toMatchObject({ code: "USAGE_ACCESS_DENIED" });
  });

  it("rejects invalid input before it reaches any repository", async () => {
    const billing = service({});
    for (const input of [
      { metric: "no_such_metric" as never, unitPriceMicros: 1n, currency: "CHF", effectiveFrom: "2026-01-01" },
      { metric: "api_requests" as const, unitPriceMicros: 0n, currency: "CHF", effectiveFrom: "2026-01-01" },
      { metric: "api_requests" as const, unitPriceMicros: 1n, currency: "chf", effectiveFrom: "2026-01-01" },
      { metric: "api_requests" as const, unitPriceMicros: 1n, currency: "CHF", effectiveFrom: "01.01.2026" },
    ]) {
      await expect(billing.setRate(operator, input)).rejects.toBeInstanceOf(UsageError);
    }
  });

  it("denies a foreign organization's reader", async () => {
    const billing = service({});
    await expect(billing.readBillingProjection(
      { ...reader, organizationId: randomUUID() }, scope,
    )).rejects.toMatchObject({ code: "USAGE_ACCESS_DENIED" });
  });
});
