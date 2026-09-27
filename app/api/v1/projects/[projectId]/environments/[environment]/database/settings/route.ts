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
 * `GET .../database/settings` — was ueber die Projektdatenbank wirklich gilt
 * (2.53): Name und Eigentuemer, die Rollen mit ihren Rechten, der TLS-Zustand
 * dieser Verbindung und die Verbindungsgrenzen des Servers.
 *
 * Dieselbe Tuer wie `/database/activity`: Session mit Leserecht oder
 * scope-gebundener Projekt-Key, dieselbe Fehlerabbildung, `private,
 * no-store`. Kein einziger Query-Parameter: Es gibt nichts zu waehlen, denn
 * die Auskunft gilt fuer die eine Datenbank dieses Environments. Jede Angabe
 * ist darum ein 400 statt einer stillschweigend ignorierten Wahl.
 *
 * **Keine Verbindungszeichenfolge, kein Passwort, kein Host, kein Port.** Die
 * Adresse der Datenbank steht im Katalog der Verbindungen und verlaesst ihn
 * nie; sie ist hier weder ausgelassen noch maskiert, sondern nie gelesen. Die
 * Console kann mit dieser Route nichts aendern: Es gibt kein Schreibverb.
 */
const environmentSchema = z.enum(["development", "staging", "production"]);

export async function handleProjectDatabaseSettings(
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
      return NextResponse.json({ error: "Invalid database settings request" }, { status: 400 });
    }
    const scope = { projectId: params.projectId, environment: environment.data };
    const context = await generatedDataContext(request, scope, false, keys, projectAuth);
    const service = dataPlane ?? await getProjectDataPlane();
    const result = await service.inspectSettings({
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
  return handleProjectDatabaseSettings(request, input);
}
