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
 * Die ausgestellten Rechnungen — lesend, die Lesefläche aus 1.68.
 *
 * Was hier zurückkommt, ist das eingefrorene Dokument des Rechnungslaufs:
 * append-only, mit Posten, neueste Periode zuerst. Geschrieben wird hier
 * nichts — Rechnungen entstehen ausschliesslich im Rechnungslauf-Prozess.
 * Fehlerweg und Kontext sind die der Usage-Fläche, inklusive der 503-Regel
 * für den erschöpften Verbindungspool aus `1.65.0`.
 */
export function createBillingInvoiceHandlers(service: BillingService) {
  return {
    GET: async (request: NextRequest, routeContext: UsageRouteContext) => {
      try {
        const keys = [...request.nextUrl.searchParams.keys()];
        if (keys.some((key) => key !== "limit") || request.nextUrl.searchParams.getAll("limit").length > 1) {
          return usageNoStore({ error: "Invalid usage request" }, 400);
        }
        const rawLimit = request.nextUrl.searchParams.get("limit");
        if (rawLimit !== null && !/^\d{1,3}$/.test(rawLimit)) {
          return usageNoStore({ error: "Invalid usage request" }, 400);
        }
        const context = await usageReadContext(request, routeContext);
        return usageNoStore({
          data: await service.listInvoices(context.principal, context.scope, {
            limit: rawLimit === null ? undefined : Number(rawLimit),
          }),
        });
      } catch (error) { return usageRouteError(error); }
    },
  };
}

export const GET = (request: NextRequest, context: UsageRouteContext) =>
  createBillingInvoiceHandlers(getBillingService()).GET(request, context);
