import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
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
  decodeAwsChunkedBody,
  declaredPayloadHash,
  isPresignedUrl,
  isStreamingPayload,
  parseSigV4Authorization,
  parseSigV4Query,
  PRESIGNED_MAX_EXPIRES_SECONDS,
  SigV4Error,
  sigV4PresignedTime,
  sigV4RequestTime,
  UNSIGNED_PAYLOAD,
  verifyChecksums,
  verifySigV4Signature,
  type SigV4FailureCode,
} from "@/lib/server/project-storage/s3-sigv4";
import { ProjectStorageError, type ProjectStorageService } from "@/lib/server/project-storage/service";
import { UsageQuotaExceededError } from "@/lib/server/usage/api-requests";

/**
 * Der S3-Endpunkt von QKERN (2.96, erweitert 2.99): `/s3/{bucket}/{key}`,
 * pfadadressiert.
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
 * ## Was gebaut ist
 *
 * ListBuckets, HeadBucket, ListObjectsV2, HeadObject, GetObject (ganz oder
 * als ein Bereich, `Range: bytes=…`), PutObject (ein Stueck, bis
 * `maxPutBytes`), CopyObject, DeleteObject, DeleteObjects.
 *
 * Signatur im Header oder in der Query (Presigned URL, hoechstens 15 Minuten
 * wie die signierten Zusagen des Dienstes). Koerper als SHA-256-Hex,
 * `UNSIGNED-PAYLOAD` oder `aws-chunked` in den drei Formen, die die
 * AWS-Werkzeuge ueber HTTP schicken: `STREAMING-AWS4-HMAC-SHA256-PAYLOAD`,
 * dasselbe mit Trailer, und `STREAMING-UNSIGNED-PAYLOAD-TRAILER`. Jede
 * mitgeschickte Pruefsumme (`x-amz-checksum-*`, als Header oder Trailer)
 * wird nachgerechnet.
 *
 * CopyObject geht durch den Dienst wie ein Lesen und ein Schreiben: Die
 * Quelle wird ueber eine Lesezusage geholt (nur ein sauberes Objekt hat
 * eine), das Ziel wird reserviert, abgelegt und abgeschlossen, mit Scan. Ein
 * Objekt in Quarantaene hat keine Lesezusage und ist fuer ein Paar nicht
 * einmal sichtbar; es laesst sich darum nicht kopieren. Der Weg ist auf
 * `maxPutBytes` begrenzt, weil die Bytes durch QKERN laufen.
 *
 * ## Was nicht gebaut ist
 *
 * Jedes davon antwortet mit 501 statt mit einem Rateversuch: Multipart ueber
 * S3, ListObjects v1, Bucket anlegen oder loeschen, ACLs, Versionen, Tags,
 * POST-Policy-Upload.
 */

export const S3_ENDPOINT_PATH = "/s3";
export const S3_DEFAULT_MAX_PUT_BYTES = 64 * 1024 * 1024;
const MAX_DELETE_KEYS = 1000;
const MAX_DELETE_BODY_BYTES = 2 * 1024 * 1024;
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
  constructor(readonly status: number, readonly s3Code: string, message: string, readonly headers?: Record<string, string>) {
    super(message);
    this.name = "S3ResponseError";
  }
}

type Operation =
  | { kind: "ListBuckets" }
  | { kind: "HeadBucket"; bucket: string }
  | { kind: "ListObjectsV2"; bucket: string }
  | { kind: "GetObject"; bucket: string; key: string; range: string | null }
  | { kind: "HeadObject"; bucket: string; key: string }
  | { kind: "PutObject"; bucket: string; key: string }
  | { kind: "CopyObject"; bucket: string; key: string; source: { bucket: string; key: string } }
  | { kind: "DeleteObject"; bucket: string; key: string }
  | { kind: "DeleteObjects"; bucket: string };

