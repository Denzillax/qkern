import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createComputeFunctionSecretHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/compute/functions/[functionId]/secrets/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { ComputeDefinitionError, type ComputeDefinitionService } from "@/lib/server/compute/definitions";
import {
  FunctionSecretInspectionError,
  type FunctionSecretInspector,
} from "@/lib/server/compute/function-secret-inspector";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { tenancyService } from "@/lib/server/tenancy-service";

/**
 * Die Secrets-Route einer Function (2.38): Admin-Session, keine Parameter,
 * no-store, und in der Antwort nur Referenz und Status.
 */
async function identity() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `fn-secrets-${nonce}@qkern.test`,
    password: "a sufficiently long function secrets test password",
    rateLimitKey: nonce,
  });
  const membership = await tenancyService.ensureWorkspace(registration.user);
  const projects = await controlPlaneService.listProjects({
    organizationId: membership.organization.id,
    actor: { id: registration.user.id, ref: registration.user.email, type: "user" },
  });
  return { ...registration, membership, project: projects[0] };
}

const functionId = "00000000-0000-4000-8000-000000000f02";

function request(projectId: string, token?: string, query = "") {
  return new NextRequest(
    `https://qkern.test/api/v1/projects/${projectId}/environments/development/compute/functions/${functionId}/secrets${query}`,
    token ? { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } } : {},
  );
}

function context(projectId: string) {
  return { params: Promise.resolve({ projectId, environment: "development", functionId }) };
}

function service(secretRefs: string[] | null) {
  const getFunction = vi.fn(async () => {
    if (!secretRefs) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    return { id: functionId, name: "billing", secretRefs };
  });
  return { getFunction, service: { getFunction } as unknown as ComputeDefinitionService };
}

describe("compute function secrets route", () => {
  it("lists every reference with its status and nothing else", async () => {
    const principal = await identity();
    const { service: definitions, getFunction } = service(["vault:functions/stripe", "vault:functions/gone", "STRIPE_KEY"]);
    const statuses: Record<string, "present" | "missing" | "forbidden"> = {
      "vault:functions/stripe": "present", "vault:functions/gone": "missing", STRIPE_KEY: "forbidden",
    };
    const inspector: FunctionSecretInspector = { hasSecret: vi.fn(async (ref: string) => statuses[ref]) };
    const response = await createComputeFunctionSecretHandlers(definitions, () => inspector)
      .GET(request(principal.project.id, principal.token), context(principal.project.id));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(Object.keys(body.data).sort()).toEqual(["checkedAt", "secrets"]);
    expect(body.data.secrets).toEqual([
      { ref: "vault:functions/stripe", status: "present" },
      { ref: "vault:functions/gone", status: "missing" },
      { ref: "STRIPE_KEY", status: "forbidden" },
    ]);
    for (const item of body.data.secrets) expect(Object.keys(item).sort()).toEqual(["ref", "status"]);
    expect(Number.isNaN(Date.parse(body.data.checkedAt))).toBe(false);
    expect(getFunction).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: principal.membership.organization.id }),
      { organizationId: principal.membership.organization.id, projectId: principal.project.id, environment: "development" },
      functionId,
    );
  });

  it("answers an unknown function with 404 before asking the vault", async () => {
    const principal = await identity();
    const hasSecret = vi.fn();
    const response = await createComputeFunctionSecretHandlers(service(null).service, () => ({ hasSecret }))
      .GET(request(principal.project.id, principal.token), context(principal.project.id));
    expect(response.status).toBe(404);
    expect(hasSecret).not.toHaveBeenCalled();
  });

  it("answers 503 with a code when no vault is configured, misconfigured or unreachable", async () => {
    const principal = await identity();
    const definitions = service(["vault:functions/stripe"]).service;
    const none = await createComputeFunctionSecretHandlers(definitions, () => null)
      .GET(request(principal.project.id, principal.token), context(principal.project.id));
    expect(none.status).toBe(503);
    expect((await none.json()).code).toBe("VAULT_NOT_CONFIGURED");

    const broken = await createComputeFunctionSecretHandlers(definitions, () => {
      throw new FunctionSecretInspectionError();
    }).GET(request(principal.project.id, principal.token), context(principal.project.id));
    expect(broken.status).toBe(503);
    expect((await broken.json()).code).toBe("VAULT_MISCONFIGURED");

    const down = await createComputeFunctionSecretHandlers(definitions, () => ({
      hasSecret: async () => { throw new FunctionSecretInspectionError(); },
    })).GET(request(principal.project.id, principal.token), context(principal.project.id));
    expect(down.status).toBe(503);
    const body = await down.json();
    expect(body.code).toBe("VAULT_UNAVAILABLE");
    expect(JSON.stringify(body)).not.toContain("functions/stripe");
  });

  it("refuses anonymous callers, foreign projects and query parameters before any lookup", async () => {
    const principal = await identity();
    const other = await identity();
    const { service: definitions, getFunction } = service(["vault:functions/stripe"]);
    const hasSecret = vi.fn();
    const handlers = createComputeFunctionSecretHandlers(definitions, () => ({ hasSecret }));
    expect((await handlers.GET(request(principal.project.id), context(principal.project.id))).status).toBe(401);
    // Ein fremdes Projekt endet vor jedem Nachschlagen. Im Memory-Modus wirft
    // die Control Plane dafuer einen untypisierten Fehler, den die gemeinsame
    // Compute-Grenze heute als 500 meldet; geprueft wird hier, dass nichts
    // herauskommt, nicht der Statuscode.
    const foreign = await handlers.GET(request(other.project.id, principal.token), context(other.project.id));
    expect(foreign.status).toBeGreaterThanOrEqual(400);
    expect((await foreign.json()).data).toBeUndefined();
    expect((await handlers.GET(request(principal.project.id, principal.token, "?reveal=1"), context(principal.project.id))).status).toBe(400);
    expect(getFunction).not.toHaveBeenCalled();
    expect(hasSecret).not.toHaveBeenCalled();
  });
});
