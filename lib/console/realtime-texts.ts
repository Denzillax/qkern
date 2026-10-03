/**
 * Die Texte der beiden Realtime-Seiten Einstellungen und Rechte (2.48),
 * deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `database-activity-texts` (2.46): Der Schluessel ist der
 * deutsche Text, die Console uebersetzt ihn ueber ihren Katalog, und der
 * Vertrag `console-i18n-contract` liest diese Tabellen mit und verlangt fuer
 * jeden Text en, fr und it. Das eigene Modul braucht es, weil die Ansichten
 * `t(variable)` aufrufen: Der Name einer Grenze kommt aus der Antwort der
 * Route, und ein Text hinter einer Variablen faellt durch die Suche nach
 * `t("...")`.
 *
 * Das Modul ist rein: keine Datenbank, kein React, keine Farbe, kein
 * Umgebungswert.
 *
 * Die Rechtetabelle weiter unten ist keine Erfindung und kein Entwurf. Sie
 * ist die Regel aus `lib/server/realtime/policy.ts`, Zeile fuer Zeile
 * abgeschrieben, und der Vertrag `console-realtime-view` prueft sie gegen
 * `PrefixRealtimeAuthorization`. Weicht der Code ab, faellt der Test, nicht
 * der Benutzer herein.
 */

/* ------------------------------------------------------------------ Grenzen */

export const REALTIME_LIMIT_GROUPS = ["transport", "session", "changes", "retention", "usage"] as const;
export type RealtimeLimitGroupId = (typeof REALTIME_LIMIT_GROUPS)[number];

export const REALTIME_GROUP_LABELS: Record<RealtimeLimitGroupId, string> = {
  transport: "Verbindung",
  session: "Sitzung",
  changes: "Datenbankänderungen",
  retention: "Aufbewahrung",
  usage: "Zählung",
};

export const REALTIME_UNITS = [
  "connections", "subscriptions", "messages", "events", "bytes", "milliseconds", "levels", "nodes", "keys",
] as const;
export type RealtimeUnitId = (typeof REALTIME_UNITS)[number];

export const REALTIME_UNIT_LABELS: Record<RealtimeUnitId, string> = {
  connections: "Verbindungen",
  subscriptions: "Abonnements",
  messages: "Nachrichten",
  events: "Ereignisse",
  bytes: "Bytes",
  milliseconds: "Millisekunden",
  levels: "Ebenen",
  nodes: "Knoten",
  keys: "Schlüssel",
};

export const REALTIME_ORIGINS = ["environment", "default", "code"] as const;
export type RealtimeOriginId = (typeof REALTIME_ORIGINS)[number];

export type RealtimeOriginText = { label: string; explains: string; tone: "secure" | "muted" };

/**
 * Drei Ursprünge, und ein vierter fehlt mit Absicht: Keine Grenze steht in
 * der Datenbank. Eine Spalte `database` zu fuehren hiesse, eine Speicherung
 * zu behaupten, die es nicht gibt.
 */
export const REALTIME_ORIGIN_TEXTS: Record<RealtimeOriginId, RealtimeOriginText> = {
  environment: {
    label: "Umgebung",
    explains: "Die Variable ist gesetzt; dieser Wert gilt statt der Vorgabe.",
    tone: "secure",
  },
  default: {
    label: "Vorgabe",
    explains: "Die Variable ist nicht gesetzt. Es gilt der Wert, den der Code ohne Angabe verwendet.",
    tone: "muted",
  },
  code: {
    label: "Code",
    explains: "Für diese Grenze gibt es keine Umgebungsvariable. Sie lässt sich nur im Code ändern.",
    tone: "muted",
  },
};

export type RealtimeLimitText = { label: string; explains: string };

