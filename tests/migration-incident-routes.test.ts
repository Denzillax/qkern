import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createAcknowledgeMigrationIncidentHandler } from "@/app/api/v1/migrations/incidents/[incidentId]/acknowledgement/route";
import { createRequestMigrationIncidentDeliveryRetryHandler } from "@/app/api/v1/migrations/incidents/[incidentId]/delivery/retry/route";
import { createRequestMigrationIncidentResolutionVerificationHandler } from "@/app/api/v1/migrations/incidents/[incidentId]/resolution/verification/route";
import { createMigrationIncidentDeliveryHealthHandler } from "@/app/api/v1/migrations/incidents/delivery/health/route";
import { createListMigrationIncidentsHandler } from "@/app/api/v1/migrations/incidents/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { ResourceNotFoundError } from "@/lib/server/db/errors";
import type { MigrationIncidentService } from "@/lib/server/migrations/incident-service";
import {
  MigrationIncidentDeliveryNotRetryableError,
  MigrationIncidentResolutionNotVerifiableError,
} from "@/lib/server/migrations/incident-service";
import { tenancyService } from "@/lib/server/tenancy-service";

const INCIDENT_ID = "46e84eba-2e7a-42e6-a010-0fbf0c3de6ce";

async function ownerSession() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `incident-${nonce}@qkern.test`,
    password: "a sufficiently long incident route password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(registration.user);
  return registration.token;
}

function listRequest(token?: string, query = "") {
  return new NextRequest(`https://qkern.test/api/v1/migrations/incidents${query}`, {
    headers: token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {},
  });
}

function healthRequest(token?: string) {
  return new NextRequest("https://qkern.test/api/v1/migrations/incidents/delivery/health", {
    headers: token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {},
  });
}

function postRequest(
  token?: string,
  body = '{"acknowledgementCode":"investigation_started"}',
  origin = "https://qkern.test",
) {
  return new NextRequest(`https://qkern.test/api/v1/migrations/incidents/${INCIDENT_ID}/acknowledgement`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      ...(token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {}),
    },
    body,
  });
}

function retryRequest(
  token?: string,
  body = '{"reasonCode":"destination_recovered","expectedFailureCode":"DELIVERY_TIMEOUT","expectedRetryCycle":1}',
  origin = "https://qkern.test",
) {
  return new NextRequest(`https://qkern.test/api/v1/migrations/incidents/${INCIDENT_ID}/delivery/retry`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      ...(token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {}),
    },
    body,
  });
}

function resolutionRequest(
  token?: string,
  body = '{"reasonCode":"target_ledger_recheck"}',
  origin = "https://qkern.test",
) {
  return new NextRequest(`https://qkern.test/api/v1/migrations/incidents/${INCIDENT_ID}/resolution/verification`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      ...(token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {}),
    },
    body,
  });
}

const params = (incidentId = INCIDENT_ID) => ({ params: Promise.resolve({ incidentId }) });

function service(overrides: Partial<MigrationIncidentService> = {}): MigrationIncidentService {
  return {
    listIncidents: vi.fn().mockResolvedValue([]),
    getDeliveryHealth: vi.fn().mockResolvedValue({
      status: "healthy", measuredAt: "2026-07-17T00:00:00.000Z",
      totalCount: 0, pendingCount: 0, readyCount: 0, scheduledCount: 0,
      overduePendingCount: 0, expiredLeaseCount: 0, recoveryPendingCount: 0,
      inFlightCount: 0, publishedCount: 0, deadLetteredCount: 0, pendingRetryCommandCount: 0,
      recoveryExhaustedCount: 0,
      activeFailureCount: 0, activePublishFailedCount: 0, activeInvalidAckCount: 0,
      activeSigningKeyUnavailableCount: 0, activeDeliveryTimeoutCount: 0,
      activeDestinationRejectedCount: 0,
      policy: {
        overdueAfterSeconds: 300,
        deadLettersAreCritical: true,
        signingKeyFailuresAreCritical: true,
        activeDeliveryFailuresAreDegraded: true,
      },
    }),
    acknowledgeIncident: vi.fn().mockResolvedValue({ outcome: "acknowledged", incidentId: INCIDENT_ID }),
    requestDeliveryRetry: vi.fn().mockResolvedValue({
      outcome: "requested", incidentId: INCIDENT_ID, commandId: randomUUID(),
      expectedFailureCode: "DELIVERY_TIMEOUT",
      expectedRetryCycle: 1,
    }),
    requestResolutionVerification: vi.fn().mockResolvedValue({
      outcome: "requested", incidentId: INCIDENT_ID, commandId: randomUUID(),
    }),
    ...overrides,
  };
}

