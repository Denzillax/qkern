import { NextRequest } from "next/server";
import {
  applicationProjectQueueContext,
  projectQueueNoStore,
  projectQueueOriginAllowed,
  projectQueuePreflight,
  projectQueueRouteError,
  withProjectQueueCors,
  type ProjectQueueRouteContext,
} from "@/lib/server/project-queues/http";
import { getProjectQueueService } from "@/lib/server/project-queues/runtime";
import type { ProjectQueueService } from "@/lib/server/project-queues/service";

/**
 * Die Spur der **eigenen** Nachricht, fuer die Anwendung (2.131).
 *
 * ## Warum eine zweite Tuer und nicht dieselbe
 *
 * `.../trace` ist die Betreiberansicht: Sie verlangt eine Sitzung mit
 * `project_queues_admin` und sie nennt den Wirt. Diese hier verlangt einen
 * Projekt-Key und nennt ihn nicht. Beides auf einen Pfad zu legen waere der
 * kuerzere Weg und der gefaehrlichere: Eine Route, die ihre Antwortform am
 * vorgelegten Zugangsdatum entscheidet, hat zwei Vertraege, und beim naechsten
 * Feld entscheidet sich jemand fuer den falschen. Zwei Pfade, zwei Formen, zwei
 * Beschreibungen in OpenAPI.
 *
 * ## Wer hier etwas bekommt
 *
 * Der Service-Key sieht jede Nachricht dieses Scopes; mit demselben Key holt er
 * sie samt Nutzlast ab. Ein angemeldeter Endnutzer sieht nur, was sein eigenes
 * `owner_subject` traegt, also die Nachricht, die er selbst eingereiht hat: Die
 * Id aus der Quittung ist die halbe Bedingung, der Token die andere. Ein
 * anonymer Aufrufer bekommt nichts, weil er nichts einreihen kann. Die ganze
 * Begruendung steht an `readMessageTrace` in `service.ts`.
 *
 * ## CORS, anders als an der Admin-Tuer
 *
 * Diese Route hat eine Vorabanfrage, und zwar aus demselben Grund, aus dem das
 * Einreihen eine hat: Hier ruft eine Anwendung, und eine Anwendung ist oft ein
 * Browser. Wer eingereiht hat und dort die Quittung hat, soll von derselben
 * Stelle nachsehen koennen, wie es weiterging. Die Admin-Routen haben keine, und
 * das bleibt so.
 */
export function createProjectQueueOwnTraceHandlers(service: ProjectQueueService) {
  return {
    GET: async (request: NextRequest, routeContext: ProjectQueueRouteContext) => {
      if (!projectQueueOriginAllowed(request)) return projectQueueNoStore({ error: "Origin is not allowed" }, 403);
      try {
        const context = await applicationProjectQueueContext(request, routeContext);
        if (!context.raw.queue || !context.raw.messageId) {
          return projectQueueNoStore({ error: "Invalid queue request" }, 400);
        }
        return withProjectQueueCors(request, projectQueueNoStore({
          data: await service.readMessageTrace(
            context.principal, context.scope, context.raw.queue, context.raw.messageId,
          ),
        }));
      } catch (error) { return projectQueueRouteError(error, request); }
    },
  };
}

export const GET = (request: NextRequest, context: ProjectQueueRouteContext) =>
  createProjectQueueOwnTraceHandlers(getProjectQueueService()).GET(request, context);
export const OPTIONS = (request: NextRequest) => projectQueuePreflight(request, "GET, OPTIONS");