export const REALTIME_LIMIT_TEXTS: Record<string, RealtimeLimitText> = {
  maxConnections: {
    label: "Offene Verbindungen je Prozess",
    explains: "Darüber weist der Server den Upgrade mit 503 ab, bevor irgendetwas gelesen wird.",
  },
  maxMessageBytes: {
    label: "Grösse einer eingehenden Nachricht",
    explains: "Gilt für den ganzen Rahmen. Eine grössere Nachricht wird nicht einmal geparst.",
  },
  maxBufferedBytes: {
    label: "Sendepuffer je Verbindung",
    explains: "Ist der Puffer voll, schliesst der Server die Verbindung mit 1013, statt weiter zu stauen.",
  },
  authTimeoutMs: {
    label: "Frist bis zur Anmeldung",
    explains: "Wer nach dem Verbinden nicht in dieser Zeit ein auth sendet, wird getrennt.",
  },
  heartbeatMs: {
    label: "Takt des Herzschlags",
    explains: "Der Server pingt in diesem Takt; wer zwei Takte lang nicht antwortet, wird beendet.",
  },
  messagesPerWindow: {
    label: "Nachrichten je Zeitfenster und Verbindung",
    explains: "Darüber antwortet der Server mit REALTIME_RATE_LIMITED und schliesst die Verbindung mit 4429.",
  },
  rateWindowMs: {
    label: "Länge des Zeitfensters",
    explains: "Das Fenster beginnt neu, sobald es abgelaufen ist; es gleitet nicht.",
  },
  maxSubscriptions: {
    label: "Abonnierte Kanäle je Verbindung",
    explains: "Ein weiteres Abonnement wird mit REALTIME_CHANNEL_LIMIT abgelehnt, die Verbindung bleibt.",
  },
  replayLimit: {
    label: "Nachgelieferte Ereignisse beim Abonnieren",
    explains: "So viele Ereignisse holt ein Cursor höchstens nach. Liegt mehr dazwischen, ist der Cursor veraltet.",
  },
  maxPayloadBytes: {
    label: "Grösse eines Broadcast-Payloads",
    explains: "Gemessen wird das serialisierte JSON, nicht die Nachricht drumherum.",
  },
  maxPresenceBytes: {
    label: "Grösse eines Presence-Zustands",
    explains: "Presence ist eine Notiz, kein Speicher. Grösseres wird abgelehnt.",
  },
  payloadDepth: {
    label: "Verschachtelung eines Payloads",
    explains: "Tiefere Strukturen werden abgelehnt, bevor sie irgendwo gespeichert werden.",
  },
  payloadNodes: {
    label: "Werte in einem Payload",
    explains: "Ein flaches Objekt mit sehr vielen Feldern ist genauso teuer wie ein tiefes.",
  },
  presenceKeys: {
    label: "Felder in einem Presence-Zustand",
    explains: "Mehr Felder werden als zu gross abgelehnt.",
  },
  presenceLimit: {
    label: "Angezeigte Anwesende je Kanal",
    explains: "So viele Einträge trägt ein Schnappschuss höchstens, geordnet nach Schlüssel.",
  },
  presenceLeaseMs: {
    label: "Pacht eines Presence-Eintrags",
    explains: "So lange gilt ein Eintrag ohne Erneuerung. Danach zählt er für niemanden mehr, auch wenn die Zeile noch steht.",
  },
  presenceSweepMs: {
    label: "Takt der Presence-Erneuerung",
    explains: "In diesem Takt erneuert der Prozess die Pacht seiner eigenen Verbindungen und meldet abgelaufene als gegangen.",
  },
  historyLimit: {
    label: "Nachgereichte Änderungen beim Abonnieren",
    explains: "So viele Änderungen holt ein Cursor auf einem changes-Kanal höchstens nach. Liegt mehr dazwischen, ist er veraltet.",
  },
  historyMaxAgeMs: {
    label: "Alter, bis zu dem nachgereicht wird",
    explains: "Älteres gilt als veraltet, auch wenn noch Zeilen im Feed liegen.",
  },
  changePollMs: {
    label: "Takt der Änderungsabfrage",
    explains: "So oft fragt der Poller eine beobachtete Projektdatenbank nach neuen Zeilen.",
  },
  changeBatch: {
    label: "Änderungen je Abfrage",
    explains: "Mehr Änderungen holt der nächste Takt; keine geht verloren.",
  },
  changeReconcileMs: {
    label: "Takt des Abgleichs beobachteter Projekte",
    explains: "So oft prüft die Runtime, für welche Projekte überhaupt jemand einen changes-Kanal abonniert hat.",
  },
  eventRetentionMs: {
    label: "Aufbewahrung der Broadcast-Ereignisse",
    explains: "Ältere Ereignisse werden gelöscht. Danach ist ein Cursor darauf veraltet, nicht falsch.",
  },
  changeRetentionMs: {
    label: "Aufbewahrung der erfassten Änderungen",
    explains: "Gilt für die Änderungstabelle in der Projektdatenbank.",
  },
  retentionIntervalMs: {
    label: "Takt des Aufräumens",
    explains: "Aufgeräumt wird nur für Projekte, die ausdrücklich in der Umgebung stehen.",
  },
  presenceRetentionMs: {
    label: "Frist bis zum Löschen einer abgelaufenen Presence",
    explains: "Die Zeile fällt erst diese Frist nach dem Ablauf, damit eine Fehlersuche sie noch findet.",
  },
  usageFlushAt: {
    label: "Gezählte Nachrichten bis zum Schreiben",
    explains: "Die Zählung wird gebündelt geschrieben, nicht je Nachricht.",
  },
  usageFlushMs: {
    label: "Zeit bis zum Schreiben der Zählung",
    explains: "Auch ohne volle Bündel wird in diesem Takt geschrieben.",
  },
};

