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
 * Darum ein eigener, enger Port. Es gibt **kein** `list`: wer auflisten kann,
 * kann ueber das Praefix eines fremden Mandanten auflisten, und die Liste der
 * Backups steht in der Control Plane unter Zeilensicherheit. Der Objektspeicher
 * ist hier eine Ablage, kein Verzeichnis.
 *
 * ## Integritaet
 *
 * Jedes Hochladen sendet `x-amz-checksum-sha256`; S3 (und versitygw im Stack)
 * weist einen Koerper ab, dessen Summe nicht passt. Jedes `get` rechnet die
 * Summe neu und vergleicht sie mit der, die der Aufrufer erwartet -- und zwar
 * **bevor** der Umschlag aufgeht. Dieselbe Reihenfolge wie im Dienst: ein
 * verstuemmeltes Artefakt soll das sagen und nicht wie ein Schluesselfehler
 * aussehen.
 *
 * ## Stueckweise (2.129)
 *
 * Seit 2.129 geht ein Backup als **Multipart-Upload** hinaus, weil der Dump als
 * Strom kommt und seine Groesse vorher niemand kennt. Hochgeladen wird mit
 * demselben Signierer und derselben Pruefsumme je Teil; der Abschluss nennt die
 * ETags in Reihenfolge, und S3 weist eine Liste ab, deren Nummern nicht
 * aufsteigen.
 *
 * **`put` gibt es nicht mehr.** Ein einzelner Schreibweg daneben waere eine
 * zweite Tuer in den Objektspeicher, und niemand im Produkt haette ihn gerufen;
 * das ist genau das Muster, das 2.73.0 an drei Stellen gefunden hat. Gelesen
 * wird dagegen weiter ganz (`get`, fuer Artefakte im Format von 2.73.0) **und**
 * in Bereichen (`getRange`, fuer den stueckweisen Weg).
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

  /** Eroeffnet einen Multipart-Upload und gibt seine Kennung. */
  async beginMultipart(key: string, signal?: AbortSignal): Promise<string> {
    assertKey(key);
    const response = await this.request("POST", key, undefined, {
      "content-type": "application/octet-stream",
    }, signal, { uploads: "" });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProjectDatabaseBackupObjectStoreError("OBJECT_STORE_UNAVAILABLE");
    }
    const uploadId = /<UploadId>([^<]{1,1024})<\/UploadId>/.exec(await response.text())?.[1];
    // Die Kennung geht spaeter in eine Query und wird darum hier auf eine Form
    // gebracht, bevor sie irgendwo hin geht.
    if (!uploadId || !/^[A-Za-z0-9+/=._~-]{1,1024}$/.test(uploadId)) {
      throw new ProjectDatabaseBackupObjectStoreError("OBJECT_STORE_UNAVAILABLE");
    }
    return uploadId;
  }

  async putPart(input: Readonly<{
    key: string; uploadId: string; partNumber: number; bytes: Buffer;
  }>, signal?: AbortSignal): Promise<Readonly<{ partNumber: number; etag: string }>> {
    assertKey(input.key);
    assertUploadId(input.uploadId);
    if (!Number.isSafeInteger(input.partNumber) || input.partNumber < 1 || input.partNumber > 10_000 ||
        input.bytes.length < 1 || input.bytes.length > this.maxObjectBytes) {
      throw new ProjectDatabaseBackupObjectStoreError("OBJECT_TOO_LARGE");
    }
    const response = await this.request("PUT", input.key, input.bytes, {
      "content-type": "application/octet-stream",
      "content-length": String(input.bytes.length),
      "x-amz-checksum-sha256": createHash("sha256").update(input.bytes).digest("base64"),
    }, signal, { partNumber: String(input.partNumber), uploadId: input.uploadId });
    const etag = response.headers.get("etag");
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok || !etag || !/^"?[A-Za-z0-9-]{1,254}"?$/.test(etag)) {
      throw new ProjectDatabaseBackupObjectStoreError("OBJECT_STORE_UNAVAILABLE");
    }
    return Object.freeze({ partNumber: input.partNumber, etag });
  }

  async completeMultipart(input: Readonly<{
    key: string; uploadId: string; parts: ReadonlyArray<Readonly<{ partNumber: number; etag: string }>>;
  }>, signal?: AbortSignal): Promise<void> {
    assertKey(input.key);
    assertUploadId(input.uploadId);
    if (input.parts.length < 1 || input.parts.length > 10_000) {
      throw new ProjectDatabaseBackupObjectStoreError("OBJECT_STORE_UNAVAILABLE");
    }
    let previous = 0;
    for (const part of input.parts) {
      if (!Number.isSafeInteger(part.partNumber) || part.partNumber <= previous ||
          !/^"?[A-Za-z0-9-]{1,254}"?$/.test(part.etag)) {
        throw new ProjectDatabaseBackupObjectStoreError("OBJECT_STORE_UNAVAILABLE");
      }
      previous = part.partNumber;
    }
    const body = Buffer.from(`<CompleteMultipartUpload>${input.parts.map((part) =>
      `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${
        part.etag.replace(/"/g, "&quot;")}</ETag></Part>`).join("")}</CompleteMultipartUpload>`, "utf8");
    const response = await this.request("POST", input.key, body, {
      "content-type": "application/xml",
      "content-length": String(body.length),
    }, signal, { uploadId: input.uploadId });
    // S3 kann 200 antworten und den Fehler in den Rumpf legen; dieselbe Lehre
    // wie im Storage-Provider. Wer nur den Status liest, haelt einen
    // abgebrochenen Abschluss fuer gelungen -- und haette dann ein Backup ohne
    // Bytes im Katalog.
    const text = await response.text().catch(() => "<Error>");
    if (!response.ok || text.includes("<Error>")) {
      throw new ProjectDatabaseBackupObjectStoreError("OBJECT_STORE_UNAVAILABLE");
    }
  }

  /**
   * Bricht einen Upload ab. Ein Fehlschlag hier ist kein Fehlschlag des Laufs:
   * was liegen bleibt, sind Teile ohne Objekt, und die raeumt die
   * Lebenszyklus-Regel des Buckets. Darum wirft die Methode nicht.
   */
  async abortMultipart(key: string, uploadId: string, signal?: AbortSignal): Promise<void> {
    try {
      assertKey(key);
      assertUploadId(uploadId);
      const response = await this.request("DELETE", key, undefined, {}, signal, { uploadId });
      await response.body?.cancel().catch(() => undefined);
    } catch {
      // bewusst still
    }
  }

  /**
   * Ein Bytebereich. Das ist die Seite, auf der die Wiederherstellung ohne das
   * Ganze im Speicher auskommt: sie holt Teil fuer Teil.
   *
   * Ein Server, der `Range` **nicht** befolgt, antwortet mit 200 und dem ganzen
   * Objekt. Das wird hier abgewiesen und nicht stillschweigend angenommen: sonst
   * zieht ein Leser bei jedem Teil das ganze Artefakt und merkt es nur am
   * Speicher.
   */
  async getRange(
    key: string, offset: number, length: number, signal?: AbortSignal,
  ): Promise<Buffer> {
    assertKey(key);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) ||
        length < 1 || length > this.maxObjectBytes) {
      throw new ProjectDatabaseBackupObjectStoreError("OBJECT_TOO_LARGE");
    }
    const response = await this.request("GET", key, undefined, {
      range: `bytes=${offset}-${offset + length - 1}`,
    }, signal);
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProjectDatabaseBackupObjectStoreError("OBJECT_NOT_FOUND");
    }
    if (response.status !== 206) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProjectDatabaseBackupObjectStoreError("OBJECT_STORE_UNAVAILABLE");
    }
    const bytes = await this.boundedBody(response);
    if (bytes.length !== length) {
      throw new ProjectDatabaseBackupObjectStoreError("OBJECT_CHECKSUM_MISMATCH");
    }
    return bytes;
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
    method: "PUT" | "GET" | "DELETE" | "POST",
    key: string,
    body: Buffer | undefined,
    extraHeaders: Record<string, string>,
    signal?: AbortSignal,
    query?: Record<string, string>,
  ): Promise<Response> {
    const url = new URL(this.endpoint);
    url.pathname = `/${encodeURIComponent(this.config.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
    // Die Query wird **vor** dem Signieren gesetzt: `signSigV4Request` nimmt
    // `url.search` in die kanonische Anfrage, und eine danach angehaengte
    // Angabe faellt beim Anbieter mit `SignatureDoesNotMatch`.
    for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
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

/**
 * Die Kennung eines Multipart-Uploads kommt vom Anbieter und geht in eine
 * Query. Sie wird darum auf eine Form gebracht, bevor sie dort landet -- auch
 * wenn `beginMultipart` sie schon geprueft hat: eine Kennung kann aus einer
 * Zeile kommen, die jemand anders geschrieben hat.
 */
function assertUploadId(uploadId: string): void {
  if (!/^[A-Za-z0-9+/=._~-]{1,1024}$/.test(uploadId)) {
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
