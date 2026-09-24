import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type {
  GeneratedAggregate,
  GeneratedDataApiPort,
  GeneratedDataFilter,
} from "@/lib/server/data-plane/generated-api";
import { getGeneratedDataApi } from "@/lib/server/data-plane/generated-runtime";
import { generatedDataContext } from "@/lib/server/data-plane/generated-http";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";
import { routeError } from "../rows/route";

/**
 * `GET /tables/<table>/aggregate?fn=count&fn=sum:amount&group=<spalte>&filter=…`
 *
 * Aggregate unter der RLS des Aufrufers — dieselbe Grenze, dieselben Filter
 * und dieselbe Fehlerabbildung wie die Zeilenliste daneben; die Grenze selbst
 * wird importiert, nicht dupliziert. `fn` darf mehrfach stehen (bis zehn),
 * `count` ohne Spalte ist `count(*)`.
 */
const paramsSchema = z.object({
  projectId: z.string().min(3).max(128),
  environment: z.enum(["development", "staging", "production"]),
  table: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/),
});
const schemaName = z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/);
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const ALLOWED_QUERY = new Set(["schema", "filter", "fn", "group"]);

type RouteContext = { params: Promise<{ projectId: string; environment: string; table: string }> };

function noStore(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

function parseAggregateQuery(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if ([...params.keys()].some((key) => !ALLOWED_QUERY.has(key))) return null;
  if (params.getAll("schema").length > 1 || params.getAll("group").length > 1) return null;
  const schema = schemaName.safeParse(params.get("schema") ?? "public");
  if (!schema.success) return null;
  const aggregates: GeneratedAggregate[] = [];
  for (const raw of params.getAll("fn")) {
    const match = /^(count|sum|avg|min|max)(?::([a-z_][a-z0-9_]{0,62}))?$/.exec(raw);
    if (!match) return null;
    if (match[1] !== "count" && match[2] === undefined) return null;
    aggregates.push({ fn: match[1] as GeneratedAggregate["fn"], ...(match[2] ? { column: match[2] } : {}) });
  }
  if (aggregates.length < 1 || aggregates.length > 10) return null;
  const filters: GeneratedDataFilter[] = [];
  for (const encoded of params.getAll("filter")) {
    const first = encoded.indexOf(":");
    const second = encoded.indexOf(":", first + 1);
    if (first < 1 || second < first + 2) return null;
    const rawValue = encoded.slice(second + 1);
    if (!rawValue) return null;
    filters.push({
      column: encoded.slice(0, first),
      operator: encoded.slice(first + 1, second) as GeneratedDataFilter["operator"],
      value: queryValue(rawValue),
    });
  }
  const group = params.get("group");
  if (group !== null && !IDENTIFIER.test(group)) return null;
  return { schema: schema.data, aggregates, filters, groupBy: group ?? undefined };
}

function queryValue(value: string): unknown {
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d{1,15}(?:\.\d{1,6})?$/.test(value)) return Number(value);
  return value;
}

export function createGeneratedAggregateHandlers(
  getService: () => Promise<GeneratedDataApiPort> = getGeneratedDataApi,
  keys: ProjectApiKeyService = projectApiKeyService,
  projectAuth?: ProjectAuthService,
) {
  return {
    GET: async (request: NextRequest, routeContext: RouteContext) => {
      try {
        const parsedScope = paramsSchema.safeParse(await routeContext.params);
        const query = parseAggregateQuery(request);
        if (!parsedScope.success || !query) return noStore({ error: "Invalid generated data request" }, 400);
        const context = await generatedDataContext(request, parsedScope.data, false, keys, projectAuth);
        const service = await getService();
        return noStore({ data: await service.aggregateRows(context, parsedScope.data, {
          ...query,
          table: parsedScope.data.table,
        }) });
      } catch (error) { return routeError(error); }
    },
  };
}

export const GET = (request: NextRequest, routeContext: RouteContext) =>
  createGeneratedAggregateHandlers().GET(request, routeContext);
