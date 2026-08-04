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
  acknowledgementCode: z.enum([
    "investigation_started",
    "external_dependency_engaged",
    "runbook_in_progress",
  ]),
}).strict();
const incidentIdSchema = z.string().uuid();
const notFound = () => NextResponse.json({ error: "Resource not found" }, { status: 404 });

export function createAcknowledgeMigrationIncidentHandler(service: MigrationIncidentService) {
  return async function POST(
    request: NextRequest,
    routeContext: { params: Promise<{ incidentId: string }> },
  ) {
    if (!hasTrustedOrigin(request)) return csrfRejected();
    try {
      const principal = await authenticatedContext(request);
      requireCapability(principal, "migration_incident_ack");
      const parsedBody = bodySchema.safeParse(await safeJson(request));
      if (!parsedBody.success) {
        return NextResponse.json({ error: "Invalid incident acknowledgement" }, { status: 400 });
      }
      const parsedIncidentId = incidentIdSchema.safeParse((await routeContext.params).incidentId);
      if (!parsedIncidentId.success) return notFound();
      const result = await service.acknowledgeIncident(asControlPlaneContext(principal), {
        incidentId: parsedIncidentId.data,
        acknowledgementCode: parsedBody.data.acknowledgementCode,
      });
      return NextResponse.json({
        data: { ...result, idempotent: result.outcome === "already_acknowledged", executed: false },
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
        return NextResponse.json({ error: "Migration incident service unavailable" }, { status: 503 });
      }
      return NextResponse.json({ error: "Could not acknowledge migration incident" }, { status: 500 });
    }
  };
}

export const POST = createAcknowledgeMigrationIncidentHandler(migrationIncidentService);
