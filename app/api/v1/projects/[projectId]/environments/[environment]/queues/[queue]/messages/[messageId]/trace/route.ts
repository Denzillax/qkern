import { NextRequest } from "next/server";
import {
  adminProjectQueueContext,
  projectQueueNoStore,
  projectQueueRouteError,
  type ProjectQueueRouteContext,
} from "@/lib/server/project-queues/http";
import { getProjectQueueService } from "@/lib/server/project-queues/runtime";
import type { ProjectQueueService } from "@/lib/server/project-queues/service";

/**
 * Die Spur einer Nachricht (2.121) — **ohne Nutzlast**.
 *
 * Die Route beantwortet die eine Frage, die ein Betreiber vor jeder anderen
 * stellt: Was ist mit dieser Nachricht passiert. Stationen in Zeitreihenfolge,
 * je mit Zeitpunkt, Versuch, Wirt und, wo es einen gibt, dem festen
 * Fehlercode. Der Inhalt der Nachricht beantwortet die Frage nicht und gehoert
 * dem Projekt; der Zustellstatus der Webhooks und das Aufrufprotokoll der
 * Functions halten es genauso.
 *
 * Admin und nicht Service-Rolle: Eine Spur sagt, welcher Wirt wann woran
 * gearbeitet hat. Das ist eine Angabe ueber den Betrieb und nicht eine fuer die
 * Anwendung, die eingereiht hat. Dieselbe Grenze wie bei `status` und bei den
 * Dead Letters.
 *
 * Kein CORS: Wie jede Admin-Route der Queues. Die Vorabanfrage und die
 * Kopfzeilen braucht nur das Einreihen, und das hat seine eigene Tuer.
 */
export function createProjectQueueTraceHandlers(service: ProjectQueueService) {
  return {
    GET: async (request: NextRequest, routeContext: ProjectQueueRouteContext) => {
      try {
        const context = await adminProjectQueueContext(request, routeContext);
        if (!context.raw.queue || !context.raw.messageId) {
          return projectQueueNoStore({ error: "Invalid queue request" }, 400);
        }
        return projectQueueNoStore({
          data: await service.readTrace(
            context.principal, context.scope, context.raw.queue, context.raw.messageId,
          ),
        });
      } catch (error) { return projectQueueRouteError(error); }
    },
  };
}

export const GET = (request: NextRequest, context: ProjectQueueRouteContext) =>
  createProjectQueueTraceHandlers(getProjectQueueService()).GET(request, context);
