import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { recognisedByName } from "@/lib/server/errors/identity";

/**
 * AWS Signature Version 4 fuer den S3-Endpunkt von QKERN (2.96).
 *
 * Nachgerechnet wird genau das, was ein S3-Client in den Header
 * `Authorization` schreibt: `AWS4-HMAC-SHA256 Credential=…, SignedHeaders=…,
 * Signature=…`. Presigned URLs (Signatur in der Query) nimmt dieses Modul
 * nicht an; der Endpunkt sagt das mit 501 statt sie halb zu pruefen.
 *
 * Das Modul kennt weder Datenbank noch Dienst. Es bekommt die Anfrage, das
 * Geheimnis und die Uhr, und es antwortet mit einem Grund oder mit nichts.
 * Das Geheimnis erscheint in keinem Rueckgabewert und in keinem Fehler.
 */

export const SIGV4_ALGORITHM = "AWS4-HMAC-SHA256";
export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
/** 15 Minuten, wie bei S3 selbst. */
export const SIGV4_MAX_SKEW_MS = 15 * 60 * 1_000;

const AUTHORIZATION = /^AWS4-HMAC-SHA256\s+(.+)$/s;
const ACCESS_KEY_ID = /^[A-Za-z0-9]{16,128}$/;
const AMZ_DATE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const SIGNATURE = /^[0-9a-f]{64}$/;
const REGION = /^[a-z0-9-]{1,64}$/;

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
  | "SIGNATURE_DOES_NOT_MATCH";

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
 * `STREAMING-*` (aws-chunked) ist nicht gebaut und wird gesagt, nicht geraten.
 */
export function declaredPayloadHash(headers: Headers): string {
  const value = headers.get("x-amz-content-sha256")?.trim();
  if (!value) throw new SigV4Error("MISSING_CONTENT_SHA256");
  if (value === UNSIGNED_PAYLOAD) return value;
  if (HEX_SHA256.test(value)) return value;
  throw new SigV4Error("UNSUPPORTED_PAYLOAD_SIGNING");
}

/**
 * Rechnet die Signatur nach und vergleicht in konstanter Zeit. Der Aufrufer
 * hat die Zeit schon geprueft; hier wird nur noch gerechnet.
 */
export function verifySigV4Signature(input: {
  request: SigV4Request;
  authorization: SigV4Authorization;
  amzDate: string;
  payloadHash: string;
  secret: string;
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
    canonicalQuery(request.url.search),
    canonicalHeaders,
    authorization.signedHeaders.join(";"),
    input.payloadHash,
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
export function canonicalQuery(search: string): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (!raw) return "";
  const pairs: Array<[string, string]> = [];
  for (const entry of raw.split("&")) {
    if (!entry) continue;
    const separator = entry.indexOf("=");
    const name = separator < 0 ? entry : entry.slice(0, separator);
    const value = separator < 0 ? "" : entry.slice(separator + 1);
    pairs.push([awsUriEncode(decodeQueryComponent(name)), awsUriEncode(decodeQueryComponent(value))]);
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