export function realtimeLimitText(id: string): RealtimeLimitText {
  return REALTIME_LIMIT_TEXTS[id] ?? { label: id, explains: "Diese Grenze ist in der Console noch nicht beschrieben." };
}

/* -------------------------------------------------------------- Ehrlichkeit */

/** Der Satz über der Tabelle. Er steht dort, weil die Seite keinen Speicherknopf hat und nie einen bekommt. */
export const REALTIME_SETTINGS_HONESTY =
  "Diese Werte gelten für diese Installation. Ändern lassen sie sich in der Umgebung, nicht in der Console.";

/**
 * Der zweite Satz. Die Console liest die Umgebung ihres eigenen Prozesses;
 * der Realtime-Server ist ein anderer. In einem Stack mit einer Umgebung ist
 * das dasselbe, in zwei Umgebungen nicht.
 */
export const REALTIME_SETTINGS_PROCESS_NOTE =
  "Gelesen wird die Umgebung dieses Prozesses. Der Realtime-Server läuft als eigener Prozess; startet er mit einer anderen Umgebung, gelten dort seine Werte.";

/** Warum hier keine Betriebszahlen stehen. Eine leere Zahl wäre eine Behauptung. */
export const REALTIME_FIGURES_NOTE =
  "Offene Verbindungen und Abonnements zählt der Realtime-Prozess. Diese Seite fragt ihn nicht und zeigt darum keine Betriebszahlen.";

/** Was eine ungültige Variable bedeutet: nicht einen Vorgabewert, sondern einen Server, der nicht startet. */
export const REALTIME_INVALID_NOTE =
  "Ein ungültiger Wert ist kein Rückfall auf die Vorgabe: Mit ihm startet der Realtime-Server gar nicht.";

/**
 * Der Satz der Rechteseite. Es gibt Kanalrechte — aber keine, die sich
 * anlegen liessen. Das ist etwas anderes als "noch nicht gebaut", und die
 * Seite sagt genau das.
 */
export const REALTIME_POLICIES_HONESTY =
  "Es gibt keine Kanalrechte, die sich in der Console anlegen liessen. Wer welchen Kanal lesen und schreiben darf, entscheidet eine feste Regel im Code aus Rolle und Kanalpräfix.";

export const REALTIME_POLICIES_SOURCE_NOTE =
  "Die Tabelle ist aus PrefixRealtimeAuthorization abgeleitet und wird gegen diesen Code geprüft. Ändern lässt sie sich nur im Code, nicht hier und nicht in der Datenbank.";

export const REALTIME_POLICIES_RLS_NOTE =
  "Auf changes-Kanälen entscheidet zusätzlich die Row Level Security der Projekttabelle. Jede geänderte Zeile wird je Abonnent mit dessen Claims gelesen; was RLS nicht herausgibt, kommt nicht an.";

