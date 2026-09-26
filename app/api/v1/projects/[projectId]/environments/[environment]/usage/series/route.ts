import type { NextRequest } from "next/server";
import { getUsageService } from "@/lib/server/usage/runtime";
import type { UsageService } from "@/lib/server/usage/service";
import {
  usageNoStore,
  usageReadContext,
  usageRouteError,
  type UsageRouteContext,
} from "@/lib/server/usage/http";

/**
 * Die Zeitreihe einer Metrik — lesend, die Lesefläche aus 2.45.
 *
 * Zwei Parameter und kein dritter: `metric` ist Pflicht, `bucket` ist `hour`
 * oder `day` und steht ohne Angabe auf `hour`. Alles andere — ein
 * unbekannter Name, eine zweite Angabe desselben Parameters, ein Parameter,
 * den diese Route nicht kennt — ist ein 400, und zwar **vor** jedem
 * Dienstaufruf. Das Fenster kommt nicht aus dem Aufruf, sondern aus der
 * Eimergrösse; die Antwort sagt, welches sie benutzt hat.
 *
 * Zugang, Kontext und Fehlerweg sind die der Usage-Fläche: dieselbe
 * Authentifizierung wie `usage/billing` und `usage/invoices`, derselbe
 * `usageRouteError` und damit auch dessen 503-Regel für den erschöpften
 * Verbindungspool aus `1.65.0`.
 */
const BUCKETS = new Set(["hour", "day"]);

export function createUsageSeriesHandlers(service: UsageService) {
  return {
    GET: async (request: NextRequest, routeContext: UsageRouteContext) => {
      try {
        const parameters = request.nextUrl.searchParams;
        const keys = [...parameters.keys()];
        if (keys.some((key) => key !== "metric" && key !== "bucket") ||
            parameters.getAll("metric").length !== 1 ||
            parameters.getAll("bucket").length > 1) {
          return usageNoStore({ error: "Invalid usage request" }, 400);
        }
        const bucket = parameters.get("bucket") ?? "hour";
        if (!BUCKETS.has(bucket)) return usageNoStore({ error: "Invalid usage request" }, 400);
        const context = await usageReadContext(request, routeContext);
        return usageNoStore({
          data: await service.readSeries(context.principal, context.scope, {
            metric: parameters.get("metric") ?? undefined,
            bucket,
          }),
        });
      } catch (error) { return usageRouteError(error); }
    },
  };
}

export const GET = (request: NextRequest, context: UsageRouteContext) =>
  createUsageSeriesHandlers(getUsageService()).GET(request, context);
