import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { handleSecurityAdvisor } from "@/app/api/v1/projects/[projectId]/environments/[environment]/advisors/security/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { DisabledProjectDataPlane, type ProjectDataPlanePort } from "@/lib/server/data-plane/service";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { ProjectStorageError, type ProjectStorageService } from "@/lib/server/project-storage/service";
import { tenancyService } from "@/lib/server/tenancy-service";
import { SECURITY_CHECK_REASONS, SECURITY_RULE_IDS } from "@/lib/console/security-advisor-texts";

/**
 * Die Route des Sicherheitsberaters (2.39): dieselbe Tuer wie
 * `/schema/policies`, nur lesend, und ein abgeschalteter Dienst macht aus
 * seinen Regeln "nicht geprueft", nie ein 500.
 */
const NOW = new Date("2026-09-26T12:00:00.000Z");

async function identity() {
  const nonce = randomUUID();
  const result = await authRuntime.service.register({
    email: `advisor-${nonce}@qkern.test`,
    password: "a sufficiently long security advisor route test password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(result.user);
  return result;
}

function port(overrides: Partial<ProjectDataPlanePort> = {}): ProjectDataPlanePort {
  return {
    inspectSchema: vi.fn().mockResolvedValue({ source: "postgres", schema: "public", truncated: false, tables: [
      { name: "open_orders", kind: "table", rowSecurityEnabled: false, columns: [], truncated: false },
      { name: "notes", kind: "table", rowSecurityEnabled: true, columns: [], truncated: false },
    ] }),
    inspectPolicies: vi.fn().mockResolvedValue({ source: "postgres", schema: "public", truncated: false, policies: [
      { name: "anyone", table: "notes", permissive: true, command: "select", roles: ["public"], usingExpression: "true", checkExpression: null },
    ] }),
    queryReadOnly: vi.fn(), inspectTriggers: vi.fn(), inspectFunctions: vi.fn(), inspectIndexes: vi.fn(), inspectEnumTypes: vi.fn(),
    inspectExtensions: vi.fn(), inspectRoles: vi.fn(), inspectPublications: vi.fn(), inspectColumnPrivileges: vi.fn(),
    ...overrides,
  } as ProjectDataPlanePort;
}

function storage(listBuckets: ReturnType<typeof vi.fn>) {
  return () => ({ listBuckets }) as unknown as ProjectStorageService;
}

function keys(list: ReturnType<typeof vi.fn>) {
  return { list, authenticate: vi.fn() } as unknown as ProjectApiKeyService;
}

const params = (environment = "production") => ({ params: Promise.resolve({ projectId: "project", environment }) });
const url = (environment = "production", query = "") =>
  `https://qkern.test/api/v1/projects/project/environments/${environment}/advisors/security${query}`;

describe("security advisor route", () => {
  it("returns findings, checks and checkedAt with no-store for a console session", async () => {
    const principal = await identity();
    const dataPlane = port();
    const listBuckets = vi.fn().mockResolvedValue([{ name: "avatars", readPolicy: "public", writePolicy: "owner", allowedMimeTypes: [] }]);
    const listKeys = vi.fn().mockResolvedValue([{ id: "k1", name: "backend", kind: "service", expiresAt: "2027-01-01T00:00:00.000Z", revokedAt: null }]);
    const response = await handleSecurityAdvisor(new NextRequest(url(), {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), params(), { dataPlane, storage: storage(listBuckets), keys: keys(listKeys), now: () => NOW });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json() as { data: { findings: Array<{ id: string }>; checks: Array<{ rule: string; ran: boolean }>; checkedAt: string } };
    expect(Object.keys(body.data).sort()).toEqual(["checkedAt", "checks", "findings"]);
    expect(body.data.checkedAt).toBe(NOW.toISOString());
    expect(body.data.findings.map((item) => item.id)).toEqual([
      "policy_always_true:policy:notes.anyone", "rls_disabled:table:open_orders", "bucket_public_read:bucket:avatars", "api_key_broad:api_key:k1",
    ]);
    expect(body.data.checks.map((item) => item.rule)).toEqual([...SECURITY_RULE_IDS]);
    expect(body.data.checks.filter((item) => !item.ran).map((item) => item.rule)).toEqual(["auth_provider_unverified_email"]);
    expect(dataPlane.inspectSchema).toHaveBeenCalledWith(
      expect.objectContaining({ actorRef: principal.user.email }), { projectId: "project", environment: "production" }, "public");
    expect(dataPlane.inspectPolicies).toHaveBeenCalledWith(expect.anything(), expect.anything(), "public");
    expect(listBuckets).toHaveBeenCalledWith(
      expect.objectContaining({ role: "admin", subject: principal.user.id }),
      expect.objectContaining({ projectId: "project", environment: "production" }));
    expect(listKeys).toHaveBeenCalledWith(expect.objectContaining({ actor: { id: principal.user.id, ref: principal.user.email } }), "project", "production");
  });

  it("rejects any query parameter before touching a service", async () => {
    const principal = await identity();
    const dataPlane = port();
    const listBuckets = vi.fn();
    const response = await handleSecurityAdvisor(new NextRequest(url("production", "?schema=public"), {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), params(), { dataPlane, storage: storage(listBuckets), keys: keys(vi.fn()) });
    expect(response.status).toBe(400);
    expect(dataPlane.inspectSchema).not.toHaveBeenCalled();
    expect(listBuckets).not.toHaveBeenCalled();
    const badEnvironment = await handleSecurityAdvisor(new NextRequest(url("preview")), params("preview"), { dataPlane });
    expect(badEnvironment.status).toBe(400);
  });

  it("denies anonymous callers and callers with a foreign session", async () => {
    const dataPlane = port();
    const listBuckets = vi.fn();
    const anonymous = await handleSecurityAdvisor(new NextRequest(url()), params(), { dataPlane, storage: storage(listBuckets), keys: keys(vi.fn()) });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("cache-control")).toBe("private, no-store");
    const forged = await handleSecurityAdvisor(new NextRequest(url(), {
      headers: { cookie: `${SESSION_COOKIE_NAME}=not-a-session` },
    }), params(), { dataPlane, storage: storage(listBuckets), keys: keys(vi.fn()) });
    expect(forged.status).toBe(401);
    expect(dataPlane.inspectSchema).not.toHaveBeenCalled();
    expect(listBuckets).not.toHaveBeenCalled();
  });

  it("turns a disabled storage and a disabled data plane into checks that did not run", async () => {
    const principal = await identity();
    const listBuckets = vi.fn().mockRejectedValue(new ProjectStorageError("PROJECT_STORAGE_DISABLED"));
    const response = await handleSecurityAdvisor(new NextRequest(url("development"), {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), params("development"), { dataPlane: new DisabledProjectDataPlane(), storage: storage(listBuckets), keys: keys(vi.fn().mockResolvedValue([])), now: () => NOW });
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { findings: unknown[]; checks: Array<{ rule: string; ran: boolean; reason?: string }> } };
    expect(body.data.findings).toEqual([]);
    const byRule = Object.fromEntries(body.data.checks.map((item) => [item.rule, item]));
    expect(byRule.bucket_public_read).toEqual({ rule: "bucket_public_read", ran: false, reason: SECURITY_CHECK_REASONS.storageDisabled });
    expect(byRule.bucket_authenticated_write_any_type).toEqual({ rule: "bucket_authenticated_write_any_type", ran: false, reason: SECURITY_CHECK_REASONS.storageDisabled });
    expect(byRule.rls_disabled).toEqual({ rule: "rls_disabled", ran: false, reason: SECURITY_CHECK_REASONS.databaseDisabled });
    expect(byRule.api_key_broad).toEqual({ rule: "api_key_broad", ran: true, reason: SECURITY_CHECK_REASONS.productionOnly });
  });

  it("keeps a failing storage provider out of the status code", async () => {
    const principal = await identity();
    const listBuckets = vi.fn().mockRejectedValue(new ProjectStorageError("STORAGE_PROVIDER_UNAVAILABLE"));
    const response = await handleSecurityAdvisor(new NextRequest(url(), {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), params(), { dataPlane: port(), storage: storage(listBuckets), keys: keys(vi.fn().mockResolvedValue([])) });
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { checks: Array<{ rule: string; ran: boolean; reason?: string }> } };
    expect(body.data.checks.find((item) => item.rule === "bucket_public_read")).toEqual({
      rule: "bucket_public_read", ran: false, reason: SECURITY_CHECK_REASONS.storageUnavailable,
    });
  });
});
