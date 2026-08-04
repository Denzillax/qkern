import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getProjectDataPlane } from "@/lib/server/data-plane/runtime";
import {
  ProjectDataPlaneError,
  type ProjectDataPlanePort,
} from "@/lib/server/data-plane/service";
import {
  RequestAuthenticationError,
  RequestAuthorizationError,
} from "@/lib/server/request-context";
import { generatedDataContext } from "@/lib/server/data-plane/generated-http";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";

const environmentSchema = z.enum(["development", "staging", "production"]);
const schemaName = z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/).default("public");

export async function handleProjectSchema(
  request: NextRequest,
  input: { params: Promise<{ projectId: string; environment: string }> },
  dataPlane?: ProjectDataPlanePort,
  keys: ProjectApiKeyService = projectApiKeyService,
  projectAuth?: ProjectAuthService,
) {
  try {
    const params = await input.params;
    const environment = environmentSchema.safeParse(params.environment);
    const schema = schemaName.safeParse(request.nextUrl.searchParams.get("schema") ?? "public");
    if (!environment.success || !schema.success || !params.projectId || params.projectId.length > 128 ||
        [...request.nextUrl.searchParams.keys()].some((key) => key !== "schema") ||
        request.nextUrl.searchParams.getAll("schema").length > 1) {
      return NextResponse.json({ error: "Invalid schema request" }, { status: 400 });
    }
    const scope = { projectId: params.projectId, environment: environment.data };
    const context = await generatedDataContext(request, scope, false, keys, projectAuth);
    const service = dataPlane ?? await getProjectDataPlane();
    const result = await service.inspectSchema({
      organizationId: context.organizationId,
      actorRef: context.actorRef,
    }, scope, schema.data);
    return NextResponse.json({ data: result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return dataPlaneRouteError(error);
  }
}

export function GET(
  request: NextRequest,
  input: { params: Promise<{ projectId: string; environment: string }> },
) {
  return handleProjectSchema(request, input);
}

function dataPlaneRouteError(error: unknown) {
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