export const REALTIME_POLICIES_DELETE_NOTE =
  "Nach einem DELETE ist die Zeile weg, und RLS kann nicht mehr beantworten, wer sie hätte sehen dürfen. Darum erfährt nur service_role davon, und auch nur den Schlüssel.";

export const REALTIME_POLICIES_SCOPE_NOTE =
  "Vor jeder Regel steht die Organisation: Ein Principal einer anderen Organisation wird abgewiesen, bevor irgendein Präfix geprüft wird.";

/* --------------------------------------------------------------- Rechte */

export const REALTIME_ROLES = ["anon", "authenticated", "service_role"] as const;
export type RealtimeRoleId = (typeof REALTIME_ROLES)[number];

export type RealtimeRoleText = { label: string; explains: string };

/** Woher die Rolle kommt: aus der Art des Projekt-Keys und aus dem Access Token, sonst nirgendwoher. */
export const REALTIME_ROLE_TEXTS: Record<RealtimeRoleId, RealtimeRoleText> = {
  anon: {
    label: "anon",
    explains: "Ein Public Key ohne Access Token. Mehr weiss der Server über diese Verbindung nicht.",
  },
  authenticated: {
    label: "authenticated",
    explains: "Ein Public Key plus ein gültiges Access Token der Projekt-Anmeldung. Das Subjekt ist die Benutzer-ID aus diesem Token.",
  },
  service_role: {
    label: "service_role",
    explains: "Ein Service Key. Er gehört auf einen Server und nie in einen Browser.",
  },
};

export const REALTIME_CHANNEL_KINDS = ["public", "private", "user", "changes"] as const;
export type RealtimeChannelKindId = (typeof REALTIME_CHANNEL_KINDS)[number];

export type RealtimeChannelKindText = { pattern: string; explains: string };

export const REALTIME_CHANNEL_KIND_TEXTS: Record<RealtimeChannelKindId, RealtimeChannelKindText> = {
  public: {
    pattern: "public:…",
    explains: "Der einzige Kanal, den eine Verbindung ohne Anmeldung lesen darf.",
  },
  private: {
    pattern: "private:…",
    explains: "Für angemeldete Verbindungen desselben Projekts. Eine feinere Regel als die Rolle gibt es nicht.",
  },
  user: {
    pattern: "user:<subjekt>:…",
    explains: "Nur für die Verbindung, deren Subjekt genau im zweiten Teil des Namens steht.",
  },
  changes: {
    pattern: "changes:<schema>.<tabelle>",
    explains: "Erzeugt ausschliesslich der Server. Niemand darf dort senden, sonst liesse sich eine Änderung vortäuschen, die nie stattgefunden hat.",
  },
};

export const REALTIME_ACTIONS = ["subscribe", "broadcast", "presence"] as const;
export type RealtimeActionId = (typeof REALTIME_ACTIONS)[number];

export const REALTIME_ACTION_LABELS: Record<RealtimeActionId, string> = {
  subscribe: "abonnieren",
  broadcast: "senden",
  presence: "Presence",
};

/**
 * Die Regel, wie sie `PrefixRealtimeAuthorization` entscheidet — nicht wie
 * sie gedacht war. Der Vertrag prueft jede der 36 Zellen gegen den Code.
 */
export const REALTIME_PERMISSIONS: Record<
  RealtimeChannelKindId,
  Record<RealtimeRoleId, Record<RealtimeActionId, boolean>>
> = {
  public: {
    anon: { subscribe: true, broadcast: false, presence: false },
    authenticated: { subscribe: true, broadcast: true, presence: true },
    service_role: { subscribe: true, broadcast: true, presence: false },
  },
  private: {
    anon: { subscribe: false, broadcast: false, presence: false },
    authenticated: { subscribe: true, broadcast: true, presence: true },
    service_role: { subscribe: true, broadcast: true, presence: false },
  },
  user: {
    anon: { subscribe: false, broadcast: false, presence: false },
    authenticated: { subscribe: true, broadcast: true, presence: true },
    service_role: { subscribe: true, broadcast: true, presence: false },
  },
  changes: {
    anon: { subscribe: false, broadcast: false, presence: false },
    authenticated: { subscribe: true, broadcast: false, presence: false },
    service_role: { subscribe: true, broadcast: false, presence: false },
  },
};

