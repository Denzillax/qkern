import { randomUUID } from "node:crypto";
import {
  ComputeDefinitionError,
  type ComputeDefinitionRepository,
  type ComputeDefinitionScope,
  type FunctionDefinitionRecord,
} from "@/lib/server/compute/definitions";
import { FunctionInvocationError, type FunctionInvoker } from "@/lib/server/compute/functions";
import { FunctionOutputCollector } from "@/lib/server/compute/function-output";
import type { FunctionInvocationResult } from "@/lib/server/compute/model";
import type { ProjectQueueJson, ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import { DisabledUsageEmitter, type UsageEmitterPort } from "@/lib/server/usage/emitter";
import type { FunctionConcurrencyPort, FunctionSlot } from "@/lib/server/compute/function-concurrency";

const NAME = /^[a-z][a-z0-9_-]{2,62}$/;
/** Zuschlag auf den Timeout, damit ein Platz nie vor seinem Container abläuft. */
const SLOT_MARGIN_MS = 30_000;

export type FunctionInvocationServiceOptions = {
  repository: Pick<ComputeDefinitionRepository, "findFunctionByName">;
  invoker: Pick<FunctionInvoker, "invoke">;
  /** Ohne Emitter zählt nichts — und nichts ändert sich am Verhalten. */
  usage?: UsageEmitterPort;
  /**
   * Teilt die Nebenläufigkeitsgrenze über Prozesse hinweg.
   *
   * Ohne ihn bleibt es bei der prozesslokalen Zählung: Die Grenze schützt dann
   * diesen Host, nicht den Tenant.
   */
  concurrency?: FunctionConcurrencyPort;
  /**
   * Das Aufrufprotokoll (1.89). Ohne Port wird nichts protokolliert — und
   * nichts aendert sich am Verhalten des Aufrufs.
   *
   * Seit 2.98 kann der Port auch die Inhaltslogs aufnehmen. Dann sammelt der
   * Dienst je Aufruf, was der Container auf stdout und stderr geschrieben
   * hat, unter den Grenzen aus `function-output.ts`, und schreibt es nach
   * der Zeile des Aufrufprotokolls. Ohne `recordFunctionInvocationOutput`
   * wird die Ausgabe wie bis 2.97 verworfen.
   */
  invocationLog?: Pick<ComputeDefinitionRepository, "recordFunctionInvocation"> &
    Partial<Pick<ComputeDefinitionRepository, "recordFunctionInvocationOutput">>;
  /** Ein Protokollfehler stuerzt den Aufruf nicht; er wird hierher gemeldet. */
  onLogFailure?: (error: unknown) => void;
  now?: () => Date;
  id?: () => string;
  /** Wird beim Abweisen wegen Überlast gerufen. Erhält nur den Namen. */
  onRejected?: (name: string) => void;
};

/**
 * Löst eine Function auf und führt sie aus.
 *
 * Bis Release 1.22 gab es die Sandbox, aber keinen Weg zu ihr: Sie war eine
 * Bibliothek, die niemand aufruft. Genau dieses Muster hat der Sprint schon
 * dreimal gefunden.
 *
 * **Die Definition wird bei jedem Aufruf frisch gelesen.** Ein zwischengespei-
 * chertes Bild würde nach einem Abschalten weiterlaufen, und ein Betreiber, der
 * eine Function stoppt, will sie gestoppt haben.
 *
 * Aufrufen darf ein Service-Projektschlüssel oder ein Administrator. **Kein
 * anonymer und kein Endnutzer-Aufruf**: Eine Function läuft mit der Autorität
 * des Projekts, nicht mit der ihres Aufrufers, und eine Policy je Function, die
 * das sicher unterscheiden könnte, gibt es noch nicht.
 */
export class FunctionInvocationService {
  private readonly now: () => Date;
  private readonly id: () => string;
  /**
   * Laufende Aufrufe je Function.
   *
   * **Prozesslokal.** Zwei Web-Instanzen zählen getrennt, die tatsächliche
   * Obergrenze ist also `maxConcurrency × Instanzen`. Eine clusterweite Grenze
   * bräuchte einen gemeinsamen Zähler mit eigener Ausfallsemantik; das wäre eine
   * größere Entscheidung als dieser Schnitt trägt. Was diese Grenze schon hier
   * verhindert, ist der Fall, der ohne sie unvermeidlich ist: ein Aufrufer, der
   * beliebig viele Container gleichzeitig startet, bis der Host steht.
   */
  private readonly running = new Map<string, number>();

  private readonly usage: UsageEmitterPort;

  constructor(private readonly options: FunctionInvocationServiceOptions) {
    this.usage = options.usage ?? new DisabledUsageEmitter();
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? (() => randomUUID());
  }

  /** Laufende Aufrufe einer Function. Nur für Beobachtung. */
  concurrency(functionId: string): number {
    return this.running.get(functionId) ?? 0;
  }

  async invoke(
    principal: ProjectQueuePrincipal,
    scope: ComputeDefinitionScope,
    name: string,
    payload: ProjectQueueJson,
  ): Promise<FunctionInvocationResult> {
    if (!["service_role", "admin"].includes(principal.role) ||
        principal.organizationId !== scope.organizationId) {
      throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    }
    if (!NAME.test(name)) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");

    const record = await this.options.repository.findFunctionByName(principal, scope, name);
    if (!record) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");

    const active = this.running.get(record.id) ?? 0;
    if (active >= record.maxConcurrency) {
      this.options.onRejected?.(record.name);
      throw new ComputeDefinitionError("COMPUTE_AT_CAPACITY");
    }
    const invocationId = this.id();
    // Gezählt wird der Aufruf, nicht sein Ergebnis. Wer erst nach dem Erfolg
    // zählt, kann nicht mehr ablehnen — und ein Aufruf, der scheitert, hat
    // trotzdem einen Container gestartet.
    //
    // Die Kapazitätsgrenze kommt zuerst: Ein abgewiesener Aufruf, der nie
    // gelaufen ist, soll auch kein Kontingent verbrauchen.
    const admission = await this.usage.admit(scope, {
      metric: "function_invocations", reference: invocationId,
    });
    if (!admission.admitted) throw new ComputeDefinitionError("COMPUTE_QUOTA_EXCEEDED");

    this.running.set(record.id, active + 1);

    // Die prozesslokale Zaehlung schuetzt **diesen Host** vor einem Aufrufer,
    // der beliebig viele Container startet. Sie ersetzt die geteilte Grenze
    // nicht: Zwei Instanzen zaehlen getrennt, und `maxConcurrency × Instanzen`
    // ist keine Grenze, sondern ein Vielfaches davon.
    //
    // Die Lease ist laenger als der Timeout. Ein Platz, der vor seinem
    // Container ablaeuft, liesse die Grenze stillschweigend ueberschreiten.
    let slot: FunctionSlot | null = null;
    if (this.options.concurrency) {
      try {
        slot = await this.options.concurrency.claim(
          scope, record.id, record.maxConcurrency, record.timeoutMs + SLOT_MARGIN_MS,
        );
      } catch {
        // Eine nicht erreichbare Control Plane darf keinen Aufruf durchlassen,
        // den die Grenze verboten haette. Hier wird geschlossen gescheitert:
        // Anders als bei einer kaufmaennischen Quota schuetzt diese Grenze den
        // Host vor Ueberlast.
        this.releaseLocal(record.id);
        throw new ComputeDefinitionError("COMPUTE_AT_CAPACITY");
      }
      if (!slot) {
        this.releaseLocal(record.id);
        this.options.onRejected?.(record.name);
        throw new ComputeDefinitionError("COMPUTE_AT_CAPACITY");
      }
    }

    const startedAt = this.now();
    let outcome: { statusCode: number } | { errorCode: string } | null = null;
    // Die Inhaltslogs (2.98): gesammelt wird nur, wenn jemand sie aufhebt.
    // Sonst bleibt es beim Verwerfen, und der Sink kostet nichts.
    const output = this.options.invocationLog?.recordFunctionInvocationOutput
      ? new FunctionOutputCollector(this.now) : undefined;
    try {
      const result = await this.options.invoker.invoke(toDefinition(record), Object.freeze({
        id: invocationId,
        functionId: record.id,
        payload,
        requestedAt: startedAt.toISOString(),
      }), undefined, output);
      outcome = { statusCode: result.statusCode };
      return result;
    } catch (error) {
      // Nur der feste Code wandert ins Protokoll — nie die Meldung. Eine
      // Sandbox- oder Datenbankmeldung an dieser Stelle waere ein Leck.
      outcome = { errorCode: error instanceof FunctionInvocationError ? error.code : "FUNCTION_SANDBOX_FAILED" };
      throw error;
    } finally {
      // Das Aufrufprotokoll (1.89): auch ein gescheiterter Aufruf hat
      // stattgefunden und gehoert ins Protokoll — die Mutationsprobe dieses
      // Releases protokolliert nur noch Erfolge. Ein Protokollfehler stuerzt
      // den Aufruf nicht: Der Container ist gelaufen, seine Wirkung ist da.
      if (outcome && this.options.invocationLog) {
        const log = this.options.invocationLog;
        await log.recordFunctionInvocation(principal, scope, record.id, Object.freeze({
          invocationId,
          invokedBy: principal.actorRef,
          startedAt: startedAt.toISOString(),
          durationMs: Math.max(0, this.now().getTime() - startedAt.getTime()),
          outcome: "statusCode" in outcome ? "completed" as const : "failed" as const,
          statusCode: "statusCode" in outcome ? outcome.statusCode : null,
          errorCode: "errorCode" in outcome ? outcome.errorCode : null,
        })).then(async () => {
          // Die Inhaltslogs erst nach der Zeile des Aufrufs: Migration 0069
          // bindet sie per Fremdschluessel daran. Auch ein gescheiterter oder
          // abgebrochener Aufruf behaelt, was er bis dahin geschrieben hat;
          // gerade dort ist die Ausgabe der einzige Hinweis auf das Warum.
          // Ohne eine einzige Zeile wird keine Protokollzeile geschrieben.
          if (output && log.recordFunctionInvocationOutput && !output.isEmpty()) {
            await log.recordFunctionInvocationOutput(principal, scope, record.id, invocationId,
              output.snapshot());
          }
        }).catch((error: unknown) => this.options.onLogFailure?.(error));
      }
      // Beide Zaehlungen muessen auch nach einem Timeout oder einem Absturz der
      // Sandbox fallen. Sonst waere die Function nach ein paar Fehlschlaegen
      // dauerhaft "voll" — und genau das faellt erst im Betrieb auf.
      this.releaseLocal(record.id);
      await slot?.release();
    }
  }

  private releaseLocal(functionId: string): void {
    const remaining = (this.running.get(functionId) ?? 1) - 1;
    if (remaining <= 0) this.running.delete(functionId);
    else this.running.set(functionId, remaining);
  }
}

function toDefinition(record: FunctionDefinitionRecord) {
  return Object.freeze({
    organizationId: record.organizationId,
    projectId: record.projectId,
    environment: record.environment,
    id: record.id,
    name: record.name,
    runtime: record.runtime,
    image: record.image,
    entrypoint: record.entrypoint,
    timeoutMs: record.timeoutMs,
    memoryMiB: record.memoryMiB,
    maxConcurrency: record.maxConcurrency,
    egressOrigins: Object.freeze([...record.egressOrigins]),
    secretRefs: Object.freeze([...record.secretRefs]),
  });
}

/** Auf einen HTTP-Status abbildbarer Fehlercode ohne Innenansicht. */
export function functionInvocationStatus(error: unknown): number {
  if (error instanceof ComputeDefinitionError) {
    return ["COMPUTE_AT_CAPACITY", "COMPUTE_QUOTA_EXCEEDED"].includes(error.code) ? 429 : 404;
  }
  if (error instanceof FunctionInvocationError) {
    switch (error.code) {
      case "FUNCTION_INVALID": return 422;
      case "FUNCTION_TIMEOUT": return 504;
      case "FUNCTION_SANDBOX_FAILED": return 502;
    }
  }
  return 500;
}
