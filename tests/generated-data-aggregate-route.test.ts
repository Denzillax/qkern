import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createGeneratedAggregateHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/tables/[table]/aggregate/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import type { GeneratedDataApiPort } from "@/lib/server/data-plane/generated-api";
import { tenancyService } from "@/lib/server/tenancy-service";

/**
 * Die Aggregat-Route (1.86): dieselbe Grenze und dieselbe Fehlerabbildung
 * wie die Zeilenliste, ein eigener, enger Query-Dialekt. Der Dienst ist gegen
 * echtes PostgreSQL unter RLS zertifiziert; Gegenstand hier ist der Parser
 * und die Bindung an den Aufrufer.
 */

async function identity() {
  const nonce = randomUUID();
  const result = await authRuntime.service.register({
    email: `aggregate-${nonce}@qkern.test`,
    password: "a sufficiently long aggregate route test password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(result.user);
  return result;
}

const route = {
  params: Promise.resolve({ projectId: "project-1", environment: "development", table: "orders" }),
};
const base = "https://qkern.test/api/v1/projects/project-1/environments/development/tables/orders/aggregate";

describe("generated data aggregate route", () => {
  it("parses the bounded aggregate dialect and binds the call to the session", async () => {
    const principal = await identity();
    const aggregateRows = vi.fn().mockResolvedValue({
      source: "postgres", table: { schema: "public", name: "orders", kind: "table", rowSecurityEnabled: true, primaryKey: ["id"], columns: [] },
      groups: [{ status: "paid", count: "2", sum_amount: "30.5" }], groupCount: 1, truncated: false,
    });
    const service = { aggregateRows } as unknown as GeneratedDataApiPort;
    const response = await createGeneratedAggregateHandlers(async () => service).GET(new NextRequest(
      `${base}?fn=count&fn=sum:amount&group=status&filter=status:neq:void&schema=public`,
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } },
    ), route);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(aggregateRows).toHaveBeenCalledWith(
      expect.objectContaining({ claims: { role: "authenticated", subject: principal.user.id } }),
      { projectId: "project-1", environment: "development", table: "orders" },
      {
        schema: "public", table: "orders",
        aggregates: [{ fn: "count" }, { fn: "sum", column: "amount" }],
        filters: [{ column: "status", operator: "neq", value: "void" }],
        groupBy: "status",
      },
    );
    expect((await response.json()).data.groups).toEqual([{ status: "paid", count: "2", sum_amount: "30.5" }]);
  });

  it("rejects malformed functions, unknown parameters and anonymous callers before service access", async () => {
    const aggregateRows = vi.fn();
    const handlers = createGeneratedAggregateHandlers(async () => ({ aggregateRows } as unknown as GeneratedDataApiPort));
    const principal = await identity();
    const cookie = { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } };
    // Doppelte Schluessel (fn=count&fn=count) weist der Dienst ab, nicht der
    // Parser — das steht im Real-DB-Fall, nicht hier.
    for (const query of ["", "?fn=sum", "?fn=median:amount", "?fn=count&limit=5", "?fn=count&group=1bad",
      "?fn=count&group=a&group=b"]) {
      const response = await handlers.GET(new NextRequest(`${base}${query}`, cookie), route);
      expect(response.status, query || "(leer)").toBe(400);
    }
    expect((await handlers.GET(new NextRequest(`${base}?fn=count`), route)).status).toBe(401);
    expect(aggregateRows).not.toHaveBeenCalled();
  });
});
