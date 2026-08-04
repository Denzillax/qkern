import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as getConsole } from "@/app/api/v1/console/route";
import { authRuntime } from "@/lib/server/auth/runtime";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { requireCapability, RequestAuthorizationError } from "@/lib/server/request-context";
import { tenancyRuntime, type Membership } from "@/lib/server/tenancy";
import type { PublicAuthUser } from "@/lib/server/auth/model";

function principal(role: Membership["role"]) {
  const user: PublicAuthUser = { id: crypto.randomUUID(), email: "role@qkern.test", status: "active", createdAt: new Date() };
  return { user, membership: { organization: { id: crypto.randomUUID(), name: "Role Test", slug: "role-test" }, userId: user.id, role } };
}

describe("session-derived request context", () => {
  it("enforces the capability matrix server-side", () => {
    expect(() => requireCapability(principal("owner"), "approve")).not.toThrow();
    expect(() => requireCapability(principal("read_only"), "approve")).toThrow(RequestAuthorizationError);
    expect(() => requireCapability(principal("owner"), "apply")).not.toThrow();
    expect(() => requireCapability(principal("administrator"), "apply")).not.toThrow();
    expect(() => requireCapability(principal("deployer"), "apply")).not.toThrow();
    expect(() => requireCapability(principal("developer"), "apply")).toThrow(RequestAuthorizationError);
    expect(() => requireCapability(principal("owner"), "migration_review")).not.toThrow();
    expect(() => requireCapability(principal("administrator"), "migration_review")).not.toThrow();
    expect(() => requireCapability(principal("deployer"), "migration_review")).toThrow(RequestAuthorizationError);
    expect(() => requireCapability(principal("support"), "migration_review")).toThrow(RequestAuthorizationError);
    expect(() => requireCapability(principal("owner"), "migration_incident_read")).not.toThrow();
    expect(() => requireCapability(principal("administrator"), "migration_incident_ack")).not.toThrow();
    expect(() => requireCapability(principal("support"), "migration_incident_read")).not.toThrow();
    expect(() => requireCapability(principal("support"), "migration_incident_ack")).toThrow(RequestAuthorizationError);
    expect(() => requireCapability(principal("owner"), "migration_incident_delivery_retry")).not.toThrow();
    expect(() => requireCapability(principal("administrator"), "migration_incident_delivery_retry")).not.toThrow();
    expect(() => requireCapability(principal("support"), "migration_incident_delivery_retry")).toThrow(RequestAuthorizationError);
    expect(() => requireCapability(principal("owner"), "migration_apply_delivery_read")).not.toThrow();
    expect(() => requireCapability(principal("administrator"), "migration_apply_delivery_retry")).not.toThrow();
    expect(() => requireCapability(principal("deployer"), "migration_apply_delivery_read")).not.toThrow();
    expect(() => requireCapability(principal("support"), "migration_apply_delivery_read")).not.toThrow();
    expect(() => requireCapability(principal("deployer"), "migration_apply_delivery_retry")).toThrow(RequestAuthorizationError);
    expect(() => requireCapability(principal("support"), "migration_apply_delivery_retry")).toThrow(RequestAuthorizationError);
    expect(() => requireCapability(principal("owner"), "migration_incident_resolve")).not.toThrow();
    expect(() => requireCapability(principal("administrator"), "migration_incident_resolve")).not.toThrow();
    expect(() => requireCapability(principal("support"), "migration_incident_resolve")).toThrow(RequestAuthorizationError);
    expect(() => requireCapability(principal("deployer"), "migration_incident_resolve")).toThrow(RequestAuthorizationError);
    expect(() => requireCapability(principal("deployer"), "migration_incident_read")).toThrow(RequestAuthorizationError);
    expect(() => requireCapability(principal("owner"), "project_provisioning_request")).not.toThrow();
    expect(() => requireCapability(principal("administrator"), "project_provisioning_request")).not.toThrow();
    expect(() => requireCapability(principal("deployer"), "project_provisioning_read")).not.toThrow();
    expect(() => requireCapability(principal("support"), "project_provisioning_read")).not.toThrow();
    expect(() => requireCapability(principal("deployer"), "project_provisioning_request"))
      .toThrow(RequestAuthorizationError);
    expect(() => requireCapability(principal("developer"), "project_provisioning_read"))
      .toThrow(RequestAuthorizationError);
    expect(() => requireCapability(principal("owner"), "automation_policy")).not.toThrow();
    expect(() => requireCapability(principal("administrator"), "automation_policy")).not.toThrow();
    expect(() => requireCapability(principal("developer"), "automation_policy"))
      .toThrow(RequestAuthorizationError);
    expect(() => requireCapability(principal("owner"), "project_queues_admin")).not.toThrow();
    expect(() => requireCapability(principal("administrator"), "project_queues_admin")).not.toThrow();
    expect(() => requireCapability(principal("developer"), "project_queues_admin"))
      .toThrow(RequestAuthorizationError);
    expect(() => requireCapability(principal("deployer"), "project_queues_admin"))
      .toThrow(RequestAuthorizationError);
    expect(() => requireCapability(principal("support"), "project_queues_admin"))
      .toThrow(RequestAuthorizationError);
  });

  it("returns 401 without a session and hides forged organization ids", async () => {
    const anonymous = await getConsole(new NextRequest("https://qkern.test/api/v1/console"));
    expect(anonymous.status).toBe(401);

    const result = await authRuntime.service.register({
      email: `tenant-${crypto.randomUUID()}@qkern.test`, password: "long-secret-password", rateLimitKey: crypto.randomUUID(),
    });
    tenancyRuntime.ensureWorkspace(result.user);
    const forged = await getConsole(new NextRequest("https://qkern.test/api/v1/console", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${result.token}`, "x-qkern-organization": crypto.randomUUID() },
    }));
    expect(forged.status).toBe(404);

    const valid = await getConsole(new NextRequest("https://qkern.test/api/v1/console", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${result.token}` },
    }));
    expect(valid.status).toBe(200);
    await expect(valid.json()).resolves.toMatchObject({ user: { email: result.user.email }, organization: { id: expect.any(String) } });
  });
});
