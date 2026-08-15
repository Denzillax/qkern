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
 * Der Image-Deployment-Fluss — Sprosse 6 der Paritätsleiter.
 *
 * POST rollt ein neues digest-gepinntes Image aus; alles andere an der
 * Definition bleibt unveränderlich, und die Historienzeile entsteht in
 * derselben Transaktion — eine Image-Änderung ohne Historie ist auf
 * Datenbankebene nicht ausdrückbar. Rollback ist ein Deployment auf den
 * alten Digest, keine Sonderoperation. GET liefert die Historie, neueste
 * Revision zuerst.
 */
const deploySchema = z.object({
  image: z.string().regex(/^[a-z0-9][a-z0-9./_-]{2,255}@sha256:[0-9a-f]{64}$/),
}).strict();

export function createComputeFunctionDeploymentHandlers(service: ComputeDefinitionService) {
  return {
    GET: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      try {
        const context = await adminComputeContext(request, routeContext);
        return computeNoStore({
          data: await service.listFunctionDeployments(
            context.principal, context.scope, functionId(context.raw)),
        });
      } catch (error) { return computeRouteError(error); }
    },
    POST: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const context = await adminComputeContext(request, routeContext);
        const body = deploySchema.safeParse(await safeJson(request));
        if (!body.success) return computeNoStore({ error: "Invalid compute definition" }, 400);
        return computeNoStore({
          data: await service.deployFunction(
            context.principal, context.scope, functionId(context.raw), body.data),
        }, 201);
      } catch (error) { return computeRouteError(error); }
    },
  };
}

function functionId(raw: { functionId?: string }) {
  if (!raw.functionId) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
  return raw.functionId;
}

export const GET = (request: NextRequest, routeContext: ComputeDefinitionRouteContext) =>
  createComputeFunctionDeploymentHandlers(getComputeDefinitionService()).GET(request, routeContext);
export const POST = (request: NextRequest, routeContext: ComputeDefinitionRouteContext) =>
  createComputeFunctionDeploymentHandlers(getComputeDefinitionService()).POST(request, routeContext);
