import { ProjectQueueWorker } from "@/lib/server/project-queues/worker";
import { ProjectQueueWorkerRuntime } from "@/lib/server/project-queues/worker-runtime";
import type { ProjectQueueHandler } from "@/lib/server/project-queues/worker";
import type { RuntimeProbeObserver } from "@/lib/server/operations/runtime-probe";
import type { ProjectQueueService } from "@/lib/server/project-queues/service";
import type { ProjectQueuePrincipal, ProjectQueueScope } from "@/lib/server/project-queues/model";

/**
 * Eine Bindung: diese Queue wird von dieser Function verarbeitet.
 *
 * Welche Bindungen ein Prozess bedient, steht ausdruecklich in der Umgebung —
 * wie bei `QKERN_COMPUTE_SCOPES_JSON` und `QKERN_REALTIME_RETENTION_SCOPES_JSON`
 * und aus demselben Grund: RLS gibt keine organisationsuebergreifende Suche her.
 */
export type ProjectQueueBinding = ProjectQueueScope & Readonly<{
  queue: string;
  functionName: string;
}>;

export type ProjectQueueHostEntry = Readonly<{
  binding: ProjectQueueBinding;
  handler: ProjectQueueHandler;
  principal: ProjectQueuePrincipal;
  workerId: string;
}>;

/**
 * Startet je Bindung einen Worker und haelt sie am Laufen.
 *
 * Ein Fehler einer Bindung darf die anderen nicht mitnehmen: Jede Schleife
 * laeuft fuer sich, und `ProjectQueueWorkerRuntime` faengt ihre Fehler bereits
 * ab. Was hier bleibt, ist das Buendeln und das gemeinsame Anhalten ueber genau
 * ein Signal.
 */
export class ProjectQueueHostRuntime {
  private readonly controller = new AbortController();
  private loops: Promise<unknown>[] | null = null;

  constructor(private readonly options: {
    service: ProjectQueueService;
    entries: readonly ProjectQueueHostEntry[];
    idleDelayMs?: number;
    errorDelayMs?: number;
    maxIterations?: number;
    /**
     * Nimmt Erfolg und Fehlschlag jeder Runde entgegen.
     *
     * `ProjectQueueWorkerRuntime` speist ihn seit Alpha 1 — nur erzeugt hat ihn
     * fuer diesen Prozess niemand. Ohne Beobachter ist ein Wirt, dessen Claim
     * jedes Mal scheitert, von einem untaetigen nicht zu unterscheiden.
     */
    probe?: RuntimeProbeObserver;
  }) {}

  run(): Promise<unknown[]> {
    if (this.loops) return Promise.all(this.loops);
    this.loops = this.options.entries.map((entry) => {
      const worker = new ProjectQueueWorker({
        service: this.options.service,
        principal: entry.principal,
        scope: {
          organizationId: entry.binding.organizationId,
          projectId: entry.binding.projectId,
          environment: entry.binding.environment,
        },
        queue: entry.binding.queue,
        workerId: entry.workerId,
        handler: entry.handler,
      });
      const runtime = new ProjectQueueWorkerRuntime(worker, {
        idleDelayMs: this.options.idleDelayMs,
        errorDelayMs: this.options.errorDelayMs,
        maxIterations: this.options.maxIterations,
        probe: this.options.probe,
      });
      // `catch` und nicht `finally`: Eine gescheiterte Schleife darf die
      // anderen nicht ueber ein abgewiesenes Promise mitreissen.
      return runtime.run(this.controller.signal).catch(() => undefined);
    });
    return Promise.all(this.loops);
  }

  async stop() {
    this.controller.abort();
    if (this.loops) await Promise.allSettled(this.loops);
  }
}
