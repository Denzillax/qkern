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
 * `GET .../database/health` — der Zustand der Projektdatenbank (2.70): die
 * Stoerungszaehler aus `pg_stat_database` und der Schreibweg des Servers aus
 * `pg_stat_checkpointer` beziehungsweise `pg_stat_bgwriter`.
 *
 * **Das ist kein Serverlog.** QKERN hat keinen Dateizugriff auf die
 * Projektdatenbank; `log_destination` schreibt in Dateien des Servers, und
 * diese Route liest keine davon. Sie liest Zaehler, und ein Zaehler ist eine
 * Summe seit der letzten Ruecksetzung, kein Ereignis mit Zeitpunkt.
 *
 * Dieselbe Tuer wie `/database/activity` und `/database/runtime`: Session mit
 * Leserecht oder scope-gebundener Projekt-Key, dieselbe Fehlerabbildung,
 * `private, no-store`. Kein Query-Parameter, denn es gibt nichts zu waehlen;
 * jede Angabe ist darum ein 400 statt einer stillschweigend verworfenen Wahl.
 *
 * Die Trennung von `/database/activity` ist gewollt: dort steht der Durchsatz
 * und die Verbindungen je Rolle, hier stehen die Stoerungen. Kein
 * Abfragetext, keine Fehlermeldung im Wortlaut, keine Adresse. Es gibt kein
 * Schreibverb.
 */
const environmentSchema = z.enum(["development", "staging", "production"]);

export async function handleProjectDatabaseHealth(
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
      return NextResponse.json({ error: "Invalid database health request" }, { status: 400 });
    }
    const scope = { projectId: params.projectId, environment: environment.data };
    const context = await generatedDataContext(request, scope, false, keys, projectAuth);
    const service = dataPlane ?? await getProjectDataPlane();
    const result = await service.inspectDatabaseHealth({
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
  return handleProjectDatabaseHealth(request, input);
}
