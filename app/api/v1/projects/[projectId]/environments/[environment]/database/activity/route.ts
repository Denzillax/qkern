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
 * `GET .../database/activity` — Betriebszahlen und Verbindungsgruppen der
 * Projektdatenbank (2.46). Dieselbe Tuer wie `/schema/policies`: Session mit
 * Leserecht oder scope-gebundener Projekt-Key, dieselbe Fehlerabbildung,
 * `private, no-store`.
 *
 * Nicht unter `schema/`: Dort steht der Katalog, also was in der Datenbank
 * definiert ist. Hier steht, was sie gerade tut. Das ist etwas anderes und
 * bekommt darum einen Nachbarn statt ein Kind.
 *
 * Die Route nimmt keinen einzigen Query-Parameter. Es gibt nichts zu
 * waehlen: Die Zahlen gelten fuer die eine Datenbank dieses Environments.
 * Jeder Parameter ist darum ein 400 und keine stillschweigend ignorierte
 * Angabe.
 *
 * Kein Abfragetext verlaesst den Server. Die Antwort traegt Zaehler, Rollen-
 * und Zustandsnamen und Anzahlen; `query`, `client_addr` und `backend_xmin`
 * werden nicht einmal gelesen.
 */
const environmentSchema = z.enum(["development", "staging", "production"]);

export async function handleProjectDatabaseActivity(
  request: NextRequest,
  input: { params: Promise<{ projectId: string; environment: string }> },
  dataPlane?: ProjectDataPlanePort,
  keys: ProjectApiKeyService = projectApiKeyService,
  projectAuth?: ProjectAuthService,
) {
  try {
    const params = await input.params;
    const environment = environmentSchema.safeParse(params.environment);
    if (!environment.success || !params.projectId || params.projectId.length > 128 ||
        [...request.nextUrl.searchParams.keys()].length > 0) {
      return NextResponse.json({ error: "Invalid activity request" }, { status: 400 });
    }
    const scope = { projectId: params.projectId, environment: environment.data };
    const context = await generatedDataContext(request, scope, false, keys, projectAuth);
    const service = dataPlane ?? await getProjectDataPlane();
    const result = await service.inspectActivity({
      organizationId: context.organizationId,
      actorRef: context.actorRef,
    }, scope);
    return NextResponse.json({ data: result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return dataPlaneRouteError(error);
  }
}

export function GET(
  request: NextRequest,
  input: { params: Promise<{ projectId: string; environment: string }> },
) {
  return handleProjectDatabaseActivity(request, input);
}
