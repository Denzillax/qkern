import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Environment } from "@/lib/types";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import type { UsagePrincipal, UsageScope } from "@/lib/server/usage/model";
import { UsageError } from "@/lib/server/usage/service";
import {
  asControlPlaneContext,
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";

export type UsageRouteContext = { params: Promise<{ projectId: string; environment: string }> };

export async function usageReadContext(request: NextRequest, routeContext: UsageRouteContext): Promise<{
  principal: UsagePrincipal;
  scope: UsageScope;
}> {
  const params = await routeContext.params;
  if (!/^[A-Za-z0-9._:-]{3,128}$/.test(params.projectId) ||
      !["development", "staging", "production"].includes(params.environment)) {
    throw new UsageError("USAGE_INVALID_INPUT");
  }
  const authenticated = await authenticatedContext(request);
  requireCapability(authenticated, "read");
  const environment = params.environment as Environment;
  await controlPlaneService.getProjectEnvironment(asControlPlaneContext(authenticated), params.projectId, environment);
  const organizationId = authenticated.membership.organization.id;
  return {
    principal: {
      organizationId,
      actorRef: authenticated.user.email,
      subject: authenticated.user.id,
      role: "reader",
    },
    scope: { organizationId, projectId: params.projectId, environment },
  };
}

export function usageNoStore(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store", Pragma: "no-cache" },
  });
}

export function usageRouteError(error: unknown) {
  if (error instanceof RequestAuthenticationError) return usageNoStore({ error: "Authentication required" }, 401);
  if (error instanceof RequestAuthorizationError) return usageNoStore({ error: "Resource not found" }, 404);
  if (error instanceof UsageError) {
    switch (error.code) {
      case "USAGE_INVALID_INPUT": return usageNoStore({ error: "Invalid usage request" }, 400);
      case "USAGE_ACCESS_DENIED":
      case "USAGE_RESOURCE_NOT_FOUND": return usageNoStore({ error: "Resource not found" }, 404);
      case "USAGE_IDEMPOTENCY_CONFLICT": return usageNoStore({ error: "Usage idempotency conflict" }, 409);
      case "USAGE_POLICY_CONFLICT": return usageNoStore({ error: "Usage policy conflict" }, 409);
      case "USAGE_METERING_DISABLED": return usageNoStore({ error: "Usage Metering is disabled" }, 503);
    }
  }
  return usageNoStore({ error: "Usage Metering unavailable" }, 500);
}
