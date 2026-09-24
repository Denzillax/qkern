import { describe, expect, it } from "vitest";
import type { ComputeDefinitionScope, FunctionDefinitionRecord, FunctionInvocationRecord } from
  "@/lib/server/compute/definitions";
import { FunctionInvocationService } from "@/lib/server/compute/function-invocation";
import { FunctionInvocationError } from "@/lib/server/compute/functions";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";

/**
 * Das Aufrufprotokoll (1.89) am Dienst: Erfolg und Scheitern werden
 * protokolliert — nur mit Statuscode bzw. festem Code, nie mit einer
 * Meldung —, und ein Protokollfehler stuerzt den Aufruf nicht. Die
 * Mutationsprobe dieses Releases protokolliert nur noch Erfolge; dann faellt
 * der Scheiter-Fall hier und sein Zwilling im Postgres-Stack.
 */
const scope: ComputeDefinitionScope = { organizationId: "org-1", projectId: "project-1", environment: "development" };
const serviceRole: ProjectQueuePrincipal = {
  organizationId: "org-1", actorRef: "service-role:key-1", role: "service_role", subject: "key-1",
};
const record: FunctionDefinitionRecord = Object.freeze({
  ...scope, id: "33333333-3333-4333-8333-333333333333", name: "resize-image", runtime: "nodejs24" as const,
  image: `registry.example.com/qkern/probe@sha256:${"a".repeat(64)}`, entrypoint: "handler.mjs",
  timeoutMs: 30_000, memoryMiB: 128, maxConcurrency: 2, egressOrigins: Object.freeze([]),
  secretRefs: Object.freeze([]), enabled: true, createdAt: "2026-08-05T00:00:00.000Z",
});

function harness(options: { fail?: boolean; logThrows?: boolean } = {}) {
  const entries: Array<{ functionId: string; entry: FunctionInvocationRecord }> = [];
  const logFailures: unknown[] = [];
  let tick = 0;
  const service = new FunctionInvocationService({
    repository: { async findFunctionByName() { return record; } },
    invoker: {
      async invoke() {
        if (options.fail) throw new FunctionInvocationError("FUNCTION_TIMEOUT");
        return Object.freeze({ statusCode: 200, headers: {}, body: { ok: true } });
      },
    },
    invocationLog: {
      async recordFunctionInvocation(_principal, _scope, functionId, entry) {
        if (options.logThrows) throw new Error("log store unavailable: connection details here");
        entries.push({ functionId, entry });
      },
    },
    onLogFailure: (error) => logFailures.push(error),
    now: () => new Date(Date.parse("2026-09-24T12:00:00.000Z") + (tick++) * 250),
    id: () => "44444444-4444-4444-8444-444444444444",
  });
  return { service, entries, logFailures };
}

describe("function invocation log", () => {
  it("records a completed call with status code and measured duration", async () => {
    const { service, entries } = harness();
    await service.invoke(serviceRole, scope, record.name, { hello: "world" });
    expect(entries).toEqual([{ functionId: record.id, entry: {
      invocationId: "44444444-4444-4444-8444-444444444444", invokedBy: serviceRole.actorRef,
      startedAt: "2026-09-24T12:00:00.000Z", durationMs: 250, outcome: "completed", statusCode: 200, errorCode: null,
    } }]);
  });

  it("records a failed call with the fixed code only", async () => {
    const { service, entries } = harness({ fail: true });
    await expect(service.invoke(serviceRole, scope, record.name, {})).rejects.toMatchObject({ code: "FUNCTION_TIMEOUT" });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.entry).toMatchObject({ outcome: "failed", statusCode: null, errorCode: "FUNCTION_TIMEOUT" });
  });

  it("never lets a log failure change the outcome of the call", async () => {
    const { service, logFailures } = harness({ logThrows: true });
    await expect(service.invoke(serviceRole, scope, record.name, {})).resolves.toMatchObject({ statusCode: 200 });
    expect(logFailures).toHaveLength(1);
  });
});
