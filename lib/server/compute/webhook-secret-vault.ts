import {
  VaultTokenFileProvider,
  type VaultTokenProvider,
} from "@/lib/server/migrations/connection-catalog-vault";
import {
  WebhookSigningError,
  type WebhookSecretProvider,
  type WebhookSigningKey,
} from "@/lib/server/compute/webhook-signer";

const SECRET_REF = /^vault:([A-Za-z0-9][A-Za-z0-9_-]{0,63}(?:\/[A-Za-z0-9][A-Za-z0-9_-]{0,63})*)$/;
const KEY_ID = /^[A-Za-z0-9._:-]{1,64}$/;
const VAULT_PATH = /^\/v1\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}(?:\/[A-Za-z0-9][A-Za-z0-9_-]{0,63})*$/;
const VAULT_NAMESPACE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}(?:\/[A-Za-z0-9][A-Za-z0-9_-]{0,63})*$/;
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const MAX_RESPONSE_BYTES = 16_384;
const MIN_SECRET_BYTES = 32;

export type VaultWebhookSecretProviderOptions = Readonly<{
  /** Exakte KV-v2-Mount-URL, zum Beispiel `https://vault.example.net/v1/secret`. */
  vaultKvUrl: URL;
  tokenProvider: VaultTokenProvider;
  namespace?: string;
  timeoutMs?: number;
  /**
   * Wie lange ein gelesener Schlüssel wiederverwendet wird.
   *
   * Ohne Cache träfe jede einzelne Zustellung den Vault; mit einem zu langen
   * Cache überlebt ein zurückgezogener Schlüssel seine Rotation. Der Standard
   * ist kurz genug, dass eine Rotation innerhalb einer Minute greift.
   */
  cacheTtlMs?: number;
  maxCachedKeys?: number;
  production?: boolean;
  fetchFn?: typeof fetch;
  now?: () => number;
}>;

type CacheEntry = { key: WebhookSigningKey; expiresAt: number };

/**
 * Signaturschlüssel aus HashiCorp Vault (KV Version 2).
 *
 * Bis Release 1.24 gab es nur den Umgebungs-Provider, und der weigert sich in
 * Produktion zu existieren — Webhooks konnten dort also gar nicht signiert
 * werden. Das war der letzte Grund, warum der Zustellprozess produktiv nicht
 * startbar war.
 *
 * Die Referenz `vault:<pfad>` wird auf `<mount>/data/<pfad>` abgebildet. Das
 * Geheimnis verlässt diesen Provider ausschliesslich als HMAC-Material; es
 * erscheint in keiner Fehlermeldung, keinem Log und keiner Antwort. Deshalb ist
 * `WebhookSigningError` bewusst ohne `cause`: Eine Vault-Meldung kann den Pfad
 * und damit die Struktur des Schlüsselspeichers verraten.
 */
export class VaultWebhookSecretProvider implements WebhookSecretProvider {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly vaultKvUrl: URL;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly maxCachedKeys: number;
  private readonly production: boolean;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly namespace?: string;

  constructor(private readonly options: VaultWebhookSecretProviderOptions) {
    this.production = options.production ?? false;
    this.vaultKvUrl = validatedMount(options.vaultKvUrl, this.production);
    this.timeoutMs = bounded(options.timeoutMs ?? 5_000, 100, 60_000);
    this.cacheTtlMs = bounded(options.cacheTtlMs ?? 60_000, 0, 3_600_000);
    this.maxCachedKeys = bounded(options.maxCachedKeys ?? 64, 1, 1_024);
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? Date.now;
    const namespace = options.namespace?.trim();
    if (namespace && (namespace.length > 256 || !VAULT_NAMESPACE.test(namespace))) {
      throw new WebhookSigningError();
    }
    this.namespace = namespace || undefined;
    if (typeof options.tokenProvider?.getToken !== "function") throw new WebhookSigningError();
  }

  async resolve(secretRef: string): Promise<WebhookSigningKey | null> {
    const path = vaultSecretPath(secretRef);
    if (path === null) return null;

    const cached = this.cache.get(path);
    if (cached && cached.expiresAt > this.now()) return cached.key;

    const key = await this.read(path);
    if (!key) {
      // Ein zurueckgezogener Schluessel darf nicht aus dem Cache weiterleben.
      this.cache.delete(path);
      return null;
    }
    if (this.cacheTtlMs > 0) {
      // Einfache Groessengrenze: Der aelteste Eintrag weicht. Ohne sie waere der
      // Cache ueber viele Webhooks hinweg unbegrenzt.
      if (this.cache.size >= this.maxCachedKeys) {
        const oldest = this.cache.keys().next();
        if (!oldest.done) this.cache.delete(oldest.value);
      }
      this.cache.set(path, { key, expiresAt: this.now() + this.cacheTtlMs });
    }
    return key;
  }

