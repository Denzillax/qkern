import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import type { ProjectDatabaseBackupCatalog } from "@/lib/server/backup/project-database-catalog";
import { projectDatabaseBackupCatalog } from "@/lib/server/backup/project-database-catalog";
import { mappedError } from "@/app/api/v1/projects/[projectId]/environments/[environment]/database/backups/route";
import {
  parsedBackupParams,
  type BackupRouteParams,
} from "@/app/api/v1/projects/[projectId]/environments/[environment]/database/backups/[backupId]/route";
import {
  asControlPlaneContext,
  authenticatedContext,
  requireCapability,
} from "@/lib/server/request-context";

/**
 * `POST .../database/backups/{backupId}/restore` – eine Wiederherstellung
 * **anstossen** (2.129).
 *
 * ## Sie fuehrt sie nicht aus, und das ist der Kern
 *
 * Eine Wiederherstellung legt eine **neue Datenbank** an. `CREATEDB` hat in
 * QKERN genau ein Prozess, und der Next-Prozess ist es nicht -- er hat auch kein
 * `psql`, kein `pg_dump` und keinen Vault-Weg in eine Projektdatenbank. Diese
 * Route schreibt darum einen **Auftrag** in die Katalogzeile (0084), antwortet
 * mit 202 und ist fertig; der Provisioner nimmt ihn in derselben Runde, in der
 * er Backups fahrt, und zwar **vor** einem Backup: hier wartet ein Mensch.
 *
 * Wer wissen will, wie es ausgegangen ist, liest `GET .../backups/{backupId}`
 * und findet dort `restore.status` und, bei einem Fehlschlag, `restore.errorCode`.
 *
 * ## Nur der Eigentuemer
 *
 * `project_backup_restore` hat allein die Rolle `owner`, und die drei Gruende
 * stehen in der Route darueber (`database/backups/route.ts`, Abschnitt "Welche
 * Rolle was darf"). Kurz: sie erschafft etwas, das Geld kostet, sie bringt
 * geloeschte Daten zurueck, und sie ist nicht wiederholbar.
 *
 * ## Kein Name im Rumpf
 *
 * Der Rumpf ist leer und `strict`. Der Name der Zieldatenbank kommt aus der
 * Backup-Id (`restoreDatabaseName`), und zwar aus demselben Grund, aus dem der
 * Objektschluessel aus der Zeile kommt: ein Name aus einer Anfrage ist ein Name,
 * der auf eine vorhandene Datenbank zeigen kann.
 */
const bodySchema = z.object({}).strict();
const notFound = () => NextResponse.json({ error: "Resource not found" }, { status: 404 });

export function createRequestProjectDatabaseRestoreHandler(catalog: ProjectDatabaseBackupCatalog) {
  return async function POST(request: NextRequest, routeContext: BackupRouteParams) {
    if (!hasTrustedOrigin(request)) return csrfRejected();
    try {
      const principal = await authenticatedContext(request);
      requireCapability(principal, "project_backup_restore");
      const body = bodySchema.safeParse(await safeJson(request));
      if (!body.success) {
        return NextResponse.json({ error: "Invalid project database restore request" }, { status: 400 });
      }
      const params = await parsedBackupParams(routeContext);
      if (!params) return notFound();
      const context = asControlPlaneContext(principal);
      // Erst nachsehen, ob die Zeile ueberhaupt in diesen Pfad gehoert. Ohne das
      // waere eine Backup-Id der eigenen Organisation unter einem fremden
      // Projektpfad eine gueltige Bestellung, und der Pfad eine Verzierung.
      const existing = await catalog.get(context, params.backupId);
      if (!existing || existing.projectId !== params.projectId ||
          existing.environment !== params.environment) {
        return notFound();
      }
      const backup = await catalog.requestRestore(context, params.backupId);
      return NextResponse.json({ data: { backup } }, { status: 202 });
    } catch (error) {
      return mappedError(error, "Could not request a project database restore");
    }
  };
}

export const POST = createRequestProjectDatabaseRestoreHandler(projectDatabaseBackupCatalog);
