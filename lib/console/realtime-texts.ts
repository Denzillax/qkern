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

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function realtimeTexts(): string[] {
  return [
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
  ];
}
