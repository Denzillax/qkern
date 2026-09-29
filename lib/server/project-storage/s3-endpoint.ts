import { createHash, randomUUID } from "node:crypto";
import { isConnectionUnavailable } from "@/lib/server/db/errors";
import type {
  ProjectStoragePrincipal,
  ProjectStorageScope,
  PublicProjectStorageBucket,
  PublicProjectStorageObject,
} from "@/lib/server/project-storage/model";
import type {
  AuthenticatedProjectStorageS3AccessKey,
  ProjectStorageS3AccessKeyAuthenticator,
} from "@/lib/server/project-storage/s3-access-keys";
import {
  declaredPayloadHash,
  parseSigV4Authorization,
  SigV4Error,
  sigV4RequestTime,
  UNSIGNED_PAYLOAD,
  verifySigV4Signature,
  type SigV4FailureCode,
} from "@/lib/server/project-storage/s3-sigv4";
import { ProjectStorageError, type ProjectStorageService } from "@/lib/server/project-storage/service";
import { UsageQuotaExceededError } from "@/lib/server/usage/api-requests";

/**
 * Der S3-Endpunkt von QKERN (2.96): `/s3/{bucket}/{key}`, pfadadressiert.
 *
 * ## Was er ist
 *
 * Ein Uebersetzer. Er nimmt eine Anfrage, wie ein S3-Client sie schickt,
 * prueft die SigV4-Signatur gegen ein ausgegebenes Schluesselpaar und ruft
 * dann **denselben** `ProjectStorageService` wie die REST-Routen. Es gibt
 * keinen zweiten Weg an Bucket-Regel, Quota, MIME-Liste, Virenpruefung oder
 * Quarantaene vorbei, weil dieser Endpunkt keinen eigenen Weg zum Provider
 * hat: Er nimmt die signierte Zusage, die der Dienst ausstellt, und loest sie
 * selbst ein.
 *
 * ## Wer das Paar ist
 *
 * Ein Paar handelt als **Service-Rolle** seiner Umgebung, beschraenkt auf
 * seinen Bucket-Satz. Es liest Buckets mit Leseregel `public` oder `service`,
 * es schreibt in Buckets mit Schreibregel `service`, und ein Bucket mit der
 * Regel `private` bleibt ihm verschlossen, so wie jedem Aufrufer ausser der
 * Console. Das ist der Grund, warum die Regeln hier gelten, statt umgangen zu
 * werden: Ein Paar ist eine Zugangsart, kein Administrator.
 *
 * ## Was gebaut ist, und was nicht
 *
 * Gebaut: ListBuckets, HeadBucket, ListObjectsV2, HeadObject, GetObject,
 * PutObject (ein Stueck, bis `maxPutBytes`), DeleteObject. Signatur im
 * Header mit `x-amz-content-sha256` als Hex-Hash oder `UNSIGNED-PAYLOAD`.
 *
 * Nicht gebaut, und jedes davon antwortet mit 501 statt mit einem Rateversuch:
 * Presigned URLs, aws-chunked Uploads (`STREAMING-*`), Multipart ueber S3,
 * CopyObject, Range-Anfragen, ListObjects v1, DeleteObjects, Bucket anlegen
 * oder loeschen, ACLs, Versionen, Tags.
 */

export const S3_ENDPOINT_PATH = "/s3";
const DEFAULT_MAX_PUT_BYTES = 64 * 1024 * 1024;
const MAX_KEYS = 1000;
const PAGE = 100;
const MAX_LIST_PAGES = 10;
const S3_XMLNS = "http://s3.amazonaws.com/doc/2006-03-01/";

export type ProjectStorageS3EndpointDependencies = {
  storage: ProjectStorageService;
  keys: ProjectStorageS3AccessKeyAuthenticator;
  /** Dieselbe Zulassung wie die REST-Routen (`admitApiRequest`). Ohne sie zaehlt nichts. */
  admit?: (scope: ProjectStorageScope) => Promise<void>;
  basePath?: string;
  fetchFn?: typeof fetch;
  now?: () => Date;
  maxPutBytes?: number;
  requestId?: () => string;
};

