import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createProjectStorageObjectLogHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/storage/objects/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { MemoryProjectStorageProvider, type ProjectStorageScanner } from "@/lib/server/project-storage/provider";
import { MemoryProjectStorageRepository } from "@/lib/server/project-storage/repository";
import { ProjectStorageError, ProjectStorageService } from "@/lib/server/project-storage/service";
import { tenancyService } from "@/lib/server/tenancy-service";

/**
 * Der Stand der Speicherobjekte (2.51). Zwei Gegenstaende in einer Datei:
 * die HTTP-Grenze — Admin-Sitzung, vier Parameter und kein fuenfter,
 * no-store, ein abgeschaltetes Storage als Zustand statt als 500 — und der
 * Dienst darunter, der filtert, blaettert und zaehlt.
 *
 * Was hier **nicht** geprueft wird, weil es die Ansicht nicht behauptet: ein
 * Ereignis je Upload oder Download. QKERN fuehrt keins.
 */
const checksum = Buffer.alloc(32, 7).toString("base64");

async function identity() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `storage-log-${nonce}@qkern.test`,
    password: "a sufficiently long storage object log test password",
    rateLimitKey: nonce,
  });
  const membership = await tenancyService.ensureWorkspace(registration.user);
  const projects = await controlPlaneService.listProjects({
    organizationId: membership.organization.id,
    actor: { id: registration.user.id, ref: registration.user.email, type: "user" },
  });
  return { ...registration, membership, project: projects[0] };
}

const answer = {
  entries: [{
    id: "11111111-1111-4111-8111-111111111111",
    bucketId: "22222222-2222-4222-8222-222222222222",
    bucketName: "media", key: "owner/report.pdf", ownerSubject: "alice",
    sizeBytes: 2048, contentType: "application/pdf", status: "clean",
    createdAt: "2026-09-26T09:00:00.000Z", deleteAfter: null, deletedAt: null,
  }],
  counts: { quarantined: 1, clean: 4, infected: 2 },
  nextCursor: "1758877200000.11111111-1111-4111-8111-111111111111",
  buckets: [{ id: "22222222-2222-4222-8222-222222222222", name: "media" }],
};

function call(projectId: string, token: string | null, query: string, readObjectLog = vi.fn().mockResolvedValue(answer)) {
  const service = { readObjectLog } as unknown as ProjectStorageService;
  const request = new NextRequest(
    `https://qkern.test/api/v1/projects/${projectId}/environments/development/storage/objects${query}`,
    token ? { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } } : undefined,
  );
  return {
    readObjectLog,
    response: createProjectStorageObjectLogHandlers(service).GET(request, {
      params: Promise.resolve({ projectId, environment: "development" }),
    }),
  };
}

/** Ein Dienst auf dem Gedaechtnis, mit fortlaufender Uhr fuer die Seitenfolge. */
function memoryService() {
  let tick = Date.parse("2026-09-26T09:00:00.000Z");
  // Der Provider liest dieselbe Uhr wie der Dienst; sonst liegt jede
  // Gnadenfrist in der Vergangenheit der echten Zeit.
  const provider = new MemoryProjectStorageProvider("https://objects.qkern.test", () => new Date(tick));
  const verdict = { next: "clean" as "clean" | "infected" };
  const scanner: ProjectStorageScanner = { async scan() { return verdict.next; } };
  const service = new ProjectStorageService({
    repository: new MemoryProjectStorageRepository(),
    provider, scanner, now: () => new Date((tick += 1_000)),
  });
  return { service, provider, verdict };
}

async function storeObject(
  parts: ReturnType<typeof memoryService>,
  principal: { organizationId: string; actorRef: string; role: "admin" | "authenticated"; subject: string },
  scope: { organizationId: string; projectId: string; environment: "development" },
  bucketId: string,
  key: string,
) {
  const prepared = await parts.service.prepareUpload(principal, scope, bucketId, {
    key, contentType: "image/png", sizeBytes: 12, checksumSha256: checksum,
  });
  parts.provider.putForTest(prepared.upload.fields.key, {
    sizeBytes: 12, contentType: "image/png", checksumSha256: checksum, etag: "memory-etag",
  });
  return await parts.service.completeUpload(principal, scope, {
    uploadId: prepared.uploadId, completionToken: prepared.completionToken,
  });
}

