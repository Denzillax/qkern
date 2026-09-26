import { NextRequest } from "next/server";
import type { ComputeDefinitionService } from "@/lib/server/compute/definitions";
import type { DatabaseWebhookService } from "@/lib/server/compute/database-webhook-definitions";
import {
  adminComputeContext,
  computeNoStore,
  computeRouteError,
  type ComputeDefinitionRouteContext,
} from "@/lib/server/compute/definitions-http";
import {
  getComputeDefinitionService,
  getDatabaseWebhookService,
} from "@/lib/server/compute/definitions-runtime";
import {
  FunctionSecretInspectionError,
  getFunctionSecretInspector,
  type FunctionSecretInspector,
} from "@/lib/server/compute/function-secret-inspector";
import {
  collectVaultSecretOverview,
  countVaultReferences,
} from "@/lib/server/compute/vault-secret-overview";

/**
 * Die Vault-Uebersicht einer Projektumgebung (2.58).
 *
 * Dieselbe Tuer wie die Secrets einer Function (2.38): Administratorsitzung,
 * kein einziger Query-Parameter, `private, no-store`, und 503 mit Code, wenn
 * kein Vault da ist. Die Antwort traegt je Referenz den Pfadausdruck, eines von
 * drei Woertern und die Stellen, die sie benutzen. Kein Wert, keine Version,
 * keine Metadaten.
 *
 * Was die Route nicht kann, und zwar absichtlich: den Vault auflisten. Sie
 * kennt nur, worauf QKERN selbst zeigt.
 */
export function createComputeSecretOverviewHandlers(
  definitions: ComputeDefinitionService,
  databaseWebhooks: DatabaseWebhookService,
  inspector: () => FunctionSecretInspector | null,
) {
  return {
    GET: async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
      try {
        const context = await adminComputeContext(request, routeContext);
        if ([...request.nextUrl.searchParams.keys()].length > 0) {
          return computeNoStore({ error: "Invalid compute request" }, 400);
        }
        let vault: FunctionSecretInspector | null;
        try {
          vault = inspector();
        } catch {
          return computeNoStore({ error: "Vault is misconfigured", code: "VAULT_MISCONFIGURED" }, 503);
        }
        if (!vault) {
          return computeNoStore({ error: "Vault is not connected", code: "VAULT_NOT_CONFIGURED" }, 503);
        }
        const [functions, webhooks, bridged] = await Promise.all([
          definitions.listFunctions(context.principal, context.scope),
          definitions.listWebhooks(context.principal, context.scope),
          databaseWebhooks.list(context.principal, context.scope),
        ]);
        const references = await collectVaultSecretOverview(
          { functions, webhooks, databaseWebhooks: bridged }, vault);
        return computeNoStore({
          data: {
            references,
            counts: countVaultReferences(references),
            checkedAt: new Date().toISOString(),
          },
        });
      } catch (error) {
        if (error instanceof FunctionSecretInspectionError) {
          return computeNoStore({ error: "Vault is unavailable", code: "VAULT_UNAVAILABLE" }, 503);
        }
        return computeRouteError(error);
      }
    },
  };
}

export const GET = async (request: NextRequest, routeContext: ComputeDefinitionRouteContext) => {
  try {
    return await createComputeSecretOverviewHandlers(
      getComputeDefinitionService(), getDatabaseWebhookService(), getFunctionSecretInspector,
    ).GET(request, routeContext);
  } catch (error) { return computeRouteError(error); }
};
