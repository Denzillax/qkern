import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
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

const projectIdSchema = z.string().uuid();
const environmentSchema = z.enum(["development", "staging", "production"]);
const bodySchema = z.object({}).strict();
const notFound = () => NextResponse.json({ error: "Resource not found" }, { status: 404 });

async function parsedParams(routeContext: {
  params: Promise<{ projectId: string; environment: string }>;
}) {
  const raw = await routeContext.params;
  const projectId = projectIdSchema.safeParse(raw.projectId);
  const environment = environmentSchema.safeParse(raw.environment);
  return projectId.success && environment.success
    ? { projectId: projectId.data, environment: environment.data }
    : undefined;
}

export function createGetProjectDatabaseProvisioningHandler(service: ProjectDatabaseProvisioningService) {
  return async function GET(
    request: NextRequest,
    routeContext: { params: Promise<{ projectId: string; environment: string }> },
  ) {
    try {
      const principal = await authenticatedContext(request);
      requireCapability(principal, "project_provisioning_read");
      const params = await parsedParams(routeContext);
      if (!params) return notFound();
      const provisioning = await service.getStatus(
        asControlPlaneContext(principal),
        params.projectId,
        params.environment,
      );
      return NextResponse.json({ data: { provisioning } }, {
        headers: { "cache-control": "private, no-store" },
      });
    } catch (error) {
      return mappedError(error, "Could not read project database provisioning");
    }
  };
}

export function createRequestProjectDatabaseProvisioningHandler(service: ProjectDatabaseProvisioningService) {
  return async function POST(
    request: NextRequest,
    routeContext: { params: Promise<{ projectId: string; environment: string }> },
  ) {
    if (!hasTrustedOrigin(request)) return csrfRejected();
    try {
      const principal = await authenticatedContext(request);
      requireCapability(principal, "project_provisioning_request");
      const body = bodySchema.safeParse(await safeJson(request));
      if (!body.success) {
        return NextResponse.json({ error: "Invalid project provisioning request" }, { status: 400 });
      }
      const params = await parsedParams(routeContext);
      if (!params) return notFound();
      const result = await service.request(
        asControlPlaneContext(principal),
        params.projectId,
        params.environment,
      );
      const idempotent = result.outcome === "already_requested";
      return NextResponse.json({ data: { ...result, idempotent, executed: false } }, {
        status: idempotent ? 200 : 202,
      });
    } catch (error) {
      return mappedError(error, "Could not request project database provisioning");
    }
  };
}

function mappedError(error: unknown, fallback: string) {
  if (error instanceof RequestAuthenticationError) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (error instanceof RequestAuthorizationError) return notFound();
  const code = domainErrorCode(error);
  if (code === "RESOURCE_NOT_FOUND" || code === "INVALID_REFERENCE" || code === "INVALID_RECORD") {
    return notFound();
  }
  if (code === "PROJECT_PROVISIONING_NOT_READY" || code === "CONFLICT") {
    return NextResponse.json({ error: "Project database provisioning cannot be requested" }, { status: 409 });
  }
  if (code === "DEPENDENCY_UNAVAILABLE") {
    return NextResponse.json({ error: "Project provisioning service unavailable" }, { status: 503 });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export const GET = createGetProjectDatabaseProvisioningHandler(projectDatabaseProvisioningService);
export const POST = createRequestProjectDatabaseProvisioningHandler(projectDatabaseProvisioningService);
