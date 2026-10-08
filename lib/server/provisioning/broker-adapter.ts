import { createHmac } from "node:crypto";
import { open } from "node:fs/promises";
import { isIP } from "node:net";
import { ConfigurationError } from "@/lib/server/db/errors";
import { recognisedByName } from "@/lib/server/errors/identity";
import {
  ProjectDatabaseProvisioningAdapterError,
  type ProjectDatabaseProvisioningAdapter,
  type ProjectDatabaseProvisioningRequest,
  type ProvisionedProjectDatabaseBinding,
} from "@/lib/server/provisioning/worker";

const MIN_SECRET_BYTES = 32;
const MAX_SECRET_BYTES = 4_096;
const MAX_KEY_FILE_BYTES = 8_192;
const MAX_RESPONSE_BYTES = 16_384;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export type ProvisioningBrokerSigningKey = Readonly<{ keyId: string; secret: string }>;

export interface ProvisioningBrokerSigningKeyProvider {
  getActiveSigningKey(options: { signal: AbortSignal }):
    ProvisioningBrokerSigningKey | Promise<ProvisioningBrokerSigningKey>;
}

export class StaticProvisioningBrokerSigningKeyProvider implements ProvisioningBrokerSigningKeyProvider {
  private readonly key: ProvisioningBrokerSigningKey;
  constructor(key: ProvisioningBrokerSigningKey) {
    const parsed = parseKey(key);
    if (!parsed) throw new ConfigurationError("Project provisioning broker signing key is invalid.");
    this.key = parsed;
  }
  getActiveSigningKey(): ProvisioningBrokerSigningKey { return this.key; }
}

export class ProvisioningBrokerSigningKeyFileProvider implements ProvisioningBrokerSigningKeyProvider {
  constructor(private readonly path: string, private readonly production = false) {
    if (!path.startsWith("/") || path.length > 1_024 || path.includes("\0")) {
      throw new ConfigurationError("QKERN_PROVISIONING_BROKER_SIGNING_KEY_FILE must be a bounded absolute path.");
    }
  }

  async getActiveSigningKey(options: { signal: AbortSignal }): Promise<ProvisioningBrokerSigningKey> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let buffer: Buffer | undefined;
    try {
      if (options.signal.aborted) throw new Error("Aborted");
      handle = await open(this.path, "r");
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_KEY_FILE_BYTES ||
          (this.production && (metadata.mode & 0o077) !== 0)) throw new Error("Invalid key file");
      buffer = Buffer.alloc(metadata.size);
      const result = await handle.read(buffer, 0, metadata.size, 0);
      if (result.bytesRead !== metadata.size || options.signal.aborted) throw new Error("Incomplete key file");
      const parsed = parseKey(JSON.parse(buffer.toString("utf8")));
      if (!parsed) throw new Error("Invalid key");
      return parsed;
    } catch {
      throw new ProjectDatabaseProvisioningAdapterError("PROVIDER_UNAVAILABLE");
    } finally {
      buffer?.fill(0);
      await handle?.close().catch(() => undefined);
    }
  }
}

export type SignedProjectProvisioningBrokerOptions = {
  endpoint: URL;
  allowedHosts: ReadonlySet<string>;
  signingKeyProvider: ProvisioningBrokerSigningKeyProvider;
  timeoutMs?: number;
  production?: boolean;
  fetchFn?: typeof fetch;
  now?: () => Date;
};