/**
 * Die Fussnote einer Zelle, wo die Regel mehr sagt als ja oder nein. Ohne
 * sie stuende bei `user:` ein Ja, das fuer fremde Subjekte nicht gilt.
 */
export const REALTIME_PERMISSION_NOTES: Partial<Record<RealtimeChannelKindId, Partial<Record<RealtimeRoleId, string>>>> = {
  user: {
    authenticated: "Nur, wenn das Subjekt im Kanalnamen dem Subjekt des Access Tokens entspricht.",
    service_role: "Ein Service Key darf jeden user-Kanal des Projekts lesen und beschreiben.",
  },
};

export const REALTIME_PERMISSION_YES = "ja";
export const REALTIME_PERMISSION_NO = "nein";


/* ------------------------------------------- Tabellen und ihre Änderungen */

/**
 * Woran es wirklich hängt, ob Änderungen einer Tabelle als Realtime-Nachricht
 * ankommen (2.144).
 *
 * Nicht an einer Publikation und nicht an einem Replikationsslot:
 * `db/project/0003` erfasst über einen Trigger, der
 * `qkern_internal.capture_change()` ausführt und den Primärschlüssel der Zeile
 * in `qkern_internal.change_feed` legt. Sitzt auf einer Tabelle kein solcher
 * Trigger, bleibt ihr Kanal leer, und das ist keine Störung.
 *
 * Darum stehen diese beiden Namen hier als Konstante: Die Ansicht entscheidet
 * den Zustand einer Tabelle an ihnen, und der Vertrag hält sie gegen die
 * Migration. Ein Tippfehler wäre sonst eine Liste, in der nichts erfasst
 * aussieht.
 */
export const REALTIME_CAPTURE_SCHEMA = "qkern_internal";
export const REALTIME_CAPTURE_FUNCTION = "capture_change";

export const REALTIME_CAPTURE_STATES = ["arrives", "paused", "off"] as const;
export type RealtimeCaptureStateId = (typeof REALTIME_CAPTURE_STATES)[number];

export type RealtimeCaptureStateText = { label: string; explains: string; tone: "secure" | "risk medium" | "muted" };

export const REALTIME_CAPTURE_STATE_TEXTS: Record<RealtimeCaptureStateId, RealtimeCaptureStateText> = {
  arrives: {
    label: "kommt an",
    explains: "Ein Trigger auf dieser Tabelle legt jede Änderung in den Change Feed. Ein Abonnement auf ihren Kanal bekommt sie.",
    tone: "secure",
  },
  paused: {
    label: "Trigger feuert nicht",
    explains: "Der Trigger sitzt auf der Tabelle, ist aber abgeschaltet oder nur für eine Replik gesetzt. Solange das so bleibt, kommt von hier nichts an.",
    tone: "risk medium",
  },
  off: {
    label: "kommt nicht an",
    explains: "Auf dieser Tabelle sitzt kein Trigger für den Change Feed. Änderungen daran erreichen keinen Kanal.",
    tone: "muted",
  },
};

/** Die Teilmenge eines Triggers aus `/schema/triggers`, an der der Zustand hängt. */
export type RealtimeCaptureTrigger = {
  table: string;
  orientation: "row" | "statement";
  enabled: "origin" | "always" | "replica" | "disabled";
  functionSchema: string;
  functionName: string;
};

/**
 * Der Zustand einer Tabelle, aus den gelesenen Triggern und sonst nichts.
 *
 * `replica` zählt als "feuert nicht": So ein Trigger läuft nur, wenn die
 * Sitzung `session_replication_role = replica` fährt, und das tut die Data API
 * nicht. Ihn als ankommend zu zeigen wäre im Alltag falsch.
 *
 * `statement` zählt gar nicht: `capture_change` liest `NEW` und `OLD` und
 * braucht deshalb einen Trigger je Zeile.
 */