class S3ResponseError extends Error {
  constructor(readonly status: number, readonly s3Code: string, message: string) {
    super(message);
    this.name = "S3ResponseError";
  }
}

type Operation =
  | { kind: "ListBuckets" }
  | { kind: "HeadBucket"; bucket: string }
  | { kind: "ListObjectsV2"; bucket: string }
  | { kind: "GetObject"; bucket: string; key: string }
  | { kind: "HeadObject"; bucket: string; key: string }
  | { kind: "PutObject"; bucket: string; key: string }
  | { kind: "DeleteObject"; bucket: string; key: string };

export class ProjectStorageS3Endpoint {
  private readonly basePath: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;
  private readonly maxPutBytes: number;
  private readonly requestId: () => string;

  constructor(private readonly dependencies: ProjectStorageS3EndpointDependencies) {
    this.basePath = (dependencies.basePath ?? S3_ENDPOINT_PATH).replace(/\/+$/, "");
    this.fetchFn = dependencies.fetchFn ?? fetch;
    this.now = dependencies.now ?? (() => new Date());
    this.maxPutBytes = dependencies.maxPutBytes ?? DEFAULT_MAX_PUT_BYTES;
    this.requestId = dependencies.requestId ?? (() => randomUUID());
  }

  async handle(request: Request): Promise<Response> {
    const requestId = this.requestId();
    const url = new URL(request.url);
    try {
      const operation = this.operation(request, url);
      const key = await this.authenticate(request, url);
      if (this.dependencies.admit) await this.dependencies.admit(key.scope);
      const body = await this.body(request);
      const principal: ProjectStoragePrincipal = {
        organizationId: key.scope.organizationId,
        actorRef: `s3:${key.accessKeyId}`,
        role: "service_role",
        subject: key.id,
      };
      return this.finish(await this.dispatch(operation, { key, principal, url, request, body }), requestId);
    } catch (error) {
      return this.finish(this.errorResponse(error, url, request.method), requestId);
    }
  }

  // --- Anfrage lesen -------------------------------------------------------

  private operation(request: Request, url: URL): Operation {
    if (url.pathname !== this.basePath && !url.pathname.startsWith(`${this.basePath}/`)) {
      throw new S3ResponseError(404, "NoSuchBucket", "The endpoint lives under the configured base path.");
    }
    const query = url.searchParams;
    if (query.has("X-Amz-Signature") || query.has("X-Amz-Algorithm") || query.has("Signature") || query.has("AWSAccessKeyId")) {
      throw new S3ResponseError(501, "NotImplemented", "Presigned URLs are not implemented; sign the Authorization header.");
    }
    const rest = url.pathname.slice(this.basePath.length).replace(/^\/+/, "");
    const segments = rest ? rest.split("/") : [];
    const bucket = segments.length ? decodeSegment(segments[0]) : "";
    const key = segments.length > 1 ? segments.slice(1).map(decodeSegment).join("/") : "";
    const method = request.method.toUpperCase();
    if (method === "POST") {
      throw new S3ResponseError(501, "NotImplemented", "POST operations (multipart upload, DeleteObjects, POST policy) are not implemented.");
    }
    if (method !== "GET" && method !== "HEAD" && method !== "PUT" && method !== "DELETE") {
      throw new S3ResponseError(405, "MethodNotAllowed", "The specified method is not allowed against this resource.");
    }
    if (!bucket) {
      if (method === "GET") return { kind: "ListBuckets" };
      throw new S3ResponseError(405, "MethodNotAllowed", "Only ListBuckets is available at the service root.");
    }
    if (!key) {
      if (method === "HEAD") return { kind: "HeadBucket", bucket };
      if (method === "GET") {
        if (query.get("list-type") === "2") return { kind: "ListObjectsV2", bucket };
        if (query.has("location")) return { kind: "HeadBucket", bucket };
        for (const subresource of ["uploads", "versioning", "acl", "policy", "cors", "lifecycle", "tagging", "versions"]) {
          if (query.has(subresource)) {
            throw new S3ResponseError(501, "NotImplemented", `The bucket subresource "${subresource}" is not implemented.`);
          }
        }
        throw new S3ResponseError(501, "NotImplemented", "ListObjects (version 1) is not implemented; send list-type=2.");
      }
      throw new S3ResponseError(501, "NotImplemented", "Buckets are created and deleted in the QKERN console, not through S3.");
    }
    if (query.has("uploadId") || query.has("uploads") || query.has("partNumber")) {
      throw new S3ResponseError(501, "NotImplemented", "Multipart upload through the S3 endpoint is not implemented; PutObject accepts one piece.");
    }
    for (const subresource of ["acl", "tagging", "versionId", "torrent", "legal-hold", "retention", "select"]) {
      if (query.has(subresource)) {
        throw new S3ResponseError(501, "NotImplemented", `The object subresource "${subresource}" is not implemented.`);
      }
    }
    if (method === "GET") {
      if (request.headers.get("range")) {
        throw new S3ResponseError(501, "NotImplemented", "Range requests are not implemented; the endpoint serves whole objects.");
      }
      return { kind: "GetObject", bucket, key };
    }
    if (method === "HEAD") return { kind: "HeadObject", bucket, key };
    if (method === "PUT") {
      if (request.headers.get("x-amz-copy-source")) {
        throw new S3ResponseError(501, "NotImplemented", "CopyObject is not implemented.");
      }
      return { kind: "PutObject", bucket, key };
    }
    return { kind: "DeleteObject", bucket, key };
  }

