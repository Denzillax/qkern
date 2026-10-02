import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ProjectStoragePrincipal, ProjectStorageScope } from "@/lib/server/project-storage/model";
import {
  MemoryProjectStorageProvider,
  type ProjectStorageScanner,
} from "@/lib/server/project-storage/provider";
import { MemoryProjectStorageRepository } from "@/lib/server/project-storage/repository";
import {
  MemoryProjectStorageS3AccessKeyStore,
  ProjectStorageS3AccessKeyService,
} from "@/lib/server/project-storage/s3-access-keys";
import { ProjectStorageS3Endpoint } from "@/lib/server/project-storage/s3-endpoint";
import { ProjectStorageS3SecretProtector } from "@/lib/server/project-storage/s3-secret-protector";
import {
  checksumBase64,
  encodeAwsChunkedBody,
  presignSigV4Url,
  sha256Hex,
  signSigV4Request,
  STREAMING_SIGNED_PAYLOAD,
  STREAMING_SIGNED_PAYLOAD_TRAILER,
  STREAMING_UNSIGNED_PAYLOAD_TRAILER,
} from "@/lib/server/project-storage/s3-sigv4";
import { ProjectStorageService } from "@/lib/server/project-storage/service";

/**
 * Der S3-Endpunkt (2.96) ohne Netz: Memory-Repository, Memory-Provider, ein
 * Scanner, der sauber sagt, und ein `fetch`, das die signierten Zusagen des
 * Memory-Providers einloest, so wie ein echter Provider es taete. Was hier
 * geprueft wird, ist die Uebersetzung: S3-Anfrage rein, Dienstaufruf raus,
 * S3-Antwort zurueck, und jede Grenze des Dienstes als S3-Fehler.
 */
const scope: ProjectStorageScope = {
  organizationId: "00000000-0000-4000-8000-000000000301",
  projectId: "00000000-0000-4000-8000-000000000302",
  environment: "development",
};
const admin: ProjectStoragePrincipal = {
  organizationId: scope.organizationId, actorRef: "admin@qkern.test", role: "admin",
  subject: "00000000-0000-4000-8000-000000000303",
};
const foreignScope: ProjectStorageScope = { ...scope, projectId: "00000000-0000-4000-8000-000000000402" };
const now = new Date("2026-09-29T12:00:00.000Z");
const ORIGIN = "http://qkern.test";

async function harness() {
  const repository = new MemoryProjectStorageRepository();
  const provider = new MemoryProjectStorageProvider("https://objects.qkern.test", () => now);
  const bytesAtProvider = new Map<string, Buffer>();
  // Das Urteil laesst sich je Fall umstellen: `pending` legt ein Objekt in Quarantaene.
  const verdict = { value: "clean" as "clean" | "pending" | "infected" };
  // Was der Scanner zu sehen bekam, bleibt stehen: daran haengt, ob die
  // Pruefsumme der **ganzen** Datei bei ihm ankommt.
  const scans: Array<{ providerKey: string; contentType: string; sizeBytes: number; checksumSha256: string }> = [];
  const scanner: ProjectStorageScanner = {
    async scan(input) { scans.push({ ...input }); return verdict.value; },
  };
  const storage = new ProjectStorageService({ repository, provider, scanner, now: () => now });
  const protector = new ProjectStorageS3SecretProtector(randomBytes(32));
  const keys = new ProjectStorageS3AccessKeyService({
    store: new MemoryProjectStorageS3AccessKeyStore(), buckets: repository, protector, now: () => now,
  });
  const admitted: ProjectStorageScope[] = [];
  // Der Provider-Ersatz: loest die POST-Zusage ein und liefert GET-Zusagen aus.
  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (init?.method === "PUT") {
      // Die Zusage fuer ein Teil: Der Provider prueft die Pruefsumme im
      // signierten Kopf, also prueft der Ersatz sie auch, und antwortet mit
      // genau der Kennung, die der Memory-Provider fuer dieses Teil vergeben
      // hat.
      const providerKey = decodeURIComponent(url.pathname.slice(1));
      const partNumber = Number(url.searchParams.get("partNumber"));
      const uploadId = url.searchParams.get("uploadId") ?? "";
      const body = Buffer.from(init.body as Uint8Array);
      const declared = new Headers(init.headers).get("x-amz-checksum-sha256") ?? "";
      if (declared !== createHash("sha256").update(body).digest("base64")) {
        return new Response("denied", { status: 403 });
      }
      const parts = partsAtProvider.get(`${providerKey}\n${uploadId}`) ?? new Map<number, Buffer>();
      parts.set(partNumber, body);
      partsAtProvider.set(`${providerKey}\n${uploadId}`, parts);
      return new Response(null, { status: 200, headers: { etag: `"memory-${partNumber}-${declared.slice(0, 8)}"` } });
    }
    if (init?.method === "POST") {
      const form = init.body as FormData;
      const fields = Object.fromEntries([...form.entries()].filter(([name]) => name !== "file")) as Record<string, string>;
      const file = form.get("file") as Blob;
      const body = Buffer.from(await file.arrayBuffer());
      if (!provider.validateGrant("POST", fields.key, Number(fields["x-qkern-expires"]), fields["x-qkern-signature"]) ||
          String(body.byteLength) !== fields["x-qkern-size"]) {
        return new Response("denied", { status: 403 });
      }
      provider.putForTest(fields.key, {
        sizeBytes: body.byteLength, contentType: fields["Content-Type"],
        checksumSha256: createHash("sha256").update(body).digest("base64"), etag: sha256Hex(body).slice(0, 32),
      });
      bytesAtProvider.set(fields.key, body);
      return new Response(null, { status: 204 });
    }
    const providerKey = decodeURIComponent(url.pathname.slice(1));
    if (!provider.validateGrant("GET", providerKey, Number(url.searchParams.get("expires")), url.searchParams.get("signature") ?? "")) {
      return new Response("denied", { status: 403 });
    }
    const body = bytesAtProvider.get(providerKey);
    if (!body) return new Response(null, { status: 404 });
    // Ein Provider, der Bereiche kann, antwortet mit 206; einer, der sie
    // ignoriert, mit dem ganzen Objekt. Beide gibt es, beide werden gefahren.
    const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get("range") ?? "");
    if (range && providerRange.honours) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      return new Response(new Uint8Array(body.subarray(start, end + 1)), {
        status: 206, headers: { "Content-Range": `bytes ${start}-${end}/${body.byteLength}` },
      });
    }
    return new Response(new Uint8Array(body), { status: 200 });
  };
  const providerRange = { honours: true };
  const partsAtProvider = new Map<string, Map<number, Buffer>>();
  // Der Memory-Provider fuehrt die Teile nur als Nummern; das Zusammensetzen
  // macht in echt versitygw. Hier tut es diese Naht, damit der Endpunkt danach
  // ein Objekt vorfindet, das er durchrechnen kann.
  const contentTypes = new Map<string, string>();
  const startMultipart = provider.createMultipartUpload.bind(provider);
  provider.createMultipartUpload = async (started) => {
    contentTypes.set(started.providerKey, started.contentType);
    return await startMultipart(started);
  };
  const finishMultipart = provider.completeMultipartUpload.bind(provider);
  provider.completeMultipartUpload = async (finished) => {
    await finishMultipart(finished);
    const parts = partsAtProvider.get(`${finished.providerKey}\n${finished.uploadId}`) ?? new Map<number, Buffer>();
    const body = Buffer.concat(finished.parts.map((part) => parts.get(part.partNumber) ?? Buffer.alloc(0)));
    provider.putForTest(finished.providerKey, {
      sizeBytes: body.byteLength,
      contentType: contentTypes.get(finished.providerKey) ?? "text/plain",
      checksumSha256: createHash("sha256").update(body).digest("base64"),
      etag: `${sha256Hex(body).slice(0, 32)}-${finished.parts.length}`,
    });
    bytesAtProvider.set(finished.providerKey, body);
  };
  const endpoint = new ProjectStorageS3Endpoint({
    storage, keys, fetchFn, now: () => now, admit: async (target) => { admitted.push(target); },
    requestId: () => "req-1",
  });
  const open = await storage.createBucket(admin, scope, {
    name: "open", readPolicy: "service", writePolicy: "service", allowedMimeTypes: ["text/plain", "image/*"],
    maxObjectBytes: 1024, quotaBytes: 4096,
  });
  const locked = await storage.createBucket(admin, scope, {
    name: "locked", readPolicy: "private", writePolicy: "private", allowedMimeTypes: ["text/plain"],
  });
  const notMine = await storage.createBucket(admin, scope, {
    name: "not-mine", readPolicy: "service", writePolicy: "service", allowedMimeTypes: ["text/plain"],
  });
  const foreign = await storage.createBucket(
    { ...admin }, foreignScope, { name: "open", readPolicy: "service", writePolicy: "service", allowedMimeTypes: ["text/plain"] });
  const expiresAt = new Date(now.getTime() + 24 * 3600_000).toISOString();
  const issued = await keys.create(admin, scope, { name: "Werkzeug", bucketIds: [open.id, locked.id], expiresAt });
  return { endpoint, storage, keys, provider, repository, issued, open, locked, notMine, foreign, admitted, bytesAtProvider, verdict, providerRange, scans, partsAtProvider };
}

