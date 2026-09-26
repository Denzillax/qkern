import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createUsageSeriesHandlers } from "@/app/api/v1/projects/[projectId]/environments/[environment]/usage/series/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { tenancyService } from "@/lib/server/tenancy-service";
import { UsageError, type UsageService } from "@/lib/server/usage/service";

/**
 * Die Route der Zeitreihe (2.45): lesend, an denselben Kontext gebunden wie
 * `usage/billing` und `usage/invoices`, mit zwei erlaubten Parametern und
 * einem 400 fuer alles andere — vor jedem Dienstaufruf.
 */
async function identity() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `series-${nonce}@qkern.test`,
    password: "a sufficiently long usage series test password",
    rateLimitKey: nonce,
  });
  const membership = await tenancyService.ensureWorkspace(registration.user);
  const projects = await controlPlaneService.listProjects({
    organizationId: membership.organization.id,
    actor: { id: registration.user.id, ref: registration.user.email, type: "user" },
  });
  return { ...registration, membership, project: projects[0] };
}

const SERIES = {
  metric: "api_requests", label: "API requests", unit: "operations", bucket: "hour",
  windowStart: "2026-09-24T14:00:00.000Z", windowEnd: "2026-09-26T14:00:00.000Z",
  bucketCount: 48, truncated: false,
  buckets: [{ start: "2026-09-24T14:00:00.000Z", accepted: "5", rejected: "0", events: 1 }],
  totals: { accepted: "5", rejected: "0", events: 1 },
};

function call(service: UsageService, query: string, cookie?: string, projectId = "project-series") {
  return createUsageSeriesHandlers(service).GET(new NextRequest(
    `https://qkern.test/api/v1/projects/${projectId}/environments/development/usage/series${query}`,
    cookie ? { headers: { cookie } } : undefined,
  ), { params: Promise.resolve({ projectId, environment: "development" }) });
}

describe("usage series route", () => {
  it("returns a tenant-bound read series with no-store headers and says which window it used", async () => {
    const principal = await identity();
    const readSeries = vi.fn().mockResolvedValue(SERIES);
    const service = { readSeries } as unknown as UsageService;
    const response = await call(service, "?metric=api_requests&bucket=day",
      `${SESSION_COOKIE_NAME}=${principal.token}`, principal.project.id);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.data).toMatchObject({
      bucket: "hour", bucketCount: 48, truncated: false,
      windowStart: "2026-09-24T14:00:00.000Z", windowEnd: "2026-09-26T14:00:00.000Z",
    });
    expect(readSeries).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: principal.membership.organization.id, role: "reader" }),
      { organizationId: principal.membership.organization.id, projectId: principal.project.id, environment: "development" },
      { metric: "api_requests", bucket: "day" },
    );
  });

  it("defaults the bucket to hour when the caller does not name one", async () => {
    const principal = await identity();
    const readSeries = vi.fn().mockResolvedValue(SERIES);
    await call({ readSeries } as unknown as UsageService, "?metric=api_requests",
      `${SESSION_COOKIE_NAME}=${principal.token}`, principal.project.id);
    expect(readSeries.mock.calls[0][2]).toEqual({ metric: "api_requests", bucket: "hour" });
  });

  it("answers 400 for a missing, repeated, unknown or foreign parameter before touching the service", async () => {
    for (const query of [
      "",
      "?bucket=hour",
      "?metric=api_requests&metric=function_invocations",
      "?metric=api_requests&bucket=hour&bucket=day",
      "?metric=api_requests&bucket=minute",
      "?metric=api_requests&bucket=week",
      "?metric=api_requests&bucket=HOUR",
      "?metric=api_requests&period=2026-09",
      "?metric=api_requests&limit=10",
    ]) {
      const readSeries = vi.fn();
      const response = await call({ readSeries } as unknown as UsageService, query);
      expect(response.status, query).toBe(400);
      expect(await response.json(), query).toEqual({ error: "Invalid usage request" });
      expect(readSeries, query).not.toHaveBeenCalled();
    }
  });

  it("answers 400 for an unknown metric, without naming what it knows", async () => {
    const principal = await identity();
    const readSeries = vi.fn().mockRejectedValue(new UsageError("USAGE_INVALID_INPUT"));
    const response = await call({ readSeries } as unknown as UsageService, "?metric=antwortzeiten",
      `${SESSION_COOKIE_NAME}=${principal.token}`, principal.project.id);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid usage request" });
  });

  it("refuses an unauthenticated caller, a malformed project and a scope the service denies", async () => {
    const unauthenticated = await call({ readSeries: vi.fn() } as unknown as UsageService, "?metric=api_requests");
    expect(unauthenticated.status).toBe(401);

    const principal = await identity();
    const malformed = await call({ readSeries: vi.fn() } as unknown as UsageService, "?metric=api_requests",
      `${SESSION_COOKIE_NAME}=${principal.token}`, "x/y");
    expect(malformed.status).toBe(400);

    // Der Dienst prueft die Organisation ein zweites Mal; seine Absage wird zu
    // einem 404, nicht zu einem 403. Wer nicht hinein darf, soll nicht
    // erfahren, dass es das Projekt gibt.
    for (const code of ["USAGE_ACCESS_DENIED", "USAGE_RESOURCE_NOT_FOUND"] as const) {
      const denied = await call(
        { readSeries: vi.fn().mockRejectedValue(new UsageError(code)) } as unknown as UsageService,
        "?metric=api_requests", `${SESSION_COOKIE_NAME}=${principal.token}`, principal.project.id,
      );
      expect(denied.status, code).toBe(404);
      expect(await denied.json(), code).toEqual({ error: "Resource not found" });
    }
  });

  it("turns metering that is switched off into a clear 503, never into a 500", async () => {
    const principal = await identity();
    const readSeries = vi.fn().mockRejectedValue(new UsageError("USAGE_METERING_DISABLED"));
    const response = await call({ readSeries } as unknown as UsageService, "?metric=api_requests",
      `${SESSION_COOKIE_NAME}=${principal.token}`, principal.project.id);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Usage Metering is disabled" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
