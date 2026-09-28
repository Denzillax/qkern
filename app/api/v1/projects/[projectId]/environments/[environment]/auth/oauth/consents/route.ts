import { NextRequest } from "next/server";
import { safeJson } from "@/lib/server/auth/http";
import {
  presentedProjectAccessToken, projectAuthNoStore, projectAuthOriginAllowed, projectAuthPreflight,
  projectAuthRouteError, publicProjectAuthScope, withProjectAuthCors,
  type ProjectAuthRouteContext,
} from "@/lib/server/project-auth/http";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import { ProjectAuthError, ProjectAuthOAuthError } from "@/lib/server/project-auth/service";

/**
 * `POST /auth/oauth/consents` (2.92): Ein angemeldeter Nutzer dieses Projekts
 * erteilt einem Client seine Zustimmung, und sie wird eine Zeile.
 *
 * **Warum es diese Route ueberhaupt gibt.** Bis 2.82 war die Zustimmung ein
 * Vorgang ohne Spur: Die Anwendung zeigte dem Nutzer, was sie wollte, und rief
 * danach `POST /auth/oauth/authorize`. Ob der Nutzer je etwas erlaubt hatte,
 * stand nirgends; widerrufbar war nur der ganze Client, und welcher Nutzer
 * welchem Client zugestimmt hatte, wusste niemand. Seit dieser Route steht es
 * in `project_auth_oauth_consents` (Migration 0064), mit Nutzer, Client,
 * Bereichen, Zeitpunkt und Widerruf.
 *
 * **Was diese Route belegt.** Dass ein Aufrufer mit dem gueltigen Access Token
 * dieses Nutzers genau diese Bereiche ausdruecklich genannt hat, zu diesem
 * Zeitpunkt, in einer Anfrage, die nichts anderes tut.
 *
 * **Was sie nicht belegt.** Dass ein Mensch eine Liste gelesen hat. QKERN hat
 * keine eigene Zustimmungsseite, und eine zu bauen hiesse, einen Anmeldefluss
 * im Browser zu bauen; das ist ein eigener Schnitt und nicht dieser. Die Console
 * sagt denselben Satz an derselben Stelle, an der sie die Zustimmungen zeigt.
 *
 * **Die Tuer** ist dieselbe wie beim Anlauf: Public Key dieser Projektumgebung
 * und das Access Token des Nutzers im `Authorization`-Kopf. Wer zustimmt, kommt
 * aus diesem Token und nie aus dem Rumpf; eine Kennung im Rumpf waere die
 * Erlaubnis, im Namen eines Fremden zuzustimmen.
 *
 * **Zweimal dasselbe ist einmal.** Dieselben Bereiche fuer denselben Client
 * geben dieselbe Zeile zurueck, mit ihrem urspruenglichen Zeitpunkt, und legen
 * keine zweite an. Andere Bereiche sind etwas anderes und werden eine zweite
 * Zeile; die erste bleibt stehen und gilt weiter.
 *
 * **Kein GET.** Wer wissen will, welche Zustimmungen es gibt, ist der Betreiber,
 * und er liest sie in der Console hinter der Admin-Tuer. Eine oeffentliche Liste
 * waere die Frage "wem hat dieser Mensch sonst noch zugestimmt", und die
 * beantwortet dieser Schnitt niemandem. Die Seite sagt, dass ein Nutzer seine
 * eigene Zustimmung heute nicht selbst zurueckziehen kann.
 */
export async function POST(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
  try {
    const scope = await publicProjectAuthScope(request, routeContext);
    const token = presentedProjectAccessToken(request);
    if (!token) throw new ProjectAuthError("INVALID_TOKEN");
    const body = await safeJson(request);
    const result = await getProjectAuthService().grantOAuthConsent(scope, token, body);
    return withProjectAuthCors(request, projectAuthNoStore({ data: result }, 201));
  } catch (error) {
    // Mit Grund, wie beim Anlauf und anders als beim Einloesen: Wer zustimmt,
    // ist der angemeldete Nutzer selbst, und der Entwickler dieser Anwendung
    // soll lesen koennen, dass sein Client nicht hinterlegt ist oder ein Bereich
    // nicht zu ihm gehoert. Er bekommt damit nichts, was er nicht ohnehin in der
    // Console sehen kann.
    if (error instanceof ProjectAuthOAuthError) {
      return withProjectAuthCors(request, projectAuthNoStore({
        error: "Invalid Project Auth OAuth consent",
        reason: error.reason,
        field: error.field,
      }, 400));
    }
    return projectAuthRouteError(error, request);
  }
}

export const OPTIONS = (request: NextRequest) => projectAuthPreflight(request, "POST, OPTIONS");
