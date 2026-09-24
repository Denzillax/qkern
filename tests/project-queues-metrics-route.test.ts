import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createProjectQueueMetricsHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/queues/metrics/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import type { ProjectQueueService } from "@/lib/server/project-queues/service";
import { tenancyService } from "@/lib/server/tenancy-service";

/**
 * Die Metrics-Route (1.88): Admin-Session, Text statt JSON, no-store, keine
 * Query-Parameter. Der Dienst ist gegen echtes PostgreSQL zertifiziert;
 * Gegenstand hier ist die HTTP-Grenze und die Textform am Draht.
 */
async function identity() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `queue-metrics-${nonce}@qkern.test`,
    password: "a sufficiently long queue metrics test password",
    rateLimitKey: nonce,
  });
  const membership = await tenancyService.ensureWorkspace(registration.user);
  const projects = await controlPlaneService.listProjects({
    organizationId: membership.organization.id,
    actor: { id: registration.user.id, ref: registration.user.email, type: "user" },
  });
  return { ...registration, membership, project: projects[0] };
}

describe("project queue metrics route", () => {
  it("serves the exposition text with no-store through the admin session", async () => {
    const principal = await identity();
    const exportMetrics = vi.fn().mockResolvedValue({
      generatedAt: "2026-09-24T12:00:30.000Z",
      queues: [{ queue: "jobs", available: 2, scheduled: 0, inFlight: 1, completed: 5, deadLettered: 0,
        oldestAvailableAt: "2026-09-24T12:00:00.000Z" }],
    });
    const service = { exportMetrics } as unknown as ProjectQueueService;
    const response = await createProjectQueueMetricsHandlers(service).GET(new NextRequest(
      `https://qkern.test/api/v1/projects/${principal.project.id}/environments/development/queues/metrics`,
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } },
    ), { params: Promise.resolve({ projectId: principal.project.id, environment: "development" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; version=0.0.4; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const text = await response.text();
    expect(text).toContain(`project="${principal.project.id}",environment="development",queue="jobs",state="available"} 2`);
    expect(text).toContain('queue="jobs"} 30');
    expect(exportMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: principal.membership.organization.id, role: "admin" }),
      { organizationId: principal.membership.organization.id, projectId: principal.project.id, environment: "development" },
    );
  });

  it("rejects anonymous callers and query noise before service access", async () => {
    const exportMetrics = vi.fn();
    const handlers = createProjectQueueMetricsHandlers({ exportMetrics } as unknown as ProjectQueueService);
    const anonymous = await handlers.GET(new NextRequest(
      "https://qkern.test/api/v1/projects/project/environments/development/queues/metrics",
    ), { params: Promise.resolve({ projectId: "project", environment: "development" }) });
    expect(anonymous.status).toBe(401);
    const principal = await identity();
    const noisy = await handlers.GET(new NextRequest(
      `https://qkern.test/api/v1/projects/${principal.project.id}/environments/development/queues/metrics?format=json`,
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } },
    ), { params: Promise.resolve({ projectId: principal.project.id, environment: "development" }) });
    expect(noisy.status).toBe(400);
    expect(exportMetrics).not.toHaveBeenCalled();
  });
});
