import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import type { ControlPlaneService } from "@/lib/server/control-plane/model";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { domainErrorCode } from "@/lib/server/domain-errors";
import {
  asControlPlaneContext,
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";

const environmentSchema = z.enum(["development", "staging", "production"]);
const projectIdSchema = z.string().min(3).max(128);
const policySchema = z.object({
  mode: z.enum(["manual", "guarded", "autonomous"]),
  maxAutoRisk: z.enum(["low", "medium", "high", "critical"]),
  autoQueue: z.boolean(),
  emergencyStop: z.boolean(),
}).strict();

type RouteContext = { params: Promise<{ projectId: string; environment: string }> };

function noStore(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function routeScope(routeContext: RouteContext) {
  const params = await routeContext.params;
  const projectId = projectIdSchema.safeParse(params.projectId);
  const environment = environmentSchema.safeParse(params.environment);
  return projectId.success && environment.success
    ? { projectId: projectId.data, environment: environment.data }
    : null;
}

function routeError(error: unknown) {
  if (error instanceof RequestAuthenticationError) return noStore({ error: "Authentication required" }, 401);
  if (error instanceof RequestAuthorizationError || domainErrorCode(error) === "RESOURCE_NOT_FOUND") {
    return noStore({ error: "Resource not found" }, 404);
  }
  return noStore({ error: "Could not access automation policy" }, 500);
}

export function createAutomationPolicyHandlers(service: ControlPlaneService) {
  return {
    GET: async (request: NextRequest, routeContext: RouteContext) => {
      try {
        const principal = await authenticatedContext(request);
        requireCapability(principal, "read");
        const scope = await routeScope(routeContext);
        if (!scope) return noStore({ error: "Invalid automation policy scope" }, 400);
        return noStore({ data: await service.getAutomationPolicy(
          asControlPlaneContext(principal),
          scope.projectId,
          scope.environment,
        ) });
      } catch (error) {
        return routeError(error);
      }
    },
    PUT: async (request: NextRequest, routeContext: RouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const principal = await authenticatedContext(request);
        requireCapability(principal, "automation_policy");
        const scope = await routeScope(routeContext);
        if (!scope) return noStore({ error: "Invalid automation policy scope" }, 400);
        const parsed = policySchema.safeParse(await safeJson(request));
        if (!parsed.success) return noStore({ error: "Invalid automation policy" }, 400);
        return noStore({ data: await service.setAutomationPolicy(
          asControlPlaneContext(principal),
          { ...scope, ...parsed.data },
        ) });
      } catch (error) {
        return routeError(error);
      }
    },
  };
}

const handlers = createAutomationPolicyHandlers(controlPlaneService);
export const GET = handlers.GET;
export const PUT = handlers.PUT;
