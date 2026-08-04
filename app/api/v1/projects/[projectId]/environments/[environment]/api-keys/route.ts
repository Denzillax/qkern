import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import { domainErrorCode } from "@/lib/server/domain-errors";
import {
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";

const environmentSchema = z.enum(["development", "staging", "production"]);
const projectIdSchema = z.string().min(3).max(128);
const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["public", "service"]),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();

type RouteContext = { params: Promise<{ projectId: string; environment: string }> };

function noStore(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function scope(routeContext: RouteContext) {
  const raw = await routeContext.params;
  const projectId = projectIdSchema.safeParse(raw.projectId);
  const environment = environmentSchema.safeParse(raw.environment);
  return projectId.success && environment.success
    ? { projectId: projectId.data, environment: environment.data }
    : null;
}

function routeError(error: unknown) {
  if (error instanceof RequestAuthenticationError) return noStore({ error: "Authentication required" }, 401);
  if (error instanceof RequestAuthorizationError || domainErrorCode(error) === "RESOURCE_NOT_FOUND") {
    return noStore({ error: "Resource not found" }, 404);
  }
  if (domainErrorCode(error) === "INVALID_RECORD") return noStore({ error: "Invalid project API key" }, 400);
  return noStore({ error: "Project API keys unavailable" }, 500);
}

export function createProjectApiKeyHandlers(service: ProjectApiKeyService) {
  return {
    GET: async (request: NextRequest, routeContext: RouteContext) => {
      try {
        const principal = await authenticatedContext(request);
        requireCapability(principal, "project_api_keys");
        const parsedScope = await scope(routeContext);
        if (!parsedScope) return noStore({ error: "Invalid project API key scope" }, 400);
        const data = await service.list({
          organizationId: principal.membership.organization.id,
          actor: { id: principal.user.id, ref: principal.user.email },
        }, parsedScope.projectId, parsedScope.environment);
        return noStore({ data });
      } catch (error) { return routeError(error); }
    },
    POST: async (request: NextRequest, routeContext: RouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const principal = await authenticatedContext(request);
        requireCapability(principal, "project_api_keys");
        const parsedScope = await scope(routeContext);
        const body = createSchema.safeParse(await safeJson(request));
        if (!parsedScope || !body.success) return noStore({ error: "Invalid project API key request" }, 400);
        const data = await service.create({
          organizationId: principal.membership.organization.id,
          actor: { id: principal.user.id, ref: principal.user.email },
        }, { ...parsedScope, ...body.data });
        return noStore({ data }, 201);
      } catch (error) { return routeError(error); }
    },
  };
}

const handlers = createProjectApiKeyHandlers(projectApiKeyService);
export const GET = handlers.GET;
export const POST = handlers.POST;
