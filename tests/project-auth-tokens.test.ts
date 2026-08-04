import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ProjectAuthTokenError, ProjectAuthTokenService } from "@/lib/server/project-auth/tokens";

const scope = { organizationId: "org-1", projectId: "project-1", environment: "development" as const };
const now = new Date("2026-08-03T12:00:00.000Z");

describe("Project Auth Ed25519 tokens", () => {
  it("publishes JWKS, verifies exact scope and rejects tampering or expiry", () => {
    const current = generateKeyPairSync("ed25519");
    const previous = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" });
    const service = new ProjectAuthTokenService(
      { kid: "current-key", privateKey: current.privateKey }, "https://qkern.test",
      [{ ...previous, kid: "previous-key" }], 900,
    );
    const user = {
      ...scope, id: "user-1", email: "user@example.test", passwordHash: null, status: "active" as const,
      emailVerifiedAt: now, userMetadata: { locale: "de-CH" }, appMetadata: { plan: "free" },
      createdAt: now, updatedAt: now,
    };
    const session = {
      ...scope, id: "session-1", userId: user.id, familyId: "family-1", refreshTokenHash: "a".repeat(43),
      assurance: "aal1" as const, createdAt: now, expiresAt: new Date(now.getTime() + 86_400_000),
      revokedAt: null, replacedBySessionId: null, compromisedAt: null,
    };
    const issued = service.issue(scope, user, session, now);
    expect(service.verify(issued.accessToken, scope, now)).toMatchObject({
      sub: "user-1", session_id: "session-1", email_verified: true,
    });
    expect(service.jwks().keys.map((key) => key.kid).sort()).toEqual(["current-key", "previous-key"]);
    expect(() => service.verify(issued.accessToken, { ...scope, projectId: "other-project" }, now))
      .toThrow(ProjectAuthTokenError);
    expect(() => service.verify(`${issued.accessToken.slice(0, -1)}x`, scope, now)).toThrow(ProjectAuthTokenError);
    expect(() => service.verify(issued.accessToken, scope, new Date(now.getTime() + 901_000)))
      .toThrow(ProjectAuthTokenError);
  });
});
