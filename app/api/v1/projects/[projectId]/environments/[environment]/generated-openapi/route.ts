import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { GeneratedDataApiPort } from "@/lib/server/data-plane/generated-api";
import { GeneratedDataApiError } from "@/lib/server/data-plane/generated-api";
import { getGeneratedDataApi } from "@/lib/server/data-plane/generated-runtime";
import { generatedDataContext } from "@/lib/server/data-plane/generated-http";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";
import { RequestAuthenticationError, RequestAuthorizationError } from "@/lib/server/request-context";

const paramsSchema = z.object({
  projectId: z.string().min(3).max(128),
  environment: z.enum(["development", "staging", "production"]),
});
const schemaName = z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/);
type RouteContext = { params: Promise<{ projectId: string; environment: string }> };

function response(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function createGeneratedOpenApiHandler(
  getService: () => Promise<GeneratedDataApiPort> = getGeneratedDataApi,
  keys: ProjectApiKeyService = projectApiKeyService,
  projectAuth?: ProjectAuthService,
) {
  return async (request: NextRequest, routeContext: RouteContext) => {
    try {
      if ([...request.nextUrl.searchParams.keys()].some((key) => key !== "schema") ||
          request.nextUrl.searchParams.getAll("schema").length > 1) {
        return response({ error: "Invalid generated OpenAPI request" }, 400);
      }
      const scope = paramsSchema.safeParse(await routeContext.params);
      const schema = schemaName.safeParse(request.nextUrl.searchParams.get("schema") ?? "public");
      if (!scope.success || !schema.success) return response({ error: "Invalid generated OpenAPI request" }, 400);
      const context = await generatedDataContext(request, scope.data, false, keys, projectAuth);
      return response(await (await getService()).generateOpenApi(context, scope.data, schema.data));
    } catch (error) {
      if (error instanceof RequestAuthenticationError) return response({ error: "Authentication required" }, 401);
      if (error instanceof RequestAuthorizationError) return response({ error: "Resource not found" }, 404);
      if (error instanceof GeneratedDataApiError) {
        const status = error.code === "GENERATED_DATA_API_INVALID_INPUT" ? 400
          : error.code === "GENERATED_DATA_API_NOT_READY" ? 409 : 503;
        return response({ error: "Generated OpenAPI unavailable", code: error.code }, status);
      }
      return response({ error: "Generated OpenAPI unavailable" }, 500);
    }
  };
}

export const GET = createGeneratedOpenApiHandler();
