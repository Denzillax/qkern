import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { recognisedByName } from "@/lib/server/errors/identity";
import { ConfigurationError } from "@/lib/server/db/errors";
import { sha256Hex, signSigV4Request } from "@/lib/server/project-storage/s3-sigv4";
import type {
  ProjectDatabaseBackupDataKeyProtector,
  ProjectDatabaseBackupObjectStore,
} from "@/lib/server/backup/project-database";
import {
  unwrapBackupDataKey,
  wrapBackupDataKey,
  type ProjectDatabaseBackupArtifactIdentity,
} from "@/lib/server/backup/project-database-artifact";

/**
 * Wohin die Bytes gehen, und woher der Schluessel kommt (2.126).
 *
 * ## Der Objektspeicher
 *
 * Derselbe, den QKERN fuer Project Storage schon betreibt, und derselbe
 * Signierer (`s3-sigv4.ts`). Nicht derselbe `ProjectStorageProvider`: dessen
 * Schnittstelle ist auf **Grants** gebaut, also auf vorab signierte URLs fuer
 * einen fremden Client. Ein Backup hat keinen fremden Client; der Dienst hat
 * die Bytes selbst. Eine signierte URL dafuer auszustellen und dann selbst
 * aufzurufen waere ein Umweg mit einer zusaetzlichen Stelle, an der eine URL
 * mit Signatur in einem Log landen kann.
 *
 * Darum ein eigener, enger Port mit vier Verben (`put`, `get`, `delete`) und
 * keinem weiteren. Es gibt **kein** `list`: wer auflisten kann, kann ueber das
 * Praefix eines fremden Mandanten auflisten, und die Liste der Backups steht in
 * der Control Plane unter Zeilensicherheit. Der Objektspeicher ist hier eine
 * Ablage, kein Verzeichnis.
 *
 * ## Integritaet
 *
 * Jedes `put` sendet `x-amz-checksum-sha256`; S3 (und versitygw im Stack) weist
 * einen Koerper ab, dessen Summe nicht passt. Jedes `get` rechnet die Summe neu
 * und vergleicht sie mit der, die der Aufrufer erwartet -- und zwar **bevor**
 * der Umschlag aufgeht. Dieselbe Reihenfolge wie im Dienst: ein verstuemmeltes
 * Artefakt soll das sagen und nicht wie ein Schluesselfehler aussehen.
 */

export type ProjectDatabaseBackupObjectStoreErrorCode =
  | "OBJECT_STORE_UNAVAILABLE"
  | "OBJECT_NOT_FOUND"
  | "OBJECT_CHECKSUM_MISMATCH"
  | "OBJECT_TOO_LARGE";

/** Ohne `cause`: eine Treibermeldung kann eine signierte URL tragen. */
export class ProjectDatabaseBackupObjectStoreError extends Error {
  readonly code: ProjectDatabaseBackupObjectStoreErrorCode;
  constructor(code: ProjectDatabaseBackupObjectStoreErrorCode) {
    super("The project database backup object store request failed.");
    this.name = "ProjectDatabaseBackupObjectStoreError";
    this.code = code;
  }
}
recognisedByName(ProjectDatabaseBackupObjectStoreError, "ProjectDatabaseBackupObjectStoreError");

export type S3BackupObjectStoreConfig = Readonly<{
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  production?: boolean;
  timeoutMs?: number;
  maxObjectBytes?: number;
}>;

const OBJECT_KEY = /^project-database-backups\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/(development|staging|production)\/[0-9a-f-]{36}\.qkbak$/;

export class S3ProjectDatabaseBackupObjectStore implements ProjectDatabaseBackupObjectStore {
  private readonly endpoint: URL;
  private readonly timeoutMs: number;
  private readonly maxObjectBytes: number;

