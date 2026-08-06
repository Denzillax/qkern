import { NextRequest, NextResponse } from "next/server";
import type { Environment } from "@/lib/types";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { projectApplicationPrincipal } from "@/lib/server/data-plane/generated-http";
import type { ProjectStoragePrincipal, ProjectStorageScope } from "@/lib/server/project-storage/model";
import { ProjectStorageError } from "@/lib/server/project-storage/service";
import {
  asControlPlaneContext,
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";
import { admitApiRequest, UsageQuotaExceededError } from "@/lib/server/usage/api-requests";

export type ProjectStorageRouteContext = {
  params: Promise<{ projectId: string; environment: string; [key: string]: string }>;
};

export async function parsedProjectStorageParams(routeContext: ProjectStorageRouteContext): Promise<{
  projectId: string;
  environment: Environment;
  raw: Record<string, string>;
} | null> {
  const raw = await routeContext.params;
  if (!/^[A-Za-z0-9._:-]{3,128}$/.test(raw.projectId) ||
      !["development", "staging", "production"].includes(raw.environment)) return null;
  return { projectId: raw.projectId, environment: raw.environment as Environment, raw };
}

export async function adminProjectStorageContext(
  request: NextRequest,
  routeContext: ProjectStorageRouteContext,
): Promise<{ principal: ProjectStoragePrincipal; scope: ProjectStorageScope; raw: Record<string, string> }> {
  const parsed = await parsedProjectStorageParams(routeContext);
  if (!parsed) throw new ProjectStorageError("STORAGE_INVALID_INPUT");
  const authenticated = await authenticatedContext(request);
  requireCapability(authenticated, "project_storage_admin");
  await controlPlaneService.getProjectEnvironment(
    asControlPlaneContext(authenticated), parsed.projectId, parsed.environment,
  );
  const organizationId = authenticated.membership.organization.id;
  const scope = { organizationId, projectId: parsed.projectId, environment: parsed.environment };
  await admitApiRequest("project_storage", scope);
  return {
    principal: {
      organizationId,
      actorRef: authenticated.user.email,
      role: "admin",
      subject: authenticated.user.id,
    },
    scope,
    raw: parsed.raw,
  };
}

export async function applicationProjectStorageContext(
  request: NextRequest,
  routeContext: ProjectStorageRouteContext,
): Promise<{ principal: ProjectStoragePrincipal; scope: ProjectStorageScope; raw: Record<string, string> }> {
  const parsed = await parsedProjectStorageParams(routeContext);
  if (!parsed) throw new ProjectStorageError("STORAGE_INVALID_INPUT");
  const application = await projectApplicationPrincipal(request, parsed);
  if (!application) throw new RequestAuthenticationError();
  const scope = {
    organizationId: application.organizationId,
    projectId: parsed.projectId,
    environment: parsed.environment,
  };
  await admitApiRequest("project_storage", scope);
  return {
    principal: {
      organizationId: application.organizationId,
      actorRef: application.actorRef,
      role: application.role,
      subject: application.subject,
    },
    scope,
    raw: parsed.raw,
  };
}

export function projectStorageNoStore(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store", Pragma: "no-cache" },
  });
}

export function projectStorageOriginAllowed(
  request: NextRequest,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const configured = env.QKERN_PROJECT_STORAGE_ALLOWED_ORIGINS?.split(",")
    .map((entry) => entry.trim()).filter(Boolean) ?? [];
  if (!configured.every((entry) => {
    try {
      const url = new URL(entry);
      const localHttp = env.NODE_ENV !== "production" && url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname);
      return (url.protocol === "https:" || localHttp) && url.origin === entry && !url.username && !url.password;
    } catch { return false; }
  })) return false;
  return configured.includes(origin);
}

export function withProjectStorageCors(request: NextRequest, response: NextResponse): NextResponse {
  const origin = request.headers.get("origin");
  if (origin && projectStorageOriginAllowed(request)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Headers", "authorization, content-type, x-qkern-key");
    response.headers.append("Vary", "Origin");
  }
  return response;
}

export function projectStoragePreflight(request: NextRequest, methods: string): NextResponse {
  if (!projectStorageOriginAllowed(request)) {
    return projectStorageNoStore({ error: "Origin is not allowed" }, 403);
  }
  const response = new NextResponse(null, {
    status: 204,
    headers: {
      "Cache-Control": "private, no-store",
      "Access-Control-Allow-Methods": methods,
      "Access-Control-Max-Age": "600",
    },
  });
  return withProjectStorageCors(request, response);
}

export function projectStorageRouteError(error: unknown, request?: NextRequest): NextResponse {
  const respond = (response: NextResponse) => request ? withProjectStorageCors(request, response) : response;
  if (error instanceof RequestAuthenticationError) {
    return respond(projectStorageNoStore({ error: "Authentication required" }, 401));
  }
  if (error instanceof RequestAuthorizationError) {
    return respond(projectStorageNoStore({ error: "Resource not found" }, 404));
  }
  if (error instanceof UsageQuotaExceededError) {
    return respond(projectStorageNoStore({ error: "Usage quota exceeded" }, 429));
  }
  if (error instanceof ProjectStorageError) {
    switch (error.code) {
      case "STORAGE_INVALID_INPUT": return respond(projectStorageNoStore({ error: "Invalid storage request" }, 400));
      case "STORAGE_INVALID_TOKEN": return respond(projectStorageNoStore({ error: "Invalid upload completion" }, 401));
      case "STORAGE_ACCESS_DENIED":
      case "STORAGE_RESOURCE_NOT_FOUND": return respond(projectStorageNoStore({ error: "Resource not found" }, 404));
      case "STORAGE_CONFLICT": return respond(projectStorageNoStore({ error: "Storage conflict" }, 409));
      case "STORAGE_QUOTA_EXCEEDED": return respond(projectStorageNoStore({ error: "Storage quota exceeded" }, 413));
      case "STORAGE_OBJECT_NOT_READY": return respond(projectStorageNoStore({ error: "Object is quarantined or not ready" }, 409));
      case "STORAGE_OBJECT_INFECTED": return respond(projectStorageNoStore({ error: "Object was rejected" }, 422));
      case "PROJECT_STORAGE_DISABLED": return respond(projectStorageNoStore({ error: "Project Storage is disabled" }, 503));
      case "STORAGE_PROVIDER_UNAVAILABLE": return respond(projectStorageNoStore({ error: "Storage provider unavailable" }, 503));
    }
  }
  return respond(projectStorageNoStore({ error: "Project Storage unavailable" }, 500));
}
