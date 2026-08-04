import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import {
  createGetProjectDatabaseProvisioningHandler,
  createRequestProjectDatabaseProvisioningHandler,
} from "@/app/api/v1/projects/[projectId]/environments/[environment]/provisioning/route";
import { authRuntime } from "@/lib/server/auth/runtime";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { ResourceNotFoundError } from "@/lib/server/db/errors";
import type { ProjectDatabaseProvisioningService } from "@/lib/server/provisioning/service";
import { tenancyService } from "@/lib/server/tenancy-service";

const PROJECT_ID = "9730b448-7fd0-4c4f-9553-33220752bdf6";
const JOB_ID = "940cb242-32d6-41fd-b244-67d4913f7b91";
const status = {
  projectId: PROJECT_ID,
  environment: "production" as const,
  jobId: JOB_ID,
  status: "pending" as const,
  attemptCount: 0,
  maxAttempts: 5,
  retryCycleCount: 0,
  maxRetryCycles: 3,
  createdAt: "2026-07-20T08:00:00.000Z",
  updatedAt: "2026-07-20T08:00:00.000Z",
};

async function ownerSession() {
  const nonce = crypto.randomUUID();
  const registration = await authRuntime.service.register({
    email: `provisioning-${nonce}@qkern.test`,
    password: "a sufficiently long provisioning password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(registration.user);
  return registration.token;
}

const params = (projectId = PROJECT_ID, environment = "production") => ({
  params: Promise.resolve({ projectId, environment }),
});

function request(method: "GET" | "POST", token?: string, body = "{}", origin = "https://qkern.test") {
  return new NextRequest(
    `https://qkern.test/api/v1/projects/${PROJECT_ID}/environments/production/provisioning`,
    {
      method,
      headers: {
        ...(method === "POST" ? { "content-type": "application/json", origin } : {}),
        ...(token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {}),
      },
      ...(method === "POST" ? { body } : {}),
    },
  );
}

describe("project database provisioning route", () => {
  it("returns only the redacted state with private no-store caching", async () => {
    const token = await ownerSession();
    const service: ProjectDatabaseProvisioningService = {
      getHealth: vi.fn(), getStatus: vi.fn(async () => status), request: vi.fn(),
    };
    const response = await createGetProjectDatabaseProvisioningHandler(service)(request("GET", token), params());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toEqual({ data: { provisioning: status } });
    expect(JSON.stringify(body)).not.toMatch(/host|port|vault|databaseInstanceRef|credential|lease|token/i);
  });

  it.each([
    ["requested", 202, false],
    ["retry_requested", 202, false],
    ["already_requested", 200, true],
  ] as const)("maps %s to the idempotent queue contract", async (outcome, expectedStatus, idempotent) => {
    const token = await ownerSession();
    const service: ProjectDatabaseProvisioningService = {
      getHealth: vi.fn(), getStatus: vi.fn(), request: vi.fn(async () => ({ ...status, outcome })),
    };
    const response = await createRequestProjectDatabaseProvisioningHandler(service)(
      request("POST", token),
      params(),
    );
    expect(response.status).toBe(expectedStatus);
    await expect(response.json()).resolves.toMatchObject({ data: { ...status, outcome, idempotent, executed: false } });
  });

  it("authenticates before parsing and requires same-origin strict empty JSON", async () => {
    const service: ProjectDatabaseProvisioningService = {
      getHealth: vi.fn(), getStatus: vi.fn(), request: vi.fn(),
    };
    const anonymous = await createRequestProjectDatabaseProvisioningHandler(service)(
      request("POST", undefined, "{malformed"), params(),
    );
    expect(anonymous.status).toBe(401);
    const token = await ownerSession();
    const crossOrigin = await createRequestProjectDatabaseProvisioningHandler(service)(
      request("POST", token, "{}", "https://attacker.test"), params(),
    );
    expect(crossOrigin.status).toBe(403);
    const extra = await createRequestProjectDatabaseProvisioningHandler(service)(
      request("POST", token, JSON.stringify({ provider: "x" })), params(),
    );
    expect(extra.status).toBe(400);
    expect(service.request).not.toHaveBeenCalled();
  });

  it("uses one non-enumerating 404 for invalid and cross-tenant resources", async () => {
    const token = await ownerSession();
    const service: ProjectDatabaseProvisioningService = {
      getHealth: vi.fn(),
      getStatus: vi.fn(),
      request: vi.fn(async () => { throw new ResourceNotFoundError(); }),
    };
    const invalid = await createRequestProjectDatabaseProvisioningHandler(service)(
      request("POST", token), params("invalid"),
    );
    expect(invalid.status).toBe(404);
    const hidden = await createRequestProjectDatabaseProvisioningHandler(service)(
      request("POST", token), params(),
    );
    expect(hidden.status).toBe(404);
    await expect(hidden.json()).resolves.toEqual({ error: "Resource not found" });
  });
});
