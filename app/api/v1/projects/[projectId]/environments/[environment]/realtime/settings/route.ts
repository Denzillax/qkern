import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generatedDataContext } from "@/lib/server/data-plane/generated-http";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";
import { realtimeSettings } from "@/lib/server/realtime/settings";
import { dataPlaneRouteError } from "@/app/api/v1/projects/[projectId]/environments/[environment]/schema/route";

/**
 * `GET .../realtime/settings` — die wirksamen Grenzen des Realtime-Transports
 * (2.48).
 *
 * Dieselbe Tuer wie `/database/activity` und `/schema/policies`: Session mit
 * Leserecht oder scope-gebundener Projekt-Key, dieselbe Fehlerabbildung,
 * `private, no-store`.
 *
 * Die Route nimmt keinen einzigen Query-Parameter. Es gibt nichts zu waehlen:
 * Die Grenzen gelten fuer diese Installation. Jeder Parameter ist darum ein
 * 400 und keine stillschweigend ignorierte Angabe.
 *
 * Nur lesend, und ausdruecklich ohne Schreibpfad: Es gibt keinen POST, kein
 * PATCH und keinen Setzer. Geaendert wird in der Umgebung des
 * Realtime-Prozesses, nicht hier.
 *
 * Kein Geheimnis verlaesst den Server. Gelesen wird die feste Liste in
 * `lib/server/realtime/settings`; das Cursor-Geheimnis, die Datenbank-URL und
 * die Origin-Liste stehen nicht darin und koennen diesen Weg nicht nehmen.
 *
 * Betriebszahlen stehen bewusst nicht in der Antwort: Verbindungen und
 * Abonnements fuehrt der Realtime-Prozess, nicht dieser. Sie zu melden hiesse,
 * ihn ueber das Netz zu fragen — eine Wirkung, die eine Leseroute nicht hat.
 * Die Antwort sagt das, statt zu schweigen.
 */
const environmentSchema = z.enum(["development", "staging", "production"]);

export async function handleProjectRealtimeSettings(
  request: NextRequest,
  input: { params: Promise<{ projectId: string; environment: string }> },
  env: Readonly<Record<string, string | undefined>> = process.env,
  keys: ProjectApiKeyService = projectApiKeyService,
  projectAuth?: ProjectAuthService,
) {
  try {
    const params = await input.params;
    const environment = environmentSchema.safeParse(params.environment);
    if (!environment.success || !params.projectId || params.projectId.length > 128 ||
        [...request.nextUrl.searchParams.keys()].length > 0) {
      return NextResponse.json({ error: "Invalid realtime settings request" }, { status: 400 });
    }
    const scope = { projectId: params.projectId, environment: environment.data };
    await generatedDataContext(request, scope, false, keys, projectAuth);
    return NextResponse.json({ data: realtimeSettings(scope, env) },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return dataPlaneRouteError(error);
  }
}

export function GET(
  request: NextRequest,
  input: { params: Promise<{ projectId: string; environment: string }> },
) {
  return handleProjectRealtimeSettings(request, input);
}
