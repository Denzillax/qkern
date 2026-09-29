import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { crc32 } from "node:zlib";
import { recognisedByName } from "@/lib/server/errors/identity";

/**
 * AWS Signature Version 4 fuer den S3-Endpunkt von QKERN (2.96, erweitert 2.99).
 *
 * Nachgerechnet wird, was ein S3-Client schickt: die Signatur im Header
 * `Authorization` (`AWS4-HMAC-SHA256 Credential=…, SignedHeaders=…,
 * Signature=…`) oder, seit 2.99, dieselbe Signatur in der Query einer
 * Presigned URL (`X-Amz-Algorithm=…&X-Amz-Signature=…`). Dazu kommen die
 * Koerperformen, die ein Client ueber HTTP waehlt: der SHA-256 des Koerpers
 * als Hex, `UNSIGNED-PAYLOAD`, und `aws-chunked` mit je Stueck signierten
 * Bloecken (`STREAMING-AWS4-HMAC-SHA256-PAYLOAD`), mit oder ohne Trailer,
 * signiert oder unsigniert.
 *
 * Das Modul kennt weder Datenbank noch Dienst. Es bekommt die Anfrage, das
 * Geheimnis und die Uhr, und es antwortet mit einem Grund oder mit nichts.
 * Das Geheimnis erscheint in keinem Rueckgabewert und in keinem Fehler.
 */

export const SIGV4_ALGORITHM = "AWS4-HMAC-SHA256";
export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
export const STREAMING_SIGNED_PAYLOAD = "STREAMING-AWS4-HMAC-SHA256-PAYLOAD";
export const STREAMING_SIGNED_PAYLOAD_TRAILER = "STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER";
export const STREAMING_UNSIGNED_PAYLOAD_TRAILER = "STREAMING-UNSIGNED-PAYLOAD-TRAILER";
/** 15 Minuten, wie bei S3 selbst. */
export const SIGV4_MAX_SKEW_MS = 15 * 60 * 1_000;
/**
 * Die harte Obergrenze einer Presigned URL: 15 Minuten, dieselbe Grenze wie
 * bei den signierten Zusagen des Dienstes (`grantTtlSeconds` bis 900). S3
 * selbst erlaubt sieben Tage; QKERN nicht, weil ein Paar eine Zugangsart ist
 * und eine Adresse, die eine Woche lang ohne Paar liest, eine zweite waere.
 */
export const PRESIGNED_MAX_EXPIRES_SECONDS = 900;

const AUTHORIZATION = /^AWS4-HMAC-SHA256\s+(.+)$/s;
const ACCESS_KEY_ID = /^[A-Za-z0-9]{16,128}$/;
const AMZ_DATE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const SIGNATURE = /^[0-9a-f]{64}$/;
const REGION = /^[a-z0-9-]{1,64}$/;
const EMPTY_SHA256 = sha256Hex("");
/** Die Pruefsummen, die ein Client als Header oder Trailer mitschicken kann; S3 kennt genau diese fuenf. */
const CHECKSUM_HEADERS = ["x-amz-checksum-crc32", "x-amz-checksum-crc32c", "x-amz-checksum-crc64nvme", "x-amz-checksum-sha1", "x-amz-checksum-sha256"] as const;

export type SigV4Authorization = {
  accessKeyId: string;
  /** YYYYMMDD aus dem Credential-Scope. */
  date: string;
  region: string;
  service: string;
  signedHeaders: string[];
  signature: string;
};

export type SigV4FailureCode =
  | "MISSING_AUTHORIZATION"
  | "MALFORMED_AUTHORIZATION"
  | "UNSUPPORTED_SERVICE"
  | "MISSING_SIGNED_HEADER"
  | "MISSING_DATE"
  | "MALFORMED_DATE"
  | "SCOPE_DATE_MISMATCH"
  | "REQUEST_TIME_TOO_SKEWED"
  | "MISSING_CONTENT_SHA256"
  | "UNSUPPORTED_PAYLOAD_SIGNING"
  | "SIGNATURE_DOES_NOT_MATCH"
  | "PRESIGNED_EXPIRES_INVALID"
  | "PRESIGNED_EXPIRED"
  | "CHUNK_MALFORMED"
  | "CHUNK_SIGNATURE_DOES_NOT_MATCH"
  | "CHECKSUM_MALFORMED"
  | "CHECKSUM_MISMATCH";