/**
 * Eine PUT-Anfrage als `aws-chunked`, so wie die AWS-Werkzeuge sie ueber
 * HTTP schicken: Kopfsignatur ueber die Wortform, dann die Bloecke, jeder
 * an den vorigen gekettet.
 */
function chunked(issued: Issued, path: string, payload: Buffer, declared: string, options: {
  chunkBytes?: number; trailers?: Record<string, string>; contentType?: string; tamper?: (body: Buffer) => Buffer; withContentLength?: boolean;
} = {}): Request {
  const url = new URL(`${ORIGIN}${path}`);
  const scope = { date: now.toISOString().slice(0, 10).replace(/-/g, ""), region: "us-east-1" };
  const build = (seed: string) => encodeAwsChunkedBody({
    payload, declared, seedSignature: seed, amzDate: now.toISOString().replace(/[:-]|\.\d{3}/g, ""), scope,
    secret: issued.secret, chunkBytes: options.chunkBytes ?? 4096, trailers: options.trailers,
  });
  const encodedLength = build("0".repeat(64)).byteLength;
  const headers = signSigV4Request({
    method: "PUT", url, payloadHash: declared,
    headers: {
      "content-type": options.contentType ?? "text/plain",
      "content-encoding": "aws-chunked",
      "x-amz-decoded-content-length": String(payload.byteLength),
      ...(options.withContentLength === false ? {} : { "content-length": String(encodedLength) }),
      ...(options.trailers ? { "x-amz-trailer": Object.keys(options.trailers).join(",") } : {}),
    },
    accessKeyId: issued.key.accessKeyId, secret: issued.secret, region: "us-east-1", now,
  });
  const seed = /Signature=([0-9a-f]{64})/.exec(headers.authorization)![1];
  let body = build(seed);
  expect(body.byteLength).toBe(encodedLength);
  if (options.tamper) body = options.tamper(body);
  return new Request(url, { method: "PUT", headers, body: new Uint8Array(body) });
}

/** Eine Presigned URL des Paars, mit der Uhr des Harness. */
function presigned(issued: Issued, method: string, path: string, options: { expiresSeconds?: number; at?: Date; secret?: string } = {}): URL {
  return presignSigV4Url({
    method, url: new URL(`${ORIGIN}${path}`), accessKeyId: issued.key.accessKeyId,
    secret: options.secret ?? issued.secret, region: "us-east-1", now: options.at ?? now, expiresSeconds: options.expiresSeconds ?? 300,
  });
}

type Issued = Awaited<ReturnType<typeof harness>>["issued"];

function s3(issued: Issued, method: string, path: string, options: {
  body?: Buffer; headers?: Record<string, string>; secret?: string; accessKeyId?: string; at?: Date; unsigned?: boolean;
} = {}) {
  const url = new URL(`${ORIGIN}${path}`);
  const body = options.body;
  const payloadHash = options.unsigned ? "UNSIGNED-PAYLOAD" : sha256Hex(body ?? "");
  const headers = signSigV4Request({
    method, url, payloadHash,
    headers: { ...(body ? { "content-length": String(body.byteLength) } : {}), ...(options.headers ?? {}) },
    accessKeyId: options.accessKeyId ?? issued.key.accessKeyId,
    secret: options.secret ?? issued.secret,
    region: "us-east-1", now: options.at ?? now,
  });
  return new Request(url, { method, headers, body: body ? new Uint8Array(body) : undefined });
}

/** Der Stand eines Buckets: gebuchte und belegte Bytes, wie der Dienst sie fuehrt. */
async function bucketState(storage: ProjectStorageService, bucketId: string) {
  const buckets = await storage.listBuckets(admin, scope);
  return buckets.find((bucket) => bucket.id === bucketId)!;
}

async function errorCode(response: Response): Promise<string> {
  const text = await response.text();
  return /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? response.headers.get("x-qkern-s3-error") ?? "";
}

