import { createHash, createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ClamAvProjectStorageScanner,
  ClamdInstreamClient,
} from "@/lib/server/project-storage/clamav-scanner";
import type { ProjectStoragePrincipal, ProjectStorageScope } from "@/lib/server/project-storage/model";
import {
  ProjectStorageProviderError,
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

  /**
   * Fortsetzbarer Upload in Teilen — Sprosse 3 der Paritaetsleiter.
   *
   * Die Kette laeuft ueber den echten Provider: beginnen, zwei Teile ueber
   * signierte URLs hochladen, abschliessen. Die Integritaet traegt der
   * Provider je Teil — ein Teil mit fremden Bytes wird **abgewiesen**, weil
   * seine Pruefsumme in der URL-Signatur steckt. Genau diese Abweisung nimmt
   * die Mutationsprobe dieses Releases wieder heraus.
   */
  it("uploads an object in two resumable parts and rejects a tampered part", async () => {
    const { provider } = await certificationRuntime();
    const key = `${scope.organizationId}/${scope.projectId}/development/resumable-${Date.now()}.bin`;
    // Alle Teile ausser dem letzten muessen bei S3 mindestens 5 MiB tragen.
    const partOne = randomBytes(5 * 1024 * 1024);
    const partTwo = randomBytes(64 * 1024);
    const expiresAt = new Date(Date.now() + 60_000);

    const { uploadId } = await provider.createMultipartUpload({
      providerKey: key, contentType: "application/octet-stream",
    });

    const grantOne = await provider.createPartUploadGrant({
      providerKey: key, uploadId, partNumber: 1, checksumSha256: sha256Base64(partOne), expiresAt,
    });
    const putOne = await fetch(grantOne.url, {
      method: "PUT", headers: grantOne.headers, body: partOne, redirect: "error",
    });
    expect(putOne.status, await putOne.clone().text()).toBe(200);
    const etagOne = putOne.headers.get("etag")!;

    const grantTwo = await provider.createPartUploadGrant({
      providerKey: key, uploadId, partNumber: 2, checksumSha256: sha256Base64(partTwo), expiresAt,
    });
    // Fremde Bytes unter der Signatur des zweiten Teils: Der Provider rechnet
    // die Pruefsumme selbst nach und weist ab.
    const tampered = Buffer.from(partTwo);
    tampered[0] = tampered[0] ^ 0xff;
    const putTampered = await fetch(grantTwo.url, {
      method: "PUT", headers: grantTwo.headers, body: tampered, redirect: "error",
    });
    expect(putTampered.ok, "Der Provider hat manipulierte Bytes angenommen").toBe(false);

    // Und ohne den Pruefsummen-Header geht es gar nicht: Die Signatur macht
    // ihn verpflichtend. Eine erste Mutationsprobe hat gezeigt, dass die
    // Abweisung manipulierter Bytes schon der mitgesendete Header traegt —
    // die Signatur traegt genau diese Zeile: Weglassen ist keine Option.
    const putWithoutChecksum = await fetch(grantTwo.url, {
      method: "PUT", body: tampered, redirect: "error",
    });
    expect(putWithoutChecksum.ok, "Der Provider akzeptiert Teile ohne Pruefsumme").toBe(false);

    const putTwo = await fetch(grantTwo.url, {
      method: "PUT", headers: grantTwo.headers, body: partTwo, redirect: "error",
    });
    expect(putTwo.status, await putTwo.clone().text()).toBe(200);
    const etagTwo = putTwo.headers.get("etag")!;

    await provider.completeMultipartUpload({
      providerKey: key, uploadId,
      parts: [{ partNumber: 1, etag: etagOne }, { partNumber: 2, etag: etagTwo }],
    });

    // Die Wirkung: ein Objekt mit der Groesse beider Teile, dessen Bytes beim
    // Herunterladen exakt die hochgeladenen sind.
    const download = await provider.createDownloadGrant({ providerKey: key, expiresAt });
    const response = await fetch(download.url, { redirect: "error" });
    expect(response.status).toBe(200);
    const downloaded = Buffer.from(await response.arrayBuffer());
    expect(downloaded.byteLength).toBe(partOne.byteLength + partTwo.byteLength);
    expect(sha256Base64(downloaded)).toBe(sha256Base64(Buffer.concat([partOne, partTwo])));
    await provider.deleteObject(key);
  }, 120_000);

  it("aborts a resumable upload and leaves nothing behind", async () => {
    const { provider } = await certificationRuntime();
    const key = `${scope.organizationId}/${scope.projectId}/development/aborted-${Date.now()}.bin`;
    const part = randomBytes(64 * 1024);
    const expiresAt = new Date(Date.now() + 60_000);

    const { uploadId } = await provider.createMultipartUpload({
      providerKey: key, contentType: "application/octet-stream",
    });
    const grant = await provider.createPartUploadGrant({
      providerKey: key, uploadId, partNumber: 1, checksumSha256: sha256Base64(part), expiresAt,
    });
    const put = await fetch(grant.url, {
      method: "PUT", headers: grant.headers, body: part, redirect: "error",
    });
    expect(put.status).toBe(200);
    const etag = put.headers.get("etag")!;

    await provider.abortMultipartUpload({ providerKey: key, uploadId });

    // Kein Objekt, und der Abschluss eines abgebrochenen Uploads scheitert:
    // Ein Teil ohne seinen Upload ist keine halbe Datei, sondern nichts.
    await expect(provider.headObject(key)).resolves.toBeNull();
    await expect(provider.completeMultipartUpload({
      providerKey: key, uploadId, parts: [{ partNumber: 1, etag }],
    })).rejects.toBeInstanceOf(ProjectStorageProviderError);
  }, 120_000);

  /**
   * Der ganze Dienstweg — Sprosse 3, zweite Haelfte.
   *
   * prepare, Teil-Grants, Teile hochladen, complete: Der ClamAV-Scanner laedt
   * das fertige Objekt, prueft es auf Schadcode und rechnet dabei die
   * **Ganzdatei**-Pruefsumme nach. Nur dieser Abgleich macht ein
   * Multipart-Objekt sauber — der Provider prueft je Teil, niemand sonst die
   * ganze Datei.
   */
  it("serves a resumable upload through the full service path", async () => {
    const { service } = await certificationRuntime();
    const bucket = await service.createBucket(principal, scope, {
      name: `cert-multipart-${Date.now()}`,
      allowedMimeTypes: ["application/octet-stream"],
      maxObjectBytes: 16 * 1024 * 1024,
      quotaBytes: 32 * 1024 * 1024,
    });
    const partOne = randomBytes(5 * 1024 * 1024);
    const partTwo = randomBytes(128 * 1024);
    const whole = Buffer.concat([partOne, partTwo]);

    const prepared = await service.prepareMultipartUpload(principal, scope, bucket.id, {
      key: "resumable.bin", contentType: "application/octet-stream",
      sizeBytes: whole.byteLength, checksumSha256: sha256Base64(whole),
    });
    const etags: Array<{ partNumber: number; etag: string }> = [];
    for (const [partNumber, bytes] of [[1, partOne], [2, partTwo]] as const) {
      const grant = await service.createPartUploadGrant(principal, scope, {
        uploadId: prepared.uploadId, completionToken: prepared.completionToken,
        partNumber, checksumSha256: sha256Base64(bytes),
      });
      const response = await fetch(grant.url, {
        method: "PUT", headers: grant.headers, body: bytes, redirect: "error",
      });
      expect(response.status, await response.clone().text()).toBe(200);
      etags.push({ partNumber, etag: response.headers.get("etag")! });
    }
    const object = await service.completeMultipartUpload(principal, scope, {
      uploadId: prepared.uploadId, completionToken: prepared.completionToken, parts: etags,
    });
    // clean, nicht quarantined: Der echte Scanner hat Bytes und Pruefsumme
    // wirklich gesehen.
    expect(object.status).toBe("clean");

    const download = await service.createDownloadGrant(principal, scope, bucket.id, { key: "resumable.bin" });
    const served = await fetch(download.url, { redirect: "error" });
    expect(served.status).toBe(200);
    expect(sha256Base64(Buffer.from(await served.arrayBuffer()))).toBe(sha256Base64(whole));
  }, 180_000);

  /**
   * Eine gelogene Ganzdatei-Pruefsumme macht kein sauberes Objekt.
   *
   * Jeder Teil ist korrekt geprueft hochgeladen — nur die deklarierte Summe
   * der ganzen Datei gehoert zu anderen Bytes. Der Scanner rechnet nach und
   * verweigert das Urteil; das Objekt bleibt in Quarantaene. Die
   * Mutationsprobe dieses Releases nimmt genau diesen Abgleich heraus.
   */
  it("keeps a multipart object quarantined when the declared checksum lies", async () => {
    const { service } = await certificationRuntime();
    const bucket = await service.createBucket(principal, scope, {
      name: `cert-mp-lie-${Date.now()}`,
      allowedMimeTypes: ["application/octet-stream"],
      maxObjectBytes: 16 * 1024 * 1024,
      quotaBytes: 32 * 1024 * 1024,
    });
    const bytes = randomBytes(256 * 1024);
    const prepared = await service.prepareMultipartUpload(principal, scope, bucket.id, {
      key: "liar.bin", contentType: "application/octet-stream",
      sizeBytes: bytes.byteLength,
      checksumSha256: sha256Base64(Buffer.from("andere bytes", "utf8")),
    });
    const grant = await service.createPartUploadGrant(principal, scope, {
      uploadId: prepared.uploadId, completionToken: prepared.completionToken,
      partNumber: 1, checksumSha256: sha256Base64(bytes),
    });
    const response = await fetch(grant.url, {
      method: "PUT", headers: grant.headers, body: bytes, redirect: "error",
    });
    expect(response.status).toBe(200);
    const object = await service.completeMultipartUpload(principal, scope, {
      uploadId: prepared.uploadId, completionToken: prepared.completionToken,
      parts: [{ partNumber: 1, etag: response.headers.get("etag")! }],
    });
    expect(object.status).toBe("quarantined");
  }, 180_000);
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
