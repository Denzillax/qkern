import { recognisedByName } from "@/lib/server/errors/identity";
import { createHmac } from "node:crypto";
import { open } from "node:fs/promises";
import { isIP } from "node:net";
import { ConfigurationError } from "@/lib/server/db/errors";
import {
  MigrationOutboxSinkError,
  type MigrationApplyRequestedMessage,
  type MigrationOutboxAck,
  type MigrationOutboxSink,
} from "@/lib/server/migrations/outbox-publisher";

const MIN_SECRET_BYTES = 32;
const MAX_SECRET_BYTES = 4_096;
const MAX_KEY_FILE_BYTES = 8_192;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 60_000;
const MAX_ACK_BYTES = 4_096;
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export type ApplyBrokerDeliveryErrorCode =
  | "ABORTED"
  | "SIGNING_KEY_UNAVAILABLE"
  | "TIMEOUT"
  | "REQUEST_FAILED"
  | "RESPONSE_REJECTED"
  | "RESPONSE_TOO_LARGE"
  | "INVALID_ACK";

/** Stable, cause-free error: endpoint, key material, body and transport details never escape. */
export class ApplyBrokerDeliveryError extends MigrationOutboxSinkError {
  readonly code: ApplyBrokerDeliveryErrorCode;

  constructor(code: ApplyBrokerDeliveryErrorCode) {
    super(persistedFailureCode(code));
    this.name = "ApplyBrokerDeliveryError";
    this.code = code;
  }
}
recognisedByName(ApplyBrokerDeliveryError, "ApplyBrokerDeliveryError");

function persistedFailureCode(code: ApplyBrokerDeliveryErrorCode) {
  switch (code) {
    case "SIGNING_KEY_UNAVAILABLE": return "SIGNING_KEY_UNAVAILABLE" as const;
    case "TIMEOUT": return "DELIVERY_TIMEOUT" as const;
    case "RESPONSE_REJECTED": return "DESTINATION_REJECTED" as const;
    case "RESPONSE_TOO_LARGE":
    case "INVALID_ACK": return "INVALID_ACK" as const;
    default: return "PUBLISH_FAILED" as const;
  }
}

export type ApplyBrokerSigningKey = Readonly<{ keyId: string; secret: string }>;

export interface ApplyBrokerSigningKeyProvider {
  getActiveSigningKey(options: { signal: AbortSignal }): ApplyBrokerSigningKey | Promise<ApplyBrokerSigningKey>;
}

export class StaticApplyBrokerSigningKeyProvider implements ApplyBrokerSigningKeyProvider {
  private readonly signingKey: ApplyBrokerSigningKey;

  constructor(signingKey: ApplyBrokerSigningKey) {
    const parsed = parseSigningKey(signingKey);
    if (!parsed) throw new ConfigurationError("Apply broker signing key configuration is invalid.");
    this.signingKey = parsed;
  }

  getActiveSigningKey(): ApplyBrokerSigningKey {
    return this.signingKey;
  }
}

/** Reads a private JSON key file on each publish so secret/key-id rotation is atomic. */
export class ApplyBrokerSigningKeyFileProvider implements ApplyBrokerSigningKeyProvider {
  private readonly path: string;
  private readonly production: boolean;

  constructor(path: string, options: { production?: boolean } = {}) {
    if (!path.startsWith("/") || path.length > 1_024 || path.includes("\0")) {
      throw new ConfigurationError("QKERN_APPLY_BROKER_SIGNING_KEY_FILE must be a bounded absolute path.");
    }
    this.path = path;
    this.production = options.production ?? false;
  }

  async getActiveSigningKey(options: { signal: AbortSignal }): Promise<ApplyBrokerSigningKey> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let buffer: Buffer | undefined;
    try {
      if (options.signal.aborted) throw new Error("Aborted");
      handle = await open(this.path, "r");
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_KEY_FILE_BYTES ||
          (this.production && (metadata.mode & 0o077) !== 0)) {
        throw new Error("Invalid key file");
      }
      buffer = Buffer.alloc(metadata.size);
      const result = await handle.read(buffer, 0, metadata.size, 0);
      if (result.bytesRead !== metadata.size || options.signal.aborted) throw new Error("Incomplete key file");
      const parsed: unknown = JSON.parse(buffer.toString("utf8"));
      const key = parseSigningKey(parsed);
      if (!key) throw new Error("Invalid key");
      return key;
    } catch {
      throw new ApplyBrokerDeliveryError("SIGNING_KEY_UNAVAILABLE");
    } finally {
      buffer?.fill(0);
      await handle?.close().catch(() => undefined);
    }
  }
}

export type SignedApplyBrokerSinkOptions = {
  endpoint: URL;
  allowedHosts: ReadonlySet<string>;
  signingKeyProvider: ApplyBrokerSigningKeyProvider;
  timeoutMs?: number;
  production?: boolean;
  fetchFn?: typeof fetch;
  now?: () => Date;
};