export class SigV4Error extends Error {
  constructor(readonly code: SigV4FailureCode) {
    super(code);
    this.name = "SigV4Error";
  }
}
recognisedByName(SigV4Error, "SigV4Error");

/**
 * Liest den Header und sonst nichts. Wer den oeffentlichen Teil kennt, kann
 * das Geheimnis holen; erst danach laesst sich rechnen.
 */
export function parseSigV4Authorization(headers: Headers): SigV4Authorization {
  const raw = headers.get("authorization");
  if (!raw) throw new SigV4Error("MISSING_AUTHORIZATION");
  const match = AUTHORIZATION.exec(raw.trim());
  if (!match) throw new SigV4Error("MALFORMED_AUTHORIZATION");
  const parts = new Map<string, string>();
  for (const entry of match[1].split(",")) {
    const separator = entry.indexOf("=");
    if (separator < 1) throw new SigV4Error("MALFORMED_AUTHORIZATION");
    parts.set(entry.slice(0, separator).trim(), entry.slice(separator + 1).trim());
  }
  const credential = parts.get("Credential")?.split("/") ?? [];
  const signedHeaders = parts.get("SignedHeaders")?.split(";").map((name) => name.trim().toLowerCase()) ?? [];
  const signature = parts.get("Signature") ?? "";
  if (credential.length !== 5 || credential[4] !== "aws4_request" ||
      !ACCESS_KEY_ID.test(credential[0]) || !/^\d{8}$/.test(credential[1]) ||
      !REGION.test(credential[2]) || !credential[3] ||
      signedHeaders.length === 0 || signedHeaders.some((name) => !/^[a-z0-9-]+$/.test(name)) ||
      !SIGNATURE.test(signature)) {
    throw new SigV4Error("MALFORMED_AUTHORIZATION");
  }
  if (credential[3] !== "s3") throw new SigV4Error("UNSUPPORTED_SERVICE");
  if (!signedHeaders.includes("host")) throw new SigV4Error("MISSING_SIGNED_HEADER");
  return {
    accessKeyId: credential[0],
    date: credential[1],
    region: credential[2],
    service: credential[3],
    signedHeaders,
    signature,
  };
}

/** Ob eine Anfrage ihre Signatur in der Query traegt (Presigned URL) statt im Header. */
export function isPresignedUrl(url: URL): boolean {
  return url.searchParams.has("X-Amz-Signature") || url.searchParams.has("X-Amz-Algorithm") ||
    url.searchParams.has("X-Amz-Credential");
}

export type SigV4PresignedAuthorization = SigV4Authorization & {
  /** `X-Amz-Date`, wie er in der Query steht. */
  amzDate: string;
  /** `X-Amz-Expires` in Sekunden, bereits gegen die Obergrenze geprueft. */
  expiresSeconds: number;
};

/**
 * Liest eine Presigned URL (2.99): dieselben fuenf Angaben wie der Header,
 * nur als Query-Parameter, dazu `X-Amz-Date` und `X-Amz-Expires`. Eine
 * Adresse, die laenger als `PRESIGNED_MAX_EXPIRES_SECONDS` gelten will, ist
 * hier schon ungueltig; der Endpunkt prueft die Zeit selbst nicht nach.
 */
