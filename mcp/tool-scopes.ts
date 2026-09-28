import {
  projectAuthOAuthAllows,
  type ProjectAuthOAuthScope,
} from "@/lib/server/project-auth/oauth";

/**
 * Welches MCP-Werkzeug welcher Bereich freigibt (2.91).
 *
 * Das ist die eine Stelle. Es gibt keine zweite Liste, keine Ableitung aus der
 * Annotation `readOnlyHint` und keine Regel, die aus dem Namen eines Werkzeugs
 * auf seinen Bereich schliesst. Eine Zuordnung an zwei Stellen waere zwei
 * Antworten auf dieselbe Frage, und die gefaehrlichere davon gewaenne
 * irgendwann still.
 *
 * `null` heisst: **ueber OAuth nicht erreichbar**. Nicht "noch nicht", nicht
 * "mit Vorbehalt", sondern das Werkzeug wird fuer einen OAuth-Aufrufer gar
 * nicht erst angemeldet. Es steht damit auch nicht in `tools/list`: Ein
 * Werkzeug, das ein Client sieht und nicht aufrufen darf, ist eine Einladung
 * zum Probieren.
 *
 * ## Warum so wenige
 *
 * Die Bereiche aus 2.82 sind `identity:read`, `data:read` und `data:write`, und
 * jeder von ihnen sagt genau einen Satz. `data:read` sagt: Lesen durch die Data
 * API, **unter der Zeilensicherheit, als dieser Nutzer**. Das ist der Massstab,
 * und die meisten Werkzeuge dieses Servers halten ihn nicht ein:
 *
 * * `qkern_query_readonly` fuehrt SQL durch die Data Plane, ohne Ansprueche und
 *   damit ohne Policy. Das ist kein Lesen als dieser Nutzer, sondern ein Lesen
 *   an ihm vorbei. Unter `data:read` freigegeben waere es die Umgehung genau
 *   der Grenze, die der Bereich verspricht.
 * * `qkern_schema_list` liest die Gestalt der Datenbank, nicht ihre Zeilen.
 *   Eine Policy entscheidet ueber Zeilen; ueber Spaltennamen entscheidet sie
 *   nicht. Ein fremder Client bekaeme mit `data:read` die Struktur eines
 *   Projekts, obwohl der Nutzer dem Lesen **seiner** Daten zugestimmt hat.
 * * `qkern_project_get`, `qkern_automation_policy_get` und `qkern_logs_search`
 *   lesen die Control Plane. Sie gehoert der Organisation und nicht dem Nutzer,
 *   der zugestimmt hat, und kein Bereich beschreibt sie.
 * * Storage und Queues laufen mit `role: "admin"` im Namen des Betreibers. Es
 *   gibt keinen Bereich, der einen Bucket oder eine Queue beschreibt, und
 *   `lib/server/data-plane/generated-http.ts` sagt denselben Satz schon fuer
 *   die HTTP-Tueren dieser beiden.
 * * `qkern_migration_preview` und `qkern_migration_apply_queue` aendern den
 *   Zustand der Control Plane. Ein Apply ueber einen fremden Client ist die
 *   Tuer, die niemand will; ein Preview ist die Haelfte davon und darum
 *   ebenfalls keine.
 *
 * Es bleiben die vier Werkzeuge, die wirklich durch die generierte Data API
 * gehen und deren Anfrage wirklich unter der Zeilensicherheit dieses Nutzers
 * steht. Lieber vier ehrliche als acht, von denen zwei etwas anderes tun, als
 * ihr Bereich zusagt.
 *
 * ## Warum `identity:read` hier nirgends steht
 *
 * Kein Werkzeug dieses Servers gibt aus, wer zugestimmt hat; dafuer gibt es
 * `GET /auth/oauth/userinfo`. Der Bereich ist auf diesem Weg trotzdem nicht
 * wirkungslos: Er entscheidet, ob die Ansprueche der Data-API-Anfrage die
 * E-Mail-Adresse des Nutzers tragen, genau wie an der HTTP-Tuer. Ein Bereich,
 * der an einer Stelle gilt und an einer anderen nicht, waere kein Bereich.
 *
 * ## Warum Schreiben nicht Lesen einschliesst
 *
 * `data:write` gibt die drei Mutationen frei und `qkern_table_rows_list` nicht.
 * Dieselbe Trennung zieht die Data API: Eine schreibende Route verlangt
 * `data:write` und nicht beides. Wer lesen und schreiben will, laesst beidem
 * zustimmen, und der Nutzer sieht auf der Zustimmungsseite beides stehen.
 */
export const MCP_TOOL_SCOPES = {
  qkern_project_get: null,
  qkern_automation_policy_get: null,
  qkern_schema_list: null,
  qkern_query_readonly: null,
  qkern_storage_buckets_list: null,
  qkern_storage_objects_list: null,
  qkern_queues_list: null,
  qkern_queue_status: null,
  qkern_queue_message_enqueue: null,
  qkern_table_rows_list: "data:read",
  qkern_table_rows_insert: "data:write",
  qkern_table_row_update: "data:write",
  qkern_table_row_delete: "data:write",
  qkern_logs_search: null,
  qkern_migration_preview: null,
  qkern_migration_apply_queue: null,
} as const satisfies Record<string, ProjectAuthOAuthScope | null>;

export type McpToolName = keyof typeof MCP_TOOL_SCOPES;

/** Die Werkzeuge, die ein OAuth-Token ueberhaupt erreichen kann, in der Reihenfolge der Tabelle. */
export const MCP_OAUTH_TOOLS = (Object.keys(MCP_TOOL_SCOPES) as McpToolName[])
  .filter((tool) => MCP_TOOL_SCOPES[tool] !== null);

export function isMcpToolName(value: string): value is McpToolName {
  return Object.hasOwn(MCP_TOOL_SCOPES, value);
}

/**
 * Darf ein Token mit diesen Bereichen dieses Werkzeug?
 *
 * Geschlossen im Zweifel, und an zwei Stellen: Ein Name ohne Eintrag ist keine
 * Erlaubnis, und ein Eintrag `null` ist keine. Wer ein Werkzeug hinzufuegt und
 * die Tabelle vergisst, hat es damit nicht versehentlich freigegeben, sondern
 * gesperrt, und `createQKERNMcpServer` wirft ihm den fehlenden Eintrag zusaetzlich
 * vor die Fuesse.
 */
export function mcpToolAllowedForScopes(
  tool: string,
  scopes: readonly ProjectAuthOAuthScope[],
): boolean {
  if (!isMcpToolName(tool)) return false;
  const needed = MCP_TOOL_SCOPES[tool];
  if (needed === null) return false;
  return projectAuthOAuthAllows(scopes, needed);
}

/**
 * Oeffnet dieses Bereichsbuendel ueberhaupt ein Werkzeug?
 *
 * Gefragt wird das an der Tuer, bevor eine Sitzung entsteht. Ein Token, das
 * nur `identity:read` traegt, ist echt und gehoert trotzdem nicht hierher: Es
 * bekaeme eine Sitzung ohne ein einziges Werkzeug, und der Client saehe einen
 * leeren Server statt einer Antwort auf seine Frage.
 */
export function mcpOAuthScopesOpenAnyTool(scopes: readonly ProjectAuthOAuthScope[]): boolean {
  return MCP_OAUTH_TOOLS.some((tool) => mcpToolAllowedForScopes(tool, scopes));
}
