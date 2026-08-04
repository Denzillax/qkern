import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ConfigurationError } from "@/lib/server/db/errors";

const LOOPBACK_HOST = "127.0.0.1" as const;
const DEFAULT_PORT = 9_464;
const DEFAULT_STALE_AFTER_MS = 120_000;
const MIN_STALE_AFTER_MS = 1_000;
const MAX_STALE_AFTER_MS = 900_000;

export interface RuntimeProbeObserver {
  runtimeStarted(): void;
  iterationSucceeded(): void;
  iterationFailed(): void;
  runtimeStopped(): void;
}

export type RuntimeProbeSnapshot = Readonly<{
  live: boolean;
  ready: boolean;
  phase: "starting" | "running" | "stopping";
}>;

export class RuntimeProbeState implements RuntimeProbeObserver {
  private phase: RuntimeProbeSnapshot["phase"] = "starting";
  private lastSuccessfulIterationAt?: number;
  private failedSinceSuccess = false;

  constructor(
    private readonly staleAfterMs = DEFAULT_STALE_AFTER_MS,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!Number.isSafeInteger(staleAfterMs) ||
        staleAfterMs < MIN_STALE_AFTER_MS ||
        staleAfterMs > MAX_STALE_AFTER_MS) {
      throw new ConfigurationError(
        `Runtime probe staleness must be between ${MIN_STALE_AFTER_MS} and ${MAX_STALE_AFTER_MS} ms.`,
      );
    }
  }

  runtimeStarted(): void {
    if (this.phase !== "stopping") this.phase = "running";
  }

  iterationSucceeded(): void {
    if (this.phase !== "running") return;
    const now = this.now().getTime();
    if (!Number.isFinite(now)) {
      this.failedSinceSuccess = true;
      return;
    }
    this.lastSuccessfulIterationAt = now;
    this.failedSinceSuccess = false;
  }

  iterationFailed(): void {
    if (this.phase === "running") this.failedSinceSuccess = true;
  }

  runtimeStopped(): void {
    this.phase = "stopping";
    this.failedSinceSuccess = true;
  }

  snapshot(): RuntimeProbeSnapshot {
    const now = this.now().getTime();
    const age = this.lastSuccessfulIterationAt === undefined
      ? Number.POSITIVE_INFINITY
      : now - this.lastSuccessfulIterationAt;
    return Object.freeze({
      live: this.phase !== "stopping",
      ready: this.phase === "running" &&
        !this.failedSinceSuccess &&
        Number.isFinite(age) &&
        age >= 0 &&
        age <= this.staleAfterMs,
      phase: this.phase,
    });
  }
}

export class LoopbackRuntimeProbeServer {
  readonly observer: RuntimeProbeObserver;
  private readonly server: Server;
  private started = false;

  constructor(
    private readonly state: RuntimeProbeState,
    private readonly port = DEFAULT_PORT,
  ) {
    if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
      throw new ConfigurationError("Runtime probe port must be a valid TCP port.");
    }
    this.observer = state;
    this.server = createServer((request, response) => this.respond(request, response));
    this.server.requestTimeout = 2_000;
    this.server.headersTimeout = 2_000;
    this.server.keepAliveTimeout = 1_000;
    this.server.maxHeadersCount = 16;
    this.server.maxConnections = 32;
  }

  async start(): Promise<Readonly<{ host: typeof LOOPBACK_HOST; port: number }>> {
    if (this.started) throw new Error("Runtime probe server is already started.");
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off("error", onError);
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen({ host: LOOPBACK_HOST, port: this.port, exclusive: true });
    });
    this.started = true;
    const address = this.server.address();
    if (!address || typeof address === "string") {
      await this.stop();
      throw new Error("Runtime probe server did not bind a TCP address.");
    }
    return Object.freeze({ host: LOOPBACK_HOST, port: address.port });
  }

  async stop(): Promise<void> {
    this.state.runtimeStopped();
    if (!this.started) return;
    this.started = false;
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
      this.server.closeIdleConnections();
    });
  }

  private respond(request: IncomingMessage, response: ServerResponse): void {
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.setHeader("x-content-type-options", "nosniff");
    const method = request.method ?? "";
    if (method !== "GET" && method !== "HEAD") {
      response.statusCode = 405;
      response.setHeader("allow", "GET, HEAD");
      response.end(method === "HEAD" ? undefined : "method not allowed\n");
      return;
    }
    const snapshot = this.state.snapshot();
    if (request.url === "/live") {
      response.statusCode = snapshot.live ? 200 : 503;
      response.end(method === "HEAD" ? undefined : snapshot.live ? "live\n" : "stopping\n");
      return;
    }
    if (request.url === "/ready") {
      response.statusCode = snapshot.ready ? 200 : 503;
      response.end(method === "HEAD" ? undefined : snapshot.ready ? "ready\n" : "not ready\n");
      return;
    }
    response.statusCode = 404;
    response.end(method === "HEAD" ? undefined : "not found\n");
  }
}

export function createLoopbackRuntimeProbeFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: { now?: () => Date } = {},
): LoopbackRuntimeProbeServer | undefined {
  if (env.QKERN_RUNTIME_PROBE_ENABLED !== "true") return undefined;
  const configuredHost = env.QKERN_RUNTIME_PROBE_HOST?.trim();
  if (configuredHost && configuredHost !== LOOPBACK_HOST) {
    throw new ConfigurationError("Runtime probes may bind only to 127.0.0.1.");
  }
  const port = integerFromEnv(
    env.QKERN_RUNTIME_PROBE_PORT,
    DEFAULT_PORT,
    1_024,
    65_535,
    "QKERN_RUNTIME_PROBE_PORT",
  );
  const staleAfterMs = integerFromEnv(
    env.QKERN_RUNTIME_PROBE_STALE_AFTER_MS,
    DEFAULT_STALE_AFTER_MS,
    MIN_STALE_AFTER_MS,
    MAX_STALE_AFTER_MS,
    "QKERN_RUNTIME_PROBE_STALE_AFTER_MS",
  );
  return new LoopbackRuntimeProbeServer(
    new RuntimeProbeState(staleAfterMs, dependencies.now),
    port,
  );
}

export function safeRuntimeProbe(
  observer: RuntimeProbeObserver | undefined,
  event: keyof RuntimeProbeObserver,
): void {
  try {
    observer?.[event]();
  } catch {
    // Health reporting cannot mutate queue, delivery or migration outcomes.
  }
}

function integerFromEnv(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new ConfigurationError(`${name} must be a decimal integer.`);
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ConfigurationError(`${name} is outside the allowed range.`);
  }
  return parsed;
}