/** Was die Signaturpruefung dem Koerperleser hinterlaesst: die Kopfsignatur ist der Anfang der Blockkette. */
type Authenticated = {
  key: AuthenticatedProjectStorageS3AccessKey;
  signature: string;
  amzDate: string;
  date: string;
  region: string;
  presigned: boolean;
};

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
    this.maxPutBytes = dependencies.maxPutBytes ?? S3_DEFAULT_MAX_PUT_BYTES;
    this.requestId = dependencies.requestId ?? (() => randomUUID());
  }

  async handle(request: Request): Promise<Response> {
    const requestId = this.requestId();
    const url = new URL(request.url);
    try {
      const operation = this.operation(request, url);
      const authenticated = await this.authenticate(request, url);
      if (this.dependencies.admit) await this.dependencies.admit(authenticated.key.scope);
      const body = await this.body(request, operation, authenticated);
      const principal: ProjectStoragePrincipal = {
        organizationId: authenticated.key.scope.organizationId,
        actorRef: `s3:${authenticated.key.accessKeyId}`,
        role: "service_role",
        subject: authenticated.key.id,
      };
      return this.finish(await this.dispatch(operation, { key: authenticated.key, principal, url, request, body }), requestId);
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
    if (query.has("Signature") || query.has("AWSAccessKeyId")) {
      throw new S3ResponseError(400, "InvalidRequest", "Signature Version 2 is not supported; sign with AWS Signature Version 4.");
    }
    const rest = url.pathname.slice(this.basePath.length).replace(/^\/+/, "");
    const segments = rest ? rest.split("/") : [];
    const bucket = segments.length ? decodeSegment(segments[0]) : "";
    const key = segments.length > 1 ? segments.slice(1).map(decodeSegment).join("/") : "";
    const method = request.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "PUT" && method !== "DELETE" && method !== "POST") {
      throw new S3ResponseError(405, "MethodNotAllowed", "The specified method is not allowed against this resource.");
    }
    if (!bucket) {
      if (method === "GET") return { kind: "ListBuckets" };
      throw new S3ResponseError(405, "MethodNotAllowed", "Only ListBuckets is available at the service root.");
    }
    if (!key) {
      if (method === "HEAD") return { kind: "HeadBucket", bucket };
      if (method === "POST") {
        if (query.has("delete")) return { kind: "DeleteObjects", bucket };
        throw new S3ResponseError(501, "NotImplemented", "POST to a bucket is only implemented for DeleteObjects (?delete); POST policy uploads are not.");
      }
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
    if (method === "POST") {
      throw new S3ResponseError(501, "NotImplemented", "POST to an object (multipart upload, SelectObjectContent) is not implemented.");
    }
    if (method === "GET") return { kind: "GetObject", bucket, key, range: request.headers.get("range") };
    if (method === "HEAD") return { kind: "HeadObject", bucket, key };
    if (method === "PUT") {
      const copySource = request.headers.get("x-amz-copy-source");
      if (copySource !== null) return { kind: "CopyObject", bucket, key, source: parseCopySource(copySource) };
      return { kind: "PutObject", bucket, key };
    }
    return { kind: "DeleteObject", bucket, key };
  }

  /**
   * Signatur zuerst, Koerper danach: Wer keine gueltige Signatur hat, bringt
   * den Endpunkt nicht dazu, Bytes zu puffern. Der Payload-Hash steht als
   * Header in der Signatur und wird nach dem Lesen nachgerechnet; bei
   * `aws-chunked` ist die Kopfsignatur der Anfang der Blockkette.
   */
  private async authenticate(request: Request, url: URL): Promise<Authenticated> {
    const now = this.now();
    if (isPresignedUrl(url)) {
      const authorization = parseSigV4Query(url);
      const time = sigV4PresignedTime(authorization, now);
      const key = await this.dependencies.keys.authenticate(authorization.accessKeyId, now);
      if (!key) throw invalidAccessKey();
      verifySigV4Signature({
        request: { method: request.method, url, headers: request.headers },
        authorization, amzDate: time.amzDate, payloadHash: UNSIGNED_PAYLOAD, secret: key.secret, presigned: true,
      });
      return { key, signature: authorization.signature, amzDate: time.amzDate, date: authorization.date, region: authorization.region, presigned: true };
    }
    const authorization = parseSigV4Authorization(request.headers);
    const time = sigV4RequestTime(request.headers, authorization, now);
    const payloadHash = declaredPayloadHash(request.headers);
    const key = await this.dependencies.keys.authenticate(authorization.accessKeyId, now);
    if (!key) throw invalidAccessKey();
    verifySigV4Signature({
      request: { method: request.method, url, headers: request.headers },
      authorization, amzDate: time.amzDate, payloadHash, secret: key.secret,
    });
    return { key, signature: authorization.signature, amzDate: time.amzDate, date: authorization.date, region: authorization.region, presigned: false };
  }

  /**
   * Der Koerper, gelesen bis zu einer Grenze und gegen alles geprueft, was
   * der Client ueber ihn behauptet hat: Laenge, SHA-256, Blocksignaturen,
   * Trailer-Signatur, Pruefsummen. Erst danach sieht der Dienst ein Byte.
   */
  private async body(request: Request, operation: Operation, authenticated: Authenticated): Promise<Buffer> {
    const headerDeclared = request.headers.get("x-amz-content-sha256")?.trim() ?? "";
    const declared = authenticated.presigned && headerDeclared === "" ? UNSIGNED_PAYLOAD : headerDeclared;
    const streaming = isStreamingPayload(declared);
    if (streaming && authenticated.presigned) {
      throw new S3ResponseError(400, "InvalidRequest", "A presigned URL cannot carry an aws-chunked body.");
    }
    const takesBody = operation.kind === "PutObject" || operation.kind === "DeleteObjects";
    const contentLength = integerHeader(request.headers.get("content-length"), "Content-Length");
    const decodedLength = integerHeader(request.headers.get("x-amz-decoded-content-length"), "x-amz-decoded-content-length");
    let expected: number | null = null;
    let limit = 0;
    if (operation.kind === "PutObject") {
      expected = streaming ? decodedLength : contentLength;
      if (expected === null) {
        throw new S3ResponseError(411, "MissingContentLength", streaming
          ? "You must provide the x-amz-decoded-content-length HTTP header with an aws-chunked body."
          : "You must provide the Content-Length HTTP header.");
      }
      if (expected > this.maxPutBytes) {
        throw new S3ResponseError(400, "EntityTooLarge", `PutObject through this endpoint accepts at most ${this.maxPutBytes} bytes per object.`);
      }
      if (expected === 0) throw new S3ResponseError(400, "InvalidArgument", "Empty objects are not accepted.");
      // Ein Block kostet Kopfzeile und Signatur; bei kleinen Bloecken ist das
      // ein Achtel dazu, mehr nicht. Was darueber liegt, ist kein Objekt.
      limit = streaming ? expected + (expected >> 3) + 64 * 1024 : expected;
    } else if (operation.kind === "DeleteObjects") {
      limit = MAX_DELETE_BODY_BYTES;
    }
    let raw = await readBody(request, takesBody ? limit : 0);
    if (!takesBody && raw.byteLength > 0) {
      throw new S3ResponseError(400, "InvalidArgument", "This operation takes no request body.");
    }
    if (takesBody && contentLength !== null && raw.byteLength !== contentLength) {
      throw new S3ResponseError(400, "IncompleteBody", "You did not provide the number of bytes specified by the Content-Length HTTP header.");
    }
    const checksums: Record<string, string | null> = {};
    for (const name of ["x-amz-checksum-crc32", "x-amz-checksum-crc32c", "x-amz-checksum-crc64nvme", "x-amz-checksum-sha1", "x-amz-checksum-sha256"]) {
      checksums[name] = request.headers.get(name);
    }
    if (streaming) {
      const decoded = decodeAwsChunkedBody({
        body: raw, declared, seedSignature: authenticated.signature, amzDate: authenticated.amzDate,
        scope: { date: authenticated.date, region: authenticated.region }, secret: authenticated.key.secret,
      });
      raw = decoded.payload;
      for (const name of (request.headers.get("x-amz-trailer") ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean)) {
        if (name in checksums && !(name in decoded.trailers)) {
          throw new S3ResponseError(400, "InvalidRequest", `The announced trailer ${name} is missing from the aws-chunked body.`);
        }
      }
      for (const [name, value] of Object.entries(decoded.trailers)) if (name in checksums) checksums[name] = value;
    } else if (declared !== UNSIGNED_PAYLOAD && declared !== createHash("sha256").update(raw).digest("hex")) {
      throw new S3ResponseError(400, "XAmzContentSHA256Mismatch", "The provided x-amz-content-sha256 header does not match what was computed.");
    }
    if (expected !== null && raw.byteLength !== expected) {
      throw new S3ResponseError(400, "IncompleteBody", "You did not provide the number of bytes specified by the x-amz-decoded-content-length HTTP header.");
    }
    verifyChecksums(checksums, raw);
    const md5 = request.headers.get("content-md5");
    if (md5 !== null && md5 !== "") {
      const provided = Buffer.from(md5, "base64");
      const computed = createHash("md5").update(raw).digest();
      if (provided.byteLength !== computed.byteLength || !timingSafeEqual(provided, computed)) {
        throw new S3ResponseError(400, "BadDigest", "The Content-MD5 you specified did not match what we received.");
      }
    }
    return raw;
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
      case "HeadObject": {
        const bucket = await this.bucket(principal, key, operation.bucket);
        const object = await this.findObject(principal, scope, bucket, operation.key);
        if (!object) throw noSuchKey();
        return new Response(null, { status: 200, headers: objectHeaders(object) });
      }
      case "GetObject": {
        const bucket = await this.bucket(principal, key, operation.bucket);
        const object = await this.findObject(principal, scope, bucket, operation.key);
        if (!object) throw noSuchKey();
        return await this.getObject(principal, scope, bucket, object, operation.range);
      }
      case "PutObject": {
        const bucket = await this.bucket(principal, key, operation.bucket);
        const contentType = normalizeContentType(context.request.headers.get("content-type"));
        const object = await this.storeObject(principal, scope, bucket, operation.key, contentType, context.body);
        const headers = new Headers();
        if (object.etag) headers.set("ETag", quoteEtag(object.etag));
        headers.set("x-qkern-object-status", object.status);
        return new Response(null, { status: 200, headers });
      }
      case "CopyObject": {
        const bucket = await this.bucket(principal, key, operation.bucket);
        return await this.copyObject(principal, key, bucket, operation.key, operation.source, context.request);
      }
      case "DeleteObject": {
        const bucket = await this.bucket(principal, key, operation.bucket);
        const object = await this.findObject(principal, scope, bucket, operation.key);
        if (object) {
          await this.storage(() => this.dependencies.storage.deleteObject(principal, scope, bucket.id, object.key));
        }
        return new Response(null, { status: 204 });
      }
      case "DeleteObjects": {
        const bucket = await this.bucket(principal, key, operation.bucket);
        return await this.deleteObjects(principal, scope, bucket, context.body);
      }
    }
  }

  /**
   * GetObject, ganz oder als Bereich. Die Bytes kommen ueber die Lesezusage
   * des Dienstes vom Provider; ein Bereich wird an ihn weitergereicht, und
   * antwortet er trotzdem mit dem ganzen Objekt, schneidet der Endpunkt im
   * Strom, ohne zu puffern.
   */
  private async getObject(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucket: PublicProjectStorageBucket,
    object: PublicProjectStorageObject,
    rangeHeader: string | null,
  ): Promise<Response> {
    const range = parseRange(rangeHeader, object.sizeBytes);
    if (range === "unsatisfiable") {
      throw new S3ResponseError(416, "InvalidRange", "The requested range is not satisfiable.", { "Content-Range": `bytes */${object.sizeBytes}` });
    }
    const grant = await this.storage(() => this.dependencies.storage.createDownloadGrant(principal, scope, bucket.id, { key: object.key }));
    const upstream = await this.fetchFn(grant.url, {
      method: "GET", redirect: "error",
      ...(range ? { headers: { Range: `bytes=${range.start}-${range.end}` } } : {}),
    }).catch(() => null);
    if (!upstream || !upstream.body || (upstream.status !== 200 && upstream.status !== 206)) {
      throw new S3ResponseError(503, "ServiceUnavailable", "The object store did not serve the object.");
    }
    const headers = objectHeaders(object);
    if (!range) return new Response(upstream.body, { status: 200, headers });
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${object.sizeBytes}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    const body = upstream.status === 206 ? upstream.body : upstream.body.pipeThrough(sliceStream(range.start, range.end));
    return new Response(body, { status: 206, headers });
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
   * Ein Objekt ablegen, in drei Schritten, alle durch den Dienst: Reservierung
   * (Regel, MIME, Groesse, Quota), Einloesen der signierten Zusage beim
   * Provider, Abschluss (HEAD, Scan, Quarantaene). Ein vorhandenes Objekt
   * desselben Schluessels wird zuvor geloescht, weil S3 ueberschreibt; die
   * beiden Schritte sind nicht atomar, und ein Leser dazwischen sieht kurz
   * nichts. PutObject und CopyObject enden beide hier.
   */
  private async storeObject(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucket: PublicProjectStorageBucket,
    key: string,
    contentType: string,
    body: Buffer,
  ): Promise<PublicProjectStorageObject> {
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
    return await this.storage(() => this.dependencies.storage.completeUpload(principal, scope, {
      uploadId: prepared.uploadId, completionToken: prepared.completionToken,
    }));
  }

  /**
   * CopyObject innerhalb des Bucket-Satzes: Quelle lesen wie GetObject, Ziel
   * schreiben wie PutObject. Die Quelle muss dem Paar sichtbar sein (sauber,
   * im Satz, lesbar), das Ziel muss sich mit den Regeln seines Buckets
   * vertragen, und der Scanner sieht die Bytes noch einmal.
   */
  private async copyObject(
    principal: ProjectStoragePrincipal,
    key: AuthenticatedProjectStorageS3AccessKey,
    bucket: PublicProjectStorageBucket,
    targetKey: string,
    source: { bucket: string; key: string },
    request: Request,
  ): Promise<Response> {
    const scope = key.scope;
    const sourceBucket = await this.bucket(principal, key, source.bucket);
    const sourceObject = await this.findObject(principal, scope, sourceBucket, source.key);
    if (!sourceObject) throw noSuchKey();
    const directive = (request.headers.get("x-amz-metadata-directive") ?? "COPY").trim().toUpperCase();
    if (directive !== "COPY" && directive !== "REPLACE") {
      throw new S3ResponseError(400, "InvalidArgument", "x-amz-metadata-directive must be COPY or REPLACE.");
    }
    if (sourceBucket.id === bucket.id && sourceObject.key === targetKey && directive === "COPY") {
      throw new S3ResponseError(400, "InvalidRequest", "This copy request is illegal because it is trying to copy an object to itself without changing its metadata.");
    }
    if (sourceObject.sizeBytes > this.maxPutBytes) {
      throw new S3ResponseError(400, "EntityTooLarge", `CopyObject through this endpoint moves at most ${this.maxPutBytes} bytes; the source is larger.`);
    }
    const grant = await this.storage(() => this.dependencies.storage.createDownloadGrant(principal, scope, sourceBucket.id, { key: sourceObject.key }));
    const upstream = await this.fetchFn(grant.url, { method: "GET", redirect: "error" }).catch(() => null);
    if (!upstream || !upstream.ok) {
      throw new S3ResponseError(503, "ServiceUnavailable", "The object store did not serve the source object.");
    }
    const body = Buffer.from(await upstream.arrayBuffer());
    if (body.byteLength !== sourceObject.sizeBytes) {
      throw new S3ResponseError(503, "ServiceUnavailable", "The object store served a source object of another size.");
    }
    const contentType = directive === "REPLACE" && request.headers.get("content-type")
      ? normalizeContentType(request.headers.get("content-type"))
      : sourceObject.contentType;
    const object = await this.storeObject(principal, scope, bucket, targetKey, contentType, body);
    const headers = new Headers({ "x-qkern-object-status": object.status });
    return xml(200, `<CopyObjectResult xmlns="${S3_XMLNS}"><LastModified>${escapeXml(object.createdAt)}</LastModified>${
      object.etag ? `<ETag>${escapeXml(quoteEtag(object.etag))}</ETag>` : ""
    }</CopyObjectResult>`, headers);
  }

  /**
   * DeleteObjects: bis zu 1000 Schluessel in einem Aufruf, jeder einzeln
   * durch den Dienst. Ein Schluessel, den es nicht gibt, gilt wie bei S3 als
   * geloescht; ein Schluessel, den der Dienst verweigert, steht mit seinem
   * Grund in der Antwort, und die anderen gehen trotzdem.
   */
  private async deleteObjects(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucket: PublicProjectStorageBucket,
    body: Buffer,
  ): Promise<Response> {
    const text = body.toString("utf8");
    if (!/<Delete[\s>]/.test(text)) throw new S3ResponseError(400, "MalformedXML", "The XML you provided was not well-formed or did not validate against our published schema.");
    const quiet = /<Quiet>\s*true\s*<\/Quiet>/i.test(text);
    const keys: string[] = [];
    for (const match of text.matchAll(/<Object>([\s\S]*?)<\/Object>/g)) {
      if (/<VersionId>\s*[^<\s]/.test(match[1])) {
        throw new S3ResponseError(501, "NotImplemented", "Object versions are not implemented.");
      }
      const key = /<Key>([\s\S]*?)<\/Key>/.exec(match[1]);
      if (!key) throw new S3ResponseError(400, "MalformedXML", "Every Object needs a Key.");
      keys.push(unescapeXml(key[1]));
    }
    if (keys.length === 0 || keys.length > MAX_DELETE_KEYS) {
      throw new S3ResponseError(400, "MalformedXML", `DeleteObjects takes between 1 and ${MAX_DELETE_KEYS} keys.`);
    }
    const deleted: string[] = [];
    const errors: Array<{ key: string; code: string; message: string }> = [];
    for (const key of keys) {
      try {
        const object = await this.findObject(principal, scope, bucket, key);
        if (object) await this.storage(() => this.dependencies.storage.deleteObject(principal, scope, bucket.id, object.key));
        deleted.push(key);
      } catch (error) {
        if (error instanceof S3ResponseError) errors.push({ key, code: error.s3Code, message: error.message });
        else throw error;
      }
    }
    return xml(200, `<DeleteResult xmlns="${S3_XMLNS}">${
      quiet ? "" : deleted.map((key) => `<Deleted><Key>${escapeXml(key)}</Key></Deleted>`).join("")
    }${errors.map((entry) => `<Error><Key>${escapeXml(entry.key)}</Key><Code>${escapeXml(entry.code)}</Code><Message>${escapeXml(entry.message)}</Message></Error>`).join("")}</DeleteResult>`);
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
      return errorXml(error.status, error.s3Code, error.message, resource, method, error.headers);
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

function invalidAccessKey(): S3ResponseError {
  return new S3ResponseError(403, "InvalidAccessKeyId", "The access key id you provided does not exist, is revoked or has expired.");
}

function noSuchKey(): S3ResponseError {
  return new S3ResponseError(404, "NoSuchKey", "The specified key does not exist.");
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
      return noSuchKey();
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
    case "MALFORMED_AUTHORIZATION": return [400, "AuthorizationHeaderMalformed", "The authorization header or query is malformed."];
    case "UNSUPPORTED_SERVICE": return [400, "AuthorizationHeaderMalformed", "The credential scope must name the service s3."];
    case "MISSING_SIGNED_HEADER": return [400, "AuthorizationHeaderMalformed", "A signed header is missing from the request; host must be signed."];
    case "MISSING_DATE": return [403, "AccessDenied", "The request lacks x-amz-date and Date."];
    case "MALFORMED_DATE": return [400, "InvalidArgument", "The request date is malformed."];
    case "SCOPE_DATE_MISMATCH": return [403, "SignatureDoesNotMatch", "The credential scope date does not match the request date."];
    case "REQUEST_TIME_TOO_SKEWED": return [403, "RequestTimeTooSkewed", "The difference between the request time and the server's time is too large."];
    case "MISSING_CONTENT_SHA256": return [400, "InvalidRequest", "Missing required header for this request: x-amz-content-sha256."];
    case "UNSUPPORTED_PAYLOAD_SIGNING": return [400, "InvalidArgument", "x-amz-content-sha256 must be a SHA-256 hex digest, UNSIGNED-PAYLOAD or one of the three STREAMING-* forms."];
    case "SIGNATURE_DOES_NOT_MATCH": return [403, "SignatureDoesNotMatch", "The request signature we calculated does not match the signature you provided."];
    case "PRESIGNED_EXPIRES_INVALID": return [400, "AuthorizationQueryParametersError", `X-Amz-Expires must be between 1 and ${PRESIGNED_MAX_EXPIRES_SECONDS} seconds on this endpoint.`];
    case "PRESIGNED_EXPIRED": return [403, "AccessDenied", "Request has expired."];
    case "CHUNK_MALFORMED": return [400, "InvalidRequest", "The aws-chunked body is malformed."];
    case "CHUNK_SIGNATURE_DOES_NOT_MATCH": return [403, "SignatureDoesNotMatch", "The chunk signature we calculated does not match the signature you provided."];
    case "CHECKSUM_MALFORMED": return [400, "InvalidRequest", "A checksum header or trailer is not valid base64."];
    case "CHECKSUM_MISMATCH": return [400, "BadDigest", "The checksum you specified did not match what we received."];
  }
}

/** Liest den Koerper bis zur Grenze und bricht darueber ab, statt weiter zu puffern. */
async function readBody(request: Request, limit: number): Promise<Buffer> {
  if (!request.body) return Buffer.alloc(0);
  const parts: Uint8Array[] = [];
  let total = 0;
  const reader = request.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        if (limit === 0) throw new S3ResponseError(400, "InvalidArgument", "This operation takes no request body.");
        throw new S3ResponseError(400, "EntityTooLarge", "The request body exceeds what this operation accepts.");
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(parts);
}

function integerHeader(value: string | null, name: string): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new S3ResponseError(400, "InvalidArgument", `${name} is not a valid integer.`);
  }
  return parsed;
}

