import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createComputeCronHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/compute/cron/route";
import { createComputeCronItemHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/compute/cron/[cronId]/route";
import { createComputeWebhookHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/compute/webhooks/route";
import { createComputeWebhookItemHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/compute/webhooks/[webhookId]/route";
import { createComputeDeliveryHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/compute/webhooks/[webhookId]/deliveries/route";
import { ComputeDefinitionError, type ComputeDefinitionService } from
  "@/lib/server/compute/definitions";
import { computeRouteError } from "@/lib/server/compute/definitions-http";
import { ConfigurationError } from "@/lib/server/db/errors";
import { RequestAuthenticationError, RequestAuthorizationError } from "@/lib/server/request-context";

const webhookId = "22222222-2222-4222-8222-222222222222";
const cronId = "11111111-1111-4111-8111-111111111111";

const cronContext = {
  params: Promise.resolve({ projectId: "prj-compute", environment: "development", cronId }),
};
const webhookContext = {
  params: Promise.resolve({ projectId: "prj-compute", environment: "development", webhookId }),
};

function post(body: unknown, origin = "https://evil.example") {
  return new NextRequest("https://qkern.example.test/api/compute", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Compute definition routes", () => {
  it("rejects cron creation from an untrusted origin before touching the service", async () => {
    const service = { createCron: vi.fn() } as unknown as ComputeDefinitionService;
    const response = await createComputeCronHandlers(service).POST(
      post({ name: "nightly-report", expression: "0 3 * * *", queue: "report_jobs" }), cronContext,
    );
    expect(response.status).toBe(403);
    expect(service.createCron).not.toHaveBeenCalled();
  });

  it("rejects webhook creation from an untrusted origin before touching the service", async () => {
    const service = { createWebhook: vi.fn() } as unknown as ComputeDefinitionService;
    const response = await createComputeWebhookHandlers(service).POST(
      post({
        name: "order-events", url: "https://receiver.example.com/hooks",
        eventTypes: ["order.created"], signingSecretRef: "vault:webhook/orders",
      }), webhookContext,
    );
    expect(response.status).toBe(403);
    expect(service.createWebhook).not.toHaveBeenCalled();
  });

  it("rejects deletion and enable changes from an untrusted origin", async () => {
    const service = {
      deleteWebhook: vi.fn(), setWebhookEnabled: vi.fn(),
      deleteCron: vi.fn(), setCronEnabled: vi.fn(),
    } as unknown as ComputeDefinitionService;
    const request = new NextRequest("https://qkern.example.test/api/compute", {
      method: "DELETE", headers: { origin: "https://evil.example" },
    });
    expect((await createComputeWebhookItemHandlers(service).DELETE(request, webhookContext)).status)
      .toBe(403);
    expect((await createComputeCronItemHandlers(service).DELETE(request, cronContext)).status)
      .toBe(403);
    expect((await createComputeWebhookItemHandlers(service).PATCH(
      post({ enabled: false }), webhookContext)).status).toBe(403);
    expect(service.deleteWebhook).not.toHaveBeenCalled();
    expect(service.deleteCron).not.toHaveBeenCalled();
    expect(service.setWebhookEnabled).not.toHaveBeenCalled();
  });

  it("authenticates before it validates, so an anonymous caller learns nothing", async () => {
    // Die Reihenfolge ist Absicht: Wer nicht angemeldet ist, soll nicht am
    // Unterschied zwischen 400 und 404 ablesen koennen, welche Grenzen gelten
    // oder welche Ressourcen existieren. Die Grenze selbst prueft
    // `ComputeDefinitionService.listDeliveries`.
    const service = { listDeliveries: vi.fn() } as unknown as ComputeDefinitionService;
    const request = new NextRequest(
      `https://qkern.example.test/api/compute/webhooks/${webhookId}/deliveries?limit=5000`,
    );
    const response = await createComputeDeliveryHandlers(service).GET(request, webhookContext);
    expect(response.status).toBe(401);
    expect(service.listDeliveries).not.toHaveBeenCalled();
  });

  it("hides a malformed project path behind the same 404 as a missing one", async () => {
    const service = { listCron: vi.fn() } as unknown as ComputeDefinitionService;
    const response = await createComputeCronHandlers(service).GET(
      new NextRequest("https://qkern.example.test/api/compute/cron"),
      { params: Promise.resolve({ projectId: "x", environment: "development" }) },
    );
    expect(response.status).toBe(404);
    expect(service.listCron).not.toHaveBeenCalled();
  });
});

describe("computeRouteError", () => {
  it("maps every domain outcome without leaking an internal detail", async () => {
    const cases: Array<[unknown, number, string]> = [
      [new RequestAuthenticationError(), 401, "Authentication required"],
      [new RequestAuthorizationError(), 404, "Resource not found"],
      [new ComputeDefinitionError("COMPUTE_INVALID_INPUT"), 400, "Invalid compute definition"],
      [new ComputeDefinitionError("COMPUTE_NOT_FOUND"), 404, "Resource not found"],
      [new ComputeDefinitionError("COMPUTE_CONFLICT"), 409, "Compute definition conflict"],
      [new ComputeDefinitionError("COMPUTE_PRECONDITION_FAILED"), 409,
        "Disable the webhook before deleting it"],
      [new ConfigurationError("QKERN_COMPUTE_DEFINITIONS_ENABLED is required"), 503,
        "Compute definitions are disabled"],
    ];
    for (const [error, status, message] of cases) {
      const response = computeRouteError(error);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
    }
  });

  it("never forwards a database message to the caller", async () => {
    const response = computeRouteError(
      new Error('duplicate key value violates unique constraint "project_webhooks_name_key"'),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Compute definitions unavailable" });
  });

  it("keeps every answer out of shared caches", () => {
    const response = computeRouteError(new ComputeDefinitionError("COMPUTE_NOT_FOUND"));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
