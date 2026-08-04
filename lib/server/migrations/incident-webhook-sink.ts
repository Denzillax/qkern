import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { ConfigurationError } from "@/lib/server/db/errors";
import {
  MigrationIncidentOutboxSinkError,
  type MigrationIncidentOpenedMessage,
  type MigrationIncidentOutboxAck,
  type MigrationIncidentOutboxSink,
} from "@/lib/server/migrations/incident-outbox-publisher";
import type {
  MigrationIncidentDeliveryFailureCode,
} from "@/lib/server/db/models";

const MIN_SECRET_BYTES = 32;
const MAX_SECRET_BYTES = 4_096;
const SIGNING_KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 60_000;
const MAX_ACK_BYTES = 4_096;
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export type IncidentWebhookDeliveryErrorCode =
  | "ABORTED"
  | "SIGNING_KEY_UNAVAILABLE"
  | "TIMEOUT"
  | "REQUEST_FAILED"
  | "RESPONSE_REJECTED"
  | "RESPONSE_TOO_LARGE"
  | "INVALID_ACK";

/** Stable, redacted error: endpoint, secret, response body and transport details never escape. */
export class IncidentWebhookDeliveryError extends MigrationIncidentOutboxSinkError {
  readonly code: IncidentWebhookDeliveryErrorCode;

  constructor(code: IncidentWebhookDeliveryErrorCode) {
    super(persistedFailureCode(code), `Incident webhook delivery failed (${code}).`);
    this.name = "IncidentWebhookDeliveryError";
    this.code = code;
  }
}

function persistedFailureCode(code: IncidentWebhookDeliveryErrorCode): MigrationIncidentDeliveryFailureCode {
  switch (code) {
    case "SIGNING_KEY_UNAVAILABLE":
      return "SIGNING_KEY_UNAVAILABLE";
    case "TIMEOUT":
      return "DELIVERY_TIMEOUT";
    case "RESPONSE_REJECTED":
      return "DESTINATION_REJECTED";
    case "RESPONSE_TOO_LARGE":
    case "INVALID_ACK":
      return "INVALID_ACK";
    default:
      return "PUBLISH_FAILED";
  }
}

export type IncidentWebhookSigningKey = Readonly<{
  keyId: string;
  secret: string;
}>;

export interface IncidentWebhookSigningKeyProvider {
  getActiveSigningKey(options: { signal: AbortSignal }): IncidentWebhookSigningKey | Promise<IncidentWebhookSigningKey>;
}

/** Deployment adapter for an already injected secret; dynamic providers can rotate per delivery. */
export class StaticIncidentWebhookSigningKeyProvider implements IncidentWebhookSigningKeyProvider {
  private readonly signingKey: IncidentWebhookSigningKey;

  constructor(signingKey: IncidentWebhookSigningKey) {
    const validated = parsedSigningKey(signingKey);
    if (!validated) {
      throw new ConfigurationError("Incident webhook signing key configuration is invalid.");
    }
    this.signingKey = validated;
  }

  getActiveSigningKey(): IncidentWebhookSigningKey {
    return this.signingKey;
  }
}

export type SignedIncidentWebhookSinkOptions = {
  endpoint: URL;
  allowedHosts: ReadonlySet<string>;
  signingKeyProvider: IncidentWebhookSigningKeyProvider;
  timeoutMs?: number;
  production?: boolean;
  fetchFn?: typeof fetch;
  now?: () => Date;
};

/**
 * Exact-host, no-redirect webhook adapter for Pager/Ticket gateways.
 * The receiver verifies X-QKERN-Signature over `${timestamp}.${rawBody}` and
 * returns exactly {"status":"ack","eventId":"<same UUID>"} as JSON.
 */
export class SignedIncidentWebhookSink implements MigrationIncidentOutboxSink {
  private readonly endpoint: URL;
  private readonly signingKeyProvider: IncidentWebhookSigningKeyProvider;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;