describe("storage object log route", () => {
  it("serves entries, per-verdict counts and the bucket list with no-store", async () => {
    const principal = await identity();
    const { readObjectLog, response } = call(principal.project.id, principal.token, "");
    const answered = await response;
    expect(answered.status).toBe(200);
    expect(answered.headers.get("cache-control")).toBe("private, no-store");
    const body = await answered.json();
    expect(Object.keys(body.data).sort()).toEqual(["buckets", "counts", "entries", "nextCursor"]);
    expect(body.data.counts).toEqual({ quarantined: 1, clean: 4, infected: 2 });
    expect(body.data.entries[0]).toMatchObject({ bucketName: "media", status: "clean" });
    // Weder Provider-Schluessel noch Pruefsumme noch eine signierte Adresse.
    const raw = JSON.stringify(body);
    for (const leak of ["providerKey", "provider_key", "checksum", "X-Amz", "signedUrl"]) {
      expect(raw, leak).not.toContain(leak);
    }
    expect(readObjectLog).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: principal.membership.organization.id, role: "admin" }),
      { organizationId: principal.membership.organization.id, projectId: principal.project.id, environment: "development" },
      { bucket: undefined, status: undefined, cursor: undefined, limit: undefined },
    );
  });

  it("passes bucket, status, cursor and limit through unchanged", async () => {
    const principal = await identity();
    const { readObjectLog, response } = call(principal.project.id, principal.token,
      "?bucket=media&status=infected&cursor=1758877200000.11111111-1111-4111-8111-111111111111&limit=10");
    expect((await response).status).toBe(200);
    expect(readObjectLog.mock.calls[0][2]).toEqual({
      bucket: "media", status: "infected",
      cursor: "1758877200000.11111111-1111-4111-8111-111111111111", limit: 10,
    });
  });

  it("rejects an unknown, a repeated and an out-of-shape parameter before touching the service", async () => {
    const principal = await identity();
    for (const query of ["?prefix=owner/", "?bucket=a&bucket=b", "?limit=ten", "?limit=", "?key=secret.png"]) {
      const { readObjectLog, response } = call(principal.project.id, principal.token, query);
      const answered = await response;
      expect(answered.status, query).toBe(400);
      expect(await answered.json()).toEqual({ error: "Invalid storage request" });
      expect(readObjectLog, query).not.toHaveBeenCalled();
    }
  });

  it("denies an anonymous caller and a forged session", async () => {
    const principal = await identity();
    const anonymous = call(principal.project.id, null, "");
    expect((await anonymous.response).status).toBe(401);
    expect(anonymous.readObjectLog).not.toHaveBeenCalled();
    const forged = call(principal.project.id, "not-a-session", "");
    expect((await forged.response).status).toBe(401);
    expect(forged.readObjectLog).not.toHaveBeenCalled();
  });

  it("answers a switched-off Object Storage with a clear 503 instead of a 500", async () => {
    const principal = await identity();
    const { response } = call(principal.project.id, principal.token, "",
      vi.fn().mockRejectedValue(new ProjectStorageError("PROJECT_STORAGE_DISABLED")));
    const answered = await response;
    expect(answered.status).toBe(503);
    expect(await answered.json()).toEqual({ error: "Project Storage is disabled" });
  });
});

