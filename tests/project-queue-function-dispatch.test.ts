import { describe, expect, it } from "vitest";
import { ComputeDefinitionError } from "@/lib/server/compute/definitions";
import { ProjectQueueFunctionDispatch } from "@/lib/server/project-queues/function-dispatch";
import { queueBindingsFromEnv } from "@/lib/server/project-queues/host-composition";
import { ProjectQueueHandlerError } from "@/lib/server/project-queues/worker";
import type { FunctionInvocationResult } from "@/lib/server/compute/model";
import type { ProjectQueueJson } from "@/lib/server/project-queues/model";

const organizationId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";

const principal = {
  organizationId, actorRef: "system:queue-host", role: "service_role" as const, subject: "queue-host",
};
const scope = { organizationId, projectId, environment: "development" as const };
const message = {
  id: "m-1", queue: "orders", payload: { order: 1 } as ProjectQueueJson,
  attempt: 1, createdAt: new Date(0).toISOString(),
};

function dispatch(invoke: () => Promise<FunctionInvocationResult>) {
  return new ProjectQueueFunctionDispatch({
    functions: { invoke } as never, principal, scope, functionName: "settle",
  });
}

const open = { signal: new AbortController().signal };

describe("project queue function dispatch", () => {
  it("accepts a 2xx answer", async () => {
    await expect(dispatch(async () => ({ statusCode: 200, headers: {}, body: { ok: true } }))
      .handle(message, open)).resolves.toBeUndefined();
  });

  it("treats a non-2xx answer as a handler failure", async () => {
    // Die Entscheidung ueber Retry und Dead Letter gehoert der Queue. Dieser
    // Handler sagt nur, dass es nicht geklappt hat.
    await expect(dispatch(async () => ({ statusCode: 500, headers: {}, body: null }))
      .handle(message, open)).rejects.toMatchObject({ failureCode: "HANDLER_ERROR" });
  });

  it("classifies capacity and a missing function as retryable", async () => {
    for (const code of ["COMPUTE_AT_CAPACITY", "COMPUTE_NOT_FOUND", "COMPUTE_QUOTA_EXCEEDED"] as const) {
      await expect(dispatch(async () => { throw new ComputeDefinitionError(code); })
        .handle(message, open)).rejects.toMatchObject({ failureCode: "DEPENDENCY_UNAVAILABLE" });
    }
  });

  it("does not start an invocation after shutdown", async () => {
    let called = false;
    const controller = new AbortController();
    controller.abort();
    await expect(dispatch(async () => { called = true; return { statusCode: 200, headers: {}, body: null }; })
      .handle(message, { signal: controller.signal }))
      .rejects.toBeInstanceOf(ProjectQueueHandlerError);
    // Ein Aufruf, der nach dem Abbruch noch startet, laesst einen Container
    // zurueck, den niemand mehr abraeumt.
    expect(called).toBe(false);
  });
});

describe("queue binding configuration", () => {
  const valid = JSON.stringify([
    { organizationId, projectId, environment: "development", queue: "orders", functionName: "settle" },
  ]);

  it("reads a valid binding", () => {
    expect(queueBindingsFromEnv({ QKERN_QUEUE_WORKER_BINDINGS_JSON: valid })).toEqual([
      { organizationId, projectId, environment: "development", queue: "orders", functionName: "settle" },
    ]);
  });

  it("refuses to read an unreadable list as no bindings", () => {
    // Stillschweigend "keine Bindungen" hiesse: Der Prozess laeuft und
    // verarbeitet nie etwas — genau der Zustand, den 1.42 beendet.
    expect(() => queueBindingsFromEnv({ QKERN_QUEUE_WORKER_BINDINGS_JSON: "{" })).toThrow();
  });

  it("refuses the same queue twice", () => {
    const twice = JSON.stringify([
      { organizationId, projectId, environment: "development", queue: "orders", functionName: "a" },
      { organizationId, projectId, environment: "development", queue: "orders", functionName: "b" },
    ]);
    expect(() => queueBindingsFromEnv({ QKERN_QUEUE_WORKER_BINDINGS_JSON: twice })).toThrow();
  });

  it("refuses an incomplete entry", () => {
    const missing = JSON.stringify([{ organizationId, projectId, environment: "development", queue: "orders" }]);
    expect(() => queueBindingsFromEnv({ QKERN_QUEUE_WORKER_BINDINGS_JSON: missing })).toThrow();
  });
});
