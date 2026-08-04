import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createRequestMigrationReconciliationHandler } from "@/app/api/v1/migrations/[jobId]/review/reconciliation/route";
import { createListMigrationReviewsHandler } from "@/app/api/v1/migrations/reviews/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { ResourceNotFoundError } from "@/lib/server/db/errors";
import {
  MigrationReviewCyclesExhaustedError,
  type MigrationReviewService,
} from "@/lib/server/migrations/review-service";
import { tenancyService } from "@/lib/server/tenancy-service";

const JOB_ID = "940cb242-32d6-4ffd-b244-67d4913f7b91";
const COMMAND_ID = "f9b450be-f81c-41ef-9646-c11e8ed850d9";

async function ownerSession() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `review-${nonce}@qkern.test`,
    password: "a sufficiently long review route password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(registration.user);
  return registration.token;
}

function listRequest(token?: string, query = "") {
  return new NextRequest(`https://qkern.test/api/v1/migrations/reviews${query}`, {
    headers: token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {},
  });
}

function postRequest(token?: string, body = '{"reasonCode":"manual_recheck"}', origin = "https://qkern.test") {
  return new NextRequest(`https://qkern.test/api/v1/migrations/${JOB_ID}/review/reconciliation`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      ...(token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {}),
    },
    body,
  });
}

const params = (jobId = JOB_ID) => ({ params: Promise.resolve({ jobId }) });

function service(overrides: Partial<MigrationReviewService> = {}): MigrationReviewService {
  return {
    listReviews: vi.fn().mockResolvedValue([]),
    requestReconciliation: vi.fn().mockResolvedValue({ outcome: "requested", jobId: JOB_ID, commandId: COMMAND_ID }),
    ...overrides,
  };
}

describe("migration review routes", () => {
  it("lists bounded tenant reviews for an authorized operator", async () => {
    const token = await ownerSession();
    const review = {
      jobId: JOB_ID, projectId: randomUUID(), environment: "production" as const, changeSetId: randomUUID(),
      state: "review_required" as const, reconciliationAttempt: 3, maxReconciliationAttempts: 3,
      reviewCycle: 0, maxReviewCycles: 3, errorCode: "MIGRATION_NOT_APPLIED",
      finishedAt: "2026-07-17T00:01:00.000Z", updatedAt: "2026-07-17T00:01:00.000Z",
    };
    const listReviews = vi.fn().mockResolvedValue([review]);
    const response = await createListMigrationReviewsHandler(service({ listReviews }))(
      listRequest(token, `?projectId=${review.projectId}&limit=25`),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { reviews: [review] } });
    expect(listReviews).toHaveBeenCalledWith(expect.objectContaining({ organizationId: expect.any(String) }), {
      projectId: review.projectId, limit: 25,
    });
  });

  it("authenticates list requests before parsing attacker-controlled query input", async () => {
    const listReviews = vi.fn();
    const response = await createListMigrationReviewsHandler(service({ listReviews }))(
      listRequest(undefined, "?limit=not-a-number"),
    );
    expect(response.status).toBe(401);
    expect(listReviews).not.toHaveBeenCalled();
  });

  it.each([
    [{ outcome: "requested", jobId: JOB_ID, commandId: COMMAND_ID } as const, 202, false],
    [{ outcome: "already_requested", jobId: JOB_ID, commandId: COMMAND_ID } as const, 200, true],
    [{ outcome: "already_scheduled", jobId: JOB_ID } as const, 200, true],
    [{ outcome: "already_applied", jobId: JOB_ID } as const, 200, true],
  ])("maps reconciliation outcome %# without executing SQL", async (result, status, idempotent) => {
    const token = await ownerSession();
    const requestReconciliation = vi.fn().mockResolvedValue(result);
    const response = await createRequestMigrationReconciliationHandler(service({ requestReconciliation }))(
      postRequest(token),
      params(),
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ data: { ...result, idempotent, executed: false } });
    expect(requestReconciliation).toHaveBeenCalledWith(expect.objectContaining({ organizationId: expect.any(String) }), {
      jobId: JOB_ID, reasonCode: "manual_recheck",
    });
  });

  it("requires same-origin, a fixed reason code, and a UUID job id", async () => {
    const token = await ownerSession();
    const requestReconciliation = vi.fn();
    const handler = createRequestMigrationReconciliationHandler(service({ requestReconciliation }));

    expect((await handler(postRequest(token, '{}'), params())).status).toBe(400);
    expect((await handler(postRequest(token, '{"reasonCode":"free-form secret"}'), params())).status).toBe(400);
    expect((await handler(postRequest(token), params("not-a-uuid"))).status).toBe(404);
    expect((await handler(postRequest(token, undefined, "https://attacker.test"), params())).status).toBe(403);
    expect(requestReconciliation).not.toHaveBeenCalled();
  });

  it.each([
    [new ResourceNotFoundError("Migration job"), 404, "Resource not found"],
    [new MigrationReviewCyclesExhaustedError(), 409, "Migration review cannot be retried"],
  ])("maps review failure %# without leaking tenant state", async (failure, status, message) => {
    const token = await ownerSession();
    const response = await createRequestMigrationReconciliationHandler(service({
      requestReconciliation: vi.fn().mockRejectedValue(failure),
    }))(postRequest(token), params());
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: message });
  });
});
