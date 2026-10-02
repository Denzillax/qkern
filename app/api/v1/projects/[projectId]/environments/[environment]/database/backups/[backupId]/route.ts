import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { ProjectDatabaseBackupCatalog } from "@/lib/server/backup/project-database-catalog";
import { projectDatabaseBackupCatalog } from "@/lib/server/backup/project-database-catalog";
import { mappedError } from "@/app/api/v1/projects/[projectId]/environments/[environment]/database/backups/route";
import {
  asControlPlaneContext,
  authenticatedContext,
  requireCapability,
} from "@/lib/server/request-context";

/**
 * `GET .../database/backups/{backupId}` – der Zustand eines Backups (2.129).
 *
 * Dieselbe Tuer und dieselbe Rollenmatrix wie die Liste darueber; die
 * Begruendung steht dort.
 *
 * **Die Mandantengrenze ohne Filter in der Anfrage.** Diese Route prueft
 * **nicht** nach, ob die Zeile zu `projectId` und `environment` aus dem Pfad
 * passt, und das ist Absicht mit einer Bedingung: `store.get` lauft unter der
 * Organisation des Prinzipals, und die Policy aus 0083 gibt eine fremde Zeile
 * nicht heraus. Eine Backup-Id eines fremden Mandanten ergibt also 404.
 *
 * Was eine eigene Pruefung ist und darum hier steht: ein Backup der **eigenen**
 * Organisation, aber eines **anderen Projekts** im Pfad. Die Policy sagt dazu
 * nichts, denn die Zeile gehoert dem Mandanten. Ohne diese Pruefung waere der
 * Pfad eine Verzierung und zwei verschiedene Adressen gaeben dasselbe her -- und
 * eine Console, die daraus einen Link baut, fuehrte in die falsche Umgebung.
 */
const projectIdSchema = z.string().uuid();
const backupIdSchema = z.string().uuid();
const environmentSchema = z.enum(["development", "staging", "production"]);
const notFound = () => NextResponse.json({ error: "Resource not found" }, { status: 404 });

export type BackupRouteParams = {
  params: Promise<{ projectId: string; environment: string; backupId: string }>;
};

export async function parsedBackupParams(routeContext: BackupRouteParams) {
  const raw = await routeContext.params;
  const projectId = projectIdSchema.safeParse(raw.projectId);
  const environment = environmentSchema.safeParse(raw.environment);
  const backupId = backupIdSchema.safeParse(raw.backupId);
  return projectId.success && environment.success && backupId.success
    ? { projectId: projectId.data, environment: environment.data, backupId: backupId.data }
    : undefined;
}

export function createGetProjectDatabaseBackupHandler(catalog: ProjectDatabaseBackupCatalog) {
  return async function GET(request: NextRequest, routeContext: BackupRouteParams) {
    try {
      const principal = await authenticatedContext(request);
      requireCapability(principal, "project_backup_read");
      const params = await parsedBackupParams(routeContext);
      if (!params || [...request.nextUrl.searchParams.keys()].length > 0) {
        return params ? NextResponse.json({ error: "Invalid project database backup request" }, { status: 400 })
          : notFound();
      }
      const backup = await catalog.get(asControlPlaneContext(principal), params.backupId);
      if (!backup || backup.projectId !== params.projectId ||
          backup.environment !== params.environment) {
        return notFound();
      }
      return NextResponse.json({ data: { backup } }, {
        headers: { "cache-control": "private, no-store" },
      });
    } catch (error) {
      return mappedError(error, "Could not read the project database backup");
    }
  };
}

export const GET = createGetProjectDatabaseBackupHandler(projectDatabaseBackupCatalog);
