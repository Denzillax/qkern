import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlPool } from "@/lib/server/db/sql";
import { PostgresProjectStorageRepository } from "@/lib/server/project-storage/postgres-repository";
import { MemoryProjectStorageProvider, type ProjectStorageScanner } from "@/lib/server/project-storage/provider";
import { ProjectStorageService } from "@/lib/server/project-storage/service";

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const enabled = Boolean(ownerUrl && runtimeUrl);
const checksum = Buffer.alloc(32, 11).toString("base64");

describe.runIf(enabled)("Project Storage PostgreSQL certification", () => {
  let owner: SqlPool;
  let runtime: SqlPool;
  let repository: PostgresProjectStorageRepository;
  let provider: MemoryProjectStorageProvider;
  let service: ProjectStorageService;
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const scope = { organizationId, projectId, environment: "development" as const };
  const admin = { organizationId, actorRef: "storage-owner@qkern.test", role: "admin" as const, subject: controlUser };
  const application = { organizationId, actorRef: "project-auth-user:alice", role: "authenticated" as const, subject: randomUUID() };

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    runtime = verifyDatabaseBoundary(createPostgresPool({ connectionString: runtimeUrl!, max: 8 }), "runtime");
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [controlUser, `project-storage-owner-${controlUser}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Project Storage Integration', $2, $3)`,
    [organizationId, `project-storage-${organizationId}`, controlUser]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Project Storage', $3, 'test', 'ready', $4)`,
    [projectId, organizationId, `project-storage-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [organizationId, projectId, `managed:${projectId}`]);
    provider = new MemoryProjectStorageProvider();
    repository = new PostgresProjectStorageRepository(new PostgresControlPlane(runtime));
    const scanner: ProjectStorageScanner = { async scan() { return "clean"; } };
    service = new ProjectStorageService({
      repository,
      provider, scanner,
    });
  });

  afterAll(async () => {
    if (owner) await owner.query("DELETE FROM users WHERE id = $1", [controlUser]);
    await Promise.all([owner?.end(), runtime?.end()]);
  });

  it("persists an exact verified upload and moves quota from reserved to used", async () => {
    const bucket = await service.createBucket(admin, scope, {
      name: `objects-${randomUUID().slice(0, 8)}`,
      readPolicy: "owner", writePolicy: "owner", maxObjectBytes: 100, quotaBytes: 100,
    });
    const prepared = await service.prepareUpload(application, scope, bucket.id, {
      key: "owner/image.png", contentType: "image/png", sizeBytes: 42, checksumSha256: checksum,
    });
    provider.putForTest(prepared.upload.fields.key, {
      sizeBytes: 42, contentType: "image/png", checksumSha256: checksum, etag: "postgres-etag",
    });
    const completed = await service.completeUpload(application, scope, {
      uploadId: prepared.uploadId, completionToken: prepared.completionToken,
    });
    expect(completed).toMatchObject({ key: "owner/image.png", status: "clean", ownerSubject: application.subject });
    expect((await service.listBuckets(admin, scope))[0]).toMatchObject({ usedBytes: 42, reservedBytes: 0 });
    const verifier = await owner.query<{ completion_token_hash: string }>(
      "SELECT completion_token_hash FROM project_storage_uploads WHERE id=$1", [prepared.uploadId],
    );
    expect(verifier.rows[0]?.completion_token_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifier.rows[0]?.completion_token_hash).not.toBe(prepared.completionToken);
  });

  it("serializes concurrent quota reservations without overbooking", async () => {
    const bucket = await service.createBucket(admin, scope, {
      name: `quota-race-${randomUUID().slice(0, 8)}`,
      writePolicy: "authenticated", allowedMimeTypes: ["application/octet-stream"],
      maxObjectBytes: 60, quotaBytes: 100,
    });
    const attempts = await Promise.allSettled([
      service.prepareUpload(application, scope, bucket.id, {
        key: "first.bin", contentType: "application/octet-stream", sizeBytes: 60,
        checksumSha256: checksum,
      }),
      service.prepareUpload({ ...application, subject: randomUUID() }, scope, bucket.id, {
        key: "second.bin", contentType: "application/octet-stream", sizeBytes: 60,
        checksumSha256: checksum,
      }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toMatchObject([
      { reason: { code: "STORAGE_QUOTA_EXCEEDED" } },
    ]);
    const state = await owner.query<{ used_bytes: number; reserved_bytes: number; pending: number }>(`
      SELECT bucket.used_bytes::int, bucket.reserved_bytes::int,
        count(upload.id) FILTER (WHERE upload.status='pending')::int AS pending
      FROM project_storage_buckets bucket
      LEFT JOIN project_storage_uploads upload ON upload.bucket_id=bucket.id
      WHERE bucket.id=$1
      GROUP BY bucket.id`, [bucket.id]);
    expect(state.rows[0]).toEqual({ used_bytes: 0, reserved_bytes: 60, pending: 1 });
  });

  it("commits concurrent completion replays exactly once", async () => {
    const bucket = await service.createBucket(admin, scope, {
      name: `complete-race-${randomUUID().slice(0, 8)}`,
      writePolicy: "authenticated", allowedMimeTypes: ["application/octet-stream"],
      maxObjectBytes: 64, quotaBytes: 64,
    });
    const prepared = await service.prepareUpload(application, scope, bucket.id, {
      key: "once.bin", contentType: "application/octet-stream", sizeBytes: 42,
      checksumSha256: checksum,
    });
    provider.putForTest(prepared.upload.fields.key, {
      sizeBytes: 42, contentType: "application/octet-stream", checksumSha256: checksum,
      etag: "completion-race-etag",
    });
    const [first, replay] = await Promise.all([
      service.completeUpload(application, scope, {
        uploadId: prepared.uploadId, completionToken: prepared.completionToken,
      }),
      service.completeUpload(application, scope, {
        uploadId: prepared.uploadId, completionToken: prepared.completionToken,
      }),
    ]);
    expect(replay.id).toBe(first.id);
    const state = await owner.query<{
      used_bytes: number; reserved_bytes: number; object_count: number;
    }>(`SELECT bucket.used_bytes::int, bucket.reserved_bytes::int,
        count(object.id)::int AS object_count
      FROM project_storage_buckets bucket
      LEFT JOIN project_storage_objects object ON object.bucket_id=bucket.id AND object.deleted_at IS NULL
      WHERE bucket.id=$1
      GROUP BY bucket.id`, [bucket.id]);
    expect(state.rows[0]).toEqual({ used_bytes: 42, reserved_bytes: 0, object_count: 1 });
  });

  it("cleans the provider object when expiry wins a slow completion", async () => {
    let current = new Date();
    const scanner = new BlockingScanner();
    const racingService = new ProjectStorageService({
      repository, provider, scanner, now: () => new Date(current),
    });
    const bucket = await racingService.createBucket(admin, scope, {
      name: `expiry-race-${randomUUID().slice(0, 8)}`,
      writePolicy: "authenticated", allowedMimeTypes: ["application/octet-stream"],
      maxObjectBytes: 12, quotaBytes: 12,
    });
    const prepared = await racingService.prepareUpload(application, scope, bucket.id, {
      key: "slow.bin", contentType: "application/octet-stream", sizeBytes: 12,
      checksumSha256: checksum,
    });
    provider.putForTest(prepared.upload.fields.key, {
      sizeBytes: 12, contentType: "application/octet-stream", checksumSha256: checksum,
      etag: "slow-completion-etag",
    });
    const completion = racingService.completeUpload(application, scope, {
      uploadId: prepared.uploadId, completionToken: prepared.completionToken,
    });
    await scanner.started;
    current = new Date(current.getTime() + 301_000);
    await racingService.prepareUpload(application, scope, bucket.id, {
      key: "replacement.bin", contentType: "application/octet-stream", sizeBytes: 1,
      checksumSha256: checksum,
    });
    scanner.release();

    await expect(completion).rejects.toMatchObject({ code: "STORAGE_CONFLICT" });
    await expect(provider.headObject(prepared.upload.fields.key)).resolves.toBeNull();
    const state = await owner.query<{
      used_bytes: number; reserved_bytes: number; old_status: string; object_count: number;
    }>(`SELECT bucket.used_bytes::int, bucket.reserved_bytes::int,
        max(upload.status) FILTER (WHERE upload.id=$2) AS old_status,
        count(object.id)::int AS object_count
      FROM project_storage_buckets bucket
      LEFT JOIN project_storage_uploads upload ON upload.bucket_id=bucket.id
      LEFT JOIN project_storage_objects object ON object.bucket_id=bucket.id
      WHERE bucket.id=$1
      GROUP BY bucket.id`, [bucket.id, prepared.uploadId]);
    expect(state.rows[0]).toEqual({
      used_bytes: 0, reserved_bytes: 1, old_status: "expired", object_count: 0,
    });
  });

  it("releases used quota once when delete and lifecycle expiration race", async () => {
    let current = new Date();
    const racingService = new ProjectStorageService({
      repository, provider, scanner: { async scan() { return "clean"; } },
      now: () => new Date(current),
    });
    const bucket = await racingService.createBucket(admin, scope, {
      name: `delete-race-${randomUUID().slice(0, 8)}`,
      readPolicy: "authenticated", writePolicy: "authenticated", retentionDays: 1,
      allowedMimeTypes: ["application/octet-stream"], maxObjectBytes: 64, quotaBytes: 64,
    });
    const prepared = await racingService.prepareUpload(application, scope, bucket.id, {
      key: "old.bin", contentType: "application/octet-stream", sizeBytes: 42,
      checksumSha256: checksum,
    });
    provider.putForTest(prepared.upload.fields.key, {
      sizeBytes: 42, contentType: "application/octet-stream", checksumSha256: checksum,
      etag: "delete-race-etag",
    });
    await racingService.completeUpload(application, scope, {
      uploadId: prepared.uploadId, completionToken: prepared.completionToken,
    });
    current = new Date(current.getTime() + 2 * 24 * 60 * 60 * 1_000);
    const outcomes = await Promise.allSettled([
      racingService.deleteObject(application, scope, bucket.id, "old.bin"),
      racingService.expireLifecycle(admin, scope, 1),
    ]);
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    const state = await owner.query<{
      used_bytes: number; reserved_bytes: number; active_objects: number; deleted_objects: number;
    }>(`SELECT bucket.used_bytes::int, bucket.reserved_bytes::int,
        count(object.id) FILTER (WHERE object.deleted_at IS NULL)::int AS active_objects,
        count(object.id) FILTER (WHERE object.deleted_at IS NOT NULL)::int AS deleted_objects
      FROM project_storage_buckets bucket
      LEFT JOIN project_storage_objects object ON object.bucket_id=bucket.id
      WHERE bucket.id=$1
      GROUP BY bucket.id`, [bucket.id]);
    expect(state.rows[0]).toEqual({
      used_bytes: 0, reserved_bytes: 0, active_objects: 0, deleted_objects: 1,
    });
  });

  it("keeps the runtime role inside RLS and rejects direct cross-tenant reads", async () => {
    const direct = await runtime.query("SELECT id FROM project_storage_buckets");
    expect(direct.rows).toEqual([]);
    const outsider = { ...admin, organizationId: randomUUID() };
    await expect(service.listBuckets(outsider, scope)).rejects.toMatchObject({ code: "STORAGE_ACCESS_DENIED" });
  });
});

class BlockingScanner implements ProjectStorageScanner {
  private startedResolve!: () => void;
  private verdictResolve!: (verdict: "clean") => void;
  readonly started = new Promise<void>((resolve) => { this.startedResolve = resolve; });
  private readonly verdict = new Promise<"clean">((resolve) => { this.verdictResolve = resolve; });

  async scan() {
    this.startedResolve();
    return await this.verdict;
  }

  release() { this.verdictResolve("clean"); }
}
