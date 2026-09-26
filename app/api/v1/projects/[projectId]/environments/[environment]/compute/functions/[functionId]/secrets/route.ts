import { NextRequest } from "next/server";
import { ComputeDefinitionError, type ComputeDefinitionService } from
  "@/lib/server/compute/definitions";
import {
  adminComputeContext,
  computeNoStore,
  computeRouteError,
  type ComputeDefinitionRouteContext,
} from "@/lib/server/compute/definitions-http";
import { getComputeDefinitionService } from "@/lib/server/compute/definitions-runtime";
import {
  FunctionSecretInspectionError,
  getFunctionSecretInspector,
  type FunctionSecretInspector,
} from "@/lib/server/compute/function-secret-inspector";

/**
 * Die Secrets einer Function (2.38): jede Referenz der Definition und ob der
 * Vault sie aufloest. Die Antwort traegt nur Referenz und eines von drei
 * Woertern. Kein Wert, keine Version, keine Metadaten; Anlegen und Aendern
 * geschieht im Vault, nicht hier.
 */
export function createComputeFunctionSecretHandlers(
  service: ComputeDefinitionService,
  inspector: () => FunctionSecretInspector | null,
) {
  return {
    GET: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      try {
        const context = await adminComputeContext(request, routeContext);
        if ([...request.nextUrl.searchParams.keys()].length > 0) {
          return computeNoStore({ error: "Invalid compute request" }, 400);
        }
        const definition = await service.getFunction(
          context.principal, context.scope, functionId(context.raw));
        let vault: FunctionSecretInspector | null;
        try {
          vault = inspector();
        } catch {
          return computeNoStore({ error: "Vault is misconfigured", code: "VAULT_MISCONFIGURED" }, 503);
        }
        if (!vault) {
          return computeNoStore({ error: "Vault is not connected", code: "VAULT_NOT_CONFIGURED" }, 503);
        }
        const secrets = await Promise.all(definition.secretRefs.map(async (ref) => ({
          ref, status: await vault.hasSecret(ref),
        })));
        return computeNoStore({ data: { secrets, checkedAt: new Date().toISOString() } });
      } catch (error) {
        if (error instanceof FunctionSecretInspectionError) {
          return computeNoStore({ error: "Vault is unavailable", code: "VAULT_UNAVAILABLE" }, 503);
        }
        return computeRouteError(error);
      }
    },
  };
}

function functionId(raw: { functionId?: string }) {
  if (!raw.functionId) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
  return raw.functionId;
}

export const GET = async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
  try {
    return await createComputeFunctionSecretHandlers(
      getComputeDefinitionService(), getFunctionSecretInspector,
    ).GET(request, routeContext);
  } catch (error) { return computeRouteError(error); }
};
