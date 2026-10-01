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
 * ListBuckets, HeadBucket, ListObjects (Version 1 und 2), HeadObject,
 * GetObject (ganz oder als ein Bereich, `Range: bytes=…`), PutObject (ein
 * Stueck, bis `maxPutBytes`), CopyObject, DeleteObject, DeleteObjects.
 *
 * Multipart (2.101): CreateMultipartUpload, UploadPart, ListParts,
 * ListMultipartUploads, CompleteMultipartUpload, AbortMultipartUpload. Der Weg
 * ist derselbe wie bei REST, nur mit anderer Reihenfolge der Zusagen: Ein
 * S3-Client nennt beim Anfang weder Groesse noch Pruefsumme, also beginnt die
 * Reservierung bei null Bytes und waechst mit jedem Teil, jedes unter derselben
 * Quota-Pruefung. Der Endpunkt reicht die Bytes eines Teils ueber eine Zusage
 * des Dienstes zum Provider und merkt sich Groesse und Pruefsumme des Teils.
 * Beim Abschluss prueft der Dienst die Teileliste gegen diesen Satz
 * (aufsteigend, jede Nummer bekannt, jede Kennung dieselbe), setzt beim
 * Provider zusammen und laesst den Endpunkt das zusammengesetzte Objekt ueber
 * eine Lesezusage durchrechnen. Diese Summe der **ganzen** Datei bekommt der
 * Scanner, so wie bei REST die zugesagte; ohne sie gibt es kein Objekt.
 *
 * Ein abgebrochener Upload laesst nichts stehen: `AbortMultipartUpload` bricht
 * beim Provider ab und gibt die Reservierung frei, und bleibt einer liegen,
 * findet ihn der Lifecycle ueber dieselbe `provider_upload_id` wie einen
 * REST-Upload.
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
 * `UploadPartCopy` (2.123) ist genau diese Kopie, nur als ein Teil: Die Quelle
 * wird ueber eine Lesezusage geholt, bei Bedarf nur ein Bytebereich
 * (`x-amz-copy-source-range`), und die Bytes gehen denselben Weg wie die eines
 * hochgeladenen Teils. Darum gibt es keine zweite Tuer: dieselbe Buchung auf
 * die Reservierung, dieselbe Quota-Pruefung, dieselbe Zusage zum Provider,
 * derselbe Vermerk am Teil, und beim Abschluss dieselbe Pruefsumme der ganzen
 * Datei fuer den Scanner.
 *
 * `ListObjects` Version 1 (2.123) liest denselben Satz wie Version 2 und
 * unterscheidet sich nur in der Form, in der ein Aufrufer die Fortsetzung
 * nennt: `marker` und `NextMarker` statt `continuation-token`. Beide Formen
 * laufen durch denselben Lauf ueber die Liste des Dienstes, damit Delimiter,
 * `CommonPrefixes` und Grenze nicht auseinanderlaufen koennen.
 *
 * ## Was nicht gebaut ist
 *
 * Jedes davon antwortet mit 501 statt mit einem Rateversuch: Bucket anlegen
 * oder loeschen, ACLs, Versionen, Tags, POST-Policy-Upload.
 */