function normalizeContentType(value: string | null): string {
  return (value ?? "application/octet-stream").split(";")[0].trim().toLowerCase() || "application/octet-stream";
}

/**
 * `x-amz-copy-source`: `/bucket/key` oder `bucket/key`, URL-kodiert. Eine
 * Version dahinter (`?versionId=`) gibt es hier nicht.
 */
function parseCopySource(value: string): { bucket: string; key: string } {
  const [pathPart, query] = value.split("?");
  if (query !== undefined && query.length > 0) {
    throw new S3ResponseError(501, "NotImplemented", "Object versions are not implemented; x-amz-copy-source takes no versionId.");
  }
  const segments = pathPart.replace(/^\/+/, "").split("/");
  const bucket = decodeSegment(segments[0] ?? "");
  const key = segments.slice(1).map(decodeSegment).join("/");
  if (!bucket || !key) throw new S3ResponseError(400, "InvalidArgument", "x-amz-copy-source must name a bucket and a key.");
  return { bucket, key };
}

/**
 * Ein einzelner Bytebereich nach RFC 9110: `bytes=a-b`, `bytes=a-`,
 * `bytes=-n`. Mehrere Bereiche oder eine Form, die keine ist, gelten wie bei
 * S3 als nicht vorhanden, und das ganze Objekt kommt. Ein Bereich hinter dem
 * Ende ist nicht erfuellbar.
 */
