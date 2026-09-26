import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createComputeSecretOverviewHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/compute/secrets/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import type { ComputeDefinitionService } from "@/lib/server/compute/definitions";
import type { DatabaseWebhookService } from "@/lib/server/compute/database-webhook-definitions";
import {
  FunctionSecretInspectionError,
  type FunctionSecretInspector,
} from "@/lib/server/compute/function-secret-inspector";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { tenancyService } from "@/lib/server/tenancy-service";

/**
 * Die Vault-Uebersicht als Route (2.58): dieselbe Tuer wie 2.38 -- Admin,
 * keine Parameter, no-store, 503 mit Code -- und in der Antwort nur Referenz,
 * Status und Benutzer.
 */
async function identity() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `vault-overview-${nonce}@qkern.test`,
    password: "a sufficiently long vault overview test password",
    rateLimitKey: nonce,
  });
  const membership = await tenancyService.ensureWorkspace(registration.user);
  const projects = await controlPlaneService.listProjects({
    organizationId: membership.organization.id,
    actor: { id: registration.user.id, ref: registration.user.email, type: "user" },
  });
  return { ...registration, membership, project: projects[0] };
}

function request(projectId: string, token?: string, query = "") {
  return new NextRequest(
    `https://qkern.test/api/v1/projects/${projectId}/environments/development/compute/secrets${query}`,
    token ? { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } } : {},
  );
}

function context(projectId: string) {
  return { params: Promise.resolve({ projectId, environment: "development" }) };
}

function definitions() {
  const listFunctions = vi.fn(async () => [
    { id: "f1", name: "billing", secretRefs: ["vault:functions/stripe", "STRIPE_KEY"] },
  ]);
  const listWebhooks = vi.fn(async () => [
    { id: "w1", name: "orders", signingSecretRef: "vault:functions/stripe" },
    { id: "w9", name: "zeilen-intern", signingSecretRef: "vault:webhooks/rows" },
  ]);
  const list = vi.fn(async () => [
    { id: "d1", webhookId: "w9", name: "zeilen", signingSecretRef: "vault:webhooks/rows" },
  ]);
  return {
    listFunctions, listWebhooks, list,
    service: { listFunctions, listWebhooks } as unknown as ComputeDefinitionService,
    databaseWebhooks: { list } as unknown as DatabaseWebhookService,
  };
}

const STATUSES: Record<string, "present" | "missing" | "forbidden"> = {
  "vault:functions/stripe": "present", "vault:webhooks/rows": "missing", STRIPE_KEY: "forbidden",
};

