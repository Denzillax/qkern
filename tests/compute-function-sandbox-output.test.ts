import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { FunctionOutputCollector } from "@/lib/server/compute/function-output";
import { DockerFunctionSandbox } from "@/lib/server/compute/function-sandbox-docker";
import type { FunctionDefinition } from "@/lib/server/compute/model";

/**
 * Die Sandbox trennt Leitung und Log (2.98), hier ohne Docker: Der
 * Container-Client wird durch einen Prozess ersetzt, dessen stdout und stderr
 * der Fall selbst schreibt. Was der echte Container schreibt, prueft der
 * Functions-Stack; was die Sandbox daraus macht, steht hier.
 */
const definition: FunctionDefinition = Object.freeze({
  organizationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  environment: "development" as const,
  id: "33333333-3333-4333-8333-333333333333",
  name: "output-probe",
  runtime: "nodejs24" as const,
  image: `registry.example.com/qkern/probe@sha256:${"a".repeat(64)}`,
  entrypoint: "handler.mjs",
  timeoutMs: 5_000,
  memoryMiB: 128,
  maxConcurrency: 1,
  egressOrigins: Object.freeze([]),
  secretRefs: Object.freeze([]),
});

type Script = (child: FakeChild) => void;

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;
  kill() { this.killed = true; return true; }
  /** Der "Container" endet mit diesem Code; danach passiert nichts mehr. */
  exit(code: number) {
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit("close", code));
  }
}

function sandboxWith(script: Script) {
  const spawnFn = ((command: string, args: string[]) => {
    const child = new FakeChild();
    if (args[0] === "run") setImmediate(() => script(child));
    else child.exit(0);
    return child;
  }) as unknown as typeof spawn;
  return new DockerFunctionSandbox({ spawnFn });
}

async function run(script: Script) {
  const output = new FunctionOutputCollector(() => new Date("2026-09-29T10:00:00.000Z"));
  const result = await sandboxWith(script).invoke(definition, {
    id: "44444444-4444-4444-8444-444444444444", functionId: definition.id,
    payload: {}, requestedAt: "2026-09-29T10:00:00.000Z",
  }, { signal: AbortSignal.timeout(5_000), output });
  return { result, output: output.snapshot() };
}

const RESULT = '{"type":"result","statusCode":200,"headers":{},"body":{"ok":true}}\n';

describe("function sandbox output", () => {
  it("hands non-JSON stdout lines and every stderr line to the sink, in order, with their stream", async () => {
    const { result, output } = await run((child) => {
      child.stdout.write("starting\n");
      child.stderr.write("warn: careful\n");
      child.stdout.write("halfway");
      child.stdout.write(" there\n");
      child.stdout.write(RESULT);
      child.stderr.write("last words without newline");
      child.exit(0);
    });
    expect(result.statusCode).toBe(200);
    expect(output.lines.map((line) => [line.stream, line.text])).toEqual([
      ["stdout", "starting"],
      ["stderr", "warn: careful"],
      ["stdout", "halfway there"],
      ["stderr", "last words without newline"],
    ]);
    expect(output).toMatchObject({ stdoutLines: 2, stderrLines: 2, truncated: false });
  });

  it("does not let a log line end the invocation any more", async () => {
    // Bis 2.97 war eine Nicht-JSON-Zeile auf stdout ein FUNCTION_SANDBOX_FAILED.
    const { result } = await run((child) => {
      child.stdout.write("console.log said this\n");
      child.stdout.write(RESULT);
      child.exit(0);
    });
    expect(result.statusCode).toBe(200);
  });

  it("treats a JSON array or scalar line as a log line, and only an object as the protocol", async () => {
    const { result, output } = await run((child) => {
      child.stdout.write("[1,2,3]\n");
      child.stdout.write("42\n");
      child.stdout.write('"quoted"\n');
      child.stdout.write(RESULT);
      child.exit(0);
    });
    expect(result.statusCode).toBe(200);
    expect(output.lines.map((line) => line.text)).toEqual(["[1,2,3]", "42", '"quoted"']);
  });

  it("keeps stderr complete beyond the old 8 KiB cap and leaves the limit to the sink", async () => {
    const { output } = await run((child) => {
      for (let index = 0; index < 40; index += 1) child.stderr.write(`${"e".repeat(400)} ${index}\n`);
      child.stdout.write(RESULT);
      child.exit(0);
    });
    // 40 Zeilen zu je 400 Bytes sind 16 KiB: mehr, als die Sandbox bis 2.97
    // ueberhaupt gelesen hat. Alle vierzig kommen an.
    expect(output.stderrLines).toBe(40);
    expect(output.lineCount).toBe(40);
    expect(output.lines.at(-1)?.text.endsWith(" 39")).toBe(true);
  });

  it("splits a stderr stream that never sends a newline instead of buffering it forever", async () => {
    const { output } = await run((child) => {
      child.stderr.write("x".repeat(10_000));
      child.stdout.write(RESULT);
      child.exit(0);
    });
    expect(output.stderrLines).toBe(1);
    expect(output.lines[0]).toMatchObject({ stream: "stderr", cut: true });
  });

  it("still refuses an oversized protocol answer", async () => {
    await expect(run((child) => {
      child.stdout.write(`{"type":"result","statusCode":200,"headers":{},"body":{"pad":"${"x".repeat(300_000)}"}}\n`);
      child.exit(0);
    })).rejects.toMatchObject({ code: "FUNCTION_SANDBOX_FAILED" });
  });

  it("does not count log lines against the protocol answer limit", async () => {
    const { result, output } = await run((child) => {
      // 300 KiB Logzeilen, dann eine kleine Antwort. Zaehlten die Logzeilen
      // gegen die Antwortgrenze, fiele der Aufruf.
      for (let index = 0; index < 300; index += 1) child.stdout.write(`${"l".repeat(1_023)}\n`);
      child.stdout.write(RESULT);
      child.exit(0);
    });
    expect(result.statusCode).toBe(200);
    expect(output.stdoutLines).toBe(300);
    expect(output.truncated).toBe(true);
  });

  it("works without a sink, discarding what the container wrote", async () => {
    const result = await sandboxWith((child) => {
      child.stdout.write("noise\n");
      child.stderr.write("more noise\n");
      child.stdout.write(RESULT);
      child.exit(0);
    }).invoke(definition, {
      id: "44444444-4444-4444-8444-444444444444", functionId: definition.id,
      payload: {}, requestedAt: "2026-09-29T10:00:00.000Z",
    }, { signal: AbortSignal.timeout(5_000) });
    expect(result.statusCode).toBe(200);
  });
});