export function parseSigV4Query(url: URL): SigV4PresignedAuthorization {
  const query = url.searchParams;
  const algorithm = query.get("X-Amz-Algorithm");
  const credential = query.get("X-Amz-Credential")?.split("/") ?? [];
  const signedHeaders = query.get("X-Amz-SignedHeaders")?.split(";").map((name) => name.trim().toLowerCase()) ?? [];
  const signature = query.get("X-Amz-Signature") ?? "";
  const amzDate = query.get("X-Amz-Date") ?? "";
  const expires = query.get("X-Amz-Expires") ?? "";
  if (algorithm !== SIGV4_ALGORITHM) throw new SigV4Error("MALFORMED_AUTHORIZATION");
  if (credential.length !== 5 || credential[4] !== "aws4_request" ||
      !ACCESS_KEY_ID.test(credential[0]) || !/^\d{8}$/.test(credential[1]) ||
      !REGION.test(credential[2]) || !credential[3] ||
      signedHeaders.length === 0 || signedHeaders.some((name) => !/^[a-z0-9-]+$/.test(name)) ||
      !SIGNATURE.test(signature)) {
    throw new SigV4Error("MALFORMED_AUTHORIZATION");
  }
  if (credential[3] !== "s3") throw new SigV4Error("UNSUPPORTED_SERVICE");
  if (!signedHeaders.includes("host")) throw new SigV4Error("MISSING_SIGNED_HEADER");
  if (!AMZ_DATE.test(amzDate)) throw new SigV4Error("MALFORMED_DATE");
  if (amzDate.slice(0, 8) !== credential[1]) throw new SigV4Error("SCOPE_DATE_MISMATCH");
  if (!/^\d{1,6}$/.test(expires)) throw new SigV4Error("PRESIGNED_EXPIRES_INVALID");
  const expiresSeconds = Number(expires);
  if (expiresSeconds < 1 || expiresSeconds > PRESIGNED_MAX_EXPIRES_SECONDS) throw new SigV4Error("PRESIGNED_EXPIRES_INVALID");
  return {
    accessKeyId: credential[0],
    date: credential[1],
    region: credential[2],
    service: credential[3],
    signedHeaders,
    signature,
    amzDate,
    expiresSeconds,
  };
}

/**
 * Die Zeit einer Presigned URL: Sie gilt ab `X-Amz-Date` fuer `X-Amz-Expires`
 * Sekunden. Vorher darf sie um die uebliche Abweichung liegen, damit eine
 * Uhr, die nachgeht, nicht jede Adresse kaputt macht; danach ist sie abgelaufen.
 */
export function sigV4PresignedTime(authorization: SigV4PresignedAuthorization, now: Date): { amzDate: string; at: Date } {
  const match = AMZ_DATE.exec(authorization.amzDate);
  if (!match) throw new SigV4Error("MALFORMED_DATE");
  const at = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`);
  if (Number.isNaN(at.getTime())) throw new SigV4Error("MALFORMED_DATE");
  if (at.getTime() - now.getTime() > SIGV4_MAX_SKEW_MS) throw new SigV4Error("REQUEST_TIME_TOO_SKEWED");
  if (now.getTime() > at.getTime() + authorization.expiresSeconds * 1_000) throw new SigV4Error("PRESIGNED_EXPIRED");
  return { amzDate: authorization.amzDate, at };
}

export type SigV4Request = {
  method: string;
  /** Die URL, wie sie auf der Leitung stand; der Pfad bleibt kodiert. */
  url: URL;
  headers: Headers;
};

/**
 * Der Zeitpunkt der Anfrage aus `x-amz-date` oder `Date`, geprueft gegen die
 * Uhr des Servers und gegen den Tag im Credential-Scope. Ein Tag, der nicht
 * zum Zeitstempel passt, waere ein Signierschluessel fuer einen anderen Tag.
 */
export function sigV4RequestTime(headers: Headers, authorization: SigV4Authorization, now: Date): {
  amzDate: string;
  at: Date;
} {
  const amzDate = headers.get("x-amz-date")?.trim();
  let at: Date;
  let stamp: string;
  if (amzDate) {
    const match = AMZ_DATE.exec(amzDate);
    if (!match) throw new SigV4Error("MALFORMED_DATE");
    at = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`);
    stamp = amzDate;
  } else {
    const dateHeader = headers.get("date")?.trim();
    if (!dateHeader) throw new SigV4Error("MISSING_DATE");
    at = new Date(dateHeader);
    stamp = at.toISOString().replace(/[:-]|\.\d{3}/g, "");
  }
  if (Number.isNaN(at.getTime())) throw new SigV4Error("MALFORMED_DATE");
  if (stamp.slice(0, 8) !== authorization.date) throw new SigV4Error("SCOPE_DATE_MISMATCH");
  if (Math.abs(at.getTime() - now.getTime()) > SIGV4_MAX_SKEW_MS) {
    throw new SigV4Error("REQUEST_TIME_TOO_SKEWED");
  }
  return { amzDate: stamp, at };
}