/** Signed, reference-only infrastructure boundary. Provider credentials never enter QKERN. */
export class SignedProjectProvisioningBrokerAdapter implements ProjectDatabaseProvisioningAdapter {
  private readonly endpoint: URL;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: SignedProjectProvisioningBrokerOptions) {
    const hosts = new Set([...options.allowedHosts].map(normalizedHost));
    if (hosts.size < 1 || hosts.size > 20) throw new ConfigurationError("Provisioning broker host allowlist is invalid.");
    this.endpoint = validatedEndpoint(options.endpoint, hosts, options.production ?? false);
    if (!options.signingKeyProvider || typeof options.signingKeyProvider.getActiveSigningKey !== "function") {
      throw new ConfigurationError("A provisioning broker signing key provider is required.");
    }
    this.timeoutMs = boundedInteger(options.timeoutMs ?? 20_000, 100, 60_000);
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async provision(
    request: ProjectDatabaseProvisioningRequest,
    options: { signal?: AbortSignal },
  ): Promise<ProvisionedProjectDatabaseBinding> {
    if (options.signal?.aborted) throw new ProjectDatabaseProvisioningAdapterError("PROVIDER_UNAVAILABLE");
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
    try {
      const key = await this.activeKey(signal);
      const body = JSON.stringify(request);
      const timestamp = Math.floor(this.now().getTime() / 1_000).toString(10);
      if (!/^\d{10,13}$/.test(timestamp)) throw new ProjectDatabaseProvisioningAdapterError("PROVIDER_UNAVAILABLE");
      const signature = createHmac("sha256", key.secret)
        .update(`${timestamp}.${body}`, "utf8")
        .digest("hex");
      let response: Response;
      try {
        response = await this.fetchFn(this.endpoint, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "idempotency-key": request.provisioningJobId,
            "user-agent": "QKERN-Provisioner/0.23",
            "x-qkern-provisioning-job-id": request.provisioningJobId,
            "x-qkern-signature": `v1=${signature}`,
            "x-qkern-signature-key-id": key.keyId,
            "x-qkern-timestamp": timestamp,
          },
          body,
          cache: "no-store",
          redirect: "error",
          signal,
        });
      } catch {
        throw new ProjectDatabaseProvisioningAdapterError(
          timeout.signal.aborted ? "PROVISIONING_TIMEOUT" : "PROVIDER_UNAVAILABLE",
        );
      }
      if (!response.ok || !isJson(response.headers.get("content-type"))) {
        await response.body?.cancel().catch(() => undefined);
        throw new ProjectDatabaseProvisioningAdapterError("PROVIDER_REJECTED");
      }
      return parseResponse(await readBoundedBody(response), request);
    } catch (error) {
      if (timeout.signal.aborted) throw new ProjectDatabaseProvisioningAdapterError("PROVISIONING_TIMEOUT");
      if (error instanceof ProjectDatabaseProvisioningAdapterError) throw error;
      throw new ProjectDatabaseProvisioningAdapterError("PROVIDER_UNAVAILABLE");
    } finally {
      clearTimeout(timer);
    }
  }

  private async activeKey(signal: AbortSignal): Promise<ProvisioningBrokerSigningKey> {
    try {
      const key = await abortable(this.options.signingKeyProvider.getActiveSigningKey({ signal }), signal);
      const parsed = parseKey(key);
      if (!parsed) throw new Error("Invalid key");
      return parsed;
    } catch {
      throw new ProjectDatabaseProvisioningAdapterError("PROVIDER_UNAVAILABLE");
    }
  }
}

export function createSignedProjectProvisioningBrokerFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: {
    signingKeyProvider?: ProvisioningBrokerSigningKeyProvider;
    fetchFn?: typeof fetch;
    now?: () => Date;
  } = {},
): SignedProjectProvisioningBrokerAdapter {
  try {
    const endpoint = new URL(env.QKERN_PROVISIONING_BROKER_URL?.trim() ?? "");
    const production = env.NODE_ENV === "production";
    return new SignedProjectProvisioningBrokerAdapter({
      endpoint,
      allowedHosts: parseAllowedHosts(env.QKERN_PROVISIONING_BROKER_ALLOWED_HOSTS),
      signingKeyProvider: signingKeyProviderFromEnv(env, dependencies.signingKeyProvider, production),
      timeoutMs: provisioningBrokerTimeoutMsFromEnv(env),
      production,
      fetchFn: dependencies.fetchFn,
      now: dependencies.now,
    });
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError("The project provisioning broker configuration is invalid.");
  }
}

/**
 * Die Schluesselquelle des Brokers. Anlegen und Abbauen (2.177) signieren mit
 * demselben Schluessel; es gibt darum eine Stelle, die ihn waehlt.
 */
function signingKeyProviderFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  injected: ProvisioningBrokerSigningKeyProvider | undefined,
  production: boolean,
): ProvisioningBrokerSigningKeyProvider {
  const environmentKey = env.QKERN_PROVISIONING_BROKER_HMAC_KEY_ID !== undefined ||
    env.QKERN_PROVISIONING_BROKER_HMAC_SECRET !== undefined;
  const fileKey = env.QKERN_PROVISIONING_BROKER_SIGNING_KEY_FILE !== undefined;
  if (injected && (environmentKey || fileKey)) throw new Error("Mixed key authority");
  if (production && environmentKey) throw new Error("Environment secret forbidden");
  let provider = injected;
  if (!provider && fileKey) {
    provider = new ProvisioningBrokerSigningKeyFileProvider(
      env.QKERN_PROVISIONING_BROKER_SIGNING_KEY_FILE?.trim() ?? "",
      production,
    );
  }
  if (!provider && !production) {
    provider = new StaticProvisioningBrokerSigningKeyProvider({
      keyId: env.QKERN_PROVISIONING_BROKER_HMAC_KEY_ID ?? "",
      secret: env.QKERN_PROVISIONING_BROKER_HMAC_SECRET ?? "",
    });
  }
  if (!provider) throw new Error("Missing key provider");
  return provider;
}

/**
 * Die Abbau-Anfrage an den Broker (2.177).
 *
 * Entschieden von Denzil (docs/PROJEKT_LOESCHEN.md): Der Broker baut die
 * Datenbank eines abgeraeumten Projekts ab; QKERN fuehrt nie `DROP DATABASE`
 * aus. Signiert wird wie beim Anlegen (`v1=` HMAC-SHA256 ueber
 * `<timestamp>.<body>`, derselbe Schluessel, dieselbe Host-Liste), an eine
 * eigene Adresse (`QKERN_PROVISIONING_BROKER_TEARDOWN_URL`) und mit eigenem
 * Idempotenzschluessel, der Kennung der Anfrage aus
 * `project_database_teardowns`. Eine Wiederholung traegt dieselbe Kennung.
 *
 * Bestaetigt ist nur eine Antwort mit genau `{status: "torn_down",
 * teardownRequestId}` und derselben Kennung. Alles andere ist ein
 * Fehlschlag, und die Datenbank bleibt gesperrt stehen.
 */
export type ProjectDatabaseTeardownRequest = Readonly<{
  teardownRequestId: string;
  organizationId: string;
  projectId: string;
  environment: string;
  databaseInstanceRef: string;
  restoreDatabases: readonly string[];
}>;

export const PROJECT_DATABASE_TEARDOWN_ERROR_CODES = [
  "PROVIDER_UNAVAILABLE", "PROVIDER_REJECTED", "INVALID_RESPONSE", "TEARDOWN_TIMEOUT",
] as const;
export type ProjectDatabaseTeardownErrorCode = typeof PROJECT_DATABASE_TEARDOWN_ERROR_CODES[number];

export class ProjectDatabaseTeardownError extends Error {
  constructor(readonly code: ProjectDatabaseTeardownErrorCode) {
    super("The project database teardown was not confirmed.");
    this.name = "ProjectDatabaseTeardownError";
  }
}
// `purge.ts` erkennt den Fehlercode mit `instanceof`; das muss auch ueber
// zwei Modulkopien hinweg halten, wie bei den anderen Fehlerklassen.
recognisedByName(ProjectDatabaseTeardownError, "ProjectDatabaseTeardownError");

export interface ProjectDatabaseTeardownAdapter {
  teardown(request: ProjectDatabaseTeardownRequest, options?: { signal?: AbortSignal }): Promise<void>;
}