  /**
   * Signatur zuerst, Koerper danach: Wer keine gueltige Signatur hat, bringt
   * den Endpunkt nicht dazu, Bytes zu puffern. Der Payload-Hash steht als
   * Header in der Signatur und wird nach dem Lesen nachgerechnet.
   */
  private async authenticate(request: Request, url: URL): Promise<AuthenticatedProjectStorageS3AccessKey> {
    const authorization = parseSigV4Authorization(request.headers);
    const now = this.now();
    const time = sigV4RequestTime(request.headers, authorization, now);
    const payloadHash = declaredPayloadHash(request.headers);
    const key = await this.dependencies.keys.authenticate(authorization.accessKeyId, now);
    if (!key) {
      throw new S3ResponseError(403, "InvalidAccessKeyId", "The access key id you provided does not exist, is revoked or has expired.");
    }
    verifySigV4Signature({
      request: { method: request.method, url, headers: request.headers },
      authorization,
      amzDate: time.amzDate,
      payloadHash,
      secret: key.secret,
    });
    return key;
  }

  private async body(request: Request): Promise<Buffer> {
    const declared = request.headers.get("x-amz-content-sha256")?.trim() ?? "";
    const method = request.method.toUpperCase();
    const length = request.headers.get("content-length");
    if (method === "PUT") {
      if (length === null) throw new S3ResponseError(411, "MissingContentLength", "You must provide the Content-Length HTTP header.");
      const expected = Number(length);
      if (!Number.isInteger(expected) || expected < 0) {
        throw new S3ResponseError(400, "InvalidArgument", "Content-Length is not a valid integer.");
      }
      if (expected > this.maxPutBytes) {
        throw new S3ResponseError(400, "EntityTooLarge", `PutObject through this endpoint accepts at most ${this.maxPutBytes} bytes per object.`);
      }
      if (expected === 0) throw new S3ResponseError(400, "InvalidArgument", "Empty objects are not accepted.");
    }
    const bytes = Buffer.from(await request.arrayBuffer());
    if (method === "PUT" && bytes.byteLength !== Number(length)) {
      throw new S3ResponseError(400, "IncompleteBody", "You did not provide the number of bytes specified by the Content-Length HTTP header.");
    }
    if (method !== "PUT" && bytes.byteLength > 0) {
      throw new S3ResponseError(400, "InvalidArgument", "This operation takes no request body.");
    }
    if (declared !== UNSIGNED_PAYLOAD && declared !== createHash("sha256").update(bytes).digest("hex")) {
      throw new S3ResponseError(400, "XAmzContentSHA256Mismatch", "The provided x-amz-content-sha256 header does not match what was computed.");
    }
    return bytes;
  }