/**
 * Der deklarierte Payload-Hash. S3 verlangt den Header; die Signatur deckt
 * ihn, und nach dem Lesen des Koerpers prueft der Endpunkt, ob er stimmt.
 * Die drei `STREAMING-*`-Formen (aws-chunked) gehen als Wort in die Signatur
 * ein; die Bloecke dahinter prueft `decodeAwsChunkedBody`. Was keines davon
 * ist, wird gesagt und nicht geraten.
 */
export function declaredPayloadHash(headers: Headers): string {
  const value = headers.get("x-amz-content-sha256")?.trim();
  if (!value) throw new SigV4Error("MISSING_CONTENT_SHA256");
  if (value === UNSIGNED_PAYLOAD || isStreamingPayload(value)) return value;
  if (HEX_SHA256.test(value)) return value;
  throw new SigV4Error("UNSUPPORTED_PAYLOAD_SIGNING");
}

export function isStreamingPayload(declared: string): boolean {
  return declared === STREAMING_SIGNED_PAYLOAD || declared === STREAMING_SIGNED_PAYLOAD_TRAILER ||
    declared === STREAMING_UNSIGNED_PAYLOAD_TRAILER;
}

/**
 * Rechnet die Signatur nach und vergleicht in konstanter Zeit. Der Aufrufer
 * hat die Zeit schon geprueft; hier wird nur noch gerechnet.
 *
 * Bei einer Presigned URL (`presigned: true`) steht die Signatur selbst in
 * der Query und bleibt aus der kanonischen Query draussen; der Koerper gilt
 * als `UNSIGNED-PAYLOAD`, so definiert S3 die Form.
 */
export function verifySigV4Signature(input: {
  request: SigV4Request;
  authorization: SigV4Authorization;
  amzDate: string;
  payloadHash: string;
  secret: string;
  presigned?: boolean;
}): void {
  const { request, authorization } = input;
  const canonicalHeaders = authorization.signedHeaders.map((name) => {
    const value = name === "host"
      ? (request.headers.get("host") ?? request.url.host)
      : request.headers.get(name);
    if (value === null || value === undefined) throw new SigV4Error("MISSING_SIGNED_HEADER");
    return `${name}:${value.trim().replace(/\s+/g, " ")}\n`;
  }).join("");
  const canonicalRequest = [
    request.method.toUpperCase(),
    request.url.pathname || "/",
    canonicalQuery(request.url.search, input.presigned ? "X-Amz-Signature" : undefined),
    canonicalHeaders,
    authorization.signedHeaders.join(";"),
    input.presigned ? UNSIGNED_PAYLOAD : input.payloadHash,
  ].join("\n");
  const scope = `${authorization.date}/${authorization.region}/${authorization.service}/aws4_request`;
  const stringToSign = [SIGV4_ALGORITHM, input.amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const expected = createHmac("sha256", signingKey(input.secret, authorization.date, authorization.region))
    .update(stringToSign, "utf8").digest();
  const provided = Buffer.from(authorization.signature, "hex");
  if (provided.byteLength !== expected.byteLength || !timingSafeEqual(provided, expected)) {
    throw new SigV4Error("SIGNATURE_DOES_NOT_MATCH");
  }
}

export function signingKey(secret: string, date: string, region: string): Buffer {
  const dateKey = createHmac("sha256", `AWS4${secret}`).update(date).digest();
  const regionKey = createHmac("sha256", dateKey).update(region).digest();
  const serviceKey = createHmac("sha256", regionKey).update("s3").digest();
  return createHmac("sha256", serviceKey).update("aws4_request").digest();
}

/**
 * Query in kanonischer Form: Namen und Werte nach RFC 3986 kodiert, nach
 * Namen und dann nach Wert sortiert, ein Wert je Parameter.
 */
export function canonicalQuery(search: string, omit?: string): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (!raw) return "";
  const pairs: Array<[string, string]> = [];
  for (const entry of raw.split("&")) {
    if (!entry) continue;
    const separator = entry.indexOf("=");
    const name = separator < 0 ? entry : entry.slice(0, separator);
    const value = separator < 0 ? "" : entry.slice(separator + 1);
    const decodedName = decodeQueryComponent(name);
    if (omit !== undefined && decodedName === omit) continue;
    pairs.push([awsUriEncode(decodedName), awsUriEncode(decodeQueryComponent(value))]);
  }
  pairs.sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0);
  return pairs.map(([name, value]) => `${name}=${value}`).join("&");
}

