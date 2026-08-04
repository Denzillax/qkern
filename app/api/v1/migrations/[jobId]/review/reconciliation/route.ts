import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import { domainErrorCode } from "@/lib/server/domain-errors";
import type { MigrationReviewService } from "@/lib/server/migrations/review-service";
import { migrationReviewService } from "@/lib/server/migrations/review-runtime";
import {
  asControlPlaneContext,
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";

const bodySchema = z.object({
  reasonCode: z.enum(["dependency_recovered", "manual_recheck", "incident_recovery"]),
}).strict();
const jobIdSchema = z.string().uuid();
const notFound = () => NextResponse.json({ error: "Resource not found" }, { status: 404 });

export function createRequestMigrationReconciliationHandler(service: MigrationReviewService) {
  return async function POST(
    request: NextRequest,
    routeContext: { params: Promise<{ jobId: string }> },
  ) {
    if (!hasTrustedOrigin(request)) return csrfRejected();
    try {
      const principal = await authenticatedContext(request);
      requireCapability(principal, "migration_review");
      const parsedBody = bodySchema.safeParse(await safeJson(request));
      if (!parsedBody.success) {
        return NextResponse.json({ error: "Invalid reconciliation request" }, { status: 400 });
      }
      const parsedJobId = jobIdSchema.safeParse((await routeContext.params).jobId);
      if (!parsedJobId.success) return notFound();
      const result = await service.requestReconciliation(asControlPlaneContext(principal), {
        jobId: parsedJobId.data,
        reasonCode: parsedBody.data.reasonCode,
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
      if (code === "MIGRATION_REVIEW_NOT_READY" || code === "MIGRATION_REVIEW_CYCLES_EXHAUSTED" ||
          code === "MIGRATION_NOT_READY") {
        return NextResponse.json({ error: "Migration review cannot be retried" }, { status: 409 });
      }
      if (code === "DEPENDENCY_UNAVAILABLE") {
        return NextResponse.json({ error: "Migration review service unavailable" }, { status: 503 });
      }
      return NextResponse.json({ error: "Could not request migration reconciliation" }, { status: 500 });
    }
  };
}

export const POST = createRequestMigrationReconciliationHandler(migrationReviewService);
