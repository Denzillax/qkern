import { DATA_IDENTIFIER } from "@/lib/server/data-plane/identifiers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import type { GeneratedDataApiPort } from "@/lib/server/data-plane/generated-api";
import { getGeneratedDataApi } from "@/lib/server/data-plane/generated-runtime";
import {
  generatedDataContext,
  presentedProjectApiKey,
} from "@/lib/server/data-plane/generated-http";
import {
  ProjectGraphqlError,
  ProjectGraphqlService,
  planProjectGraphqlDocument,
} from "@/lib/server/data-plane/graphql";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";
import { routeError } from "../tables/[table]/rows/route";

/**
 * Die GraphQL-Fläche (2.83 lesend, 2.97 schreibend).
 *
 * `GET` gibt das Schema: die Typen, das SDL, die Grenzen und den Ausschnitt der
 * Sprache. `POST` führt genau ein Dokument aus, eine Abfrage oder eine
 * Mutation.
 *
 * Zwei Dinge sind hier bewusst nicht passiert. Es gibt **keinen zweiten
 * Aufrufweg**: `generatedDataContext` ist derselbe, den die REST-Fläche nimmt,
 * also entstehen die Ansprüche an genau einer Stelle, und eine Mutation
 * verlangt dort dasselbe wie ein `POST` auf `/rows`: den Schreibbereich eines
 * OAuth-Tokens, die Fähigkeit `project_data_mutate` einer Sitzung. Und es
 * gibt **keinen Introspektionsweg über GraphQL**: `__schema` wird abgewiesen,
 * und das Schema steht an `GET`, wo es dieselbe Berechtigung verlangt wie
 * eine Lesung.
 */
const paramsSchema = z.object({
  projectId: z.string().min(3).max(128),
  environment: z.enum(["development", "staging", "production"]),
});
const schemaName = z.string().regex(DATA_IDENTIFIER);

type RouteContext = { params: Promise<{ projectId: string; environment: string }> };

function noStore(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Die Fehlerabbildung dieser Fläche.
 *
 * Eine abgewiesene Abfrage ist ein Fehler der Anfrage und darum 400, mit dem
 * Grund im Klartext: Ein Aufrufer, der „syntax error“ liest, probiert; einer,
 * der `depth_exceeded` liest, schreibt die Abfrage um. Alles andere fällt in
 * die Abbildung der Data API, weil es dieselben Fehler sind.
 */
function graphqlError(error: unknown) {
  if (error instanceof ProjectGraphqlError) {
    return noStore({
      error: "The GraphQL document was refused",
      reason: error.reason,
      ...(error.at ? { at: error.at } : {}),
    }, 400);
  }
  return routeError(error);
}

export function createProjectGraphqlHandlers(
  getService: () => Promise<GeneratedDataApiPort> = getGeneratedDataApi,
  keys: ProjectApiKeyService = projectApiKeyService,
  projectAuth?: ProjectAuthService,
) {
  return {
    GET: async (request: NextRequest, routeContext: RouteContext) => {
      try {
        const parsedScope = paramsSchema.safeParse(await routeContext.params);
        const params = request.nextUrl.searchParams;
        if ([...params.keys()].some((key) => key !== "schema") || params.getAll("schema").length > 1) {
          return noStore({ error: "Invalid GraphQL request" }, 400);
        }
        const schema = schemaName.safeParse(params.get("schema") ?? "public");
        if (!parsedScope.success || !schema.success) return noStore({ error: "Invalid GraphQL request" }, 400);
        const context = await generatedDataContext(request, parsedScope.data, false, keys, projectAuth);
        const graphql = new ProjectGraphqlService(await getService());
        return noStore({ data: await graphql.describe(context, parsedScope.data, schema.data) });
      } catch (error) { return graphqlError(error); }
    },
    POST: async (request: NextRequest, routeContext: RouteContext) => {
      // Eine Lesung über POST. Der Ursprung wird trotzdem geprüft, wenn kein
      // Projekt-Key dabei ist: Eine Anfrage mit dem Sitzungscookie der Console
      // soll von einer fremden Seite aus nicht zustande kommen. Anwendungen
      // bringen ihren Key mit und merken davon nichts.
      try {
        if (!presentedProjectApiKey(request) && !hasTrustedOrigin(request)) return csrfRejected();
      } catch (error) { return graphqlError(error); }
      try {
        const parsedScope = paramsSchema.safeParse(await routeContext.params);
        const body = await safeJson(request);
        if (!parsedScope.success || !object(body) ||
            Object.keys(body).some((key) => !["schema", "query"].includes(key)) ||
            typeof body.query !== "string") {
          return noStore({ error: "Invalid GraphQL request" }, 400);
        }
        const schema = schemaName.safeParse(body.schema ?? "public");
        if (!schema.success) return noStore({ error: "Invalid GraphQL request" }, 400);
        // Erst der Plan, dann die Tür: Ob die Anfrage Schreibrechte braucht,
        // steht im Dokument und nicht im Token. Eine Mutation mit einem Token,
        // das nur lesen darf, fällt hier an derselben Stelle wie ein POST auf
        // die Zeilenroute, bevor die Datenbank etwas davon sieht.
        const plan = planProjectGraphqlDocument(body.query);
        const context = await generatedDataContext(request, parsedScope.data, plan.kind === "mutation", keys, projectAuth);
        const graphql = new ProjectGraphqlService(await getService());
        return noStore({ data: await graphql.execute(context, parsedScope.data, schema.data, plan) });
      } catch (error) { return graphqlError(error); }
    },
  };
}

const handlers = createProjectGraphqlHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
