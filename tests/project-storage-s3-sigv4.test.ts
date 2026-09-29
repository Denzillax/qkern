import { describe, expect, it } from "vitest";
import {
  canonicalQuery,
  checksumBase64,
  crc32c,
  crc64nvme,
  declaredPayloadHash,
  decodeAwsChunkedBody,
  encodeAwsChunkedBody,
  parseSigV4Authorization,
  parseSigV4Query,
  presignSigV4Url,
  sha256Hex,
  SigV4Error,
  sigV4PresignedTime,
  sigV4RequestTime,
  signSigV4Request,
  STREAMING_SIGNED_PAYLOAD,
  STREAMING_SIGNED_PAYLOAD_TRAILER,
  STREAMING_UNSIGNED_PAYLOAD_TRAILER,
  verifyChecksums,
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

  it("takes a hex hash, UNSIGNED-PAYLOAD or one of the three STREAMING forms, and refuses anything else with its own code", () => {
    expect(() => declaredPayloadHash(new Headers())).toThrowError(/MISSING_CONTENT_SHA256/);
    expect(declaredPayloadHash(new Headers({ "x-amz-content-sha256": "UNSIGNED-PAYLOAD" }))).toBe("UNSIGNED-PAYLOAD");
    expect(declaredPayloadHash(new Headers({ "x-amz-content-sha256": sha256Hex("") }))).toBe(sha256Hex(""));
    for (const form of [STREAMING_SIGNED_PAYLOAD, STREAMING_SIGNED_PAYLOAD_TRAILER, STREAMING_UNSIGNED_PAYLOAD_TRAILER]) {
      expect(declaredPayloadHash(new Headers({ "x-amz-content-sha256": form }))).toBe(form);
    }
    expect(() => declaredPayloadHash(new Headers({ "x-amz-content-sha256": "STREAMING-AWS4-ECDSA-P256-SHA256-PAYLOAD" })))
      .toThrowError(/UNSUPPORTED_PAYLOAD_SIGNING/);
    const unsigned = signed({ payloadHash: "UNSIGNED-PAYLOAD" });
    expect(() => verify(unsigned)).not.toThrow();
  });

  it("decodes the three aws-chunked forms and refuses a chunk, a trailer or a checksum that was tampered with", () => {
    const payload = Buffer.alloc(200_000, 7);
    const seed = signSigV4Request({ method: "PUT", url: new URL("http://qkern.test/s3/b/k"), payloadHash: STREAMING_SIGNED_PAYLOAD, accessKeyId, secret, region: "eu-central-1", now });
    const seedSignature = /Signature=([0-9a-f]{64})/.exec(seed.authorization)![1];
    const scope = { date: "20260929", region: "eu-central-1" };
    const amzDate = seed["x-amz-date"];
    for (const declared of [STREAMING_SIGNED_PAYLOAD, STREAMING_SIGNED_PAYLOAD_TRAILER, STREAMING_UNSIGNED_PAYLOAD_TRAILER]) {
      const trailers = declared === STREAMING_SIGNED_PAYLOAD ? undefined : { "x-amz-checksum-crc32c": checksumBase64("x-amz-checksum-crc32c", payload) };
      const body = encodeAwsChunkedBody({ payload, declared, seedSignature, amzDate, scope, secret, chunkBytes: 65_536, trailers });
      const decoded = decodeAwsChunkedBody({ body, declared, seedSignature, amzDate, scope, secret });
      expect(decoded.payload.equals(payload), declared).toBe(true);
      expect(decoded.trailers, declared).toEqual(trailers ?? {});
      expect(() => verifyChecksums(decoded.trailers, decoded.payload)).not.toThrow();
      if (trailers) {
        expect(() => verifyChecksums(decoded.trailers, Buffer.concat([decoded.payload, Buffer.from("x")]))).toThrowError(/CHECKSUM_MISMATCH/);
      }

      // Ein Byte in der Mitte eines Blocks: die Blocksignatur passt nicht mehr.
      const tampered = Buffer.from(body);
      const dataOffset = body.indexOf("\r\n") + 2 + 100;
      tampered[dataOffset] ^= 0xff;
      if (declared === STREAMING_UNSIGNED_PAYLOAD_TRAILER) {
        // Ohne Blocksignaturen faellt es an der Pruefsumme, nicht am Block.
        const unsignedDecoded = decodeAwsChunkedBody({ body: tampered, declared, seedSignature, amzDate, scope, secret });
        expect(() => verifyChecksums(unsignedDecoded.trailers, unsignedDecoded.payload)).toThrowError(/CHECKSUM_MISMATCH/);
      } else {
        expect(() => decodeAwsChunkedBody({ body: tampered, declared, seedSignature, amzDate, scope, secret }), declared)
          .toThrowError(/CHUNK_SIGNATURE_DOES_NOT_MATCH/);
        // Und ein anderes Geheimnis, also eine andere Kette, faellt am ersten Block.
        expect(() => decodeAwsChunkedBody({ body, declared, seedSignature, amzDate, scope, secret: "z".repeat(43) }))
          .toThrowError(/CHUNK_SIGNATURE_DOES_NOT_MATCH/);
      }
      if (declared === STREAMING_SIGNED_PAYLOAD_TRAILER) {
        // Ein Trailer mit anderer Summe: die Signatur des Trailers deckt ihn, also faellt sie.
        const swapped = Buffer.from(body.toString("latin1").replace(/x-amz-checksum-crc32c:[^\r]+/, "x-amz-checksum-crc32c:AAAAAA=="), "latin1");
        expect(() => decodeAwsChunkedBody({ body: swapped, declared, seedSignature, amzDate, scope, secret }))
          .toThrowError(/CHUNK_SIGNATURE_DOES_NOT_MATCH/);
      }
    }
    // Abgeschnitten, also ohne Endblock: kein Teilerfolg.
    const whole = encodeAwsChunkedBody({ payload, declared: STREAMING_SIGNED_PAYLOAD, seedSignature, amzDate, scope, secret });
    expect(() => decodeAwsChunkedBody({ body: whole.subarray(0, whole.byteLength - 40), declared: STREAMING_SIGNED_PAYLOAD, seedSignature, amzDate, scope, secret }))
      .toThrowError(/CHUNK_MALFORMED/);
  });

  it("computes the five S3 checksums the way S3 defines them", () => {
    const check = Buffer.from("123456789", "ascii");
    expect(crc32c(check).toString(16)).toBe("e3069283");
    expect(crc64nvme(check).toString("hex")).toBe("ae8b14860a799888");
    expect(checksumBase64("x-amz-checksum-crc32", check)).toBe(Buffer.from("cbf43926", "hex").toString("base64"));
    expect(checksumBase64("x-amz-checksum-sha1", check)).toBe(Buffer.from("f7c3bc1d808e04732adf679965ccc34ca7ae3441", "hex").toString("base64"));
    expect(checksumBase64("x-amz-checksum-sha256", check)).toBe(Buffer.from("15e2b0d3c33891ebb0f1ef609ec419420c20e320ce94c65fbc8c3312448eb225", "hex").toString("base64"));
    expect(() => verifyChecksums({ "x-amz-checksum-crc32": "nicht base64!" }, check)).toThrowError(/CHECKSUM_MALFORMED/);
    expect(() => verifyChecksums({ "x-amz-checksum-crc64nvme": crc64nvme(Buffer.from("12345678")).toString("base64") }, check)).toThrowError(/CHECKSUM_MISMATCH/);
    expect(() => verifyChecksums({}, check)).not.toThrow();
  });

  it("verifies a presigned URL, binds it to method, path and query, and caps its lifetime at 15 minutes", () => {
    const url = presignSigV4Url({ method: "GET", url: new URL("http://qkern.test/s3/photos/2026/summer%20day.jpg?response-content-type=image%2Fjpeg"), accessKeyId, secret, region: "eu-central-1", now, expiresSeconds: 300 });
    const authorization = parseSigV4Query(url);
    expect(authorization).toMatchObject({ accessKeyId, date: "20260929", region: "eu-central-1", expiresSeconds: 300, signedHeaders: ["host"] });
    const check = (options: { method?: string; url?: URL; at?: Date; secret?: string } = {}) => {
      const target = options.url ?? url;
      const parsed = parseSigV4Query(target);
      const time = sigV4PresignedTime(parsed, options.at ?? now);
      verifySigV4Signature({
        request: { method: options.method ?? "GET", url: target, headers: new Headers({ host: "qkern.test" }) },
        authorization: parsed, amzDate: time.amzDate, payloadHash: "UNSIGNED-PAYLOAD", secret: options.secret ?? secret, presigned: true,
      });
    };
    expect(() => check()).not.toThrow();
    expect(() => check({ at: new Date(now.getTime() + 299_000) })).not.toThrow();
    expect(() => check({ at: new Date(now.getTime() + 301_000) })).toThrowError(/PRESIGNED_EXPIRED/);
    expect(() => check({ at: new Date(now.getTime() - 16 * 60_000) })).toThrowError(/REQUEST_TIME_TOO_SKEWED/);
    expect(() => check({ method: "PUT" })).toThrowError(/SIGNATURE_DOES_NOT_MATCH/);
    expect(() => check({ secret: "q".repeat(43) })).toThrowError(/SIGNATURE_DOES_NOT_MATCH/);
    const moved = new URL(url.toString());
    moved.pathname = "/s3/photos/2026/other.jpg";
    expect(() => check({ url: moved })).toThrowError(/SIGNATURE_DOES_NOT_MATCH/);
    const longer = new URL(url.toString());
    longer.searchParams.set("X-Amz-Expires", "3600");
    expect(() => parseSigV4Query(longer)).toThrowError(/PRESIGNED_EXPIRES_INVALID/);
    const tooLong = presignSigV4Url({ method: "GET", url: new URL("http://qkern.test/s3/photos/x.jpg"), accessKeyId, secret, region: "eu-central-1", now, expiresSeconds: 901 });
    expect(() => parseSigV4Query(tooLong)).toThrowError(/PRESIGNED_EXPIRES_INVALID/);
    const extraQuery = new URL(url.toString());
    extraQuery.searchParams.set("response-content-type", "text/html");
    expect(() => check({ url: extraQuery })).toThrowError(/SIGNATURE_DOES_NOT_MATCH/);
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
