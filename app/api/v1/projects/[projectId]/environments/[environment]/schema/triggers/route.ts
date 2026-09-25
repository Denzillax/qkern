import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getProjectDataPlane } from "@/lib/server/data-plane/runtime";
import type { ProjectDataPlanePort } from "@/lib/server/data-plane/service";
import { generatedDataContext } from "@/lib/server/data-plane/generated-http";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";
import { dataPlaneRouteError } from "@/app/api/v1/projects/[projectId]/environments/[environment]/schema/route";

/**
 * `GET /schema/triggers?schema=public` — die Trigger eines Schemas (2.9),
 * dieselbe Tuer wie `/schema`: Session mit Leserecht oder scope-gebundener
 * Projekt-Key, dieselbe Fehlerabbildung, `no-store`. Nur lesend; angelegt
 * wird ein Trigger wie jede Schemaaenderung ueber ein Change Set.
 */
const environmentSchema = z.enum(["development", "staging", "production"]);
const schemaName = z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/).default("public");

export async function handleProjectTriggers(
  request: NextRequest,
  input: { params: Promise<{ projectId: string; environment: string }> },
  dataPlane?: ProjectDataPlanePort,
  keys: ProjectApiKeyService = projectApiKeyService,
  projectAuth?: ProjectAuthService,
) {
  try {
    const params = await input.params;
    const environment = environmentSchema.safeParse(params.environment);
    const schema = schemaName.safeParse(request.nextUrl.searchParams.get("schema") ?? "public");
    if (!environment.success || !schema.success || !params.projectId || params.projectId.length > 128 ||
        [...request.nextUrl.searchParams.keys()].some((key) => key !== "schema") ||
        request.nextUrl.searchParams.getAll("schema").length > 1) {
      return NextResponse.json({ error: "Invalid schema request" }, { status: 400 });
    }
    const scope = { projectId: params.projectId, environment: environment.data };
    const context = await generatedDataContext(request, scope, false, keys, projectAuth);
    const service = dataPlane ?? await getProjectDataPlane();
    const result = await service.inspectTriggers({
      organizationId: context.organizationId,
      actorRef: context.actorRef,
    }, scope, schema.data);
    return NextResponse.json({ data: result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return dataPlaneRouteError(error);
  }
}

export function GET(
  request: NextRequest,
  input: { params: Promise<{ projectId: string; environment: string }> },
) {
  return handleProjectTriggers(request, input);
}
