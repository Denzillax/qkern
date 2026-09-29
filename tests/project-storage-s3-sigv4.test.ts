import { describe, expect, it } from "vitest";
import {
  canonicalQuery,
  declaredPayloadHash,
  parseSigV4Authorization,
  sha256Hex,
  SigV4Error,
  sigV4RequestTime,
  signSigV4Request,
  verifySigV4Signature,
} from "@/lib/server/project-storage/s3-sigv4";

/**
 * SigV4 (2.96) ohne Netz: Der Signierer des Moduls und sein Pruefer muessen
 * zueinander passen, und der Pruefer muss bei jeder Abweichung fallen, die ein
 * Angreifer einbringen koennte: anderes Geheimnis, anderer Pfad, andere
 * Query, anderer Payload-Hash, andere Zeit.
 */
const now = new Date("2026-09-29T10:00:00.000Z");
const secret = "k".repeat(43);
const accessKeyId = "QKERNS3ABCDEFGHIJKLMNOPQ";

function signed(overrides: Partial<Parameters<typeof signSigV4Request>[0]> = {}) {
  const url = overrides.url ?? new URL("http://qkern.test/s3/photos/2026/summer%20day.jpg?list-type=2&prefix=a%2Fb&encoding-type=url");
  const payloadHash = overrides.payloadHash ?? sha256Hex("");
  const headers = signSigV4Request({
    method: "GET", url, payloadHash, accessKeyId, secret, region: "eu-central-1", now, ...overrides,
  });
  return { url, headers: new Headers(headers), payloadHash };
}

function verify(input: ReturnType<typeof signed>, options: { secret?: string; method?: string; url?: URL; now?: Date } = {}) {
  const authorization = parseSigV4Authorization(input.headers);
  const time = sigV4RequestTime(input.headers, authorization, options.now ?? now);
  verifySigV4Signature({
    request: { method: options.method ?? "GET", url: options.url ?? input.url, headers: input.headers },
    authorization,
    amzDate: time.amzDate,
    payloadHash: declaredPayloadHash(input.headers),
    secret: options.secret ?? secret,
  });
}

describe("S3 SigV4 verification", () => {
  it("accepts a request signed with the same secret and rejects any other secret", () => {
    const request = signed();
    expect(() => verify(request)).not.toThrow();
    expect(() => verify(request, { secret: "x".repeat(43) })).toThrowError(/SIGNATURE_DOES_NOT_MATCH/);
  });

  it("binds the signature to method, path, query and payload hash", () => {
    const request = signed();
    expect(() => verify(request, { method: "PUT" })).toThrowError(/SIGNATURE_DOES_NOT_MATCH/);
    expect(() => verify(request, { url: new URL("http://qkern.test/s3/photos/2026/other.jpg?list-type=2&prefix=a%2Fb&encoding-type=url") }))
      .toThrowError(/SIGNATURE_DOES_NOT_MATCH/);
    expect(() => verify(request, { url: new URL("http://qkern.test/s3/photos/2026/summer%20day.jpg?list-type=2&prefix=a%2Fc&encoding-type=url") }))
      .toThrowError(/SIGNATURE_DOES_NOT_MATCH/);
    const tampered = signed();
    tampered.headers.set("x-amz-content-sha256", sha256Hex("andere bytes"));
    expect(() => verify(tampered)).toThrowError(/SIGNATURE_DOES_NOT_MATCH/);
  });

  it("rejects a request whose clock is more than fifteen minutes off, and one whose scope date lies", () => {
    const request = signed();
    expect(() => verify(request, { now: new Date(now.getTime() + 16 * 60_000) })).toThrowError(/REQUEST_TIME_TOO_SKEWED/);
    expect(() => verify(request, { now: new Date(now.getTime() + 14 * 60_000) })).not.toThrow();
    const lying = signed();
    lying.headers.set("x-amz-date", "20260928T100000Z");
    expect(() => verify(lying)).toThrowError(/SCOPE_DATE_MISMATCH/);
  });

  it("reads the header strictly: service s3, signed host, a hex signature", () => {
    expect(() => parseSigV4Authorization(new Headers())).toThrowError(/MISSING_AUTHORIZATION/);
    expect(() => parseSigV4Authorization(new Headers({ authorization: "AWS AKID:sig" }))).toThrowError(/MALFORMED_AUTHORIZATION/);
    const request = signed();
    const header = request.headers.get("authorization")!;
    expect(() => parseSigV4Authorization(new Headers({
      authorization: header.replace("/s3/aws4_request", "/sqs/aws4_request"),
    }))).toThrowError(/UNSUPPORTED_SERVICE/);
    expect(() => parseSigV4Authorization(new Headers({
      authorization: header.replace("SignedHeaders=host;", "SignedHeaders="),
    }))).toThrowError(/MISSING_SIGNED_HEADER/);
    expect(() => parseSigV4Authorization(new Headers({
      authorization: header.replace(/Signature=[0-9a-f]{64}/, "Signature=nope"),
    }))).toThrowError(/MALFORMED_AUTHORIZATION/);
    const parsed = parseSigV4Authorization(request.headers);
    expect(parsed).toMatchObject({ accessKeyId, date: "20260929", region: "eu-central-1", service: "s3" });
    expect(parsed.signedHeaders).toEqual(["host", "x-amz-content-sha256", "x-amz-date"]);
  });

  it("takes a hex hash or UNSIGNED-PAYLOAD and refuses chunked signing with its own code", () => {
    expect(() => declaredPayloadHash(new Headers())).toThrowError(/MISSING_CONTENT_SHA256/);
    expect(declaredPayloadHash(new Headers({ "x-amz-content-sha256": "UNSIGNED-PAYLOAD" }))).toBe("UNSIGNED-PAYLOAD");
    expect(declaredPayloadHash(new Headers({ "x-amz-content-sha256": sha256Hex("") }))).toBe(sha256Hex(""));
    expect(() => declaredPayloadHash(new Headers({ "x-amz-content-sha256": "STREAMING-AWS4-HMAC-SHA256-PAYLOAD" })))
      .toThrowError(/UNSUPPORTED_PAYLOAD_SIGNING/);
    const unsigned = signed({ payloadHash: "UNSIGNED-PAYLOAD" });
    expect(() => verify(unsigned)).not.toThrow();
  });

  it("canonicalises the query the way S3 does: sorted, RFC 3986 encoded, one value each", () => {
    expect(canonicalQuery("")).toBe("");
    expect(canonicalQuery("?prefix=a%2Fb&list-type=2&delimiter=/")).toBe("delimiter=%2F&list-type=2&prefix=a%2Fb");
    expect(canonicalQuery("?b=2&a=&a=1&x=~*")).toBe("a=&a=1&b=2&x=~%2A");
    expect(canonicalQuery("?location")).toBe("location=");
  });

  it("falls back to the Date header and never reveals the secret in an error", () => {
    const request = signed();
    const amzDate = request.headers.get("x-amz-date")!;
    request.headers.delete("x-amz-date");
    expect(() => sigV4RequestTime(request.headers, parseSigV4Authorization(request.headers), now)).toThrowError(/MISSING_DATE/);
    request.headers.set("date", new Date(now).toUTCString());
    const time = sigV4RequestTime(request.headers, parseSigV4Authorization(request.headers), now);
    expect(time.amzDate).toBe(amzDate);
    try {
      verify(signed(), { secret: "y".repeat(43) });
    } catch (error) {
      expect(error).toBeInstanceOf(SigV4Error);
      expect(JSON.stringify({ message: (error as Error).message, ...(error as object) })).not.toContain(secret);
    }
  });
});
