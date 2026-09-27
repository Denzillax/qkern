import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { handleProjectExplainQuery } from "@/app/api/v1/projects/[projectId]/environments/[environment]/query/explain/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { ProjectDataPlaneError, type ProjectDataPlanePort } from "@/lib/server/data-plane/service";
import { tenancyService } from "@/lib/server/tenancy-service";

/**
 * Die Route hinter Berichte -> Abfrage-Einblicke (2.69).
 *
 * Sie hat genau eine Aufgabe: dieselbe Tuer wie die Query-Route oeffnen und
 * das Statement an `explainReadQuery` reichen. Geprueft wird darum, dass sie
 * niemanden vorbeilaesst, dass sie nichts anderes weitergibt als das
 * Statement, und dass sie eine Abfrage, die sich nicht planen laesst, als
 * Fehler des Aufrufers beantwortet statt als Ausfall der Datenbank.
 */
async function identity() {
  const nonce = randomUUID();
  const result = await authRuntime.service.register({
    email: `query-insights-${nonce}@qkern.test`,
    password: "a sufficiently long query insights test password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(result.user);
  return result;
}

function port(explainReadQuery: ProjectDataPlanePort["explainReadQuery"]): ProjectDataPlanePort {
  return {
    inspectRuntime: vi.fn(),
    inspectSchema: vi.fn(), inspectStatements: vi.fn(), inspectSettings: vi.fn(), queryReadOnly: vi.fn(),
    inspectStatistics: vi.fn(), inspectActivity: vi.fn(), inspectForeignKeys: vi.fn(), inspectTriggers: vi.fn(),
    inspectFunctions: vi.fn(), inspectIndexes: vi.fn(), inspectPolicies: vi.fn(), inspectEnumTypes: vi.fn(),
    inspectExtensions: vi.fn(), inspectRoles: vi.fn(), inspectPublications: vi.fn(),
    inspectColumnPrivileges: vi.fn(), explainReadQuery,
  } as ProjectDataPlanePort;
}

const PLAN = {
  source: "postgres" as const, analyzed: false as const,
  plan: {
    nodes: [{
      id: 0, depth: 0, operation: "Seq Scan", relation: "products", indexName: null,
      startupCost: 0, totalCost: 12.5, ownCost: 12.5, costShare: 1, planRows: 3, planWidth: 40,
    }],
    totalCost: 12.5, planRows: 3, planningTimeMs: 0.2,
    indexes: [], sequentialScans: ["products"], truncated: false,
  },
};

const ROUTE = { params: Promise.resolve({ projectId: "project", environment: "development" }) };
const URL_ = "https://qkern.test/api/v1/projects/project/environments/development/query/explain";

function request(token: string, body: unknown, origin = "https://qkern.test") {
  return new NextRequest(URL_, {
    method: "POST",
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}`, "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe("project query plan route", () => {
  it("refuses a foreign origin before the data plane is touched", async () => {
    const principal = await identity();
    const explain = vi.fn();
    const response = await handleProjectExplainQuery(
      request(principal.token, { statement: "SELECT id FROM products" }, "https://attacker.test"),
      ROUTE, port(explain));
    expect(response.status).toBe(403);
    expect(explain).not.toHaveBeenCalled();
  });

  it("refuses without a session", async () => {
    const explain = vi.fn();
    const response = await handleProjectExplainQuery(new NextRequest(URL_, {
      method: "POST", headers: { "content-type": "application/json", origin: "https://qkern.test" },
      body: JSON.stringify({ statement: "SELECT 1" }),
    }), ROUTE, port(explain));
    expect(response.status).toBe(401);
    expect(explain).not.toHaveBeenCalled();
  });

  it("forwards the statement, the tenant and nothing else", async () => {
    const principal = await identity();
    const explain = vi.fn().mockResolvedValue(PLAN);
    const response = await handleProjectExplainQuery(
      request(principal.token, { statement: "SELECT id FROM products" }), ROUTE, port(explain));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const payload = await response.json();
    // Die Zusage steht in der Antwort, nicht nur im Kommentar.
    expect(payload.data.analyzed).toBe(false);
    expect(payload.data.plan.sequentialScans).toEqual(["products"]);
    expect(explain).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: expect.any(String), actorRef: principal.user.email }),
      { projectId: "project", environment: "development" },
      "SELECT id FROM products",
    );
    // Genau drei Argumente: kein Zeilenlimit, kein Schalter fuer ANALYZE.
    expect(explain.mock.calls[0]).toHaveLength(3);
  });

  it("takes no field beyond the statement, and no statement beyond the limit", async () => {
    const principal = await identity();
    const explain = vi.fn().mockResolvedValue(PLAN);
    const service = port(explain);
    for (const body of [
      { statement: "SELECT 1", analyze: true },
      { statement: "SELECT 1", limit: 20 },
      { statement: "" },
      { statement: "SELECT 1".padEnd(4_001, " ") },
      {},
    ]) {
      const response = await handleProjectExplainQuery(request(principal.token, body), ROUTE, service);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(explain).not.toHaveBeenCalled();
  });

  it("answers a statement that cannot be planned with 400, not with an outage", async () => {
    // Sonst saehe die Ansicht "Datenbank nicht erreichbar", obwohl die
    // Datenbank geantwortet hat. Das waere schlicht falsch.
    const principal = await identity();
    for (const [code, status] of [
      ["QUERY_PLAN_REJECTED", 400], ["READ_ONLY_QUERY_REQUIRED", 400],
      ["DATA_PLANE_NOT_READY", 409], ["DATA_PLANE_DISABLED", 503],
      ["DATA_PLANE_UNAVAILABLE", 503], ["DATA_PLANE_BOUNDARY_REJECTED", 503],
    ] as const) {
      const explain = vi.fn().mockRejectedValue(new ProjectDataPlaneError(code));
      const response = await handleProjectExplainQuery(
        request(principal.token, { statement: "SELECT id FROM products" }), ROUTE, port(explain));
      expect(response.status, code).toBe(status);
      expect((await response.json()).code, code).toBe(code);
    }
  });

  it("never lets the reason of a rejection carry a catalog detail", async () => {
    const principal = await identity();
    const explain = vi.fn().mockRejectedValue(
      new Error("relation \"geheime_tabelle\" does not exist"));
    const response = await handleProjectExplainQuery(
      request(principal.token, { statement: "SELECT id FROM geheime_tabelle" }), ROUTE, port(explain));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("geheime_tabelle");
  });
});