  // --- Operationen ---------------------------------------------------------

  private async dispatch(operation: Operation, context: {
    key: AuthenticatedProjectStorageS3AccessKey;
    principal: ProjectStoragePrincipal;
    url: URL;
    request: Request;
    body: Buffer;
  }): Promise<Response> {
    const { key, principal, url } = context;
    const scope = key.scope;
    switch (operation.kind) {
      case "ListBuckets": {
        const buckets = await this.buckets(principal, key);
        return xml(200, `<ListAllMyBucketsResult xmlns="${S3_XMLNS}"><Owner><ID>${escapeXml(key.id)}</ID><DisplayName>${escapeXml(key.accessKeyId)}</DisplayName></Owner><Buckets>${
          buckets.map((bucket) => `<Bucket><Name>${escapeXml(bucket.name)}</Name><CreationDate>${escapeXml(bucket.createdAt)}</CreationDate></Bucket>`).join("")
        }</Buckets></ListAllMyBucketsResult>`);
      }
      case "HeadBucket": {
        await this.bucket(principal, key, operation.bucket);
        if (url.searchParams.has("location")) {
          return xml(200, `<LocationConstraint xmlns="${S3_XMLNS}">qkern</LocationConstraint>`);
        }
        return new Response(null, { status: 200 });
      }
      case "ListObjectsV2": {
        const bucket = await this.bucket(principal, key, operation.bucket);
        return await this.listObjectsV2(principal, scope, bucket, url.searchParams);
      }
      case "HeadObject":
      case "GetObject": {
        const bucket = await this.bucket(principal, key, operation.bucket);
        const object = await this.findObject(principal, scope, bucket, operation.key);
        if (!object) throw new S3ResponseError(404, "NoSuchKey", "The specified key does not exist.");
        const headers = objectHeaders(object);
        if (operation.kind === "HeadObject") return new Response(null, { status: 200, headers });
        const grant = await this.storage(() => this.dependencies.storage.createDownloadGrant(principal, scope, bucket.id, { key: object.key }));
        const upstream = await this.fetchFn(grant.url, { method: "GET", redirect: "error" }).catch(() => null);
        if (!upstream || !upstream.ok || !upstream.body) {
          throw new S3ResponseError(503, "ServiceUnavailable", "The object store did not serve the object.");
        }
        return new Response(upstream.body, { status: 200, headers });
      }
      case "PutObject": {
        const bucket = await this.bucket(principal, key, operation.bucket);
        return await this.putObject(principal, scope, bucket, operation.key, context.request, context.body);
      }
      case "DeleteObject": {
        const bucket = await this.bucket(principal, key, operation.bucket);
        const object = await this.findObject(principal, scope, bucket, operation.key);
        if (object) {
          await this.storage(() => this.dependencies.storage.deleteObject(principal, scope, bucket.id, object.key));
        }
        return new Response(null, { status: 204 });
      }
    }
  }

