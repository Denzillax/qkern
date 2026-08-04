import { NextRequest, NextResponse } from "next/server";
import { domainErrorCode } from "@/lib/server/domain-errors";
import type { ProjectDatabaseProvisioningService } from "@/lib/server/provisioning/service";
import { projectDatabaseProvisioningService } from "@/lib/server/provisioning/runtime";
import {
  asControlPlaneContext,
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";

const notFound = () => NextResponse.json({ error: "Resource not found" }, { status: 404 });

export function createGetProjectDatabaseProvisioningHealthHandler(
  service: ProjectDatabaseProvisioningService,
) {
  return async function GET(request: NextRequest) {
    try {
      const principal = await authenticatedContext(request);
      requireCapability(principal, "project_provisioning_read");
      const health = await service.getHealth(asControlPlaneContext(principal));
      return NextResponse.json({ data: { provisioningHealth: health } }, {
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
        return NextResponse.json({ error: "Project provisioning service unavailable" }, { status: 503 });
      }
      return NextResponse.json({ error: "Could not read project provisioning health" }, { status: 500 });
    }
  };
}

export const GET = createGetProjectDatabaseProvisioningHealthHandler(
  projectDatabaseProvisioningService,
);
