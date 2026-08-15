import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import type { GeneratedDataApiPort } from "@/lib/server/data-plane/generated-api";
import { getGeneratedDataApi } from "@/lib/server/data-plane/generated-runtime";
import {
  generatedDataContext,
  presentedProjectApiKey,
} from "@/lib/server/data-plane/generated-http";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";
import { routeError } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/tables/[table]/rows/route";

/**
 * RPC — Sprosse 4 der Paritätsleiter, zweite Hälfte.
 *
 * `POST /rpc/<funktion>` ruft eine Funktion des Projektschemas mit benannten
 * Argumenten. Bedient werden nur `SECURITY INVOKER`-Funktionen: Ihr Rumpf
 * läuft als Aufrufer, und die RLS der berührten Tabellen gilt — dieselbe Tür
 * wie bei Views seit `1.71.0`. Ob die Transaktion schreiben darf, entscheidet
 * die deklarierte Flüchtigkeit der Funktion, nicht der Aufrufer.
 */
const paramsSchema = z.object({
  projectId: z.string().min(3).max(128),
  environment: z.enum(["development", "staging", "production"]),
  function: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/),
});
const schemaName = z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/);

type RouteContext = { params: Promise<{ projectId: string; environment: string; function: string }> };

function noStore(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createGeneratedRpcHandlers(
  getService: () => Promise<GeneratedDataApiPort> = getGeneratedDataApi,
  keys: ProjectApiKeyService = projectApiKeyService,
  projectAuth?: ProjectAuthService,
) {
  return {
    POST: async (request: NextRequest, routeContext: RouteContext) => {
      // Eine Funktion darf schreiben; ohne Projekt-Key gilt dieselbe
      // CSRF-Grenze wie fuer jede Mutation der Tabellenflaeche.
      try {
        if (!presentedProjectApiKey(request) && !hasTrustedOrigin(request)) return csrfRejected();
      } catch (error) { return routeError(error); }
      try {
        const parsed = paramsSchema.safeParse(await routeContext.params);
        const body = await safeJson(request);
        const schema = isPlainObject(body) ? schemaName.safeParse(body.schema ?? "public") : null;
        if (!parsed.success || !isPlainObject(body) || !schema?.success ||
            (body.args !== undefined && !isPlainObject(body.args)) ||
            Object.keys(body).some((key) => !["schema", "args"].includes(key))) {
          return noStore({ error: "Invalid generated data request" }, 400);
        }
        const scope = { projectId: parsed.data.projectId, environment: parsed.data.environment };
        const context = await generatedDataContext(request, scope, true, keys, projectAuth);
        const service = await getService();
        return noStore({ data: await service.callFunction(context, scope, {
          schema: schema.data,
          function: parsed.data.function,
          args: body.args as Record<string, unknown> | undefined,
        }) });
      } catch (error) { return routeError(error); }
    },
  };
}

export const POST = (request: NextRequest, routeContext: RouteContext) =>
  createGeneratedRpcHandlers().POST(request, routeContext);
