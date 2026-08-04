import { describe, expect, it } from "vitest";
import { ConfigurationError } from "@/lib/server/db/errors";
import {
  MemoryProjectQueueRepository,
  type ProjectQueueRepository,
} from "@/lib/server/project-queues/repository";
import { createProjectQueueServiceFromEnv } from "@/lib/server/project-queues/runtime";
import { ProjectQueueError } from "@/lib/server/project-queues/service";

function durableTestRepository() {
  const repository = new MemoryProjectQueueRepository() as unknown as ProjectQueueRepository;
  Object.defineProperty(repository, "durability", { value: "durable" });
  return repository;
}

describe("Project Queues runtime composition", () => {
  it("is disabled by default", () => {
    expect(() => createProjectQueueServiceFromEnv({ NODE_ENV: "test" })).toThrow(ProjectQueueError);
  });

  it("uses an explicitly enabled ephemeral repository outside production", () => {
    expect(createProjectQueueServiceFromEnv({
      NODE_ENV: "test",
      QKERN_PROJECT_QUEUES_ENABLED: "true",
      QKERN_PROJECT_QUEUES_ALLOWED_ORIGINS: "http://localhost:3000",
    })).toBeDefined();
  });

  it("accepts only exact HTTPS origins in production and loopback HTTP in development", () => {
    expect(() => createProjectQueueServiceFromEnv({
      NODE_ENV: "test",
      QKERN_PROJECT_QUEUES_ENABLED: "true",
      QKERN_PROJECT_QUEUES_ALLOWED_ORIGINS: "http://127.0.0.1:3000",
    })).not.toThrow();
    expect(() => createProjectQueueServiceFromEnv({
      NODE_ENV: "production",
      QKERN_PROJECT_QUEUES_ENABLED: "true",
      QKERN_PROJECT_QUEUES_ALLOWED_ORIGINS: "http://localhost:3000",
    }, { repository: durableTestRepository() })).toThrow("exact HTTPS origins");
    expect(() => createProjectQueueServiceFromEnv({
      NODE_ENV: "production",
      QKERN_PROJECT_QUEUES_ENABLED: "true",
      QKERN_PROJECT_QUEUES_ALLOWED_ORIGINS: "https://app.example.test/path",
    }, { repository: durableTestRepository() })).toThrow(ConfigurationError);
  });

  it("rejects missing or explicitly ephemeral production repositories", () => {
    const production = { NODE_ENV: "production", QKERN_PROJECT_QUEUES_ENABLED: "true" };
    expect(() => createProjectQueueServiceFromEnv(production)).toThrow("QKERN_RUNTIME_MODE=postgres");
    expect(() => createProjectQueueServiceFromEnv(production, {
      repository: new MemoryProjectQueueRepository(),
    })).toThrow("durable broker repository");
  });

  it("requires the runtime database URL for the automatic PostgreSQL repository", () => {
    expect(() => createProjectQueueServiceFromEnv({
      NODE_ENV: "test",
      QKERN_PROJECT_QUEUES_ENABLED: "true",
      QKERN_RUNTIME_MODE: "postgres",
    })).toThrow("QKERN_RUNTIME_DATABASE_URL is required");
  });

  it("accepts an injected repository only when it declares durable semantics", () => {
    expect(createProjectQueueServiceFromEnv({
      NODE_ENV: "production",
      QKERN_PROJECT_QUEUES_ENABLED: "true",
      QKERN_PROJECT_QUEUES_ALLOWED_ORIGINS: "https://app.example.test",
    }, { repository: durableTestRepository() })).toBeDefined();
  });

  it("enforces bounded payload configuration", () => {
    const environment = { NODE_ENV: "test", QKERN_PROJECT_QUEUES_ENABLED: "true" };
    expect(() => createProjectQueueServiceFromEnv({
      ...environment, QKERN_PROJECT_QUEUES_MAX_PAYLOAD_BYTES: "255",
    })).toThrow(ConfigurationError);
    expect(() => createProjectQueueServiceFromEnv({
      ...environment, QKERN_PROJECT_QUEUES_MAX_PAYLOAD_BYTES: "262145",
    })).toThrow(ConfigurationError);
    expect(() => createProjectQueueServiceFromEnv({
      ...environment, QKERN_PROJECT_QUEUES_MAX_PAYLOAD_BYTES: "65536",
    })).not.toThrow();
  });
});
