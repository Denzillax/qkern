import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import { getProjectDataPlane } from "@/lib/server/data-plane/runtime";
import {
  isProjectDataPlaneError,
  type ProjectDataPlanePort,
} from "@/lib/server/data-plane/service";
import { QUERY_PLAN_MAX_STATEMENT } from "@/lib/console/query-insights";
import {
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";

/**
 * Der Plan einer lesenden Abfrage (2.69).
 *
 * Bewusst dieselbe Tuer wie `environments/{environment}/query`, nur einen
 * Schritt weiter im Pfad: dieselbe Anmeldung, dieselbe Faehigkeit `read`,
 * dieselbe CSRF-Pruefung, derselbe Dienst. Die Route legt keine Verbindung an
 * und kennt kein SQL; sie reicht das Statement an `explainReadQuery` weiter,
 * und der Dienst setzt `EXPLAIN` davor, **ohne** `ANALYZE`. Die Abfrage wird
 * also nicht ausgefuehrt.
 *
 * POST und nicht GET, obwohl nichts geschrieben wird: Das Statement gehoert
 * nicht in eine URL. Es wuerde in Zugriffslogs, Referrern und im Verlauf des
 * Browsers landen, und es traegt die Literale der Abfrage.
 */
const environmentSchema = z.enum(["development", "staging", "production"]);
const explainSchema = z.object({
  statement: z.string().min(1).max(QUERY_PLAN_MAX_STATEMENT),
}).strict();

export async function handleProjectExplainQuery(
  request: NextRequest,
  input: { params: Promise<{ projectId: string; environment: string }> },
  dataPlane?: ProjectDataPlanePort,
) {
  try {
    const context = await authenticatedContext(request);
    requireCapability(context, "read");
    if (!hasTrustedOrigin(request)) return csrfRejected();
    const params = await input.params;
    const environment = environmentSchema.safeParse(params.environment);
    const body = explainSchema.safeParse(await safeJson(request));
    if (!environment.success || !body.success || !params.projectId || params.projectId.length > 128) {
      return NextResponse.json({ error: "Invalid explain request" }, { status: 400 });
    }
    const service = dataPlane ?? await getProjectDataPlane();
    const result = await service.explainReadQuery({
      organizationId: context.membership.organization.id,
      actorRef: context.user.email,
    }, { projectId: params.projectId, environment: environment.data }, body.data.statement);
    return NextResponse.json({ data: result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof RequestAuthenticationError) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (error instanceof RequestAuthorizationError) {
      return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    }
    if (isProjectDataPlaneError(error)) {
      // Eine Abfrage, die sich nicht planen laesst, ist ein Fehler des
      // Aufrufers und kein Ausfall: 400, damit die Ansicht nicht faelschlich
      // "Datenbank nicht erreichbar" sagt.
      if (error.code === "DATA_PLANE_INVALID_INPUT" || error.code === "READ_ONLY_QUERY_REQUIRED" ||
          error.code === "QUERY_PLAN_REJECTED") {
        return NextResponse.json({ error: "Invalid data-plane request", code: error.code }, { status: 400 });
      }
      if (error.code === "DATA_PLANE_NOT_READY") {
        return NextResponse.json({ error: "Project data plane is not ready", code: error.code }, { status: 409 });
      }
      return NextResponse.json({ error: "Project data plane unavailable", code: error.code }, { status: 503 });
    }
    return NextResponse.json({ error: "Project data plane unavailable" }, { status: 500 });
  }
}

export function POST(
  request: NextRequest,
  input: { params: Promise<{ projectId: string; environment: string }> },
) {
  return handleProjectExplainQuery(request, input);
}
