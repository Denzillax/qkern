import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import { domainErrorCode } from "@/lib/server/domain-errors";
import { isCompatibleMigrationOutboxDeliveryRetry } from "@/lib/server/db/models";
import type { MigrationApplyDeliveryService } from "@/lib/server/migrations/apply-delivery-service";
import { migrationApplyDeliveryService } from "@/lib/server/migrations/apply-delivery-runtime";
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
    "PUBLISH_FAILED", "INVALID_ACK", "SIGNING_KEY_UNAVAILABLE",
    "DELIVERY_TIMEOUT", "DESTINATION_REJECTED",
  ]),
  expectedRetryCycle: z.number().int().min(0).max(10),
}).strict();
const jobIdSchema = z.string().uuid();
const notFound = () => NextResponse.json({ error: "Resource not found" }, { status: 404 });

export function createRequestMigrationApplyDeliveryRetryHandler(service: MigrationApplyDeliveryService) {
  return async function POST(
    request: NextRequest,
    routeContext: { params: Promise<{ jobId: string }> },
  ) {
    if (!hasTrustedOrigin(request)) return csrfRejected();
    try {
      const principal = await authenticatedContext(request);
      requireCapability(principal, "migration_apply_delivery_retry");
      const body = bodySchema.safeParse(await safeJson(request));
      if (!body.success || !isCompatibleMigrationOutboxDeliveryRetry(
        body.data.reasonCode,
        body.data.expectedFailureCode,
      )) {
        return NextResponse.json({ error: "Invalid migration delivery retry request" }, { status: 400 });
      }
      const jobId = jobIdSchema.safeParse((await routeContext.params).jobId);
      if (!jobId.success) return notFound();
      const result = await service.requestRetry(asControlPlaneContext(principal), {
        migrationJobId: jobId.data,
        reasonCode: body.data.reasonCode,
        expectedFailureCode: body.data.expectedFailureCode,
        expectedRetryCycle: body.data.expectedRetryCycle,
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
      if (code === "MIGRATION_APPLY_DELIVERY_NOT_RETRYABLE" || code === "MIGRATION_NOT_READY") {
        return NextResponse.json({ error: "Migration delivery cannot be retried" }, { status: 409 });
      }
      if (code === "DEPENDENCY_UNAVAILABLE") {
        return NextResponse.json({ error: "Migration delivery service unavailable" }, { status: 503 });
      }
      return NextResponse.json({ error: "Could not request migration delivery retry" }, { status: 500 });
    }
  };
}

export const POST = createRequestMigrationApplyDeliveryRetryHandler(migrationApplyDeliveryService);