  private async listObjectsV2(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucket: PublicProjectStorageBucket,
    query: URLSearchParams,
  ): Promise<Response> {
    const prefix = query.get("prefix") ?? "";
    const delimiter = query.get("delimiter") ?? "";
    const encode = query.get("encoding-type") === "url";
    const maxKeys = boundedInteger(query.get("max-keys"), MAX_KEYS, 1, MAX_KEYS);
    const token = query.get("continuation-token");
    let cursor: string | undefined = token ? decodeToken(token) : (query.get("start-after") || undefined);
    if (delimiter.length > 1) {
      throw new S3ResponseError(501, "NotImplemented", "Only single-character delimiters are implemented.");
    }
    const contents: PublicProjectStorageObject[] = [];
    const commonPrefixes: string[] = [];
    const seenPrefixes = new Set<string>();
    let truncated = false;
    let nextToken: string | null = null;
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const result = await this.storage(() => this.dependencies.storage.listObjects(principal, scope, bucket.id, {
        prefix: prefix || undefined, cursor, limit: PAGE,
      }));
      for (const object of result.objects) {
        const rest = object.key.slice(prefix.length);
        const cut = delimiter ? rest.indexOf(delimiter) : -1;
        if (contents.length + commonPrefixes.length >= maxKeys) {
          truncated = true;
          break;
        }
        if (cut >= 0) {
          const common = prefix + rest.slice(0, cut + delimiter.length);
          if (!seenPrefixes.has(common)) { seenPrefixes.add(common); commonPrefixes.push(common); }
        } else {
          contents.push(object);
        }
        cursor = object.key;
        nextToken = object.key;
      }
      if (truncated) break;
      if (!result.nextCursor) { nextToken = null; break; }
      cursor = result.nextCursor;
      if (page === MAX_LIST_PAGES - 1) truncated = true;
    }
    const text = (value: string) => escapeXml(encode ? encodeURIComponent(value).replace(/%2F/g, "/") : value);
    return xml(200, `<ListBucketResult xmlns="${S3_XMLNS}"><Name>${escapeXml(bucket.name)}</Name><Prefix>${text(prefix)}</Prefix>${
      delimiter ? `<Delimiter>${text(delimiter)}</Delimiter>` : ""
    }${encode ? "<EncodingType>url</EncodingType>" : ""}<KeyCount>${contents.length + commonPrefixes.length}</KeyCount><MaxKeys>${maxKeys}</MaxKeys><IsTruncated>${truncated}</IsTruncated>${
      token ? `<ContinuationToken>${escapeXml(token)}</ContinuationToken>` : ""
    }${truncated && nextToken ? `<NextContinuationToken>${escapeXml(encodeToken(nextToken))}</NextContinuationToken>` : ""}${
      contents.map((object) => `<Contents><Key>${text(object.key)}</Key><LastModified>${escapeXml(object.createdAt)}</LastModified>${
        object.etag ? `<ETag>${escapeXml(quoteEtag(object.etag))}</ETag>` : ""
      }<Size>${object.sizeBytes}</Size><StorageClass>STANDARD</StorageClass></Contents>`).join("")
    }${commonPrefixes.map((common) => `<CommonPrefixes><Prefix>${text(common)}</Prefix></CommonPrefixes>`).join("")}</ListBucketResult>`);
  }

  /**
   * PutObject in drei Schritten, alle durch den Dienst: Reservierung (Regel,
   * MIME, Groesse, Quota), Einloesen der signierten Zusage beim Provider,
   * Abschluss (HEAD, Scan, Quarantaene). Ein vorhandenes Objekt desselben
   * Schluessels wird zuvor geloescht, weil S3 ueberschreibt; die beiden
   * Schritte sind nicht atomar, und ein Leser dazwischen sieht kurz nichts.
   */
  private async putObject(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucket: PublicProjectStorageBucket,
    key: string,
    request: Request,
    body: Buffer,
  ): Promise<Response> {
    const contentType = (request.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim().toLowerCase() || "application/octet-stream";
    const checksumSha256 = createHash("sha256").update(body).digest("base64");
    const existing = await this.findObject(principal, scope, bucket, key);
    if (existing) {
      await this.storage(() => this.dependencies.storage.deleteObject(principal, scope, bucket.id, existing.key));
    }
    const prepared = await this.storage(() => this.dependencies.storage.prepareUpload(principal, scope, bucket.id, {
      key, contentType, sizeBytes: body.byteLength, checksumSha256,
    }));
    const form = new FormData();
    for (const [name, value] of Object.entries(prepared.upload.fields)) form.append(name, value);
    const blobBytes = new Uint8Array(new ArrayBuffer(body.byteLength));
    blobBytes.set(body);
    form.append("file", new Blob([blobBytes.buffer], { type: contentType }), key.split("/").pop() ?? key);
    const stored = await this.fetchFn(prepared.upload.url, { method: "POST", body: form, redirect: "error" }).catch(() => null);
    if (!stored || !stored.ok) {
      throw new S3ResponseError(503, "ServiceUnavailable", "The object store did not accept the upload.");
    }
    const object = await this.storage(() => this.dependencies.storage.completeUpload(principal, scope, {
      uploadId: prepared.uploadId, completionToken: prepared.completionToken,
    }));
    const headers = new Headers();
    if (object.etag) headers.set("ETag", quoteEtag(object.etag));
    headers.set("x-qkern-object-status", object.status);
    return new Response(null, { status: 200, headers });
  }

  // --- Hilfen ----------------------------------------------------------------

  /** Die Buckets, die das Paar nennen darf: sichtbar fuer die Service-Rolle und im Bucket-Satz. */
  private async buckets(principal: ProjectStoragePrincipal, key: AuthenticatedProjectStorageS3AccessKey) {
    const visible = await this.storage(() => this.dependencies.storage.listBuckets(principal, key.scope));
    const allowed = new Set(key.bucketIds);
    return visible.filter((bucket) => allowed.has(bucket.id));
  }

  /**
   * Unbekannt, nicht im Bucket-Satz und fuer die Service-Rolle unsichtbar
   * antworten gleich: NoSuchBucket. Ein Paar soll nicht erfahren, welche
   * Buckets es sonst noch gibt.
   */
  private async bucket(principal: ProjectStoragePrincipal, key: AuthenticatedProjectStorageS3AccessKey, name: string) {
    const bucket = (await this.buckets(principal, key)).find((candidate) => candidate.name === name);
    if (!bucket) throw new S3ResponseError(404, "NoSuchBucket", "The specified bucket does not exist.");
    return bucket;
  }

  /** Ueber die Liste des Dienstes: Nur saubere Objekte, die das Paar lesen darf, sind fuer es da. */
  private async findObject(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucket: PublicProjectStorageBucket,
    key: string,
  ): Promise<PublicProjectStorageObject | null> {
    if (!key || key.length > 1024) throw new S3ResponseError(400, "InvalidArgument", "The object key is empty or too long.");
    const result = await this.storage(() => this.dependencies.storage.listObjects(principal, scope, bucket.id, {
      prefix: key, limit: 1,
    }));
    const first = result.objects[0];
    return first && first.key === key ? first : null;
  }

  private async storage<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error) { throw mapStorageError(error); }
  }

  private finish(response: Response, requestId: string): Response {
    response.headers.set("x-amz-request-id", requestId);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  private errorResponse(error: unknown, url: URL, method: string): Response {
    const resource = url.pathname;
    if (error instanceof S3ResponseError) {
      return errorXml(error.status, error.s3Code, error.message, resource, method);
    }
    if (error instanceof SigV4Error) {
      const [status, code, message] = sigV4Failure(error.code);
      return errorXml(status, code, message, resource, method);
    }
    if (error instanceof UsageQuotaExceededError) {
      return errorXml(503, "SlowDown", "The usage quota of this project environment is exhausted.", resource, method);
    }
    if (isConnectionUnavailable(error)) {
      return errorXml(503, "ServiceUnavailable", "QKERN is temporarily unavailable.", resource, method);
    }
    return errorXml(500, "InternalError", "We encountered an internal error. Please try again.", resource, method);
  }
}

