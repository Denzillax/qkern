import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createGetMigrationApplyDeliveryHandler } from "@/app/api/v1/migrations/[jobId]/delivery/route";
import { createRequestMigrationApplyDeliveryRetryHandler } from "@/app/api/v1/migrations/[jobId]/delivery/retry/route";
import { createGetMigrationApplyDeliveryHealthHandler } from "@/app/api/v1/migrations/delivery/health/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { ResourceNotFoundError } from "@/lib/server/db/errors";
import type { MigrationApplyDeliveryService } from "@/lib/server/migrations/apply-delivery-service";
import { MigrationApplyDeliveryNotRetryableError } from "@/lib/server/migrations/apply-delivery-service";
import { tenancyService } from "@/lib/server/tenancy-service";

const JOB_ID = "940cb242-32d6-41fd-b244-67d4913f7b91";

async function ownerSession() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `apply-delivery-${nonce}@qkern.test`,
    password: "a sufficiently long apply delivery route password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(registration.user);
  return registration.token;
}

function request(path: string, token?: string, init: { method?: string; body?: string; origin?: string } = {}) {
  return new NextRequest(`https://qkern.test${path}`, {
    method: init.method,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.origin ? { origin: init.origin } : {}),
      ...(token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {}),
    },
    body: init.body,
  });
}

function service(overrides: Partial<MigrationApplyDeliveryService> = {}): MigrationApplyDeliveryService {
  return {
    getStatus: vi.fn().mockResolvedValue({
      migrationJobId: JOB_ID, eventId: randomUUID(), status: "pending", attemptCount: 1,
      failureCount: 0, maxFailures: 8, retryCycleCount: 0, maxRetryCycles: 3,
      availableAt: "2026-07-20T12:00:00.000Z", retryCommandPending: false,
    }),
    getHealth: vi.fn().mockResolvedValue({
      status: "healthy", measuredAt: "2026-07-20T12:00:00.000Z",
      totalCount: 0, pendingCount: 0, readyCount: 0, scheduledCount: 0, inFlightCount: 0,
      overduePendingCount: 0, expiredLeaseCount: 0, recoveryPendingCount: 0,
      publishedCount: 0, deadLetteredCount: 0, recoveryExhaustedCount: 0,
      pendingRetryCommandCount: 0, activeFailureCount: 0, activePublishFailedCount: 0,
      activeInvalidAckCount: 0, activeSigningKeyUnavailableCount: 0,
      activeDeliveryTimeoutCount: 0, activeDestinationRejectedCount: 0,
      policy: { overdueAfterSeconds: 300, deadLettersAreCritical: true, signingKeyFailuresAreCritical: true, activeDeliveryFailuresAreDegraded: true },
    }),
    requestRetry: vi.fn().mockResolvedValue({
      outcome: "requested", migrationJobId: JOB_ID, commandId: randomUUID(),
      expectedFailureCode: "DELIVERY_TIMEOUT", expectedRetryCycle: 1,
    }),
    ...overrides,
  };
}

const params = (jobId = JOB_ID) => ({ params: Promise.resolve({ jobId }) });

