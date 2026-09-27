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
 * `POST /auth/oauth/authorize` (2.82): Ein angemeldeter Nutzer dieses Projekts
 * erlaubt einem Client, in seinem Namen zu arbeiten, und bekommt einen Code.
 *
 * **Diese Route antwortet mit JSON und nie mit einem 302.** Zurueck gehen der
 * Code, das Ruecksprungziel und der `state`; die Anwendung baut ihre Adresse
 * selbst. Das ist dieselbe Grenze, die 2.54 bei den Ruecksprungzielen der
 * Anmeldung zieht, und sie steht hier aus demselben Grund: Ein Ziel, das ein
 * Dienst selbst anspringt, ist eine Flaeche, auf der jede Luecke in der Pruefung
 * sofort ein offener Umleiter ist. Ein Wert, der nur verglichen und
 * zurueckgegeben wird, ist keine.
 *
 * Darum ist es auch ein POST und kein GET. Ein GET waere der Ort, an dem ein
 * Browser landet, und damit die Einladung, von hier aus weiterzuleiten. Ein POST
 * ist ein Aufruf aus der Anwendung, die den Nutzer angemeldet hat.
 *
 * **Die Tuer:** Public Key dieser Projektumgebung wie bei jeder oeffentlichen
 * Auth-Route, **und** das Access Token des Nutzers im `Authorization`-Kopf. Der
 * Nutzer, der zustimmt, kommt aus diesem Token und nie aus dem Rumpf: Eine
 * Kennung im Rumpf waere die Erlaubnis, im Namen eines Fremden zuzustimmen.
 *
 * **Was es hier nicht gibt:** `response_type=token`. Der implizite Ablauf gibt
 * das Token selbst an das Ruecksprungziel zurueck, also durch den Browser und in
 * dessen Verlauf. Wer ihn versucht, bekommt `response_type_unsupported` und
 * damit die Auskunft, dass dieser Server ihn nicht kennt, statt einer
 * allgemeinen Ablehnung, die wie ein Tippfehler aussieht.
 */
export async function POST(request: NextRequest, routeContext: ProjectAuthRouteContext) {
  if (!projectAuthOriginAllowed(request)) return projectAuthNoStore({ error: "Origin is not allowed" }, 403);
  try {
    const scope = await publicProjectAuthScope(request, routeContext);
    const token = presentedProjectAccessToken(request);
    if (!token) throw new ProjectAuthError("INVALID_TOKEN");
    const body = await safeJson(request);
    const result = await getProjectAuthService().authorizeOAuth(scope, token, body);
    return withProjectAuthCors(request, projectAuthNoStore({ data: result }, 201));
  } catch (error) {
    // Ein abgelehnter Anlauf bekommt seinen Grund, und das ist hier richtig,
    // anders als beim Einloesen: Wer zustimmt, ist der angemeldete Nutzer
    // selbst, und der Entwickler dieser Anwendung soll lesen koennen, dass sein
    // Ruecksprungziel nicht hinterlegt oder sein Bereich nicht erlaubt ist. Er
    // bekommt damit nichts, was er nicht ohnehin in der Console sehen kann.
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