function mapStorageError(error: unknown): unknown {
  if (!(error instanceof ProjectStorageError)) {
    if (isConnectionUnavailable(error) || error instanceof UsageQuotaExceededError) return error;
    return new S3ResponseError(500, "InternalError", "We encountered an internal error. Please try again.");
  }
  switch (error.code) {
    case "STORAGE_INVALID_INPUT":
      return new S3ResponseError(400, "InvalidArgument", "The request was rejected by the bucket rules: key, content type, size or prefix.");
    case "STORAGE_RESOURCE_NOT_FOUND":
      return new S3ResponseError(404, "NoSuchKey", "The specified key does not exist.");
    case "STORAGE_ACCESS_DENIED":
      return new S3ResponseError(403, "AccessDenied", "The bucket policy does not allow this operation for a key pair.");
    case "STORAGE_CONFLICT":
      return new S3ResponseError(409, "OperationAborted", "The key is held by a pending upload or by an object that is not clean.");
    case "STORAGE_QUOTA_EXCEEDED":
      return new S3ResponseError(403, "QuotaExceeded", "The bucket quota does not leave room for this object.");
    case "STORAGE_OBJECT_NOT_READY":
      return new S3ResponseError(409, "InvalidObjectState", "The object is quarantined or not yet verified.");
    case "STORAGE_OBJECT_INFECTED":
      return new S3ResponseError(422, "QkernObjectRejected", "The malware scanner rejected the object; nothing was stored.");
    case "STORAGE_INVALID_TOKEN":
      return new S3ResponseError(409, "OperationAborted", "The upload reservation expired before completion.");
    case "PROJECT_STORAGE_DISABLED":
    case "STORAGE_PROVIDER_UNAVAILABLE":
      return new S3ResponseError(503, "ServiceUnavailable", "Project Storage is disabled or its provider is unavailable.");
  }
}

