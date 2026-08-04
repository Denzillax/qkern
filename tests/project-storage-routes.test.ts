import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createProjectStorageUploadHandlers } from "@/app/api/v1/projects/[projectId]/environments/[environment]/storage/buckets/[bucketId]/uploads/route";
import { createProjectStorageBucketHandlers } from "@/app/api/v1/projects/[projectId]/environments/[environment]/storage/buckets/route";
import { projectStoragePreflight, projectStorageRouteError } from "@/lib/server/project-storage/http";
import { ProjectStorageError, type ProjectStorageService } from "@/lib/server/project-storage/service";

const context = { params: Promise.resolve({ projectId: "prj-storage", environment: "development", bucketId: "bucket-1" }) };

describe("Project Storage routes", () => {
  it("rejects an unallowlisted browser origin before authentication or service access", async () => {
    const service = { prepareUpload: vi.fn() } as unknown as ProjectStorageService;
    const request = new NextRequest("http://localhost/api/storage", {
      method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ key: "x.png", contentType: "image/png", sizeBytes: 1, checksumSha256: Buffer.alloc(32).toString("base64") }),
    });
    const response = await createProjectStorageUploadHandlers(service).POST(request, context);
    expect(response.status).toBe(403);
    expect(service.prepareUpload).not.toHaveBeenCalled();
  });

  it("returns a CORS preflight only for an exact configured origin", () => {
    const previous = process.env.QKERN_PROJECT_STORAGE_ALLOWED_ORIGINS;
    process.env.QKERN_PROJECT_STORAGE_ALLOWED_ORIGINS = "https://app.example.test";
    try {
      const allowed = projectStoragePreflight(new NextRequest("https://api.example.test", {
        method: "OPTIONS", headers: { origin: "https://app.example.test" },
      }), "POST, OPTIONS");
      expect(allowed.status).toBe(204);
      expect(allowed.headers.get("access-control-allow-origin")).toBe("https://app.example.test");
      const denied = projectStoragePreflight(new NextRequest("https://api.example.test", {
        method: "OPTIONS", headers: { origin: "https://app.example.test.evil" },
      }), "POST, OPTIONS");
      expect(denied.status).toBe(403);
    } finally {
      if (previous === undefined) delete process.env.QKERN_PROJECT_STORAGE_ALLOWED_ORIGINS;
      else process.env.QKERN_PROJECT_STORAGE_ALLOWED_ORIGINS = previous;
    }
  });

  it("protects session-admin mutations with trusted-origin CSRF validation", async () => {
    const service = { createBucket: vi.fn() } as unknown as ProjectStorageService;
    const request = new NextRequest("https://qkern.example.test/api/storage", {
      method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ name: "private-assets" }),
    });
    const response = await createProjectStorageBucketHandlers(service).POST(request, context);
    expect(response.status).toBe(403);
    expect(service.createBucket).not.toHaveBeenCalled();
  });

  it("maps provider and quarantine failures without leaking provider details", async () => {
    const unavailable = projectStorageRouteError(new ProjectStorageError("STORAGE_PROVIDER_UNAVAILABLE"));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "Storage provider unavailable" });
    const quarantined = projectStorageRouteError(new ProjectStorageError("STORAGE_OBJECT_NOT_READY"));
    expect(quarantined.status).toBe(409);
    expect(JSON.stringify(await quarantined.json())).not.toMatch(/s3|providerKey|checksum/i);
  });
});
