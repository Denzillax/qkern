import { recognisedByName } from "@/lib/server/errors/identity";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { ConfigurationError } from "@/lib/server/db/errors";

export type ProjectStorageUploadGrant = {
  method: "POST";
  url: string;
  fields: Record<string, string>;
  expiresAt: Date;
};

const MAX_SIGNED_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

export type ProjectStorageDownloadGrant = {
  method: "GET";
  url: string;
  expiresAt: Date;
};

export type ProjectStorageProviderObject = {
  sizeBytes: number;
  contentType: string;
  checksumSha256: string;
  etag: string | null;
};

export interface ProjectStorageProvider {
  createUploadGrant(input: {
    providerKey: string;
    contentType: string;
    checksumSha256: string;
    sizeBytes: number;
    expiresAt: Date;
  }): Promise<ProjectStorageUploadGrant>;
  createDownloadGrant(input: {
    providerKey: string;
    expiresAt: Date;
    downloadName?: string;
  }): Promise<ProjectStorageDownloadGrant>;
  headObject(providerKey: string, signal?: AbortSignal): Promise<ProjectStorageProviderObject | null>;
  deleteObject(providerKey: string, signal?: AbortSignal): Promise<void>;
  /**
   * Fortsetzbare Uploads in Teilen — Sprosse 3 der Paritaetsleiter.
   *
   * Die Integritaet traegt der Provider je Teil: Jede Teil-URL signiert die
   * SHA-256-Pruefsumme genau dieses Teils als Pflicht-Header mit, und S3 weist
   * einen Teil ab, dessen Bytes nicht dazu passen. Ein Client kann nach einem
   * Abbruch beim naechsten Teil weitermachen, ohne dass ein bereits
   * hochgeladener Teil verloren waere.
   */
  createMultipartUpload(input: {
    providerKey: string;
    contentType: string;
  }, signal?: AbortSignal): Promise<{ uploadId: string }>;
  createPartUploadGrant(input: {
    providerKey: string;
    uploadId: string;
    partNumber: number;
    checksumSha256: string;
    expiresAt: Date;
  }): Promise<ProjectStoragePartUploadGrant>;
  completeMultipartUpload(input: {
    providerKey: string;
    uploadId: string;
    parts: ReadonlyArray<{ partNumber: number; etag: string }>;
  }, signal?: AbortSignal): Promise<void>;
  abortMultipartUpload(input: {
    providerKey: string;
    uploadId: string;
  }, signal?: AbortSignal): Promise<void>;
  /**
   * Begonnene, nicht abgeschlossene Multipart-Uploads unter einem Praefix.
   *
   * Das ist das Netz fuer alle Strandungswege: Absturz zwischen Provider-Start
   * und Reservierung, still verfallene Reservierungen, fehlgeschlagene
   * Abbrueche. Eine Seite von hoechstens 1000 Eintraegen je Aufruf — der
   * Aufraeumer laeuft wiederholt, nicht erschoepfend.
   */
  listMultipartUploads(input: {
    keyPrefix: string;
  }, signal?: AbortSignal): Promise<Array<{
    providerKey: string;
    uploadId: string;
    initiatedAt: Date;
  }>>;
}

export type ProjectStoragePartUploadGrant = {
  method: "PUT";
  url: string;
  /** Muss der Client unveraendert mitsenden; die Pruefsumme ist signiert. */
  headers: Record<string, string>;
  expiresAt: Date;
};

export type ProjectStorageScanVerdict = "clean" | "infected" | "pending";

export interface ProjectStorageScanner {
  scan(input: {
    providerKey: string;
    contentType: string;
    sizeBytes: number;
    checksumSha256: string;
  }, signal?: AbortSignal): Promise<ProjectStorageScanVerdict>;
}

export class QuarantineOnlyProjectStorageScanner implements ProjectStorageScanner {
  async scan(): Promise<"pending"> { return "pending"; }
}

