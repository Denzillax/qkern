import { NextRequest, NextResponse } from "next/server";
import { isConnectionUnavailable } from "@/lib/server/db/errors";
import type { Environment } from "@/lib/types";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { projectApplicationPrincipal } from "@/lib/server/data-plane/generated-http";
import type { ProjectQueuePrincipal, ProjectQueueScope } from "@/lib/server/project-queues/model";
import { ProjectQueueError } from "@/lib/server/project-queues/service";
import {
  asControlPlaneContext,
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";
import { admitApiRequest, UsageQuotaExceededError } from "@/lib/server/usage/api-requests";

export type ProjectQueueRouteContext = {
  params: Promise<{ projectId: string; environment: string; queue?: string; messageId?: string }>;
};

export async function parsedProjectQueueParams(routeContext: ProjectQueueRouteContext): Promise<{
  scope: Omit<ProjectQueueScope, "organizationId">;
  raw: { projectId: string; environment: string; queue?: string; messageId?: string };
} | null> {
  const raw = await routeContext.params;
  if (!/^[A-Za-z0-9._:-]{3,128}$/.test(raw.projectId) ||
      !["development", "staging", "production"].includes(raw.environment) ||
      (raw.queue !== undefined && !/^[a-z][a-z0-9_-]{2,62}$/.test(raw.queue)) ||
      (raw.messageId !== undefined && !/^[A-Za-z0-9._:-]{1,128}$/.test(raw.messageId))) return null;
  return {
    scope: { projectId: raw.projectId, environment: raw.environment as Environment }, raw,
  };
}

export async function adminProjectQueueContext(request: NextRequest, routeContext: ProjectQueueRouteContext) {
  const parsed = await parsedProjectQueueParams(routeContext);
  if (!parsed) throw new ProjectQueueError("QUEUE_INVALID_INPUT");
  const authenticated = await authenticatedContext(request);
  requireCapability(authenticated, "project_queues_admin");
  await controlPlaneService.getProjectEnvironment(
    asControlPlaneContext(authenticated), parsed.scope.projectId, parsed.scope.environment,
  );
  const organizationId = authenticated.membership.organization.id;
  const scope = { organizationId, ...parsed.scope };
  await admitApiRequest("project_queues", scope);
  return {
    principal: {
      organizationId, actorRef: authenticated.user.email, role: "admin" as const, subject: authenticated.user.id,
    },
    scope,
    raw: parsed.raw,
  };
}

export async function applicationProjectQueueContext(request: NextRequest, routeContext: ProjectQueueRouteContext): Promise<{
  principal: ProjectQueuePrincipal;
  scope: ProjectQueueScope;
  raw: { projectId: string; environment: string; queue?: string; messageId?: string };
}> {
  const parsed = await parsedProjectQueueParams(routeContext);
  if (!parsed) throw new ProjectQueueError("QUEUE_INVALID_INPUT");
  const application = await projectApplicationPrincipal(request, parsed.scope);
  if (!application) throw new RequestAuthenticationError();
  const scope = { organizationId: application.organizationId, ...parsed.scope };
  await admitApiRequest("project_queues", scope);
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

export function projectQueueOriginAllowed(
  request: NextRequest,
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const configured = env.QKERN_PROJECT_QUEUES_ALLOWED_ORIGINS?.split(",")
    .map((entry) => entry.trim()).filter(Boolean) ?? [];
  if (!configured.every((entry) => validOrigin(entry, env.NODE_ENV === "production"))) return false;
  return configured.includes(origin);
}

export function projectQueueNoStore(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store", Pragma: "no-cache" } });
}

export function withProjectQueueCors(request: NextRequest, response: NextResponse) {
  const origin = request.headers.get("origin");
  if (origin && projectQueueOriginAllowed(request)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Headers", "authorization, content-type, x-qkern-key");
    response.headers.append("Vary", "Origin");
  }
  return response;
}

export function projectQueuePreflight(request: NextRequest, methods = "POST, OPTIONS") {
  if (!projectQueueOriginAllowed(request)) return projectQueueNoStore({ error: "Origin is not allowed" }, 403);
  return withProjectQueueCors(request, new NextResponse(null, {
    status: 204,
    headers: {
      "Cache-Control": "private, no-store",
      "Access-Control-Allow-Methods": methods,
      "Access-Control-Max-Age": "600",
    },
  }));
}

export function projectQueueRouteError(error: unknown, request?: NextRequest) {
  const respond = (response: NextResponse) => request ? withProjectQueueCors(request, response) : response;
  // Ein erschoepfter Verbindungspool ist weder ein Fehler der Anfrage noch
  // einer der Datenbank: 503 und wiederholbar. Diese Regel steht an jeder
  // Grenze gleich, und der Vertrag in tests/route-unavailable-contract prueft,
  // dass keine sie vergisst.
  if (isConnectionUnavailable(error)) {
    return respond(projectQueueNoStore({ error: "Project Queues unavailable" }, 503));
  }
  if (error instanceof RequestAuthenticationError) return respond(projectQueueNoStore({ error: "Authentication required" }, 401));
  if (error instanceof RequestAuthorizationError) return respond(projectQueueNoStore({ error: "Resource not found" }, 404));
  if (error instanceof UsageQuotaExceededError) {
    return respond(projectQueueNoStore({ error: "Usage quota exceeded" }, 429));
  }
  if (error instanceof ProjectQueueError) {
    switch (error.code) {
      case "QUEUE_INVALID_INPUT": return respond(projectQueueNoStore({ error: "Invalid queue request" }, 400));
      case "QUEUE_RESOURCE_NOT_FOUND":
      case "QUEUE_ACCESS_DENIED": return respond(projectQueueNoStore({ error: "Resource not found" }, 404));
      case "QUEUE_CONFLICT": return respond(projectQueueNoStore({ error: "Queue conflict" }, 409));
      case "QUEUE_CAPACITY_EXCEEDED": return respond(projectQueueNoStore({ error: "Queue capacity exceeded" }, 429));
      case "QUEUE_QUOTA_EXCEEDED": return respond(projectQueueNoStore({ error: "Usage quota exceeded" }, 429));
      case "QUEUE_LEASE_LOST": return respond(projectQueueNoStore({ error: "Queue lease is no longer valid" }, 409));
      // 503 statt 409: Die Warteschlange ist in Ordnung, der Prozess hatte
      // keine freie Verbindung. Ein Aufrufer darf es gleich wieder versuchen.
      case "QUEUE_UNAVAILABLE": return respond(projectQueueNoStore({ error: "Project Queues unavailable" }, 503));
      case "PROJECT_QUEUES_DISABLED": return respond(projectQueueNoStore({ error: "Project Queues are disabled" }, 503));
    }
  }
  return respond(projectQueueNoStore({ error: "Project Queues unavailable" }, 500));
}

function validOrigin(value: string, production: boolean) {
  try {
    const url = new URL(value);
    const localHttp = !production && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    return (url.protocol === "https:" || localHttp) && url.origin === value && !url.username && !url.password;
  } catch { return false; }
}
