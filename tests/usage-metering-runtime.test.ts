import { describe, expect, it } from "vitest";
import { ConfigurationError } from "@/lib/server/db/errors";
import { MemoryUsageRepository, type UsageRepository } from "@/lib/server/usage/repository";
import { createUsageServiceFromEnv } from "@/lib/server/usage/runtime";
import { UsageError } from "@/lib/server/usage/service";

function durableTestRepository() {
  const repository = new MemoryUsageRepository() as unknown as UsageRepository;
  Object.defineProperty(repository, "durability", { value: "durable" });
  return repository;
}

describe("Usage Metering runtime composition", () => {
  it("is disabled by default", () => {
    expect(() => createUsageServiceFromEnv({ NODE_ENV: "test" })).toThrow(UsageError);
  });

  it("uses an explicitly enabled ephemeral ledger outside production", () => {
    expect(createUsageServiceFromEnv({
      NODE_ENV: "test",
      QKERN_USAGE_METERING_ENABLED: "true",
    })).toBeDefined();
  });

  it("rejects ephemeral production persistence", () => {
    expect(() => createUsageServiceFromEnv({
      NODE_ENV: "production",
      QKERN_USAGE_METERING_ENABLED: "true",
    }, { repository: new MemoryUsageRepository() })).toThrow(ConfigurationError);
  });

  it("accepts only an explicitly durable production repository", () => {
    expect(createUsageServiceFromEnv({
      NODE_ENV: "production",
      QKERN_USAGE_METERING_ENABLED: "true",
    }, { repository: durableTestRepository() })).toBeDefined();
  });
});
