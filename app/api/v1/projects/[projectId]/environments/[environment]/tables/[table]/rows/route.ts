import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import {
  GeneratedDataApiError,
  type GeneratedDataApiPort,
  type GeneratedDataFilter,
} from "@/lib/server/data-plane/generated-api";
import { getGeneratedDataApi } from "@/lib/server/data-plane/generated-runtime";
import {
  generatedDataContext,
  presentedProjectApiKey,
} from "@/lib/server/data-plane/generated-http";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";
import {
  RequestAuthenticationError,
  RequestAuthorizationError,
} from "@/lib/server/request-context";

const paramsSchema = z.object({
  projectId: z.string().min(3).max(128),
  environment: z.enum(["development", "staging", "production"]),
  table: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/),
});
const schemaName = z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/);
const ALLOWED_QUERY = new Set(["schema", "select", "filter", "order", "cursor", "limit"]);

type RouteContext = { params: Promise<{ projectId: string; environment: string; table: string }> };

function noStore(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function routeScope(routeContext: RouteContext) {
  const parsed = paramsSchema.safeParse(await routeContext.params);
  return parsed.success ? parsed.data : null;
}

function routeError(error: unknown) {
  if (error instanceof RequestAuthenticationError) return noStore({ error: "Authentication required" }, 401);
  if (error instanceof RequestAuthorizationError) return noStore({ error: "Resource not found" }, 404);
  if (error instanceof GeneratedDataApiError) {
    if (error.code === "GENERATED_DATA_API_INVALID_INPUT") {
      return noStore({ error: "Invalid generated data request", code: error.code }, 400);
    }
    if (error.code === "GENERATED_DATA_API_TABLE_NOT_FOUND" || error.code === "GENERATED_DATA_API_FORBIDDEN") {
      return noStore({ error: "Resource not found", code: error.code }, 404);
    }
    if (error.code === "GENERATED_DATA_API_NOT_READY" ||
        error.code === "GENERATED_DATA_API_RLS_REQUIRED" ||
        error.code === "GENERATED_DATA_API_PRIMARY_KEY_REQUIRED") {
      return noStore({ error: "Table is not ready for the generated API", code: error.code }, 409);
    }
    return noStore({ error: "Generated project data API unavailable", code: error.code }, 503);
  }
  return noStore({ error: "Generated project data API unavailable" }, 500);
}

function parseListQuery(request: NextRequest) {
  if ([...request.nextUrl.searchParams.keys()].some((key) => !ALLOWED_QUERY.has(key))) return null;
  const singleton = ["schema", "select", "order", "cursor", "limit"];
  if (singleton.some((key) => request.nextUrl.searchParams.getAll(key).length > 1)) return null;
  const schema = schemaName.safeParse(request.nextUrl.searchParams.get("schema") ?? "public");
  if (!schema.success) return null;
  const selectRaw = request.nextUrl.searchParams.get("select");
  const select = selectRaw === null ? undefined : selectRaw.split(",").map((value) => value.trim());
  if (select?.some((value) => !value)) return null;
  const filters: GeneratedDataFilter[] = [];
  for (const encoded of request.nextUrl.searchParams.getAll("filter")) {
    const first = encoded.indexOf(":");
    const second = encoded.indexOf(":", first + 1);
    if (first < 1 || second < first + 2) return null;
    const column = encoded.slice(0, first);
    const operator = encoded.slice(first + 1, second) as GeneratedDataFilter["operator"];
    const rawValue = encoded.slice(second + 1);
    if (!rawValue) return null;
    filters.push({ column, operator, value: queryValue(rawValue) });
  }
  const orderRaw = request.nextUrl.searchParams.get("order");
  const orderMatch = orderRaw?.match(/^([a-z_][a-z0-9_]{0,62})\.(asc|desc)$/);
  if (orderRaw && !orderMatch) return null;
  const limitRaw = request.nextUrl.searchParams.get("limit");
  const limit = limitRaw === null ? undefined : Number(limitRaw);
  if (limitRaw !== null && (!/^\d{1,3}$/.test(limitRaw) || !Number.isSafeInteger(limit))) return null;
  return {
    schema: schema.data,
    select,
    filters,
    order: orderMatch ? { column: orderMatch[1], direction: orderMatch[2] as "asc" | "desc" } : undefined,
    cursor: request.nextUrl.searchParams.get("cursor") ?? undefined,
    limit,
  };
}

function queryValue(value: string): unknown {
  try { return JSON.parse(value); } catch { return value; }
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function mutationAllowed(request: NextRequest): Promise<NextResponse | null> {
  try {
    if (!presentedProjectApiKey(request) && !hasTrustedOrigin(request)) return csrfRejected();
    return null;
  } catch (error) {
    return routeError(error);
  }
}

export function createGeneratedTableHandlers(
  getService: () => Promise<GeneratedDataApiPort> = getGeneratedDataApi,
  keys: ProjectApiKeyService = projectApiKeyService,
  projectAuth?: ProjectAuthService,
) {
  return {
    GET: async (request: NextRequest, routeContext: RouteContext) => {
      try {
        const parsedScope = await routeScope(routeContext);
        const query = parseListQuery(request);
        if (!parsedScope || !query) return noStore({ error: "Invalid generated data request" }, 400);
        const context = await generatedDataContext(request, parsedScope, false, keys, projectAuth);
        const service = await getService();
        return noStore({ data: await service.listRows(context, parsedScope, {
          ...query,
          table: parsedScope.table,
        }) });
      } catch (error) { return routeError(error); }
    },
    POST: async (request: NextRequest, routeContext: RouteContext) => {
      const denied = await mutationAllowed(request);
      if (denied) return denied;
      try {
        const parsedScope = await routeScope(routeContext);
        const body = await safeJson(request);
        const schema = object(body) ? schemaName.safeParse(body.schema ?? "public") : null;
        if (!parsedScope || !object(body) || !schema?.success || !Array.isArray(body.rows) ||
            Object.keys(body).some((key) => !["schema", "rows"].includes(key))) {
          return noStore({ error: "Invalid generated data request" }, 400);
        }
        const context = await generatedDataContext(request, parsedScope, true, keys, projectAuth);
        const service = await getService();
        return noStore({ data: await service.insertRows(context, parsedScope, {
          schema: schema.data, table: parsedScope.table,
          rows: body.rows as Array<Record<string, unknown>>,
        }) }, 201);
      } catch (error) { return routeError(error); }
    },
    PATCH: async (request: NextRequest, routeContext: RouteContext) => {
      const denied = await mutationAllowed(request);
      if (denied) return denied;
      try {
        const parsedScope = await routeScope(routeContext);
        const body = await safeJson(request);
        const schema = object(body) ? schemaName.safeParse(body.schema ?? "public") : null;
        if (!parsedScope || !object(body) || !schema?.success || !object(body.match) || !object(body.values) ||
            Object.keys(body).some((key) => !["schema", "match", "values"].includes(key))) {
          return noStore({ error: "Invalid generated data request" }, 400);
        }
        const context = await generatedDataContext(request, parsedScope, true, keys, projectAuth);
        const service = await getService();
        return noStore({ data: await service.updateRow(context, parsedScope, {
          schema: schema.data, table: parsedScope.table, match: body.match, values: body.values,
        }) });
      } catch (error) { return routeError(error); }
    },
    DELETE: async (request: NextRequest, routeContext: RouteContext) => {
      const denied = await mutationAllowed(request);
      if (denied) return denied;
      try {
        const parsedScope = await routeScope(routeContext);
        const body = await safeJson(request);
        const schema = object(body) ? schemaName.safeParse(body.schema ?? "public") : null;
        if (!parsedScope || !object(body) || !schema?.success || !object(body.match) ||
            Object.keys(body).some((key) => !["schema", "match"].includes(key))) {
          return noStore({ error: "Invalid generated data request" }, 400);
        }
        const context = await generatedDataContext(request, parsedScope, true, keys, projectAuth);
        const service = await getService();
        return noStore({ data: await service.deleteRow(context, parsedScope, {
          schema: schema.data, table: parsedScope.table, match: body.match,
        }) });
      } catch (error) { return routeError(error); }
    },
  };
}

const handlers = createGeneratedTableHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
