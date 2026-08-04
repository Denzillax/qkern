import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import { domainErrorCode } from "@/lib/server/domain-errors";
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
  reasonCode: z.literal("target_ledger_recheck"),
}).strict();
const incidentIdSchema = z.string().uuid();
const notFound = () => NextResponse.json({ error: "Resource not found" }, { status: 404 });

export function createRequestMigrationIncidentResolutionVerificationHandler(
  service: MigrationIncidentService,
) {
  return async function POST(
    request: NextRequest,
    routeContext: { params: Promise<{ incidentId: string }> },
  ) {
    if (!hasTrustedOrigin(request)) return csrfRejected();
    try {
      const principal = await authenticatedContext(request);
      requireCapability(principal, "migration_incident_resolve");
      const parsedBody = bodySchema.safeParse(await safeJson(request));
      if (!parsedBody.success) {
        return NextResponse.json({ error: "Invalid incident resolution verification request" }, { status: 400 });
      }
      const parsedIncidentId = incidentIdSchema.safeParse((await routeContext.params).incidentId);
      if (!parsedIncidentId.success) return notFound();
      const result = await service.requestResolutionVerification(asControlPlaneContext(principal), {
        incidentId: parsedIncidentId.data,
        reasonCode: parsedBody.data.reasonCode,
      });
      const idempotent = result.outcome === "already_requested";
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
      if (code === "MIGRATION_INCIDENT_RESOLUTION_NOT_VERIFIABLE" || code === "MIGRATION_NOT_READY") {
        return NextResponse.json({ error: "Incident resolution cannot be verified" }, { status: 409 });
      }
      if (code === "DEPENDENCY_UNAVAILABLE") {
        return NextResponse.json({ error: "Migration incident service unavailable" }, { status: 503 });
      }
      return NextResponse.json({ error: "Could not request incident resolution verification" }, { status: 500 });
    }
  };
}

export const POST = createRequestMigrationIncidentResolutionVerificationHandler(migrationIncidentService);