export class ProjectStorageProviderError extends Error {
  readonly code = "STORAGE_PROVIDER_UNAVAILABLE";
  constructor() { super("STORAGE_PROVIDER_UNAVAILABLE"); this.name = "ProjectStorageProviderError"; }
}
recognisedByName(ProjectStorageProviderError, "ProjectStorageProviderError");

export type S3ProjectStorageCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

export interface S3ProjectStorageCredentialsProvider {
  getCredentials(): Promise<S3ProjectStorageCredentials>;
}

export class StaticS3ProjectStorageCredentialsProvider implements S3ProjectStorageCredentialsProvider {
  constructor(private readonly credentials: S3ProjectStorageCredentials) {
    assertCredentials(credentials);
  }
  async getCredentials() { return { ...this.credentials }; }
}

export type S3ProjectStorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  production?: boolean;
  timeoutMs?: number;
};

export class S3ProjectStorageProvider implements ProjectStorageProvider {
  private readonly endpoint: URL;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: S3ProjectStorageConfig,
    private readonly credentials: S3ProjectStorageCredentialsProvider,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.endpoint = storageEndpoint(config.endpoint, Boolean(config.production));
    this.timeoutMs = boundedInteger(config.timeoutMs ?? 10_000, 500, 30_000);
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket) ||
        !/^[a-z0-9][a-z0-9-]{0,62}$/.test(config.region)) {
      throw new ConfigurationError("Invalid S3 Project Storage configuration.");
    }
  }

  async createUploadGrant(input: {
    providerKey: string;
    contentType: string;
    checksumSha256: string;
    sizeBytes: number;
    expiresAt: Date;
  }): Promise<ProjectStorageUploadGrant> {
    assertProviderKey(input.providerKey);
    const credentials = await this.safeCredentials();
    const now = this.now();
    const ttlSeconds = grantTtlSeconds(now, input.expiresAt);
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > 5 * 1024 ** 3 ||
        !validChecksum(input.checksumSha256) || !validContentType(input.contentType)) {
      throw new ProjectStorageProviderError();
    }
    const date = amzDate(now);
    const day = date.slice(0, 8);
    const credentialScope = `${day}/${this.config.region}/s3/aws4_request`;
    const policy = {
      expiration: input.expiresAt.toISOString(),
      conditions: [
        { bucket: this.config.bucket },
        { key: input.providerKey },
        { "Content-Type": input.contentType },
        { "x-amz-checksum-sha256": input.checksumSha256 },
        { "x-amz-algorithm": "AWS4-HMAC-SHA256" },
        { "x-amz-credential": `${credentials.accessKeyId}/${credentialScope}` },
        { "x-amz-date": date },
        ...(credentials.sessionToken ? [{ "x-amz-security-token": credentials.sessionToken }] : []),
        // S3 applies this condition to the complete multipart request, not only
        // the file part. The exact object byte size is therefore verified by
        // the mandatory provider HEAD before metadata is committed.
        ["content-length-range", input.sizeBytes, input.sizeBytes + MAX_SIGNED_MULTIPART_OVERHEAD_BYTES],
      ],
    };
    const encodedPolicy = Buffer.from(JSON.stringify(policy), "utf8").toString("base64");
    const signature = createHmac("sha256", signingKey(credentials.secretAccessKey, day, this.config.region))
      .update(encodedPolicy, "utf8").digest("hex");
    const fields: Record<string, string> = {
      key: input.providerKey,
      "Content-Type": input.contentType,
      "x-amz-checksum-sha256": input.checksumSha256,
      "x-amz-algorithm": "AWS4-HMAC-SHA256",
      "x-amz-credential": `${credentials.accessKeyId}/${credentialScope}`,
      "x-amz-date": date,
      policy: encodedPolicy,
      "x-amz-signature": signature,
      ...(credentials.sessionToken ? { "x-amz-security-token": credentials.sessionToken } : {}),
    };
    return {
      method: "POST",
      url: objectBucketUrl(this.endpoint, this.config.bucket).toString(),
      fields,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1_000),
    };
  }

  async createDownloadGrant(input: {
    providerKey: string;
    expiresAt: Date;
    downloadName?: string;
  }): Promise<ProjectStorageDownloadGrant> {
    assertProviderKey(input.providerKey);
    const credentials = await this.safeCredentials();
    const now = this.now();
    const ttlSeconds = grantTtlSeconds(now, input.expiresAt);
    const date = amzDate(now);
    const day = date.slice(0, 8);
    const scope = `${day}/${this.config.region}/s3/aws4_request`;
    const query: Record<string, string> = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${credentials.accessKeyId}/${scope}`,
      "X-Amz-Date": date,
      "X-Amz-Expires": String(ttlSeconds),
      "X-Amz-SignedHeaders": "host",
      ...(credentials.sessionToken ? { "X-Amz-Security-Token": credentials.sessionToken } : {}),
    };
    if (input.downloadName) {
      query["response-content-disposition"] = `attachment; filename="${safeDownloadName(input.downloadName)}"`;
    }
    const url = objectUrl(this.endpoint, this.config.bucket, input.providerKey);
    const canonicalQuery = canonicalQueryString(query);
    const canonicalRequest = ["GET", url.pathname, canonicalQuery, `host:${canonicalHost(url)}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", date, scope, sha256Hex(canonicalRequest)].join("\n");
    query["X-Amz-Signature"] = createHmac("sha256", signingKey(credentials.secretAccessKey, day, this.config.region))
      .update(stringToSign, "utf8").digest("hex");
    url.search = canonicalQueryString(query);
    return { method: "GET", url: url.toString(), expiresAt: new Date(now.getTime() + ttlSeconds * 1_000) };
  }

  async headObject(providerKey: string, signal?: AbortSignal): Promise<ProjectStorageProviderObject | null> {
    assertProviderKey(providerKey);
    const response = await this.signedRequest("HEAD", providerKey, { "x-amz-checksum-mode": "ENABLED" }, signal);
    if (response.status === 404) return null;
    if (!response.ok) throw new ProjectStorageProviderError();
    const sizeBytes = Number(response.headers.get("content-length"));
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    const checksumSha256 = response.headers.get("x-amz-checksum-sha256")?.trim() ?? "";
    const etag = response.headers.get("etag")?.replace(/^"|"$/g, "").slice(0, 256) || null;
    // Multipart-Objekte tragen keine oder eine zusammengesetzte Pruefsumme —
    // MinIO liefert den Header dort gar nicht. Ein fehlender Wert wird leer
    // durchgereicht statt abgewiesen: Die Zusage des einfachen Wegs traegt
    // der Gleichheitsvergleich im Dienst (leer ist niemals gleich einer
    // deklarierten Summe), und die Ganzdatei-Summe eines Multipart-Objekts
    // rechnet der Scanner beim Abschluss nach.
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || !validContentType(contentType) ||
        (checksumSha256 !== "" && !/^[A-Za-z0-9+/]{43}=(-\d{1,5})?$/.test(checksumSha256))) {
      throw new ProjectStorageProviderError();
    }
    return { sizeBytes, contentType, checksumSha256, etag };
  }

  async deleteObject(providerKey: string, signal?: AbortSignal): Promise<void> {
    assertProviderKey(providerKey);
    const response = await this.signedRequest("DELETE", providerKey, {}, signal);
    if (!response.ok && response.status !== 404) throw new ProjectStorageProviderError();
  }

  async createMultipartUpload(input: {
    providerKey: string;
    contentType: string;
  }, signal?: AbortSignal): Promise<{ uploadId: string }> {
    assertProviderKey(input.providerKey);
    if (!validContentType(input.contentType)) throw new ProjectStorageProviderError();
    const response = await this.signedApiRequest("POST", input.providerKey, { uploads: "" }, "", {
      "content-type": input.contentType,
    }, signal);
    if (!response.ok) throw new ProjectStorageProviderError();
    const uploadId = /<UploadId>([^<]{1,1024})<[/]UploadId>/.exec(await response.text())?.[1];
    if (!uploadId) throw new ProjectStorageProviderError();
    return { uploadId };
  }

  async createPartUploadGrant(input: {
    providerKey: string;
    uploadId: string;
    partNumber: number;
    checksumSha256: string;
    expiresAt: Date;
  }): Promise<ProjectStoragePartUploadGrant> {
    assertProviderKey(input.providerKey);
    assertUploadId(input.uploadId);
    if (!Number.isInteger(input.partNumber) || input.partNumber < 1 || input.partNumber > 10_000 ||
        !validChecksum(input.checksumSha256)) {
      throw new ProjectStorageProviderError();
    }
    const credentials = await this.safeCredentials();
    const now = this.now();
    const ttlSeconds = grantTtlSeconds(now, input.expiresAt);
    const date = amzDate(now);
    const day = date.slice(0, 8);
    const scope = `${day}/${this.config.region}/s3/aws4_request`;
    const url = objectUrl(this.endpoint, this.config.bucket, input.providerKey);
    // Die Pruefsumme des Teils ist ein **signierter** Header: Der Client muss
    // sie mitsenden, und der Provider weist Bytes ab, die nicht dazu passen.
    // Die Mutationsprobe dieses Releases nimmt genau diesen Header aus der
    // Signatur — dann besteht ein manipulierter Teil.
    const signedHeaderNames = "host;x-amz-checksum-sha256";
    const query: Record<string, string> = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${credentials.accessKeyId}/${scope}`,
      "X-Amz-Date": date,
      "X-Amz-Expires": String(ttlSeconds),
      "X-Amz-SignedHeaders": signedHeaderNames,
      partNumber: String(input.partNumber),
      uploadId: input.uploadId,
      ...(credentials.sessionToken ? { "X-Amz-Security-Token": credentials.sessionToken } : {}),
    };
    const canonicalHeaders = `host:${canonicalHost(url)}\nx-amz-checksum-sha256:${input.checksumSha256}\n`;
    const canonicalRequest = ["PUT", url.pathname, canonicalQueryString(query),
      canonicalHeaders, signedHeaderNames, "UNSIGNED-PAYLOAD"].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", date, scope, sha256Hex(canonicalRequest)].join("\n");
    query["X-Amz-Signature"] = createHmac("sha256", signingKey(credentials.secretAccessKey, day, this.config.region))
      .update(stringToSign, "utf8").digest("hex");
    url.search = canonicalQueryString(query);
    return {
      method: "PUT",
      url: url.toString(),
      headers: { "x-amz-checksum-sha256": input.checksumSha256 },
      expiresAt: new Date(now.getTime() + ttlSeconds * 1_000),
    };
  }

  async completeMultipartUpload(input: {
    providerKey: string;
    uploadId: string;
    parts: ReadonlyArray<{ partNumber: number; etag: string }>;
  }, signal?: AbortSignal): Promise<void> {
    assertProviderKey(input.providerKey);
    assertUploadId(input.uploadId);
    if (input.parts.length < 1 || input.parts.length > 10_000) throw new ProjectStorageProviderError();
    let previous = 0;
    for (const part of input.parts) {
      if (!Number.isInteger(part.partNumber) || part.partNumber <= previous || part.partNumber > 10_000 ||
          !/^[A-Za-z0-9"-]{1,256}$/.test(part.etag)) {
        throw new ProjectStorageProviderError();
      }
      previous = part.partNumber;
    }
    const body = `<CompleteMultipartUpload>${input.parts.map((part) =>
      `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${part.etag.replace(/"/g, "&quot;")}</ETag></Part>`,
    ).join("")}</CompleteMultipartUpload>`;
    const response = await this.signedApiRequest("POST", input.providerKey,
      { uploadId: input.uploadId }, body, { "content-type": "application/xml" }, signal);
    // S3 kann 200 antworten und den Fehler in den Rumpf legen. Wer nur den
    // Status liest, haelt einen abgebrochenen Abschluss fuer gelungen.
    const text = await response.text();
    if (!response.ok || text.includes("<Error>")) throw new ProjectStorageProviderError();
  }

  async abortMultipartUpload(input: {
    providerKey: string;
    uploadId: string;
  }, signal?: AbortSignal): Promise<void> {
    assertProviderKey(input.providerKey);
    assertUploadId(input.uploadId);
    const response = await this.signedApiRequest("DELETE", input.providerKey,
      { uploadId: input.uploadId }, "", {}, signal);
    if (!response.ok && response.status !== 404) throw new ProjectStorageProviderError();
  }

  async listMultipartUploads(input: {
    keyPrefix: string;
  }, signal?: AbortSignal): Promise<Array<{ providerKey: string; uploadId: string; initiatedAt: Date }>> {
    assertKeyPrefix(input.keyPrefix);
    // Bucket-weiter Aufruf: der leere Schluessel signiert die Bucket-URL.
    // Der Praefix wird bewusst NICHT als Server-Parameter gesendet: MinIO
    // beantwortet ListMultipartUploads mit Verzeichnis-Praefixen leer und
    // liefert nur ohne Praefix oder mit vollem Objektschluessel Eintraege.
    // Gefiltert wird deshalb clientseitig ueber der einen Seite.
    const response = await this.signedApiRequest("GET", "", {
      uploads: "",
      "max-uploads": "1000",
    }, "", {}, signal);
    if (!response.ok) throw new ProjectStorageProviderError();
    const text = await response.text();
    const uploads: Array<{ providerKey: string; uploadId: string; initiatedAt: Date }> = [];
    for (const match of text.matchAll(/<Upload>([\s\S]{1,8192}?)<[/]Upload>/g)) {
      const key = /<Key>([^<]{1,2048})<[/]Key>/.exec(match[1])?.[1];
      const uploadId = /<UploadId>([^<]{1,1024})<[/]UploadId>/.exec(match[1])?.[1];
      const initiated = /<Initiated>([^<]{1,64})<[/]Initiated>/.exec(match[1])?.[1];
      const initiatedAt = initiated ? new Date(initiated) : null;
      if (!key || !uploadId || !initiatedAt || Number.isNaN(initiatedAt.getTime())) {
        throw new ProjectStorageProviderError();
      }
      if (!key.startsWith(input.keyPrefix)) continue;
      uploads.push({ providerKey: key, uploadId, initiatedAt });
    }
    return uploads;
  }

  /** Signierter S3-API-Aufruf mit Query und Rumpf — fuer die Multipart-Verben. */
  private async signedApiRequest(
    method: "GET" | "POST" | "DELETE",
    providerKey: string,
    query: Record<string, string>,
    body: string,
    extraHeaders: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const credentials = await this.safeCredentials();
    const now = this.now();
    const date = amzDate(now);
    const day = date.slice(0, 8);
    const scope = `${day}/${this.config.region}/s3/aws4_request`;
    const url = providerKey === ""
      ? objectBucketUrl(this.endpoint, this.config.bucket)
      : objectUrl(this.endpoint, this.config.bucket, providerKey);
    const payloadHash = sha256Hex(body);
    const headers: Record<string, string> = {
      host: canonicalHost(url),
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": date,
      ...extraHeaders,
      ...(credentials.sessionToken ? { "x-amz-security-token": credentials.sessionToken } : {}),
    };
    const headerNames = Object.keys(headers).map((name) => name.toLowerCase()).sort();
    const canonicalHeaders = headerNames.map((name) => `${name}:${headers[name].trim()}\n`).join("");
    const signedHeaders = headerNames.join(";");
    const canonicalQuery = canonicalQueryString(query);
    const canonicalRequest = [method, url.pathname, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", date, scope, sha256Hex(canonicalRequest)].join("\n");
    const signature = createHmac("sha256", signingKey(credentials.secretAccessKey, day, this.config.region))
      .update(stringToSign, "utf8").digest("hex");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    url.search = canonicalQuery;
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      return await this.fetcher(url, {
        method, headers, body: body === "" ? undefined : body, redirect: "error", signal: combined,
      });
    } catch {
      throw new ProjectStorageProviderError();
    }
  }

  private async signedRequest(
    method: "HEAD" | "DELETE",
    providerKey: string,
    extraHeaders: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const credentials = await this.safeCredentials();
    const now = this.now();
    const date = amzDate(now);
    const day = date.slice(0, 8);
    const scope = `${day}/${this.config.region}/s3/aws4_request`;
    const url = objectUrl(this.endpoint, this.config.bucket, providerKey);
    const payloadHash = sha256Hex("");
    const headers: Record<string, string> = {
      host: canonicalHost(url),
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": date,
      ...extraHeaders,
      ...(credentials.sessionToken ? { "x-amz-security-token": credentials.sessionToken } : {}),
    };
    const headerNames = Object.keys(headers).map((name) => name.toLowerCase()).sort();
    const canonicalHeaders = headerNames.map((name) => `${name}:${headers[name].trim()}\n`).join("");
    const signedHeaders = headerNames.join(";");
    const canonicalRequest = [method, url.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", date, scope, sha256Hex(canonicalRequest)].join("\n");
    const signature = createHmac("sha256", signingKey(credentials.secretAccessKey, day, this.config.region))
      .update(stringToSign, "utf8").digest("hex");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      return await this.fetcher(url, { method, headers, redirect: "error", signal: combined });
    } catch {
      throw new ProjectStorageProviderError();
    }
  }

  private async safeCredentials() {
    try {
      const credentials = await this.credentials.getCredentials();
      assertCredentials(credentials);
      return credentials;
    } catch {
      throw new ProjectStorageProviderError();
    }
  }
}

export class MemoryProjectStorageProvider implements ProjectStorageProvider {
  private readonly objects = new Map<string, ProjectStorageProviderObject>();
  private readonly secret = randomBytes(32);

  constructor(private readonly baseUrl = "https://objects.qkern.test", private readonly now: () => Date = () => new Date()) {}

  async createUploadGrant(input: {
    providerKey: string; contentType: string; checksumSha256: string; sizeBytes: number; expiresAt: Date;
  }): Promise<ProjectStorageUploadGrant> {
    assertProviderKey(input.providerKey);
    const expires = grantTtlSeconds(this.now(), input.expiresAt);
    const expiry = Math.floor(this.now().getTime() / 1_000) + expires;
    const fields: Record<string, string> = {
      key: input.providerKey,
      "Content-Type": input.contentType,
      "x-qkern-size": String(input.sizeBytes),
      "x-qkern-checksum-sha256": input.checksumSha256,
      "x-qkern-expires": String(expiry),
    };
    fields["x-qkern-signature"] = this.signature("POST", input.providerKey, expiry);
    return { method: "POST", url: this.baseUrl, fields, expiresAt: new Date(expiry * 1_000) };
  }

  async createDownloadGrant(input: { providerKey: string; expiresAt: Date; downloadName?: string }) {
    assertProviderKey(input.providerKey);
    const ttl = grantTtlSeconds(this.now(), input.expiresAt);
    const expiry = Math.floor(this.now().getTime() / 1_000) + ttl;
    const url = new URL(`${this.baseUrl}/${input.providerKey.split("/").map(encodeURIComponent).join("/")}`);
    url.searchParams.set("expires", String(expiry));
    url.searchParams.set("signature", this.signature("GET", input.providerKey, expiry));
    if (input.downloadName) url.searchParams.set("download", safeDownloadName(input.downloadName));
    return { method: "GET" as const, url: url.toString(), expiresAt: new Date(expiry * 1_000) };
  }

  async headObject(providerKey: string) { return this.objects.get(providerKey) ?? null; }
  async deleteObject(providerKey: string) { this.objects.delete(providerKey); }

  putForTest(providerKey: string, object: ProjectStorageProviderObject) {
    assertProviderKey(providerKey);
    this.objects.set(providerKey, { ...object });
  }

  /**
   * Dieselben Zusagen wie der S3-Adapter, ohne Netz: Teile sind nummeriert,
   * ein Abschluss verlangt genau die begonnenen Teile in aufsteigender
   * Ordnung, ein Abbruch laesst nichts zurueck.
   */
  private readonly multipart = new Map<string, {
    providerKey: string; contentType: string; initiatedAt: Date; parts: Map<number, string>;
  }>();

  async createMultipartUpload(input: { providerKey: string; contentType: string }) {
    assertProviderKey(input.providerKey);
    const uploadId = randomBytes(16).toString("hex");
    this.multipart.set(uploadId, {
      providerKey: input.providerKey, contentType: input.contentType,
      initiatedAt: this.now(), parts: new Map(),
    });
    return { uploadId };
  }

  async listMultipartUploads(input: { keyPrefix: string }) {
    assertKeyPrefix(input.keyPrefix);
    return [...this.multipart.entries()]
      .filter(([, upload]) => upload.providerKey.startsWith(input.keyPrefix))
      .map(([uploadId, upload]) => ({
        providerKey: upload.providerKey, uploadId, initiatedAt: new Date(upload.initiatedAt),
      }));
  }

  async createPartUploadGrant(input: {
    providerKey: string; uploadId: string; partNumber: number; checksumSha256: string; expiresAt: Date;
  }): Promise<ProjectStoragePartUploadGrant> {
    const upload = this.multipart.get(input.uploadId);
    if (!upload || upload.providerKey !== input.providerKey ||
        !Number.isInteger(input.partNumber) || input.partNumber < 1 || input.partNumber > 10_000) {
      throw new ProjectStorageProviderError();
    }
    const ttl = grantTtlSeconds(this.now(), input.expiresAt);
    // Der Memory-Port laedt nichts wirklich hoch; der ETag entsteht beim
    // Ausstellen und gilt als "Teil liegt vor", sobald der Grant existiert.
    upload.parts.set(input.partNumber, `"memory-${input.partNumber}-${input.checksumSha256.slice(0, 8)}"`);
    return {
      method: "PUT",
      url: `${this.baseUrl}/${input.providerKey}?partNumber=${input.partNumber}&uploadId=${input.uploadId}`,
      headers: { "x-amz-checksum-sha256": input.checksumSha256 },
      expiresAt: new Date(this.now().getTime() + ttl * 1_000),
    };
  }

  async completeMultipartUpload(input: {
    providerKey: string; uploadId: string; parts: ReadonlyArray<{ partNumber: number; etag: string }>;
  }) {
    const upload = this.multipart.get(input.uploadId);
    if (!upload || upload.providerKey !== input.providerKey || input.parts.length < 1) {
      throw new ProjectStorageProviderError();
    }
    let previous = 0;
    for (const part of input.parts) {
      if (part.partNumber <= previous || upload.parts.get(part.partNumber) !== part.etag) {
        throw new ProjectStorageProviderError();
      }
      previous = part.partNumber;
    }
    this.multipart.delete(input.uploadId);
  }

  async abortMultipartUpload(input: { providerKey: string; uploadId: string }) {
    const upload = this.multipart.get(input.uploadId);
    if (upload && upload.providerKey === input.providerKey) this.multipart.delete(input.uploadId);
  }

  validateGrant(method: "GET" | "POST", providerKey: string, expiry: number, signature: string, now = this.now()) {
    const expected = this.signature(method, providerKey, expiry);
    const presented = Buffer.from(signature, "hex");
    const valid = expiry > Math.floor(now.getTime() / 1_000) && presented.length === 32 &&
      timingSafeEqual(presented, Buffer.from(expected, "hex"));
    return valid;
  }

  private signature(method: string, key: string, expiry: number) {
    return createHmac("sha256", this.secret).update(`${method}\n${key}\n${expiry}`, "utf8").digest("hex");
  }
}

function storageEndpoint(value: string, production: boolean): URL {
  try {
    const url = new URL(value);
    const localHttp = !production && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !localHttp) || url.pathname !== "/" || url.search || url.hash ||
        url.username || url.password || (production && url.port && url.port !== "443")) throw new Error("invalid");
    return url;
  } catch {
    throw new ConfigurationError("QKERN_PROJECT_STORAGE_S3_ENDPOINT must be an exact HTTPS origin.");
  }
}

function objectBucketUrl(endpoint: URL, bucket: string) {
  const url = new URL(endpoint);
  url.pathname = `/${encodeURIComponent(bucket)}`;
  return url;
}

function objectUrl(endpoint: URL, bucket: string, providerKey: string) {
  const url = new URL(endpoint);
  url.pathname = `/${encodeURIComponent(bucket)}/${providerKey.split("/").map(encodeURIComponent).join("/")}`;
  return url;
}

function canonicalHost(url: URL) { return url.host.toLowerCase(); }

function assertUploadId(value: string) {
  if (!/^[A-Za-z0-9._-]{1,1024}$/.test(value)) throw new ProjectStorageProviderError();
}

function canonicalQueryString(query: Record<string, string>) {
  // Byte-Ordnung, nicht localeCompare: AWS sortiert die kanonische Query nach
  // Codepunkten. localeCompare ordnet sprachbewusst und stellt Kleinbuchstaben
  // neben Grossbuchstaben — bei rein grossgeschriebenen X-Amz-Schluesseln fiel
  // das nie auf, mit gemischten Schluesseln (partNumber, uploadId,
  // response-content-disposition) platzt die Signatur am Provider.
  return Object.entries(query).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`).join("&");
}

function awsEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function signingKey(secret: string, day: string, region: string): Buffer {
  const dateKey = createHmac("sha256", `AWS4${secret}`).update(day).digest();
  const regionKey = createHmac("sha256", dateKey).update(region).digest();
  const serviceKey = createHmac("sha256", regionKey).update("s3").digest();
  return createHmac("sha256", serviceKey).update("aws4_request").digest();
}

function amzDate(date: Date) { return date.toISOString().replace(/[:-]|\.\d{3}/g, ""); }
function sha256Hex(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }

function grantTtlSeconds(now: Date, expiresAt: Date) {
  const ttl = Math.floor((expiresAt.getTime() - now.getTime()) / 1_000);
  if (!Number.isFinite(expiresAt.getTime()) || ttl < 30 || ttl > 900) throw new ProjectStorageProviderError();
  return ttl;
}

function assertCredentials(credentials: S3ProjectStorageCredentials) {
  if (!/^[A-Za-z0-9/+=,.@_-]{16,128}$/.test(credentials.accessKeyId) ||
      credentials.secretAccessKey.length < 32 || credentials.secretAccessKey.length > 256 ||
      /[\r\n\0]/.test(credentials.secretAccessKey) ||
      (credentials.sessionToken !== undefined && (credentials.sessionToken.length < 16 ||
        credentials.sessionToken.length > 4096 || /[\r\n\0]/.test(credentials.sessionToken)))) {
    throw new ConfigurationError("Invalid S3 Project Storage credentials.");
  }
}

/** Ein Praefix darf — anders als ein Schluessel — auf "/" enden. */
function assertKeyPrefix(prefix: string) {
  assertProviderKey(prefix.endsWith("/") ? prefix.slice(0, -1) : prefix);
}

function assertProviderKey(key: string) {
  if (key.length < 3 || key.length > 1500 || key.startsWith("/") || key.endsWith("/") ||
      key.split("/").some((part) => !part || part === "." || part === "..") || /[\0\r\n\\]/.test(key)) {
    throw new ProjectStorageProviderError();
  }
}

function validChecksum(value: string) {
  return /^[A-Za-z0-9+/]{43}=$/.test(value) && Buffer.from(value, "base64").length === 32;
}

function validContentType(value: string) {
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/.test(value);
}

function safeDownloadName(value: string) {
  const name = value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  if (!name || name === "." || name === "..") throw new ProjectStorageProviderError();
  return name;
}

function boundedInteger(value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) throw new ConfigurationError("Invalid Project Storage numeric setting.");
  return value;
}