function decodeQueryComponent(value: string): string {
  try { return decodeURIComponent(value.replace(/\+/g, "%20")); } catch { return value; }
}

/** RFC 3986 ohne Ausnahmen: `!'()*` werden kodiert, `~` bleibt. */
export function awsUriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Baut die Header fuer eine eigene signierte Anfrage: fuer Tests und fuer den
 * Fall, dass ein Aufrufer QKERN aus Node heraus anspricht. Der Endpunkt selbst
 * ruft das nie; er prueft nur.
 */
export function signSigV4Request(input: {
  method: string;
  url: URL;
  headers?: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secret: string;
  region: string;
  now: Date;
}): Record<string, string> {
  const amzDate = input.now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(input.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value])),
    host: input.url.host,
    "x-amz-content-sha256": input.payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaders = Object.keys(headers).sort();
  const canonicalRequest = [
    input.method.toUpperCase(),
    input.url.pathname || "/",
    canonicalQuery(input.url.search),
    signedHeaders.map((name) => `${name}:${headers[name].trim().replace(/\s+/g, " ")}\n`).join(""),
    signedHeaders.join(";"),
    input.payloadHash,
  ].join("\n");
  const scope = `${date}/${input.region}/s3/aws4_request`;
  const stringToSign = [SIGV4_ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(input.secret, date, input.region))
    .update(stringToSign, "utf8").digest("hex");
  return {
    ...headers,
    authorization: `${SIGV4_ALGORITHM} Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(";")}, Signature=${signature}`,
  };
}

// --- aws-chunked (2.99) ------------------------------------------------------

export type AwsChunkedDecoded = {
  payload: Buffer;
  /** Die Trailer-Header, klein geschrieben, so wie sie nach dem letzten Block standen. */
  trailers: Record<string, string>;
};

/**
 * Nimmt einen `aws-chunked`-Koerper auseinander und prueft ihn (2.99).
 *
 * Die Form: `<hex-laenge>[;chunk-signature=<sig>]\r\n<bytes>\r\n`, bis ein
 * Block der Laenge 0 kommt, danach bei den Trailer-Formen `name:wert\r\n`
 * je Trailer und bei signiertem Trailer als letztes
 * `x-amz-trailer-signature:<sig>`. Jede Blocksignatur haengt an der
 * vorigen; die erste an der Signatur des Kopfs (`seedSignature`). Ein Block,
 * dessen Signatur nicht zu seinen Bytes passt, faellt hier, und mit ihm der
 * ganze Koerper: Es gibt keinen Teilerfolg.
 *
 * Fuer `STREAMING-UNSIGNED-PAYLOAD-TRAILER` gibt es keine Blocksignaturen;
 * die Bindung an das Paar ist dann die Kopfsignatur, und die Bindung an die
 * Bytes die Pruefsumme im Trailer, die `verifyChecksums` nachrechnet.
 */
