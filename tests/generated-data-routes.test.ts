import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createGeneratedTableHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/tables/[table]/rows/route";
import { createGeneratedOpenApiHandler } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/generated-openapi/route";
import { createProjectGraphqlHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/graphql/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import type { GeneratedDataApiPort } from "@/lib/server/data-plane/generated-api";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { tenancyService } from "@/lib/server/tenancy-service";

async function identity() {
  const nonce = randomUUID();
  const result = await authRuntime.service.register({
    email: `generated-${nonce}@qkern.test`,
    password: "a sufficiently long generated data test password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(result.user);
  return result;
}

function dataApi() {
  return {
    listRows: vi.fn().mockResolvedValue({
      source: "postgres", table: { schema: "public", name: "orders", rowSecurityEnabled: true, primaryKey: ["id"], columns: [] },
      rows: [{ id: "1" }], rowCount: 1, hasMore: false, nextCursor: null, maxRows: 20,
    }),
    insertRows: vi.fn().mockResolvedValue({
      source: "postgres", table: { schema: "public", name: "orders", rowSecurityEnabled: true, primaryKey: ["id"], columns: [] },
      rows: [{ id: "1" }], rowCount: 1,
    }),
    updateRow: vi.fn(), deleteRow: vi.fn(),
    // Die GraphQL-Flaeche (2.97): Der Katalog gibt eine Tabelle mit allen
    // Rechten her, und ein Stapel schreibt ueber `mutateRows`.
    listReadableTables: vi.fn().mockResolvedValue([{
      schema: "public", name: "orders", kind: "table", rowSecurityEnabled: true, primaryKey: ["id"],
      canInsert: true, canUpdate: true, canDelete: true,
      columns: [
        { name: "id", dataType: "uuid", nullable: false, identity: false, generated: false, sensitive: false,
          primaryKeyPosition: 1, selectable: true, insertable: true, updateable: true },
        { name: "status", dataType: "text", nullable: false, identity: false, generated: false, sensitive: false,
          primaryKeyPosition: null, selectable: true, insertable: true, updateable: true },
      ],
    }]),
    mutateRows: vi.fn().mockResolvedValue({ source: "postgres", results: [{
      source: "postgres", table: { schema: "public", name: "orders", rowSecurityEnabled: true, primaryKey: ["id"], columns: [] },
      rows: [{ id: "1", status: "paid" }], rowCount: 1,
    }] }),
    generateOpenApi: vi.fn().mockResolvedValue({ openapi: "3.1.0", paths: {} }),
  } as unknown as GeneratedDataApiPort;
}

const route = {
  params: Promise.resolve({ projectId: "project-1", environment: "development", table: "orders" }),
};

describe("generated data routes", () => {
  it("binds session reads to the tenant and parses only the bounded query dialect", async () => {
    const principal = await identity();
    const service = dataApi();
    const handlers = createGeneratedTableHandlers(async () => service);
    const response = await handlers.GET(new NextRequest(
      "https://qkern.test/api/v1/projects/project-1/environments/development/tables/orders/rows?select=id,status&filter=status:eq:paid&limit=20",
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } },
    ), route);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(service.listRows).toHaveBeenCalledWith(
      expect.objectContaining({
        actorRef: principal.user.email,
        claims: { role: "authenticated", subject: principal.user.id },
      }),
      { projectId: "project-1", environment: "development", table: "orders" },
      expect.objectContaining({
        schema: "public", table: "orders", select: ["id", "status"],
        filters: [{ column: "status", operator: "eq", value: "paid" }], limit: 20,
      }),
    );

    const invalid = await handlers.GET(new NextRequest(
      "https://qkern.test/api/v1/projects/project-1/environments/development/tables/orders/rows?statement=DROP%20TABLE%20orders",
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } },
    ), route);
    expect(invalid.status).toBe(400);

    // Einbettungen (2.66) kommen als eigener Teil der Eingabe beim Dienst an.
    // Seit 2.111 geht eine Klammer in der Klammer, und erst die dritte Ebene
    // ist an der Route ein 400.
    const embedded = await handlers.GET(new NextRequest(
      "https://qkern.test/api/v1/projects/project-1/environments/development/tables/orders/rows?select=id,customer:customers(name),items()",
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } },
    ), route);
    expect(embedded.status).toBe(200);
    expect(service.listRows).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      select: ["id"],
      embed: [{ alias: "customer", relation: "customers", columns: ["name"] }, { alias: "items", relation: "items" }],
    }));
    const nested = await handlers.GET(new NextRequest(
      "https://qkern.test/api/v1/projects/project-1/environments/development/tables/orders/rows?select=id,items(sku,bestellung:orders(status))",
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } },
    ), route);
    expect(nested.status).toBe(200);
    expect(service.listRows).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      select: ["id"],
      embed: [{
        alias: "items", relation: "items", columns: ["sku"],
        embed: [{ alias: "bestellung", relation: "orders", columns: ["status"] }],
      }],
    }));
    // Eine dritte Ebene gibt es nicht, und ein Schema vor der Beziehung (2.112)
    // kommt mit.
    const tooDeep = await handlers.GET(new NextRequest(
      "https://qkern.test/api/v1/projects/project-1/environments/development/tables/orders/rows?select=id,items(orders(items(sku)))",
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } },
    ), route);
    expect(tooDeep.status).toBe(400);
    const foreign = await handlers.GET(new NextRequest(
      "https://qkern.test/api/v1/projects/project-1/environments/development/tables/orders/rows?select=id,kunde:verlag.customers(name)",
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } },
    ), route);
    expect(foreign.status).toBe(200);
    expect(service.listRows).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      embed: [{ alias: "kunde", relation: "customers", schema: "verlag", columns: ["name"] }],
    }));
  });

  it("requires same-origin for cookie writes but permits an exact scoped project key without Origin", async () => {
    const principal = await identity();
    const service = dataApi();
    const keys = {
      authenticate: vi.fn().mockResolvedValue({
        id: "key-1", organizationId: "org-key", projectId: "project-1",
        environment: "development", kind: "service", expiresAt: "2026-09-01T00:00:00.000Z",
      }),
    } as unknown as ProjectApiKeyService;
    const handlers = createGeneratedTableHandlers(async () => service, keys);
    const denied = await handlers.POST(new NextRequest(
      "https://qkern.test/api/v1/projects/project-1/environments/development/tables/orders/rows",
      { method: "POST", headers: {
        cookie: `${SESSION_COOKIE_NAME}=${principal.token}`, origin: "https://attacker.test",
        "content-type": "application/json",
      }, body: JSON.stringify({ rows: [{ id: "1" }] }) },
    ), route);
    expect(denied.status).toBe(403);

    const response = await handlers.POST(new NextRequest(
      "https://qkern.test/api/v1/projects/project-1/environments/development/tables/orders/rows",
      { method: "POST", headers: {
        authorization: `Bearer qk_service_${"a".repeat(43)}`,
        "content-type": "application/json",
      }, body: JSON.stringify({ rows: [{ id: "1" }] }) },
    ), route);
    expect(response.status).toBe(201);
    expect(service.insertRows).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-key",
        claims: { role: "service_role", subject: "key-1", keyId: "key-1" },
      }),
      { projectId: "project-1", environment: "development", table: "orders" },
      { schema: "public", table: "orders", rows: [{ id: "1" }] },
    );

    // Ein Upsert (2.105) kommt ueber dieselbe Tuer und dasselbe Verb; die Route
    // gibt `onConflict` weiter und entscheidet nichts darueber.
    const upsert = await handlers.POST(new NextRequest(
      "https://qkern.test/api/v1/projects/project-1/environments/development/tables/orders/rows",
      { method: "POST", headers: {
        authorization: `Bearer qk_service_${"a".repeat(43)}`,
        "content-type": "application/json",
      }, body: JSON.stringify({ rows: [{ id: "1", status: "paid" }], onConflict: ["id"] }) },
    ), route);
    expect(upsert.status).toBe(201);
    expect(service.insertRows).toHaveBeenLastCalledWith(
      expect.anything(),
      { projectId: "project-1", environment: "development", table: "orders" },
      { schema: "public", table: "orders", rows: [{ id: "1", status: "paid" }], onConflict: ["id"] },
    );
    // Keine Liste ist schon an der Route ein 400, und ein unbekannter
    // Schluessel im Rumpf bleibt unbekannt.
    for (const body of [{ rows: [{ id: "1" }], onConflict: "id" }, { rows: [{ id: "1" }], onConflictColumns: ["id"] }]) {
      const refused = await handlers.POST(new NextRequest(
        "https://qkern.test/api/v1/projects/project-1/environments/development/tables/orders/rows",
        { method: "POST", headers: {
          authorization: `Bearer qk_service_${"a".repeat(43)}`,
          "content-type": "application/json",
        }, body: JSON.stringify(body) },
      ), route);
      expect(refused.status).toBe(400);
    }
  });

  it("takes a GraphQL mutation through the same door as a row write and hands it to mutateRows as one batch", async () => {
    // Die Route liest am Dokument ab, ob sie schreibt (2.97). Eine Mutation mit
    // dem Sitzungscookie verlangt darum denselben Ursprung wie ein POST auf
    // /rows, und ohne ihn faellt sie, bevor der Dienst etwas sieht.
    const principal = await identity();
    const service = dataApi();
    const handlers = createProjectGraphqlHandlers(async () => service);
    const graphqlRoute = { params: Promise.resolve({ projectId: "project-1", environment: "development" }) };
    const mutation = `mutation { updateordersCollection(set: { status: "paid" }, where: ["id:eq:1"]) { affectedCount records { id } } }`;
    const denied = await handlers.POST(new NextRequest(
      "https://qkern.test/api/v1/projects/project-1/environments/development/graphql",
      { method: "POST", headers: {
        cookie: `${SESSION_COOKIE_NAME}=${principal.token}`, origin: "https://attacker.test",
        "content-type": "application/json",
      }, body: JSON.stringify({ query: mutation }) },
    ), graphqlRoute);
    expect(denied.status).toBe(403);
    expect(service.mutateRows).not.toHaveBeenCalled();

    const response = await handlers.POST(new NextRequest(
      "https://qkern.test/api/v1/projects/project-1/environments/development/graphql",
      { method: "POST", headers: {
        cookie: `${SESSION_COOKIE_NAME}=${principal.token}`, origin: "https://qkern.test",
        "content-type": "application/json",
      }, body: JSON.stringify({ query: mutation }) },
    ), graphqlRoute);
    expect(response.status).toBe(200);
    // Ein Aufruf, ein Stapel, dieselben Ansprueche wie an der Zeilenroute.
    expect(service.mutateRows).toHaveBeenCalledTimes(1);
    expect(service.mutateRows).toHaveBeenCalledWith(
      expect.objectContaining({
        actorRef: principal.user.email,
        claims: { role: "authenticated", subject: principal.user.id },
      }),
      { projectId: "project-1", environment: "development" },
      { schema: "public", mutations: [{ kind: "update", table: "orders", values: { status: "paid" },
        filters: [{ column: "id", operator: "eq", value: 1 }] }] },
    );
    const payload = await response.json();
    expect(payload.data.kind).toBe("mutation");
    expect(payload.data.data).toEqual({ updateordersCollection: { affectedCount: 1, records: [{ id: "1" }] } });
    expect(service.listRows).not.toHaveBeenCalled();

    // Ohne Bedingung faellt die Mutation im Plan, mit Grund, und der Dienst
    // wird nicht gerufen.
    const unconditioned = await handlers.POST(new NextRequest(
      "https://qkern.test/api/v1/projects/project-1/environments/development/graphql",
      { method: "POST", headers: {
        cookie: `${SESSION_COOKIE_NAME}=${principal.token}`, origin: "https://qkern.test",
        "content-type": "application/json",
      }, body: JSON.stringify({ query: "mutation { deleteFromordersCollection { affectedCount } }" }) },
    ), graphqlRoute);
    expect(unconditioned.status).toBe(400);
    expect(await unconditioned.json()).toMatchObject({ reason: "filter_required" });
    expect(service.mutateRows).toHaveBeenCalledTimes(1);
  });

  it("serves schema-generated OpenAPI through the same scoped authentication", async () => {
    const principal = await identity();
    const service = dataApi();
    const handler = createGeneratedOpenApiHandler(async () => service);
    const response = await handler(new NextRequest(
      "https://qkern.test/api/v1/projects/project-1/environments/development/generated-openapi?schema=public",
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } },
    ), { params: Promise.resolve({ projectId: "project-1", environment: "development" }) });
    expect(response.status).toBe(200);
    expect(service.generateOpenApi).toHaveBeenCalledWith(
      expect.objectContaining({ actorRef: principal.user.email }),
      { projectId: "project-1", environment: "development" },
      "public",
    );
  });
});
