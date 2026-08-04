import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createApplyChangeSetHandler } from "@/app/api/v1/changesets/[changeSetId]/apply/route";
import { authRuntime } from "@/lib/server/auth/runtime";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { ChangeSetNotApprovedError, type ChangeSetApplyService } from "@/lib/server/migrations/apply-service";
import { ProductionApplyBlockedError } from
  "@/lib/server/migrations/production-apply-authorization";
import { ResourceNotFoundError } from "@/lib/server/db/errors";
import { tenancyService } from "@/lib/server/tenancy-service";

async function ownerSession() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `apply-${nonce}@qkern.test`,
    password: "a sufficiently long apply route password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(registration.user);
  return registration.token;
}

function request(token?: string, body = "{}", origin = "https://qkern.test") {
  return new NextRequest("https://qkern.test/api/v1/changesets/chg_test/apply", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      ...(token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {}),
    },
    body,
  });
}

const params = (changeSetId = "chg_test") => ({ params: Promise.resolve({ changeSetId }) });

describe("Change Set apply route", () => {
  it.each([
    [{ outcome: "queued", changeSetId: "chg_test", jobId: "job_1" } as const, 202, false],
    [{ outcome: "already_queued", changeSetId: "chg_test", jobId: "job_1" } as const, 200, true],
    [{ outcome: "already_applied", changeSetId: "chg_test" } as const, 200, true],
  ])("maps queue outcome %# to its idempotent HTTP contract", async (result, expectedStatus, idempotent) => {
    const token = await ownerSession();
    const service: ChangeSetApplyService = { queueApprovedChangeSet: vi.fn().mockResolvedValue(result) };
    const response = await createApplyChangeSetHandler(service)(request(token), params());
    expect(response.status).toBe(expectedStatus);
    await expect(response.json()).resolves.toMatchObject({ data: { ...result, idempotent } });
    expect(service.queueApprovedChangeSet).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: expect.any(String), actor: expect.objectContaining({ type: "user" }) }),
      { changeSetId: "chg_test" },
    );
  });

  it("authenticates before parsing the body or calling the queue", async () => {
    const service: ChangeSetApplyService = { queueApprovedChangeSet: vi.fn() };
    const response = await createApplyChangeSetHandler(service)(request(undefined, "{malformed"), params());
    expect(response.status).toBe(401);
    expect(service.queueApprovedChangeSet).not.toHaveBeenCalled();
  });

  it("requires same-origin and a strict empty JSON body", async () => {
    const token = await ownerSession();
    const service: ChangeSetApplyService = { queueApprovedChangeSet: vi.fn() };
    const crossOrigin = await createApplyChangeSetHandler(service)(request(token, "{}", "https://attacker.test"), params());
    expect(crossOrigin.status).toBe(403);
    const malformed = await createApplyChangeSetHandler(service)(request(token, "{malformed"), params());
    expect(malformed.status).toBe(400);
    expect(service.queueApprovedChangeSet).not.toHaveBeenCalled();
  });

  it.each([
    [new ResourceNotFoundError("Change Set"), 404, "Resource not found"],
    [new ChangeSetNotApprovedError(), 409, "Change Set is not approved"],
    [new ProductionApplyBlockedError(), 409, "Production apply is not authorized"],
  ])("maps domain failure %# without leaking tenant existence", async (failure, status, message) => {
    const token = await ownerSession();
    const service: ChangeSetApplyService = { queueApprovedChangeSet: vi.fn().mockRejectedValue(failure) };
    const response = await createApplyChangeSetHandler(service)(request(token), params());
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: message });
  });

  it("returns the same non-enumerating 404 for invalid resource identifiers", async () => {
    const token = await ownerSession();
    const service: ChangeSetApplyService = { queueApprovedChangeSet: vi.fn() };
    const response = await createApplyChangeSetHandler(service)(request(token), params("x"));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Resource not found" });
    expect(service.queueApprovedChangeSet).not.toHaveBeenCalled();
  });
});
