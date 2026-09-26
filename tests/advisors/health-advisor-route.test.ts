import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { handleHealthAdvisor, type HealthAdvisorDependencies } from "@/app/api/v1/projects/[projectId]/environments/[environment]/advisors/health/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { ProjectDataPlaneError, type ProjectDataPlanePort } from "@/lib/server/data-plane/service";
import { GeneratedDataApiError, type GeneratedDataApiPort } from "@/lib/server/data-plane/generated-api";
import { ProjectStorageError, type ProjectStorageService } from "@/lib/server/project-storage/service";
import { ProjectQueueError, type ProjectQueueService } from "@/lib/server/project-queues/service";
import type { ComputeDefinitionService } from "@/lib/server/compute/definitions";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { tenancyService } from "@/lib/server/tenancy-service";
import { HEALTH_DETAILS, HEALTH_SUBSYSTEM_IDS } from "@/lib/console/health-advisor-texts";

/**
 * Die Route der Projekt-Gesundheit (2.44): dieselbe Tuer wie die beiden
 * Berater daneben, nur lesend, und ein gescheiterter Dienst macht aus seinem
 * Teil einen Zustand, nie ein 500 und nie ein 403 fuer die ganze Seite.
 */
const NOW = new Date("2026-09-26T12:00:00.000Z");

type Body = {
  data: {
    overall: string;
    counts: Record<string, number>;
    subsystems: Array<{ id: string; state: string; detail: string; evidence: Array<{ measure: string; label: string; count: number | null }> }>;
    checkedAt: string;
  };
};

