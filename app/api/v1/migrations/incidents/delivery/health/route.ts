import { NextRequest, NextResponse } from "next/server";
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

const notFound = () => NextResponse.json({ error: "Resource not found" }, { status: 404 });

export function createGetMigrationIncidentDeliveryHealthHandler(service: MigrationIncidentService) {
  return async function GET(request: NextRequest) {
    try {
      const principal = await authenticatedContext(request);
      requireCapability(principal, "migration_incident_read");
      const health = await service.getDeliveryHealth(asControlPlaneContext(principal));
      return NextResponse.json({ data: { deliveryHealth: health } }, {
        headers: { "cache-control": "private, no-store" },
      });
    } catch (error) {
      if (error instanceof RequestAuthenticationError) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      }
      if (error instanceof RequestAuthorizationError) return notFound();
      const code = domainErrorCode(error);
      if (code === "RESOURCE_NOT_FOUND" || code === "INVALID_REFERENCE") return notFound();
      if (code === "DEPENDENCY_UNAVAILABLE") {
        return NextResponse.json({ error: "Migration incident service unavailable" }, { status: 503 });
      }
      return NextResponse.json({ error: "Could not read incident delivery health" }, { status: 500 });
    }
  };
}

export const createMigrationIncidentDeliveryHealthHandler = createGetMigrationIncidentDeliveryHealthHandler;
export const GET = createGetMigrationIncidentDeliveryHealthHandler(migrationIncidentService);