  private async read(path: string): Promise<WebhookSigningKey | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const token = await this.options.tokenProvider.getToken({ signal: controller.signal });
      if (typeof token !== "string" || token.length < 8) throw new WebhookSigningError();

      const headers: Record<string, string> = {
        accept: "application/json",
        "x-vault-token": token,
      };
      if (this.namespace) headers["x-vault-namespace"] = this.namespace;

      const url = new URL(this.vaultKvUrl.toString());
      url.pathname = `${this.vaultKvUrl.pathname}/data/${path}`;
      const response = await this.fetchFn(url, {
        method: "GET",
        headers,
        cache: "no-store",
        // Eine Umleitung koennte den Token an ein fremdes Ziel tragen.
        redirect: "error",
        signal: controller.signal,
      });

      // 404 ist die Antwort auf eine Referenz, die es nicht gibt — kein Fehler,
      // sondern die ehrliche Auskunft „kenne ich nicht".
      if (response.status === 404) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      if (!response.ok || !isJson(response.headers.get("content-type"))) {
        await response.body?.cancel().catch(() => undefined);
        throw new WebhookSigningError();
      }
      return parseKey(await readBounded(response, MAX_RESPONSE_BYTES));
    } catch (error) {
      if (error instanceof WebhookSigningError) throw error;
      // Pfad, Token und Vault-Meldung bleiben draussen.
      throw new WebhookSigningError();
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Baut den Provider aus der Umgebung, oder gibt `null` zurück, wenn kein Vault
 * konfiguriert ist. Ein halb konfigurierter Vault ist ein Fehler, kein Fallback.
 */
export function createVaultWebhookSecretProviderFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): VaultWebhookSecretProvider | null {
  const raw = env.QKERN_WEBHOOK_VAULT_KV_URL?.trim();
  const tokenFile = env.QKERN_VAULT_TOKEN_FILE?.trim();
  if (!raw && !tokenFile) return null;
  if (!raw || !tokenFile) throw new WebhookSigningError();

  const production = env.NODE_ENV === "production";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookSigningError();
  }
  return new VaultWebhookSecretProvider({
    vaultKvUrl: url,
    tokenProvider: new VaultTokenFileProvider(tokenFile, { production }),
    namespace: env.QKERN_VAULT_NAMESPACE,
    timeoutMs: integer(env.QKERN_WEBHOOK_VAULT_TIMEOUT_MS, 5_000),
    cacheTtlMs: integer(env.QKERN_WEBHOOK_VAULT_CACHE_TTL_MS, 60_000),
    production,
  });
}

function parseKey(raw: string): WebhookSigningKey {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.data) || !isRecord(parsed.data.data)) {
      throw new Error("shape");
    }
    const { keyId, secret } = parsed.data.data;
    if (typeof keyId !== "string" || !KEY_ID.test(keyId) || typeof secret !== "string") {
      throw new Error("shape");
    }
    const material = Buffer.from(secret, "base64url");
    // Ein zu kurzer Schluessel waere ein stiller Rueckschritt gegenueber dem
    // Umgebungs-Provider, der dieselbe Grenze zieht.
    if (material.length < MIN_SECRET_BYTES) throw new Error("weak");
    return Object.freeze({ keyId, secret: material });
  } catch {
    throw new WebhookSigningError();
  }
}

/**
 * Die einzige Pfadregel fuer Vault-Referenzen: `vault:` und danach Segmente
 * aus Buchstaben, Ziffern, `_` und `-`, durch `/` getrennt. Kein `..`, kein
 * fuehrender Schraegstrich, keine Query. Alles darunter liegt unter dem fest
 * konfigurierten KV-Mount; eine Referenz kann ihn nicht verlassen.
 */
export function vaultSecretPath(secretRef: string): string | null {
  if (typeof secretRef !== "string") return null;
  const match = SECRET_REF.exec(secretRef);
  return match ? match[1] : null;
}

export function validVaultNamespace(namespace: string): boolean {
  return namespace.length <= 256 && VAULT_NAMESPACE.test(namespace);
}

export function validatedMount(input: URL, production: boolean): URL {
  if (!(input instanceof URL)) throw new WebhookSigningError();
  const url = new URL(input.toString());
  const path = url.pathname.replace(/\/$/, "");
  if (url.username || url.password || url.search || url.hash ||
      !HOSTNAME.test(url.hostname) || !VAULT_PATH.test(path) ||
      (production ? url.protocol !== "https:" : !["https:", "http:"].includes(url.protocol))) {
    throw new WebhookSigningError();
  }
  url.pathname = path;
  return url;
}

export async function readBounded(response: Response, maximumBytes: number): Promise<string> {
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) {
    await response.body?.cancel().catch(() => undefined);
    throw new WebhookSigningError();
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
        throw new WebhookSigningError();
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

export function isJson(contentType: string | null): boolean {
  return /^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(contentType ?? "");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new WebhookSigningError();
  return value;
}

function integer(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new WebhookSigningError();
  return value;
}