describe("Project Storage S3 endpoint", () => {
  it("lists exactly the buckets of the pair that the service role may see", async () => {
    const { endpoint, issued } = await harness();
    const response = await endpoint.handle(s3(issued, "GET", "/s3"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-amz-request-id")).toBe("req-1");
    const body = await response.text();
    expect(body).toContain("<Name>open</Name>");
    // `locked` ist im Bucket-Satz, aber `private`; `not-mine` ist sichtbar,
    // aber nicht im Satz. Beide fehlen.
    expect(body).not.toContain("<Name>locked</Name>");
    expect(body).not.toContain("<Name>not-mine</Name>");
    expect(body).not.toContain(issued.secret);
  });

  it("writes, heads, reads, lists and deletes an object through the same service as the REST routes", async () => {
    const { endpoint, issued, storage, admitted } = await harness();
    const payload = Buffer.from("hallo s3", "utf8");
    const put = await endpoint.handle(s3(issued, "PUT", "/s3/open/notes/2026/hallo.txt", {
      body: payload, headers: { "content-type": "text/plain; charset=utf-8" },
    }));
    expect(put.status, await put.clone().text()).toBe(200);
    expect(put.headers.get("etag")).toMatch(/^"[^"]+"$/);
    expect(put.headers.get("x-qkern-object-status")).toBe("clean");

    const head = await endpoint.handle(s3(issued, "HEAD", "/s3/open/notes/2026/hallo.txt"));
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(payload.byteLength));
    expect(head.headers.get("content-type")).toBe("text/plain");

    const get = await endpoint.handle(s3(issued, "GET", "/s3/open/notes/2026/hallo.txt"));
    expect(get.status).toBe(200);
    expect(Buffer.from(await get.arrayBuffer())).toEqual(payload);

    // Dasselbe Objekt, wie die REST-Route es sieht: ein Objekt, sauber.
    const listed = await storage.listObjects(admin, scope, "open", {});
    expect(listed.objects.map((object) => [object.key, object.status])).toEqual([["notes/2026/hallo.txt", "clean"]]);

    await endpoint.handle(s3(issued, "PUT", "/s3/open/notes/2027/plan.txt", { body: Buffer.from("plan"), headers: { "content-type": "text/plain" } }));
    await endpoint.handle(s3(issued, "PUT", "/s3/open/readme.txt", { body: Buffer.from("readme"), headers: { "content-type": "text/plain" } }));
    const list = await endpoint.handle(s3(issued, "GET", "/s3/open?list-type=2&delimiter=%2F&encoding-type=url"));
    expect(list.status).toBe(200);
    const xml = await list.text();
    expect(xml).toContain("<KeyCount>2</KeyCount>");
    expect(xml).toContain("<Key>readme.txt</Key>");
    expect(xml).toContain("<CommonPrefixes><Prefix>notes/</Prefix></CommonPrefixes>");
    expect(xml).toContain("<IsTruncated>false</IsTruncated>");
    const deep = await endpoint.handle(s3(issued, "GET", "/s3/open?list-type=2&prefix=notes%2F&max-keys=1"));
    const deepXml = await deep.text();
    expect(deepXml).toContain("<Key>notes/2026/hallo.txt</Key>");
    expect(deepXml).toContain("<IsTruncated>true</IsTruncated>");
    const token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(deepXml)![1];
    const next = await endpoint.handle(s3(issued, "GET", `/s3/open?list-type=2&prefix=notes%2F&max-keys=1&continuation-token=${token}`));
    const nextXml = await next.text();
    expect(nextXml).toContain("<Key>notes/2027/plan.txt</Key>");
    expect(nextXml).toContain("<IsTruncated>false</IsTruncated>");

    // Ueberschreiben ist S3: der neue Inhalt ersetzt den alten.
    const again = await endpoint.handle(s3(issued, "PUT", "/s3/open/readme.txt", { body: Buffer.from("readme v2"), headers: { "content-type": "text/plain" } }));
    expect(again.status).toBe(200);
    const readAgain = await endpoint.handle(s3(issued, "GET", "/s3/open/readme.txt"));
    expect(await readAgain.text()).toBe("readme v2");

    const del = await endpoint.handle(s3(issued, "DELETE", "/s3/open/readme.txt"));
    expect(del.status).toBe(204);
    const gone = await endpoint.handle(s3(issued, "GET", "/s3/open/readme.txt"));
    expect(gone.status).toBe(404);
    expect(await errorCode(gone)).toBe("NoSuchKey");
    // Jede Anfrage lief durch dieselbe Zulassung wie die REST-Routen.
    expect(admitted.length).toBeGreaterThanOrEqual(10);
    expect(admitted.every((target) => target.organizationId === scope.organizationId)).toBe(true);
  });

  it("refuses a wrong signature, an unknown, a revoked and an expired pair, and a pair without ciphertext", async () => {
    const { endpoint, issued, keys, storage, repository, admitted } = await harness();
    const wrong = await endpoint.handle(s3(issued, "GET", "/s3", { secret: "x".repeat(43) }));
    expect(wrong.status).toBe(403);
    expect(await errorCode(wrong)).toBe("SignatureDoesNotMatch");

    const unknown = await endpoint.handle(s3(issued, "GET", "/s3", { accessKeyId: "QKERNS3AAAAAAAAAAAAAAAAA" }));
    expect(unknown.status).toBe(403);
    expect(await errorCode(unknown)).toBe("InvalidAccessKeyId");

    const before = admitted.length;
    const skewed = await endpoint.handle(s3(issued, "GET", "/s3", { at: new Date(now.getTime() - 20 * 60_000) }));
    expect(await errorCode(skewed)).toBe("RequestTimeTooSkewed");
    // Ohne gueltige Signatur wird nichts gezaehlt und nichts gelesen.
    expect(admitted.length).toBe(before);

    const anonymous = await endpoint.handle(new Request(`${ORIGIN}/s3`));
    expect(anonymous.status).toBe(403);
    expect(await errorCode(anonymous)).toBe("AccessDenied");

    await keys.revoke(admin, scope, issued.key.id);
    const revoked = await endpoint.handle(s3(issued, "GET", "/s3"));
    expect(revoked.status).toBe(403);
    expect(await errorCode(revoked)).toBe("InvalidAccessKeyId");

    const shortLived = await keys.create(admin, scope, {
      name: "kurz", bucketIds: [(await storage.listBuckets(admin, scope))[0].id],
      expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    });
    const later = new Date(now.getTime() + 11 * 60_000);
    const expiredEndpoint = new ProjectStorageS3Endpoint({ storage, keys, now: () => later });
    const expired = await expiredEndpoint.handle(s3(shortLived, "GET", "/s3", { at: later }));
    expect(await errorCode(expired)).toBe("InvalidAccessKeyId");

    // Ein Paar aus einer Umgebung ohne Schluessel hat kein Chiffrat und oeffnet nichts.
    const bare = new ProjectStorageS3AccessKeyService({
      store: new MemoryProjectStorageS3AccessKeyStore(), buckets: repository, now: () => now,
    });
    const bareIssued = await bare.create(admin, scope, {
      name: "ohne", bucketIds: [(await storage.listBuckets(admin, scope))[0].id],
      expiresAt: new Date(now.getTime() + 3600_000).toISOString(),
    });
    expect(bareIssued.key.verifiable).toBe(false);
    expect(issued.key.verifiable).toBe(true);
    const bareEndpoint = new ProjectStorageS3Endpoint({ storage, keys: bare, now: () => now });
    expect(await errorCode(await bareEndpoint.handle(s3(bareIssued, "GET", "/s3")))).toBe("InvalidAccessKeyId");
  });

  it("answers NoSuchBucket for a bucket outside the set, a private bucket and another project's bucket", async () => {
    const { endpoint, issued } = await harness();
    for (const path of ["/s3/not-mine/x.txt", "/s3/locked/x.txt", "/s3/unknown/x.txt"]) {
      const get = await endpoint.handle(s3(issued, "GET", path));
      expect(get.status, path).toBe(404);
      expect(await errorCode(get), path).toBe("NoSuchBucket");
      const put = await endpoint.handle(s3(issued, "PUT", path, { body: Buffer.from("x"), headers: { "content-type": "text/plain" } }));
      expect(put.status, path).toBe(404);
    }
    // `open` gibt es auch im fremden Projekt; das Paar sieht nur das eigene.
    const list = await endpoint.handle(s3(issued, "GET", "/s3/open?list-type=2"));
    expect(list.status).toBe(200);
    expect(await list.text()).toContain("<KeyCount>0</KeyCount>");
  });

  it("lets the bucket rules of the service speak: MIME list, size, quota, payload hash", async () => {
    const { endpoint, issued, bytesAtProvider } = await harness();
    const html = await endpoint.handle(s3(issued, "PUT", "/s3/open/page.html", {
      body: Buffer.from("<html>"), headers: { "content-type": "text/html" },
    }));
    expect(html.status).toBe(400);
    expect(await errorCode(html)).toBe("InvalidArgument");

    const big = await endpoint.handle(s3(issued, "PUT", "/s3/open/big.bin", {
      body: randomBytes(2048), headers: { "content-type": "image/png" },
    }));
    expect(big.status).toBe(400);

    for (const index of [1, 2, 3, 4]) {
      const put = await endpoint.handle(s3(issued, "PUT", `/s3/open/q${index}.png`, {
        body: randomBytes(1000), headers: { "content-type": "image/png" },
      }));
      expect(put.status, `q${index}`).toBe(200);
    }
    const overQuota = await endpoint.handle(s3(issued, "PUT", "/s3/open/q5.png", {
      body: randomBytes(1000), headers: { "content-type": "image/png" },
    }));
    expect(overQuota.status).toBe(403);
    expect(await errorCode(overQuota)).toBe("QuotaExceeded");

    // Der deklarierte Hash gehoert zu anderen Bytes: Die Signatur stimmt, der Koerper nicht.
    const lying = s3(issued, "PUT", "/s3/open/liar.txt", { body: Buffer.from("wahr"), headers: { "content-type": "text/plain" } });
    // "lüg" hat wie "wahr" vier Bytes: Laenge stimmt, Hash nicht.
    const request = new Request(lying.url, { method: "PUT", headers: lying.headers, body: new Uint8Array(Buffer.from("lüg", "utf8")) });
    const mismatch = await endpoint.handle(request);
    expect(mismatch.status).toBe(400);
    expect(await errorCode(mismatch)).toBe("XAmzContentSHA256Mismatch");
    expect([...bytesAtProvider.keys()].some((key) => key.endsWith("/liar.txt"))).toBe(false);

    const unsigned = await endpoint.handle(s3(issued, "PUT", "/s3/open/unsigned.txt", {
      body: Buffer.from("ohne hash"), headers: { "content-type": "text/plain" }, unsigned: true,
    }));
    expect(unsigned.status).toBe(200);
  });

  it("names what it does not implement instead of guessing", async () => {
    const { endpoint, issued } = await harness();
    const cases: Array<[Request, string]> = [
      [s3(issued, "PUT", "/s3/new-bucket"), "NotImplemented"],
      [s3(issued, "POST", "/s3/open"), "NotImplemented"],
      [s3(issued, "PUT", "/s3/open/copy.txt", { headers: { "x-amz-copy-source": "/open/x.txt?versionId=3", "content-length": "0" } }), "NotImplemented"],
      [s3(issued, "GET", "/s3/open/x.txt?versionId=3"), "NotImplemented"],
    ];
    for (const [request, code] of cases) {
      const response = await endpoint.handle(request);
      expect(response.status, request.url).toBe(501);
      expect(await errorCode(response), request.url).toBe(code);
    }
    // Signature Version 2 ist keine Luecke, sondern vorbei: gesagt, nicht geraten.
    const v2 = await endpoint.handle(s3(issued, "GET", "/s3/open?list-type=2&AWSAccessKeyId=abc&Signature=def"));
    expect(v2.status).toBe(400);
  });

  it("(2.123) lists the same set in version 1 as in version 2, continues with marker and NextMarker, and refuses a mixed form", async () => {
    const { endpoint, issued } = await harness();
    for (const key of ["notes/2026/hallo.txt", "notes/2027/plan.txt", "readme.txt"]) {
      const response = await endpoint.handle(s3(issued, "PUT", `/s3/open/${key}`, {
        body: Buffer.from(key, "utf8"), headers: { "content-type": "text/plain" },
      }));
      expect(response.status, key).toBe(200);
    }

    // Ein GET auf den Bucket ohne `list-type` ist v1. Dieselben Schluessel wie
    // v2, nur ohne KeyCount und mit Marker.
    const v1 = await endpoint.handle(s3(issued, "GET", "/s3/open"));
    expect(v1.status).toBe(200);
    const v1Xml = await v1.text();
    expect(v1Xml).toContain("<Marker></Marker>");
    expect(v1Xml).not.toContain("<KeyCount>");
    expect([...v1Xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) => match[1]))
      .toEqual(["notes/2026/hallo.txt", "notes/2027/plan.txt", "readme.txt"]);

    // Delimiter und CommonPrefixes verhalten sich wie in v2, und `max-keys`
    // zaehlt Gruppen mit.
    const grouped = await endpoint.handle(s3(issued, "GET", "/s3/open?delimiter=%2F"));
    const groupedXml = await grouped.text();
    expect(groupedXml).toContain("<CommonPrefixes><Prefix>notes/</Prefix></CommonPrefixes>");
    expect(groupedXml).toContain("<Key>readme.txt</Key>");
    expect(groupedXml).toContain("<IsTruncated>false</IsTruncated>");

    // Abgeschnitten: NextMarker kommt, auch ohne Delimiter, und fuehrt genau
    // auf den naechsten Schluessel.
    const first = await endpoint.handle(s3(issued, "GET", "/s3/open?max-keys=1"));
    const firstXml = await first.text();
    expect(firstXml).toContain("<IsTruncated>true</IsTruncated>");
    const marker = /<NextMarker>([^<]+)<\/NextMarker>/.exec(firstXml)![1];
    expect(marker).toBe("notes/2026/hallo.txt");
    const second = await endpoint.handle(s3(issued, "GET", `/s3/open?max-keys=1&marker=${encodeURIComponent(marker)}`));
    const secondXml = await second.text();
    expect(secondXml).toContain("<Key>notes/2027/plan.txt</Key>");
    expect(secondXml).toContain(`<Marker>${marker}</Marker>`);
    expect(secondXml).not.toContain("<Key>notes/2026/hallo.txt</Key>");

    // Mit Delimiter zeigt NextMarker den letzten gesehenen Schluessel, nicht
    // den Gruppennamen: Die Fortsetzung ueberspringt nichts.
    //
    // Seit 2.127 ist dieser Schluessel der **letzte der Gruppe**, nicht der
    // erste: Eine begonnene Gruppe wird auf ihrer Seite fertig gelesen, damit
    // sie nicht auf zwei Seiten steht. `max-keys=1` erlaubt einen Eintrag, und
    // die Gruppe ist dieser eine Eintrag, auch wenn zwei Schluessel darin
    // liegen. Gefunden hat das die AWS CLI im Storage-Stack (2.127).
    const cut = await endpoint.handle(s3(issued, "GET", "/s3/open?delimiter=%2F&max-keys=1"));
    const cutXml = await cut.text();
    expect(cutXml).toContain("<CommonPrefixes><Prefix>notes/</Prefix></CommonPrefixes>");
    expect(cutXml).toContain("<IsTruncated>true</IsTruncated>");
    const cutMarker = /<NextMarker>([^<]+)<\/NextMarker>/.exec(cutXml)![1];
    expect(cutMarker).toBe("notes/2027/plan.txt");
    // Und die naechste Seite nennt die Gruppe nicht noch einmal.
    const afterCut = await endpoint.handle(s3(issued, "GET",
      `/s3/open?delimiter=%2F&max-keys=1&marker=${encodeURIComponent(cutMarker)}`));
    const afterCutXml = await afterCut.text();
    expect(afterCutXml).not.toContain("<Prefix>notes/</Prefix>");
    expect(afterCutXml).toContain("<Key>readme.txt</Key>");
    expect(afterCutXml).toContain("<IsTruncated>false</IsTruncated>");

    // `max-keys=0` (2.127): eine leere Liste, kein Fehler, und ausdruecklich
    // keine Fortsetzung. Vorher war es `InvalidArgument`, und die AWS CLI brach
    // daran mit Code 254 ab.
    for (const path of ["/s3/open?max-keys=0", "/s3/open?list-type=2&max-keys=0"]) {
      const none = await endpoint.handle(s3(issued, "GET", path));
      expect(none.status, path).toBe(200);
      const noneXml = await none.text();
      expect(noneXml, path).not.toContain("<Key>");
      expect(noneXml, path).not.toContain("<CommonPrefixes>");
      expect(noneXml, path).toContain("<IsTruncated>false</IsTruncated>");
      expect(noneXml, path).not.toContain("<NextMarker>");
      expect(noneXml, path).not.toContain("<NextContinuationToken>");
    }
    // Negativ bleibt ein Fehler: `-1` ist keine leere Liste, sondern Unsinn.
    const negative = await endpoint.handle(s3(issued, "GET", "/s3/open?max-keys=-1"));
    expect(negative.status).toBe(400);
    expect(await errorCode(negative)).toBe("InvalidArgument");

    // Gemischte Formen werden benannt, nicht ausgelegt.
    for (const query of ["?continuation-token=abc", "?start-after=readme.txt", "?list-type=1", "?list-type=3"]) {
      const mixed = await endpoint.handle(s3(issued, "GET", `/s3/open${query}`));
      expect(mixed.status, query).toBe(400);
      expect(await errorCode(mixed), query).toBe("InvalidArgument");
    }
  });

  it("(2.123) copies a part out of an existing object, whole and as a range, computes its checksum itself and refuses a client that claims one", async () => {
    const { endpoint, issued, storage, scans, open, providerRange, verdict } = await harness();
    const source = Buffer.from("0123456789abcdefghij", "utf8");
    expect((await endpoint.handle(s3(issued, "PUT", "/s3/open/source.txt", {
      body: source, headers: { "content-type": "text/plain" },
    }))).status).toBe(200);

    const started = await endpoint.handle(s3(issued, "POST", "/s3/open/assembled.txt?uploads", {
      headers: { "content-type": "text/plain" },
    }));
    const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(await started.text())![1];

    // Teil 1: das ganze Quellobjekt, ohne Bereich.
    const whole = await endpoint.handle(s3(issued, "PUT",
      `/s3/open/assembled.txt?partNumber=1&uploadId=${uploadId}`,
      { headers: { "x-amz-copy-source": "/open/source.txt" } }));
    expect(whole.status, await whole.clone().text()).toBe(200);
    const wholeXml = await whole.text();
    expect(wholeXml).toContain("<CopyPartResult");
    const firstEtag = /<ETag>([^<]+)<\/ETag>/.exec(wholeXml)![1].replace(/&quot;/g, '"');

    // Teil 2: nur ein Ausschnitt. Der Provider des Harness beherrscht Bereiche;
    // einer, der sie ignoriert, kommt weiter unten.
    const slice = await endpoint.handle(s3(issued, "PUT",
      `/s3/open/assembled.txt?partNumber=2&uploadId=${uploadId}`,
      { headers: { "x-amz-copy-source": "open/source.txt", "x-amz-copy-source-range": "bytes=10-14" } }));
    expect(slice.status, await slice.clone().text()).toBe(200);
    const secondEtag = /<ETag>([^<]+)<\/ETag>/.exec(await slice.text())![1].replace(/&quot;/g, '"');

    // Die Teile stehen beim Dienst mit ihren Groessen, und die Reservierung hat
    // ihre Bytes gebucht: derselbe Weg wie bei einem hochgeladenen Teil.
    const listed = await endpoint.handle(s3(issued, "GET", `/s3/open/assembled.txt?uploadId=${uploadId}`));
    const listedXml = await listed.text();
    expect(listedXml).toContain("<Size>20</Size>");
    expect(listedXml).toContain("<Size>5</Size>");
    expect((await bucketState(storage, open.id)).reservedBytes).toBe(25);

    const complete = Buffer.from(`<CompleteMultipartUpload>${
      [[1, firstEtag], [2, secondEtag]].map(([number, etag]) =>
        `<Part><PartNumber>${number}</PartNumber><ETag>${String(etag).replace(/"/g, "&quot;")}</ETag></Part>`).join("")
    }</CompleteMultipartUpload>`, "utf8");
    const completed = await endpoint.handle(s3(issued, "POST", `/s3/open/assembled.txt?uploadId=${uploadId}`, { body: complete }));
    expect(completed.status, await completed.clone().text()).toBe(200);
    expect(completed.headers.get("x-qkern-object-status")).toBe("clean");

    // Der Kern: Der Scanner bekommt die Summe der ganzen zusammengesetzten
    // Datei, gerechnet von QKERN aus den Bytes des Providers.
    const expected = Buffer.concat([source, source.subarray(10, 15)]);
    expect(scans.at(-1)!.checksumSha256).toBe(createHash("sha256").update(expected).digest("base64"));
    expect(scans.at(-1)!.sizeBytes).toBe(expected.byteLength);
    const read = await endpoint.handle(s3(issued, "GET", "/s3/open/assembled.txt"));
    expect(Buffer.from(await read.arrayBuffer()).equals(expected)).toBe(true);

    // Ein Provider, der den Bereich ignoriert, wird geschnitten, nicht geglaubt.
    providerRange.honours = false;
    const again = await endpoint.handle(s3(issued, "POST", "/s3/open/sliced.txt?uploads", {
      headers: { "content-type": "text/plain" },
    }));
    const secondUpload = /<UploadId>([^<]+)<\/UploadId>/.exec(await again.text())![1];
    const ignored = await endpoint.handle(s3(issued, "PUT",
      `/s3/open/sliced.txt?partNumber=1&uploadId=${secondUpload}`,
      { headers: { "x-amz-copy-source": "/open/source.txt", "x-amz-copy-source-range": "bytes=2-5" } }));
    expect(ignored.status, await ignored.clone().text()).toBe(200);
    const slicedParts = await endpoint.handle(s3(issued, "GET", `/s3/open/sliced.txt?uploadId=${secondUpload}`));
    expect(await slicedParts.text()).toContain("<Size>4</Size>");
    providerRange.honours = true;
    await endpoint.handle(s3(issued, "DELETE", `/s3/open/sliced.txt?uploadId=${secondUpload}`));

    // Jede Grenze beim Namen.
    const third = await endpoint.handle(s3(issued, "POST", "/s3/open/limits.txt?uploads", {
      headers: { "content-type": "text/plain" },
    }));
    const limitsUpload = /<UploadId>([^<]+)<\/UploadId>/.exec(await third.text())![1];
    const part = (headers: Record<string, string>) => s3(issued, "PUT",
      `/s3/open/limits.txt?partNumber=1&uploadId=${limitsUpload}`, { headers });
    const refusals: Array<[Request, number, string]> = [
      // Ein Client beglaubigt nichts: Er hat die Bytes nie gesehen.
      [part({ "x-amz-copy-source": "/open/source.txt", "x-amz-checksum-sha256": createHash("sha256").update(source).digest("base64") }), 400, "InvalidRequest"],
      // Eine offene Bereichsform wird nicht ausgelegt.
      [part({ "x-amz-copy-source": "/open/source.txt", "x-amz-copy-source-range": "bytes=3-" }), 400, "InvalidArgument"],
      [part({ "x-amz-copy-source": "/open/source.txt", "x-amz-copy-source-range": "bytes=-4" }), 400, "InvalidArgument"],
      // Hinter dem Ende der Quelle.
      [part({ "x-amz-copy-source": "/open/source.txt", "x-amz-copy-source-range": "bytes=0-99" }), 416, "InvalidRange"],
      // Eine Quelle, die es nicht gibt, und eine in einem Bucket, den das Paar
      // nicht lesen darf: Die Pruefung ist je Objekt, nicht je Bucket.
      [part({ "x-amz-copy-source": "/open/nowhere.txt" }), 404, "NoSuchKey"],
      [part({ "x-amz-copy-source": "/not-mine/source.txt" }), 404, "NoSuchBucket"],
      [part({ "x-amz-copy-source": "/open/source.txt?versionId=3" }), 501, "NotImplemented"],
    ];
    for (const [request, status, code] of refusals) {
      const response = await endpoint.handle(request);
      expect(response.status, request.headers.get("x-amz-copy-source") ?? "").toBe(status);
      expect(await errorCode(response)).toBe(code);
    }

    // Eine Quelle in Quarantaene ist fuer das Paar nicht sichtbar, also auch
    // nicht kopierbar.
    verdict.value = "pending";
    await endpoint.handle(s3(issued, "PUT", "/s3/open/dirty.txt", {
      body: Buffer.from("verdaechtig", "utf8"), headers: { "content-type": "text/plain" },
    }));
    verdict.value = "clean";
    const quarantined = await endpoint.handle(part({ "x-amz-copy-source": "/open/dirty.txt" }));
    expect(quarantined.status).toBe(404);
    expect(await errorCode(quarantined)).toBe("NoSuchKey");
    await endpoint.handle(s3(issued, "DELETE", `/s3/open/limits.txt?uploadId=${limitsUpload}`));
  });

  it("carries a multipart upload through the same service path, and the scanner sees the checksum of the whole file", async () => {
    const { endpoint, issued, storage, scans, open } = await harness();
    const first = Buffer.alloc(600, "a");
    const second = Buffer.alloc(400, "b");
    const whole = Buffer.concat([first, second]);

    const started = await endpoint.handle(s3(issued, "POST", "/s3/open/big.txt?uploads", {
      headers: { "content-type": "text/plain" },
    }));
    expect(started.status).toBe(200);
    const startedBody = await started.text();
    const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(startedBody)![1];
    expect(startedBody).toContain("<Key>big.txt</Key>");

    const etags: string[] = [];
    for (const [index, part] of [first, second].entries()) {
      const response = await endpoint.handle(s3(issued, "PUT",
        `/s3/open/big.txt?partNumber=${index + 1}&uploadId=${uploadId}`, { body: part }));
      expect(response.status, `part ${index + 1}`).toBe(200);
      etags.push(response.headers.get("ETag")!);
    }

    // Die Teile stehen beim Dienst, nicht beim Provider erfragt.
    const listed = await endpoint.handle(s3(issued, "GET", `/s3/open/big.txt?uploadId=${uploadId}`));
    expect(listed.status).toBe(200);
    const listedBody = await listed.text();
    expect(listedBody).toContain("<Size>600</Size>");
    expect(listedBody).toContain("<Size>400</Size>");
    expect(listedBody).toContain("<IsTruncated>false</IsTruncated>");

    const inFlight = await endpoint.handle(s3(issued, "GET", "/s3/open?uploads"));
    expect(inFlight.status).toBe(200);
    const inFlightBody = await inFlight.text();
    expect(inFlightBody).toContain("<Key>big.txt</Key>");
    expect(inFlightBody).toContain(`<UploadId>${uploadId}</UploadId>`);

    // Solange die Teile fliegen, haelt die Reservierung ihre Bytes.
    const reserving = await bucketState(storage, open.id);
    expect(reserving.reservedBytes).toBe(1000);

    const body = Buffer.from(`<CompleteMultipartUpload>${[1, 2].map((number) =>
      `<Part><PartNumber>${number}</PartNumber><ETag>${etags[number - 1].replace(/"/g, "&quot;")}</ETag></Part>`,
    ).join("")}</CompleteMultipartUpload>`, "utf8");
    const completed = await endpoint.handle(s3(issued, "POST", `/s3/open/big.txt?uploadId=${uploadId}`, { body }));
    expect(completed.status).toBe(200);
    expect(await completed.text()).toContain("<Key>big.txt</Key>");
    expect(completed.headers.get("x-qkern-object-status")).toBe("clean");

    // Das ist der Kern: Der Scanner hat die Summe der ganzen Datei bekommen,
    // nicht die eines Teils und keine zusammengesetzte.
    expect(scans.at(-1)!.checksumSha256).toBe(createHash("sha256").update(whole).digest("base64"));
    expect(scans.at(-1)!.sizeBytes).toBe(1000);

    // Und das Objekt ist danach ein Objekt wie jedes andere.
    const read = await endpoint.handle(s3(issued, "GET", "/s3/open/big.txt"));
    expect(read.status).toBe(200);
    expect(Buffer.from(await read.arrayBuffer()).equals(whole)).toBe(true);
    const settled = await bucketState(storage, open.id);
    expect(settled.reservedBytes).toBe(0);
    expect(settled.usedBytes).toBe(1000);
    const gone = await endpoint.handle(s3(issued, "GET", `/s3/open/big.txt?uploadId=${uploadId}`));
    expect(gone.status).toBe(404);
    expect(await errorCode(gone)).toBe("NoSuchUpload");
  });

  it("refuses a part list that is out of order, names a part it never took, and an upload that is not its own", async () => {
    const { endpoint, issued } = await harness();
    const started = await endpoint.handle(s3(issued, "POST", "/s3/open/order.txt?uploads", {
      headers: { "content-type": "text/plain" },
    }));
    const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(await started.text())![1];
    const etags: string[] = [];
    for (const number of [1, 2]) {
      const response = await endpoint.handle(s3(issued, "PUT",
        `/s3/open/order.txt?partNumber=${number}&uploadId=${uploadId}`, { body: Buffer.alloc(300, String(number)) }));
      etags.push(response.headers.get("ETag")!);
    }
    const listOf = (numbers: number[], tags: string[]) => Buffer.from(
      `<CompleteMultipartUpload>${numbers.map((number, index) =>
        `<Part><PartNumber>${number}</PartNumber><ETag>${tags[index].replace(/"/g, "&quot;")}</ETag></Part>`,
      ).join("")}</CompleteMultipartUpload>`, "utf8");

    // Absteigend: Die Bytes lagen anders zusammen als jede Pruefsumme sagt.
    const reversed = await endpoint.handle(s3(issued, "POST", `/s3/open/order.txt?uploadId=${uploadId}`,
      { body: listOf([2, 1], [etags[1], etags[0]]) }));
    expect(reversed.status).toBe(400);
    expect(await errorCode(reversed)).toBe("InvalidPartOrder");

    // Dieselbe Nummer zweimal ist auch keine aufsteigende Ordnung.
    const twice = await endpoint.handle(s3(issued, "POST", `/s3/open/order.txt?uploadId=${uploadId}`,
      { body: listOf([1, 1], [etags[0], etags[0]]) }));
    expect(await errorCode(twice)).toBe("InvalidPartOrder");

    // Eine Nummer, die dieser Endpunkt nie angenommen hat.
    const unknown = await endpoint.handle(s3(issued, "POST", `/s3/open/order.txt?uploadId=${uploadId}`,
      { body: listOf([1, 3], [etags[0], etags[1]]) }));
    expect(await errorCode(unknown)).toBe("InvalidPart");

    // Eine fremde Kennung zum richtigen Teil.
    const wrongEtag = await endpoint.handle(s3(issued, "POST", `/s3/open/order.txt?uploadId=${uploadId}`,
      { body: listOf([1, 2], [etags[0], '"memory-2-deadbeef"']) }));
    expect(await errorCode(wrongEtag)).toBe("InvalidPart");

    // Ein Upload, den es nicht gibt, und einer unter dem falschen Schluessel.
    const nowhere = await endpoint.handle(s3(issued, "GET",
      "/s3/open/order.txt?uploadId=00000000-0000-4000-8000-0000000009ff"));
    expect(await errorCode(nowhere)).toBe("NoSuchUpload");
    const wrongKey = await endpoint.handle(s3(issued, "GET", `/s3/open/other.txt?uploadId=${uploadId}`));
    expect(await errorCode(wrongKey)).toBe("NoSuchUpload");
  });

  it("leaves neither parts at the provider nor a reservation behind when an upload is aborted", async () => {
    const { endpoint, issued, storage, provider, open } = await harness();
    const started = await endpoint.handle(s3(issued, "POST", "/s3/open/abort.txt?uploads", {
      headers: { "content-type": "text/plain" },
    }));
    const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(await started.text())![1];
    await endpoint.handle(s3(issued, "PUT", `/s3/open/abort.txt?partNumber=1&uploadId=${uploadId}`,
      { body: Buffer.alloc(500, "z") }));
    expect((await bucketState(storage, open.id)).reservedBytes).toBe(500);

    const aborted = await endpoint.handle(s3(issued, "DELETE", `/s3/open/abort.txt?uploadId=${uploadId}`));
    expect(aborted.status).toBe(204);

    // Beim Provider liegt kein begonnener Upload mehr, und die Quota ist frei.
    expect(await provider.listMultipartUploads({ keyPrefix: `${scope.organizationId}/${scope.projectId}/${scope.environment}/` }))
      .toHaveLength(0);
    const released = await bucketState(storage, open.id);
    expect(released.reservedBytes).toBe(0);
    expect(released.usedBytes).toBe(0);
    expect(await errorCode(await endpoint.handle(s3(issued, "GET", `/s3/open/abort.txt?uploadId=${uploadId}`))))
      .toBe("NoSuchUpload");

    // Der Schluessel ist wieder frei: ein zweiter Anfang geht.
    const again = await endpoint.handle(s3(issued, "POST", "/s3/open/abort.txt?uploads", {
      headers: { "content-type": "text/plain" },
    }));
    expect(again.status).toBe(200);
  });

  it("weighs every part against the bucket rules and quarantines a multipart object whose verdict is not clean", async () => {
    const { endpoint, issued, verdict } = await harness();
    // `open` nimmt hoechstens 1024 Bytes je Objekt: Das zweite Teil sprengt es,
    // und zwar bevor seine Bytes beim Provider liegen.
    const started = await endpoint.handle(s3(issued, "POST", "/s3/open/limit.txt?uploads", {
      headers: { "content-type": "text/plain" },
    }));
    const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(await started.text())![1];
    const first = await endpoint.handle(s3(issued, "PUT",
      `/s3/open/limit.txt?partNumber=1&uploadId=${uploadId}`, { body: Buffer.alloc(900, "a") }));
    expect(first.status).toBe(200);
    const second = await endpoint.handle(s3(issued, "PUT",
      `/s3/open/limit.txt?partNumber=2&uploadId=${uploadId}`, { body: Buffer.alloc(900, "b") }));
    expect(second.status).toBe(403);
    expect(await errorCode(second)).toBe("QuotaExceeded");

    // Ein Inhaltstyp, den der Bucket nicht fuehrt, kommt nicht einmal an.
    const refused = await endpoint.handle(s3(issued, "POST", "/s3/open/script.js?uploads", {
      headers: { "content-type": "application/javascript" },
    }));
    expect(refused.status).toBe(400);

    // Und das Urteil entscheidet wie bei einem Stueck: kein Urteil, Quarantaene.
    verdict.value = "pending";
    const quarantined = await endpoint.handle(s3(issued, "PUT",
      `/s3/open/limit.txt?partNumber=2&uploadId=${uploadId}`, { body: Buffer.alloc(100, "b") }));
    const etag = quarantined.headers.get("ETag")!;
    const firstEtag = first.headers.get("ETag")!;
    const body = Buffer.from(`<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>${
      firstEtag.replace(/"/g, "&quot;")}</ETag></Part><Part><PartNumber>2</PartNumber><ETag>${
      etag.replace(/"/g, "&quot;")}</ETag></Part></CompleteMultipartUpload>`, "utf8");
    const completed = await endpoint.handle(s3(issued, "POST", `/s3/open/limit.txt?uploadId=${uploadId}`, { body }));
    expect(completed.status).toBe(200);
    expect(completed.headers.get("x-qkern-object-status")).toBe("quarantined");
    // Ein Objekt in Quarantaene hat keine Lesezusage, also sieht das Paar es nicht.
    expect((await endpoint.handle(s3(issued, "GET", "/s3/open/limit.txt"))).status).toBe(404);
  });

  it("accepts aws-chunked bodies in all three forms and refuses a tampered chunk, a wrong trailer and a wrong header checksum without storing anything", async () => {
    const { endpoint, issued, bytesAtProvider, storage } = await harness();
    const payload = randomBytes(1000);
    for (const [index, declared] of [STREAMING_SIGNED_PAYLOAD, STREAMING_SIGNED_PAYLOAD_TRAILER, STREAMING_UNSIGNED_PAYLOAD_TRAILER].entries()) {
      const trailers = declared === STREAMING_SIGNED_PAYLOAD ? undefined : { "x-amz-checksum-crc64nvme": checksumBase64("x-amz-checksum-crc64nvme", payload) };
      const put = await endpoint.handle(chunked(issued, `/s3/open/chunked-${index}.png`, payload, declared, { contentType: "image/png", trailers, chunkBytes: 300 }));
      expect(put.status, `${declared}: ${await put.clone().text()}`).toBe(200);
      const get = await endpoint.handle(s3(issued, "GET", `/s3/open/chunked-${index}.png`));
      expect(Buffer.from(await get.arrayBuffer()).equals(payload), declared).toBe(true);
      // Ohne Content-Length, wie bei Transfer-Encoding: chunked auf der Leitung.
      const bare = await endpoint.handle(chunked(issued, `/s3/open/bare-${index}.png`, payload, declared, { contentType: "image/png", trailers, withContentLength: false }));
      expect(bare.status, declared).toBe(200);
      // Der Bucket hat 4 KiB Kontingent; was belegt ist, geht wieder weg.
      for (const key of [`chunked-${index}.png`, `bare-${index}.png`]) {
        expect((await endpoint.handle(s3(issued, "DELETE", `/s3/open/${key}`))).status).toBe(204);
      }
    }
    const stored = (await storage.listObjects(admin, scope, "open", {})).objects.length;

    // Ein Byte in einem signierten Block: die Kette reisst, nichts wird gespeichert.
    const tampered = await endpoint.handle(chunked(issued, "/s3/open/tampered.png", payload, STREAMING_SIGNED_PAYLOAD, {
      contentType: "image/png", tamper: (body) => { const copy = Buffer.from(body); copy[body.indexOf("\r\n") + 2 + 10] ^= 0xff; return copy; },
    }));
    expect(tampered.status).toBe(403);
    expect(await errorCode(tampered)).toBe("SignatureDoesNotMatch");

    // Unsignierte Bloecke, aber der Trailer sagt eine andere Summe: BadDigest.
    const wrongTrailer = await endpoint.handle(chunked(issued, "/s3/open/wrong-trailer.png", payload, STREAMING_UNSIGNED_PAYLOAD_TRAILER, {
      contentType: "image/png", trailers: { "x-amz-checksum-crc32": checksumBase64("x-amz-checksum-crc32", Buffer.from("andere bytes")) },
    }));
    expect(wrongTrailer.status).toBe(400);
    expect(await errorCode(wrongTrailer)).toBe("BadDigest");

    // Ein angekuendigter Trailer, der nicht kommt.
    const missingTrailer = await endpoint.handle(chunked(issued, "/s3/open/missing-trailer.png", payload, STREAMING_UNSIGNED_PAYLOAD_TRAILER, {
      contentType: "image/png", trailers: { "x-amz-checksum-crc32": checksumBase64("x-amz-checksum-crc32", payload) },
      tamper: (body) => Buffer.from(body.toString("latin1").replace(/x-amz-checksum-crc32:[^\r]+\r\n/, ""), "latin1"),
    }));
    expect(missingTrailer.status).toBe(400);

    // Dieselbe Pruefsumme als Header auf einem gewoehnlichen PUT: richtig geht, falsch faellt.
    const rightHeader = await endpoint.handle(s3(issued, "PUT", "/s3/open/header-ok.png", {
      body: payload, headers: { "content-type": "image/png", "x-amz-checksum-sha256": checksumBase64("x-amz-checksum-sha256", payload) },
    }));
    expect(rightHeader.status).toBe(200);
    const wrongHeader = await endpoint.handle(s3(issued, "PUT", "/s3/open/header-bad.png", {
      body: payload, headers: { "content-type": "image/png", "x-amz-checksum-crc32c": checksumBase64("x-amz-checksum-crc32c", Buffer.from("x")) },
    }));
    expect(wrongHeader.status).toBe(400);
    expect(await errorCode(wrongHeader)).toBe("BadDigest");

    // Die deklarierte Laenge zaehlt, nicht die auf der Leitung: 64 KiB gesagt, 1000 Bytes geschickt.
    const lying = chunked(issued, "/s3/open/lying.png", payload, STREAMING_SIGNED_PAYLOAD, { contentType: "image/png" });
    const lyingHeaders = new Headers(lying.headers);
    lyingHeaders.set("x-amz-decoded-content-length", "65536");
    const lyingResponse = await endpoint.handle(new Request(lying.url, { method: "PUT", headers: lyingHeaders, body: await lying.arrayBuffer() }));
    expect([400, 403]).toContain(lyingResponse.status);

    expect((await storage.listObjects(admin, scope, "open", {})).objects.length).toBe(stored + 1);
    expect([...bytesAtProvider.keys()].filter((key) => /tampered|wrong|missing|header-bad|lying/.test(key))).toEqual([]);
  });

  it("serves a byte range with 206, whether the provider honours Range or not, and refuses one past the end", async () => {
    const { endpoint, issued, providerRange } = await harness();
    const payload = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz", "ascii");
    await endpoint.handle(s3(issued, "PUT", "/s3/open/alphabet.txt", { body: payload, headers: { "content-type": "text/plain" } }));
    const head = await endpoint.handle(s3(issued, "HEAD", "/s3/open/alphabet.txt"));
    expect(head.headers.get("accept-ranges")).toBe("bytes");
    for (const honours of [true, false]) {
      providerRange.honours = honours;
      const middle = await endpoint.handle(s3(issued, "GET", "/s3/open/alphabet.txt", { headers: { range: "bytes=10-15" } }));
      expect(middle.status, String(honours)).toBe(206);
      expect(middle.headers.get("content-range")).toBe("bytes 10-15/36");
      expect(middle.headers.get("content-length")).toBe("6");
      expect(await middle.text()).toBe("abcdef");
      const tail = await endpoint.handle(s3(issued, "GET", "/s3/open/alphabet.txt", { headers: { range: "bytes=-3" } }));
      expect(tail.status).toBe(206);
      expect(await tail.text()).toBe("xyz");
      const open = await endpoint.handle(s3(issued, "GET", "/s3/open/alphabet.txt", { headers: { range: "bytes=30-" } }));
      expect(open.headers.get("content-range")).toBe("bytes 30-35/36");
      expect(await open.text()).toBe("uvwxyz");
      const beyond = await endpoint.handle(s3(issued, "GET", "/s3/open/alphabet.txt", { headers: { range: "bytes=10-999" } }));
      expect(await beyond.text()).toBe("abcdefghijklmnopqrstuvwxyz");
    }
    const past = await endpoint.handle(s3(issued, "GET", "/s3/open/alphabet.txt", { headers: { range: "bytes=36-40" } }));
    expect(past.status).toBe(416);
    expect(await errorCode(past)).toBe("InvalidRange");
    expect(past.headers.get("content-range")).toBe("bytes */36");
    // Eine Form, die keine ist, gilt wie bei S3 als nicht vorhanden.
    const odd = await endpoint.handle(s3(issued, "GET", "/s3/open/alphabet.txt", { headers: { range: "bytes=0-1,4-5" } }));
    expect(odd.status).toBe(200);
    expect(await odd.text()).toBe(payload.toString("ascii"));
  });

  it("copies within the bucket set through the same service, and cannot copy what a pair cannot read: a quarantined source, a foreign bucket, a missing key", async () => {
    const { endpoint, issued, storage, keys, verdict, bytesAtProvider } = await harness();
    const payload = Buffer.from("original", "utf8");
    await endpoint.handle(s3(issued, "PUT", "/s3/open/src/a.txt", { body: payload, headers: { "content-type": "text/plain" } }));
    const copy = await endpoint.handle(s3(issued, "PUT", "/s3/open/dst/b.txt", { headers: { "x-amz-copy-source": "/open/src/a.txt", "content-length": "0" } }));
    expect(copy.status, await copy.clone().text()).toBe(200);
    const copyXml = await copy.text();
    expect(copyXml).toContain("<CopyObjectResult");
    expect(copyXml).toContain("<ETag>");
    expect(copy.headers.get("x-qkern-object-status")).toBe("clean");
    const both = await storage.listObjects(admin, scope, "open", {});
    expect(both.objects.map((object) => [object.key, object.contentType, object.sizeBytes, object.status]))
      .toEqual([["dst/b.txt", "text/plain", 8, "clean"], ["src/a.txt", "text/plain", 8, "clean"]]);
    expect(await (await endpoint.handle(s3(issued, "GET", "/s3/open/dst/b.txt"))).text()).toBe("original");
    // Die Form ohne fuehrenden Schraegstrich und URL-kodiert, wie die SDKs sie schicken.
    const encoded = await endpoint.handle(s3(issued, "PUT", "/s3/open/dst/c.txt", { headers: { "x-amz-copy-source": "open/src%2Fa.txt", "content-length": "0" } }));
    expect(encoded.status).toBe(200);
    // REPLACE nimmt den neuen Typ, sofern der Bucket ihn erlaubt.
    const replaced = await endpoint.handle(s3(issued, "PUT", "/s3/open/dst/d.png", {
      headers: { "x-amz-copy-source": "/open/src/a.txt", "x-amz-metadata-directive": "REPLACE", "content-type": "image/png", "content-length": "0" },
    }));
    expect(replaced.status).toBe(200);
    expect((await storage.listObjects(admin, scope, "open", { prefix: "dst/d" })).objects[0].contentType).toBe("image/png");
    // Auf sich selbst ohne neue Metadaten: S3 lehnt das ab, wir auch.
    const self = await endpoint.handle(s3(issued, "PUT", "/s3/open/src/a.txt", { headers: { "x-amz-copy-source": "/open/src/a.txt", "content-length": "0" } }));
    expect(self.status).toBe(400);
    expect(await errorCode(self)).toBe("InvalidRequest");

    // Ein Bucket ausserhalb des Satzes als Quelle: NoSuchBucket, und nichts entsteht.
    const otherPair = await keys.create(admin, scope, { name: "anderes", bucketIds: [(await storage.listBuckets(admin, scope)).find((bucket) => bucket.name === "not-mine")!.id], expiresAt: new Date(now.getTime() + 3600_000).toISOString() });
    await endpoint.handle(s3(otherPair, "PUT", "/s3/not-mine/theirs.txt", { body: Buffer.from("theirs"), headers: { "content-type": "text/plain" } }));
    const foreignSource = await endpoint.handle(s3(issued, "PUT", "/s3/open/dst/stolen.txt", { headers: { "x-amz-copy-source": "/not-mine/theirs.txt", "content-length": "0" } }));
    expect(foreignSource.status).toBe(404);
    expect(await errorCode(foreignSource)).toBe("NoSuchBucket");
    const foreignTarget = await endpoint.handle(s3(issued, "PUT", "/s3/not-mine/planted.txt", { headers: { "x-amz-copy-source": "/open/src/a.txt", "content-length": "0" } }));
    expect(foreignTarget.status).toBe(404);
    expect((await storage.listObjects(admin, scope, "not-mine", {})).objects.map((object) => object.key)).toEqual(["theirs.txt"]);
    const missing = await endpoint.handle(s3(issued, "PUT", "/s3/open/dst/ghost.txt", { headers: { "x-amz-copy-source": "/open/src/nothing.txt", "content-length": "0" } }));
    expect(missing.status).toBe(404);
    expect(await errorCode(missing)).toBe("NoSuchKey");

    // Eine Quelle in Quarantaene: fuer das Paar nicht da, also nicht kopierbar.
    verdict.value = "pending";
    const held = await endpoint.handle(s3(issued, "PUT", "/s3/open/src/held.txt", { body: Buffer.from("held"), headers: { "content-type": "text/plain" } }));
    expect(held.status).toBe(200);
    expect(held.headers.get("x-qkern-object-status")).toBe("quarantined");
    verdict.value = "clean";
    expect((await storage.listObjects(admin, scope, "open", { prefix: "src/held" })).objects[0].status).toBe("quarantined");
    const quarantined = await endpoint.handle(s3(issued, "PUT", "/s3/open/dst/held-copy.txt", { headers: { "x-amz-copy-source": "/open/src/held.txt", "content-length": "0" } }));
    expect(quarantined.status).toBe(404);
    expect(await errorCode(quarantined)).toBe("NoSuchKey");
    expect((await storage.listObjects(admin, scope, "open", { prefix: "dst/held" })).objects).toEqual([]);
    expect([...bytesAtProvider.keys()].some((key) => key.includes("held-copy") || key.includes("stolen") || key.includes("planted") || key.includes("ghost"))).toBe(false);

    // Eine Kopie mit Koerper ist keine Kopie.
    const withBody = await endpoint.handle(s3(issued, "PUT", "/s3/open/dst/e.txt", { body: Buffer.from("x"), headers: { "x-amz-copy-source": "/open/src/a.txt" } }));
    expect(withBody.status).toBe(400);
  });

  it("deletes many keys in one call, names each refusal and treats a missing key as deleted, like S3", async () => {
    const { endpoint, issued, storage } = await harness();
    for (const name of ["one", "two", "three"]) {
      await endpoint.handle(s3(issued, "PUT", `/s3/open/batch/${name}.txt`, { body: Buffer.from(name), headers: { "content-type": "text/plain" } }));
    }
    const body = Buffer.from(`<?xml version="1.0"?><Delete xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Object><Key>batch/one.txt</Key></Object><Object><Key>batch/two.txt</Key></Object><Object><Key>batch/never.txt</Key></Object><Object><Key>../escape.txt</Key></Object></Delete>`);
    const md5 = createHash("md5").update(body).digest("base64");
    const response = await endpoint.handle(s3(issued, "POST", "/s3/open?delete", { body, headers: { "content-md5": md5, "content-type": "application/xml" } }));
    expect(response.status, await response.clone().text()).toBe(200);
    const xml = await response.text();
    expect(xml).toContain("<Deleted><Key>batch/one.txt</Key></Deleted>");
    expect(xml).toContain("<Deleted><Key>batch/two.txt</Key></Deleted>");
    expect(xml).toContain("<Deleted><Key>batch/never.txt</Key></Deleted>");
    // Ein Schluessel, den der Dienst verweigert, steht mit Grund da; die anderen gingen trotzdem.
    expect(xml).toContain("<Error><Key>../escape.txt</Key><Code>InvalidArgument</Code>");
    expect((await storage.listObjects(admin, scope, "open", {})).objects.map((object) => object.key)).toEqual(["batch/three.txt"]);

    const quiet = await endpoint.handle(s3(issued, "POST", "/s3/open?delete", {
      body: Buffer.from("<Delete><Quiet>true</Quiet><Object><Key>batch/three.txt</Key></Object></Delete>"),
    }));
    expect(await quiet.text()).not.toContain("<Deleted>");
    expect((await storage.listObjects(admin, scope, "open", {})).objects).toEqual([]);

    const wrongMd5 = await endpoint.handle(s3(issued, "POST", "/s3/open?delete", { body, headers: { "content-md5": createHash("md5").update("x").digest("base64") } }));
    expect(wrongMd5.status).toBe(400);
    expect(await errorCode(wrongMd5)).toBe("BadDigest");
    const tooMany = Buffer.from(`<Delete>${"<Object><Key>k</Key></Object>".repeat(1001)}</Delete>`);
    const refused = await endpoint.handle(s3(issued, "POST", "/s3/open?delete", { body: tooMany }));
    expect(refused.status).toBe(400);
    expect(await errorCode(refused)).toBe("MalformedXML");
    const notMine = await endpoint.handle(s3(issued, "POST", "/s3/not-mine?delete", { body }));
    expect(notMine.status).toBe(404);
  });

  it("honours a presigned URL for at most 15 minutes, bound to the pair, the method and the path", async () => {
    const { endpoint, issued, keys, storage } = await harness();
    const payload = Buffer.from("via presigned url", "utf8");
    // PUT ueber die Adresse: der Koerper ist unsigniert, die Adresse traegt die Bindung.
    const putUrl = presigned(issued, "PUT", "/s3/open/pre/signed.txt");
    const put = await endpoint.handle(new Request(putUrl, { method: "PUT", headers: { "content-type": "text/plain", "content-length": String(payload.byteLength) }, body: new Uint8Array(payload) }));
    expect(put.status, await put.clone().text()).toBe(200);
    const getUrl = presigned(issued, "GET", "/s3/open/pre/signed.txt");
    const get = await endpoint.handle(new Request(getUrl));
    expect(get.status).toBe(200);
    expect(await get.text()).toBe("via presigned url");
    expect((await endpoint.handle(new Request(presigned(issued, "HEAD", "/s3/open/pre/signed.txt"), { method: "HEAD" }))).status).toBe(200);

    // Die Adresse fuer GET oeffnet kein PUT und keinen anderen Schluessel.
    const misuse = await endpoint.handle(new Request(getUrl, { method: "PUT", headers: { "content-length": "1" }, body: new Uint8Array(1) }));
    expect(misuse.status).toBe(403);
    expect(await errorCode(misuse)).toBe("SignatureDoesNotMatch");
    const other = new URL(getUrl.toString());
    other.pathname = "/s3/open/pre/other.txt";
    expect(await errorCode(await endpoint.handle(new Request(other)))).toBe("SignatureDoesNotMatch");

    // Laenger als 15 Minuten gibt es nicht, auch nicht mit gueltiger Signatur.
    const week = await endpoint.handle(new Request(presigned(issued, "GET", "/s3/open/pre/signed.txt", { expiresSeconds: 3600 })));
    expect(week.status).toBe(400);
    expect(await errorCode(week)).toBe("AuthorizationQueryParametersError");
    // Abgelaufen: die Uhr des Endpunkts steht auf `now`, die Adresse ist von vor 20 Minuten.
    const stale = await endpoint.handle(new Request(presigned(issued, "GET", "/s3/open/pre/signed.txt", { at: new Date(now.getTime() - 20 * 60_000), expiresSeconds: 600 })));
    expect(stale.status).toBe(403);
    expect(await errorCode(stale)).toBe("AccessDenied");
    // Falsches Geheimnis, widerrufenes Paar.
    expect(await errorCode(await endpoint.handle(new Request(presigned(issued, "GET", "/s3/open/pre/signed.txt", { secret: "w".repeat(43) }))))).toBe("SignatureDoesNotMatch");
    await keys.revoke(admin, scope, issued.key.id);
    expect(await errorCode(await endpoint.handle(new Request(getUrl)))).toBe("InvalidAccessKeyId");
    expect((await storage.listObjects(admin, scope, "open", {})).objects.map((object) => object.key)).toEqual(["pre/signed.txt"]);
  });
});
