import { DATA_IDENTIFIER } from "@/lib/server/data-plane/identifiers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getProjectDataPlane } from "@/lib/server/data-plane/runtime";
import type { ProjectDataPlanePort } from "@/lib/server/data-plane/service";
import { evaluateAuthAccess } from "@/lib/server/data-plane/auth-access-rules";
import { generatedDataContext } from "@/lib/server/data-plane/generated-http";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";
import { dataPlaneRouteError } from "@/app/api/v1/projects/[projectId]/environments/[environment]/schema/route";

/**
 * `GET /auth/access?schema=public` — was ein angemeldeter Nutzer dieses
 * Projekts wirklich lesen und schreiben darf (2.62).
 *
 * Dieselbe Tuer wie `/schema/policies`: Session mit Leserecht oder
 * scope-gebundener Projekt-Key, dieselbe Fehlerabbildung, dieselbe Pruefung des
 * einen Parameters `schema`, `private, no-store`. Nur lesend; eine Policy
 * entsteht wie jede Schemaaenderung ueber ein Change Set.
 *
 * Die Route fasst drei Leseauskuenfte zusammen, die es schon gibt, und rechnet
 * sie im reinen Modul `auth-access-rules` zu einem Urteil: die Tabellen mit
 * ihrem Row-Security-Schalter, die Policies desselben Schemas und den Namen der
 * Datenbankrolle, ueber die jede Anfrage der Data API laeuft. Ohne den
 * Rollennamen waere die Policy-Liste nicht deutbar, denn eine Policy nennt
 * Rollen, und welche Rolle eine angemeldete Anfrage ist, steht nicht in ihr.
 */
const environmentSchema = z.enum(["development", "staging", "production"]);
const schemaName = z.string().regex(DATA_IDENTIFIER).default("public");

export async function handleProjectAuthAccess(
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
    const inspection = { organizationId: context.organizationId, actorRef: context.actorRef };
    const [tables, policies, settings] = await Promise.all([
      service.inspectSchema(inspection, scope, schema.data),
      service.inspectPolicies(inspection, scope, schema.data),
      service.inspectSettings(inspection, scope),
    ]);
    const result = evaluateAuthAccess({
      schema: schema.data,
      role: settings.currentRole,
      tables: tables.tables,
      policies: policies.policies,
    });
    return NextResponse.json({
      data: {
        source: "postgres" as const,
        ...result,
        // Ehrlich statt beruhigend: Ist eine der beiden Listen abgeschnitten,
        // ist das Urteil unvollstaendig, und die Ansicht sagt das.
        truncated: tables.truncated || policies.truncated,
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return dataPlaneRouteError(error);
  }
}

export function GET(
  request: NextRequest,
  input: { params: Promise<{ projectId: string; environment: string }> },
) {
  return handleProjectAuthAccess(request, input);
}
