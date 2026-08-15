import { describe, expect, it, vi } from "vitest";
import { loadConsoleInvoices } from "@/components/console/invoices";

/**
 * Der Ladeweg der Console-Rechnungsansicht — die eine Stelle, die die
 * Invoices-Route wirklich ruft. Die Lektion aus 1.75 (ein Editor, der nie
 * eine Route rief) verlangt genau diese Pruefung: exakte URL, no-store,
 * ehrliche Zustaende fuer 503 und Fehler. Die Mutationsprobe dieses Releases
 * verbiegt die URL — dann faellt genau dieser Vertrag.
 */
describe("console invoices loader", () => {
  const wire = {
    data: [{
      invoiceNumber: "3", periodStart: "2026-05-01", periodEnd: "2026-06-01",
      currency: "CHF", total: "0.025000", dueAt: "2026-07-01T00:00:00.000Z",
      issuedAt: "2026-06-01T00:00:00.000Z",
      lines: [{ metric: "queue_operations", amount: "0.025000" }],
    }],
  };

  it("calls the invoices route with no-store and maps the frozen document", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(wire), { status: 200 }));
    const result = await loadConsoleInvoices("prj-1", "development", fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/projects/prj-1/environments/development/usage/invoices?limit=12",
      { cache: "no-store" },
    );
    expect(result).toEqual({
      state: "ready",
      invoices: [{
        invoiceNumber: "3", periodStart: "2026-05-01", periodEnd: "2026-06-01",
        currency: "CHF", total: "0.025000", dueAt: "2026-07-01T00:00:00.000Z",
        issuedAt: "2026-06-01T00:00:00.000Z",
        lines: [{ metric: "queue_operations", amount: "0.025000" }],
      }],
    });
  });

  it("reports disabled metering and failures as their own states", async () => {
    const disabled = vi.fn().mockResolvedValue(new Response("{}", { status: 503 }));
    expect(await loadConsoleInvoices("prj-1", "development", disabled as unknown as typeof fetch))
      .toEqual({ state: "disabled" });
    const failing = vi.fn().mockResolvedValue(new Response("{}", { status: 500 }));
    expect(await loadConsoleInvoices("prj-1", "development", failing as unknown as typeof fetch))
      .toEqual({ state: "error" });
    const malformed = vi.fn().mockResolvedValue(new Response("{\"data\":\"nope\"}", { status: 200 }));
    expect(await loadConsoleInvoices("prj-1", "development", malformed as unknown as typeof fetch))
      .toEqual({ state: "error" });
    const throwing = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await loadConsoleInvoices("prj-1", "development", throwing as unknown as typeof fetch))
      .toEqual({ state: "error" });
  });
});
