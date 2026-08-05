import { describe, expect, it } from "vitest";
import type { ProjectQueuePrincipal, ProjectQueueScope } from "@/lib/server/project-queues/model";
import { MemoryProjectQueueRepository } from "@/lib/server/project-queues/repository";
import { ProjectQueueService } from "@/lib/server/project-queues/service";
import {
  ProjectQueueHandlerError,
  ProjectQueueWorker,
  type ProjectQueueWorkerLogEvent,
} from "@/lib/server/project-queues/worker";

const scope: ProjectQueueScope = {
  organizationId: "org-worker", projectId: "project-worker", environment: "development",
};
const admin: ProjectQueuePrincipal = {
  organizationId: scope.organizationId, actorRef: "admin:worker", role: "admin", subject: "admin-worker",
};
const principal: ProjectQueuePrincipal = {
  organizationId: scope.organizationId, actorRef: "service:worker", role: "service_role", subject: "worker",
};

async function fixture(options: {
  maxAttempts?: number;
  handler: ConstructorParameters<typeof ProjectQueueWorker>[0]["handler"];
  timeoutMs?: number;
  heartbeatMs?: number;
}) {
  const service = new ProjectQueueService({ repository: new MemoryProjectQueueRepository() });
  await service.createQueue(admin, scope, {
    name: "jobs", maxAttempts: options.maxAttempts ?? 3, visibilityTimeoutSeconds: 5,
    retryBaseSeconds: 1,
  });
  const receipt = await service.enqueue(principal, scope, "jobs", {
    payload: { secret: "handler-only", task: "test" },
  });
  const logs: ProjectQueueWorkerLogEvent[] = [];
  const worker = new ProjectQueueWorker({
    service, principal, scope, queue: "jobs", workerId: "worker-one",
    handler: options.handler, timeoutMs: options.timeoutMs ?? 100,
    heartbeatMs: options.heartbeatMs ?? 20,
    logger: { log: (event) => logs.push(event) },
  });
  return { service, worker, receipt, logs };
}

describe("Project Queue worker", () => {
  it("renews a long-running lease, acknowledges once and emits only redacted telemetry", async () => {
    // Der Handler wartet, bis zweimal erneuert wurde, statt eine feste Zeit zu
    // schlafen. Mit fester Zeit haengt das Ergebnis daran, wie puenktlich Timer
    // unter Last feuern: der Fall war unter voller Suite gelegentlich rot,
    // isoliert immer gruen. Die geprueft Aussage bleibt dieselbe -- ein lang
    // laufender Handler bekommt seine Lease wiederholt erneuert.
    let renewals = () => 0;
    const built = await fixture({
      timeoutMs: 5_000,
      heartbeatMs: 10,
      handler: { async handle() {
        const deadline = Date.now() + 3_000;
        while (renewals() < 2 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      } },
    });
    renewals = () => built.worker.metrics.snapshot().renewals;
    await expect(built.worker.runOnce()).resolves.toMatchObject({
      status: "completed", messageId: built.receipt.id,
    });
    expect(built.worker.metrics.snapshot()).toMatchObject({ claimed: 1, completed: 1 });
    expect(built.worker.metrics.snapshot().renewals).toBeGreaterThanOrEqual(2);
    const serialized = JSON.stringify(built.logs);
    expect(serialized).not.toMatch(/handler-only|qk_lease_|worker-one|leaseToken|payload/i);
  });

  it("times out an uncooperative handler and schedules a server-owned retry", async () => {
    const built = await fixture({
      timeoutMs: 25,
      heartbeatMs: 10,
      handler: { async handle() { await new Promise<void>(() => undefined); } },
    });
    await expect(built.worker.runOnce()).resolves.toMatchObject({ status: "retry_scheduled" });
    expect(built.worker.metrics.snapshot()).toMatchObject({ timedOut: 1, retryScheduled: 1 });
    expect(built.logs.at(-1)).toMatchObject({ failureCode: "HANDLER_TIMEOUT" });
  });

  it("dead-letters a fixed invalid-payload classification without leaking its payload", async () => {
    const built = await fixture({
      handler: { async handle() { throw new ProjectQueueHandlerError("INVALID_PAYLOAD"); } },
    });
    await expect(built.worker.runOnce()).resolves.toMatchObject({ status: "dead_lettered" });
    await expect(built.service.listDeadLetters(admin, scope, "jobs"))
      .resolves.toMatchObject([{ failureCode: "INVALID_PAYLOAD" }]);
  });

  it("does not claim work after shutdown was already requested", async () => {
    const built = await fixture({ handler: { async handle() {} } });
    const controller = new AbortController();
    controller.abort();
    await expect(built.worker.runOnce(controller.signal)).resolves.toEqual({ status: "aborted" });
    expect(await built.service.status(admin, scope, "jobs")).toMatchObject({ available: 1, inFlight: 0 });
  });
});