export function realtimeCaptureState(
  triggers: readonly RealtimeCaptureTrigger[],
  table: string,
): RealtimeCaptureStateId {
  const capturing = triggers.filter((trigger) => trigger.table === table
    && trigger.functionSchema === REALTIME_CAPTURE_SCHEMA
    && trigger.functionName === REALTIME_CAPTURE_FUNCTION
    && trigger.orientation === "row");
  if (capturing.length === 0) return "off";
  return capturing.some((trigger) => trigger.enabled === "origin" || trigger.enabled === "always")
    ? "arrives"
    : "paused";
}

/**
 * Der Kanalname einer Tabelle. Dieselbe Form wie `changeChannel` im
 * Realtime-Dienst; der Vertrag hält die beiden gegeneinander, damit die Console
 * keinen Namen zeigt, den der Server nicht beliefert.
 */
export function realtimeChangesChannel(schema: string, table: string): string {
  return `changes:${schema}.${table}`;
}

/**
 * Die Adresse, unter der der Realtime-Server ein Projekt annimmt. Dieselbe
 * Zeichenkette benutzt der Inspector zum Verbinden und das Beispiel zum Zeigen.
 * Zwei Stellen, die sie getrennt bauen, laufen irgendwann auseinander, und das
 * Beispiel wäre dann eine Adresse, die niemand geprüft hat.
 */
export function realtimeSocketTarget(url: string, projectId: string, environment: string): string {
  return `${url.replace(/\/+$/, "")}/realtime/v1/projects/${projectId}/environments/${environment}`;
}

/**
 * Wie eine Anwendung die Änderungen einer Tabelle abonniert.
 *
 * Bewusst rohe `WebSocket`: `@qkern/sdk` hat keinen Realtime-Client. Dort
 * stehen `createQkernClient` und `select`, `insert`, `update`, `delete`, und
 * sonst nichts. Ein Beispiel mit einer erfundenen Kanalmethode auf dem Client
 * wäre Code, der nicht läuft.
 *
 * Der `accessToken` steht nicht zur Zierde darin: Ein Public Key allein ergibt
 * die Rolle `anon`, und `anon` darf einen `changes:`-Kanal nicht abonnieren.
 */
export function realtimeChangesExample(input: {
  url: string;
  projectId: string;
  environment: string;
  schema: string;
  table: string;
  protocol: string;
}): string {
  const target = realtimeSocketTarget(input.url, input.projectId, input.environment);
  const channel = realtimeChangesChannel(input.schema, input.table);
  return [
    "const socket = new WebSocket(",
    `  "${target}",`,
    `  "${input.protocol}",`,
    ");",
    "",
    'socket.addEventListener("open", () => {',
    "  socket.send(JSON.stringify({",
    '    type: "auth", requestId: "auth-1",',
    '    projectKey: "qk_public_...",',
    "    accessToken,",
    "  }));",
    "});",
    "",
    'socket.addEventListener("message", (message) => {',
    "  const event = JSON.parse(message.data);",
    '  if (event.type === "ready") {',
    "    socket.send(JSON.stringify({",
    '      type: "subscribe", requestId: "sub-1",',
    `      channel: "${channel}",`,
    "    }));",
    "  }",
    '  if (event.type === "change") {',
    "    console.log(event.operation, event.record, event.cursor);",
    "  }",
    "});",
  ].join("\n");
}

/** Der Satz über der Liste. Er sagt, woran der Zustand hängt und wie man ihn heute ändert. */
export const REALTIME_TABLES_HONESTY =
  "Ob Änderungen einer Tabelle ankommen, hängt an einem Trigger auf qkern_internal.capture_change. Diese Seite liest, wo einer sitzt, und setzt keinen: Dafür gibt es keine Route, sondern eine Migration über ein Change Set.";

export const REALTIME_TABLES_SOURCE_NOTE =
  "Gelesen wird über /schema und /schema/triggers, beide nur lesend. Der Zustand je Tabelle steht so in der Projektdatenbank und ist nicht geraten.";

