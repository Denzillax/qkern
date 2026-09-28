import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";
import { PROJECT_AUTH_OAUTH_TOKEN } from "@/lib/server/project-auth/oauth";
import { hashProjectAuthToken } from "@/lib/server/project-auth/tokens";
import { mcpOAuthScopesOpenAnyTool } from "@/mcp/tool-scopes";
import type { MCPContext } from "@/mcp/server";

/**
 * Das Gate vor dem entfernten MCP-Weg (2.91).
 *
 * Bis hierher war Remote MCP gesperrt, und der Riegel nannte den Grund: Es gab
 * keine Pruefung, die einen fremden Aufrufer in einen Mandanten uebersetzt.
 * Seit 2.82 gibt es sie, und dieses Modul ist die Verbindung. Es ersetzt den
 * Riegel; es erweitert ihn nicht.
 *
 * ## Woher der Mandant kommt, und woher nicht
 *
 * **Nicht aus der Prozessumgebung.** `QKERN_MCP_ORGANIZATION_ID`,
 * `QKERN_MCP_PROJECT_ID` und `QKERN_MCP_ENVIRONMENT` gelten auf diesem Weg
 * nicht, und zwar auch dann nicht, wenn sie gesetzt sind. Beides zu mischen
 * waere der Fehler, vor dem `docs/MCP_REMOTE_AUTH.md` seit dem ersten Satz
 * warnt: Ein Server, der den Mandanten aus seiner Umgebung nimmt und die
 * Erlaubnis aus dem Token, gibt einem Token aus Projekt A die Daten aus
 * Projekt B, sobald jemand den Prozess anders startet. Es gibt dann keine
 * Stelle mehr, an der die beiden Angaben verglichen werden, weil die eine
 * gar nicht auf der Leitung war.
 *
 * **Sondern aus dem, was der Aufrufer vorlegt**, und das sind zwei Dinge:
 *
 * 1. Ein Projekt-Key in `x-qkern-key`. Er nennt Organisation, Projekt und
 *    Umgebung. Er muss sein, und nicht aus Bequemlichkeit: Ein OAuth-Token ist
 *    undurchsichtig, seine Zeile wird **innerhalb** eines Mandanten
 *    nachgeschlagen, und ohne diesen Mandanten gibt es die Abfrage nicht, mit
 *    der das Token ueberhaupt gefunden wuerde. Dieselbe Bedingung stellt die
 *    Data API (`projectApplicationPrincipal`), und aus demselben Grund.
 * 2. Ein OAuth-Token in `Authorization: Bearer`. Es nennt den Client, den
 *    Nutzer und die Bereiche.
 *
 * Passen die beiden nicht zusammen, findet das Token in diesem Mandanten keine
 * Zeile, und der Ausgang ist der der unbekannten Token. Ein Mandantentausch
 * ueber Kopfzeilen ist damit nicht abgewehrt, sondern nicht ausdrueckbar.
 *
 * ## Was eine Ablehnung verraet
 *
 * Nichts, ausser der Art der Frage. Unbekannt, abgelaufen, widerrufen, an einen
 * gesperrten Nutzer gebunden oder gar kein Token: alles derselbe 401 ohne
 * Grund. Wer den Grund erfaehrt, bekommt ein Werkzeug zum Probieren, und wer
 * ihn wirklich braucht, ist der Betreiber und liest ihn im Audit. Dieselbe
 * Linie ziehen `GET /auth/oauth/userinfo` und `oauthPrincipal` in der Data API;
 * hier steht sie nicht neu, sondern noch einmal.
 *
 * Ein echtes Token, das **keinen** Bereich fuer ein Werkzeug traegt, ist der
 * eine Fall, der anders ausgeht: 403 mit einem Satz. Das ist keine
 * Anmeldefrage, sondern eine Rechtefrage, das Token gilt ja. Ein 401 forderte
 * hier zum erneuten Anmelden auf und aenderte nichts, weil dasselbe Token
 * wiederkaeme. Auch das ist die Antwort, die QKERN sonst gibt.
 */
export type McpOAuthAdmission =
  | { ok: true; context: MCPContext; sessionBinding: string }
  | { ok: false; status: 401 | 403; error: string };

const UNAUTHORIZED = { ok: false, status: 401, error: "Unauthorized" } as const;

export type McpOAuthHeaders = { authorization?: string; projectKey?: string };

export async function admitMcpOAuthRequest(
  headers: McpOAuthHeaders,
  dependencies: { keys?: ProjectApiKeyService; projectAuth?: ProjectAuthService } = {},
): Promise<McpOAuthAdmission> {
  const bearer = headers.authorization?.match(/^Bearer\s+([^\s]+)$/i)?.[1] ?? null;
  // Die Form zuerst, und bevor irgendetwas nachgeschlagen wird. Ein Aufrufer,
  // der Muell schickt, soll weder eine Key-Abfrage noch eine Token-Abfrage
  // kosten.
  if (!bearer || !PROJECT_AUTH_OAUTH_TOKEN.test(bearer)) return UNAUTHORIZED;
  const projectKey = headers.projectKey?.trim();
  if (!projectKey) return UNAUTHORIZED;

  const keys = dependencies.keys ?? projectApiKeyService;
  const keyPrincipal = await keys.authenticate(projectKey);
  if (!keyPrincipal) return UNAUTHORIZED;

  const scope = {
    organizationId: keyPrincipal.organizationId,
    projectId: keyPrincipal.projectId,
    environment: keyPrincipal.environment,
  };
  const service = dependencies.projectAuth ?? getProjectAuthService();
  let verdict: Awaited<ReturnType<ProjectAuthService["verifyOAuthToken"]>>;
  try {
    verdict = await service.verifyOAuthToken(scope, bearer);
  } catch {
    return UNAUTHORIZED;
  }
  if (!verdict.ok) return UNAUTHORIZED;
  const identity = verdict.identity;

  if (!mcpOAuthScopesOpenAnyTool(identity.scopes)) {
    return {
      ok: false, status: 403,
      error: "This OAuth token carries no scope that opens a QKERN MCP tool",
    };
  }

  return {
    ok: true,
    context: {
      ...scope,
      // Dieselbe Schreibweise wie an der HTTP-Tuer. Wer im Audit oder im
      // Data-API-Log sucht, soll nicht daran erkennen muessen, ob eine fremde
      // Anwendung ueber REST oder ueber MCP gekommen ist: Sie ist dieselbe
      // Anwendung im Namen desselben Nutzers.
      actorRef: `project-auth-oauth:${identity.clientName}:${identity.userId}`.slice(0, 320),
      access: {
        kind: "project_oauth",
        clientName: identity.clientName,
        userId: identity.userId,
        email: identity.email,
        scopes: identity.scopes,
      },
    },
    // Woran eine Sitzung haengt (siehe `mcp/http-server.ts`): die Pruefsumme des
    // Tokens, nicht das Token. Der Wert wird verglichen und nie ausgegeben, und
    // er steht damit auch nicht im Speicher einer laufenden Sitzung.
    sessionBinding: hashProjectAuthToken(bearer),
  };
}
