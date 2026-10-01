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
 * **Storage, `storage:write` seit 2.116.** 2.69 hat den Bereich weggelassen und
 * das so begruendet: Es gab kein schreibendes Storage-Werkzeug, ein Bereich, den
 * niemand prueft, ist eine Beschriftung, und auf einer Zustimmungsseite ist eine
 * Beschriftung schlimmer als ein fehlender Eintrag. Er sollte mit dem Werkzeug
 * kommen, das ihn braucht, und das ist `qkern_storage_object_delete`.
 *
 * Das Werkzeug ist ein Loeschen und kein Hochladen. Der Grund steht
 * ausfuehrlich an seiner Anmeldung in `mcp/server.ts`: Ein Hochladen ist bei
 * QKERN Reservierung, Bytes beim Anbieter, Abschluss mit Pruefsumme und Scan,
 * und der mittlere Schritt gehoert nicht in einen Modellkontext.
 *
 * Der Bereich oeffnet damit genau eine Handlung an genau einem Objekt. Keinen
 * Bucket: Anlegen, Aendern und Entfernen eines Buckets verlangen die
 * Betreiberrolle, sie stehen in dieser Tabelle nicht, und ein Name ohne Eintrag
 * ist keine Erlaubnis. Kein Hochladen, keinen Grant, keinen Scan.
 *
 * Und er traegt eine Decke, die es bei `storage:read` nicht gibt: Das
 * Loeschwerkzeug laeuft ueber OAuth mit der Rolle `authenticated` und der
 * Kennung des zustimmenden Nutzers als Subjekt, und die Betreiberrolle bleibt
 * dem lokalen Bearer. Die
 * Schreibregel des Buckets entscheidet damit wirklich, und bei `owner` gibt ein
 * Bucket nur die Objekte dieses Nutzers her. Der Grund dafuer steht unten unter
 * "Was ein Bereich hier nicht ist": Bei einem Lesen war die Betreiberrolle eine
 * offene Grenze, bei einem Loeschen waere sie eine Rechteausweitung durch
 * Zustimmung eines Endnutzers.
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
 * ## Die zwei, die seit 2.117 `data:read` tragen
 *
 * Bis 2.116 trugen beide `null`, und die Begruendung von 2.91 war richtig:
 * `qkern_query_readonly` fuehrte SQL durch `ProjectDataPlaneService` aus, also
 * mit der Leserolle des Projekts und ohne `request.jwt.claims`. Die
 * Zeilensicherheit war dabei an, die Rolle traegt kein `BYPASSRLS`; eine Policy
 * hatte nur keine Ansprueche zu lesen, und eine Tabelle ohne Policy gab alles
 * her. Das war kein Lesen als dieser Nutzer. 2.91 hat dazu geschrieben, wer
 * diesen zwei einen Bereich gibt, muss sie vorher unter die Zeilensicherheit
 * stellen, und das ist ein eigener Schnitt. Das ist dieser Schnitt.
 *
 * **`qkern_query_readonly`** laeuft ueber OAuth durch
 * `GeneratedDataApiPort.queryUnderRowSecurity`, also durch dieselbe Tuer wie
 * `qkern_table_rows_list`: Rolle `authenticated`, die Ansprueche des
 * zustimmenden Nutzers, `row_security = on`, `BEGIN READ ONLY`, dieselben
 * Zeitlimits. Dazu liest `lib/server/data-plane/free-query.ts` den Abfragetext
 * und nennt jede Relation darin, und jede geht durch
 * `assertTableBoundary(..., "select")`. Eine Tabelle ohne Zeilensicherheit ist
 * ueber diesen Weg darum nicht erreichbar, auch mit Leserecht nicht. Was das
 * kostet, steht in der Beschreibung des Werkzeugs: Tabellen mit Schema,
 * Funktionen nur aus einer Liste und unqualifiziert, keine Systemkataloge, harte
 * Grenzen bei Zeilen, Bytes und Zeit.
 *
 * **`qkern_schema_list`** ist eine eigene Frage und hat eine eigene Antwort. Ein
 * Schema zu kennen ist kein Lesen von Zeilen, und `inspectSchema` zeigt jede
 * Tabelle eines Schemas mit jeder Spalte, auch die ohne Policy. Ueber OAuth
 * antwortet dieses Werkzeug darum mit `listReadableTables`: die Tabellen, die
 * diese Flaeche lesend bedient, Spalten mit sensiblem Namen heraus. Das ist
 * genau das Dokument, das derselbe Token heute schon ueber
 * `generated-openapi` und ueber die GraphQL-Introspektion bekommt, und beide
 * Tueren verlangen dort `data:read`. Ein Bereich, der an einer Tuer gilt und an
 * der anderen nicht, waere kein Bereich.
 *
 * `project:read` waere hier die falsche Antwort. Dieser Bereich sagt etwas ueber
 * die Gestalt der Projektumgebung, ihren Eintrag und ihre Automatisierungsregel.
 * Die Gestalt der Daten gehoert zur Data API.
 *
 * Beim statischen Bearer bleiben beide, was sie waren: der ganze Katalog und
 * eine Abfrage ohne Policy, auf dem Rechner des Entwicklers und nur dort.
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
 * Und meistens keine Rolle. Die lesenden Storage-Werkzeuge und die Queues laufen
 * in diesem Server mit `role: "admin"` im Namen des Betreibers, nicht unter
 * einer Zeilensicherheit des zustimmenden Nutzers; ein Bucket hat keine Policy
 * je Zeile, eine Queue auch nicht. `storage:read` und `queues:read` sagen darum
 * etwas ueber diese Projektumgebung und nichts ueber "meine Daten". Die Console
 * sagt das bei jedem der beiden, und die Decke am Client bleibt die Stelle, an
 * der ein Betreiber entscheidet, welche Anwendung so etwas ueberhaupt verlangen
 * darf.
 *
 * `storage:write` ist die Ausnahme, und sie hat einen Grund. 2.69 hat diese
 * Grenze als offen notiert, und bei einem Lesen war sie tragbar: Was ein
 * Betreiber ueber seine Buckets ausgibt, sieht der Client, und mehr passiert
 * nicht. Bei einem Loeschen waere derselbe Satz eine Rechteausweitung durch
 * Zustimmung eines Endnutzers, denn die Betreiberrolle gibt jedes Objekt jedes
 * Buckets her, auch das eines anderen Nutzers. Darum laeuft
 * `qkern_storage_object_delete` ueber OAuth mit der Rolle `authenticated` und
 * der Kennung des zustimmenden Nutzers, und die Schreibregel des Buckets
 * entscheidet. Die Decke am Client bleibt darueber stehen; sie ist jetzt die
 * zweite und nicht die einzige.
 */
export const MCP_TOOL_SCOPES = {
  qkern_project_get: "project:read",
  qkern_automation_policy_get: "project:read",
  // Seit 2.117 unter der Zeilensicherheit, und darum mit Bereich. Die
  // Schemaliste gibt ueber OAuth die lesbaren Tabellen und nicht den ganzen
  // Katalog, die freie Abfrage laeuft durch die Lesetuer der Data API. Beide
  // Begruendungen stehen oben und an der Anmeldung in `mcp/server.ts`.
  qkern_schema_list: "data:read",
  qkern_query_readonly: "data:read",
  qkern_storage_buckets_list: "storage:read",
  qkern_storage_objects_list: "storage:read",
  // Loeschen eines Objekts, und nur das. Kein Hochladen, kein Grant, kein
  // Bucket. Es laeuft ueber OAuth unter der Schreibregel des Buckets als der
  // zustimmende Nutzer; der Grund steht oben und an der Anmeldung.
  qkern_storage_object_delete: "storage:write",
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
