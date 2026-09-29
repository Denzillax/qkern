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
import { sha256Hex, signSigV4Request } from "@/lib/server/project-storage/s3-sigv4";
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
  const scanner: ProjectStorageScanner = { async scan() { return "clean"; } };
  const storage = new ProjectStorageService({ repository, provider, scanner, now: () => now });
  const protector = new ProjectStorageS3SecretProtector(randomBytes(32));
  const keys = new ProjectStorageS3AccessKeyService({
    store: new MemoryProjectStorageS3AccessKeyStore(), buckets: repository, protector, now: () => now,
  });
  const admitted: ProjectStorageScope[] = [];
  // Der Provider-Ersatz: loest die POST-Zusage ein und liefert GET-Zusagen aus.
  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
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
    return body ? new Response(new Uint8Array(body), { status: 200 }) : new Response(null, { status: 404 });
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
  return { endpoint, storage, keys, provider, repository, issued, open, locked, notMine, foreign, admitted, bytesAtProvider };
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
      [s3(issued, "GET", "/s3/open?list-type=2&X-Amz-Signature=abc"), "NotImplemented"],
      [s3(issued, "GET", "/s3/open"), "NotImplemented"],
      [s3(issued, "PUT", "/s3/open/x.txt?uploadId=1&partNumber=1", { body: Buffer.from("x") }), "NotImplemented"],
      [s3(issued, "PUT", "/s3/new-bucket"), "NotImplemented"],
      [s3(issued, "GET", "/s3/open/x.txt", { headers: { range: "bytes=0-1" } }), "NotImplemented"],
      [s3(issued, "PUT", "/s3/open/copy.txt", { headers: { "x-amz-copy-source": "/open/x.txt", "content-length": "0" } }), "NotImplemented"],
      [s3(issued, "POST", "/s3/open/x.txt?uploads"), "NotImplemented"],
    ];
    for (const [request, code] of cases) {
      const response = await endpoint.handle(request);
      expect(response.status, request.url).toBe(501);
      expect(await errorCode(response), request.url).toBe(code);
    }
    const chunked = s3(issued, "PUT", "/s3/open/x.txt", { body: Buffer.from("x") });
    const streaming = new Request(chunked.url, { method: "PUT", headers: chunked.headers, body: new Uint8Array(1) });
    streaming.headers.set("x-amz-content-sha256", "STREAMING-AWS4-HMAC-SHA256-PAYLOAD");
    const response = await endpoint.handle(streaming);
    expect(response.status).toBe(501);
    expect(await response.text()).toContain("STREAMING");
  });
});