  constructor(options: SignedIncidentWebhookSinkOptions) {
    const allowedHosts = new Set([...options.allowedHosts].map(normalizedHostname));
    if (allowedHosts.size === 0 || allowedHosts.size > 20) {
      throw new ConfigurationError("Incident webhook allowedHosts must contain 1 to 20 exact hostnames.");
    }
    this.endpoint = validatedEndpoint(options.endpoint, allowedHosts, options.production ?? false);
    if (!options.signingKeyProvider || typeof options.signingKeyProvider.getActiveSigningKey !== "function") {
      throw new ConfigurationError("An incident webhook signing key provider is required.");
    }
    this.signingKeyProvider = options.signingKeyProvider;
    this.timeoutMs = boundedInteger(options.timeoutMs ?? 10_000, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, "timeoutMs");
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async publish(
    message: MigrationIncidentOpenedMessage,
    options: { signal?: AbortSignal },
  ): Promise<MigrationIncidentOutboxAck> {
    if (options.signal?.aborted) throw new IncidentWebhookDeliveryError("ABORTED");

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout.signal])
      : timeout.signal;

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
        throw new IncidentWebhookDeliveryError("REQUEST_FAILED");
      }

      const response = await this.fetchFn(this.endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "idempotency-key": message.eventId,
          "user-agent": "QKERN-Incident-Publisher/0.21",
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
        throw new IncidentWebhookDeliveryError("RESPONSE_REJECTED");
      }

      const raw = await readBoundedBody(response, MAX_ACK_BYTES);
      const ack = parseExactAck(raw, message.eventId);
      return Object.freeze(ack);
    } catch (error) {
      if (options.signal?.aborted) throw new IncidentWebhookDeliveryError("ABORTED");
      if (timeout.signal.aborted) throw new IncidentWebhookDeliveryError("TIMEOUT");
      if (error instanceof IncidentWebhookDeliveryError) throw error;
      throw new IncidentWebhookDeliveryError("REQUEST_FAILED");
    } finally {
      clearTimeout(timer);
    }
  }

  private async activeSigningKey(signal: AbortSignal): Promise<IncidentWebhookSigningKey> {
    try {
      const signingKey = await abortable(
        this.signingKeyProvider.getActiveSigningKey({ signal }),
        signal,
      );
      const validated = parsedSigningKey(signingKey);
      if (!validated) throw new Error("Invalid signing key");
      return validated;
    } catch {
      throw new IncidentWebhookDeliveryError("SIGNING_KEY_UNAVAILABLE");
    }
  }
}

function abortable<T>(value: T | PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("Aborted"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new Error("Aborted"));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(value).then(
      (result) => {
        cleanup();
        resolve(result);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export type SignedIncidentWebhookSinkDependencies = Pick<SignedIncidentWebhookSinkOptions, "fetchFn" | "now"> & {
  signingKeyProvider?: IncidentWebhookSigningKeyProvider;
};

export function createSignedIncidentWebhookSinkFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: SignedIncidentWebhookSinkDependencies = {},
): SignedIncidentWebhookSink {
  const endpointValue = env.QKERN_INCIDENT_WEBHOOK_URL?.trim() ?? "";
  let endpoint: URL;
  try {
    endpoint = new URL(endpointValue);
  } catch {
    throw new ConfigurationError("QKERN_INCIDENT_WEBHOOK_URL must be a valid absolute URL.");
  }
  const allowedHosts = parseAllowedHosts(env.QKERN_INCIDENT_WEBHOOK_ALLOWED_HOSTS);
  try {
    const hasEnvironmentSigningKey = env.QKERN_INCIDENT_WEBHOOK_HMAC_KEY_ID !== undefined ||
      env.QKERN_INCIDENT_WEBHOOK_HMAC_SECRET !== undefined;
    if (dependencies.signingKeyProvider && hasEnvironmentSigningKey) {
      throw new ConfigurationError(
        "Injected incident webhook signing keys cannot be combined with environment signing keys.",
      );
    }
    const signingKeyProvider = dependencies.signingKeyProvider ?? new StaticIncidentWebhookSigningKeyProvider({
      keyId: env.QKERN_INCIDENT_WEBHOOK_HMAC_KEY_ID ?? "",
      secret: env.QKERN_INCIDENT_WEBHOOK_HMAC_SECRET ?? "",
    });
    return new SignedIncidentWebhookSink({
      endpoint,
      allowedHosts,
      signingKeyProvider,
      timeoutMs: incidentWebhookTimeoutMsFromEnv(env),
      production: env.NODE_ENV === "production",
      fetchFn: dependencies.fetchFn,
      now: dependencies.now,
    });
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError("Invalid incident webhook configuration.");
  }
}

export function incidentWebhookTimeoutMsFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  return integerFromEnv(env, "QKERN_INCIDENT_WEBHOOK_TIMEOUT_MS", 10_000);
}

function validatedEndpoint(endpoint: URL, allowedHosts: ReadonlySet<string>, production: boolean): URL {
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new ConfigurationError("QKERN_INCIDENT_WEBHOOK_URL cannot contain credentials, query parameters or a fragment.");
  }
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && !production)) {
    throw new ConfigurationError("QKERN_INCIDENT_WEBHOOK_URL must use HTTPS in production.");
  }
  const hostname = normalizedHostname(endpoint.hostname);
  if (!allowedHosts.has(hostname)) {
    throw new ConfigurationError("QKERN_INCIDENT_WEBHOOK_URL hostname is not in the exact allowlist.");
  }
  if (production && isLocalOrLiteralHost(hostname)) {
    throw new ConfigurationError("QKERN_INCIDENT_WEBHOOK_URL must use a public DNS hostname in production.");
  }
  if (production && endpoint.port && endpoint.port !== "443") {
    throw new ConfigurationError("QKERN_INCIDENT_WEBHOOK_URL must use the standard HTTPS port in production.");
  }
  const normalized = new URL(endpoint.toString());
  normalized.hostname = hostname;
  return normalized;
}

