import { NextRequest, NextResponse } from "next/server";
import { isConnectionUnavailable } from "@/lib/server/db/errors";
import {
  LOG_EXPLORER_OUT_OF_REACH,
  LOG_EXPLORER_SOURCE_DEFINITIONS,
  LogExplorerError,
  parseLogExplorerQuery,
  type LogExplorerQuery,
  type LogExplorerSourceId,
} from "@/lib/console/log-explorer";
import {
  searchLogSources,
  type LogExplorerSourceFetcher,
} from "@/lib/server/logs/log-explorer-search";
import {
  authAuditFetcher,
  functionInvocationFetcher,
  storageObjectFetcher,
} from "@/lib/server/logs/log-explorer-fetchers";
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

      // Je Quelle eine Tuer, und nur die Tuer steht hier. Was dahinter
      // gelesen und gefiltert wird, steht in `log-explorer-fetchers` -- an
      // derselben Stelle, die der Fall gegen die echte Datenbank benutzt.
      const fetchers: Partial<Record<LogExplorerSourceId, LogExplorerSourceFetcher>> = {
        auth_audit: authAuditFetcher(
          async () => (await adminProjectAuthScope(request, routeContext)).scope,
          services.auth, query),
        function_invocations: functionInvocationFetcher(
          async () => await adminComputeContext(request, routeContext),
          services.compute, query),
        storage_objects: storageObjectFetcher(
          async () => await adminProjectStorageContext(request, routeContext),
          services.storage, query),
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