export function decodeAwsChunkedBody(input: {
  body: Buffer;
  declared: string;
  seedSignature: string;
  amzDate: string;
  scope: { date: string; region: string };
  secret: string;
}): AwsChunkedDecoded {
  if (!isStreamingPayload(input.declared)) throw new SigV4Error("UNSUPPORTED_PAYLOAD_SIGNING");
  const signed = input.declared !== STREAMING_UNSIGNED_PAYLOAD_TRAILER;
  const withTrailer = input.declared !== STREAMING_SIGNED_PAYLOAD;
  const key = signed ? signingKey(input.secret, input.scope.date, input.scope.region) : null;
  const scope = `${input.scope.date}/${input.scope.region}/s3/aws4_request`;
  const body = input.body;
  const parts: Buffer[] = [];
  let previous = input.seedSignature;
  let offset = 0;
  for (;;) {
    const lineEnd = body.indexOf("\r\n", offset, "latin1");
    if (lineEnd < 0) throw new SigV4Error("CHUNK_MALFORMED");
    const header = body.toString("latin1", offset, lineEnd);
    const [sizeHex, ...extensions] = header.split(";");
    if (!/^[0-9a-fA-F]{1,8}$/.test(sizeHex)) throw new SigV4Error("CHUNK_MALFORMED");
    const size = Number.parseInt(sizeHex, 16);
    const dataStart = lineEnd + 2;
    const dataEnd = dataStart + size;
    if (dataEnd > body.byteLength) throw new SigV4Error("CHUNK_MALFORMED");
    const data = body.subarray(dataStart, dataEnd);
    if (key) {
      const extension = extensions.find((entry) => entry.startsWith("chunk-signature="));
      const signature = extension?.slice("chunk-signature=".length) ?? "";
      if (!SIGNATURE.test(signature)) throw new SigV4Error("CHUNK_MALFORMED");
      const stringToSign = [`${SIGV4_ALGORITHM}-PAYLOAD`, input.amzDate, scope, previous, EMPTY_SHA256, sha256Hex(data)].join("\n");
      if (!signatureMatches(key, stringToSign, signature)) throw new SigV4Error("CHUNK_SIGNATURE_DOES_NOT_MATCH");
      previous = signature;
    } else if (extensions.length > 0) {
      throw new SigV4Error("CHUNK_MALFORMED");
    }
    if (size === 0) { offset = dataEnd; break; }
    parts.push(data);
    if (body.toString("latin1", dataEnd, dataEnd + 2) !== "\r\n") throw new SigV4Error("CHUNK_MALFORMED");
    offset = dataEnd + 2;
  }
  const trailers: Record<string, string> = {};
  if (withTrailer) {
    const rest = body.toString("latin1", offset);
    const lines = rest.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
    let trailerSignature: string | null = null;
    const canonical: string[] = [];
    for (const line of lines) {
      const separator = line.indexOf(":");
      if (separator < 1) throw new SigV4Error("CHUNK_MALFORMED");
      const name = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      if (name === "x-amz-trailer-signature") { trailerSignature = value; continue; }
      if (!/^[a-z0-9-]+$/.test(name)) throw new SigV4Error("CHUNK_MALFORMED");
      trailers[name] = value;
      canonical.push(`${name}:${value}\n`);
    }
    if (key) {
      if (trailerSignature === null || !SIGNATURE.test(trailerSignature)) throw new SigV4Error("CHUNK_MALFORMED");
      const stringToSign = [`${SIGV4_ALGORITHM}-TRAILER`, input.amzDate, scope, previous, sha256Hex(canonical.join(""))].join("\n");
      if (!signatureMatches(key, stringToSign, trailerSignature)) throw new SigV4Error("CHUNK_SIGNATURE_DOES_NOT_MATCH");
    } else if (trailerSignature !== null) {
      throw new SigV4Error("CHUNK_MALFORMED");
    }
  } else if (offset < body.byteLength && body.toString("latin1", offset).trim().length > 0) {
    throw new SigV4Error("CHUNK_MALFORMED");
  }
  return { payload: Buffer.concat(parts), trailers };
}

function signatureMatches(key: Buffer, stringToSign: string, signature: string): boolean {
  const expected = createHmac("sha256", key).update(stringToSign, "utf8").digest();
  const provided = Buffer.from(signature, "hex");
  return provided.byteLength === expected.byteLength && timingSafeEqual(provided, expected);
}

/**
 * Rechnet jede mitgeschickte Pruefsumme nach, gleich ob sie als Header oder
 * als Trailer kam: CRC32, CRC32C, CRC64NVME, SHA-1, SHA-256, jeweils Base64,
 * so wie S3 sie definiert. Eine Summe, die nicht passt, macht die Anfrage
 * ungueltig; eine, die keiner mitschickt, wird nicht vermisst.
 */