export class SignedProjectDatabaseTeardownBrokerAdapter implements ProjectDatabaseTeardownAdapter {
  private readonly endpoint: URL;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: SignedProjectProvisioningBrokerOptions) {
    const hosts = new Set([...options.allowedHosts].map(normalizedHost));
    if (hosts.size < 1 || hosts.size > 20) throw new ConfigurationError("Provisioning broker host allowlist is invalid.");
    this.endpoint = validatedEndpoint(options.endpoint, hosts, options.production ?? false);
    if (!options.signingKeyProvider || typeof options.signingKeyProvider.getActiveSigningKey !== "function") {
      throw new ConfigurationError("A provisioning broker signing key provider is required.");
    }
    this.timeoutMs = boundedInteger(options.timeoutMs ?? 20_000, 100, 60_000);
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async teardown(request: ProjectDatabaseTeardownRequest, options: { signal?: AbortSignal } = {}): Promise<void> {
    if (options.signal?.aborted) throw new ProjectDatabaseTeardownError("PROVIDER_UNAVAILABLE");
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
    try {
      let key: ProvisioningBrokerSigningKey;
      try {
        const candidate = await abortable(this.options.signingKeyProvider.getActiveSigningKey({ signal }), signal);
        const parsed = parseKey(candidate);
        if (!parsed) throw new Error("Invalid key");
        key = parsed;
      } catch {
        throw new ProjectDatabaseTeardownError("PROVIDER_UNAVAILABLE");
      }
      const body = JSON.stringify({
        teardownRequestId: request.teardownRequestId,
        organizationId: request.organizationId,
        projectId: request.projectId,
        environment: request.environment,
        databaseInstanceRef: request.databaseInstanceRef,
        restoreDatabases: [...request.restoreDatabases],
      });
      const timestamp = Math.floor(this.now().getTime() / 1_000).toString(10);
      if (!/^[0-9]{10,13}$/.test(timestamp)) throw new ProjectDatabaseTeardownError("PROVIDER_UNAVAILABLE");
      const signature = createHmac("sha256", key.secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
      let response: Response;
      try {
        response = await this.fetchFn(this.endpoint, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "idempotency-key": request.teardownRequestId,
            "user-agent": "QKERN-Provisioner/0.23",
            "x-qkern-teardown-request-id": request.teardownRequestId,
            "x-qkern-signature": `v1=${signature}`,
            "x-qkern-signature-key-id": key.keyId,
            "x-qkern-timestamp": timestamp,
          },
          body,
          cache: "no-store",
          redirect: "error",
          signal,
        });
      } catch {
        throw new ProjectDatabaseTeardownError(timeout.signal.aborted ? "TEARDOWN_TIMEOUT" : "PROVIDER_UNAVAILABLE");
      }
      if (!response.ok || !isJson(response.headers.get("content-type"))) {
        await response.body?.cancel().catch(() => undefined);
        throw new ProjectDatabaseTeardownError("PROVIDER_REJECTED");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBoundedBody(response));
      } catch {
        throw new ProjectDatabaseTeardownError("INVALID_RESPONSE");
      }
      if (!isRecord(parsed) || Object.keys(parsed).sort().join(",") !== "status,teardownRequestId" ||
          parsed.status !== "torn_down" || parsed.teardownRequestId !== request.teardownRequestId) {
        throw new ProjectDatabaseTeardownError("INVALID_RESPONSE");
      }
    } catch (error) {
      if (timeout.signal.aborted) throw new ProjectDatabaseTeardownError("TEARDOWN_TIMEOUT");
      if (error instanceof ProjectDatabaseTeardownError) throw error;
      throw new ProjectDatabaseTeardownError("PROVIDER_UNAVAILABLE");
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Baut die Abbau-Anfrage aus der Umgebung. Ohne
 * `QKERN_PROVISIONING_BROKER_TEARDOWN_URL` kommt `null`, und der Abraeumer
 * laesst die Datenbank stehen: Das Projekt wartet, und die Konsole sagt es.
 */
export function createSignedProjectDatabaseTeardownBrokerFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: {
    signingKeyProvider?: ProvisioningBrokerSigningKeyProvider;
    fetchFn?: typeof fetch;
    now?: () => Date;
  } = {},
): SignedProjectDatabaseTeardownBrokerAdapter | null {
  const raw = env.QKERN_PROVISIONING_BROKER_TEARDOWN_URL?.trim();
  if (!raw) return null;
  try {
    const production = env.NODE_ENV === "production";
    return new SignedProjectDatabaseTeardownBrokerAdapter({
      endpoint: new URL(raw),
      allowedHosts: parseAllowedHosts(env.QKERN_PROVISIONING_BROKER_ALLOWED_HOSTS),
      signingKeyProvider: signingKeyProviderFromEnv(env, dependencies.signingKeyProvider, production),
      timeoutMs: provisioningBrokerTimeoutMsFromEnv(env),
      production,
      fetchFn: dependencies.fetchFn,
      now: dependencies.now,
    });
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError("The project database teardown broker configuration is invalid.");
  }
}

export function provisioningBrokerTimeoutMsFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = env.QKERN_PROVISIONING_BROKER_TIMEOUT_MS?.trim();
  const value = raw ? Number(raw) : 20_000;
  if (!Number.isSafeInteger(value) || value < 100 || value > 60_000) {
    throw new ConfigurationError("QKERN_PROVISIONING_BROKER_TIMEOUT_MS must be between 100 and 60000.");
  }
  return value;
}

function parseResponse(raw: string, request: ProjectDatabaseProvisioningRequest): ProvisionedProjectDatabaseBinding {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || Object.keys(parsed).sort().join(",") !== "binding,provisioningJobId,status" ||
        parsed.status !== "ready" || parsed.provisioningJobId !== request.provisioningJobId ||
        !isRecord(parsed.binding)) throw new Error("Invalid response");
    const binding = parsed.binding;
    const expectedKeys = [
      "bootstrapContractSha256", "databaseInstanceRef", "expectedDatabase", "expectedLedgerOwner",
      "expectedRole", "host", "port", "serverCertificateSha256", "vaultStaticRole",
    ].sort().join(",");
    if (Object.keys(binding).sort().join(",") !== expectedKeys) throw new Error("Invalid binding");
    const result = binding as ProvisionedProjectDatabaseBinding;
    if (result.bootstrapContractSha256 !== request.bootstrapContractSha256) {
      throw new ProjectDatabaseProvisioningAdapterError("BOOTSTRAP_UNVERIFIED");
    }
    return Object.freeze({ ...result });
  } catch (error) {
    if (error instanceof ProjectDatabaseProvisioningAdapterError) throw error;
    throw new ProjectDatabaseProvisioningAdapterError("INVALID_BINDING");
  }
}

async function readBoundedBody(response: Response): Promise<string> {
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) {
    await response.body?.cancel().catch(() => undefined);
    throw new ProjectDatabaseProvisioningAdapterError("INVALID_BINDING");
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
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ProjectDatabaseProvisioningAdapterError("INVALID_BINDING");
      }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total).toString("utf8");
}

function validatedEndpoint(endpoint: URL, allowedHosts: ReadonlySet<string>, production: boolean): URL {
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      (production ? endpoint.protocol !== "https:" : !["https:", "http:"].includes(endpoint.protocol))) {
    throw new ConfigurationError("The project provisioning broker URL is invalid.");
  }
  const host = normalizedHost(endpoint.hostname);
  if (!allowedHosts.has(host) || (production && (isIP(host) !== 0 || host === "localhost" || !host.includes("."))) ||
      (production && endpoint.port && endpoint.port !== "443")) {
    throw new ConfigurationError("The project provisioning broker endpoint is not allowed.");
  }
  const normalized = new URL(endpoint.toString());
  normalized.hostname = host;
  return normalized;
}

function parseAllowedHosts(raw: string | undefined): ReadonlySet<string> {
  const values = (raw ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length < 1 || values.length > 20) throw new ConfigurationError("Provisioning broker allowlist is invalid.");
  return new Set(values.map(normalizedHost));
}

function normalizedHost(value: string): string {
  const host = value.toLowerCase().replace(/\.$/, "");
  if ((!HOSTNAME.test(host) && isIP(host) === 0) || host.includes("*")) {
    throw new ConfigurationError("Provisioning broker hostnames must be exact.");
  }
  return host;
}

function parseKey(value: unknown): ProvisioningBrokerSigningKey | undefined {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "keyId,secret" ||
      typeof value.keyId !== "string" || !KEY_ID.test(value.keyId) || typeof value.secret !== "string") return;
  const bytes = Buffer.byteLength(value.secret, "utf8");
  if (bytes < MIN_SECRET_BYTES || bytes > MAX_SECRET_BYTES || value.secret.includes("\0")) return;
  return Object.freeze({ keyId: value.keyId, secret: value.secret });
}

function abortable<T>(value: T | PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("Aborted"));
  return new Promise((resolve, reject) => {
    const aborted = () => { cleanup(); reject(new Error("Aborted")); };
    const cleanup = () => signal.removeEventListener("abort", aborted);
    signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve(value).then(
      (result) => { cleanup(); resolve(result); },
      (error: unknown) => { cleanup(); reject(error); },
    );
  });
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new ConfigurationError("Invalid timeout.");
  return value;
}
function isJson(value: string | null): boolean { return /^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(value ?? ""); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
