import {
  projectAuthOAuthAllows,
  type ProjectAuthOAuthScope,
} from "@/lib/server/project-auth/oauth";

/**
 * Welches MCP-Werkzeug welcher Bereich freigibt (2.91, erweitert in 2.103).
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
 * ## Was sich gegenueber 2.91 geaendert hat, und warum
 *
 * 2.91 hatte drei Bereiche zur Hand (`identity:read`, `data:read`,
 * `data:write`), und jeder sagte einen Satz ueber eine Anfrage durch die Data
 * API. Zwoelf Werkzeuge taten etwas anderes, also trugen sie `null`. Die
 * Begruendung war richtig und die Folge trotzdem eine Luecke: Diese zwoelf waren
 * nicht abgesichert, sie waren unerreichbar, und `docs/PARITAET.md` hat das so
 * gefuehrt und nicht als Zusage.
 *
 * Seit Migration 0073 gibt es sechs weitere Bereiche, und die Frage je Werkzeug
 * ist nicht mehr "gibt es einen Satz", sondern "welcher Satz beschreibt genau
 * das, was dieses Werkzeug tut". Die Antwort steht bei jedem Eintrag.
 *
 * ## Die Entscheidung je Werkzeug
 *
 * **Control Plane, `project:read`.** `qkern_project_get` gibt den Eintrag dieser
 * Projektumgebung ohne Zugangsdaten zurueck, `qkern_automation_policy_get` die
 * geltende Regel und ihre Risikogrenze. Beides ist eine Angabe ueber genau diese
 * Umgebung und nicht ueber die Organisation: keine Projektliste, keine
 * Mitglieder, keine Abrechnung. Ein Agent, der die Regel nicht lesen kann, kann
 * sich nicht an sie halten, und genau das ist die Zusage dieses Werkzeugs.
 *
 * **Audit, `logs:read`.** `qkern_logs_search` sucht im Audit-Log dieser
 * Umgebung, und das Log ist bereits redigiert und hart begrenzt. Ein eigener
 * Bereich und nicht `project:read`: Ein Audit-Log sagt, **wer wann was getan
 * hat**, also etwas ueber Personen, und die Gestalt einer Umgebung sagt das
 * nicht. Zwei verschiedene Saetze bekommen zwei Bereiche, sonst oeffnet der eine
 * mehr, als er nennt.
 *
 * **Storage, `storage:read`.** `qkern_storage_buckets_list` und
 * `qkern_storage_objects_list` lesen Buckets mit ihren festen Zugriffsregeln,
 * Kontingenten und Verbrauch sowie begrenzte Objektmetadaten. Kein Inhalt, keine
 * Signatur, keine Providerschluessel: Das Werkzeug gibt sie nicht her, und der
 * Bereich verspricht sie darum auch nicht.
 *
 * Kein `storage:write`, und das ist kein Vergessen: Es gibt kein schreibendes
 * Storage-Werkzeug. Ein Bereich, den niemand prueft, ist eine Beschriftung, und
 * auf einer Zustimmungsseite ist eine Beschriftung schlimmer als ein fehlender
 * Eintrag. Er kommt mit dem Werkzeug, das ihn braucht.
 *
 * **Queues, `queues:read` und `queues:write`.** `qkern_queues_list` und
 * `qkern_queue_status` lesen Definitionen und Zaehler je Nachrichtenzustand,
 * keine Nachrichteninhalte. `qkern_queue_message_enqueue` stellt eine Nachricht
 * ein, und **nur** das.
 *
 * Der Satz, auf den es bei `queues:write` ankommt: Er oeffnet keine
 * Worker-Operation. Claim, Lease, Renewal und Abschluss sind nach `STATUS.md`
 * bewusst aus MCP heraus, sie stehen in dieser Tabelle nicht, und ein Name ohne
 * Eintrag ist keine Erlaubnis. Der Bereich kann sie also nicht erreichbar
 * machen, und zwar nicht, weil eine Pruefung ihn aufhaelt, sondern weil es diese
 * Werkzeuge hier nicht gibt.
 *
 * **Migrationen, `migrations:propose` fuer die Vorschau und weiterhin nichts
 * fuer das Anwenden.** `qkern_migration_preview` legt eine unveraenderliche
 * Vorschau an; angewendet wird dabei nichts, und unter einer strengen Regel
 * bleibt sie schlicht offen. `qkern_migration_apply_queue` aendert den Zustand
 * der Control Plane und fuehrt zu einer Aenderung an der Projektdatenbank; ein
 * Apply ueber einen fremden Client ist die Tuer, die niemand will. Sie faellt
 * nicht unter `migrations:propose`, denn vorschlagen und anwenden sind zwei
 * Saetze, und ein Bereich, der beide oeffnet, oeffnet mehr als er nennt. Sie
 * bekommt auch keinen eigenen Bereich: Das waere eine eigene Entscheidung mit
 * eigener Widerrufsflaeche, und die gehoert in einen eigenen Schnitt und nicht
 * als Nebenwirkung in diesen.
 *
 * ## Die zwei, die weiterhin `null` tragen, und der Grund ist der von 2.91
 *
 * * `qkern_query_readonly` fuehrt SQL durch die Data Plane, ohne Ansprueche und
 *   damit ohne Policy. Das ist kein Lesen als dieser Nutzer, sondern ein Lesen
 *   an ihm vorbei. Unter `data:read` freigegeben waere es die Umgehung genau
 *   der Grenze, die der Bereich verspricht.
 * * `qkern_schema_list` liest die Gestalt der Datenbank, nicht ihre Zeilen.
 *   Eine Policy entscheidet ueber Zeilen; ueber Spaltennamen entscheidet sie
 *   nicht. Ein fremder Client bekaeme mit `data:read` die Struktur eines
 *   Projekts, obwohl der Nutzer dem Lesen **seiner** Daten zugestimmt hat.
 *
 * Es gibt fuer diese zwei auch keinen neuen Bereich mit eigenem Namen. Einen zu
 * erfinden hiesse, einen Satz hinzuschreiben, den das Produkt nicht einloest:
 * Wer ihnen einen Bereich gibt, muss vorher belegen, dass sie **unter** der
 * Zeilensicherheit lesen, und das ist eine Aenderung an der Data Plane und ein
 * eigener Schnitt.
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
 * `data:write` gibt die drei Mutationen frei und `qkern_table_rows_list` nicht,
 * und `queues:write` gibt das Einstellen frei und die Queue-Liste nicht.
 * Dieselbe Trennung zieht die Data API: Eine schreibende Route verlangt
 * `data:write` und nicht beides. Wer lesen und schreiben will, laesst beidem
 * zustimmen, und der Nutzer sieht auf der Zustimmungsseite beides stehen.
 *
 * ## Was ein Bereich hier nicht ist
 *
 * Keine Mandantengrenze. Die kommt vom Projekt-Key und davon, dass die
 * Tokenzeile in diesem Mandanten liegt (`mcp/oauth-gate.ts`), und kein Bereich
 * verschiebt sie.
 *
 * Und keine Rolle. Storage und Queues laufen in diesem Server mit
 * `role: "admin"` im Namen des Betreibers, nicht unter einer Zeilensicherheit
 * des zustimmenden Nutzers; ein Bucket hat keine Policy je Zeile, eine Queue
 * auch nicht. `storage:read` und `queues:read` sagen darum etwas ueber diese
 * Projektumgebung und nichts ueber "meine Daten". Die Console sagt das bei jedem
 * der beiden, und die Decke am Client bleibt die Stelle, an der ein Betreiber
 * entscheidet, welche Anwendung so etwas ueberhaupt verlangen darf.
 */
export const MCP_TOOL_SCOPES = {
  qkern_project_get: "project:read",
  qkern_automation_policy_get: "project:read",
  // Diese zwei lesen an der Zeilensicherheit vorbei. Ein Bereich dafuer waere
  // ein Satz, den das Produkt nicht einloest; der Grund steht oben.
  qkern_schema_list: null,
  qkern_query_readonly: null,
  qkern_storage_buckets_list: "storage:read",
  qkern_storage_objects_list: "storage:read",
  qkern_queues_list: "queues:read",
  qkern_queue_status: "queues:read",
  // Einstellen, und nur das. Claim, Lease, Renewal und Abschluss stehen in
  // dieser Tabelle nicht und sind damit nicht erreichbar.
  qkern_queue_message_enqueue: "queues:write",
  qkern_table_rows_list: "data:read",
  qkern_table_rows_insert: "data:write",
  qkern_table_row_update: "data:write",
  qkern_table_row_delete: "data:write",
  qkern_logs_search: "logs:read",
  qkern_migration_preview: "migrations:propose",
  // Das Anwenden bleibt zu, mit jedem Bereich, den es gibt.
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