describe("migration apply delivery routes", () => {
  it("authenticates before reading tenant delivery health", async () => {
    const getHealth = vi.fn();
    const response = await createGetMigrationApplyDeliveryHealthHandler(service({ getHealth }))(
      request("/api/v1/migrations/delivery/health"),
    );
    expect(response.status).toBe(401);
    expect(getHealth).not.toHaveBeenCalled();
  });

  it("returns no-store redacted status and health", async () => {
    const token = await ownerSession();
    const statusService = service();
    const status = await createGetMigrationApplyDeliveryHandler(statusService)(
      request(`/api/v1/migrations/${JOB_ID}/delivery`, token), params(),
    );
    const health = await createGetMigrationApplyDeliveryHealthHandler(statusService)(
      request("/api/v1/migrations/delivery/health", token),
    );

    expect(status.status).toBe(200);
    expect(status.headers.get("cache-control")).toBe("private, no-store");
    expect(health.status).toBe(200);
    expect(health.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.stringify(await status.json())).not.toMatch(/lease|token|broker|credential|provider|response/i);
  });

  it.each([
    ["requested", 202, false],
    ["already_requested", 200, true],
  ] as const)("maps retry outcome %s without publishing or executing SQL", async (outcome, expectedStatus, idempotent) => {
    const token = await ownerSession();
    const result = {
      outcome, migrationJobId: JOB_ID, commandId: randomUUID(),
      expectedFailureCode: "DELIVERY_TIMEOUT" as const, expectedRetryCycle: 1,
    };
    const requestRetry = vi.fn().mockResolvedValue(result);
    const response = await createRequestMigrationApplyDeliveryRetryHandler(service({ requestRetry }))(
      request(`/api/v1/migrations/${JOB_ID}/delivery/retry`, token, {
        method: "POST", origin: "https://qkern.test",
        body: '{"reasonCode":"destination_recovered","expectedFailureCode":"DELIVERY_TIMEOUT","expectedRetryCycle":1}',
      }), params(),
    );

    expect(response.status).toBe(expectedStatus);
    await expect(response.json()).resolves.toEqual({ data: { ...result, idempotent, executed: false } });
    expect(requestRetry).toHaveBeenCalledWith(expect.objectContaining({ organizationId: expect.any(String) }), {
      migrationJobId: JOB_ID, reasonCode: "destination_recovered",
      expectedFailureCode: "DELIVERY_TIMEOUT", expectedRetryCycle: 1,
    });
  });

  it("rejects cross-origin, extra fields, incompatible reasons and invalid job ids before the service", async () => {
    const token = await ownerSession();
    const requestRetry = vi.fn();
    const handler = createRequestMigrationApplyDeliveryRetryHandler(service({ requestRetry }));
    const body = '{"reasonCode":"credentials_rotated","expectedFailureCode":"DELIVERY_TIMEOUT","expectedRetryCycle":1}';
    const extra = '{"reasonCode":"destination_recovered","expectedFailureCode":"DELIVERY_TIMEOUT","expectedRetryCycle":1,"sql":"DROP TABLE users"}';

    expect((await handler(request(`/api/v1/migrations/${JOB_ID}/delivery/retry`, token, { method: "POST", origin: "https://attacker.test", body }), params())).status).toBe(403);
    expect((await handler(request(`/api/v1/migrations/${JOB_ID}/delivery/retry`, token, { method: "POST", origin: "https://qkern.test", body }), params())).status).toBe(400);
    expect((await handler(request(`/api/v1/migrations/${JOB_ID}/delivery/retry`, token, { method: "POST", origin: "https://qkern.test", body: extra }), params())).status).toBe(400);
    expect((await handler(request("/api/v1/migrations/not-a-uuid/delivery/retry", token, { method: "POST", origin: "https://qkern.test", body: '{"reasonCode":"destination_recovered","expectedFailureCode":"DELIVERY_TIMEOUT","expectedRetryCycle":1}' }), params("not-a-uuid"))).status).toBe(404);
    expect(requestRetry).not.toHaveBeenCalled();
  });

  it("hides unknown jobs and maps changed generations to conflict", async () => {
    const token = await ownerSession();
    const unknown = await createGetMigrationApplyDeliveryHandler(service({
      getStatus: vi.fn().mockRejectedValue(new ResourceNotFoundError("Migration delivery")),
    }))(request(`/api/v1/migrations/${JOB_ID}/delivery`, token), params());
    expect(unknown.status).toBe(404);

    const conflict = await createRequestMigrationApplyDeliveryRetryHandler(service({
      requestRetry: vi.fn().mockRejectedValue(new MigrationApplyDeliveryNotRetryableError()),
    }))(request(`/api/v1/migrations/${JOB_ID}/delivery/retry`, token, {
      method: "POST", origin: "https://qkern.test",
      body: '{"reasonCode":"destination_recovered","expectedFailureCode":"DELIVERY_TIMEOUT","expectedRetryCycle":1}',
    }), params());
    expect(conflict.status).toBe(409);
  });
});
