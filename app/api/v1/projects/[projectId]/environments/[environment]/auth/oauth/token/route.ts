import { NextRequest } from "next/server";
import { safeJson } from "@/lib/server/auth/http";
import {
  projectAuthNoStore, projectAuthOriginAllowed, projectAuthPreflight, projectAuthRouteError,
  publicProjectAuthScope, withProjectAuthCors, type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import { ProjectAuthOAuthError } from "@/lib/server/project-auth/service";

/**
 * `POST /auth/oauth/token` (2.82): Aus einem Code wird ein Token, genau einmal.
 *
 * **Die Tuer:** Public Key dieser Projektumgebung, und sonst nichts. Kein Access
 * Token des Nutzers, denn er ist an dieser Stelle nicht mehr dabei: Der Browser
 * ist zur Anwendung zurueckgesprungen, und die Anwendung loest den Code auf
 * eigenem Weg ein. Und kein Client-Geheimnis, denn es gibt keines; der Beweis,
 * dass hier dieselbe Anwendung ruft, die den Anlauf begonnen hat, ist der
 * Prueftext.
 *
 * **Warum ein zweites Einloesen fallen muss:** Ein Code, der zweimal gilt, ist
 * ein Code, den ein Angreifer aus dem Browserverlauf noch einmal einloesen kann,
 * nachdem die echte Anwendung ihn schon benutzt hat. Der Dienst verbraucht ihn
 * darum in derselben Anweisung, in der er ihn findet, und zwar **bevor** der
 * Prueftext geprueft wird: Ein Code, der einmal vorgezeigt wurde, ist weg, gleich
 * wie es weitergeht.
 *
 * **Warum die Antwort keinen Grund nennt:** Ein Aufrufer, der erfaehrt, ob sein
 * Ruecksprungziel oder sein Prueftext nicht gepasst hat, bekommt ein Werkzeug
 * zum Probieren. Hier kommt, anders als beim Anlauf, niemand mit einer
 * Anmeldung: Es ist eine offene Tuer, und was sie sagt, sagt sie jedem. Der
 * Betreiber liest den Grund unter Auth → Audit-Log.
 *
 * **Was hier nicht geht:** `grant_type=password`, `client_credentials` und
 * `refresh_token`. Jedes davon faellt mit `grant_type_unsupported` und damit als
 * Auskunft, dass dieser Server das Verfahren nicht kennt. Die Gruende stehen in
 * `lib/server/project-auth/oauth.ts` und auf der Seite in der Console.
 */
export async function POST(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
  try {
    const scope = await publicProjectAuthScope(request, routeContext);
    const body = await safeJson(request);
    const result = await getProjectAuthService().exchangeOAuthCode(scope, body);
    return withProjectAuthCors(request, projectAuthNoStore({ data: result }));
  } catch (error) {
    // Eine Ablehnung an der **Form** bekommt ihren Grund: Wer `grant_type` falsch
    // schreibt oder einen Prueftext von 12 Zeichen schickt, erfaehrt damit nichts
    // ueber einen fremden Code. Eine Ablehnung am **Inhalt** kommt als
    // ProjectAuthError heraus und wird zu "Authentication failed" ohne Grund.
    if (error instanceof ProjectAuthOAuthError) {
      return withProjectAuthCors(request, projectAuthNoStore({
        error: "Invalid Project Auth OAuth request",
        reason: error.reason,
        field: error.field,
      }, 400));
    }
    return projectAuthRouteError(error, request);
  }
}

export const OPTIONS = (request: NextRequest) => projectAuthPreflight(request, "POST, OPTIONS");
