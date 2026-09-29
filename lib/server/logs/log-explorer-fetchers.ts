import { ConfigurationError, isConnectionUnavailable } from "@/lib/server/db/errors";
import {
  logExplorerMoment,
  type LogExplorerEntry,
  type LogExplorerQuery,
} from "@/lib/console/log-explorer";
import {
  LogExplorerSourceFailure,
  type LogExplorerSourceFetcher,
} from "@/lib/server/logs/log-explorer-search";
import type { ComputeDefinitionService } from "@/lib/server/compute/definitions";
import type { ProjectAuthScope } from "@/lib/server/project-auth/model";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";
import type { ProjectStorageService } from "@/lib/server/project-storage/service";
import { RequestAuthorizationError } from "@/lib/server/request-context";

/**
 * Die drei Lesungen des Log-Explorers (2.65), an einer Stelle.
 *
 * Diese Datei ist aus einem Fehler entstanden, den ein zertifizierter Fall
 * nicht gesehen hat. Die Projektion und der getypte Filter je Quelle standen
 * in der Route; der Fall gegen die echte Datenbank baute sich **eigene**
 * Lesungen, weil er die Route ohne HTTP nicht betreten konnte. Damit belegte
 * er seine eigene Kopie: Der Filter `authStatus` war in der Route erfuellt, im
 * Fall aber gar nicht vorhanden, und beide sahen gruen aus.
 *
 * Darum steht die Lesung jetzt hier und nirgends sonst. Was eine Quelle
 * hergibt, wie ein Eintrag daraus aussieht und welcher Filter greift, ist
 * einmal formuliert. Die Route reicht ihre Tuer herein, der Fall reicht seine
 * herein -- was dahinter passiert, ist in beiden Faellen derselbe Code.
 *
 * Die **Tuer** bleibt bewusst draussen. Sie ist das einzige, was sich zwischen
 * Route und Fall wirklich unterscheidet: Die Route oeffnet sie aus der
 * Anfrage, mit der vollen Pruefung von Anmeldung und Rolle; ein Fall gegen die
 * Datenbank kennt seinen Scope schon. Eine Tuer, die hier eingebaut waere,
 * waere im Fall genau die Kopie, die dieses Modul abschafft.
 */

/** Wie eine Quelle geoeffnet wird. Wirft, wenn der Aufrufer nicht darf. */
export type LogExplorerDoor<T> = () => Promise<T>;

/**
 * Je Quelle genau die eine Lesung, die hier gebraucht wird.
 *
 * `Pick` statt des ganzen Dienstes: So steht in der Signatur, was diese Datei
 * anfasst, und ein Fall kann dieselbe Lesung einsetzen, ohne einen Dienst mit
 * zehn Abhaengigkeiten zu bauen, von denen keine eine Rolle spielt.
 */
export type ProjectAuthAuditReader = Pick<ProjectAuthService, "listAuditEvents">;
export type FunctionInvocationReader = Pick<ComputeDefinitionService, "readFunctionInvocationLog">;
export type FunctionOutputReader = Pick<ComputeDefinitionService, "readFunctionOutputLog">;
export type StorageObjectReader = Pick<ProjectStorageService, "readObjectLog">;

/**
 * Warum eine Quelle nicht geliefert hat.
 *
 * `RequestAuthorizationError` heisst hier „diese Anmeldung hat die Rolle
 * nicht", nicht „kaputt": Der Aufrufer soll sehen, dass die Quelle existiert
 * und ihm fehlt, statt zu raten, warum die Liste kuerzer ist.
 */
export function logExplorerSourceFailure(error: unknown): LogExplorerSourceFailure {
  if (error instanceof LogExplorerSourceFailure) return error;
  if (error instanceof RequestAuthorizationError) return new LogExplorerSourceFailure("forbidden");
  if (error instanceof ConfigurationError) return new LogExplorerSourceFailure("unavailable");
  if (isConnectionUnavailable(error)) return new LogExplorerSourceFailure("unavailable");
  return new LogExplorerSourceFailure("failed");
}

