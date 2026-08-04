import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import { getProjectDataPlane } from "@/lib/server/data-plane/runtime";
import {
  ProjectDataPlaneError,
  type ProjectDataPlanePort,
} from "@/lib/server/data-plane/service";
import {
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";

const environmentSchema = z.enum(["development", "staging", "production"]);
const querySchema = z.object({
  statement: z.string().min(1).max(4_000),
  limit: z.number().int().min(1).max(100).default(20),
}).strict();

export async function handleProjectReadQuery(
  request: NextRequest,
  input: { params: Promise<{ projectId: string; environment: string }> },
  dataPlane?: ProjectDataPlanePort,
) {
  try {
    const context = await authenticatedContext(request);
    requireCapability(context, "read");
    if (!hasTrustedOrigin(request)) return csrfRejected();
    const params = await input.params;
    const environment = environmentSchema.safeParse(params.environment);
    const body = querySchema.safeParse(await safeJson(request));
    if (!environment.success || !body.success || !params.projectId || params.projectId.length > 128) {
      return NextResponse.json({ error: "Invalid read query" }, { status: 400 });
    }
    const service = dataPlane ?? await getProjectDataPlane();
    const result = await service.queryReadOnly({
      organizationId: context.membership.organization.id,
      actorRef: context.user.email,
    }, { projectId: params.projectId, environment: environment.data }, body.data.statement, body.data.limit);
    return NextResponse.json({ data: result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof RequestAuthenticationError) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (error instanceof RequestAuthorizationError) {
      return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    }
    if (error instanceof ProjectDataPlaneError) {
      if (error.code === "DATA_PLANE_INVALID_INPUT" || error.code === "READ_ONLY_QUERY_REQUIRED") {
        return NextResponse.json({ error: "Invalid data-plane request", code: error.code }, { status: 400 });
      }
      if (error.code === "DATA_PLANE_NOT_READY") {
        return NextResponse.json({ error: "Project data plane is not ready", code: error.code }, { status: 409 });
      }
      return NextResponse.json({ error: "Project data plane unavailable", code: error.code }, { status: 503 });
    }
    return NextResponse.json({ error: "Project data plane unavailable" }, { status: 500 });
  }
}

export function POST(
  request: NextRequest,
  input: { params: Promise<{ projectId: string; environment: string }> },
) {
  return handleProjectReadQuery(request, input);
}
