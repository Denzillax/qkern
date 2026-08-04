import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin } from "@/lib/server/auth/http";
import { domainErrorCode } from "@/lib/server/domain-errors";
import {
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";

const scopeSchema = z.object({
  projectId: z.string().min(3).max(128),
  environment: z.enum(["development", "staging", "production"]),
  keyId: z.string().min(3).max(128),
});
type RouteContext = { params: Promise<{ projectId: string; environment: string; keyId: string }> };

function noStore(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function createProjectApiKeyDeleteHandler(service: ProjectApiKeyService) {
  return async (request: NextRequest, routeContext: RouteContext) => {
    if (!hasTrustedOrigin(request)) return csrfRejected();
    try {
      const principal = await authenticatedContext(request);
      requireCapability(principal, "project_api_keys");
      const parsed = scopeSchema.safeParse(await routeContext.params);
      if (!parsed.success) return noStore({ error: "Invalid project API key scope" }, 400);
      const data = await service.revoke({
        organizationId: principal.membership.organization.id,
        actor: { id: principal.user.id, ref: principal.user.email },
      }, parsed.data.projectId, parsed.data.environment, parsed.data.keyId);
      return noStore({ data });
    } catch (error) {
      if (error instanceof RequestAuthenticationError) return noStore({ error: "Authentication required" }, 401);
      if (error instanceof RequestAuthorizationError || domainErrorCode(error) === "RESOURCE_NOT_FOUND") {
        return noStore({ error: "Resource not found" }, 404);
      }
      return noStore({ error: "Project API key could not be revoked" }, 500);
    }
  };
}

export const DELETE = createProjectApiKeyDeleteHandler(projectApiKeyService);