export const REALTIME_TABLES_GLOBAL_NOTE =
  "Ein Trigger allein genügt nicht. Steht unter Einstellungen Postgres Changes auf nein, bleibt jeder Änderungskanal leer, auch der einer erfassten Tabelle.";

export const REALTIME_TABLES_KEY_NOTE =
  "Die Erfassung braucht einen Primärschlüssel. Fehlt er, lässt der Trigger das Schreiben in die Tabelle mit einem Fehler scheitern, statt die Änderung stumm zu verlieren.";

export const REALTIME_TABLES_VIEW_NOTE =
  "Sichten stehen nicht in der Liste. Ein Trigger je Zeile sitzt nur auf einer Tabelle, also kann auch nur eine Tabelle erfassen.";

export const REALTIME_TABLES_ROLE_NOTE =
  "Zum Abonnieren braucht die Verbindung ein Access Token. Mit einem Public Key allein bleibt sie anon, und anon darf keinen Änderungskanal lesen. Von einer Löschung erfährt nur service_role, und auch nur den Schlüssel.";

export const REALTIME_TABLES_EMPTY =
  "Im Schema public steht keine Tabelle. Eine Tabelle entsteht über ein Change Set, und erst danach kann sie Änderungen melden.";

export const REALTIME_TABLES_SDK_NOTE =
  "Das Paket @qkern/sdk hat keinen Realtime-Client, nur createQkernClient für die Daten-API. Das Beispiel spricht darum das Protokoll qkern.realtime.v1 direkt über die WebSocket-API, so wie der Inspector oben.";

/* ------------------------------------------------------------- Begriffe */

/**
 * Die Anweisung, die eine Tabelle an den Change Feed haengt (2.154).
 *
 * **Warum als Change Set und nicht als Knopf mit Wirkung.** Es gibt keine
 * Route, die einen Trigger setzt, und das ist kein Versehen: Ein Trigger ist
 * eine Schemaaenderung, und Schemaaenderungen laufen bei QKERN durch den Weg,
 * den es dafuer gibt, mit Risiko, Freigabe und Protokoll. Diese Funktion baut
 * genau die Anweisung, die der Weg braucht; angewendet wird sie erst nach einer
 * Freigabe, wie jede andere auch.
 *
 * **Warum die Form woertlich aus dem Zertifizierungslauf stammt.** Derselbe
 * Trigger steht im Fall, der den Change Feed gegen echtes PostgreSQL belegt:
 * `AFTER INSERT OR UPDATE OR DELETE`, `FOR EACH ROW`, und als Funktion
 * `qkern_internal.capture_change()`. Eine selbst erfundene Variante koennte
 * davon abweichen, und dann liefe sie durch, ohne zu erfassen.
 *
 * Der Name ist `<tabelle>_capture`, ebenfalls wie dort.
 */
export function realtimeCaptureStatement(table: string): string {
  return `CREATE TRIGGER ${table}_capture
  AFTER INSERT OR UPDATE OR DELETE ON public.${table}
  FOR EACH ROW EXECUTE FUNCTION ${REALTIME_CAPTURE_SCHEMA}.${REALTIME_CAPTURE_FUNCTION}()`;
}

/** Der Titel des Change Sets, damit er in der Freigabe sagt, worum es geht. */
export function realtimeCaptureTitle(table: string): string {
  return `Realtime für public.${table} einschalten`;
}

export const REALTIME_CAPTURE_PREPARED =
  "Der Change Set ist vorbereitet. Angewendet wird er erst nach einer Freigabe, und erst danach melden Änderungen dieser Tabelle etwas.";
export const REALTIME_CAPTURE_REFUSED =
  "Der Change Set konnte nicht vorbereitet werden.";
export const REALTIME_CAPTURE_INVITE =
  "Einschalten heisst hier: QKERN bereitet eine Schemaänderung vor, die den Trigger setzt. Sie läuft durch dieselbe Freigabe wie jede andere Änderung an der Datenbank, und bis dahin ändert sich nichts.";

export const REALTIME_TERMS = ["changeFeed", "publication", "presence", "cursor"] as const;
export type RealtimeTermId = (typeof REALTIME_TERMS)[number];

