import { NextRequest, NextResponse } from "next/server";
import { isConnectionUnavailable, ConfigurationError } from "@/lib/server/db/errors";
import {
  LOG_EXPLORER_OUT_OF_REACH,
  LOG_EXPLORER_SOURCE_DEFINITIONS,
  LogExplorerError,
  logExplorerMoment,
  parseLogExplorerQuery,
  type LogExplorerEntry,
  type LogExplorerQuery,
  type LogExplorerSourceId,
} from "@/lib/console/log-explorer";
import {
  LogExplorerSourceFailure,
  searchLogSources,
  type LogExplorerSourceFetcher,
} from "@/lib/server/logs/log-explorer-search";
import { adminProjectAuthScope } from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";
import { adminComputeContext } from "@/lib/server/compute/definitions-http";
import { getComputeDefinitionService } from "@/lib/server/compute/definitions-runtime";
import type { ComputeDefinitionService } from "@/lib/server/compute/definitions";
import { adminProjectStorageContext } from "@/lib/server/project-storage/http";
import { getProjectStorageService } from "@/lib/server/project-storage/runtime";
import type { ProjectStorageService } from "@/lib/server/project-storage/service";
import {
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
} from "@/lib/server/request-context";

/**
 * Der Log-Explorer (2.65), seit `2.55.0`.
 *
 * Eine Route, ein GET, kein Schreibverb — und **keine** Abfrage, die hier
 * formuliert waere. Je Quelle geht die Suche durch genau die Tuer und genau
 * den Dienst, die die Console fuer diese Quelle schon benutzt:
 *
 * * `auth_audit` → `adminProjectAuthScope` + `listAuditEvents` (`project_auth_admin`)
 * * `function_invocations` → `adminComputeContext` + `readFunctionInvocationLog` (`project_compute_admin`)
 * * `storage_objects` → `adminProjectStorageContext` + `readObjectLog` (`project_storage_admin`)
 *
 * Daraus folgt die wichtigste Eigenschaft dieser Route: Sie **kann** nichts
 * herausgeben, was der Aufrufer nicht schon einzeln lesen duerfte. Die drei
 * Tueren werden einzeln betreten und einzeln abgerechnet; wer an einer nicht
 * vorbeikommt, bekommt die uebrigen. Eine eigene Verbindung zur Control Plane
 * haelt diese Datei nicht, und einen Weg fuer freies SQL gibt es hier nicht —
 * der Grund steht in `lib/console/log-explorer`.
 *
 * Jeder unbekannte Parameter, jede zweite Angabe desselben Parameters und
 * jeder Filter ohne seine Quelle sind ein 400, und zwar **vor** jedem
 * Dienstaufruf.
 */
type RouteContext = { params: Promise<{ projectId: string; environment: string }> };

function noStore(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status, headers: { "Cache-Control": "private, no-store", Pragma: "no-cache" },
  });
}

/**
 * Warum eine Quelle nicht geliefert hat.
 *
 * `RequestAuthorizationError` heisst hier „diese Anmeldung hat die Rolle
 * nicht", nicht „kaputt": Der Aufrufer soll sehen, dass die Quelle existiert
 * und ihm fehlt, statt zu raten, warum die Liste kuerzer ist.
 */
function sourceFailure(error: unknown): LogExplorerSourceFailure {
  if (error instanceof RequestAuthorizationError) return new LogExplorerSourceFailure("forbidden");
  if (error instanceof ConfigurationError) return new LogExplorerSourceFailure("unavailable");
  if (isConnectionUnavailable(error)) return new LogExplorerSourceFailure("unavailable");
  return new LogExplorerSourceFailure("failed");
}

/** Die Audit-Kette der Projekt-Anmeldung, durch ihre eigene Tuer. */
function authFetcher(
  request: NextRequest, routeContext: RouteContext, query: LogExplorerQuery,
  service: ProjectAuthService,
): LogExplorerSourceFetcher {
  return async ({ cursor, limit }) => {
    try {
      const { scope } = await adminProjectAuthScope(request, routeContext);
      const page = await service.listAuditEvents(scope, limit, cursor ?? undefined);
      const entries: LogExplorerEntry[] = [];
      for (const event of page.events) {
        if (query.filters.authStatus && event.status !== query.filters.authStatus) continue;
        if (query.filters.authActor && event.actorType !== query.filters.authActor) continue;
        entries.push(Object.freeze({
          source: "auth_audit" as const,
          id: event.id,
          at: logExplorerMoment(event.createdAt),
          action: event.action,
          subject: event.resourceRef,
          outcome: event.status === "succeeded" ? "ok" as const : "failed" as const,
          detail: event.actorType,
        }));
      }
      return { entries, nextCursor: page.nextCursor };
    } catch (error) { throw sourceFailure(error); }
  };
}

/**
 * Das Aufrufprotokoll, durch seine eigene Tuer.
 *
 * Geblaettert wird ueber `offset`, weil die vorhandene Lesung genau das
 * anbietet. Der Cursor dieser Quelle ist deshalb schlicht der naechste
 * Versatz — undurchsichtig fuer den Faecher, der ihn nur zurueckreicht.
 */