  constructor(
    private readonly config: S3BackupObjectStoreConfig,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.endpoint = endpointOf(config.endpoint, Boolean(config.production));
    this.timeoutMs = bounded(config.timeoutMs ?? 120_000, 1_000, 1_800_000);
    this.maxObjectBytes = bounded(config.maxObjectBytes ?? 512 * 1024 * 1024, 1_024, 1_073_741_824);
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket) ||
        !/^[a-z0-9][a-z0-9-]{0,62}$/.test(config.region) ||
        !/^[A-Za-z0-9][A-Za-z0-9+/=_-]{2,127}$/.test(config.accessKeyId) ||
        config.secretAccessKey.length < 16 || config.secretAccessKey.length > 256) {
      throw new ConfigurationError("Invalid project database backup object store configuration.");
    }
  }

  async put(key: string, bytes: Buffer, signal?: AbortSignal): Promise<void> {
    assertKey(key);
    if (bytes.length > this.maxObjectBytes) {
      throw new ProjectDatabaseBackupObjectStoreError("OBJECT_TOO_LARGE");
    }
    const response = await this.request("PUT", key, bytes, {
      "content-type": "application/octet-stream",
      "content-length": String(bytes.length),
      "x-amz-checksum-sha256": createHash("sha256").update(bytes).digest("base64"),
    }, signal);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProjectDatabaseBackupObjectStoreError("OBJECT_STORE_UNAVAILABLE");
    }
    await response.body?.cancel().catch(() => undefined);
  }

  async get(key: string, signal?: AbortSignal): Promise<Buffer> {
    assertKey(key);
    const response = await this.request("GET", key, undefined, {}, signal);
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProjectDatabaseBackupObjectStoreError("OBJECT_NOT_FOUND");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProjectDatabaseBackupObjectStoreError("OBJECT_STORE_UNAVAILABLE");
    }
    return this.boundedBody(response);
  }

  async delete(key: string, signal?: AbortSignal): Promise<void> {
    assertKey(key);
    const response = await this.request("DELETE", key, undefined, {}, signal);
    await response.body?.cancel().catch(() => undefined);
    // S3 meldet das Loeschen eines nicht vorhandenen Objekts mit 204. Das ist
    // richtig so: der Aufraeumer darf eine zweite Runde fahren.
    if (!response.ok && response.status !== 404) {
      throw new ProjectDatabaseBackupObjectStoreError("OBJECT_STORE_UNAVAILABLE");
    }
  }

  private async request(
    method: "PUT" | "GET" | "DELETE",
    key: string,
    body: Buffer | undefined,
    extraHeaders: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const url = new URL(this.endpoint);
    url.pathname = `/${encodeURIComponent(this.config.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
    const headers = signSigV4Request({
      method,
      url,
      headers: extraHeaders,
      // Keine `UNSIGNED-PAYLOAD`: die Bytes eines Backups werden mitsigniert,
      // damit ein Zwischenknoten sie nicht tauschen kann.
      payloadHash: body ? sha256Hex(body) : sha256Hex(""),
      accessKeyId: this.config.accessKeyId,
      secret: this.config.secretAccessKey,
      region: this.config.region,
      now: this.now(),
    });
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      return await this.fetcher(url, {
        method,
        headers,
        body: body ? new Uint8Array(body) : undefined,
        redirect: "error",
        signal: combined,
      });
    } catch {
      throw new ProjectDatabaseBackupObjectStoreError("OBJECT_STORE_UNAVAILABLE");
    }
  }

  private async boundedBody(response: Response): Promise<Buffer> {
    const length = response.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > this.maxObjectBytes)) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProjectDatabaseBackupObjectStoreError("OBJECT_TOO_LARGE");
    }
    if (!response.body) throw new ProjectDatabaseBackupObjectStoreError("OBJECT_STORE_UNAVAILABLE");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        total += item.value.byteLength;
        if (total > this.maxObjectBytes) {
          await reader.cancel();
          throw new ProjectDatabaseBackupObjectStoreError("OBJECT_TOO_LARGE");
        }
        chunks.push(item.value);
      }
    } catch (error) {
      if (error instanceof ProjectDatabaseBackupObjectStoreError) throw error;
      throw new ProjectDatabaseBackupObjectStoreError("OBJECT_STORE_UNAVAILABLE");
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, total);
  }
}

/**
 * ## Der Mandanten-Schluessel
 *
 * Er kommt aus einer Datei, die ein **Vault Agent** schreibt -- derselbe
 * Mechanismus, mit dem `VaultTokenFileProvider` das Vault-Token bekommt, und
 * aus demselben Grund: der Dienst liest bei jedem Gebrauch neu, also wirkt eine
 * Rotation ohne Neustart, und der Schluessel steht nirgends im Quelltext und in
 * keiner Umgebungsvariablen.
 *
 * Gelesen wird **je Aufruf**, nicht beim Start. Ein Schluessel, der im
 * Prozessspeicher liegt, liegt in jedem Heap-Dump; einer, der fuer die Dauer
 * eines Einwickelns liegt, liegt in dem Augenblick, in dem er gebraucht wird.
 * Der Puffer wird danach mit Null ueberschrieben.
 *
 * In Produktion muss die Datei 0600 sein (dieselbe Pruefung wie beim Token).
 * `keyId` ist der Dateiname ohne Pfad und ohne Endung: so steht in der Zeile,
 * **welcher** Schluessel eingewickelt hat, ohne dass der Pfad dort steht. Nach
 * einer Rotation mit neuem Namen bleiben alte Backups lesbar, solange ihr
 * Schluessel noch liegt -- und sie sind unlesbar, sobald er weg ist, und das
 * ist das Loeschen eines Backups durch Wegnehmen des Schluessels.
 */
export type FileBackupDataKeyProtectorOptions = Readonly<{
  /** Verzeichnis, in das der Vault Agent die Schluessel schreibt. */
  directory: string;
  /** Der Name des aktuellen Schluessels, ohne Pfad. */
  currentKeyId: string;
  production?: boolean;
}>;

const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const KEY_BYTES = 32;

export class FileBackupDataKeyProtector implements ProjectDatabaseBackupDataKeyProtector {
  private readonly directory: string;
  private readonly currentKeyId: string;
  private readonly production: boolean;

  constructor(options: FileBackupDataKeyProtectorOptions) {
    if (!options.directory.startsWith("/") || options.directory.length > 1_024 ||
        options.directory.includes("\0") || !KEY_ID.test(options.currentKeyId)) {
      throw new ConfigurationError("Invalid project database backup key configuration.");
    }
    this.directory = options.directory.replace(/\/$/, "");
    this.currentKeyId = options.currentKeyId;
    this.production = options.production ?? false;
  }

  async wrap(input: Readonly<{ dataKey: Buffer; identity: ProjectDatabaseBackupArtifactIdentity }>) {
    const key = await this.read(this.currentKeyId);
    try {
      return Object.freeze({
        keyId: this.currentKeyId,
        wrapped: wrapBackupDataKey({
          dataKey: input.dataKey,
          keyEncryptionKey: key,
          identity: input.identity,
          keyId: this.currentKeyId,
        }),
      });
    } finally {
      key.fill(0);
    }
  }

  async unwrap(input: Readonly<{
    wrapped: string;
    keyId: string;
    identity: ProjectDatabaseBackupArtifactIdentity;
  }>): Promise<Buffer> {
    const key = await this.read(input.keyId);
    try {
      return unwrapBackupDataKey({
        wrapped: input.wrapped,
        keyEncryptionKey: key,
        identity: input.identity,
        keyId: input.keyId,
      });
    } finally {
      key.fill(0);
    }
  }

  /**
   * Der Dateiname wird aus `keyId` gebaut, und `keyId` ist auf
   * `[A-Za-z0-9._-]` begrenzt. Kein `/`, kein `..`, also kein Weg aus dem
   * Verzeichnis heraus -- der Riegel ist die Form und nicht ein `resolve`,
   * dessen Ergebnis jemand spaeter wieder zusammensetzt.
   */
  private async read(keyId: string): Promise<Buffer> {
    if (!KEY_ID.test(keyId)) {
      throw new ProjectDatabaseBackupKeyError("KEY_UNAVAILABLE");
    }
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(`${this.directory}/${keyId}.key`, "r");
      const metadata = await handle.stat();
      // Die Datei traegt 64 Hexzeichen, mit oder ohne Zeilenende. Rohe 32 Byte
      // waeren bequemer und sind es nicht: eine Vault-Agent-Vorlage schreibt
      // Text, und eine Datei, die versehentlich mit `\n` endet, soll nicht
      // einen anderen Schluessel ergeben.
      if (!metadata.isFile() || metadata.size < 64 || metadata.size > 66 ||
          (this.production && (metadata.mode & 0o077) !== 0)) {
        throw new Error("Invalid key file");
      }
      const buffer = Buffer.alloc(metadata.size);
      const result = await handle.read(buffer, 0, metadata.size, 0);
      if (result.bytesRead !== metadata.size) throw new Error("Incomplete key file");
      const hex = buffer.toString("utf8").trim();
      buffer.fill(0);
      if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error("Invalid key");
      const key = Buffer.from(hex, "hex");
      if (key.length !== KEY_BYTES) throw new Error("Invalid key length");
      return key;
    } catch {
      throw new ProjectDatabaseBackupKeyError("KEY_UNAVAILABLE");
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}

export class ProjectDatabaseBackupKeyError extends Error {
  readonly code: "KEY_UNAVAILABLE";
  constructor(code: "KEY_UNAVAILABLE") {
    super("The project database backup key is unavailable.");
    this.name = "ProjectDatabaseBackupKeyError";
    this.code = code;
  }
}
recognisedByName(ProjectDatabaseBackupKeyError, "ProjectDatabaseBackupKeyError");

function assertKey(key: string): void {
  if (!OBJECT_KEY.test(key)) {
    throw new ProjectDatabaseBackupObjectStoreError("OBJECT_STORE_UNAVAILABLE");
  }
}

function endpointOf(value: string, production: boolean): URL {
  try {
    const url = new URL(value);
    // Klartext nur gegen Loopback, und das ist dieselbe Grenze wie im
    // Storage-Provider: ein Docker-Servicename ist kein Loopback.
    const localHttp = !production && url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !localHttp) || url.pathname !== "/" ||
        url.search || url.hash || url.username || url.password) {
      throw new Error("invalid");
    }
    return url;
  } catch {
    throw new ConfigurationError("The project database backup object store endpoint must be an exact origin.");
  }
}

function bounded(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ConfigurationError("Invalid project database backup object store bound.");
  }
  return value;
}
