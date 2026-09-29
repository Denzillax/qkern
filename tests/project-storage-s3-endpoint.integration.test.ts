import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ClamAvProjectStorageScanner,
  ClamdInstreamClient,
} from "@/lib/server/project-storage/clamav-scanner";
import type { ProjectStoragePrincipal, ProjectStorageScope } from "@/lib/server/project-storage/model";
import {
  S3ProjectStorageProvider,
  StaticS3ProjectStorageCredentialsProvider,
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
 * Der S3-Endpunkt (2.96) gegen echtes versitygw und echtes ClamAV.
 *
 * Der Fall rechnet jede Signatur selbst aus `node:crypto`, so wie ein
 * S3-Client es taete, und schickt sie an den Endpunkt. Hinter dem Endpunkt
 * steht derselbe Dienst wie im Fall daneben: Das Objekt landet beim echten
 * Provider, der echte Scanner liest es, und erst sein Urteil macht es lesbar.
 * Was der Fall belegt: Ein gueltiges Paar liest und schreibt; ein
 * widerrufenes faellt; eine falsche Signatur faellt; ein fremder Bucket
 * faellt; EICAR kommt nicht durch und laesst beim Provider nichts zurueck.
 */
const enabled = process.env.QKERN_TEST_STORAGE_PROVIDER_E2E === "true";
const endpoint = process.env.QKERN_TEST_STORAGE_S3_ENDPOINT ?? "http://minio:9000";
const region = process.env.QKERN_TEST_STORAGE_S3_REGION ?? "us-east-1";
const providerBucket = process.env.QKERN_TEST_STORAGE_S3_BUCKET ?? "qkern-storage-certification";
const accessKeyId = process.env.QKERN_TEST_STORAGE_S3_ACCESS_KEY_ID ?? "qkern_cert_access";
const secretAccessKey = process.env.QKERN_TEST_STORAGE_S3_SECRET_ACCESS_KEY ??
  "qkern_cert_secret_change_me_32bytes";
const clamAvHost = process.env.QKERN_TEST_STORAGE_CLAMAV_HOST ?? "clamav";
const clamAvPort = Number(process.env.QKERN_TEST_STORAGE_CLAMAV_PORT ?? "3310");

const scope: ProjectStorageScope = {
  organizationId: "00000000-0000-4000-8000-000000000501",
  projectId: "00000000-0000-4000-8000-000000000502",
  environment: "development",
};
const admin: ProjectStoragePrincipal = {
  organizationId: scope.organizationId,
  actorRef: "s3-endpoint-certification",
  role: "admin",
  subject: "00000000-0000-4000-8000-000000000503",
};
const QKERN = "http://qkern.certification.test";

describe.runIf(enabled)("real versitygw and ClamAV: the S3 endpoint", () => {
  it("(S3) lets a valid pair write, list and read through SigV4, and refuses a revoked pair, a wrong signature, a foreign bucket and EICAR", async () => {
    const { s3, keys, storage, issued, other } = await certificationRuntime();
    const payload = Buffer.from(`QKERN S3 endpoint certification ${Date.now()}`, "utf8");

    // --- gueltiges Paar schreibt: echter Provider, echter Scan ------------
    const put = await s3.handle(sign(issued, "PUT", "/s3/cert-s3/reports/2026/summary.txt", {
      body: payload, headers: { "content-type": "text/plain" },
    }));
    expect(put.status, await put.clone().text()).toBe(200);
    // `clean`, nicht `quarantined`: ClamAV hat die Bytes wirklich gesehen.
    expect(put.headers.get("x-qkern-object-status")).toBe("clean");
    const stored = await storage.listObjects(admin, scope, "cert-s3", {});
    expect(stored.objects.map((object) => [object.key, object.status])).toEqual([["reports/2026/summary.txt", "clean"]]);
    // Der Beleg, dass die Bytes beim echten Provider liegen, ist die Zusage des
    // Dienstes, eingeloest gegen versitygw: dieselben Bytes, derselbe Hash.
    const grant = await storage.createDownloadGrant(admin, scope, "cert-s3", { key: "reports/2026/summary.txt" });
    const served = await fetch(grant.url, { redirect: "error" });
    expect(served.status).toBe(200);
    expect(sha256Base64(Buffer.from(await served.arrayBuffer()))).toBe(sha256Base64(payload));

    // --- gueltiges Paar listet und liest ------------------------------------
    const list = await s3.handle(sign(issued, "GET", "/s3/cert-s3?list-type=2&prefix=reports%2F"));
    expect(list.status).toBe(200);
    const listXml = await list.text();
    expect(listXml).toContain("<Key>reports/2026/summary.txt</Key>");
    expect(listXml).toContain(`<Size>${payload.byteLength}</Size>`);
    const get = await s3.handle(sign(issued, "GET", "/s3/cert-s3/reports/2026/summary.txt"));
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("text/plain");
    expect(Buffer.from(await get.arrayBuffer())).toEqual(payload);
    const head = await s3.handle(sign(issued, "HEAD", "/s3/cert-s3/reports/2026/summary.txt"));
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(payload.byteLength));

    // --- falsche Signatur: richtiges Paar, falsches Geheimnis --------------
    const forged = await s3.handle(sign(issued, "GET", "/s3/cert-s3/reports/2026/summary.txt", {
      secret: issued.secret.slice(0, -1) + (issued.secret.endsWith("A") ? "B" : "A"),
    }));
    expect(forged.status).toBe(403);
    expect(await forged.text()).toContain("<Code>SignatureDoesNotMatch</Code>");
    // Und eine Signatur, die nur einen anderen Pfad meint.
    const replayed = sign(issued, "GET", "/s3/cert-s3/reports/2026/summary.txt");
    const moved = new Request(`${QKERN}/s3/cert-s3/reports/2026/other.txt`, { method: "GET", headers: replayed.headers });
    const movedResponse = await s3.handle(moved);
    expect(movedResponse.status).toBe(403);
    expect(await movedResponse.text()).toContain("<Code>SignatureDoesNotMatch</Code>");

    // --- fremder Bucket: existiert, ist der Service-Rolle sichtbar, aber nicht im Satz
    const foreign = await s3.handle(sign(issued, "GET", "/s3/cert-s3-other/anything.txt"));
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).toContain("<Code>NoSuchBucket</Code>");
    const foreignPut = await s3.handle(sign(issued, "PUT", "/s3/cert-s3-other/anything.txt", {
      body: payload, headers: { "content-type": "text/plain" },
    }));
    expect(foreignPut.status).toBe(404);
    expect((await storage.listObjects(admin, scope, other.id, {})).objects).toEqual([]);
    // Das Paar des anderen Buckets liest den ersten nicht.
    const otherPair = await keys.create(admin, scope, {
      name: "Anderes Werkzeug", bucketIds: [other.id],
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const crossed = await s3.handle(sign(otherPair, "GET", "/s3/cert-s3/reports/2026/summary.txt"));
    expect(crossed.status).toBe(404);

    // --- EICAR durch den Endpunkt: abgewiesen, und beim Provider liegt nichts
    const eicar = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*", "ascii");
    const infected = await s3.handle(sign(issued, "PUT", "/s3/cert-s3/reports/eicar.txt", {
      body: eicar, headers: { "content-type": "text/plain" },
    }));
    expect(infected.status).toBe(422);
    expect(await infected.text()).toContain("<Code>QkernObjectRejected</Code>");
    expect((await storage.listObjects(admin, scope, "cert-s3", {})).objects.map((object) => object.key))
      .toEqual(["reports/2026/summary.txt"]);
    const eicarGet = await s3.handle(sign(issued, "GET", "/s3/cert-s3/reports/eicar.txt"));
    expect(eicarGet.status).toBe(404);

    // --- widerrufenes Paar: sofort, mit derselben Antwort wie ein unbekanntes
    await keys.revoke(admin, scope, issued.key.id);
    const revoked = await s3.handle(sign(issued, "GET", "/s3/cert-s3/reports/2026/summary.txt"));
    expect(revoked.status).toBe(403);
    expect(await revoked.text()).toContain("<Code>InvalidAccessKeyId</Code>");
    const revokedPut = await s3.handle(sign(issued, "PUT", "/s3/cert-s3/reports/after-revoke.txt", {
      body: payload, headers: { "content-type": "text/plain" },
    }));
    expect(revokedPut.status).toBe(403);
    expect((await storage.listObjects(admin, scope, "cert-s3", {})).objects).toHaveLength(1);
  }, 180_000);
});

type Issued = Awaited<ReturnType<ProjectStorageS3AccessKeyService["create"]>>;

/** Rechnet die Signatur wie ein S3-Client: HMAC-Kette aus dem Geheimnis, Header-Signatur. */
function sign(issued: Issued, method: string, path: string, options: {
  body?: Buffer; headers?: Record<string, string>; secret?: string;
} = {}): Request {
  const url = new URL(`${QKERN}${path}`);
  const body = options.body;
  const headers = signSigV4Request({
    method, url,
    payloadHash: sha256Hex(body ?? ""),
    headers: { ...(body ? { "content-length": String(body.byteLength) } : {}), ...(options.headers ?? {}) },
    accessKeyId: issued.key.accessKeyId,
    secret: options.secret ?? issued.secret,
    region: "us-east-1",
    now: new Date(),
  });
  return new Request(url, { method, headers, body: body ? new Uint8Array(body) : undefined });
}

async function certificationRuntime() {
  await waitForProviderBucket();
  const credentials = new StaticS3ProjectStorageCredentialsProvider({ accessKeyId, secretAccessKey });
  const provider = new S3ProjectStorageProvider({
    endpoint, region, bucket: providerBucket, production: false, timeoutMs: 10_000,
  }, credentials);
  const client = new ClamdInstreamClient({
    host: clamAvHost, port: clamAvPort, connectTimeoutMs: 3_000, scanTimeoutMs: 30_000,
    maxObjectBytes: 25 * 1024 * 1024,
  });
  await waitForClamAv(client);
  const scanner = new ClamAvProjectStorageScanner(provider, client, {
    downloadTimeoutMs: 30_000, maxObjectBytes: 25 * 1024 * 1024,
  });
  const repository = new MemoryProjectStorageRepository();
  const storage = new ProjectStorageService({ repository, provider, scanner, grantTtlSeconds: 60 });
  const keys = new ProjectStorageS3AccessKeyService({
    store: new MemoryProjectStorageS3AccessKeyStore(),
    buckets: repository,
    protector: new ProjectStorageS3SecretProtector(randomBytes(32)),
  });
  const bucket = await storage.createBucket(admin, scope, {
    name: "cert-s3", readPolicy: "service", writePolicy: "service",
    allowedMimeTypes: ["text/plain"], maxObjectBytes: 1024 * 1024, quotaBytes: 4 * 1024 * 1024,
  });
  const other = await storage.createBucket(admin, scope, {
    name: "cert-s3-other", readPolicy: "service", writePolicy: "service",
    allowedMimeTypes: ["text/plain"], maxObjectBytes: 1024 * 1024, quotaBytes: 4 * 1024 * 1024,
  });
  const issued = await keys.create(admin, scope, {
    name: "Zertifizierung", bucketIds: [bucket.id],
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  expect(issued.key.verifiable).toBe(true);
  const s3 = new ProjectStorageS3Endpoint({ storage, keys });
  return { s3, keys, storage, issued, bucket, other };
}

async function waitForProviderBucket() {
  const deadline = Date.now() + 90_000;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    try {
      const response = await createProviderBucket();
      lastStatus = response.status;
      if (response.ok || response.status === 409) return;
    } catch { lastStatus = 0; }
    await delay(1_000);
  }
  throw new Error(`versitygw did not become ready; last status ${lastStatus}.`);
}

async function waitForClamAv(client: ClamdInstreamClient) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await client.scan(singleChunk(Buffer.from("qkern scanner ready", "utf8"))) === "clean") return;
    await delay(1_000);
  }
  throw new Error("ClamAV did not become ready.");
}

/** Der Provider-Bucket, mit dem Wurzelkonto des Stacks angelegt; derselbe Signierer wie der Fall selbst. */
async function createProviderBucket() {
  const url = new URL(endpoint);
  url.pathname = `/${providerBucket}`;
  const headers = signSigV4Request({
    method: "PUT", url, payloadHash: sha256Hex(""), accessKeyId, secret: secretAccessKey, region, now: new Date(),
  });
  return await fetch(url, { method: "PUT", redirect: "error", headers });
}

async function* singleChunk(value: Uint8Array) { yield value; }
function delay(milliseconds: number) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function sha256Base64(value: Uint8Array) { return createHash("sha256").update(value).digest("base64"); }
