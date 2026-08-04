import { describe, expect, it, vi } from "vitest";
import { ConfigurationError } from "@/lib/server/db/errors";
import {
  MemoryProjectStorageProvider,
  ProjectStorageProviderError,
  S3ProjectStorageProvider,
  StaticS3ProjectStorageCredentialsProvider,
} from "@/lib/server/project-storage/provider";

const now = new Date("2026-08-03T10:00:00.000Z");
const checksum = Buffer.alloc(32, 3).toString("base64");
const credentials = new StaticS3ProjectStorageCredentialsProvider({
  accessKeyId: "AKIAEXAMPLE00001", secretAccessKey: "not-a-real-secret-key-value-that-is-long", sessionToken: "temporary-session-token",
});

describe("Project Storage object providers", () => {
  it("creates an S3 POST policy bound to exact key, MIME, checksum, expiry and bounded multipart size", async () => {
    const provider = new S3ProjectStorageProvider({
      endpoint: "https://objects.example.test", region: "eu-central-1", bucket: "qkern-storage", production: true,
    }, credentials, fetch, () => now);
    const grant = await provider.createUploadGrant({
      providerKey: "org/project/development/bucket/upload/image.png",
      contentType: "image/png", checksumSha256: checksum, sizeBytes: 42,
      expiresAt: new Date(now.getTime() + 300_000),
    });
    const policy = JSON.parse(Buffer.from(grant.fields.policy, "base64").toString("utf8")) as {
      expiration: string; conditions: unknown[];
    };
    expect(grant.url).toBe("https://objects.example.test/qkern-storage");
    expect(policy.expiration).toBe("2026-08-03T10:05:00.000Z");
    expect(policy.conditions).toContainEqual(["content-length-range", 42, 42 + 1024 * 1024]);
    expect(policy.conditions).toContainEqual({ key: "org/project/development/bucket/upload/image.png" });
    expect(policy.conditions).toContainEqual({ "Content-Type": "image/png" });
    expect(policy.conditions).toContainEqual({ "x-amz-checksum-sha256": checksum });
    expect(JSON.stringify(grant)).not.toContain("not-a-real-secret-key-value-that-is-long");
  });

  it("rejects unsafe production endpoints and incomplete credentials", () => {
    expect(() => new S3ProjectStorageProvider({
      endpoint: "http://objects.example.test", region: "eu-central-1", bucket: "qkern-storage", production: true,
    }, credentials)).toThrow(ConfigurationError);
    expect(() => new StaticS3ProjectStorageCredentialsProvider({ accessKeyId: "", secretAccessKey: "short" }))
      .toThrow(ConfigurationError);
  });

  it("uses no redirects and verifies bounded HEAD metadata", async () => {
    const fetcher = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.method).toBe("HEAD");
      expect(init?.redirect).toBe("error");
      return new Response(null, { status: 200, headers: {
        "content-length": "42", "content-type": "image/png; charset=binary",
        "x-amz-checksum-sha256": checksum, etag: '"object-etag"',
      } });
    }) as unknown as typeof fetch;
    const provider = new S3ProjectStorageProvider({
      endpoint: "https://objects.example.test", region: "eu-central-1", bucket: "qkern-storage", production: true,
    }, credentials, fetcher, () => now);
    await expect(provider.headObject("org/project/development/object.png")).resolves.toEqual({
      sizeBytes: 42, contentType: "image/png", checksumSha256: checksum, etag: "object-etag",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("fails closed on malformed provider metadata", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200, headers: {
      "content-length": "NaN", "content-type": "text/html", "x-amz-checksum-sha256": "invalid",
    } })) as unknown as typeof fetch;
    const provider = new S3ProjectStorageProvider({
      endpoint: "https://objects.example.test", region: "eu-central-1", bucket: "qkern-storage", production: true,
    }, credentials, fetcher, () => now);
    await expect(provider.headObject("org/project/development/object.png")).rejects.toBeInstanceOf(ProjectStorageProviderError);
  });

  it("invalidates memory-provider grants after expiry or signature tampering", async () => {
    let clock = now;
    const provider = new MemoryProjectStorageProvider("https://objects.qkern.test", () => clock);
    const grant = await provider.createUploadGrant({
      providerKey: "org/project/development/object.png", contentType: "image/png",
      checksumSha256: checksum, sizeBytes: 42, expiresAt: new Date(now.getTime() + 30_000),
    });
    const expiry = Number(grant.fields["x-qkern-expires"]);
    expect(provider.validateGrant("POST", grant.fields.key, expiry, grant.fields["x-qkern-signature"])).toBe(true);
    expect(provider.validateGrant("POST", grant.fields.key, expiry, "00".repeat(32))).toBe(false);
    clock = new Date(now.getTime() + 31_000);
    expect(provider.validateGrant("POST", grant.fields.key, expiry, grant.fields["x-qkern-signature"])).toBe(false);
  });
});
