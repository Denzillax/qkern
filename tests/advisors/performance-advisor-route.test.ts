import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { handlePerformanceAdvisor } from "@/app/api/v1/projects/[projectId]/environments/[environment]/advisors/performance/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { DisabledProjectDataPlane, ProjectDataPlaneError, type ProjectDataPlanePort } from "@/lib/server/data-plane/service";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { tenancyService } from "@/lib/server/tenancy-service";
import { PERFORMANCE_CHECK_REASONS, PERFORMANCE_RULE_IDS } from "@/lib/console/performance-advisor-texts";

/**
 * Die Route des Leistungsberaters (2.40): dieselbe Tuer wie
 * `/advisors/security`, nur lesend, und eine fehlende Statistik macht aus
 * ihren Regeln "nicht geprueft", nie ein 500.
 */
const NOW = new Date("2026-09-26T12:00:00.000Z");

async function identity() {
  const nonce = randomUUID();
  const result = await authRuntime.service.register({
    email: `performance-${nonce}@qkern.test`,
    password: "a sufficiently long performance advisor route test password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(result.user);
  return result;
}

function port(overrides: Partial<ProjectDataPlanePort> = {}): ProjectDataPlanePort {
  return {
    inspectStatistics: vi.fn().mockResolvedValue({
      source: "postgres", schema: "public", truncated: false,
      tables: [
        { table: "orders", seqScan: 400, seqTupRead: 2_000_000, idxScan: 3, liveTuples: 60_000, deadTuples: 40_000, lastAutovacuum: null, lastAnalyze: null },
        { table: "audit", seqScan: 1, seqTupRead: 10, idxScan: 900, liveTuples: 10, deadTuples: 0, lastAutovacuum: "2026-09-25T10:00:00Z", lastAnalyze: "2026-09-25T10:00:00Z" },
      ],
      indexes: [
        { name: "orders_pkey", table: "orders", scans: 0, sizeBytes: 8_000_000, isUnique: true, isPrimary: true },
        { name: "orders_note_idx", table: "orders", scans: 0, sizeBytes: 8_000_000, isUnique: false, isPrimary: false },
      ],
    }),
    inspectSchema: vi.fn(), inspectPolicies: vi.fn(), queryReadOnly: vi.fn(), inspectTriggers: vi.fn(), inspectFunctions: vi.fn(),
    inspectIndexes: vi.fn(), inspectEnumTypes: vi.fn(), inspectExtensions: vi.fn(), inspectRoles: vi.fn(), inspectForeignKeys: vi.fn(),
    inspectPublications: vi.fn(), inspectColumnPrivileges: vi.fn(), inspectActivity: vi.fn(),
    ...overrides,
  } as ProjectDataPlanePort;
}

function keys(list: ReturnType<typeof vi.fn>) {
  return { list, authenticate: vi.fn() } as unknown as ProjectApiKeyService;
}

const params = (environment = "production") => ({ params: Promise.resolve({ projectId: "project", environment }) });
const url = (environment = "production", query = "") =>
  `https://qkern.test/api/v1/projects/project/environments/${environment}/advisors/performance${query}`;

describe("performance advisor route", () => {
  it("returns findings, checks and checkedAt with no-store for a console session", async () => {
    const principal = await identity();
    const dataPlane = port();
    const response = await handlePerformanceAdvisor(new NextRequest(url(), {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), params(), { dataPlane, keys: keys(vi.fn()), now: () => NOW });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json() as { data: { findings: Array<{ id: string }>; checks: Array<{ rule: string; ran: boolean }>; checkedAt: string } };
    expect(Object.keys(body.data).sort()).toEqual(["checkedAt", "checks", "findings"]);
    expect(body.data.checkedAt).toBe(NOW.toISOString());
    expect(body.data.findings.map((item) => item.id)).toEqual([
      "missing_index_suspected:table:orders",
      "bloat_suspected:table:orders",
      "never_analyzed:table:orders",
      "unused_index:index:orders_note_idx",
    ]);
    expect(body.data.checks.map((item) => item.rule)).toEqual([...PERFORMANCE_RULE_IDS]);
    expect(body.data.checks.filter((item) => !item.ran).map((item) => item.rule)).toEqual(["slow_statement"]);
    expect(dataPlane.inspectStatistics).toHaveBeenCalledWith(
      expect.objectContaining({ actorRef: principal.user.email }), { projectId: "project", environment: "production" }, "public");
  });

  it("rejects any query parameter before touching a service", async () => {
    const principal = await identity();
    const dataPlane = port();
    const response = await handlePerformanceAdvisor(new NextRequest(url("production", "?schema=public"), {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), params(), { dataPlane, keys: keys(vi.fn()) });
    expect(response.status).toBe(400);
    expect(dataPlane.inspectStatistics).not.toHaveBeenCalled();
    const badEnvironment = await handlePerformanceAdvisor(new NextRequest(url("preview")), params("preview"), { dataPlane });
    expect(badEnvironment.status).toBe(400);
  });

  it("denies anonymous callers and callers with a foreign session", async () => {
    const dataPlane = port();
    const anonymous = await handlePerformanceAdvisor(new NextRequest(url()), params(), { dataPlane, keys: keys(vi.fn()) });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("cache-control")).toBe("private, no-store");
    const forged = await handlePerformanceAdvisor(new NextRequest(url(), {
      headers: { cookie: `${SESSION_COOKIE_NAME}=not-a-session` },
    }), params(), { dataPlane, keys: keys(vi.fn()) });
    expect(forged.status).toBe(401);
    expect(dataPlane.inspectStatistics).not.toHaveBeenCalled();
  });

  it("turns a disabled and an unreachable data plane into checks that did not run", async () => {
    const principal = await identity();
    const cookie = { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` };
    const disabled = await handlePerformanceAdvisor(new NextRequest(url("development"), { headers: cookie }), params("development"), {
      dataPlane: new DisabledProjectDataPlane(), keys: keys(vi.fn()), now: () => NOW,
    });
    expect(disabled.status).toBe(200);
    const body = await disabled.json() as { data: { findings: unknown[]; checks: Array<{ rule: string; ran: boolean; reason?: string }> } };
    expect(body.data.findings).toEqual([]);
    expect(body.data.checks.every((item) => !item.ran)).toBe(true);
    expect(body.data.checks.find((item) => item.rule === "unused_index")).toEqual({
      rule: "unused_index", ran: false, reason: PERFORMANCE_CHECK_REASONS.databaseDisabled,
    });

    const unavailable = await handlePerformanceAdvisor(new NextRequest(url("development"), { headers: cookie }), params("development"), {
      dataPlane: port({ inspectStatistics: vi.fn().mockRejectedValue(new ProjectDataPlaneError("DATA_PLANE_UNAVAILABLE")) }),
      keys: keys(vi.fn()), now: () => NOW,
    });
    expect(unavailable.status).toBe(200);
    const second = await unavailable.json() as { data: { checks: Array<{ rule: string; ran: boolean; reason?: string }> } };
    expect(second.data.checks.find((item) => item.rule === "bloat_suspected")).toEqual({
      rule: "bloat_suspected", ran: false, reason: PERFORMANCE_CHECK_REASONS.databaseUnavailable,
    });
  });
});
