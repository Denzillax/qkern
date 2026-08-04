import { describe, expect, it } from "vitest";
import { ConfigurationError } from "@/lib/server/db/errors";
import { MemoryProjectStorageProvider, QuarantineOnlyProjectStorageScanner } from "@/lib/server/project-storage/provider";
import { MemoryProjectStorageRepository } from "@/lib/server/project-storage/repository";
import { createProjectStorageServiceFromEnv } from "@/lib/server/project-storage/runtime";
import { ProjectStorageError } from "@/lib/server/project-storage/service";

describe("Project Storage runtime composition", () => {
  it("is disabled by default", () => {
    expect(() => createProjectStorageServiceFromEnv({ NODE_ENV: "test" }))
      .toThrow(ProjectStorageError);
  });

  it("uses memory provider only for local development when no S3 settings exist", () => {
    expect(createProjectStorageServiceFromEnv({
      NODE_ENV: "test", QKERN_PROJECT_STORAGE_ENABLED: "true", QKERN_RUNTIME_MODE: "memory",
    })).toBeDefined();
  });

  it("rejects partial development S3 configuration", () => {
    expect(() => createProjectStorageServiceFromEnv({
      NODE_ENV: "test", QKERN_PROJECT_STORAGE_ENABLED: "true", QKERN_RUNTIME_MODE: "memory",
      QKERN_PROJECT_STORAGE_S3_ENDPOINT: "https://objects.example.test",
    })).toThrow(ConfigurationError);
  });

  it("enables the local ClamAV adapter only with an explicit host and bounded settings", () => {
    expect(() => createProjectStorageServiceFromEnv({
      NODE_ENV: "test", QKERN_PROJECT_STORAGE_ENABLED: "true", QKERN_RUNTIME_MODE: "memory",
      QKERN_PROJECT_STORAGE_SCANNER_TIMEOUT_MS: "10000",
    })).toThrow("CLAMAV_HOST");
    expect(() => createProjectStorageServiceFromEnv({
      NODE_ENV: "test", QKERN_PROJECT_STORAGE_ENABLED: "true", QKERN_RUNTIME_MODE: "memory",
      QKERN_PROJECT_STORAGE_CLAMAV_HOST: "127.0.0.1",
      QKERN_PROJECT_STORAGE_CLAMAV_PORT: "3310",
      QKERN_PROJECT_STORAGE_SCANNER_MAX_OBJECT_BYTES: String(25 * 1024 * 1024),
    })).not.toThrow();
    expect(() => createProjectStorageServiceFromEnv({
      NODE_ENV: "test", QKERN_PROJECT_STORAGE_ENABLED: "true", QKERN_RUNTIME_MODE: "memory",
      QKERN_PROJECT_STORAGE_CLAMAV_HOST: "http://127.0.0.1",
    })).toThrow(ConfigurationError);
  });

  it("accepts only exact HTTPS origins in production and loopback HTTP in development", () => {
    expect(() => createProjectStorageServiceFromEnv({
      NODE_ENV: "test", QKERN_PROJECT_STORAGE_ENABLED: "true", QKERN_RUNTIME_MODE: "memory",
      QKERN_PROJECT_STORAGE_ALLOWED_ORIGINS: "http://localhost:3000",
    })).not.toThrow();
    expect(() => createProjectStorageServiceFromEnv({
      NODE_ENV: "production", QKERN_PROJECT_STORAGE_ENABLED: "true",
      QKERN_PROJECT_STORAGE_ALLOWED_ORIGINS: "http://localhost:3000",
    }, {
      repository: new MemoryProjectStorageRepository(), provider: new MemoryProjectStorageProvider(),
      scanner: new QuarantineOnlyProjectStorageScanner(),
    })).toThrow("exact HTTPS origins");
  });

  it("requires injected production provider credentials and scanner adapters", () => {
    expect(() => createProjectStorageServiceFromEnv({
      NODE_ENV: "production", QKERN_PROJECT_STORAGE_ENABLED: "true",
    }, { repository: new MemoryProjectStorageRepository() })).toThrow(ConfigurationError);
    expect(() => createProjectStorageServiceFromEnv({
      NODE_ENV: "production", QKERN_PROJECT_STORAGE_ENABLED: "true",
    }, {
      repository: new MemoryProjectStorageRepository(),
      provider: new MemoryProjectStorageProvider(),
    })).toThrow("malware-scanner");
    expect(createProjectStorageServiceFromEnv({
      NODE_ENV: "production", QKERN_PROJECT_STORAGE_ENABLED: "true",
    }, {
      repository: new MemoryProjectStorageRepository(),
      provider: new MemoryProjectStorageProvider(),
      scanner: new QuarantineOnlyProjectStorageScanner(),
    })).toBeDefined();
  });
});
