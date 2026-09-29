import { describe, expect, it } from "vitest";
import type { ComputeDefinitionScope, FunctionDefinitionRecord, FunctionInvocationRecord } from
  "@/lib/server/compute/definitions";
import { FunctionInvocationService } from "@/lib/server/compute/function-invocation";
import { FunctionInvocationError } from "@/lib/server/compute/functions";
import type { FunctionOutputRecord } from "@/lib/server/compute/function-output";
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

function harness(options: {
  fail?: boolean; logThrows?: boolean; outputThrows?: boolean;
  /** Was der "Container" schreibt, bevor er antwortet oder scheitert. */
  writes?: Array<["stdout" | "stderr", string]>;
  /** Ohne Ausgabeport bleibt es beim Aufrufprotokoll allein. */
  withoutOutputPort?: boolean;
} = {}) {
  const entries: Array<{ functionId: string; entry: FunctionInvocationRecord }> = [];
  const outputs: Array<{ functionId: string; invocationId: string; output: FunctionOutputRecord }> = [];
  const logFailures: unknown[] = [];
  let tick = 0;
  const invocationLog = {
    async recordFunctionInvocation(_principal: unknown, _scope: unknown, functionId: string, entry: FunctionInvocationRecord) {
      if (options.logThrows) throw new Error("log store unavailable: connection details here");
      entries.push({ functionId, entry });
    },
    async recordFunctionInvocationOutput(_principal: unknown, _scope: unknown, functionId: string,
      invocationId: string, output: FunctionOutputRecord) {
      if (options.outputThrows) throw new Error("output store unavailable");
      outputs.push({ functionId, invocationId, output });
    },
  };
  const service = new FunctionInvocationService({
    repository: { async findFunctionByName() { return record; } },
    invoker: {
      async invoke(_definition, _invocation, _signal, output) {
        for (const [stream, text] of options.writes ?? []) output?.line(stream, text);
        if (options.fail) throw new FunctionInvocationError("FUNCTION_TIMEOUT");
        return Object.freeze({ statusCode: 200, headers: {}, body: { ok: true } });
      },
    },
    invocationLog: options.withoutOutputPort
      ? { recordFunctionInvocation: invocationLog.recordFunctionInvocation }
      : invocationLog,
    onLogFailure: (error) => logFailures.push(error),
    now: () => new Date(Date.parse("2026-09-24T12:00:00.000Z") + (tick++) * 250),
    id: () => "44444444-4444-4444-8444-444444444444",
  });
  return { service, entries, outputs, logFailures };
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

  /**
   * Die Inhaltslogs (2.98): Was der Container geschrieben hat, wird nach der
   * Zeile des Aufrufs aufgehoben, mit Strom und Reihenfolge; auch bei einem
   * gescheiterten Aufruf; nie ohne eine einzige Zeile; und ein Fehler des
   * Ausgabespeichers stuerzt den Aufruf ebenso wenig wie einer des
   * Aufrufprotokolls.
   */
  it("records what the container wrote, with stream and order, after the invocation row", async () => {
    const { service, entries, outputs } = harness({
      writes: [["stdout", "start"], ["stderr", "careful"], ["stdout", "done"]],
    });
    await service.invoke(serviceRole, scope, record.name, {});
    expect(entries).toHaveLength(1);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({
      functionId: record.id, invocationId: "44444444-4444-4444-8444-444444444444",
    });
    expect(outputs[0]!.output.lines.map((line) => [line.stream, line.text])).toEqual([
      ["stdout", "start"], ["stderr", "careful"], ["stdout", "done"],
    ]);
    expect(outputs[0]!.output).toMatchObject({ lineCount: 3, stdoutLines: 2, stderrLines: 1, truncated: false });
  });

  it("keeps the output of a failed call, where it is the only hint at the why", async () => {
    const { service, outputs } = harness({ fail: true, writes: [["stderr", "TypeError: boom"]] });
    await expect(service.invoke(serviceRole, scope, record.name, {})).rejects.toMatchObject({ code: "FUNCTION_TIMEOUT" });
    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.output.lines[0]).toMatchObject({ stream: "stderr", text: "TypeError: boom" });
  });

  it("writes no output row for a call that wrote nothing", async () => {
    const { service, entries, outputs } = harness({ writes: [] });
    await service.invoke(serviceRole, scope, record.name, {});
    expect(entries).toHaveLength(1);
    expect(outputs).toHaveLength(0);
  });

  it("discards the output when the log port cannot keep it, as before 2.67.0", async () => {
    const { service, entries, outputs } = harness({ withoutOutputPort: true, writes: [["stdout", "lost"]] });
    await service.invoke(serviceRole, scope, record.name, {});
    expect(entries).toHaveLength(1);
    expect(outputs).toHaveLength(0);
  });

  it("never lets a failure of the output store change the outcome of the call", async () => {
    const { service, entries, logFailures } = harness({ outputThrows: true, writes: [["stdout", "x"]] });
    await expect(service.invoke(serviceRole, scope, record.name, {})).resolves.toMatchObject({ statusCode: 200 });
    expect(entries).toHaveLength(1);
    expect(logFailures).toHaveLength(1);
  });
});
