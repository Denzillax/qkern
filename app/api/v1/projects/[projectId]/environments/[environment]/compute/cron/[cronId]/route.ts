import { NextRequest } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import { ComputeDefinitionError, type ComputeDefinitionService } from
  "@/lib/server/compute/definitions";
import {
  adminComputeContext,
  computeNoStore,
  computeRouteError,
  type ComputeDefinitionRouteContext,
} from "@/lib/server/compute/definitions-http";
import { getComputeDefinitionService } from "@/lib/server/compute/definitions-runtime";

/**
 * Nur `enabled` ist änderbar. Ausdruck, Queue und Nutzlast bleiben
 * unveränderlich — diese Entscheidung liegt bereits als Spaltenrecht in
 * Migration 0031 und wird hier nicht aufgeweicht.
 */
const patchSchema = z.object({ enabled: z.boolean() }).strict();

export function createComputeCronItemHandlers(service: ComputeDefinitionService) {
  return {
    GET: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      try {
        const context = await adminComputeContext(request, routeContext);
        return computeNoStore({
          data: await service.getCron(context.principal, context.scope, cronId(context.raw)),
        });
      } catch (error) { return computeRouteError(error); }
    },
    PATCH: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const context = await adminComputeContext(request, routeContext);
        const body = patchSchema.safeParse(await safeJson(request));
        if (!body.success) return computeNoStore({ error: "Invalid compute definition" }, 400);
        return computeNoStore({
          data: await service.setCronEnabled(
            context.principal, context.scope, cronId(context.raw), body.data.enabled,
          ),
        });
      } catch (error) { return computeRouteError(error); }
    },
    DELETE: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const context = await adminComputeContext(request, routeContext);
        await service.deleteCron(context.principal, context.scope, cronId(context.raw));
        return computeNoStore({ data: { deleted: true } });
      } catch (error) { return computeRouteError(error); }
    },
  };
}

function cronId(raw: { cronId?: string }) {
  if (!raw.cronId) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
  return raw.cronId;
}

export const GET = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createComputeCronItemHandlers(getComputeDefinitionService()).GET(request, context);
  } catch (error) { return computeRouteError(error); }
};
export const PATCH = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createComputeCronItemHandlers(getComputeDefinitionService()).PATCH(request, context);
  } catch (error) { return computeRouteError(error); }
};
export const DELETE = async (request: NextRequest, context: ComputeDefinitionRouteContext) => {
  try {
    return await createComputeCronItemHandlers(getComputeDefinitionService()).DELETE(request, context);
  } catch (error) { return computeRouteError(error); }
};
