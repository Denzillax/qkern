import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import { domainErrorCode } from "@/lib/server/domain-errors";
import type { ProjectDatabaseBackupCatalog } from "@/lib/server/backup/project-database-catalog";
import { projectDatabaseBackupCatalog } from "@/lib/server/backup/project-database-catalog";
import {
  asControlPlaneContext,
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";

/**
 * Die Backups einer Projektdatenbank (2.129).
 *
 * `GET  .../database/backups` – der Katalog dieser Umgebung und ihr Zeitplan.
 * `POST .../database/backups` – ein Backup bestellen.
 *
 * ## Warum diese Tuer und nicht die von `point-in-time`
 *
 * Unter den Backup-Routen stand bis 2.129 genau ein Pfad, `point-in-time`, und
 * der geht durch `generatedDataContext`: Session mit Leserecht **oder**
 * scope-gebundener Projekt-Key. Das passt dort, weil die Antwort die Erklaerung
 * des Betreibers ueber sein WAL-Archiv ist, also eine Auskunft ueber die
 * Umgebung.
 *
 * Hier passt es nicht, und der Grund ist der Projekt-Key. Ein Projekt-Key ist
 * ein Zugangsdatum, das in einer Anwendung liegt -- in einer Funktion, in einem
 * Worker, in einem CI-Lauf. Mit einem Projekt-Key ein **Backup der ganzen
 * Datenbank** bestellen zu koennen hiesse: wer irgendwo einen Key findet, kann
 * den Dump jeder Zeile der Datenbank anstossen. Dass er ihn nicht lesen kann,
 * aendert daran nichts; er kann Last erzeugen, und mit der Wiederherstellung
 * koennte er eine zweite Datenbank im Cluster anlegen lassen.
 *
 * Darum geht diese Route durch die **Rollenmatrix der Control Plane**
 * (`authenticatedContext` + `requireCapability`), wie `provisioning` und
 * `api-keys`. Ein Backup ist eine Handlung am Lebenslauf der Datenbank und keine
 * Abfrage der Daten.
 *
 * ## Welche Rolle was darf, und warum
 *
 * Drei Rechte und nicht eines, weil die drei Handlungen nicht dasselbe sind:
 *
 * - **`project_backup_read`** – den Katalog lesen. Dasselbe Feld wie
 *   `project_provisioning_read`: Eigentuemer, Administrator, Deployer, Support.
 *   Ein Katalogeintrag sagt, dass es ein Backup gibt und wie gross es ist; er
 *   gibt keine Zeile heraus.
 * - **`project_backup_request`** – ein Backup bestellen. Eigentuemer und
 *   Administrator. Es kostet Rechenzeit auf der Mandantendatenbank und Platz im
 *   Objektspeicher, also dieselbe Hoehe wie
 *   `project_provisioning_request`.
 * - **`project_backup_restore`** – eine Wiederherstellung anstossen. **Nur
 *   Eigentuemer.** Das ist die bewusste Ausnahme, und sie steht hier, weil
 *   "eine Wiederherstellung ist kein Lesen" sonst nur ein Satz waere:
 *   1. Sie legt eine **neue Datenbank** im Cluster an. Das ist die einzige
 *      Handlung in dieser Datei, die etwas erschafft, das danach Geld kostet,
 *      bis jemand es wegnimmt.
 *   2. Sie bringt **geloeschte Daten zurueck**. Wenn ein Mandant Daten auf
 *      Verlangen einer Person geloescht hat, ist eine Wiederherstellung die
 *      Handlung, die sie wieder da hat -- in einer zweiten Datenbank, die
 *      niemand in einem Loeschauftrag genannt hat. Wer das darf, muss derselbe
 *      sein, der fuer die Organisation haftet.
 *   3. Sie ist **nicht wiederholbar** (0084): ein Fehlschlag laesst eine halbe
 *      Datenbank liegen, die ein Mensch ansehen muss.
 *   Ein Administrator kann ein Backup bestellen und den Katalog lesen; die
 *   Datenbank zurueckholen kann der Eigentuemer.
 *
 * ## Die Mandantengrenze
 *
 * Ohne Filter in der Anfrage. Diese Route gibt die Organisation **nicht** an den
 * Katalog weiter, um damit zu filtern: sie gibt sie als Mandanten der
 * Transaktion weiter, und die Policy aus 0083 entscheidet. Ein `projectId` aus
 * einem fremden Mandanten ergibt 404, und zwar weil die Zeile nicht kommt und
 * nicht weil eine Bedingung sie weggelassen hat.
 */
const projectIdSchema = z.string().uuid();
const environmentSchema = z.enum(["development", "staging", "production"]);
const limitSchema = z.coerce.number().int().min(1).max(200);
/** Ein leerer Rumpf, `strict`. Es gibt nichts zu waehlen: weder Ort noch Frist noch Name. */
const bodySchema = z.object({}).strict();
const notFound = () => NextResponse.json({ error: "Resource not found" }, { status: 404 });

async function parsedParams(routeContext: {
  params: Promise<{ projectId: string; environment: string }>;
}) {
  const raw = await routeContext.params;
  const projectId = projectIdSchema.safeParse(raw.projectId);
  const environment = environmentSchema.safeParse(raw.environment);
  return projectId.success && environment.success
    ? { projectId: projectId.data, environment: environment.data }
    : undefined;
}

export function createListProjectDatabaseBackupsHandler(catalog: ProjectDatabaseBackupCatalog) {
  return async function GET(
    request: NextRequest,
    routeContext: { params: Promise<{ projectId: string; environment: string }> },
  ) {
    try {
      const principal = await authenticatedContext(request);
      requireCapability(principal, "project_backup_read");
      const params = await parsedParams(routeContext);
      if (!params) return notFound();
      const rawLimit = request.nextUrl.searchParams.get("limit");
      const unknown = [...request.nextUrl.searchParams.keys()].some((name) => name !== "limit");
      const limit = rawLimit === null ? 50 : limitSchema.safeParse(rawLimit).data;
      // Ein unbekannter Parameter ist ein 400 und keine stillschweigend
      // ignorierte Angabe -- dieselbe Regel wie unter `point-in-time`.
      if (unknown || limit === undefined) {
        return NextResponse.json({ error: "Invalid project database backup request" }, { status: 400 });
      }
      const data = await catalog.list(asControlPlaneContext(principal), params, limit);
      return NextResponse.json({ data }, { headers: { "cache-control": "private, no-store" } });
    } catch (error) {
      return mappedError(error, "Could not read project database backups");
    }
  };
}

export function createRequestProjectDatabaseBackupHandler(catalog: ProjectDatabaseBackupCatalog) {
  return async function POST(
    request: NextRequest,
    routeContext: { params: Promise<{ projectId: string; environment: string }> },
  ) {
    if (!hasTrustedOrigin(request)) return csrfRejected();
    try {
      const principal = await authenticatedContext(request);
      requireCapability(principal, "project_backup_request");
      const body = bodySchema.safeParse(await safeJson(request));
      if (!body.success) {
        return NextResponse.json({ error: "Invalid project database backup request" }, { status: 400 });
      }
      const params = await parsedParams(routeContext);
      if (!params) return notFound();
      const result = await catalog.request(asControlPlaneContext(principal), params);
      // 202, wenn ein Auftrag entstand, und 200, wenn schon einer wartet. Das
      // ist dieselbe Unterscheidung wie bei `provisioning`: ein zweiter Aufruf
      // ist nicht falsch, er hat nur nichts Neues bewirkt.
      return NextResponse.json({ data: { ...result, idempotent: !result.created } }, {
        status: result.created ? 202 : 200,
      });
    } catch (error) {
      return mappedError(error, "Could not request a project database backup");
    }
  };
}

/**
 * Die Fehlerabbildung, und zwar dieselbe wie unter `provisioning`.
 *
 * `RequestAuthorizationError` wird **404** und nicht 403: eine Rolle ohne Recht
 * soll nicht erfahren, dass es dieses Projekt gibt. Das ist die Regel des
 * Hauses und nicht eine Entscheidung dieser Datei.
 */
export function mappedError(error: unknown, fallback: string) {
  if (error instanceof RequestAuthenticationError) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (error instanceof RequestAuthorizationError) return notFound();
  const code = (error as { code?: unknown })?.code ?? domainErrorCode(error);
  if (code === "BACKUP_NOT_FOUND" || code === "RESOURCE_NOT_FOUND" ||
      code === "INVALID_REFERENCE" || code === "INVALID_RECORD") {
    return notFound();
  }
  if (code === "BACKUP_NOT_AVAILABLE" || code === "RESTORE_ALREADY_REQUESTED" ||
      code === "CONFLICT") {
    return NextResponse.json({ error: "The project database backup cannot be used for this" }, { status: 409 });
  }
  if (code === "DEPENDENCY_UNAVAILABLE" || code === "PERSISTENCE_ERROR") {
    return NextResponse.json({ error: "Project database backup service unavailable" }, { status: 503 });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export const GET = createListProjectDatabaseBackupsHandler(projectDatabaseBackupCatalog);
export const POST = createRequestProjectDatabaseBackupHandler(projectDatabaseBackupCatalog);
