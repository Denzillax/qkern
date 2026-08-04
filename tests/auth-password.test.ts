import { describe, expect, it } from "vitest";
import { Argon2idPasswordHasher } from "@/lib/server/auth/password";

describe("Argon2idPasswordHasher", () => {
  it("stores a PHC-style Argon2id hash and verifies without storing the password", async () => {
    const hasher = new Argon2idPasswordHasher({ memoryKiB: 8_192, passes: 2, parallelism: 2 });
    const hash = await hasher.hash("a-long-correct-horse-password");

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=8192,t=2,p=2\$/);
    expect(hash).not.toContain("correct-horse");
    await expect(hasher.verify("a-long-correct-horse-password", hash)).resolves.toBe(true);
    await expect(hasher.verify("the-wrong-password", hash)).resolves.toBe(false);
  });

  it("rejects malformed or attacker-sized hash parameters", async () => {
    const hasher = new Argon2idPasswordHasher({ memoryKiB: 8_192, passes: 2, parallelism: 2 });
    await expect(hasher.verify("anything", "not-a-password-hash")).resolves.toBe(false);
    await expect(hasher.verify("anything", "$argon2id$v=19$m=999999999,t=3,p=4$c2FsdHNhbHRzYWx0c2FsdA$dGFnZGF0YXRhZ2RhdGF0YWdkYXRh")).resolves.toBe(false);
  });
});