function sigV4Failure(code: SigV4FailureCode): [number, string, string] {
  switch (code) {
    case "MISSING_AUTHORIZATION": return [403, "AccessDenied", "Anonymous access is not allowed; sign the request with AWS Signature Version 4."];
    case "MALFORMED_AUTHORIZATION": return [400, "AuthorizationHeaderMalformed", "The authorization header is malformed."];
    case "UNSUPPORTED_SERVICE": return [400, "AuthorizationHeaderMalformed", "The credential scope must name the service s3."];
    case "MISSING_SIGNED_HEADER": return [400, "AuthorizationHeaderMalformed", "A signed header is missing from the request; host must be signed."];
    case "MISSING_DATE": return [403, "AccessDenied", "The request lacks x-amz-date and Date."];
    case "MALFORMED_DATE": return [400, "InvalidArgument", "The request date is malformed."];
    case "SCOPE_DATE_MISMATCH": return [403, "SignatureDoesNotMatch", "The credential scope date does not match the request date."];
    case "REQUEST_TIME_TOO_SKEWED": return [403, "RequestTimeTooSkewed", "The difference between the request time and the server's time is too large."];
    case "MISSING_CONTENT_SHA256": return [400, "InvalidRequest", "Missing required header for this request: x-amz-content-sha256."];
    case "UNSUPPORTED_PAYLOAD_SIGNING": return [501, "NotImplemented", "Chunked payload signing (STREAMING-*) is not implemented; send the SHA-256 of the body or UNSIGNED-PAYLOAD."];
    case "SIGNATURE_DOES_NOT_MATCH": return [403, "SignatureDoesNotMatch", "The request signature we calculated does not match the signature you provided."];
  }
}

function objectHeaders(object: PublicProjectStorageObject): Headers {
  const headers = new Headers({
    "Content-Type": object.contentType,
    "Content-Length": String(object.sizeBytes),
    "Last-Modified": new Date(object.createdAt).toUTCString(),
    "Accept-Ranges": "none",
  });
  if (object.etag) headers.set("ETag", quoteEtag(object.etag));
  return headers;
}

function quoteEtag(value: string): string {
  return value.startsWith('"') ? value : `"${value}"`;
}

function decodeSegment(segment: string): string {
  try { return decodeURIComponent(segment); } catch {
    throw new S3ResponseError(400, "InvalidURI", "Couldn't parse the specified URI.");
  }
}

function boundedInteger(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new S3ResponseError(400, "InvalidArgument", "Argument max-keys must be an integer between 1 and 1000.");
  }
  return Math.min(parsed, max);
}

function encodeToken(key: string): string {
  return Buffer.from(key, "utf8").toString("base64url");
}

function decodeToken(token: string): string {
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(token)) {
    throw new S3ResponseError(400, "InvalidArgument", "The continuation token provided is incorrect.");
  }
  return Buffer.from(token, "base64url").toString("utf8");
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
  })[character] ?? character);
}

function xml(status: number, body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, {
    status, headers: { "Content-Type": "application/xml" },
  });
}

function errorXml(status: number, code: string, message: string, resource: string, method: string): Response {
  const body = `<Error><Code>${escapeXml(code)}</Code><Message>${escapeXml(message)}</Message><Resource>${escapeXml(resource)}</Resource></Error>`;
  return method.toUpperCase() === "HEAD"
    ? new Response(null, { status, headers: { "Content-Type": "application/xml", "x-qkern-s3-error": code } })
    : xml(status, body);
}