describe("migration incident routes", () => {
  it("lists bounded tenant incidents for an authorized operator", async () => {
    const token = await ownerSession();
    const incident = {
      incidentId: INCIDENT_ID, jobId: randomUUID(), projectId: randomUUID(), environment: "production" as const,
      changeSetId: randomUUID(), kind: "migration_outcome_unresolved" as const, severity: "critical" as const,
      status: "open" as const, detectedReviewCycle: 3, detectedReconciliationAttempt: 3,
      delivery: {
        eventId: randomUUID(), status: "dead_lettered" as const, attemptCount: 8,
        failureCount: 8, maxFailures: 8, lastFailureCode: "PUBLISH_FAILED" as const,
        deadLetteredAt: "2026-07-17T00:03:30.000Z", retryCycleCount: 0, maxRetryCycles: 3,
        availableAt: "2026-07-17T00:03:00.000Z", retryCommandPending: false,
      },
      createdAt: "2026-07-17T00:03:00.000Z", updatedAt: "2026-07-17T00:03:00.000Z",
    };
    const listIncidents = vi.fn().mockResolvedValue([incident]);
    const response = await createListMigrationIncidentsHandler(service({ listIncidents }))(
      listRequest(token, `?projectId=${incident.projectId}&status=open&limit=25`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ data: { incidents: [incident] } });
    expect(listIncidents).toHaveBeenCalledWith(expect.objectContaining({ organizationId: expect.any(String) }), {
      projectId: incident.projectId, status: "open", limit: 25,
    });
  });

  it("authenticates list requests before parsing attacker-controlled query input", async () => {
    const listIncidents = vi.fn();
    const response = await createListMigrationIncidentsHandler(service({ listIncidents }))(
      listRequest(undefined, "?limit=not-a-number&status=closed"),
    );
    expect(response.status).toBe(401);
    expect(listIncidents).not.toHaveBeenCalled();
  });

  it("accepts the worker-verified resolved incident filter", async () => {
    const token = await ownerSession();
    const listIncidents = vi.fn().mockResolvedValue([]);
    const response = await createListMigrationIncidentsHandler(service({ listIncidents }))(
      listRequest(token, "?status=resolved"),
    );
    expect(response.status).toBe(200);
    expect(listIncidents).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: expect.any(String) }),
      { status: "resolved" },
    );
  });

  it("returns tenant delivery health without exposing lease or provider details", async () => {
    const token = await ownerSession();
    const health = {
      status: "critical" as const,
      measuredAt: "2026-07-17T00:06:00.000Z",
      totalCount: 2, pendingCount: 0, readyCount: 0, scheduledCount: 0, inFlightCount: 0,
      overduePendingCount: 0, expiredLeaseCount: 0, recoveryPendingCount: 0,
      publishedCount: 1, deadLetteredCount: 1, pendingRetryCommandCount: 0,
      recoveryExhaustedCount: 0,
      activeFailureCount: 1, activePublishFailedCount: 0, activeInvalidAckCount: 0,
      activeSigningKeyUnavailableCount: 0, activeDeliveryTimeoutCount: 1,
      activeDestinationRejectedCount: 0,
      oldestDeadLetteredAt: "2026-07-17T00:04:00.000Z",
      latestDeadLetteredAt: "2026-07-17T00:04:00.000Z",
      policy: {
        overdueAfterSeconds: 300 as const,
        deadLettersAreCritical: true as const,
        signingKeyFailuresAreCritical: true as const,
        activeDeliveryFailuresAreDegraded: true as const,
      },
    };
    const getDeliveryHealth = vi.fn().mockResolvedValue(health);
    const response = await createMigrationIncidentDeliveryHealthHandler(service({ getDeliveryHealth }))(
      healthRequest(token),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ data: { deliveryHealth: health } });
    expect(getDeliveryHealth).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: expect.any(String),
    }));
    expect(JSON.stringify(health)).not.toMatch(/leaseOwner|leaseToken|token|provider|response|requestedBy/i);
  });

  it("authenticates delivery health before touching its service", async () => {
    const getDeliveryHealth = vi.fn();
    const response = await createMigrationIncidentDeliveryHealthHandler(service({ getDeliveryHealth }))(
      healthRequest(),
    );
    expect(response.status).toBe(401);
    expect(getDeliveryHealth).not.toHaveBeenCalled();
  });

  it.each([
    [{ outcome: "acknowledged", incidentId: INCIDENT_ID } as const, false],
    [{ outcome: "already_acknowledged", incidentId: INCIDENT_ID } as const, true],
  ])("maps acknowledgement outcome %# without changing a migration", async (result, idempotent) => {
    const token = await ownerSession();
    const acknowledgeIncident = vi.fn().mockResolvedValue(result);
    const response = await createAcknowledgeMigrationIncidentHandler(service({ acknowledgeIncident }))(
      postRequest(token), params(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { ...result, idempotent, executed: false } });
    expect(acknowledgeIncident).toHaveBeenCalledWith(expect.objectContaining({ organizationId: expect.any(String) }), {
      incidentId: INCIDENT_ID, acknowledgementCode: "investigation_started",
    });
  });

  it("requires same-origin, a fixed acknowledgement code, and a UUID incident id", async () => {
    const token = await ownerSession();
    const acknowledgeIncident = vi.fn();
    const handler = createAcknowledgeMigrationIncidentHandler(service({ acknowledgeIncident }));

    expect((await handler(postRequest(token, "{}"), params())).status).toBe(400);
    expect((await handler(postRequest(token, '{"acknowledgementCode":"resolved"}'), params())).status).toBe(400);
    expect((await handler(postRequest(token), params("not-a-uuid"))).status).toBe(404);
    expect((await handler(postRequest(token, undefined, "https://attacker.test"), params())).status).toBe(403);
    expect(acknowledgeIncident).not.toHaveBeenCalled();
  });

  it("hides unknown incident ids without leaking tenant state", async () => {
    const token = await ownerSession();
    const response = await createAcknowledgeMigrationIncidentHandler(service({
      acknowledgeIncident: vi.fn().mockRejectedValue(new ResourceNotFoundError("Migration incident")),
    }))(postRequest(token), params());
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Resource not found" });
  });

  it.each([
    [{ outcome: "requested", incidentId: INCIDENT_ID, commandId: randomUUID(), expectedFailureCode: "DELIVERY_TIMEOUT", expectedRetryCycle: 1 } as const, 202, false],
    [{ outcome: "already_requested", incidentId: INCIDENT_ID, commandId: randomUUID(), expectedFailureCode: "DELIVERY_TIMEOUT", expectedRetryCycle: 1 } as const, 200, true],
  ])("queues bounded delivery recovery without publishing in the request %#", async (result, status, idempotent) => {
    const token = await ownerSession();
    const requestDeliveryRetry = vi.fn().mockResolvedValue(result);
    const response = await createRequestMigrationIncidentDeliveryRetryHandler(service({ requestDeliveryRetry }))(
      retryRequest(token), params(),
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ data: { ...result, idempotent, executed: false } });
    expect(requestDeliveryRetry).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: expect.any(String) }),
      {
        incidentId: INCIDENT_ID,
        reasonCode: "destination_recovered",
        expectedFailureCode: "DELIVERY_TIMEOUT",
        expectedRetryCycle: 1,
      },
    );
  });

  it("requires same-origin, a fixed retry reason and a dead-lettered delivery", async () => {
    const token = await ownerSession();
    const requestDeliveryRetry = vi.fn();
    const handler = createRequestMigrationIncidentDeliveryRetryHandler(service({ requestDeliveryRetry }));

    expect((await handler(retryRequest(token, "{}"), params())).status).toBe(400);
    expect((await handler(retryRequest(token, '{"reasonCode":"retry_anyway"}'), params())).status).toBe(400);
    expect((await handler(retryRequest(
      token,
      '{"reasonCode":"credentials_rotated","expectedFailureCode":"DELIVERY_TIMEOUT","expectedRetryCycle":1}',
    ), params())).status).toBe(400);
    expect((await handler(retryRequest(
      token,
      '{"reasonCode":"destination_recovered","expectedFailureCode":"DELIVERY_TIMEOUT","expectedRetryCycle":11}',
    ), params())).status).toBe(400);
    expect((await handler(retryRequest(token), params("invalid"))).status).toBe(404);
    expect((await handler(retryRequest(token, undefined, "https://attacker.test"), params())).status).toBe(403);
    expect(requestDeliveryRetry).not.toHaveBeenCalled();

    const notRetryable = await createRequestMigrationIncidentDeliveryRetryHandler(service({
      requestDeliveryRetry: vi.fn().mockRejectedValue(new MigrationIncidentDeliveryNotRetryableError()),
    }))(retryRequest(token), params());
    expect(notRetryable.status).toBe(409);
  });

  it.each([
    [{ outcome: "requested", incidentId: INCIDENT_ID, commandId: randomUUID() } as const, 202, false],
    [{ outcome: "already_requested", incidentId: INCIDENT_ID, commandId: randomUUID() } as const, 200, true],
  ])("queues bounded resolution verification without executing in the request %#", async (result, status, idempotent) => {
    const token = await ownerSession();
    const requestResolutionVerification = vi.fn().mockResolvedValue(result);
    const response = await createRequestMigrationIncidentResolutionVerificationHandler(service({
      requestResolutionVerification,
    }))(resolutionRequest(token), params());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ data: { ...result, idempotent, executed: false } });
    expect(requestResolutionVerification).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: expect.any(String) }),
      { incidentId: INCIDENT_ID, reasonCode: "target_ledger_recheck" },
    );
  });

  it("requires same-origin, the fixed verification reason and an unresolved incident", async () => {
    const token = await ownerSession();
    const requestResolutionVerification = vi.fn();
    const handler = createRequestMigrationIncidentResolutionVerificationHandler(service({
      requestResolutionVerification,
    }));

    expect((await handler(resolutionRequest(token, "{}"), params())).status).toBe(400);
    expect((await handler(resolutionRequest(token, '{"reasonCode":"operator_confirmed"}'), params())).status).toBe(400);
    expect((await handler(resolutionRequest(token), params("invalid"))).status).toBe(404);
    expect((await handler(resolutionRequest(token, undefined, "https://attacker.test"), params())).status).toBe(403);
    expect(requestResolutionVerification).not.toHaveBeenCalled();

    const notVerifiable = await createRequestMigrationIncidentResolutionVerificationHandler(service({
      requestResolutionVerification: vi.fn().mockRejectedValue(
        new MigrationIncidentResolutionNotVerifiableError(),
      ),
    }))(resolutionRequest(token), params());
    expect(notVerifiable.status).toBe(409);
  });
});
