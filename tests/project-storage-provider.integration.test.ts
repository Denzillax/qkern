import { createHash, createHmac } from "node:crypto";
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
import { ProjectStorageError, ProjectStorageService } from "@/lib/server/project-storage/service";

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
  organizationId: "00000000-0000-4000-8000-000000000201",
  projectId: "00000000-0000-4000-8000-000000000202",
  environment: "development",
};
const principal: ProjectStoragePrincipal = {
  organizationId: scope.organizationId,
  actorRef: "storage-certification",
  role: "admin",
  subject: "00000000-0000-4000-8000-000000000203",
};

describe.runIf(enabled)("real MinIO and ClamAV Project Storage certification", () => {
  it("uploads, HEAD-verifies, scans and downloads a clean object", async () => {
    const { provider, service } = await certificationRuntime();
    const bucket = await service.createBucket(principal, scope, {
      name: "cert-clean",
      allowedMimeTypes: ["text/plain"],
      maxObjectBytes: 1024 * 1024,
      quotaBytes: 4 * 1024 * 1024,
    });
    const payload = Buffer.from(`QKERN clean storage certification ${Date.now()}`, "utf8");
    const prepared = await service.prepareUpload(principal, scope, bucket.id, {
      key: "clean.txt",
      contentType: "text/plain",
      sizeBytes: payload.byteLength,
      checksumSha256: sha256Base64(payload),
    });

    await uploadForm(prepared.upload.url, prepared.upload.fields, payload, "clean.txt", "text/plain");
    const object = await service.completeUpload(principal, scope, {
      uploadId: prepared.uploadId,
      completionToken: prepared.completionToken,
    });
    expect(object.status).toBe("clean");

    const download = await service.createDownloadGrant(principal, scope, bucket.id, { key: "clean.txt" });
    const response = await fetch(download.url, { redirect: "error" });
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(payload);
    expect(await provider.headObject(prepared.upload.fields.key)).toMatchObject({
      sizeBytes: payload.byteLength,
      checksumSha256: sha256Base64(payload),
    });
  }, 120_000);

  it("detects the EICAR test signature and deletes the infected provider object", async () => {
    const { provider, service } = await certificationRuntime();
    const bucket = await service.createBucket(principal, scope, {
      name: "cert-infected",
      allowedMimeTypes: ["text/plain"],
      maxObjectBytes: 1024 * 1024,
      quotaBytes: 4 * 1024 * 1024,
    });
    const payload = Buffer.from(
      "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
      "ascii",
    );
    const prepared = await service.prepareUpload(principal, scope, bucket.id, {
      key: "eicar.txt",
      contentType: "text/plain",
      sizeBytes: payload.byteLength,
      checksumSha256: sha256Base64(payload),
    });
    await uploadForm(prepared.upload.url, prepared.upload.fields, payload, "eicar.txt", "text/plain");

    await expect(service.completeUpload(principal, scope, {
      uploadId: prepared.uploadId,
      completionToken: prepared.completionToken,
    })).rejects.toMatchObject({ code: "STORAGE_OBJECT_INFECTED" } satisfies Partial<ProjectStorageError>);
    await expect(provider.headObject(prepared.upload.fields.key)).resolves.toBeNull();
  }, 120_000);
});

async function certificationRuntime() {
  await waitForProviderBucket();
  const credentials = new StaticS3ProjectStorageCredentialsProvider({ accessKeyId, secretAccessKey });
  const provider = new S3ProjectStorageProvider({
    endpoint,
    region,
    bucket: providerBucket,
    production: false,
    timeoutMs: 10_000,
  }, credentials);
  const client = new ClamdInstreamClient({
    host: clamAvHost,
    port: clamAvPort,
    connectTimeoutMs: 3_000,
    scanTimeoutMs: 30_000,
    maxObjectBytes: 25 * 1024 * 1024,
  });
  await waitForClamAv(client);
  const scanner = new ClamAvProjectStorageScanner(
    provider,
    client,
    { downloadTimeoutMs: 30_000, maxObjectBytes: 25 * 1024 * 1024 },
  );
  return {
    provider,
    service: new ProjectStorageService({
      repository: new MemoryProjectStorageRepository(),
      provider,
      scanner,
      grantTtlSeconds: 60,
    }),
  };
}

async function uploadForm(
  url: string,
  fields: Record<string, string>,
  payload: Uint8Array,
  filename: string,
  contentType: string,
) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  const blobBytes = new Uint8Array(new ArrayBuffer(payload.byteLength));
  blobBytes.set(payload);
  form.append("file", new Blob([blobBytes.buffer], { type: contentType }), filename);
  const response = await fetch(url, { method: "POST", body: form, redirect: "error" });
  if (!response.ok) throw new Error(`S3 upload failed with status ${response.status}.`);
}

async function waitForProviderBucket() {
  const deadline = Date.now() + 90_000;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    try {
      const response = await createProviderBucket();
      lastStatus = response.status;
      if (response.ok || response.status === 409) return;
    } catch {
      lastStatus = 0;
    }
    await delay(1_000);
  }
  throw new Error(`MinIO did not become ready; last status ${lastStatus}.`);
}

async function waitForClamAv(client: ClamdInstreamClient) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await client.scan(singleChunk(Buffer.from("qkern scanner ready", "utf8"))) === "clean") return;
    await delay(1_000);
  }
  throw new Error("ClamAV did not become ready.");
}

async function createProviderBucket() {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const scopeValue = `${day}/${region}/s3/aws4_request`;
  const url = new URL(endpoint);
  url.pathname = `/${providerBucket}`;
  const payloadHash = sha256Hex("");
  const canonicalHeaders = `host:${url.host.toLowerCase()}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = ["PUT", url.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scopeValue, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(secretAccessKey, day, region))
    .update(stringToSign, "utf8").digest("hex");
  return await fetch(url, { method: "PUT", redirect: "error", headers: {
    host: url.host.toLowerCase(),
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scopeValue}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  } });
}

function signingKey(secret: string, day: string, targetRegion: string) {
  const dateKey = createHmac("sha256", `AWS4${secret}`).update(day).digest();
  const regionKey = createHmac("sha256", dateKey).update(targetRegion).digest();
  const serviceKey = createHmac("sha256", regionKey).update("s3").digest();
  return createHmac("sha256", serviceKey).update("aws4_request").digest();
}

async function* singleChunk(value: Uint8Array) { yield value; }
function delay(milliseconds: number) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function sha256Hex(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function sha256Base64(value: Uint8Array) { return createHash("sha256").update(value).digest("base64"); }
