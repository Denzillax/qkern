import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { domainErrorCode } from "@/lib/server/domain-errors";
import type { MigrationApplyDeliveryService } from "@/lib/server/migrations/apply-delivery-service";
import { migrationApplyDeliveryService } from "@/lib/server/migrations/apply-delivery-runtime";
import {
  asControlPlaneContext,
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";

const jobIdSchema = z.string().uuid();
const notFound = () => NextResponse.json({ error: "Resource not found" }, { status: 404 });

export function createGetMigrationApplyDeliveryHandler(service: MigrationApplyDeliveryService) {
  return async function GET(
    request: NextRequest,
    routeContext: { params: Promise<{ jobId: string }> },
  ) {
    try {
      const principal = await authenticatedContext(request);
      requireCapability(principal, "migration_apply_delivery_read");
      const jobId = jobIdSchema.safeParse((await routeContext.params).jobId);
      if (!jobId.success) return notFound();
      const delivery = await service.getStatus(asControlPlaneContext(principal), jobId.data);
      return NextResponse.json({ data: { delivery } }, {
        headers: { "cache-control": "private, no-store" },
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
      if (code === "DEPENDENCY_UNAVAILABLE") {
        return NextResponse.json({ error: "Migration delivery service unavailable" }, { status: 503 });
      }
      return NextResponse.json({ error: "Could not read migration delivery" }, { status: 500 });
    }
  };
}

export const GET = createGetMigrationApplyDeliveryHandler(migrationApplyDeliveryService);
