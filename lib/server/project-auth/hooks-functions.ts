import type { FunctionInvocationService } from "@/lib/server/compute/function-invocation";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import type { Environment } from "@/lib/types";
import type {
  ProjectAuthHookAnswer,
  ProjectAuthHookCall,
  ProjectAuthHookPort,
} from "@/lib/server/project-auth/hooks";

/**
 * Der Weg von einem Auth-Hook (2.77) zu einer hinterlegten Function.
 *
 * **Es gibt keinen neuen Aufrufweg.** Dieser Adapter ruft den vorhandenen
 * `FunctionInvocationService`, und das ist der Punkt: Dort haengen die
 * Kapazitaetsgrenze je Function, das monatliche Kontingent, das Aufrufprotokoll
 * (1.89) und die Egress-Grenzen der Definition. Ein zweiter Aufrufweg haette
 * all das umgehen muessen, um kuerzer zu sein, und ein Container, der an der
 * Kapazitaetsgrenze vorbei startet, ist genau der Fall, gegen den die Grenze
 * da ist.
 *
 * **Mit welcher Autoritaet.** Mit `service_role` und dem Aktor
 * `project_auth_hook:<punkt>`. Nicht mit der des Nutzers, der sich gerade
 * anmeldet: Der ist in diesem Moment noch niemand, er hat keine Sitzung und
 * kein Token, und ein Aufruf in seinem Namen waere eine Autoritaet, die es
 * nicht gibt. Nicht mit der eines Console-Administrators: Der sitzt bei einer
 * Anmeldung um drei Uhr morgens nicht davor. Im Aufrufprotokoll steht damit
 * ablesbar, dass dieser Aufruf von der Anmeldung kam und von welchem Punkt.
 *
 * **Die Frist.** Sie steht in der Definition des Hooks und wird hier
 * durchgesetzt, mit einem Wettlauf gegen einen Zeitgeber. Was das **nicht**
 * kann, und die Seite sagt es woertlich: Der Container wird dadurch nicht
 * angehalten. Er laeuft bis zu seinem eigenen `timeoutMs` weiter und darf in
 * dieser Zeit noch wirken. Aufgehoert wird hier mit dem **Warten**, nicht mit
 * dem Aufruf. Wer will, dass ein Hook nach 300 Millisekunden wirklich stirbt,
 * setzt den Timeout der Function selbst so.
 *
 * Darum ist die Reihenfolge auch so, wie sie ist: Die Frist des Hooks sollte
 * nicht groesser sein als der Timeout der Function. Ist sie es, wartet die
 * Anmeldung laenger als der Container ueberhaupt leben darf, und das Warten ist
 * sinnlos. Erzwungen wird das hier nicht, weil die beiden Werte an zwei Orten
 * gepflegt werden und eine stille Kuerzung des einen durch den anderen eine
 * Einstellung waere, die nicht gilt. Die Console zeigt beide Zahlen
 * nebeneinander.
 */
/** Was dieser Adapter zum Aufrufen braucht. Mehr nimmt er nicht an. */
export type ProjectAuthHookInvoker = Pick<FunctionInvocationService, "invoke">;

export class ProjectAuthFunctionHooks implements ProjectAuthHookPort {
  private resolved: ProjectAuthHookInvoker | undefined;

  constructor(private readonly options: {
    /**
     * Der Aufrufdienst, fertig oder als Lader.
     *
     * Die zweite Form ist kein Komfort, sondern eine Grenze im Modulgraphen.
     * Der Auth-Weg wird in fast jeder Route geladen; der Aufrufdienst zieht die
     * ganze Compute-Seite mit, samt Registry- und Sandbox-Anschluss. Als
     * statischer Import hing das an jedem Modul, das Project Auth anfasst, und
     * zwar auch dort, wo keine Zeile davon je laeuft: Ohne
     * `QKERN_FUNCTIONS_ENABLED` wird gar kein Hook eingerichtet. Der Lader wird
     * beim ersten Aufruf ausgefuehrt und sein Ergebnis behalten.
     */
    functions: ProjectAuthHookInvoker | (() => Promise<ProjectAuthHookInvoker>);
    /** Ein Frist-Ueberschreiten wird hierher gemeldet, nie an den Aufrufer. */
    onFailure?: (input: { point: string; error: string }) => void;
  }) {}

  private async invoker(): Promise<ProjectAuthHookInvoker> {
    if (this.resolved) return this.resolved;
    const given = this.options.functions;
    this.resolved = typeof given === "function" ? await given() : given;
    return this.resolved;
  }

  async call(input: ProjectAuthHookCall): Promise<ProjectAuthHookAnswer> {
    const principal: ProjectQueuePrincipal = {
      organizationId: input.organizationId,
      actorRef: `project_auth_hook:${input.point}`,
      role: "service_role",
      subject: "project_auth",
    };
    const scope = {
      organizationId: input.organizationId,
      projectId: input.projectId,
      environment: input.environment as Environment,
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Der Wettlauf. `expired` ist ein eigenes Objekt und keine geworfene
      // Ausnahme, damit eine Frist nicht wie ein Sandbox-Fehler aussieht: Die
      // Console soll "hat nicht rechtzeitig geantwortet" von "ist gescheitert"
      // unterscheiden koennen.
      const expired = Symbol("timeout");
      const answer = await Promise.race([
        (await this.invoker()).invoke(principal, scope, input.functionName, input.payload),
        new Promise<typeof expired>((resolve) => {
          timer = setTimeout(() => resolve(expired), input.timeoutMs);
        }),
      ]);
      if (answer === expired) {
        this.options.onFailure?.({ point: input.point, error: "timeout" });
        return { answered: false, error: "timeout" };
      }
      return { answered: true, statusCode: answer.statusCode, body: answer.body };
    } catch (error) {
      // Nur die Fehlerklasse verlaesst diesen Block. Ein `ComputeDefinitionError`
      // traegt einen festen Code (etwa `COMPUTE_NOT_FOUND`, wenn die Function
      // gar nicht mehr da ist), und mehr braucht die Entscheidung nicht. Eine
      // Sandbox- oder Datenbankmeldung waere ein Leck.
      const carried = error instanceof Error ? (error as Error & { code?: unknown }).code : undefined;
      const code = typeof carried === "string" ? carried
        : error instanceof Error ? error.name : "unknown";
      this.options.onFailure?.({ point: input.point, error: code });
      return { answered: false, error: code };
    } finally {
      // Ohne das haelt der Zeitgeber den Prozess bis zum Ablauf der Frist
      // wach, auch wenn die Antwort schon da ist.
      if (timer) clearTimeout(timer);
    }
  }
}