describe("storage object log service", () => {
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const scope = { organizationId, projectId, environment: "development" as const };
  const admin = { organizationId, actorRef: "owner@qkern.test", role: "admin" as const, subject: randomUUID() };
  const member = { organizationId, actorRef: "project-auth-user:alice", role: "authenticated" as const, subject: randomUUID() };

  async function filled() {
    const parts = memoryService();
    const media = await parts.service.createBucket(admin, scope, {
      name: "media", readPolicy: "authenticated", writePolicy: "authenticated",
      maxObjectBytes: 1024, quotaBytes: 10_240,
    });
    const docs = await parts.service.createBucket(admin, scope, {
      name: "docs", readPolicy: "authenticated", writePolicy: "authenticated",
      maxObjectBytes: 1024, quotaBytes: 10_240,
    });
    const first = await storeObject(parts, member, scope, media.id, "a.png");
    await storeObject(parts, member, scope, media.id, "b.png");
    await storeObject(parts, member, scope, docs.id, "c.png");
    // Ein Urteil, das das Objekt im selben Schritt entfernt.
    parts.verdict.next = "infected";
    await parts.service.scanObject(admin, scope, first.id);
    parts.verdict.next = "clean";
    return { ...parts, media, docs };
  }

  it("lists the newest first, counts every verdict and keeps the removed row visible", async () => {
    const { service } = await filled();
    const log = await service.readObjectLog(admin, scope, {});
    expect(log.entries).toHaveLength(3);
    expect(log.entries.map((entry) => entry.key)).toEqual(["c.png", "b.png", "a.png"]);
    expect(log.counts).toEqual({ quarantined: 0, clean: 2, infected: 1 });
    expect(log.buckets.map((bucket) => bucket.name)).toEqual(["docs", "media"]);
    const removed = log.entries.at(-1)!;
    expect(removed).toMatchObject({ key: "a.png", status: "infected", bucketName: "media" });
    expect(removed.deletedAt).not.toBeNull();
    // Kein Provider-Schluessel, keine Pruefsumme.
    expect(Object.keys(removed).sort()).toEqual([
      "bucketId", "bucketName", "contentType", "createdAt", "deleteAfter", "deletedAt",
      "id", "key", "ownerSubject", "sizeBytes", "status",
    ]);
  });

  it("filters by bucket and by verdict, and counts within the chosen bucket", async () => {
    const { service, media } = await filled();
    const byBucket = await service.readObjectLog(admin, scope, { bucket: "media" });
    expect(byBucket.entries.map((entry) => entry.key)).toEqual(["b.png", "a.png"]);
    expect(byBucket.counts).toEqual({ quarantined: 0, clean: 1, infected: 1 });
    expect(await service.readObjectLog(admin, scope, { bucket: media.id })).toEqual(byBucket);
    const infected = await service.readObjectLog(admin, scope, { status: "infected" });
    expect(infected.entries.map((entry) => entry.key)).toEqual(["a.png"]);
    // Der Zaehler folgt dem Bucket, nicht dem Urteil: sonst stuende ueberall dieselbe Zahl.
    expect(infected.counts).toEqual({ quarantined: 0, clean: 2, infected: 1 });
  });

  it("pages with a keyset cursor and stops without one", async () => {
    const { service } = await filled();
    const first = await service.readObjectLog(admin, scope, { limit: 2 });
    expect(first.entries.map((entry) => entry.key)).toEqual(["c.png", "b.png"]);
    expect(first.nextCursor).toMatch(/^\d+\.[0-9a-f-]{36}$/);
    const second = await service.readObjectLog(admin, scope, { limit: 2, cursor: first.nextCursor! });
    expect(second.entries.map((entry) => entry.key)).toEqual(["a.png"]);
    expect(second.nextCursor).toBeNull();
  });

  it("refuses a non-admin, an unknown bucket, an invented verdict, a broken cursor and a limit out of bounds", async () => {
    const { service } = await filled();
    const codes: string[] = [];
    for (const attempt of [
      () => service.readObjectLog(member, scope, {}),
      () => service.readObjectLog(admin, scope, { bucket: "does-not-exist" }),
      () => service.readObjectLog(admin, scope, { status: "suspicious" }),
      () => service.readObjectLog(admin, scope, { cursor: "yesterday" }),
      () => service.readObjectLog(admin, scope, { limit: 0 }),
      () => service.readObjectLog(admin, scope, { limit: 101 }),
    ]) {
      await attempt().then(() => codes.push("no error"), (error: unknown) => {
        codes.push(error instanceof ProjectStorageError ? error.code : "other");
      });
    }
    expect(codes).toEqual([
      "STORAGE_ACCESS_DENIED", "STORAGE_RESOURCE_NOT_FOUND", "STORAGE_INVALID_INPUT",
      "STORAGE_INVALID_INPUT", "STORAGE_INVALID_INPUT", "STORAGE_INVALID_INPUT",
    ]);
  });
});