export type RealtimeTermText = { term: string; explains: string };

/**
 * Vier Wörter, über die jeder stolpert, der von PostgreSQL nichts weiss. Zwei
 * davon erklären, was QKERN tut, eines erklärt, was QKERN ausdrücklich nicht
 * tut, und das vierte ist die Marke, an der ein Abonnement wieder aufsetzt.
 */
export const REALTIME_TERM_TEXTS: Record<RealtimeTermId, RealtimeTermText> = {
  changeFeed: {
    term: "Change Feed",
    explains: "Eine Tabelle in der Projektdatenbank. Ein Trigger legt dort je Änderung den Schlüssel der Zeile ab, und der Realtime-Server holt sie von dort. Die Zeilenwerte liest er danach einzeln mit den Rechten des Abonnenten.",
  },
  publication: {
    term: "Publikation",
    explains: "Der Weg von PostgreSQL, Änderungen über logische Replikation abzugeben. Realtime nimmt ihn nicht, weil er eine Rolle mit Replikationsrecht und einen Slot verlangt. Publikationen gehören zur Replikation und stehen in der vollständigen Ansicht unter Datenbank.",
  },
  presence: {
    term: "Presence",
    explains: "Eine kurze Notiz darüber, wer gerade auf einem Kanal ist. Sie gilt nur, solange die Verbindung sie erneuert, und sie ist kein Speicher.",
  },
  cursor: {
    term: "Cursor",
    explains: "Eine Marke für die Stelle, bis zu der eine Anwendung schon gelesen hat. Beim Abonnieren mitgegeben, holt sie das Versäumte nach. Liegt zu viel dazwischen, gilt sie als veraltet, und die Anwendung lädt ihren Zustand über die Daten-API neu.",
  },
};
/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function realtimeTexts(): string[] {
  return [
    REALTIME_CAPTURE_PREPARED,
    REALTIME_CAPTURE_REFUSED,
    REALTIME_CAPTURE_INVITE,
    ...Object.values(REALTIME_GROUP_LABELS),
    ...Object.values(REALTIME_UNIT_LABELS),
    ...Object.values(REALTIME_ORIGIN_TEXTS).flatMap((origin) => [origin.label, origin.explains]),
    ...Object.values(REALTIME_LIMIT_TEXTS).flatMap((limit) => [limit.label, limit.explains]),
    ...Object.values(REALTIME_ROLE_TEXTS).flatMap((role) => [role.label, role.explains]),
    ...Object.values(REALTIME_CHANNEL_KIND_TEXTS).map((kind) => kind.explains),
    ...Object.values(REALTIME_ACTION_LABELS),
    ...Object.values(REALTIME_PERMISSION_NOTES).flatMap((byRole) => Object.values(byRole ?? {})),
    REALTIME_PERMISSION_YES,
    REALTIME_PERMISSION_NO,
    REALTIME_SETTINGS_HONESTY,
    REALTIME_SETTINGS_PROCESS_NOTE,
    REALTIME_FIGURES_NOTE,
    REALTIME_INVALID_NOTE,
    REALTIME_POLICIES_HONESTY,
    REALTIME_POLICIES_SOURCE_NOTE,
    REALTIME_POLICIES_RLS_NOTE,
    REALTIME_POLICIES_DELETE_NOTE,
    REALTIME_POLICIES_SCOPE_NOTE,
    ...Object.values(REALTIME_CAPTURE_STATE_TEXTS).flatMap((state) => [state.label, state.explains]),
    ...Object.values(REALTIME_TERM_TEXTS).flatMap((term) => [term.term, term.explains]),
    REALTIME_TABLES_HONESTY,
    REALTIME_TABLES_SOURCE_NOTE,
    REALTIME_TABLES_GLOBAL_NOTE,
    REALTIME_TABLES_KEY_NOTE,
    REALTIME_TABLES_VIEW_NOTE,
    REALTIME_TABLES_ROLE_NOTE,
    REALTIME_TABLES_EMPTY,
    REALTIME_TABLES_SDK_NOTE,
  ];
}