export function verifyChecksums(declared: Record<string, string | null | undefined>, bytes: Uint8Array): void {
  for (const name of CHECKSUM_HEADERS) {
    const value = declared[name];
    if (value === null || value === undefined || value === "") continue;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new SigV4Error("CHECKSUM_MALFORMED");
    const provided = Buffer.from(value, "base64");
    const expected = computeChecksum(name, bytes);
    if (provided.byteLength !== expected.byteLength || !timingSafeEqual(provided, expected)) {
      throw new SigV4Error("CHECKSUM_MISMATCH");
    }
  }
}

function computeChecksum(name: (typeof CHECKSUM_HEADERS)[number], bytes: Uint8Array): Buffer {
  switch (name) {
    case "x-amz-checksum-sha256": return createHash("sha256").update(bytes).digest();
    case "x-amz-checksum-sha1": return createHash("sha1").update(bytes).digest();
    case "x-amz-checksum-crc32": { const out = Buffer.alloc(4); out.writeUInt32BE(crc32(bytes) >>> 0); return out; }
    case "x-amz-checksum-crc32c": { const out = Buffer.alloc(4); out.writeUInt32BE(crc32c(bytes)); return out; }
    case "x-amz-checksum-crc64nvme": return crc64nvme(bytes);
  }
}

const CRC32C_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0x82f63b78 : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

/** CRC-32C (Castagnoli), reflektiert, wie S3 sie in `x-amz-checksum-crc32c` erwartet. */
export function crc32c(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) crc = CRC32C_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * CRC-64/NVME, reflektiert, Polynom 0xAD93D23594C93659, wie S3 sie in
 * `x-amz-checksum-crc64nvme` erwartet. Gerechnet in zwei 32-Bit-Haelften,
 * weil BigInt je Byte fuer einen Koerper von 64 MiB zu langsam waere.
 */
const CRC64NVME_TABLE = (() => {
  const hi = new Uint32Array(256);
  const lo = new Uint32Array(256);
  // Das Polynom in gespiegelter Form (0x9A6C9329AC4BC9B5), weil die Schleife von rechts rechnet.
  const polyHi = 0x9a6c9329;
  const polyLo = 0xac4bc9b5;
  for (let index = 0; index < 256; index += 1) {
    let h = 0;
    let l = index;
    for (let bit = 0; bit < 8; bit += 1) {
      const carry = l & 1;
      l = ((l >>> 1) | ((h & 1) << 31)) >>> 0;
      h = h >>> 1;
      if (carry) { h = (h ^ polyHi) >>> 0; l = (l ^ polyLo) >>> 0; }
    }
    hi[index] = h;
    lo[index] = l;
  }
  return { hi, lo };
})();

export function crc64nvme(bytes: Uint8Array): Buffer {
  let h = 0xffffffff;
  let l = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    const slot = (l ^ bytes[index]) & 0xff;
    l = (((l >>> 8) | ((h & 0xff) << 24)) ^ CRC64NVME_TABLE.lo[slot]) >>> 0;
    h = ((h >>> 8) ^ CRC64NVME_TABLE.hi[slot]) >>> 0;
  }
  const out = Buffer.alloc(8);
  out.writeUInt32BE((h ^ 0xffffffff) >>> 0, 0);
  out.writeUInt32BE((l ^ 0xffffffff) >>> 0, 4);
  return out;
}

// --- Signierer fuer Tests und Node-Aufrufer -----------------------------------

/**
 * Baut eine Presigned URL, das Gegenstueck zu `parseSigV4Query`. Der Endpunkt
 * ruft das nie; ein Test oder ein Aufrufer aus Node heraus schon.
 */