/** Die Audit-Kette der Projekt-Anmeldung, durch ihre eigene Tuer. */
export function authAuditFetcher(
  door: LogExplorerDoor<ProjectAuthScope>,
  service: ProjectAuthAuditReader,
  query: LogExplorerQuery,
): LogExplorerSourceFetcher {
  return async ({ cursor, limit }) => {
    try {
      const scope = await door();
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
    } catch (error) { throw logExplorerSourceFailure(error); }
  };
}

type ComputeDoor = LogExplorerDoor<{
  principal: Parameters<ComputeDefinitionService["readFunctionInvocationLog"]>[0];
  scope: Parameters<ComputeDefinitionService["readFunctionInvocationLog"]>[1];
}>;

/**
 * Das Aufrufprotokoll, durch seine eigene Tuer.
 *
 * Geblaettert wird ueber `offset`, weil die vorhandene Lesung genau das
 * anbietet. Der Cursor dieser Quelle ist deshalb schlicht der naechste
 * Versatz -- undurchsichtig fuer den Faecher, der ihn nur zurueckreicht.
 */
export function functionInvocationFetcher(
  door: ComputeDoor,
  service: FunctionInvocationReader,
  query: LogExplorerQuery,
): LogExplorerSourceFetcher {
  return async ({ cursor, limit }) => {
    try {
      const { principal, scope } = await door();
      const offset = cursor === null ? 0 : Number(cursor);
      const page = await service.readFunctionInvocationLog(principal, scope, {
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
    } catch (error) { throw logExplorerSourceFailure(error); }
  };
}

type OutputDoor = LogExplorerDoor<{
  principal: Parameters<ComputeDefinitionService["readFunctionOutputLog"]>[0];
  scope: Parameters<ComputeDefinitionService["readFunctionOutputLog"]>[1];
}>;

/**
 * Die Inhaltslogs (2.98), durch dieselbe Tuer wie das Aufrufprotokoll.
 *
 * Ein Eintrag je Aufruf, der etwas geschrieben hat; die Zeilen selbst bleiben
 * draussen, denn `detail` ist ein kurzer getypter Zusatz und keine Nutzlast.
 * Gemischt wird nach `recordedAt`, dem Zeitpunkt, an dem das Protokoll
 * geschrieben wurde: Das ist das Ereignis, das diese Quelle hergibt.
 */
export function functionOutputFetcher(
  door: OutputDoor,
  service: FunctionOutputReader,
  _query: LogExplorerQuery,
): LogExplorerSourceFetcher {
  return async ({ cursor, limit }) => {
    try {
      const { principal, scope } = await door();
      const offset = cursor === null ? 0 : Number(cursor);
      const page = await service.readFunctionOutputLog(principal, scope, { limit, offset });
      const entries = page.rows.map((row) => Object.freeze({
        source: "function_output" as const,
        id: row.invocationId,
        at: logExplorerMoment(row.recordedAt),
        action: "compute.function_output",
        subject: row.functionName,
        outcome: row.outcome === "completed" ? "ok" as const : "failed" as const,
        detail: `stdout ${row.stdoutLines} · stderr ${row.stderrLines} · ${row.byteCount} B` +
          (row.truncated ? " · truncated" : ""),
      }));
      return { entries, nextCursor: page.hasMore ? String(offset + limit) : null };
    } catch (error) { throw logExplorerSourceFailure(error); }
  };
}

type StorageDoor = LogExplorerDoor<{
  principal: Parameters<ProjectStorageService["readObjectLog"]>[0];
  scope: Parameters<ProjectStorageService["readObjectLog"]>[1];
}>;

/**
 * Der Stand der Speicherobjekte, durch seine eigene Tuer.
 *
 * Gemischt wird ueber `createdAt`. Das ist der einzige Zeitpunkt, den diese
 * Quelle als Ereignis hergibt: Wann ein Objekt geloescht oder zuletzt geprueft
 * wurde, steht als Zustand daneben, nicht als zweiter Eintrag -- und zwei
 * Eintraege aus einer Zeile zu machen hiesse, ein Protokoll zu erfinden.
 */
export function storageObjectFetcher(
  door: StorageDoor,
  service: StorageObjectReader,
  query: LogExplorerQuery,
): LogExplorerSourceFetcher {
  return async ({ cursor, limit }) => {
    try {
      const { principal, scope } = await door();
      const page = await service.readObjectLog(principal, scope, {
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
    } catch (error) { throw logExplorerSourceFailure(error); }
  };
}
