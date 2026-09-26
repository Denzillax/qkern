import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createComputeCronOccurrenceHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/compute/cron/[cronId]/occurrences/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { ComputeDefinitionError, type ComputeDefinitionService } from
  "@/lib/server/compute/definitions";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { tenancyService } from "@/lib/server/tenancy-service";

/**
 * Die Cron-Log-Route (2.42): Admin-Sitzung, **kein** Query-Parameter, no-store.
 * Die Zusammensetzung des Logs ist gegen echtes PostgreSQL zertifiziert;
 * Gegenstand hier ist die HTTP-Grenze.
 */
async function identity() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `cron-log-${nonce}@qkern.test`,
    password: "a sufficiently long cron log test password",
    rateLimitKey: nonce,
  });
  const membership = await tenancyService.ensureWorkspace(registration.user);
  const projects = await controlPlaneService.listProjects({
    organizationId: membership.organization.id,
    actor: { id: registration.user.id, ref: registration.user.email, type: "user" },
  });
  return { ...registration, membership, project: projects[0] };
}

const cronId = "11111111-1111-4111-8111-111111111111";

const log = {
  cronId, name: "nightly-report", expression: "*/15 * * * *", queue: "report_jobs",
  enabled: true, createdAt: "2026-08-04T06:00:00.000Z",
  window: { from: "2026-08-03T12:00:00.000Z", to: "2026-08-04T13:00:00.000Z", maxOccurrences: 50, queueFound: true },
  counts: { found: 1, missing: 0, notYetDue: 1, expected: 0 },
  occurrences: [
    { occurredAt: "2026-08-04T12:15:00.000Z", status: "not_yet_due", message: null },
    { occurredAt: "2026-08-04T11:45:00.000Z", status: "found", message: {
      state: "done", attempts: 1, enqueuedAt: "2026-08-04T11:45:02.000Z", settledAt: "2026-08-04T11:45:09.000Z",
    } },
  ],
};

describe("compute cron occurrences route", () => {
  it("serves the assembled log with no-store through the admin session", async () => {
    const principal = await identity();
    const listCronOccurrences = vi.fn().mockResolvedValue(log);
    const service = { listCronOccurrences } as unknown as ComputeDefinitionService;
    const response = await createComputeCronOccurrenceHandlers(service).GET(new NextRequest(
      `https://qkern.test/api/v1/projects/${principal.project.id}/environments/development/compute/cron/${cronId}/occurrences`,
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } },
    ), { params: Promise.resolve({ projectId: principal.project.id, environment: "development", cronId }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.data.counts).toEqual({ found: 1, missing: 0, notYetDue: 1, expected: 0 });
    expect(body.data.occurrences[0]).toMatchObject({ status: "not_yet_due" });
    expect(body.data.occurrences[1].message).toMatchObject({ state: "done", attempts: 1 });
    // Weder Nutzlast noch Dedupe-Schluessel gehen ueber die Grenze.
    expect(JSON.stringify(body)).not.toContain("payload");
    expect(JSON.stringify(body)).not.toContain("dedupe");
    expect(listCronOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: principal.membership.organization.id }),
      { organizationId: principal.membership.organization.id, projectId: principal.project.id, environment: "development" },
      cronId,
    );
  });

  it("rejects every query parameter, the anonymous caller and an unknown definition", async () => {
    const principal = await identity();
    const cookie = { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } };
    const base = `https://qkern.test/api/v1/projects/${principal.project.id}/environments/development/compute/cron/${cronId}/occurrences`;
    const context = { params: Promise.resolve({ projectId: principal.project.id, environment: "development", cronId }) };

    // Das Fenster steht im Dienst, nicht im Aufruf: jeder Parameter ist ein 400.
    const listCronOccurrences = vi.fn();
    const handlers = createComputeCronOccurrenceHandlers(
      { listCronOccurrences } as unknown as ComputeDefinitionService);
    for (const query of ["?limit=5", "?from=2026-08-04", "?cursor=x"]) {
      expect((await handlers.GET(new NextRequest(`${base}${query}`, cookie), context)).status, query)
        .toBe(400);
    }
    expect((await handlers.GET(new NextRequest(base), context)).status).toBe(401);
    expect(listCronOccurrences).not.toHaveBeenCalled();

    // Eine unbekannte oder fremde Definition ist ein 404, kein 403: Wer nicht
    // darf, soll nicht erfahren, dass es sie gibt.
    const missing = createComputeCronOccurrenceHandlers({
      listCronOccurrences: vi.fn().mockRejectedValue(new ComputeDefinitionError("COMPUTE_NOT_FOUND")),
    } as unknown as ComputeDefinitionService);
    const notFound = await missing.GET(new NextRequest(base, cookie), context);
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({ error: "Resource not found" });

    // Ein Pfad, den es so nicht geben kann, endet vor dem Dienst in 404 — und
    // die Organisation kommt ohnehin aus der Sitzung, nie aus dem Pfad.
    const foreign = vi.fn();
    for (const params of [
      { projectId: "x", environment: "development", cronId },
      { projectId: principal.project.id, environment: "abnahme", cronId },
      { projectId: principal.project.id, environment: "development", cronId: undefined },
    ]) {
      const response = await createComputeCronOccurrenceHandlers(
        { listCronOccurrences: foreign } as unknown as ComputeDefinitionService,
      ).GET(new NextRequest(base, cookie), { params: Promise.resolve(params) });
      expect(response.status, JSON.stringify(params)).toBe(404);
    }
    expect(foreign).not.toHaveBeenCalled();
  });

  it("exports no write verb at all", async () => {
    const module = await import(
      "@/app/api/v1/projects/[projectId]/environments/[environment]/compute/cron/[cronId]/occurrences/route");
    expect(Object.keys(module).sort()).toEqual(["GET", "createComputeCronOccurrenceHandlers"]);
  });
});
