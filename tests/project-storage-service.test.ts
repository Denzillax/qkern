import { describe, expect, it } from "vitest";
import type { ProjectStoragePrincipal, ProjectStorageScope } from "@/lib/server/project-storage/model";
import {
  MemoryProjectStorageProvider,
  type ProjectStorageProviderObject,
  type ProjectStorageScanVerdict,
  type ProjectStorageScanner,
} from "@/lib/server/project-storage/provider";
import { MemoryProjectStorageRepository } from "@/lib/server/project-storage/repository";
import { ProjectStorageError, ProjectStorageService } from "@/lib/server/project-storage/service";

const checksum = Buffer.alloc(32, 7).toString("base64");
const scope: ProjectStorageScope = {
  organizationId: "org-storage", projectId: "prj-storage", environment: "development",
};
const admin: ProjectStoragePrincipal = {
  organizationId: scope.organizationId, actorRef: "owner@example.test", role: "admin", subject: "operator-1",
};

class MutableScanner implements ProjectStorageScanner {
  verdict: ProjectStorageScanVerdict = "pending";
  async scan() { return this.verdict; }
}

class BlockingScanner implements ProjectStorageScanner {
  private startedResolve!: () => void;
  private verdictResolve!: (verdict: ProjectStorageScanVerdict) => void;
  readonly started = new Promise<void>((resolve) => { this.startedResolve = resolve; });
  private readonly result = new Promise<ProjectStorageScanVerdict>((resolve) => { this.verdictResolve = resolve; });

  async scan() {
    this.startedResolve();
    return await this.result;
  }

  release(verdict: ProjectStorageScanVerdict) { this.verdictResolve(verdict); }
}

function fixture() { return fixtureWithScanner(new MutableScanner()); }

function fixtureWithScanner<T extends ProjectStorageScanner>(scanner: T) {
  let current = new Date("2026-08-03T12:00:00.000Z");
  let id = 0;
  let token = 0;
  const repository = new MemoryProjectStorageRepository();
  const provider = new MemoryProjectStorageProvider("https://objects.qkern.test", () => current);
  const service = new ProjectStorageService({
    repository, provider, scanner, now: () => new Date(current),
    id: () => `storage-${++id}`,
    completionToken: () => `qk_upload_${String(++token).padStart(43, "A")}`,
  });
  return {
    repository, provider, scanner, service,
    advance(milliseconds: number) { current = new Date(current.getTime() + milliseconds); },
  };
}

function app(subject: string, role: "authenticated" | "anon" | "service_role" = "authenticated"): ProjectStoragePrincipal {
  return { organizationId: scope.organizationId, actorRef: `app:${subject}`, role, subject };
}

async function stageProviderObject(
  service: ProjectStorageService,
  provider: MemoryProjectStorageProvider,
  principal: ProjectStoragePrincipal,
  bucket: string,
  key: string,
  sizeBytes = 12,
  override: Partial<ProjectStorageProviderObject> = {},
) {
  const prepared = await service.prepareUpload(principal, scope, bucket, {
    key, contentType: "image/png", sizeBytes, checksumSha256: checksum,
  });
  provider.putForTest(prepared.upload.fields.key, {
    sizeBytes, contentType: "image/png", checksumSha256: checksum, etag: "etag-1", ...override,
  });
  return prepared;
}