function parseAllowedHosts(raw: string | undefined): ReadonlySet<string> {
  const values = (raw ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0 || values.length > 20) {
    throw new ConfigurationError("QKERN_INCIDENT_WEBHOOK_ALLOWED_HOSTS must contain 1 to 20 exact hostnames.");
  }
  const normalized = values.map(normalizedHostname);
  return new Set(normalized);
}

function normalizedHostname(value: string): string {
  const hostname = value.toLowerCase().replace(/\.$/, "");
  if (!HOSTNAME.test(hostname) && isIP(hostname) === 0 && hostname !== "localhost") {
    throw new ConfigurationError("Incident webhook hostnames must be exact DNS names without wildcards or ports.");
  }
  return hostname;
}

function isLocalOrLiteralHost(hostname: string): boolean {
  return !hostname.includes(".") || hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".home.arpa") ||
    hostname.endsWith(".test") || hostname.endsWith(".example") || hostname.endsWith(".invalid") ||
    isIP(hostname) !== 0;
}

function parsedSigningKey(value: unknown): IncidentWebhookSigningKey | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 2 ||
      typeof value.keyId !== "string" || !SIGNING_KEY_ID.test(value.keyId) ||
      typeof value.secret !== "string") {
    return undefined;
  }
  const bytes = Buffer.byteLength(value.secret, "utf8");
  if (bytes < MIN_SECRET_BYTES || bytes > MAX_SECRET_BYTES || value.secret.includes("\0")) {
    return undefined;
  }
  return Object.freeze({ keyId: value.keyId, secret: value.secret });
}

function integerFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
): number {
  const raw = env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isSafeInteger(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new ConfigurationError(`${name} must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}.`);
  }
  return value;
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ConfigurationError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function isJson(contentType: string | null): boolean {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw new IncidentWebhookDeliveryError("RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof IncidentWebhookDeliveryError) throw error;
    throw new IncidentWebhookDeliveryError("REQUEST_FAILED");
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(merged);
  } catch {
    throw new IncidentWebhookDeliveryError("INVALID_ACK");
  }
}

function parseExactAck(raw: string, expectedEventId: string): MigrationIncidentOutboxAck {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new IncidentWebhookDeliveryError("INVALID_ACK");
  }
  if (!isRecord(value) || Object.keys(value).length !== 2 || value.status !== "ack" ||
      value.eventId !== expectedEventId) {
    throw new IncidentWebhookDeliveryError("INVALID_ACK");
  }
  return { status: "ack", eventId: expectedEventId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Response diagnostics are intentionally discarded.
  }
}
