import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import { domainErrorCode } from "@/lib/server/domain-errors";
import { isCompatibleIncidentDeliveryRetry } from "@/lib/server/db/models";
import type { MigrationIncidentService } from "@/lib/server/migrations/incident-service";
import { migrationIncidentService } from "@/lib/server/migrations/incident-runtime";
import {
  asControlPlaneContext,
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";

const bodySchema = z.object({
  reasonCode: z.enum(["destination_recovered", "credentials_rotated", "provider_incident_resolved"]),
  expectedFailureCode: z.enum([
    "PUBLISH_FAILED",
    "INVALID_ACK",
    "SIGNING_KEY_UNAVAILABLE",
    "DELIVERY_TIMEOUT",
    "DESTINATION_REJECTED",
  ]),
  expectedRetryCycle: z.number().int().min(0).max(10),
}).strict();
const incidentIdSchema = z.string().uuid();
const notFound = () => NextResponse.json({ error: "Resource not found" }, { status: 404 });

export function createRequestMigrationIncidentDeliveryRetryHandler(service: MigrationIncidentService) {
  return async function POST(
    request: NextRequest,
    routeContext: { params: Promise<{ incidentId: string }> },
  ) {
    if (!hasTrustedOrigin(request)) return csrfRejected();
    try {
      const principal = await authenticatedContext(request);
      requireCapability(principal, "migration_incident_delivery_retry");
      const parsedBody = bodySchema.safeParse(await safeJson(request));
      if (!parsedBody.success || !isCompatibleIncidentDeliveryRetry(
        parsedBody.data.reasonCode,
        parsedBody.data.expectedFailureCode,
      )) {
        return NextResponse.json({ error: "Invalid incident delivery retry request" }, { status: 400 });
      }
      const parsedIncidentId = incidentIdSchema.safeParse((await routeContext.params).incidentId);
      if (!parsedIncidentId.success) return notFound();
      const result = await service.requestDeliveryRetry(asControlPlaneContext(principal), {
        incidentId: parsedIncidentId.data,
        reasonCode: parsedBody.data.reasonCode,
        expectedFailureCode: parsedBody.data.expectedFailureCode,
        expectedRetryCycle: parsedBody.data.expectedRetryCycle,
      });
      const idempotent = result.outcome !== "requested";
      return NextResponse.json({ data: { ...result, idempotent, executed: false } }, {
        status: idempotent ? 200 : 202,
      });
    } catch (error) {
      if (error instanceof RequestAuthenticationError) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      }
      if (error instanceof RequestAuthorizationError) return notFound();
      const code = domainErrorCode(error);
      if (code === "RESOURCE_NOT_FOUND" || code === "INVALID_REFERENCE" || code === "INVALID_RECORD") {
        return notFound();
      }
      if (code === "MIGRATION_INCIDENT_DELIVERY_NOT_RETRYABLE" || code === "MIGRATION_NOT_READY") {
        return NextResponse.json({ error: "Incident delivery cannot be retried" }, { status: 409 });
      }
      if (code === "DEPENDENCY_UNAVAILABLE") {
        return NextResponse.json({ error: "Migration incident service unavailable" }, { status: 503 });
      }
      return NextResponse.json({ error: "Could not request incident delivery retry" }, { status: 500 });
    }
  };
}

export const POST = createRequestMigrationIncidentDeliveryRetryHandler(migrationIncidentService);
