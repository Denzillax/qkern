import { NextRequest } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import type { ComputeDefinitionService } from "@/lib/server/compute/definitions";
import {
  adminComputeContext,
  computeNoStore,
  computeRouteError,
  type ComputeDefinitionRouteContext,
} from "@/lib/server/compute/definitions-http";
import { getComputeDefinitionService } from "@/lib/server/compute/definitions-runtime";

/**
 * `image` muss inhaltsadressiert sein und `secretRefs` sind **Referenzen**.
 * Beides prüft zusätzlich `validateFunctionDefinition` im Dienst — derselbe
 * Validator, den der Aufruf anwendet.
 */
const createSchema = z.object({
  name: z.string().trim().regex(/^[a-z][a-z0-9_-]{2,62}$/),
  image: z.string().trim().regex(/^[a-z0-9][a-z0-9./_-]{2,255}@sha256:[0-9a-f]{64}$/),
  entrypoint: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/),
  timeoutMs: z.number().int().min(100).max(300_000).optional(),
  memoryMiB: z.number().int().min(64).max(2_048).optional(),
  maxConcurrency: z.number().int().min(1).max(100).optional(),
  egressOrigins: z.array(z.string().trim()).max(20).optional(),
  secretRefs: z.array(z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_./:-]{2,127}$/)).max(20).optional(),
  enabled: z.boolean().optional(),
}).strict();

export function createComputeFunctionHandlers(service: ComputeDefinitionService) {
  return {
    GET: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      try {
        const context = await adminComputeContext(request, routeContext);
        return computeNoStore({ data: await service.listFunctions(context.principal, context.scope) });
      } catch (error) { return computeRouteError(error); }
    },
    POST: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const context = await adminComputeContext(request, routeContext);
        const body = createSchema.safeParse(await safeJson(request));
        if (!body.success) return computeNoStore({ error: "Invalid compute definition" }, 400);
        return computeNoStore({
          data: await service.createFunction(context.principal, context.scope, body.data),
        }, 201);
      } catch (error) { return computeRouteError(error); }
    },
  };
}

export const GET = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createComputeFunctionHandlers(getComputeDefinitionService()).GET(request, context);
  } catch (error) { return computeRouteError(error); }
};
export const POST = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createComputeFunctionHandlers(getComputeDefinitionService()).POST(request, context);
  } catch (error) { return computeRouteError(error); }
};