describe("compute secret overview route", () => {
  it("groups every reference of the environment and carries no value-bearing field", async () => {
    const principal = await identity();
    const parts = definitions();
    const hasSecret = vi.fn(async (ref: string) => STATUSES[ref]);
    const response = await createComputeSecretOverviewHandlers(
      parts.service, parts.databaseWebhooks, () => ({ hasSecret }),
    ).GET(request(principal.project.id, principal.token), context(principal.project.id));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(Object.keys(body.data).sort()).toEqual(["checkedAt", "counts", "references"]);
    expect(body.data.references).toEqual([
      { ref: "STRIPE_KEY", status: "forbidden", users: [{ kind: "function", id: "f1", name: "billing" }] },
      {
        ref: "vault:functions/stripe", status: "present", users: [
          { kind: "function", id: "f1", name: "billing" },
          { kind: "webhook", id: "w1", name: "orders" },
        ],
      },
      // Die Definition aus 0032, die zum Datenbank-Webhook gehoert, steht nicht
      // noch einmal als eigener Benutzer da.
      { ref: "vault:webhooks/rows", status: "missing", users: [{ kind: "database-webhook", id: "d1", name: "zeilen" }] },
    ]);
    expect(body.data.counts).toEqual({ total: 3, present: 1, missing: 1, forbidden: 1 });
    expect(Number.isNaN(Date.parse(body.data.checkedAt))).toBe(false);
    for (const row of body.data.references) {
      expect(Object.keys(row).sort()).toEqual(["ref", "status", "users"]);
      for (const user of row.users) expect(Object.keys(user).sort()).toEqual(["id", "kind", "name"]);
    }
    // Je verschiedener Referenz genau eine Frage, nicht je Benutzer.
    expect(hasSecret).toHaveBeenCalledTimes(3);
    expect(parts.listFunctions).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: principal.membership.organization.id }),
      { organizationId: principal.membership.organization.id, projectId: principal.project.id, environment: "development" },
    );
  });

  it("answers an environment without a single reference with an empty overview", async () => {
    const principal = await identity();
    const hasSecret = vi.fn();
    const empty = { listFunctions: async () => [], listWebhooks: async () => [] } as unknown as ComputeDefinitionService;
    const response = await createComputeSecretOverviewHandlers(
      empty, { list: async () => [] } as unknown as DatabaseWebhookService, () => ({ hasSecret }),
    ).GET(request(principal.project.id, principal.token), context(principal.project.id));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.references).toEqual([]);
    expect(body.data.counts).toEqual({ total: 0, present: 0, missing: 0, forbidden: 0 });
    expect(hasSecret).not.toHaveBeenCalled();
  });

  it("answers 503 with a code when no vault is configured, misconfigured or unreachable", async () => {
    const principal = await identity();
    const parts = definitions();
    const none = await createComputeSecretOverviewHandlers(parts.service, parts.databaseWebhooks, () => null)
      .GET(request(principal.project.id, principal.token), context(principal.project.id));
    expect(none.status).toBe(503);
    expect((await none.json()).code).toBe("VAULT_NOT_CONFIGURED");
    // Ohne Vault wird gar nicht erst gelesen; sonst verriete schon ein
    // Antwortzeitunterschied, ob es Definitionen gibt.
    expect(parts.listFunctions).not.toHaveBeenCalled();

    const broken = await createComputeSecretOverviewHandlers(parts.service, parts.databaseWebhooks, () => {
      throw new FunctionSecretInspectionError();
    }).GET(request(principal.project.id, principal.token), context(principal.project.id));
    expect(broken.status).toBe(503);
    expect((await broken.json()).code).toBe("VAULT_MISCONFIGURED");

    const down = await createComputeSecretOverviewHandlers(parts.service, parts.databaseWebhooks, () => ({
      hasSecret: async () => { throw new FunctionSecretInspectionError(); },
    })).GET(request(principal.project.id, principal.token), context(principal.project.id));
    expect(down.status).toBe(503);
    const body = await down.json();
    expect(body.code).toBe("VAULT_UNAVAILABLE");
    // Ein gescheiterter Lauf darf keine Referenz und keinen Pfad nennen.
    expect(JSON.stringify(body)).not.toContain("functions/stripe");
    expect(JSON.stringify(body)).not.toContain("webhooks/rows");
  });

  it("refuses anonymous callers, foreign projects and query parameters before any lookup", async () => {
    const principal = await identity();
    const other = await identity();
    const parts = definitions();
    const hasSecret = vi.fn();
    const handlers = createComputeSecretOverviewHandlers(
      parts.service, parts.databaseWebhooks, () => ({ hasSecret }));

    expect((await handlers.GET(request(principal.project.id), context(principal.project.id))).status).toBe(401);
    const foreign = await handlers.GET(request(other.project.id, principal.token), context(other.project.id));
    expect(foreign.status).toBeGreaterThanOrEqual(400);
    expect((await foreign.json()).data).toBeUndefined();
    expect((await handlers.GET(
      request(principal.project.id, principal.token, "?reveal=1"), context(principal.project.id),
    )).status).toBe(400);
    expect(parts.listFunctions).not.toHaveBeenCalled();
    expect(hasSecret).not.toHaveBeenCalled();
  });

  it("exposes no write verb at all", async () => {
    const module: Record<string, unknown> = await import(
      "@/app/api/v1/projects/[projectId]/environments/[environment]/compute/secrets/route");
    expect(Object.keys(module).sort()).toEqual(["GET", "createComputeSecretOverviewHandlers"]);
  });
});
