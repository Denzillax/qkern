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
 * `signingSecretRef` ist eine **Referenz**, niemals ein Geheimnis. Der Wert
 * liegt im Vault; diese Fläche transportiert ihn nicht und speichert ihn nicht.
 */
const createSchema = z.object({
  name: z.string().trim().regex(/^[a-z][a-z0-9_-]{2,62}$/),
  url: z.string().trim().min(12).max(2048),
  eventTypes: z.array(z.string().trim().regex(/^[a-z][a-z0-9._-]{0,63}$/)).min(1).max(20),
  signingSecretRef: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_./:-]{2,127}$/),
  timeoutMs: z.number().int().min(250).max(30_000).optional(),
  maxAttempts: z.number().int().min(1).max(20).optional(),
  enabled: z.boolean().optional(),
}).strict();

export function createComputeWebhookHandlers(service: ComputeDefinitionService) {
  return {
    GET: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      try {
        const context = await adminComputeContext(request, routeContext);
        return computeNoStore({ data: await service.listWebhooks(context.principal, context.scope) });
      } catch (error) { return computeRouteError(error); }
    },
    POST: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const context = await adminComputeContext(request, routeContext);
        const body = createSchema.safeParse(await safeJson(request));
        if (!body.success) return computeNoStore({ error: "Invalid compute definition" }, 400);
        return computeNoStore({
          data: await service.createWebhook(context.principal, context.scope, body.data),
        }, 201);
      } catch (error) { return computeRouteError(error); }
    },
  };
}

export const GET = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createComputeWebhookHandlers(getComputeDefinitionService()).GET(request, context);
  } catch (error) { return computeRouteError(error); }
};
export const POST = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createComputeWebhookHandlers(getComputeDefinitionService()).POST(request, context);
  } catch (error) { return computeRouteError(error); }
};
