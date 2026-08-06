import type {
  FunctionDefinition,
  FunctionInvocation,
  FunctionInvocationResult,
} from "@/lib/server/compute/model";
import type { ProjectQueueJson } from "@/lib/server/project-queues/model";

const NAME = /^[a-z][a-z0-9_-]{2,62}$/;
const ENTRYPOINT = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const SECRET_REF = /^[A-Za-z][A-Za-z0-9_./:-]{2,127}$/;
/**
 * Inhaltsadressierter Image-Bezug, optional mit Registry und Port.
 *
 * Der Doppelpunkt kam mit Release 1.35 dazu. Ohne ihn war jede Registry mit
 * Port ausgeschlossen — und das fiel erst auf, als der Zertifizierungslauf eine
 * **echte** benutzte statt einer erfundenen Referenz.
 *
 * Die bindende Stelle bleibt der Digest: Was vor dem `@` steht, ist die
 * Adresse, aufgelöst wird über `sha256`. Ein Tag allein bleibt abgewiesen.
 */
const IMAGE = /^[a-z0-9][a-z0-9.:/_-]{1,254}[a-z0-9]@sha256:[0-9a-f]{64}$/;

export interface FunctionSandboxPort {
  invoke(
    definition: FunctionDefinition,
    invocation: FunctionInvocation,
    options: { signal: AbortSignal },
  ): Promise<FunctionInvocationResult>;
}

export class FunctionInvocationError extends Error {
  constructor(readonly code: "FUNCTION_INVALID" | "FUNCTION_TIMEOUT" | "FUNCTION_SANDBOX_FAILED") {
    super(code); this.name = "FunctionInvocationError";
  }
}

export function validateFunctionDefinition(input: FunctionDefinition): FunctionDefinition {
  if (!NAME.test(input.name) || input.runtime !== "nodejs24" || !IMAGE.test(input.image) ||
      !ENTRYPOINT.test(input.entrypoint) || !integer(input.timeoutMs, 100, 300_000) ||
      !integer(input.memoryMiB, 64, 2_048) || !integer(input.maxConcurrency, 1, 100) ||
      input.egressOrigins.length > 20 || new Set(input.egressOrigins).size !== input.egressOrigins.length ||
      input.secretRefs.length > 20 || new Set(input.secretRefs).size !== input.secretRefs.length ||
      input.secretRefs.some((reference) => !SECRET_REF.test(reference))) {
    throw new FunctionInvocationError("FUNCTION_INVALID");
  }
  for (const origin of input.egressOrigins) validatePublicHttpsOrigin(origin);
  return Object.freeze({
    ...input,
    egressOrigins: Object.freeze([...input.egressOrigins]),
    secretRefs: Object.freeze([...input.secretRefs]),
  });
}

export class FunctionInvoker {
  constructor(private readonly sandbox: FunctionSandboxPort) {}

  async invoke(
    rawDefinition: FunctionDefinition,
    invocation: FunctionInvocation,
    signal?: AbortSignal,
  ): Promise<FunctionInvocationResult> {
    if (signal?.aborted) throw new FunctionInvocationError("FUNCTION_SANDBOX_FAILED");
    const definition = validateFunctionDefinition(rawDefinition);
    const payload = validateJson(invocation.payload, 64 * 1024);
    if (invocation.functionId !== definition.id || !Number.isFinite(Date.parse(invocation.requestedAt))) {
      throw new FunctionInvocationError("FUNCTION_INVALID");
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), definition.timeoutMs);
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => this.sandbox.invoke(definition, Object.freeze({ ...invocation, payload }), {
          signal: controller.signal,
        })).catch(() => {
          throw new FunctionInvocationError(controller.signal.aborted && !signal?.aborted
            ? "FUNCTION_TIMEOUT" : "FUNCTION_SANDBOX_FAILED");
        }),
        new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () =>
          reject(new FunctionInvocationError(signal?.aborted ? "FUNCTION_SANDBOX_FAILED" : "FUNCTION_TIMEOUT")),
        { once: true })),
      ]);
      return validateResult(result);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}

function validateResult(result: FunctionInvocationResult): FunctionInvocationResult {
  if (!integer(result.statusCode, 200, 599) || Object.keys(result.headers).length > 20) {
    throw new FunctionInvocationError("FUNCTION_SANDBOX_FAILED");
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(result.headers)) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(name) || ["set-cookie", "transfer-encoding", "connection"].includes(name) ||
        typeof value !== "string" || value.length > 1_024 || /[\r\n]/.test(value)) {
      throw new FunctionInvocationError("FUNCTION_SANDBOX_FAILED");
    }
    headers[name] = value;
  }
  const body = validateJson(result.body, 256 * 1024);
  return Object.freeze({ statusCode: result.statusCode, headers: Object.freeze(headers), body });
}

function validatePublicHttpsOrigin(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port && url.port !== "443" || url.origin !== value ||
        url.username || url.password || unsafeHostname(url.hostname)) throw new Error("invalid");
  } catch { throw new FunctionInvocationError("FUNCTION_INVALID"); }
}

export function unsafeHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (["localhost", "localhost.localdomain"].includes(normalized) ||
      normalized.endsWith(".localhost") || normalized.endsWith(".local") || normalized.endsWith(".internal")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(normalized) || normalized.includes(":")) return true;
  return !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalized);
}

function integer(value: number, min: number, max: number) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

export function validateJson(value: ProjectQueueJson, maxBytes: number) {
  let serialized: string | undefined;
  try { serialized = JSON.stringify(value); } catch { throw new FunctionInvocationError("FUNCTION_INVALID"); }
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new FunctionInvocationError("FUNCTION_INVALID");
  }
  const parsed = JSON.parse(serialized) as ProjectQueueJson;
  assertSafeJson(parsed, 0, { nodes: 0 });
  return parsed;
}

function assertSafeJson(value: ProjectQueueJson, depth: number, state: { nodes: number }) {
  state.nodes += 1;
  if (depth > 12 || state.nodes > 4_000) throw new FunctionInvocationError("FUNCTION_INVALID");
  if (Array.isArray(value)) for (const item of value) assertSafeJson(item, depth + 1, state);
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) {
    if (!key || key.length > 128 || ["__proto__", "constructor", "prototype"].includes(key)) {
      throw new FunctionInvocationError("FUNCTION_INVALID");
    }
    assertSafeJson(item, depth + 1, state);
  }
}
