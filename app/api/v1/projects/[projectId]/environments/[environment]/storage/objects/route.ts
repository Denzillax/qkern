import { NextRequest } from "next/server";
import {
  adminProjectStorageContext,
  projectStorageNoStore,
  projectStorageRouteError,
  type ProjectStorageRouteContext,
} from "@/lib/server/project-storage/http";
import { getProjectStorageService } from "@/lib/server/project-storage/runtime";
import type { ProjectStorageService } from "@/lib/server/project-storage/service";

/**
 * Der Stand der Speicherobjekte einer Umgebung — lesend, die Leseflaeche aus
 * 2.51 fuer **Logs → Storage**.
 *
 * Der Name der Seite verspricht ein Protokoll; die Route liefert keins, weil
 * QKERN keins fuehrt. `project_storage_objects` traegt den aktuellen Stand je
 * Objekt und das letzte Urteil des Scanners, nicht seine Geschichte. Die
 * Antwort nennt deshalb Objekte, nicht Ereignisse.
 *
 * Vier Parameter und kein fuenfter: `bucket`, `status`, `cursor`, `limit`.
 * Jeder fremde Name, jede zweite Angabe desselben Parameters und jeder Wert
 * ausserhalb der Grenzen sind ein 400 — der fremde Name **vor** jedem
 * Dienstaufruf. Zugang, Kontext und Fehlerweg sind die der uebrigen
 * Console-Routen von Storage (`project_storage_admin`), samt
 * `Cache-Control: private, no-store` und der 503-Regel fuer einen
 * abgeschalteten oder nicht erreichbaren Dienst.
 *
 * Nie ein Provider-Schluessel, nie eine Pruefsumme, nie eine signierte
 * Adresse und nie der Inhalt eines Objekts: Signieren ist ein eigener Weg
 * (`storage/buckets/{bucketId}/downloads`) und bleibt dort.
 */
const PARAMETERS = new Set(["bucket", "status", "cursor", "limit"]);

export function createProjectStorageObjectLogHandlers(service: ProjectStorageService) {
  return {
    GET: async (request: NextRequest, routeContext: ProjectStorageRouteContext) => {
      try {
        const parameters = request.nextUrl.searchParams;
        if ([...parameters.keys()].some((key) => !PARAMETERS.has(key)) ||
            [...PARAMETERS].some((key) => parameters.getAll(key).length > 1)) {
          return projectStorageNoStore({ error: "Invalid storage request" }, 400);
        }
        const limit = parameters.get("limit");
        if (limit !== null && !/^\d{1,3}$/.test(limit)) {
          return projectStorageNoStore({ error: "Invalid storage request" }, 400);
        }
        const context = await adminProjectStorageContext(request, routeContext);
        return projectStorageNoStore({
          data: await service.readObjectLog(context.principal, context.scope, {
            bucket: parameters.get("bucket") ?? undefined,
            status: parameters.get("status") ?? undefined,
            cursor: parameters.get("cursor") ?? undefined,
            limit: limit === null ? undefined : Number(limit),
          }),
        });
      } catch (error) { return projectStorageRouteError(error); }
    },
  };
}

export const GET = (request: NextRequest, routeContext: ProjectStorageRouteContext) =>
  createProjectStorageObjectLogHandlers(getProjectStorageService()).GET(request, routeContext);
