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
 * `GET .../database/runtime` — worauf diese Umgebung laeuft (2.67): die
 * Postgres-Version, die Kodierung und die Sortierung der Datenbank, ihre
 * Groesse, seit wann der Server laeuft und ob diese Verbindung ein Standby
 * liest.
 *
 * Dieselbe Tuer wie `/database/settings` und `/database/activity`: Session mit
 * Leserecht oder scope-gebundener Projekt-Key, dieselbe Fehlerabbildung,
 * `private, no-store`. Kein Query-Parameter, denn es gibt nichts zu waehlen;
 * jede Angabe ist darum ein 400 statt einer stillschweigend verworfenen Wahl.
 *
 * Die Trennung von `/database/settings` ist gewollt und nicht redundant: dort
 * steht, wie die Datenbank eingestellt ist, hier, worauf sie laeuft.
 *
 * **Keine Verbindungszeichenfolge, kein Host, kein Port, kein Datenpfad.** Die
 * Adresse der Datenbank steht im Katalog der Verbindungen und verlaesst ihn
 * nie. Es gibt kein Schreibverb.
 */
const environmentSchema = z.enum(["development", "staging", "production"]);

export async function handleProjectDatabaseRuntime(
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
      return NextResponse.json({ error: "Invalid database runtime request" }, { status: 400 });
    }
    const scope = { projectId: params.projectId, environment: environment.data };
    const context = await generatedDataContext(request, scope, false, keys, projectAuth);
    const service = dataPlane ?? await getProjectDataPlane();
    const result = await service.inspectRuntime({
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
  return handleProjectDatabaseRuntime(request, input);
}
