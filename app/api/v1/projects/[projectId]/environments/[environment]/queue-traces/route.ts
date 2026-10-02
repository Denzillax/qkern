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
 * Die Suche nach einer Spur-Id (2.131) — **ohne Nutzlast**.
 *
 * Sie beantwortet die Frage, die seit 2.73.0 wirklich gestellt wird: Welche
 * Nachrichten gehoeren zu dieser Spur. Gelesen wurde bis hierher nur je
 * Nachricht, und wer die Spur-Id aus seinem Collector hatte, hatte damit nichts
 * in der Hand.
 *
 * ## Warum der Pfad `queue-traces` heisst und nicht `queues/traces`
 *
 * Unter `queues/` steht `[queue]`, und ein Queue-Name ist
 * `^[a-z][a-z0-9_-]{2,62}$` -- `traces` passt darauf. Heute faellt das nicht auf,
 * weil es kein `GET queues/{queue}` gibt und `queues/metrics` aus demselben Grund
 * durchgeht; sobald aber `queues/traces` Kinder bekaeme, verdeckten sie die einer
 * Queue namens `traces`. Eine Falle, die man nicht stellen muss, stellt man nicht.
 *
 * Und der Pfad sagt damit auch das Richtige: Eine Spur laeuft durch mehrere
 * Queues einer Umgebung und gehoert keiner.
 *
 * ## Die Grenze, und wo sie steht
 *
 * Eine Antwort laeuft nie ueber Umgebungen oder Organisationen hinaus, und das
 * traegt kein Filter in der Anfrage: `traceId` ist das einzige, was ein Aufrufer
 * zur Auswahl beitraegt. Projekt und Umgebung kommen aus dem Pfad, die
 * Organisation aus der Sitzung, und darunter liegt die Zeilensicherheit aus 0081.
 *
 * Admin und nicht Projekt-Key, anders als bei `own-trace`: Eine Suche nennt
 * Nachrichten verschiedener Besitzer, und eine Spur-Id kennt jeder Dienst auf
 * ihrem Weg. Die Begruendung steht an `searchTraces` in `service.ts`.
 *
 * Kein CORS: wie jede Admin-Route der Queues.
 */
export function createProjectQueueTraceSearchHandlers(service: ProjectQueueService) {
  return {
    GET: async (request: NextRequest, routeContext: ProjectQueueRouteContext) => {
      try {
        const context = await adminProjectQueueContext(request, routeContext);
        const url = new URL(request.url);
        const traceId = url.searchParams.get("traceId");
        if (traceId === null) return projectQueueNoStore({ error: "Invalid queue request" }, 400);
        const rawLimit = url.searchParams.get("limit");
        // Ein `limit`, das keine Zahl ist, ist eine ungueltige Anfrage und nicht
        // die Vorgabe: Wer `limit=viele` schickt, bekommt sonst fuenfzig Zeilen
        // und glaubt, er habe bestimmt, wie viele.
        if (rawLimit !== null && !/^[0-9]{1,3}$/.test(rawLimit)) {
          return projectQueueNoStore({ error: "Invalid queue request" }, 400);
        }
        return projectQueueNoStore({
          data: await service.searchTraces(context.principal, context.scope, {
            traceId,
            limit: rawLimit === null ? undefined : Number(rawLimit),
            cursor: url.searchParams.get("cursor") ?? undefined,
          }),
        });
      } catch (error) { return projectQueueRouteError(error); }
    },
  };
}

export const GET = (request: NextRequest, context: ProjectQueueRouteContext) =>
  createProjectQueueTraceSearchHandlers(getProjectQueueService()).GET(request, context);