/** Exact-host, no-redirect, HMAC-authenticated apply broker gateway. */
export class SignedApplyBrokerSink implements MigrationOutboxSink {
  private readonly endpoint: URL;
  private readonly signingKeyProvider: ApplyBrokerSigningKeyProvider;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;

  constructor(options: SignedApplyBrokerSinkOptions) {
    const allowedHosts = new Set([...options.allowedHosts].map(normalizedHostname));
    if (allowedHosts.size === 0 || allowedHosts.size > 20) {
      throw new ConfigurationError("Apply broker allowedHosts must contain 1 to 20 exact hostnames.");
    }
    this.endpoint = validatedEndpoint(options.endpoint, allowedHosts, options.production ?? false);
    if (!options.signingKeyProvider || typeof options.signingKeyProvider.getActiveSigningKey !== "function") {
      throw new ConfigurationError("An apply broker signing key provider is required.");
    }
    this.signingKeyProvider = options.signingKeyProvider;
    this.timeoutMs = boundedInteger(options.timeoutMs ?? 10_000, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, "timeoutMs");
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async publish(
    message: MigrationApplyRequestedMessage,
    options: { signal?: AbortSignal },
  ): Promise<MigrationOutboxAck> {
    if (options.signal?.aborted) throw new ApplyBrokerDeliveryError("ABORTED");
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
    try {
      const signingKey = await this.activeSigningKey(signal);
      let body: string;
      let timestamp: string;
      let signature: string;
      try {
        body = JSON.stringify(message);
        timestamp = Math.floor(this.now().getTime() / 1_000).toString(10);
        if (!/^\d{10,13}$/.test(timestamp)) throw new Error("Invalid timestamp");
        signature = createHmac("sha256", signingKey.secret)
          .update(`${timestamp}.${body}`, "utf8")
          .digest("hex");
      } catch {
        throw new ApplyBrokerDeliveryError("REQUEST_FAILED");
      }

      const response = await this.fetchFn(this.endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "idempotency-key": message.eventId,
          "user-agent": "QKERN-Apply-Publisher/0.22",
          "x-qkern-event-id": message.eventId,
          "x-qkern-signature": `v1=${signature}`,
          "x-qkern-signature-key-id": signingKey.keyId,
          "x-qkern-timestamp": timestamp,
        },
        body,
        cache: "no-store",
        redirect: "error",
        signal,
      });
      if (!response.ok || !isJson(response.headers.get("content-type"))) {
        await cancelBody(response);
        throw new ApplyBrokerDeliveryError("RESPONSE_REJECTED");
      }
      const raw = await readBoundedBody(response, MAX_ACK_BYTES);
      return Object.freeze(parseExactAck(raw, message.eventId));
    } catch (error) {
      if (options.signal?.aborted) throw new ApplyBrokerDeliveryError("ABORTED");
      if (timeout.signal.aborted) throw new ApplyBrokerDeliveryError("TIMEOUT");
      if (error instanceof ApplyBrokerDeliveryError) throw error;
      throw new ApplyBrokerDeliveryError("REQUEST_FAILED");
    } finally {
      clearTimeout(timer);
    }
  }

  private async activeSigningKey(signal: AbortSignal): Promise<ApplyBrokerSigningKey> {
    try {
      const key = await abortable(this.signingKeyProvider.getActiveSigningKey({ signal }), signal);
      const parsed = parseSigningKey(key);
      if (!parsed) throw new Error("Invalid key");
      return parsed;
    } catch {
      throw new ApplyBrokerDeliveryError("SIGNING_KEY_UNAVAILABLE");
    }
  }
}

export type SignedApplyBrokerSinkDependencies = Pick<SignedApplyBrokerSinkOptions, "fetchFn" | "now"> & {
  signingKeyProvider?: ApplyBrokerSigningKeyProvider;
};

export function createSignedApplyBrokerSinkFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: SignedApplyBrokerSinkDependencies = {},
): SignedApplyBrokerSink {
  let endpoint: URL;
  try {
    endpoint = new URL(env.QKERN_APPLY_BROKER_URL?.trim() ?? "");
  } catch {
    throw new ConfigurationError("QKERN_APPLY_BROKER_URL must be a valid absolute URL.");
  }
  try {
    const production = env.NODE_ENV === "production";
    const hasEnvironmentKey = env.QKERN_APPLY_BROKER_HMAC_KEY_ID !== undefined ||
      env.QKERN_APPLY_BROKER_HMAC_SECRET !== undefined;
    const hasFileKey = env.QKERN_APPLY_BROKER_SIGNING_KEY_FILE !== undefined;
    if (dependencies.signingKeyProvider && (hasEnvironmentKey || hasFileKey)) throw new Error("Mixed key authority");
    if (production && hasEnvironmentKey) throw new Error("Environment key forbidden");
    let signingKeyProvider = dependencies.signingKeyProvider;
    if (!signingKeyProvider && hasFileKey) {
      signingKeyProvider = new ApplyBrokerSigningKeyFileProvider(
        env.QKERN_APPLY_BROKER_SIGNING_KEY_FILE?.trim() ?? "",
        { production },
      );
    }
    if (!signingKeyProvider && !production) {
      signingKeyProvider = new StaticApplyBrokerSigningKeyProvider({
        keyId: env.QKERN_APPLY_BROKER_HMAC_KEY_ID ?? "",
        secret: env.QKERN_APPLY_BROKER_HMAC_SECRET ?? "",
      });
    }
    if (!signingKeyProvider) throw new Error("Missing key provider");
    return new SignedApplyBrokerSink({
      endpoint,
      allowedHosts: parseAllowedHosts(env.QKERN_APPLY_BROKER_ALLOWED_HOSTS),
      signingKeyProvider,
      timeoutMs: applyBrokerTimeoutMsFromEnv(env),
      production,
      fetchFn: dependencies.fetchFn,
      now: dependencies.now,
    });
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError("Invalid apply broker configuration.");
  }
}

export function applyBrokerTimeoutMsFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = env.QKERN_APPLY_BROKER_TIMEOUT_MS?.trim();
  const value = raw ? Number(raw) : 10_000;
  if (!Number.isSafeInteger(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new ConfigurationError("QKERN_APPLY_BROKER_TIMEOUT_MS must be an integer between 100 and 60000.");
  }
  return value;
}

function validatedEndpoint(endpoint: URL, allowedHosts: ReadonlySet<string>, production: boolean): URL {
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new ConfigurationError("QKERN_APPLY_BROKER_URL cannot contain credentials, query parameters or a fragment.");
  }
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && !production)) {
    throw new ConfigurationError("QKERN_APPLY_BROKER_URL must use HTTPS in production.");
  }
  const hostname = normalizedHostname(endpoint.hostname);
  if (!allowedHosts.has(hostname)) {
    throw new ConfigurationError("QKERN_APPLY_BROKER_URL hostname is not in the exact allowlist.");
  }
  if (production && (isIP(hostname) !== 0 || hostname === "localhost" || !hostname.includes("."))) {
    throw new ConfigurationError("QKERN_APPLY_BROKER_URL must use an exact DNS hostname in production.");
  }
  if (production && endpoint.port && endpoint.port !== "443") {
    throw new ConfigurationError("QKERN_APPLY_BROKER_URL must use the standard HTTPS port in production.");
  }
  const normalized = new URL(endpoint.toString());
  normalized.hostname = hostname;
  return normalized;
}

function parseAllowedHosts(raw: string | undefined): ReadonlySet<string> {
  const values = (raw ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0 || values.length > 20) {
    throw new ConfigurationError("QKERN_APPLY_BROKER_ALLOWED_HOSTS must contain 1 to 20 exact hostnames.");
  }
  return new Set(values.map(normalizedHostname));
}

function normalizedHostname(value: string): string {
  const hostname = value.toLowerCase().replace(/\.$/, "");
  if (!HOSTNAME.test(hostname) && isIP(hostname) === 0 && hostname !== "localhost") {
    throw new ConfigurationError("Apply broker hostnames must be exact DNS names without wildcards or ports.");
  }
  return hostname;
}

function parseSigningKey(value: unknown): ApplyBrokerSigningKey | undefined {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "keyId,secret" ||
      typeof value.keyId !== "string" || !KEY_ID.test(value.keyId) || typeof value.secret !== "string") {
    return undefined;
  }
  const size = Buffer.byteLength(value.secret, "utf8");
  if (size < MIN_SECRET_BYTES || size > MAX_SECRET_BYTES || value.secret.includes("\0")) return undefined;
  return Object.freeze({ keyId: value.keyId, secret: value.secret });
}

function parseExactAck(raw: string, eventId: string): MigrationOutboxAck {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || Object.keys(parsed).sort().join(",") !== "eventId,status" ||
        parsed.status !== "ack" || parsed.eventId !== eventId) {
      throw new Error("Invalid ack");
    }
    return { status: "ack", eventId };
  } catch {
    throw new ApplyBrokerDeliveryError("INVALID_ACK");
  }
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<string> {
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) {
    await cancelBody(response);
    throw new ApplyBrokerDeliveryError("RESPONSE_TOO_LARGE");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new ApplyBrokerDeliveryError("RESPONSE_TOO_LARGE");
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function abortable<T>(value: T | PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("Aborted"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(new Error("Aborted")); };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(value).then(
      (result) => { cleanup(); resolve(result); },
      (error: unknown) => { cleanup(); reject(error); },
    );
  });
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ConfigurationError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function isJson(value: string | null): boolean {
  return /^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(value ?? "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
