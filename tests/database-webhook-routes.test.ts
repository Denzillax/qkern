import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDatabaseWebhookHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/compute/database-webhooks/route";
import * as itemRoute from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/compute/database-webhooks/[databaseWebhookId]/route";
import type { DatabaseWebhookService } from "@/lib/server/compute/database-webhook-definitions";
import { ComputeDefinitionError } from "@/lib/server/compute/definitions";
import { computeRouteError } from "@/lib/server/compute/definitions-http";
import { ConnectionUnavailableError } from "@/lib/server/db/errors";
import { RequestAuthorizationError } from "@/lib/server/request-context";

const databaseWebhookId = "44444444-4444-4444-8444-444444444444";

const context = {
  params: Promise.resolve({
    projectId: "prj-database-webhooks", environment: "development", databaseWebhookId,
  }),
};

const body = {
  name: "bestellungen-an-erp",
  table: "bestellungen",
  events: ["insert"],
  url: "https://empfaenger.example.com/hooks/qkern",
  signingSecretRef: "vault:webhooks/bestellungen",
};

function post(payload: unknown, origin = "https://evil.example") {
  return new NextRequest("https://qkern.example.test/api/compute", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("database webhook routes", () => {
  it("rejects creation from an untrusted origin before touching the service", async () => {
    const service = { create: vi.fn() } as unknown as DatabaseWebhookService;
    const response = await createDatabaseWebhookHandlers(service).POST(post(body), context);
    expect(response.status).toBe(403);
    expect(service.create).not.toHaveBeenCalled();
  });

  it("rejects an enable change from an untrusted origin", async () => {
    const service = { setEnabled: vi.fn() } as unknown as DatabaseWebhookService;
    const response = await itemRoute.createDatabaseWebhookItemHandlers(service)
      .PATCH(post({ enabled: false }), context);
    expect(response.status).toBe(403);
    expect(service.setEnabled).not.toHaveBeenCalled();
  });

  it("authenticates before it validates, so an anonymous caller learns nothing", async () => {
    // Dieselbe Reihenfolge wie bei den benachbarten Definitionsrouten: Wer nicht
    // angemeldet ist, soll nicht am Unterschied zwischen 400 und 404 ablesen
    // koennen, welche Grenzen gelten oder welche Ressourcen es gibt.
    const service = { list: vi.fn(), get: vi.fn() } as unknown as DatabaseWebhookService;
    const anonymous = new NextRequest("https://qkern.example.test/api/compute/database-webhooks");
    expect((await createDatabaseWebhookHandlers(service).GET(anonymous, context)).status).toBe(401);
    expect((await itemRoute.createDatabaseWebhookItemHandlers(service).GET(anonymous, context))
      .status).toBe(401);
    expect(service.list).not.toHaveBeenCalled();
    expect(service.get).not.toHaveBeenCalled();
  });

  it("offers no DELETE at all", async () => {
    // Loeschen naehme ueber den Fremdschluessel die wartenden Zustellungen mit.
    // Der Handler existiert nicht; das ist die Zusicherung, nicht ein 405.
    const handlers = itemRoute.createDatabaseWebhookItemHandlers(
      {} as unknown as DatabaseWebhookService);
    expect(Object.keys(handlers)).toEqual(["GET", "PATCH"]);
    expect(Object.keys(itemRoute)).toEqual(
      expect.arrayContaining(["GET", "PATCH", "createDatabaseWebhookItemHandlers"]));
    expect(Object.keys(itemRoute)).not.toContain("DELETE");
  });

  it("answers every outcome with private, no-store and without a value", async () => {
    // Diese Routen teilen sich `computeRouteError` mit den benachbarten
    // Definitionsrouten. Geprueft wird, dass sie das wirklich tun: dieselben
    // Statuscodes, dieselben Kopfzeilen, dieselben nichtssagenden Meldungen.
    const outcomes: Array<[unknown, number, string]> = [
      [new ComputeDefinitionError("COMPUTE_INVALID_INPUT"), 400, "Invalid compute definition"],
      [new RequestAuthorizationError(), 404, "Resource not found"],
      [new ComputeDefinitionError("COMPUTE_NOT_FOUND"), 404, "Resource not found"],
      [new ComputeDefinitionError("COMPUTE_CONFLICT"), 409, "Compute definition conflict"],
      [new ConnectionUnavailableError("pool"), 503, "Compute contracts unavailable"],
    ];
    for (const [error, status, message] of outcomes) {
      const response = computeRouteError(error);
      expect(response.status, message).toBe(status);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ error: message });
    }
  });

  it("names neither the target nor the secret reference in an error", async () => {
    const response = computeRouteError(new ComputeDefinitionError("COMPUTE_INVALID_INPUT", {
      cause: new Error(`${body.url} ${body.signingSecretRef}`),
    }));
    const text = await response.text();
    expect(text).not.toContain("empfaenger.example.com");
    expect(text).not.toContain("vault:");
  });

  it("refuses a body that brings a secret value or an unknown field", async () => {
    // `.strict()` ist die Zusicherung: Ein Koerper mit `signingSecret` kommt
    // gar nicht erst beim Dienst an.
    const service = { create: vi.fn() } as unknown as DatabaseWebhookService;
    const handlers = createDatabaseWebhookHandlers(service);
    const trusted = "https://qkern.example.test";
    for (const payload of [
      { ...body, signingSecret: "s3cr3t" },
      { ...body, schema: "public" },
      { ...body, timeoutMs: 1_000 },
    ]) {
      // Ohne Sitzung endet der Aufruf in 401, nie in einem Dienstaufruf.
      const response = await handlers.POST(post(payload, trusted), context);
      expect([400, 401]).toContain(response.status);
    }
    expect(service.create).not.toHaveBeenCalled();
  });
});
