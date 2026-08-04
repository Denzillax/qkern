import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createUsageHandlers } from "@/app/api/v1/projects/[projectId]/environments/[environment]/usage/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { tenancyService } from "@/lib/server/tenancy-service";
import type { UsageService } from "@/lib/server/usage/service";

async function identity() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `usage-${nonce}@qkern.test`,
    password: "a sufficiently long usage metering test password",
    rateLimitKey: nonce,
  });
  const membership = await tenancyService.ensureWorkspace(registration.user);
  const projects = await controlPlaneService.listProjects({
    organizationId: membership.organization.id,
    actor: { id: registration.user.id, ref: registration.user.email, type: "user" },
  });
  return { ...registration, membership, project: projects[0] };
}

describe("usage metering route", () => {
  it("returns only a tenant-bound read projection with no-store headers", async () => {
    const principal = await identity();
    const readProjection = vi.fn().mockResolvedValue({
      projectId: principal.project.id, environment: "development", period: "2026-08",
      windowStart: "2026-08-01T00:00:00.000Z", windowEnd: "2026-09-01T00:00:00.000Z", metrics: [],
    });
    const service = { readProjection } as unknown as UsageService;
    const response = await createUsageHandlers(service).GET(new NextRequest(
      `https://qkern.test/api/v1/projects/${principal.project.id}/environments/development/usage?period=2026-08`,
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } },
    ), { params: Promise.resolve({ projectId: principal.project.id, environment: "development" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(readProjection).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: principal.membership.organization.id, role: "reader" }),
      { organizationId: principal.membership.organization.id, projectId: principal.project.id, environment: "development" },
      { period: "2026-08" },
    );
  });

  it("rejects duplicate or unknown query parameters before service access", async () => {
    const service = { readProjection: vi.fn() } as unknown as UsageService;
    const response = await createUsageHandlers(service).GET(new NextRequest(
      "https://qkern.test/api/v1/projects/project/environments/development/usage?period=2026-08&period=2026-07",
    ), { params: Promise.resolve({ projectId: "project", environment: "development" }) });
    expect(response.status).toBe(400);
    expect(service.readProjection).not.toHaveBeenCalled();
  });
});
