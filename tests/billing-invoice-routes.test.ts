import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createBillingInvoiceHandlers } from "@/app/api/v1/projects/[projectId]/environments/[environment]/usage/invoices/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { tenancyService } from "@/lib/server/tenancy-service";
import type { BillingService } from "@/lib/server/usage/billing";

/**
 * Seit 1.77 stand offen: "Die Invoices-Route spricht in keinem Fall HTTP."
 * Hier spricht sie — durch dieselbe authentifizierte Grenze wie die
 * Usage-Flaeche, mit no-store und mit der Parameterpruefung **vor** dem
 * Dienstzugriff. Der Dienst selbst ist seit 1.77/1.81 gegen echtes
 * PostgreSQL zertifiziert; Gegenstand hier ist die HTTP-Grenze.
 */

async function identity() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `invoices-${nonce}@qkern.test`,
    password: "a sufficiently long invoice route test password",
    rateLimitKey: nonce,
  });
  const membership = await tenancyService.ensureWorkspace(registration.user);
  const projects = await controlPlaneService.listProjects({
    organizationId: membership.organization.id,
    actor: { id: registration.user.id, ref: registration.user.email, type: "user" },
  });
  return { ...registration, membership, project: projects[0] };
}

describe("billing invoice route", () => {
  it("serves the issued invoices with no-store through the authenticated boundary", async () => {
    const principal = await identity();
    const listInvoices = vi.fn().mockResolvedValue([{
      id: randomUUID(), invoiceNumber: "1", dueAt: "2026-08-31T00:00:00.000Z",
      projectId: principal.project.id, environment: "development",
      periodStart: "2026-07-01", periodEnd: "2026-08-01", currency: "CHF",
      totalMicros: "430000", total: "0.430000", unpricedMetrics: [],
      issuedAt: "2026-08-01T00:00:00.000Z",
      lines: [{ metric: "queue_operations", quantity: "1000", unitPriceMicros: "250",
        perUnits: "1", amountMicros: "250000", amount: "0.250000" }],
    }]);
    const service = { listInvoices } as unknown as BillingService;
    const response = await createBillingInvoiceHandlers(service).GET(new NextRequest(
      `https://qkern.test/api/v1/projects/${principal.project.id}/environments/development/usage/invoices?limit=5`,
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } },
    ), { params: Promise.resolve({ projectId: principal.project.id, environment: "development" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json() as { data: Array<{ invoiceNumber: string; total: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ invoiceNumber: "1", total: "0.430000" });
    expect(listInvoices).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: principal.membership.organization.id, role: "reader" }),
      { organizationId: principal.membership.organization.id,
        projectId: principal.project.id, environment: "development" },
      { limit: 5 },
    );
  });

  it("rejects duplicate, unknown or malformed limit parameters before service access", async () => {
    const listInvoices = vi.fn();
    const service = { listInvoices } as unknown as BillingService;
    const handlers = createBillingInvoiceHandlers(service);
    const context = { params: Promise.resolve({ projectId: "project", environment: "development" as const }) };
    for (const query of ["?limit=5&limit=6", "?limit=abc", "?limit=", "?offset=1"]) {
      const response = await handlers.GET(new NextRequest(
        `https://qkern.test/api/v1/projects/project/environments/development/usage/invoices${query}`,
      ), context);
      expect(response.status, query).toBe(400);
    }
    expect(listInvoices).not.toHaveBeenCalled();
  });
});