describe("Project Storage service", () => {
  it("creates private buckets by default and never exposes organization/provider/checksum fields", async () => {
    const { service } = fixture();
    const bucket = await service.createBucket(admin, scope, { name: "private-assets" });
    expect(bucket).toMatchObject({ readPolicy: "private", writePolicy: "private", usedBytes: 0, reservedBytes: 0 });
    expect(bucket).not.toHaveProperty("organizationId");
    expect(await service.listBuckets(app("anon", "anon"), scope)).toEqual([]);
  });

  it("reserves quota atomically and releases it after an expired grant", async () => {
    const { service, advance } = fixture();
    const bucket = await service.createBucket(admin, scope, {
      name: "quota-assets", writePolicy: "authenticated", maxObjectBytes: 10, quotaBytes: 10,
    });
    const concurrent = await Promise.allSettled([
      service.prepareUpload(app("alice"), scope, bucket.id, {
        key: "first.png", contentType: "image/png", sizeBytes: 10, checksumSha256: checksum,
      }),
      service.prepareUpload(app("bob"), scope, bucket.id, {
        key: "second.png", contentType: "image/png", sizeBytes: 1, checksumSha256: checksum,
      }),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")[0]).toMatchObject({
      reason: { code: "STORAGE_QUOTA_EXCEEDED" },
    });
    advance(301_000);
    await expect(service.prepareUpload(app("bob"), scope, bucket.id, {
      key: "after-expiry.png", contentType: "image/png", sizeBytes: 1, checksumSha256: checksum,
    })).resolves.toMatchObject({ key: "after-expiry.png" });
  });

  it("commits concurrent completion replays once and returns the same object", async () => {
    const { service, provider, scanner } = fixture();
    scanner.verdict = "clean";
    const bucket = await service.createBucket(admin, scope, {
      name: "completion-race", writePolicy: "authenticated", maxObjectBytes: 100, quotaBytes: 100,
    });
    const prepared = await stageProviderObject(service, provider, app("alice"), bucket.id, "race.png", 12);
    const [first, second] = await Promise.all([
      service.completeUpload(app("alice"), scope, {
        uploadId: prepared.uploadId, completionToken: prepared.completionToken,
      }),
      service.completeUpload(app("alice"), scope, {
        uploadId: prepared.uploadId, completionToken: prepared.completionToken,
      }),
    ]);
    expect(second.id).toBe(first.id);
    expect((await service.listBuckets(admin, scope))[0]).toMatchObject({ usedBytes: 12, reservedBytes: 0 });
    expect((await service.listObjects(admin, scope, bucket.id, {})).objects).toHaveLength(1);
  });

  it("removes an orphaned provider object when expiry wins a slow completion race", async () => {
    const scanner = new BlockingScanner();
    const { service, provider, advance } = fixtureWithScanner(scanner);
    const bucket = await service.createBucket(admin, scope, {
      name: "expiry-race", writePolicy: "authenticated", maxObjectBytes: 12, quotaBytes: 12,
    });
    const prepared = await stageProviderObject(service, provider, app("alice"), bucket.id, "slow.png", 12);
    const completion = service.completeUpload(app("alice"), scope, {
      uploadId: prepared.uploadId, completionToken: prepared.completionToken,
    });
    await scanner.started;
    advance(301_000);
    await service.prepareUpload(app("bob"), scope, bucket.id, {
      key: "replacement.png", contentType: "image/png", sizeBytes: 1, checksumSha256: checksum,
    });
    scanner.release("clean");

    await expect(completion).rejects.toMatchObject({ code: "STORAGE_CONFLICT" });
    expect(await provider.headObject(prepared.upload.fields.key)).toBeNull();
    expect((await service.listBuckets(admin, scope))[0]).toMatchObject({ usedBytes: 0, reservedBytes: 1 });
  });

  it("deletes a provider object and releases its reservation when HEAD metadata is altered", async () => {
    const { service, provider } = fixture();
    const bucket = await service.createBucket(admin, scope, {
      name: "verified-assets", writePolicy: "authenticated", maxObjectBytes: 100, quotaBytes: 100,
    });
    const prepared = await stageProviderObject(service, provider, app("alice"), bucket.id, "altered.png", 12, {
      sizeBytes: 13,
    });
    await expect(service.completeUpload(app("alice"), scope, {
      uploadId: prepared.uploadId, completionToken: prepared.completionToken,
    })).rejects.toMatchObject({ code: "STORAGE_INVALID_INPUT" });
    expect(await provider.headObject(prepared.upload.fields.key)).toBeNull();
    expect((await service.listBuckets(admin, scope))[0]).toMatchObject({ usedBytes: 0, reservedBytes: 0 });
  });

  it("quarantines by default, blocks downloads, then permits a short signed GET after a clean rescan", async () => {
    const { service, provider, scanner } = fixture();
    const bucket = await service.createBucket(admin, scope, {
      name: "scan-assets", readPolicy: "authenticated", writePolicy: "authenticated",
    });
    const alice = app("alice");
    const prepared = await stageProviderObject(service, provider, alice, bucket.id, "safe.png");
    const object = await service.completeUpload(alice, scope, {
      uploadId: prepared.uploadId, completionToken: prepared.completionToken,
    });
    expect(object.status).toBe("quarantined");
    expect(object).not.toHaveProperty("providerKey");
    expect(object).not.toHaveProperty("checksumSha256");
    await expect(service.createDownloadGrant(alice, scope, bucket.id, { key: "safe.png" }))
      .rejects.toMatchObject({ code: "STORAGE_OBJECT_NOT_READY" });
    scanner.verdict = "clean";
    expect((await service.scanObject(admin, scope, object.id)).status).toBe("clean");
    const download = await service.createDownloadGrant(alice, scope, bucket.id, {
      key: "safe.png", expiresInSeconds: 900, downloadName: "safe.png",
    });
    expect(download.method).toBe("GET");
    expect(new Date(download.expiresAt).getTime() - new Date("2026-08-03T12:00:00.000Z").getTime()).toBe(900_000);
  });

  it("enforces owner isolation for list, download and delete", async () => {
    const { service, provider, scanner } = fixture();
    scanner.verdict = "clean";
    const bucket = await service.createBucket(admin, scope, {
      name: "owner-assets", readPolicy: "owner", writePolicy: "owner",
    });
    const prepared = await stageProviderObject(service, provider, app("alice"), bucket.id, "alice.png");
    await service.completeUpload(app("alice"), scope, {
      uploadId: prepared.uploadId, completionToken: prepared.completionToken,
    });
    expect((await service.listObjects(app("alice"), scope, bucket.id, {})).objects).toHaveLength(1);
    expect((await service.listObjects(app("bob"), scope, bucket.id, {})).objects).toHaveLength(0);
    await expect(service.createDownloadGrant(app("bob"), scope, bucket.id, { key: "alice.png" }))
      .rejects.toMatchObject({ code: "STORAGE_RESOURCE_NOT_FOUND" });
    await expect(service.deleteObject(app("bob"), scope, bucket.id, "alice.png"))
      .rejects.toMatchObject({ code: "STORAGE_RESOURCE_NOT_FOUND" });
  });

  it("removes scanner-rejected objects and releases used quota exactly once", async () => {
    const { service, provider, scanner } = fixture();
    const bucket = await service.createBucket(admin, scope, {
      name: "infected-assets", readPolicy: "authenticated", writePolicy: "authenticated",
      maxObjectBytes: 100, quotaBytes: 100,
    });
    const prepared = await stageProviderObject(service, provider, app("alice"), bucket.id, "unknown.png");
    const object = await service.completeUpload(app("alice"), scope, {
      uploadId: prepared.uploadId, completionToken: prepared.completionToken,
    });
    expect((await service.listBuckets(admin, scope))[0].usedBytes).toBe(12);
    scanner.verdict = "infected";
    const rejected = await service.scanObject(admin, scope, object.id);
    expect(rejected.status).toBe("infected");
    expect((await service.listBuckets(admin, scope))[0].usedBytes).toBe(0);
    await expect(service.scanObject(admin, scope, object.id)).rejects.toMatchObject({ code: "STORAGE_RESOURCE_NOT_FOUND" });
  });

  it("expires a bounded retention batch only after provider deletion succeeds", async () => {
    const { service, provider, scanner, advance } = fixture();
    scanner.verdict = "clean";
    const bucket = await service.createBucket(admin, scope, {
      name: "retained-assets", readPolicy: "authenticated", writePolicy: "authenticated", retentionDays: 1,
    });
    const prepared = await stageProviderObject(service, provider, app("alice"), bucket.id, "old.png");
    await service.completeUpload(app("alice"), scope, {
      uploadId: prepared.uploadId, completionToken: prepared.completionToken,
    });
    advance(2 * 24 * 60 * 60 * 1_000);
    expect(await service.expireLifecycle(admin, scope, 1)).toEqual({
      examined: 1, deleted: 1, expiredUploads: 0, orphanedUploadsAborted: 0,
    });
    expect((await service.listBuckets(admin, scope))[0].usedBytes).toBe(0);
  });

  it("releases usage once when explicit delete and lifecycle expiration race", async () => {
    const { service, provider, scanner, advance } = fixture();
    scanner.verdict = "clean";
    const bucket = await service.createBucket(admin, scope, {
      name: "delete-race", readPolicy: "authenticated", writePolicy: "authenticated",
      retentionDays: 1, maxObjectBytes: 100, quotaBytes: 100,
    });
    const alice = app("alice");
    const prepared = await stageProviderObject(service, provider, alice, bucket.id, "old-race.png", 12);
    await service.completeUpload(alice, scope, {
      uploadId: prepared.uploadId, completionToken: prepared.completionToken,
    });
    advance(2 * 24 * 60 * 60 * 1_000);

    const outcomes = await Promise.allSettled([
      service.deleteObject(alice, scope, bucket.id, "old-race.png"),
      service.expireLifecycle(admin, scope, 1),
    ]);
    expect(outcomes.some((result) => result.status === "fulfilled")).toBe(true);
    expect((await service.listBuckets(admin, scope))[0]).toMatchObject({ usedBytes: 0, reservedBytes: 0 });
    expect((await service.listObjects(admin, scope, bucket.id, {})).objects).toHaveLength(0);
    expect(await provider.headObject(prepared.upload.fields.key)).toBeNull();
  });

  it("expires stale multipart reservations, aborts provider orphans and spares living uploads", async () => {
    const alice = app("alice");
    const { service: svc, provider: prov, advance } = fixture();
    const bucketA = await svc.createBucket(admin, scope, {
      name: "stale-bucket", readPolicy: "authenticated", writePolicy: "authenticated",
      allowedMimeTypes: ["application/octet-stream"], maxObjectBytes: 1024, quotaBytes: 4096,
    });
    const bucketB = await svc.createBucket(admin, scope, {
      name: "live-bucket", readPolicy: "authenticated", writePolicy: "authenticated",
      allowedMimeTypes: ["application/octet-stream"], maxObjectBytes: 1024, quotaBytes: 4096,
    });
    await svc.prepareMultipartUpload(alice, scope, bucketA.id, {
      key: "stale.bin", contentType: "application/octet-stream", sizeBytes: 512, checksumSha256: checksum,
    });
    await prov.createMultipartUpload({
      providerKey: `${scope.organizationId}/${scope.projectId}/${scope.environment}/crashed/orphan/orphan.bin`,
      contentType: "application/octet-stream",
    });
    advance(21_601_000);
    await svc.prepareMultipartUpload(alice, scope, bucketB.id, {
      key: "live.bin", contentType: "application/octet-stream", sizeBytes: 512, checksumSha256: checksum,
    });
    expect(await svc.expireLifecycle(admin, scope)).toEqual({
      examined: 0, deleted: 0, expiredUploads: 1, orphanedUploadsAborted: 1,
    });
    const keys = (await prov.listMultipartUploads({ keyPrefix: `${scope.organizationId}/` }))
      .map((upload) => upload.providerKey);
    expect(keys.some((key) => key.endsWith("/stale.bin"))).toBe(false);
    expect(keys.some((key) => key.endsWith("/orphan.bin"))).toBe(false);
    expect(keys.some((key) => key.endsWith("/live.bin"))).toBe(true);
    const buckets = await svc.listBuckets(admin, scope);
    expect(buckets.find((bucket) => bucket.id === bucketA.id)?.reservedBytes).toBe(0);
    expect(buckets.find((bucket) => bucket.id === bucketB.id)?.reservedBytes).toBe(512);
  });

  it("rejects cross-tenant principals without revealing existence", async () => {
    const { service } = fixture();
    const outsider = { ...admin, organizationId: "org-other" };
    await expect(service.listBuckets(outsider, scope)).rejects.toBeInstanceOf(ProjectStorageError);
    await expect(service.listBuckets(outsider, scope)).rejects.toMatchObject({ code: "STORAGE_ACCESS_DENIED" });
  });
});