async function identity() {
  const nonce = randomUUID();
  const result = await authRuntime.service.register({
    email: `health-${nonce}@qkern.test`,
    password: "a sufficiently long health advisor route test password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(result.user);
  return result;
}

function dataPlane(overrides: Partial<ProjectDataPlanePort> = {}): ProjectDataPlanePort {
  return {
    inspectSchema: vi.fn().mockResolvedValue({
      source: "postgres", schema: "public", truncated: false,
      tables: [{ name: "orders" }, { name: "invoices" }, { name: "notes" }],
    }),
    inspectStatistics: vi.fn(), inspectActivity: vi.fn(), inspectPolicies: vi.fn(), queryReadOnly: vi.fn(), inspectTriggers: vi.fn(),
    inspectFunctions: vi.fn(), inspectIndexes: vi.fn(), inspectEnumTypes: vi.fn(), inspectExtensions: vi.fn(),
    inspectRoles: vi.fn(), inspectForeignKeys: vi.fn(), inspectPublications: vi.fn(), inspectColumnPrivileges: vi.fn(),
    ...overrides,
  } as ProjectDataPlanePort;
}

/** Ein Dokument, wie es die Route liest: zwei Tabellen mit einer Zeilenroute. */
const OPEN_API = {
  paths: {
    "/v1/projects/p/environments/development/tables/orders/rows": {},
    "/v1/projects/p/environments/development/tables/invoices/rows": {},
    "/v1/projects/p/environments/development/schema": {},
  },
};

function dependencies(overrides: Partial<HealthAdvisorDependencies> = {}): HealthAdvisorDependencies {
  return {
    dataPlane: dataPlane(),
    generated: async () => ({ generateOpenApi: vi.fn().mockResolvedValue(OPEN_API) } as unknown as GeneratedDataApiPort),
    keys: { list: vi.fn(), authenticate: vi.fn() } as unknown as ProjectApiKeyService,
    projectAuth: {
      listOidcProviders: () => [{ id: "corp", issuer: "https://issuer.test" }],
      jwks: () => ({ keys: [{ kid: "one" }, { kid: "two" }] }),
    } as unknown as ProjectAuthService,
    storage: () => ({ listBuckets: vi.fn().mockResolvedValue([{ name: "media" }]) } as unknown as ProjectStorageService),
    compute: () => ({
      listFunctions: vi.fn().mockResolvedValue([{ name: "resize" }]),
      listCron: vi.fn().mockResolvedValue([
        { expression: "0 * * * *", enabled: true, createdAt: "2026-09-26T09:00:00.000Z", lastDispatchedAt: "2026-09-26T11:00:00.000Z" },
      ]),
    } as unknown as ComputeDefinitionService),
    queues: () => ({ listQueues: vi.fn().mockResolvedValue([{ name: "jobs" }]) } as unknown as ProjectQueueService),
    vault: () => ({ hasSecret: vi.fn() }),
    env: { QKERN_FUNCTIONS_ENABLED: "true", NEXT_PUBLIC_QKERN_REALTIME_URL: "ws://localhost:8788" },
    now: () => NOW,
    ...overrides,
  };
}

const params = (environment = "production") => ({ params: Promise.resolve({ projectId: "project", environment }) });
const url = (environment = "production", query = "") =>
  `https://qkern.test/api/v1/projects/project/environments/${environment}/advisors/health${query}`;

function call(token: string | null, overrides: Partial<HealthAdvisorDependencies> = {}, environment = "production") {
  const headers = token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : undefined;
  return handleHealthAdvisor(new NextRequest(url(environment), headers ? { headers } : undefined),
    params(environment), dependencies(overrides));
}

describe("health advisor route", () => {
  it("returns the verdict, the counts, one report per subsystem and checkedAt with no-store", async () => {
    const principal = await identity();
    const response = await call(principal.token);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json() as Body;
    expect(Object.keys(body.data).sort()).toEqual(["checkedAt", "counts", "overall", "subsystems"]);
    expect(body.data.checkedAt).toBe(NOW.toISOString());
    expect(body.data.subsystems.map((item) => item.id)).toEqual([...HEALTH_SUBSYSTEM_IDS]);
    expect(body.data.overall).toBe("ok");
    expect(body.data.counts.ok).toBe(8);
    const database = body.data.subsystems[0];
    expect(database.evidence).toEqual([{ measure: "tables", label: "Tabellen im Schema public", count: 3 }]);
    // Der Beleg der Data API zaehlt nur die Zeilenrouten, nicht jeden Pfad.
    expect(body.data.subsystems.find((item) => item.id === "data_api")!.evidence[0].count).toBe(2);
    expect(body.data.subsystems.find((item) => item.id === "auth")!.evidence.map((item) => item.count)).toEqual([1, 2]);
  });

  it("rejects any query parameter and an unknown environment before touching a service", async () => {
    const principal = await identity();
    const port = dataPlane();
    const query = await handleHealthAdvisor(new NextRequest(url("production", "?schema=public"), {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), params(), dependencies({ dataPlane: port }));
    expect(query.status).toBe(400);
    expect(port.inspectSchema).not.toHaveBeenCalled();
    const badEnvironment = await handleHealthAdvisor(new NextRequest(url("preview")), params("preview"), dependencies());
    expect(badEnvironment.status).toBe(400);
  });

  it("denies anonymous callers and callers with a forged session", async () => {
    const port = dataPlane();
    const anonymous = await handleHealthAdvisor(new NextRequest(url()), params(), dependencies({ dataPlane: port }));
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("cache-control")).toBe("private, no-store");
    const forged = await handleHealthAdvisor(new NextRequest(url(), {
      headers: { cookie: `${SESSION_COOKIE_NAME}=not-a-session` },
    }), params(), dependencies({ dataPlane: port }));
    expect(forged.status).toBe(401);
    expect(port.inspectSchema).not.toHaveBeenCalled();
  });

  it("keeps the page at 200 when one probe fails and leaves every other report intact", async () => {
    const principal = await identity();
    const response = await call(principal.token, {
      dataPlane: dataPlane({ inspectSchema: vi.fn().mockRejectedValue(new ProjectDataPlaneError("DATA_PLANE_UNAVAILABLE")) }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as Body;
    const database = body.data.subsystems.find((item) => item.id === "database")!;
    expect(database.state).toBe("degraded");
    expect(database.detail).toBe(HEALTH_DETAILS.unavailable);
    expect(database.evidence).toEqual([{ measure: "errorUnavailable", label: "Fehlerklasse: keine oder keine gültige Antwort", count: null }]);
    expect(body.data.overall).toBe("degraded");
    expect(body.data.counts.ok).toBe(7);
    expect(body.data.subsystems.filter((item) => item.state === "ok")).toHaveLength(7);
  });

  it("turns a disabled, an unready and an unreachable service into its own state, never into an error", async () => {
    const principal = await identity();
    const response = await call(principal.token, {
      dataPlane: dataPlane({ inspectSchema: vi.fn().mockRejectedValue(new ProjectDataPlaneError("DATA_PLANE_DISABLED")) }),
      generated: async () => ({
        generateOpenApi: vi.fn().mockRejectedValue(new GeneratedDataApiError("GENERATED_DATA_API_NOT_READY")),
      } as unknown as GeneratedDataApiPort),
      storage: () => ({
        listBuckets: vi.fn().mockRejectedValue(new ProjectStorageError("PROJECT_STORAGE_DISABLED")),
      } as unknown as ProjectStorageService),
      queues: () => ({
        listQueues: vi.fn().mockRejectedValue(new ProjectQueueError("QUEUE_UNAVAILABLE")),
      } as unknown as ProjectQueueService),
      env: {},
      vault: () => null,
    });
    expect(response.status).toBe(200);
    const body = await response.json() as Body;
    const state = (id: string) => body.data.subsystems.find((item) => item.id === id)!.state;
    expect(state("database")).toBe("off");
    expect(state("data_api")).toBe("unconfigured");
    expect(state("storage")).toBe("off");
    expect(state("queues_cron")).toBe("degraded");
    // Ohne Umgebungsvariablen ist die Sandbox nicht frei und keine Realtime-Adresse hinterlegt.
    expect(state("compute")).toBe("unconfigured");
    expect(state("realtime")).toBe("unconfigured");
    expect(state("vault")).toBe("unconfigured");
    expect(body.data.overall).toBe("degraded");
  });

  it("reports unknown with the reason for a probe that needs a console session, instead of failing the page", async () => {
    const response = await handleHealthAdvisor(new NextRequest(url("development"), {
      headers: { "x-qkern-key": "qk_health_probe" },
    }), params("development"), dependencies({
      keys: {
        list: vi.fn(),
        authenticate: vi.fn().mockResolvedValue({
          id: "key-health", organizationId: "org-health", projectId: "project",
          environment: "development", kind: "service",
        }),
      } as unknown as ProjectApiKeyService,
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as Body;
    const blocked = body.data.subsystems.filter((item) => item.state === "unknown");
    expect(blocked.map((item) => item.id)).toEqual(["auth", "storage", "compute", "queues_cron"]);
    for (const item of blocked) {
      expect(item.detail).toBe(HEALTH_DETAILS.consoleOnly);
      expect(item.evidence).toEqual([{ measure: "errorConsoleOnly", label: "Fehlerklasse: ohne Console-Sitzung nicht prüfbar", count: null }]);
    }
    expect(body.data.subsystems.find((item) => item.id === "database")!.state).toBe("ok");
    expect(body.data.overall).toBe("unknown");
  });

  it("carries nothing but a fixed text and a number in every report", async () => {
    const principal = await identity();
    const response = await call(principal.token, {
      storage: () => ({
        listBuckets: vi.fn().mockRejectedValue(new Error("postgres://secret:hunter2@db.internal:5432/app")),
      } as unknown as ProjectStorageService),
    });
    const raw = await response.text();
    expect(raw).not.toContain("hunter2");
    expect(raw).not.toContain("postgres://");
    expect(raw).not.toContain("db.internal");
    expect(raw).not.toContain("issuer.test");
    expect(raw).not.toContain("qk_");
  });
});
