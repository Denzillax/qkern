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
 * `GET .../database/statements`: die teuersten Statements der
 * Projektdatenbank aus `pg_stat_statements` (2.67).
 *
 * Dieselbe Tuer wie `database/activity`: Console-Session mit Leserecht oder
 * scope-gebundener Projekt-Key, dieselbe Fehlerabbildung, `private,
 * no-store`, kein einziger Query-Parameter. Es gibt nichts zu waehlen; die
 * Sicht gilt fuer die eine Datenbank dieses Environments, und der Dienst
 * sortiert und begrenzt bereits.
 *
 * Neben `database/activity` und nicht darunter, aus demselben Grund, aus dem
 * die Aktivitaet nicht unter `schema/` steht: Der Katalog sagt, was
 * definiert ist, diese Route sagt, was Zeit gekostet hat.
 *
 * Keine zweite Lesestelle: Gelesen wird `inspectStatements`, dieselbe
 * Methode, die der Leistungsberater seit 2.57 benutzt. Sie liefert seit 2.67
 * zwei Zahlen mehr, aber weiterhin keinen Abfragetext.
 *
 * Fehlt die Erweiterung, ist das kein Fehler und kein leeres Ergebnis: Die
 * Antwort traegt `installed: false`, und die Ansicht sagt den Satz dazu.
 */
const environmentSchema = z.enum(["development", "staging", "production"]);

export async function handleProjectDatabaseStatements(
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
      return NextResponse.json({ error: "Invalid statements request" }, { status: 400 });
    }
    const scope = { projectId: params.projectId, environment: environment.data };
    const context = await generatedDataContext(request, scope, false, keys, projectAuth);
    const service = dataPlane ?? await getProjectDataPlane();
    const result = await service.inspectStatements({
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
  return handleProjectDatabaseStatements(request, input);
}
