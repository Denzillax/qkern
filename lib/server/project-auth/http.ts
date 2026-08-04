import { NextRequest, NextResponse } from "next/server";
import type { Environment } from "@/lib/types";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { presentedProjectApiKey } from "@/lib/server/data-plane/generated-http";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";
import type { ProjectAuthScope } from "@/lib/server/project-auth/model";
import { ProjectAuthError } from "@/lib/server/project-auth/service";
import {
  asControlPlaneContext,
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";

export type ProjectAuthRouteContext = {
  params: Promise<{ projectId: string; environment: string; [key: string]: string }>;
};

export async function parsedProjectAuthParams(routeContext: ProjectAuthRouteContext): Promise<{
  projectId: string;
  environment: Environment;
  raw: Record<string, string>;
} | null> {
  const raw = await routeContext.params;
  if (!raw.projectId || raw.projectId.length < 3 || raw.projectId.length > 128 ||
      !["development", "staging", "production"].includes(raw.environment)) return null;
  return { projectId: raw.projectId, environment: raw.environment as Environment, raw };
}

export async function publicProjectAuthScope(
  request: NextRequest,
  routeContext: ProjectAuthRouteContext,
  keys: ProjectApiKeyService = projectApiKeyService,
): Promise<ProjectAuthScope> {
  const parsed = await parsedProjectAuthParams(routeContext);
  if (!parsed) throw new ProjectAuthError("INVALID_INPUT");
  const key = presentedProjectApiKey(request);
  if (!key) throw new RequestAuthenticationError();
  const principal = await keys.authenticate(key);
  if (!principal) throw new RequestAuthenticationError();
  if (principal.projectId !== parsed.projectId || principal.environment !== parsed.environment) {
    throw new RequestAuthorizationError();
  }
  return {
    organizationId: principal.organizationId,
    projectId: parsed.projectId,
    environment: parsed.environment,
  };
}

export async function adminProjectAuthScope(
  request: NextRequest,
  routeContext: ProjectAuthRouteContext,
): Promise<{ scope: ProjectAuthScope; actor: { id: string; ref: string } }> {
  const parsed = await parsedProjectAuthParams(routeContext);
  if (!parsed) throw new ProjectAuthError("INVALID_INPUT");
  const principal = await authenticatedContext(request);
  requireCapability(principal, "project_auth_admin");
  await controlPlaneService.getProjectEnvironment(
    asControlPlaneContext(principal), parsed.projectId, parsed.environment,
  );
  return {
    scope: {
      organizationId: principal.membership.organization.id,
      projectId: parsed.projectId,
      environment: parsed.environment,
    },
    actor: { id: principal.user.id, ref: principal.user.email },
  };
}

export function presentedProjectAccessToken(request: NextRequest): string | null {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1] ?? null;
  return token && !token.startsWith("qk_") ? token : null;
}

export function projectAuthNoStore(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store", Pragma: "no-cache" },
  });
}

export function projectAuthOriginAllowed(
  request: NextRequest,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const configured = env.QKERN_PROJECT_AUTH_ALLOWED_ORIGINS?.split(",")
    .map((entry) => entry.trim()).filter(Boolean) ?? [];
  return configured.includes(origin);
}

export function withProjectAuthCors(request: NextRequest, response: NextResponse): NextResponse {
  const origin = request.headers.get("origin");
  if (origin && projectAuthOriginAllowed(request)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Headers", "authorization, content-type, x-qkern-key");
    response.headers.set("Access-Control-Expose-Headers", "retry-after");
    response.headers.append("Vary", "Origin");
  }
  return response;
}

export function projectAuthPreflight(request: NextRequest, methods: string): NextResponse {
  if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
  const response = new NextResponse(null, { status: 204 });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Access-Control-Allow-Methods", methods);
  response.headers.set("Access-Control-Max-Age", "600");
  return withProjectAuthCors(request, response);
}

export function projectAuthRouteError(error: unknown, request?: NextRequest): NextResponse {
  const respond = (response: NextResponse) => request ? withProjectAuthCors(request, response) : response;
  if (error instanceof RequestAuthenticationError) {
    return respond(projectAuthNoStore({ error: "Authentication required" }, 401));
  }
  if (error instanceof RequestAuthorizationError) {
    return respond(projectAuthNoStore({ error: "Resource not found" }, 404));
  }
  if (error instanceof ProjectAuthError) {
    switch (error.code) {
      case "INVALID_INPUT": return respond(projectAuthNoStore({ error: "Invalid Project Auth request" }, 400));
      case "ACCOUNT_EXISTS": return respond(projectAuthNoStore({ error: "Account already exists" }, 409));
      case "EMAIL_NOT_VERIFIED": return respond(projectAuthNoStore({ error: "Email verification required" }, 403));
      case "RATE_LIMITED": return respond(NextResponse.json({ error: "Too many requests" }, {
        status: 429,
        headers: {
          "Cache-Control": "private, no-store",
          ...(error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : {}),
        },
      }));
      case "RESOURCE_NOT_FOUND": return respond(projectAuthNoStore({ error: "Resource not found" }, 404));
      case "PROJECT_AUTH_DISABLED": return respond(projectAuthNoStore({ error: "Project Auth is disabled" }, 503));
      case "DELIVERY_UNAVAILABLE": return respond(projectAuthNoStore({ error: "Project Auth delivery unavailable" }, 503));
      case "TOKEN_REPLAYED": return respond(projectAuthNoStore({ error: "Authentication failed" }, 401));
      case "INVALID_CREDENTIALS":
      case "INVALID_TOKEN":
      case "MFA_REQUIRED":
      case "INVALID_MFA":
        return respond(projectAuthNoStore({ error: "Authentication failed" }, 401));
    }
  }
  return respond(projectAuthNoStore({ error: "Project Auth unavailable" }, 500));
}
