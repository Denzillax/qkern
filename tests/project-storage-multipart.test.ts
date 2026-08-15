import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ProjectStoragePrincipal, ProjectStorageScope } from "@/lib/server/project-storage/model";
import {
  MemoryProjectStorageProvider,
  QuarantineOnlyProjectStorageScanner,
} from "@/lib/server/project-storage/provider";
import { MemoryProjectStorageRepository } from "@/lib/server/project-storage/repository";
import { ProjectStorageService } from "@/lib/server/project-storage/service";

/**
 * Der Multipart-Dienstweg ohne Netz — dieselben Zusagen wie gegen MinIO.
 *
 * Der Beleg mit echten Bytes, echtem Provider und echtem Virenscanner steht in
 * `tests/project-storage-provider.integration.test.ts`; hier stehen die
 * Zustands- und Grenzzusagen, die keinen Server brauchen.
 */

const scope: ProjectStorageScope = {
  organizationId: randomUUID(), projectId: randomUUID(), environment: "development",
};
const principal: ProjectStoragePrincipal = {
  organizationId: scope.organizationId, actorRef: "storage-tests", role: "admin", subject: randomUUID(),
};

function runtime() {
  const provider = new MemoryProjectStorageProvider();
  const service = new ProjectStorageService({
    repository: new MemoryProjectStorageRepository(),
    provider,
    scanner: new QuarantineOnlyProjectStorageScanner(),
    grantTtlSeconds: 60,
  });
  return { provider, service };
}

async function bucketWith(service: ProjectStorageService) {
  return service.createBucket(principal, scope, {
    name: `mp-${randomUUID().slice(0, 8)}`,
    allowedMimeTypes: ["application/octet-stream"],
    maxObjectBytes: 64 * 1024 * 1024,
    quotaBytes: 128 * 1024 * 1024,
  });
}

const CHECKSUM = `${"A".repeat(43)}=`;
const PART_CHECKSUM = `${"B".repeat(43)}=`;

describe("project storage multipart service path", () => {
  it("prepares, grants parts, completes — and stays quarantined without a verifying scan", async () => {
    const { provider, service } = runtime();
    const bucket = await bucketWith(service);
    const prepared = await service.prepareMultipartUpload(principal, scope, bucket.id, {
      key: "large.bin", contentType: "application/octet-stream",
      sizeBytes: 10 * 1024 * 1024, checksumSha256: CHECKSUM,
    });

    const grant = await service.createPartUploadGrant(principal, scope, {
      uploadId: prepared.uploadId, completionToken: prepared.completionToken,
      partNumber: 1, checksumSha256: PART_CHECKSUM,
    });
    expect(grant.method).toBe("PUT");
    expect(grant.headers["x-amz-checksum-sha256"]).toBe(PART_CHECKSUM);

    // Der Memory-Provider laedt nichts wirklich; der HEAD wird gestellt, wie
    // ihn ein vollstaendiger Upload hinterlassen wuerde.
    const providerKey = decodeURIComponent(new URL(grant.url).pathname.slice(1)).split("?")[0]!;
    provider.putForTest(providerKey, {
      sizeBytes: 10 * 1024 * 1024, contentType: "application/octet-stream",
      checksumSha256: CHECKSUM, etag: "etag-multipart",
    });
    const etag = `"memory-1-${PART_CHECKSUM.slice(0, 8)}"`;
    const object = await service.completeMultipartUpload(principal, scope, {
      uploadId: prepared.uploadId, completionToken: prepared.completionToken,
      parts: [{ partNumber: 1, etag }],
    });
    // Ohne nachrechnenden Scanner wird ein Multipart-Objekt niemals sauber:
    // Seine Ganzdatei-Pruefsumme hat sonst niemand geprueft.
    expect(object.status).toBe("quarantined");
    expect(object.sizeBytes).toBe(10 * 1024 * 1024);
    expect(object.key).toBe("large.bin");
  });

  it("keeps the single-shot completion away from multipart uploads and vice versa", async () => {
    const { service } = runtime();
    const bucket = await bucketWith(service);
    const multipart = await service.prepareMultipartUpload(principal, scope, bucket.id, {
      key: "a.bin", contentType: "application/octet-stream", sizeBytes: 1024, checksumSha256: CHECKSUM,
    });
    await expect(service.completeUpload(principal, scope, {
      uploadId: multipart.uploadId, completionToken: multipart.completionToken,
    })).rejects.toMatchObject({ code: "STORAGE_INVALID_INPUT" });

    const single = await service.prepareUpload(principal, scope, bucket.id, {
      key: "b.bin", contentType: "application/octet-stream", sizeBytes: 1024, checksumSha256: CHECKSUM,
    });
    await expect(service.createPartUploadGrant(principal, scope, {
      uploadId: single.uploadId, completionToken: single.completionToken,
      partNumber: 1, checksumSha256: PART_CHECKSUM,
    })).rejects.toMatchObject({ code: "STORAGE_INVALID_INPUT" });
  });

  it("aborts a multipart upload; afterwards neither parts nor completion work", async () => {
    const { service } = runtime();
    const bucket = await bucketWith(service);
    const prepared = await service.prepareMultipartUpload(principal, scope, bucket.id, {
      key: "gone.bin", contentType: "application/octet-stream", sizeBytes: 2048, checksumSha256: CHECKSUM,
    });
    await service.abortMultipartUpload(principal, scope, {
      uploadId: prepared.uploadId, completionToken: prepared.completionToken,
    });
    await expect(service.createPartUploadGrant(principal, scope, {
      uploadId: prepared.uploadId, completionToken: prepared.completionToken,
      partNumber: 1, checksumSha256: PART_CHECKSUM,
    })).rejects.toMatchObject({ code: "STORAGE_INVALID_TOKEN" });
    await expect(service.completeMultipartUpload(principal, scope, {
      uploadId: prepared.uploadId, completionToken: prepared.completionToken,
      parts: [{ partNumber: 1, etag: '"x"' }],
    })).rejects.toMatchObject({ code: "STORAGE_INVALID_TOKEN" });
    // Ein zweiter Abbruch ist kein Fehler: Er findet nichts mehr vor.
    await service.abortMultipartUpload(principal, scope, {
      uploadId: prepared.uploadId, completionToken: prepared.completionToken,
    });
  });

  it("frees the pending key reservation when the abort releases it", async () => {
    const { service } = runtime();
    const bucket = await bucketWith(service);
    const first = await service.prepareMultipartUpload(principal, scope, bucket.id, {
      key: "same.bin", contentType: "application/octet-stream", sizeBytes: 1024, checksumSha256: CHECKSUM,
    });
    // Derselbe Schluessel ist waehrend der Reservierung belegt …
    await expect(service.prepareMultipartUpload(principal, scope, bucket.id, {
      key: "same.bin", contentType: "application/octet-stream", sizeBytes: 1024, checksumSha256: CHECKSUM,
    })).rejects.toMatchObject({ code: "STORAGE_CONFLICT" });
    await service.abortMultipartUpload(principal, scope, {
      uploadId: first.uploadId, completionToken: first.completionToken,
    });
    // … und nach dem Abbruch wieder frei.
    await expect(service.prepareMultipartUpload(principal, scope, bucket.id, {
      key: "same.bin", contentType: "application/octet-stream", sizeBytes: 1024, checksumSha256: CHECKSUM,
    })).resolves.toMatchObject({ key: "same.bin" });
  });
});