export const S3_ENDPOINT_PATH = "/s3";
export const S3_DEFAULT_MAX_PUT_BYTES = 64 * 1024 * 1024;
const MAX_DELETE_KEYS = 1000;
const MAX_DELETE_BODY_BYTES = 2 * 1024 * 1024;
const MAX_KEYS = 1000;
const PAGE = 100;
const MAX_LIST_PAGES = 10;
const S3_XMLNS = "http://s3.amazonaws.com/doc/2006-03-01/";
const MAX_COMPLETE_PARTS = 10_000;
/** Die Pruefsummen, die ein Client ueber seinen eigenen Koerper behaupten darf. */
const CHECKSUM_HEADERS = [
  "x-amz-checksum-crc32",
  "x-amz-checksum-crc32c",
  "x-amz-checksum-crc64nvme",
  "x-amz-checksum-sha1",
  "x-amz-checksum-sha256",
] as const;

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
  | { kind: "ListObjects"; bucket: string }
  | { kind: "ListObjectsV2"; bucket: string }
  | { kind: "GetObject"; bucket: string; key: string; range: string | null }
  | { kind: "HeadObject"; bucket: string; key: string }
  | { kind: "PutObject"; bucket: string; key: string }
  | { kind: "CopyObject"; bucket: string; key: string; source: { bucket: string; key: string } }
  | { kind: "DeleteObject"; bucket: string; key: string }
  | { kind: "DeleteObjects"; bucket: string }
  | { kind: "CreateMultipartUpload"; bucket: string; key: string }
  | { kind: "UploadPart"; bucket: string; key: string; uploadId: string; partNumber: number }
  | {
    kind: "UploadPartCopy"; bucket: string; key: string; uploadId: string; partNumber: number;
    source: { bucket: string; key: string }; sourceRange: string | null;
  }
  | { kind: "CompleteMultipartUpload"; bucket: string; key: string; uploadId: string }
  | { kind: "AbortMultipartUpload"; bucket: string; key: string; uploadId: string }
  | { kind: "ListParts"; bucket: string; key: string; uploadId: string }
  | { kind: "ListMultipartUploads"; bucket: string };

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
        const listType = query.get("list-type");
        if (listType === "2") return { kind: "ListObjectsV2", bucket };
        if (query.has("location")) return { kind: "HeadBucket", bucket };
        if (query.has("uploads")) return { kind: "ListMultipartUploads", bucket };
        for (const subresource of ["versioning", "acl", "policy", "cors", "lifecycle", "tagging", "versions"]) {
          if (query.has(subresource)) {
            throw new S3ResponseError(501, "NotImplemented", `The bucket subresource "${subresource}" is not implemented.`);
          }
        }
        // Ein GET auf einen Bucket ohne `list-type` ist ListObjects Version 1
        // (2.123). Eine andere Zahl als 2 ist kein Rateversuch wert: Version 3
        // gibt es nicht, und wer sie nennt, meint etwas, das dieser Endpunkt
        // nicht kennt.
        if (listType !== null) {
          throw new S3ResponseError(400, "InvalidArgument", "Argument list-type must be 2; ListObjects version 1 takes no list-type at all.");
        }
        // Gemischte Formen werden benannt, nicht stillschweigend ausgelegt: Ein
        // `continuation-token` oder `start-after` in einer v1-Anfrage waere ein
        // Aufrufer, der sich fuer v2 haelt. Ihn mit `marker` weiterlaufen zu
        // lassen hiesse, seine Fortsetzung zu erfinden, und ihn still von vorn
        // beginnen zu lassen hiesse, Objekte doppelt zu liefern.
        for (const v2Only of ["continuation-token", "start-after"]) {
          if (query.has(v2Only)) {
            throw new S3ResponseError(400, "InvalidArgument", `Argument ${v2Only} belongs to ListObjectsV2; version 1 continues with marker.`);
          }
        }
        return { kind: "ListObjects", bucket };
      }
      throw new S3ResponseError(501, "NotImplemented", "Buckets are created and deleted in the QKERN console, not through S3.");
    }
    for (const subresource of ["acl", "tagging", "versionId", "torrent", "legal-hold", "retention", "select"]) {
      if (query.has(subresource)) {
        throw new S3ResponseError(501, "NotImplemented", `The object subresource "${subresource}" is not implemented.`);
      }
    }
    if (query.has("uploads")) {
      if (method !== "POST") {
        throw new S3ResponseError(405, "MethodNotAllowed", "A multipart upload is started with POST.");
      }
      return { kind: "CreateMultipartUpload", bucket, key };
    }
    const uploadId = query.get("uploadId");
    if (uploadId !== null) {
      const partNumber = query.get("partNumber");
      if (partNumber !== null) {
        if (method !== "PUT") {
          throw new S3ResponseError(405, "MethodNotAllowed", "A part is sent with PUT.");
        }
        if (partNumber === "") {
          throw new S3ResponseError(400, "InvalidArgument", "Argument partNumber must be an integer between 1 and 10000.");
        }
        const number = boundedInteger(partNumber, 1, 1, 10_000, "partNumber");
        const copySource = request.headers.get("x-amz-copy-source");
        if (copySource !== null) {
          // Ein Client, der ein Teil kopieren laesst, sieht die Bytes nie. Eine
          // Pruefsumme, die er trotzdem mitschickt, beglaubigt darum nichts:
          // Sie waere eine Behauptung ueber fremde Bytes. Sie wird abgewiesen
          // statt ignoriert, damit niemand glaubt, sie sei geprueft worden; die
          // Summe des kopierten Teils rechnet QKERN selbst (`uploadPartCopy`).
          for (const name of CHECKSUM_HEADERS) {
            if (request.headers.get(name) !== null) {
              throw new S3ResponseError(400, "InvalidRequest", `UploadPartCopy takes no ${name}; QKERN computes the checksum of a copied part itself.`);
            }
          }
          return {
            kind: "UploadPartCopy", bucket, key, uploadId, partNumber: number,
            source: parseCopySource(copySource),
            sourceRange: request.headers.get("x-amz-copy-source-range"),
          };
        }
        return { kind: "UploadPart", bucket, key, uploadId, partNumber: number };
      }
      if (method === "POST") return { kind: "CompleteMultipartUpload", bucket, key, uploadId };
      if (method === "DELETE") return { kind: "AbortMultipartUpload", bucket, key, uploadId };
      if (method === "GET") return { kind: "ListParts", bucket, key, uploadId };
      throw new S3ResponseError(405, "MethodNotAllowed", "An upload is completed with POST, aborted with DELETE and listed with GET.");
    }
    if (query.has("partNumber")) {
      throw new S3ResponseError(400, "InvalidArgument", "A part number needs the uploadId of the multipart upload it belongs to.");
    }
    if (method === "POST") {
      throw new S3ResponseError(501, "NotImplemented", "POST to an object (POST policy upload, SelectObjectContent) is not implemented.");
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
    const carriesObjectBytes = operation.kind === "PutObject" || operation.kind === "UploadPart";
    const takesBody = carriesObjectBytes || operation.kind === "DeleteObjects" ||
      operation.kind === "CompleteMultipartUpload";
    const contentLength = integerHeader(request.headers.get("content-length"), "Content-Length");
    const decodedLength = integerHeader(request.headers.get("x-amz-decoded-content-length"), "x-amz-decoded-content-length");
    let expected: number | null = null;
    let limit = 0;
    if (carriesObjectBytes) {
      expected = streaming ? decodedLength : contentLength;
      if (expected === null) {
        throw new S3ResponseError(411, "MissingContentLength", streaming
          ? "You must provide the x-amz-decoded-content-length HTTP header with an aws-chunked body."
          : "You must provide the Content-Length HTTP header.");
      }
      if (expected > this.maxPutBytes) {
        throw new S3ResponseError(400, "EntityTooLarge", operation.kind === "UploadPart"
          ? `UploadPart through this endpoint accepts at most ${this.maxPutBytes} bytes per part.`
          : `PutObject through this endpoint accepts at most ${this.maxPutBytes} bytes per object.`);
      }
      if (expected === 0) throw new S3ResponseError(400, "InvalidArgument", "Empty objects are not accepted.");
      // Ein Block kostet Kopfzeile und Signatur; bei kleinen Bloecken ist das
      // ein Achtel dazu, mehr nicht. Was darueber liegt, ist kein Objekt.
      limit = streaming ? expected + (expected >> 3) + 64 * 1024 : expected;
    } else if (operation.kind === "DeleteObjects" || operation.kind === "CompleteMultipartUpload") {
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
    for (const name of CHECKSUM_HEADERS) {
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
      case "ListObjects": {
        const bucket = await this.bucket(principal, key, operation.bucket);
        return await this.listObjectsV1(principal, scope, bucket, url.searchParams);
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
      case "CreateMultipartUpload": {
        const bucket = await this.bucket(principal, key, operation.bucket);
        const contentType = normalizeContentType(context.request.headers.get("content-type"));
        return await this.createMultipartUpload(principal, scope, bucket, operation.key, contentType);
      }
      case "UploadPart": {
        const bucket = await this.bucket(principal, key, operation.bucket);
        return await this.uploadPart(principal, scope, bucket, operation.key, operation.uploadId,
          operation.partNumber, context.body);
      }
      case "UploadPartCopy": {
        const bucket = await this.bucket(principal, key, operation.bucket);
        return await this.uploadPartCopy(principal, key, bucket, operation.key, operation.uploadId,
          operation.partNumber, operation.source, operation.sourceRange);
      }
      case "CompleteMultipartUpload": {
        const bucket = await this.bucket(principal, key, operation.bucket);
        return await this.completeMultipartUpload(principal, scope, bucket, operation.key,
          operation.uploadId, context.body);
      }
      case "AbortMultipartUpload": {
        const bucket = await this.bucket(principal, key, operation.bucket);
        await this.storage(() => this.dependencies.storage.abortS3MultipartUpload(principal, scope, {
          bucketIdOrName: bucket.id, key: operation.key, uploadId: operation.uploadId,
        }));
        return new Response(null, { status: 204 });
      }
      case "ListParts": {
        const bucket = await this.bucket(principal, key, operation.bucket);
        return await this.listParts(principal, scope, bucket, operation.key, operation.uploadId, url.searchParams);
      }
      case "ListMultipartUploads": {
        const bucket = await this.bucket(principal, key, operation.bucket);
        return await this.listMultipartUploads(principal, scope, bucket, url.searchParams);
      }
    }
  }

  /**
   * `CreateMultipartUpload`. Der Dienst reserviert den Schluessel und laesst
   * den Provider die Kennung ausgeben; Groesse und Pruefsumme kommen mit den
   * Teilen.
   *
   * Ein Objekt, das schon unter dem Schluessel liegt, geht vorher weg — die
   * Reservierung haelt den Schluessel exklusiv, sonst gaebe es keinen zweiten
   * Upload auf denselben Namen. Das ist die Ueberschreibe-Regel von
   * `PutObject`, nur mit einem Fenster, das so lang ist wie der Upload: Bricht
   * er ab, ist das alte Objekt weg und kein neues da.
   */
  private async createMultipartUpload(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucket: PublicProjectStorageBucket,
    key: string,
    contentType: string,
  ): Promise<Response> {
    const existing = await this.findObject(principal, scope, bucket, key);
    if (existing) {
      await this.storage(() => this.dependencies.storage.deleteObject(principal, scope, bucket.id, existing.key));
    }
    const created = await this.storage(() => this.dependencies.storage.prepareS3MultipartUpload(
      principal, scope, bucket.id, { key, contentType }));
    return xml(200, `<InitiateMultipartUploadResult xmlns="${S3_XMLNS}"><Bucket>${
      escapeXml(bucket.name)}</Bucket><Key>${escapeXml(created.key)}</Key><UploadId>${
      escapeXml(created.uploadId)}</UploadId></InitiateMultipartUploadResult>`);
  }

  /**
   * `UploadPart`. Die Bytes sind schon geprueft, wenn sie hier ankommen
   * (Laenge, SHA-256, Blocksignaturen, Pruefsummen); der Dienst bucht sie auf
   * die Reservierung, stellt die Zusage aus, und der Endpunkt loest sie ein.
   *
   * Die Kennung des Providers wird danach am Teil vermerkt. Ein Teil ohne
   * diesen Vermerk zaehlt beim Abschluss nicht, also kostet ein Abbruch
   * zwischen PUT und Vermerk nichts ausser der gebuchten Groesse, die mit der
   * Reservierung wieder frei wird.
   */
  private async uploadPart(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucket: PublicProjectStorageBucket,
    key: string,
    uploadId: string,
    partNumber: number,
    body: Buffer,
  ): Promise<Response> {
    const etag = await this.storePart(principal, scope, bucket, key, uploadId, partNumber, body);
    return new Response(null, { status: 200, headers: new Headers({ ETag: quotedEtag(etag) }) });
  }

  /**
   * `UploadPartCopy` (2.123): ein Teil, dessen Bytes nicht der Client schickt,
   * sondern QKERN aus einem vorhandenen Objekt holt, ganz oder als Bereich
   * (`x-amz-copy-source-range`).
   *
   * Die Entscheidungen, die daran haengen, der Reihe nach:
   *
   * **Leserechte der Quelle.** Es gibt keine Abkuerzung von Bucket zu Bucket.
   * Die Quelle laeuft durch `bucket()` (im Satz des Paars, der Service-Rolle
   * sichtbar) und durch `findObject()`, und das ist die Liste des Dienstes:
   * Sie fuehrt nur Objekte, die das Paar nach der Leseregel seines Buckets
   * sehen darf, und nur saubere. Ein Objekt in Quarantaene hat keine
   * Lesezusage und ist hier nicht einmal sichtbar, also laesst es sich auch
   * nicht in ein Teil kopieren. Die Pruefung ist damit je Objekt, nicht je
   * Bucket.
   *
   * **Pruefsumme.** QKERN rechnet sie selbst, aus genau den Bytes, die es vom
   * Provider zurueckbekommen hat, und nicht aus der Zeile des Objekts in der
   * Datenbank. Ein Client beglaubigt hier nichts: Er hat die Bytes nie
   * gesehen, eine mitgeschickte `x-amz-checksum-*` wird darum in `operation()`
   * abgewiesen. Die Summe geht als `x-amz-checksum-sha256` in die signierte
   * Zusage zum Provider, und der Provider weist das Teil ab, wenn sie nicht
   * stimmt — dieselbe Kette wie bei `UploadPart`.
   *
   * **Virenpruefung.** Die Bytes gehen hier tatsaechlich durch QKERN, aber
   * nicht durch den Scanner, und zwar aus demselben Grund wie bei
   * `UploadPart`: Ein einzelnes Teil ist kein Objekt. Gescannt wird beim
   * Abschluss die Pruefsumme der **ganzen** zusammengesetzten Datei, die
   * `measureWholeFile` aus dem Objekt des Providers rechnet. Eine Luecke
   * entsteht daraus nicht: Die Quelle war sauber, als sie abgelegt wurde,
   * sonst waere sie nicht sichtbar, und das Ergebnis wird noch einmal
   * geurteilt.
   *
   * **Grenzen.** Ein Teil ist auf `maxPutBytes` begrenzt wie ein
   * hochgeladenes, weil die Bytes im Speicher dieses Prozesses liegen, waehrend
   * sie weitergereicht werden. Der Bereich muss beide Enden nennen (S3 kennt
   * fuer `x-amz-copy-source-range` keine offene Form). Nummer und Anzahl der
   * Teile pruefen dieselben Stellen wie bei `UploadPart`: 1 bis 10000 in
   * `operation()`, Reihenfolge und Vollstaendigkeit erst beim Abschluss im
   * Dienst.
   */
  private async uploadPartCopy(
    principal: ProjectStoragePrincipal,
    key: AuthenticatedProjectStorageS3AccessKey,
    bucket: PublicProjectStorageBucket,
    targetKey: string,
    uploadId: string,
    partNumber: number,
    source: { bucket: string; key: string },
    sourceRange: string | null,
  ): Promise<Response> {
    const scope = key.scope;
    const sourceBucket = await this.bucket(principal, key, source.bucket);
    const sourceObject = await this.findObject(principal, scope, sourceBucket, source.key);
    if (!sourceObject) throw noSuchKey();
    const range = parseCopySourceRange(sourceRange, sourceObject.sizeBytes);
    const wanted = range ? range.end - range.start + 1 : sourceObject.sizeBytes;
    if (wanted < 1) throw new S3ResponseError(400, "InvalidArgument", "A copied part is empty.");
    if (wanted > this.maxPutBytes) {
      throw new S3ResponseError(400, "EntityTooLarge", `UploadPartCopy through this endpoint moves at most ${this.maxPutBytes} bytes per part; narrow x-amz-copy-source-range.`);
    }
    const grant = await this.storage(() => this.dependencies.storage.createDownloadGrant(
      principal, scope, sourceBucket.id, { key: sourceObject.key }));
    const upstream = await this.fetchFn(grant.url, {
      method: "GET", redirect: "error",
      ...(range ? { headers: { Range: `bytes=${range.start}-${range.end}` } } : {}),
    }).catch(() => null);
    if (!upstream || !upstream.ok) {
      throw new S3ResponseError(503, "ServiceUnavailable", "The object store did not serve the source object.");
    }
    let body = Buffer.from(await upstream.arrayBuffer());
    // Ein Provider, der den Bereich ignoriert und das ganze Objekt schickt,
    // wird geschnitten statt geglaubt — so wie `getObject` es tut.
    if (range && body.byteLength === sourceObject.sizeBytes && wanted !== sourceObject.sizeBytes) {
      body = body.subarray(range.start, range.end + 1);
    }
    if (body.byteLength !== wanted) {
      throw new S3ResponseError(503, "ServiceUnavailable", "The object store served a source range of another size.");
    }
    const etag = await this.storePart(principal, scope, bucket, targetKey, uploadId, partNumber, body);
    return xml(200, `<CopyPartResult xmlns="${S3_XMLNS}"><LastModified>${
      escapeXml(this.now().toISOString())}</LastModified><ETag>${escapeXml(quotedEtag(etag))}</ETag></CopyPartResult>`);
  }

  /**
   * Der gemeinsame Weg beider Teile-Operationen: buchen, zum Provider
   * reichen, vermerken. `UploadPart` und `UploadPartCopy` teilen ihn absichtlich
   * Zeile fuer Zeile, damit es keine zweite Tuer an Quota, Teilegrenze und
   * Vermerk vorbei gibt — nur die Herkunft der Bytes unterscheidet sie.
   */
  private async storePart(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucket: PublicProjectStorageBucket,
    key: string,
    uploadId: string,
    partNumber: number,
    body: Buffer,
  ): Promise<string> {
    const checksumSha256 = createHash("sha256").update(body).digest("base64");
    const grant = await this.storage(() => this.dependencies.storage.createS3PartUploadGrant(principal, scope, {
      bucketIdOrName: bucket.id, key, uploadId, partNumber, sizeBytes: body.byteLength, checksumSha256,
    }));
    const bytes = new Uint8Array(new ArrayBuffer(body.byteLength));
    bytes.set(body);
    const stored = await this.fetchFn(grant.url, {
      method: grant.method, headers: grant.headers, body: bytes, redirect: "error",
    }).catch(() => null);
    if (!stored || !stored.ok) {
      throw new S3ResponseError(503, "ServiceUnavailable", "The object store did not accept the part.");
    }
    // Die Kennung wird gelassen, wie der Provider sie gemeldet hat,
    // Anfuehrungszeichen inklusive: Sie geht beim Abschluss unveraendert an
    // ihn zurueck.
    const etag = (stored.headers.get("etag") ?? "").trim();
    if (etag === "" || etag === '""') {
      throw new S3ResponseError(503, "ServiceUnavailable", "The object store accepted the part without an ETag.");
    }
    await this.storage(() => this.dependencies.storage.confirmS3UploadPart(principal, scope, {
      bucketIdOrName: bucket.id, key, uploadId, partNumber, etag,
    }));
    return etag;
  }

  /**
   * `CompleteMultipartUpload`. Die Teileliste kommt als XML; der Dienst prueft
   * sie gegen die Teile, die dieser Endpunkt angenommen hat, setzt beim
   * Provider zusammen und gibt eine Lesezusage heraus, aus der der Endpunkt
   * die Pruefsumme der **ganzen** Datei rechnet. Erst diese Summe sieht der
   * Scanner, und erst sein Abgleich macht das Objekt sauber.
   */
  private async completeMultipartUpload(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucket: PublicProjectStorageBucket,
    key: string,
    uploadId: string,
    body: Buffer,
  ): Promise<Response> {
    const parts = parseCompleteMultipartBody(body);
    const object = await this.storage(() => this.dependencies.storage.completeS3MultipartUpload(principal, scope, {
      bucketIdOrName: bucket.id,
      key,
      uploadId,
      parts,
      measureWholeFile: async (grant, expected) => await this.measureWholeFile(grant.url, expected.sizeBytes),
    }));
    const headers = new Headers({ "x-qkern-object-status": object.status });
    return xml(200, `<CompleteMultipartUploadResult xmlns="${S3_XMLNS}"><Location>${
      escapeXml(`${this.basePath}/${bucket.name}/${key}`)}</Location><Bucket>${
      escapeXml(bucket.name)}</Bucket><Key>${escapeXml(key)}</Key>${
      object.etag ? `<ETag>${escapeXml(quoteEtag(object.etag))}</ETag>` : ""
    }</CompleteMultipartUploadResult>`, headers);
  }

  /**
   * Die Pruefsumme des zusammengesetzten Objekts, im Strom gerechnet.
   *
   * Sie wird nicht gepuffert: Die Bytes laufen durch den Hash und werden
   * verworfen. Kommt mehr oder weniger als der HEAD des Providers gesagt hat,
   * bricht die Rechnung ab, und der Dienst raeumt das Objekt und die
   * Reservierung weg.
   */
  private async measureWholeFile(url: string, expectedBytes: number): Promise<string> {
    const response = await this.fetchFn(url, { method: "GET", redirect: "error" }).catch(() => null);
    if (!response || !response.ok || !response.body) {
      throw new S3ResponseError(503, "ServiceUnavailable", "The object store did not serve the assembled object.");
    }
    const digest = createHash("sha256");
    let seen = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      seen += value.byteLength;
      if (seen > expectedBytes) {
        await reader.cancel().catch(() => undefined);
        throw new S3ResponseError(500, "InternalError", "The assembled object grew while it was being verified.");
      }
      digest.update(value);
    }
    if (seen !== expectedBytes) {
      throw new S3ResponseError(500, "InternalError", "The assembled object was shorter than the object store reported.");
    }
    return digest.digest("base64");
  }

  /** `ListParts` — aus dem Satz des Dienstes, nicht aus dem des Providers. */
  private async listParts(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucket: PublicProjectStorageBucket,
    key: string,
    uploadId: string,
    query: URLSearchParams,
  ): Promise<Response> {
    const listed = await this.storage(() => this.dependencies.storage.listS3UploadParts(principal, scope, {
      bucketIdOrName: bucket.id, key, uploadId,
    }));
    const maxParts = boundedInteger(query.get("max-parts"), 1_000, 1, 1_000, "max-parts");
    const after = boundedInteger(query.get("part-number-marker"), 0, 0, 10_000, "part-number-marker");
    const eligible = listed.parts.filter((part) => part.partNumber > after);
    const page = eligible.slice(0, maxParts);
    const truncated = eligible.length > page.length;
    return xml(200, `<ListPartsResult xmlns="${S3_XMLNS}"><Bucket>${escapeXml(bucket.name)}</Bucket><Key>${
      escapeXml(listed.key)}</Key><UploadId>${escapeXml(uploadId)}</UploadId><PartNumberMarker>${
      after}</PartNumberMarker><MaxParts>${maxParts}</MaxParts><IsTruncated>${truncated}</IsTruncated>${
      truncated ? `<NextPartNumberMarker>${page[page.length - 1].partNumber}</NextPartNumberMarker>` : ""
    }${page.map((part) => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${
      escapeXml(quotedEtag(part.etag ?? ""))}</ETag><Size>${part.sizeBytes}</Size><LastModified>${
      escapeXml(part.createdAt.toISOString())}</LastModified></Part>`).join("")}</ListPartsResult>`);
  }

  /** `ListMultipartUploads` — die offenen Uploads dieses Buckets. */
  private async listMultipartUploads(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucket: PublicProjectStorageBucket,
    query: URLSearchParams,
  ): Promise<Response> {
    const prefix = query.get("prefix") ?? "";
    const maxUploads = boundedInteger(query.get("max-uploads"), 1_000, 1, 1_000, "max-uploads");
    const uploads = await this.storage(() => this.dependencies.storage.listS3MultipartUploads(
      principal, scope, bucket.id, { prefix }));
    const page = uploads.slice(0, maxUploads);
    const truncated = uploads.length > page.length;
    return xml(200, `<ListMultipartUploadsResult xmlns="${S3_XMLNS}"><Bucket>${
      escapeXml(bucket.name)}</Bucket><KeyMarker></KeyMarker><UploadIdMarker></UploadIdMarker><Prefix>${
      escapeXml(prefix)}</Prefix><MaxUploads>${maxUploads}</MaxUploads><IsTruncated>${truncated}</IsTruncated>${
      page.map((upload) => `<Upload><Key>${escapeXml(upload.key)}</Key><UploadId>${
        escapeXml(upload.uploadId)}</UploadId><Initiated>${escapeXml(upload.initiatedAt.toISOString())
      }</Initiated></Upload>`).join("")}</ListMultipartUploadsResult>`);
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

  /**
   * Der Lauf ueber die Liste des Dienstes, den beide Versionen von
   * `ListObjects` teilen (2.123).
   *
   * Er ist gemeinsam, weil Delimiter und `CommonPrefixes` sonst in zwei Formen
   * auseinanderlaufen wuerden: Ein Schluessel wird genau einmal angesehen und
   * landet entweder in `Contents` oder als Gruppe in `CommonPrefixes`, und die
   * Grenze `max-keys` zaehlt beide zusammen, so wie S3 es tut. Was die
   * Versionen unterscheidet, steht hinterher in der Antwort: wie die
   * Fortsetzung heisst.
   *
   * Die Fortsetzung ist in beiden Formen **ein Schluessel**, der zuletzt
   * angesehene, und sie ist ausschliessend. Bei einer Gruppe ist das nicht der
   * Gruppenname, sondern der letzte Schluessel darin; wer von dort weiterlaeuft,
   * sieht die Gruppe hoechstens noch einmal und ueberspringt nichts. Das
   * unterscheidet sich von S3, das als `NextMarker` den Gruppennamen nennt und
   * damit die ganze Gruppe ueberspringt, und es ist die vorsichtigere Seite:
   * Ein doppelter `CommonPrefixes`-Eintrag ueber zwei Seiten kostet den
   * Aufrufer nichts, ein uebersprungener Schluessel kostet ihn Daten.
   */
  private async walkObjects(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucket: PublicProjectStorageBucket,
    options: { prefix: string; delimiter: string; maxKeys: number; after: string | undefined },
  ): Promise<{
    contents: PublicProjectStorageObject[];
    commonPrefixes: string[];
    truncated: boolean;
    nextKey: string | null;
  }> {
    const { prefix, delimiter, maxKeys } = options;
    if (delimiter.length > 1) {
      throw new S3ResponseError(501, "NotImplemented", "Only single-character delimiters are implemented.");
    }
    let cursor = options.after;
    const contents: PublicProjectStorageObject[] = [];
    const commonPrefixes: string[] = [];
    const seenPrefixes = new Set<string>();
    let truncated = false;
    let nextKey: string | null = null;
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
        nextKey = object.key;
      }
      if (truncated) break;
      if (!result.nextCursor) { nextKey = null; break; }
      cursor = result.nextCursor;
      if (page === MAX_LIST_PAGES - 1) truncated = true;
    }
    return { contents, commonPrefixes, truncated, nextKey };
  }

  /**
   * `ListObjects` Version 1 (2.123): dieselbe Liste wie Version 2, mit
   * `marker` und `NextMarker`.
   *
   * `marker` ist ein Schluessel im Klartext, nicht eine Kennung wie
   * `continuation-token`, weil v1 ihn so kennt: Ein Aufrufer darf ihn selbst
   * setzen, und viele Werkzeuge tun das, indem sie den letzten Schluessel der
   * vorigen Seite nehmen. Darum wird er nicht geprueft wie ein Token, sondern
   * ausschliessend an den Dienst gereicht, so wie `start-after` bei Version 2.
   *
   * `NextMarker` kommt, sooft die Antwort abgeschnitten ist, auch ohne
   * Delimiter. S3 schickt es nur mit Delimiter und erwartet sonst, dass der
   * Aufrufer den letzten Schluessel selbst liest. Das ist eine Falle fuer jedes
   * Werkzeug, das mit Delimiter arbeitet und ohne, und es kostet nichts, die
   * Antwort vollstaendig zu machen: Ein Aufrufer, der `NextMarker` ignoriert
   * und den letzten Schluessel nimmt, bekommt bei uns dieselbe Fortsetzung.
   */
  private async listObjectsV1(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucket: PublicProjectStorageBucket,
    query: URLSearchParams,
  ): Promise<Response> {
    const prefix = query.get("prefix") ?? "";
    const delimiter = query.get("delimiter") ?? "";
    const encode = query.get("encoding-type") === "url";
    const maxKeys = boundedInteger(query.get("max-keys"), MAX_KEYS, 1, MAX_KEYS);
    const marker = query.get("marker") ?? "";
    if (marker.length > 1024) {
      throw new S3ResponseError(400, "InvalidArgument", "Argument marker is longer than an object key may be.");
    }
    const walk = await this.walkObjects(principal, scope, bucket, {
      prefix, delimiter, maxKeys, after: marker || undefined,
    });
    const text = (value: string) => escapeXml(encode ? encodeURIComponent(value).replace(/%2F/g, "/") : value);
    return xml(200, `<ListBucketResult xmlns="${S3_XMLNS}"><Name>${escapeXml(bucket.name)}</Name><Prefix>${
      text(prefix)}</Prefix><Marker>${text(marker)}</Marker>${
      delimiter ? `<Delimiter>${text(delimiter)}</Delimiter>` : ""
    }${encode ? "<EncodingType>url</EncodingType>" : ""}<MaxKeys>${maxKeys}</MaxKeys><IsTruncated>${
      walk.truncated}</IsTruncated>${
      walk.truncated && walk.nextKey ? `<NextMarker>${text(walk.nextKey)}</NextMarker>` : ""
    }${listedObjectsXml(walk.contents, walk.commonPrefixes, text)}</ListBucketResult>`);
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
    const after = token ? decodeToken(token) : (query.get("start-after") || undefined);
    const walk = await this.walkObjects(principal, scope, bucket, { prefix, delimiter, maxKeys, after });
    const text = (value: string) => escapeXml(encode ? encodeURIComponent(value).replace(/%2F/g, "/") : value);
    return xml(200, `<ListBucketResult xmlns="${S3_XMLNS}"><Name>${escapeXml(bucket.name)}</Name><Prefix>${text(prefix)}</Prefix>${
      delimiter ? `<Delimiter>${text(delimiter)}</Delimiter>` : ""
    }${encode ? "<EncodingType>url</EncodingType>" : ""}<KeyCount>${
      walk.contents.length + walk.commonPrefixes.length}</KeyCount><MaxKeys>${maxKeys}</MaxKeys><IsTruncated>${
      walk.truncated}</IsTruncated>${
      token ? `<ContinuationToken>${escapeXml(token)}</ContinuationToken>` : ""
    }${walk.truncated && walk.nextKey ? `<NextContinuationToken>${escapeXml(encodeToken(walk.nextKey))}</NextContinuationToken>` : ""}${
      listedObjectsXml(walk.contents, walk.commonPrefixes, text)}</ListBucketResult>`);
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
    // Eine Antwort, die dieser Endpunkt selbst schon formuliert hat, bleibt
    // stehen: Sie kommt aus einem Rueckruf, den der Dienst aufruft (etwa dem
    // Nachrechnen der ganzen Datei), und ist genauer als ein 500er.
    if (error instanceof S3ResponseError) return error;
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
    case "STORAGE_UPLOAD_NOT_FOUND":
      return new S3ResponseError(404, "NoSuchUpload", "The specified multipart upload does not exist. The upload ID may be invalid, or the upload may have been aborted or completed.");
    case "STORAGE_PART_ORDER":
      return new S3ResponseError(400, "InvalidPartOrder", "The list of parts was not in ascending order. Parts must be ordered by part number.");
    case "STORAGE_PART_UNKNOWN":
      return new S3ResponseError(400, "InvalidPart", "One or more of the specified parts could not be found. The part may not have been uploaded, or the specified ETag may not have matched the part's ETag.");
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
 * `x-amz-copy-source-range` fuer `UploadPartCopy`: nur `bytes=first-last`, mit
 * beiden Enden.
 *
 * S3 kennt hier keine offene Form, und das ist kein Zufall: Bei `Range` auf
 * einem GET darf ein Server den Bereich stillschweigend kuerzen, bei einem
 * kopierten Teil nicht, denn die Groesse des Teils entscheidet mit darueber, ob
 * die zusammengesetzte Datei die ist, die der Aufrufer gemeint hat. Eine Form,
 * die wir nicht genau verstehen, wird darum abgewiesen und nicht ausgelegt.
 * Ohne Kopfzeile kommt das ganze Objekt.
 */
function parseCopySourceRange(header: string | null, size: number): { start: number; end: number } | null {
  if (header === null || header.trim() === "") return null;
  const match = /^\s*bytes\s*=\s*(\d+)\s*-\s*(\d+)\s*$/.exec(header);
  if (!match) {
    throw new S3ResponseError(400, "InvalidArgument", "x-amz-copy-source-range must name both ends, as bytes=first-last.");
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end >= size) {
    throw new S3ResponseError(416, "InvalidRange", `The x-amz-copy-source-range is not satisfiable for a source of ${size} bytes.`);
  }
  return { start, end };
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

/** `Contents` und `CommonPrefixes` sind in beiden Versionen von `ListObjects` gleich gebaut. */
function listedObjectsXml(
  contents: ReadonlyArray<PublicProjectStorageObject>,
  commonPrefixes: ReadonlyArray<string>,
  text: (value: string) => string,
): string {
  return `${contents.map((object) => `<Contents><Key>${text(object.key)}</Key><LastModified>${
    escapeXml(object.createdAt)}</LastModified>${
    object.etag ? `<ETag>${escapeXml(quoteEtag(object.etag))}</ETag>` : ""
  }<Size>${object.sizeBytes}</Size><StorageClass>STANDARD</StorageClass></Contents>`).join("")
  }${commonPrefixes.map((common) => `<CommonPrefixes><Prefix>${text(common)}</Prefix></CommonPrefixes>`).join("")}`;
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

function quotedEtag(value: string): string {
  return value.startsWith('"') ? value : quoteEtag(value);
}

function quoteEtag(value: string): string {
  return value.startsWith('"') ? value : `"${value}"`;
}

function decodeSegment(segment: string): string {
  try { return decodeURIComponent(segment); } catch {
    throw new S3ResponseError(400, "InvalidURI", "Couldn't parse the specified URI.");
  }
}

function boundedInteger(value: string | null, fallback: number, min: number, max: number, name = "max-keys"): number {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new S3ResponseError(400, "InvalidArgument", `Argument ${name} must be an integer between ${min} and ${max}.`);
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

/**
 * Die Teileliste aus `CompleteMultipartUpload`.
 *
 * Gelesen wird, was S3-Clients schicken: `<Part>` mit `<PartNumber>` und
 * `<ETag>`. Die Reihenfolge bleibt die des Dokuments — ob sie aufsteigt,
 * entscheidet der Dienst, nicht dieser Leser, denn genau daran haengt, ob die
 * Bytes so zusammengesetzt werden, wie die Pruefsumme sie beschreibt.
 */
function parseCompleteMultipartBody(body: Buffer): Array<{ partNumber: number; etag: string }> {
  const text = body.toString("utf8");
  if (text.trim() === "") {
    throw new S3ResponseError(400, "MalformedXML", "The XML you provided was not well-formed: the part list is missing.");
  }
  const parts: Array<{ partNumber: number; etag: string }> = [];
  for (const match of text.matchAll(/<Part>([\s\S]*?)<\/Part>/g)) {
    const block = match[1];
    const number = /<PartNumber>\s*(\d{1,5})\s*<\/PartNumber>/.exec(block);
    const etag = /<ETag>([\s\S]*?)<\/ETag>/.exec(block);
    if (!number || !etag) {
      throw new S3ResponseError(400, "MalformedXML", "Every Part needs a PartNumber and an ETag.");
    }
    parts.push({
      partNumber: boundedInteger(number[1], 1, 1, MAX_COMPLETE_PARTS, "PartNumber"),
      etag: unescapeXml(etag[1]).trim().replace(/^"|"$/g, ""),
    });
  }
  if (parts.length < 1) {
    throw new S3ResponseError(400, "MalformedXML", "The XML you provided was not well-formed: no Part was named.");
  }
  if (parts.length > MAX_COMPLETE_PARTS) {
    throw new S3ResponseError(400, "InvalidRequest", `A multipart upload takes at most ${MAX_COMPLETE_PARTS} parts.`);
  }
  return parts;
}

function errorXml(status: number, code: string, message: string, resource: string, method: string, extra?: Record<string, string>): Response {
  const body = `<Error><Code>${escapeXml(code)}</Code><Message>${escapeXml(message)}</Message><Resource>${escapeXml(resource)}</Resource></Error>`;
  const response = method.toUpperCase() === "HEAD"
    ? new Response(null, { status, headers: { "Content-Type": "application/xml", "x-qkern-s3-error": code } })
    : xml(status, body);
  for (const [name, value] of Object.entries(extra ?? {})) response.headers.set(name, value);
  return response;
}
