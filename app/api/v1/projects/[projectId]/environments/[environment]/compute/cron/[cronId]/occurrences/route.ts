import { NextRequest } from "next/server";
import { ComputeDefinitionError, type ComputeDefinitionService } from
  "@/lib/server/compute/definitions";
import {
  adminComputeContext,
  computeNoStore,
  computeRouteError,
  type ComputeDefinitionRouteContext,
} from "@/lib/server/compute/definitions-http";
import { getComputeDefinitionService } from "@/lib/server/compute/definitions-runtime";

/**
 * Das Cron-Log einer Definition (2.42) — **ohne Nutzlast**.
 *
 * Dieselbe Tuer wie die uebrigen Definitionsrouten: Admin-Sitzung mit
 * `project_compute_admin`, Organisation aus der Sitzung, ein fremder Pfad endet
 * in 404 statt 403. Nur GET, `no-store`, und **kein** Query-Parameter: Das
 * Fenster steht im Dienst und nicht im Aufruf, damit es nicht am Aufrufer
 * haengt, wie weit ein Log zurueckreicht. Jeder Parameter ist deshalb ein 400.
 *
 * Zurueck kommen erwartete Vorkommen und der Zustand der zugehoerigen
 * Nachricht — nie die Nutzlast, nie der Dedupe-Schluessel, nie eine
 * Nachrichten-Id. Die Nutzlast eines Cron-Jobs kann Kundendaten tragen; die
 * Frage, ob der Job laeuft, braucht sie nicht.
 */
export function createComputeCronOccurrenceHandlers(service: ComputeDefinitionService) {
  return {
    GET: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      try {
        const context = await adminComputeContext(request, routeContext);
        if ([...request.nextUrl.searchParams.keys()].length > 0) {
          return computeNoStore({ error: "Invalid compute request" }, 400);
        }
        return computeNoStore({
          data: await service.listCronOccurrences(
            context.principal, context.scope, cronId(context.raw),
          ),
        });
      } catch (error) { return computeRouteError(error); }
    },
  };
}

function cronId(raw: { cronId?: string }) {
  if (!raw.cronId) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
  return raw.cronId;
}

// Der Dienst wird innerhalb des Fehlerpfads aufgeloest: Ist die Flaeche nicht
// freigeschaltet, ist das eine 503 mit klarer Meldung und kein unbehandelter
// Serverfehler.
export const GET = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createComputeCronOccurrenceHandlers(getComputeDefinitionService())
      .GET(request, context);
  } catch (error) { return computeRouteError(error); }
};
