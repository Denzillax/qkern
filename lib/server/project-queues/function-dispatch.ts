import { ComputeDefinitionError } from "@/lib/server/compute/definitions";
import { ProjectQueueHandlerError } from "@/lib/server/project-queues/worker";
import type { FunctionInvocationService } from "@/lib/server/compute/function-invocation";
import type { ComputeDefinitionScope } from "@/lib/server/compute/definitions";
import type {
  ProjectQueueHandler, ProjectQueueHandlerMessage,
} from "@/lib/server/project-queues/worker";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";

/**
 * Der Handler, der eine Nachricht an eine hinterlegte Function gibt.
 *
 * `ProjectQueueWorker` war seit Alpha 1 ein Port ohne Wirt: gebaut, getestet und
 * von keinem Prozess je gestartet. Das ist der siebte Fall desselben Musters in
 * diesem Sprint — und der erste, den nicht Handarbeit gefunden hat, sondern der
 * Erreichbarkeitsvertrag aus `tests/entrypoint-reachability-contract.test.ts`.
 *
 * Ein allgemeiner Handler-Host bleibt offen. Dieser hier kann genau eines, und
 * das vollstaendig: eine Nachricht in einen Function-Aufruf uebersetzen. Beide
 * Seiten gibt es seit 1.23 beziehungsweise Alpha 1; es fehlte nur das Stueck
 * dazwischen.
 */
export class ProjectQueueFunctionDispatch implements ProjectQueueHandler {
  constructor(private readonly options: {
    functions: Pick<FunctionInvocationService, "invoke">;
    principal: ProjectQueuePrincipal;
    scope: ComputeDefinitionScope;
    functionName: string;
  }) {}

  async handle(message: ProjectQueueHandlerMessage, options: { signal: AbortSignal }) {
    // Der Aufruf selbst nimmt kein Signal: Der Container hat seinen eigenen
    // Timeout, und ein halb gestarteter Aufruf liesse sich von hier aus nicht
    // sauber zuruecknehmen. Abgebrochen wird deshalb davor — danach faellt die
    // Lease ab und die gefencte Wiederaufnahme uebernimmt.
    if (options.signal.aborted) throw new ProjectQueueHandlerError("DEPENDENCY_UNAVAILABLE");

    let result;
    try {
      result = await this.options.functions.invoke(
        this.options.principal, this.options.scope, this.options.functionName, message.payload,
      );
    } catch (cause) {
      throw new ProjectQueueHandlerError(failureFor(cause));
    }

    // 2xx heisst angenommen. Alles andere ist ein Fehlschlag des Handlers und
    // laeuft ueber Retry und Dead Letter — die Entscheidung darueber gehoert
    // der Queue, nicht diesem Handler.
    if (result.statusCode < 200 || result.statusCode > 299) {
      throw new ProjectQueueHandlerError("HANDLER_ERROR");
    }
  }
}

/**
 * Uebersetzt einen Compute-Fehler in einen Failure Code der Queue.
 *
 * Kapazitaet und eine fehlende Function sind beides Zustaende der Umgebung, die
 * sich ohne Zutun der Nachricht aendern koennen — deshalb
 * `DEPENDENCY_UNAVAILABLE` und damit ein Retry. Eine fehlkonfigurierte Bindung
 * landet dadurch irgendwann im Dead Letter, und das ist die richtige Stelle:
 * sichtbar, redigiert und ohne die Nachricht zu verlieren.
 *
 * Der `cause` wird nicht weitergereicht. Er koennte eine Datenbankmeldung
 * tragen, und die gehoert nicht in ein Queue-Log.
 */
function failureFor(cause: unknown) {
  if (cause instanceof ComputeDefinitionError) {
    if (cause.code === "COMPUTE_AT_CAPACITY" || cause.code === "COMPUTE_NOT_FOUND") {
      return "DEPENDENCY_UNAVAILABLE" as const;
    }
    if (cause.code === "COMPUTE_QUOTA_EXCEEDED") return "DEPENDENCY_UNAVAILABLE" as const;
    return "INVALID_PAYLOAD" as const;
  }
  return "HANDLER_ERROR" as const;
}
