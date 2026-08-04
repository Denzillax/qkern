import { describe, expect, it, vi } from "vitest";
import type { ControlPlaneService } from "@/lib/server/control-plane/model";
import { InvalidRecordError } from "@/lib/server/db/errors";
import {
  hashProjectApiKey,
  MemoryProjectApiKeyStore,
  ProjectApiKeyService,
} from "@/lib/server/project-api-keys/service";

const context = { organizationId: "org-1", actor: { id: "user-1", ref: "owner@example.ch" } };
const now = new Date("2026-08-03T10:00:00.000Z");
const publicSecret = `qk_public_${"a".repeat(43)}`;

function fixture() {
  const controlPlane = {
    getProjectEnvironment: vi.fn().mockResolvedValue({ id: "project-1", environment: "development" }),
  } as unknown as ControlPlaneService;
  const store = new MemoryProjectApiKeyStore();
  const service = new ProjectApiKeyService(
    controlPlane, store, store, () => publicSecret, () => now, () => "key-1",
  );
  return { service, store, controlPlane };
}

describe("project API keys", () => {
  it("returns the secret once, stores only a verifier and authenticates the exact scope", async () => {
    const built = fixture();
    const created = await built.service.create(context, {
      projectId: "project-1", environment: "development", name: "Browser public key",
      kind: "public", expiresAt: "2026-09-01T10:00:00.000Z",
    });
    expect(created.secret).toBe(publicSecret);
    expect(created.key).not.toHaveProperty("tokenHash");
    expect(created.key.prefix).toBe(publicSecret.slice(0, 22));
    expect(JSON.stringify(await built.service.list(context, "project-1", "development")))
      .not.toContain(publicSecret);
    await expect(built.service.authenticate(publicSecret)).resolves.toMatchObject({
      id: "key-1", organizationId: "org-1", projectId: "project-1",
      environment: "development", kind: "public",
    });
    expect(hashProjectApiKey(publicSecret)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("revokes irreversibly and rejects malformed or excessive expiry", async () => {
    const built = fixture();
    await built.service.create(context, {
      projectId: "project-1", environment: "development", name: "Public",
      kind: "public", expiresAt: "2026-09-01T10:00:00.000Z",
    });
    const revoked = await built.service.revoke(context, "project-1", "development", "key-1");
    expect(revoked.revokedAt).not.toBeNull();
    await expect(built.service.authenticate(publicSecret)).resolves.toBeNull();
    await expect(built.service.revoke(context, "project-1", "development", "key-1"))
      .resolves.toMatchObject({ revokedAt: revoked.revokedAt });

    await expect(built.service.create(context, {
      projectId: "project-1", environment: "development", name: "Too long",
      kind: "public", expiresAt: "2028-09-01T10:00:00.000Z",
    })).rejects.toBeInstanceOf(InvalidRecordError);
    await expect(built.service.authenticate("qk_public_not-a-key")).resolves.toBeNull();
  });
});