function invocationFetcher(
  request: NextRequest, routeContext: RouteContext, query: LogExplorerQuery,
  service: ComputeDefinitionService,
): LogExplorerSourceFetcher {
  return async ({ cursor, limit }) => {
    try {
      const context = await adminComputeContext(request, routeContext);
      const offset = cursor === null ? 0 : Number(cursor);
      const page = await service.readFunctionInvocationLog(context.principal, context.scope, {
        outcome: query.filters.outcome ?? null, limit, offset,
      });
      const entries = page.rows.map((row) => Object.freeze({
        source: "function_invocations" as const,
        id: row.invocationId,
        at: logExplorerMoment(row.startedAt),
        action: "compute.function_invocation",
        subject: row.functionName,
        outcome: row.outcome === "completed" ? "ok" as const : "failed" as const,
        detail: `${row.durationMs} ms · ${row.statusCode ?? row.errorCode ?? "–"}`,
      }));
      return { entries, nextCursor: page.hasMore ? String(offset + limit) : null };
    } catch (error) { throw sourceFailure(error); }
  };
}

/**
 * Der Stand der Speicherobjekte, durch seine eigene Tuer.
 *
 * Gemischt wird ueber `createdAt`. Das ist der einzige Zeitpunkt, den diese
 * Quelle als Ereignis hergibt: Wann ein Objekt geloescht oder zuletzt geprueft
 * wurde, steht als Zustand daneben, nicht als zweiter Eintrag — und zwei
 * Eintraege aus einer Zeile zu machen hiesse, ein Protokoll zu erfinden.
 */
function storageFetcher(
  request: NextRequest, routeContext: RouteContext, query: LogExplorerQuery,
  service: ProjectStorageService,
): LogExplorerSourceFetcher {
  return async ({ cursor, limit }) => {
    try {
      const context = await adminProjectStorageContext(request, routeContext);
      const page = await service.readObjectLog(context.principal, context.scope, {
        status: query.filters.objectStatus,
        cursor: cursor ?? undefined,
        limit,
      });
      const entries = page.entries.map((object) => Object.freeze({
        source: "storage_objects" as const,
        id: object.id,
        at: logExplorerMoment(object.createdAt),
        action: "storage.object_state",
        subject: `${object.bucketName}/${object.key}`,
        outcome: object.status === "clean"
          ? "ok" as const
          : object.status === "infected" ? "failed" as const : "pending" as const,
        detail: `${object.sizeBytes} B · ${object.contentType}`,
      }));
      return { entries, nextCursor: page.nextCursor };
    } catch (error) { throw sourceFailure(error); }
  };
}

export function createLogExplorerHandlers(services: {
  auth: ProjectAuthService; compute: ComputeDefinitionService; storage: ProjectStorageService;
}) {
  return {
    GET: async (request: NextRequest, routeContext: RouteContext) => {
      const parameters = request.nextUrl.searchParams;
      const keys = [...parameters.keys()];
      if (new Set(keys).size !== keys.length) {
        return noStore({ error: "Invalid log search", code: "UNKNOWN_PARAMETER" }, 400);
      }
      let query: LogExplorerQuery;
      try {
        query = parseLogExplorerQuery(Object.fromEntries(parameters.entries()));
      } catch (error) {
        if (error instanceof LogExplorerError) {
          return noStore({ error: "Invalid log search", code: error.code, reason: error.reason }, 400);
        }
        return noStore({ error: "Invalid log search", code: "UNKNOWN_PARAMETER" }, 400);
      }

      try {
        // Angemeldet sein muss der Aufrufer einmal fuer die ganze Anfrage; was
        // er je Quelle **darf**, entscheidet weiterhin jede Quelle selbst.
        await authenticatedContext(request);
      } catch (error) {
        if (error instanceof RequestAuthenticationError) {
          return noStore({ error: "Authentication required" }, 401);
        }
        if (isConnectionUnavailable(error)) {
          return noStore({ error: "Log search unavailable" }, 503);
        }
        return noStore({ error: "Log search unavailable" }, 500);
      }

      const fetchers: Partial<Record<LogExplorerSourceId, LogExplorerSourceFetcher>> = {
        auth_audit: authFetcher(request, routeContext, query, services.auth),
        function_invocations: invocationFetcher(request, routeContext, query, services.compute),
        storage_objects: storageFetcher(request, routeContext, query, services.storage),
      };
      const result = await searchLogSources(fetchers, query);
      return noStore({
        data: {
          entries: result.entries,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
          sources: result.sources.map((report) => ({
            ...report,
            route: LOG_EXPLORER_SOURCE_DEFINITIONS[report.id].route,
            capability: LOG_EXPLORER_SOURCE_DEFINITIONS[report.id].capability,
          })),
          // Die Antwort sagt selbst, was sie nicht erreicht. Ein Aufrufer, der
          // nur die Route benutzt, soll dieselbe Auskunft bekommen wie einer,
          // der die Seite sieht.
          outOfReach: LOG_EXPLORER_OUT_OF_REACH,
          query: {
            sources: query.sources, from: query.from, to: query.to,
            limit: query.limit, before: query.before, filters: query.filters,
          },
        },
      });
    },
  };
}

export const GET = (request: NextRequest, routeContext: RouteContext) =>
  createLogExplorerHandlers({
    auth: getProjectAuthService(),
    compute: getComputeDefinitionService(),
    storage: getProjectStorageService(),
  }).GET(request, routeContext);