export function presignSigV4Url(input: {
  method: string;
  url: URL;
  accessKeyId: string;
  secret: string;
  region: string;
  now: Date;
  expiresSeconds: number;
  /** Zusaetzlich signierte Header ausser `host`; der Empfaenger muss sie genau so schicken. */
  headers?: Record<string, string>;
}): URL {
  const amzDate = input.now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${input.region}/s3/aws4_request`;
  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(input.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value])),
    host: input.url.host,
  };
  const signedHeaders = Object.keys(headers).sort();
  const url = new URL(input.url.toString());
  url.searchParams.set("X-Amz-Algorithm", SIGV4_ALGORITHM);
  url.searchParams.set("X-Amz-Credential", `${input.accessKeyId}/${scope}`);
  url.searchParams.set("X-Amz-Date", amzDate);
  url.searchParams.set("X-Amz-Expires", String(input.expiresSeconds));
  url.searchParams.set("X-Amz-SignedHeaders", signedHeaders.join(";"));
  const canonicalRequest = [
    input.method.toUpperCase(),
    url.pathname || "/",
    canonicalQuery(url.search),
    signedHeaders.map((name) => `${name}:${headers[name].trim().replace(/\s+/g, " ")}\n`).join(""),
    signedHeaders.join(";"),
    UNSIGNED_PAYLOAD,
  ].join("\n");
  const stringToSign = [SIGV4_ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  url.searchParams.set("X-Amz-Signature", createHmac("sha256", signingKey(input.secret, date, input.region))
    .update(stringToSign, "utf8").digest("hex"));
  return url;
}

/**
 * Kodiert einen Koerper als `aws-chunked`, das Gegenstueck zu
 * `decodeAwsChunkedBody`: fuer Tests und fuer den Fall, dass ein Aufrufer aus
 * Node heraus so schickt, wie es die AWS-Werkzeuge ueber HTTP tun.
 */
export function encodeAwsChunkedBody(input: {
  payload: Uint8Array;
  declared: string;
  seedSignature: string;
  amzDate: string;
  scope: { date: string; region: string };
  secret: string;
  chunkBytes?: number;
  trailers?: Record<string, string>;
}): Buffer {
  const signed = input.declared !== STREAMING_UNSIGNED_PAYLOAD_TRAILER;
  const withTrailer = input.declared !== STREAMING_SIGNED_PAYLOAD;
  const key = signingKey(input.secret, input.scope.date, input.scope.region);
  const scope = `${input.scope.date}/${input.scope.region}/s3/aws4_request`;
  const chunkBytes = input.chunkBytes ?? 64 * 1024;
  const out: Buffer[] = [];
  let previous = input.seedSignature;
  const sign = (kind: "PAYLOAD" | "TRAILER", hash: string) => {
    const stringToSign = [`${SIGV4_ALGORITHM}-${kind}`, input.amzDate, scope, previous, ...(kind === "PAYLOAD" ? [EMPTY_SHA256] : []), hash].join("\n");
    previous = createHmac("sha256", key).update(stringToSign, "utf8").digest("hex");
    return previous;
  };
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < input.payload.byteLength; offset += chunkBytes) {
    chunks.push(input.payload.subarray(offset, Math.min(offset + chunkBytes, input.payload.byteLength)));
  }
  chunks.push(new Uint8Array(0));
  for (const chunk of chunks) {
    const header = signed ? `${chunk.byteLength.toString(16)};chunk-signature=${sign("PAYLOAD", sha256Hex(chunk))}` : chunk.byteLength.toString(16);
    out.push(Buffer.from(`${header}\r\n`, "latin1"));
    if (chunk.byteLength > 0) { out.push(Buffer.from(chunk)); out.push(Buffer.from("\r\n", "latin1")); }
  }
  if (withTrailer) {
    const entries = Object.entries(input.trailers ?? {}).map(([name, value]) => [name.toLowerCase(), value] as const);
    const canonical = entries.map(([name, value]) => `${name}:${value}\n`).join("");
    for (const [name, value] of entries) out.push(Buffer.from(`${name}:${value}\r\n`, "latin1"));
    if (signed) out.push(Buffer.from(`x-amz-trailer-signature:${sign("TRAILER", sha256Hex(canonical))}\r\n`, "latin1"));
    out.push(Buffer.from("\r\n", "latin1"));
  }
  return Buffer.concat(out);
}

/** Die Pruefsumme, wie ein Client sie schickt: Base64 der Roh-Bytes. */
export function checksumBase64(name: string, bytes: Uint8Array): string {
  if (!(CHECKSUM_HEADERS as readonly string[]).includes(name)) throw new SigV4Error("CHECKSUM_MALFORMED");
  return computeChecksum(name as (typeof CHECKSUM_HEADERS)[number], bytes).toString("base64");
}
