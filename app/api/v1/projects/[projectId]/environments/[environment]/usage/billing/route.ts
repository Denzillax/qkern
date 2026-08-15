import type { NextRequest } from "next/server";
import { getBillingService } from "@/lib/server/usage/runtime";
import type { BillingService } from "@/lib/server/usage/billing";
import {
  usageNoStore,
  usageReadContext,
  usageRouteError,
  type UsageRouteContext,
} from "@/lib/server/usage/http";

/**
 * Die Monatsprojektion in Geld — lesend, und nur lesend.
 *
 * Preise setzt kein Browser: Das Preisblatt ist wie die Quota-Policies eine
 * interne Autoritaet (`operator`), und diese Grenze liegt im Dienst, nicht
 * hier. Die Antwort traegt `kind: "projection"` — sie ist keine Rechnung,
 * hat keine Nummer und keine Faelligkeit.
 *
 * Fehlerweg und Kontext sind die der Usage-Flaeche: dieselbe Authentifizierung,
 * derselbe `usageRouteError` — und damit auch dessen 503-Regel fuer den
 * erschoepften Verbindungspool aus `1.65.0`.
 */
export function createBillingHandlers(service: BillingService) {
  return {
    GET: async (request: NextRequest, routeContext: UsageRouteContext) => {
      try {
        const keys = [...request.nextUrl.searchParams.keys()];
        if (keys.some((key) => key !== "period") || request.nextUrl.searchParams.getAll("period").length > 1) {
          return usageNoStore({ error: "Invalid usage request" }, 400);
        }
        const context = await usageReadContext(request, routeContext);
        const period = request.nextUrl.searchParams.get("period") ?? undefined;
        return usageNoStore({
          data: await service.readBillingProjection(context.principal, context.scope, { period }),
        });
      } catch (error) { return usageRouteError(error); }
    },
  };
}

export const GET = (request: NextRequest, context: UsageRouteContext) =>
  createBillingHandlers(getBillingService()).GET(request, context);