function parseRange(header: string | null, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (header === null) return null;
  const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/.exec(header);
  if (!match || (match[1] === "" && match[2] === "")) return null;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (suffix === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (!Number.isSafeInteger(start) || start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

/** Schneidet einen Strom auf `[start, end]`, ohne ihn zu puffern. */
function sliceStream(start: number, end: number): TransformStream<Uint8Array, Uint8Array> {
  let position = 0;
  return new TransformStream({
    transform(chunk, controller) {
      const chunkStart = position;
      const chunkEnd = position + chunk.byteLength;
      position = chunkEnd;
      if (chunkEnd <= start || chunkStart > end) return;
      const from = Math.max(start, chunkStart) - chunkStart;
      const to = Math.min(end + 1, chunkEnd) - chunkStart;
      controller.enqueue(chunk.subarray(from, to));
    },
  });
}

function objectHeaders(object: PublicProjectStorageObject): Headers {
  const headers = new Headers({
    "Content-Type": object.contentType,
    "Content-Length": String(object.sizeBytes),
    "Last-Modified": new Date(object.createdAt).toUTCString(),
    "Accept-Ranges": "bytes",
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

function unescapeXml(value: string): string {
  return value.trim().replace(/&(lt|gt|amp|quot|apos|#(\d+)|#x([0-9a-fA-F]+));/g, (entity, name: string, decimal?: string, hex?: string) => {
    if (decimal) return String.fromCodePoint(Number(decimal));
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    return { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[name] ?? entity;
  });
}

function xml(status: number, body: string, headers?: Headers): Response {
  const merged = new Headers(headers);
  merged.set("Content-Type", "application/xml");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, { status, headers: merged });
}

function errorXml(status: number, code: string, message: string, resource: string, method: string, extra?: Record<string, string>): Response {
  const body = `<Error><Code>${escapeXml(code)}</Code><Message>${escapeXml(message)}</Message><Resource>${escapeXml(resource)}</Resource></Error>`;
  const response = method.toUpperCase() === "HEAD"
    ? new Response(null, { status, headers: { "Content-Type": "application/xml", "x-qkern-s3-error": code } })
    : xml(status, body);
  for (const [name, value] of Object.entries(extra ?? {})) response.headers.set(name, value);
  return response;
}
