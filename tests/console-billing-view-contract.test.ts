import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { billingProjectionState, periodRange, USAGE_METERING_DISABLED_ERROR } from "@/lib/console/billing";
import { USAGE_METRIC_DEFINITIONS } from "@/lib/server/usage/model";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import { REAL_VIEWS, PLACEHOLDERS } from "@/components/console/navigation";

/**
 * Einstellungen → Abrechnung. Der Vertrag haelt fest: die Ansicht liest nur
 * (keine schreibende Methode), sie kennt keinen Betrag und keine Waehrung
 * aus eigenem Wissen, jede der sechs Metriken hat ein uebersetztes Label,
 * und die Statuscodes der Billing-Route werden ehrlich zugeordnet.
 */
const read = (file: string) => readFile(path.resolve(process.cwd(), file), "utf8");
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("console billing view", () => {
  it("is a real view, no longer a placeholder", () => {
    expect(REAL_VIEWS).toContain("set-billing");
    expect(Object.keys(PLACEHOLDERS)).not.toContain("set-billing");
  });

  it("reads only and carries no amount or currency of its own", async () => {
    for (const file of ["components/console/billing-settings-view.tsx", "components/console/invoices-card.tsx"]) {
      const code = strip(await read(file));
      expect(code, file).not.toMatch(/method:\s*"(?:POST|PATCH|PUT|DELETE)"/);
      expect(code, file).not.toMatch(/\b(?:CHF|EUR|USD|GBP)\b/);
      expect(code, file).not.toMatch(/\d+\.\d{2}\b/);
      expect(code, file).not.toMatch(/toFixed\(|Number\([^)]*[Mm]icros/);
    }
    const view = await read("components/console/billing-settings-view.tsx");
    expect(view).toContain("/usage/billing");
    expect(view).toContain('cache: "no-store"');
    expect(view).toContain("AbortController");
    expect(view).toContain("formatMoneyMicros");
    expect(view).toContain("StableLabel");
  });

  it("formats invoice totals through the shared helper", async () => {
    const card = await read("components/console/invoices-card.tsx");
    expect(card).toContain("formatMoneyMicros(invoice.totalMicros");
    const app = await read("components/console/console-app.tsx");
    expect(app).not.toMatch(/function InvoicesCard/);
    expect(app).toContain('from "@/components/console/invoices-card"');
  });

  it("labels every usage metric and translates each label", async () => {
    const view = await read("components/console/billing-settings-view.tsx");
    for (const metric of Object.keys(USAGE_METRIC_DEFINITIONS)) {
      const match = view.match(new RegExp(`case "${metric}": return t\\(("(?:[^"\\\\]|\\\\.)*")\\)`));
      expect(match, metric).not.toBeNull();
      const key = JSON.parse(match![1]) as string;
      for (const locale of ["en", "fr", "it"] as const) {
        expect(CONSOLE_TRANSLATIONS[locale][key], `${locale}: ${key}`).toMatch(/\S/);
      }
    }
  });

  it("maps the billing route status to a state", () => {
    expect(billingProjectionState(503, { error: USAGE_METERING_DISABLED_ERROR })).toEqual({ state: "disabled" });
    expect(billingProjectionState(503, { error: "Usage unavailable" })).toEqual({ state: "unavailable" });
    expect(billingProjectionState(404, { error: "Resource not found" })).toEqual({ state: "error", message: "Resource not found" });
    expect(billingProjectionState(0, {})).toEqual({ state: "error", message: "" });
    expect(billingProjectionState(200, { data: { kind: "invoice" } }).state).toBe("error");
    expect(billingProjectionState(200, { data: { kind: "projection", period: "2026-09", lines: [], totalMicros: "1.5" } }).state).toBe("error");
    const ready = billingProjectionState(200, { data: {
      kind: "projection", projectId: "p", environment: "development", period: "2026-09", currency: "CHF",
      totalMicros: "250000", total: "0.250000", unpricedMetrics: ["api_requests", 7],
      lines: [
        { metric: "queue_operations", label: "Queue operations", unit: "operations", used: "1000", priced: true,
          unitPriceMicros: "250", perUnits: "1", amountMicros: "250000", amount: "0.250000" },
        { metric: "api_requests", label: "API requests", unit: "operations", used: "12", priced: false,
          unitPriceMicros: null, perUnits: null, amountMicros: null, amount: null },
      ],
    } });
    expect(ready).toEqual({ state: "ready", projection: {
      period: "2026-09", currency: "CHF", totalMicros: "250000", unpricedMetrics: ["api_requests"],
      lines: [
        { metric: "queue_operations", unit: "operations", used: "1000", priced: true, unitPriceMicros: "250", perUnits: "1", amountMicros: "250000" },
        { metric: "api_requests", unit: "operations", used: "12", priced: false, unitPriceMicros: null, perUnits: null, amountMicros: null },
      ],
    } });
  });

  it("turns a period into its first and last UTC day", () => {
    expect(periodRange("2026-09")).toEqual({ first: "2026-09-01", last: "2026-09-30" });
    expect(periodRange("2028-02")).toEqual({ first: "2028-02-01", last: "2028-02-29" });
    expect(periodRange("2026-12")).toEqual({ first: "2026-12-01", last: "2026-12-31" });
    expect(periodRange("2026-13")).toBeNull();
  });
});
