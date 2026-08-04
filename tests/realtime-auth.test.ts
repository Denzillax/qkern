import { describe, expect, it } from "vitest";
import { ProjectRealtimeAuthenticator } from "@/lib/server/realtime/auth";

const scope = { projectId: "project-realtime", environment: "development" as const };

describe("Realtime authentication", () => {
  it("derives anonymous and service principals only from scoped Project API keys", async () => {
    const keys = {
      async authenticate(secret: string) {
        if (secret === "invalid") return null;
        return {
          id: secret.includes("service") ? "service-key" : "public-key",
          organizationId: "org-realtime", projectId: scope.projectId, environment: scope.environment,
          kind: secret.includes("service") ? "service" as const : "public" as const,
          expiresAt: "2027-01-01T00:00:00.000Z",
        };
      },
    };
    const authenticator = new ProjectRealtimeAuthenticator(keys, () => ({
      async verifyAccess() { throw new Error("not expected"); },
    }));

    await expect(authenticator.authenticate(scope, { projectKey: "public" })).resolves.toMatchObject({
      scope: { organizationId: "org-realtime", ...scope },
      principal: { role: "anon", subject: "public-key" },
    });
    await expect(authenticator.authenticate(scope, { projectKey: "service" })).resolves.toMatchObject({
      principal: { role: "service_role", subject: "service-key" },
    });
  });

  it("uses a verified Project Auth access token for an authenticated principal", async () => {
    const calls: unknown[] = [];
    const authenticator = new ProjectRealtimeAuthenticator({
      async authenticate() {
        return {
          id: "public-key", organizationId: "org-realtime", projectId: scope.projectId,
          environment: scope.environment, kind: "public", expiresAt: "2027-01-01T00:00:00.000Z",
        };
      },
    }, () => ({
      async verifyAccess(verifiedScope, token) {
        calls.push({ verifiedScope, token });
        return { user: { id: "alice" } } as never;
      },
    }));

    await expect(authenticator.authenticate(scope, {
      projectKey: "public", accessToken: "secret-access-token",
    })).resolves.toMatchObject({
      principal: { role: "authenticated", subject: "alice", actorRef: "project-auth-user:alice" },
    });
    expect(calls).toEqual([{
      verifiedScope: { organizationId: "org-realtime", ...scope }, token: "secret-access-token",
    }]);
  });

  it("returns one generic error for invalid, cross-project and token failures", async () => {
    const authenticator = new ProjectRealtimeAuthenticator({
      async authenticate(secret: string) {
        if (secret === "missing") return null;
        return {
          id: "key", organizationId: "org-realtime", projectId: "wrong-project",
          environment: scope.environment, kind: "public" as const, expiresAt: "2027-01-01T00:00:00.000Z",
        };
      },
    }, () => ({ async verifyAccess() { throw new Error("invalid token"); } }));

    await expect(authenticator.authenticate(scope, { projectKey: "missing" }))
      .rejects.toMatchObject({ code: "REALTIME_AUTH_FAILED" });
    await expect(authenticator.authenticate(scope, { projectKey: "wrong-project" }))
      .rejects.toMatchObject({ code: "REALTIME_AUTH_FAILED" });
  });
});
