import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generatedDataContext } from "@/lib/server/data-plane/generated-http";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";
import { dataPlaneRouteError } from "@/app/api/v1/projects/[projectId]/environments/[environment]/schema/route";
import { createBackupRestoreEvidenceVerifierFromEnv } from "@/lib/server/backup/restore-evidence-runtime";
import type { BackupRestoreReadiness } from "@/lib/server/backup/restore-evidence";
import {
  pointInTimeRecoveryOverview,
  readWalArchiveDeclaration,
  type PointInTimeRecoveryOverview,
} from "@/lib/server/backup/point-in-time";

/**
 * `GET .../database/backups/point-in-time` — was QKERN ueber eine
 * Wiederherstellung auf einen Zeitpunkt sagen kann (2.53). Dieselbe Tuer wie
 * `/database/activity`: Session mit Leserecht oder scope-gebundener
 * Projekt-Key, dieselbe Fehlerabbildung, `private, no-store`.
 *
 * Die Route nimmt keinen einzigen Query-Parameter. Es gibt nichts zu waehlen:
 * die Antwort gilt fuer die Ablage dieser Umgebung. Jeder Parameter ist darum
 * ein 400 und keine stillschweigend ignorierte Angabe.
 *
 * Die Antwort traegt drei Arten von Angaben und keine vierte: den Zustand, ein
 * Fenster, soweit es aus der Erklaerung des Betreibers folgt, und die Eckdaten
 * des letzten Restore-Drills. Kein Ort eines Archivs, keine Verbindungszeile,
 * kein Bucket, kein Schluessel -- die gelesenen Variablen sind auf drei Namen
 * begrenzt, und keiner davon traegt so etwas. Von der Evidenz gehen nur
 * Zeitpunkte und Dauern hinaus, nicht ihre ID, ihre Key-ID oder ihre Digests.
 *
 * Fehlt die Evidenz, ist sie abgeschaltet, veraltet oder ungueltig, dann ist
 * das kein Fehler der Anfrage: der Drill fehlt dann in der Antwort, und die
 * Antwort sagt genau das.
 */
const environmentSchema = z.enum(["development", "staging", "production"]);

export async function readBackupRestoreReadiness(
  env: Readonly<Record<string, string | undefined>> = process.env,
  signal?: AbortSignal,
): Promise<BackupRestoreReadiness | null> {
  if (env.QKERN_BACKUP_RESTORE_EVIDENCE_ENABLED !== "true") return null;
  try {
    return await createBackupRestoreEvidenceVerifierFromEnv(env).verify(signal);
  } catch {
    return null;
  }
}

export async function handleProjectPointInTimeRecovery(
  request: NextRequest,
  input: { params: Promise<{ projectId: string; environment: string }> },
  overview?: () => Promise<PointInTimeRecoveryOverview>,
  keys: ProjectApiKeyService = projectApiKeyService,
  projectAuth?: ProjectAuthService,
) {
  try {
    const params = await input.params;
    const environment = environmentSchema.safeParse(params.environment);
    if (!environment.success || !params.projectId || params.projectId.length > 128 ||
        [...request.nextUrl.searchParams.keys()].length > 0) {
      return NextResponse.json({ error: "Invalid point-in-time recovery request" }, { status: 400 });
    }
    const scope = { projectId: params.projectId, environment: environment.data };
    await generatedDataContext(request, scope, false, keys, projectAuth);
    const result = overview
      ? await overview()
      : pointInTimeRecoveryOverview({
        declaration: readWalArchiveDeclaration(),
        readiness: await readBackupRestoreReadiness(process.env, request.signal),
      });
    return NextResponse.json({ data: result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return dataPlaneRouteError(error);
  }
}

export function GET(
  request: NextRequest,
  input: { params: Promise<{ projectId: string; environment: string }> },
) {
  return handleProjectPointInTimeRecovery(request, input);
}
