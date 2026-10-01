/**
 * Die Texte der Seite Logs -> Realtime (2.86), deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `missing-log-texts` (2.84): Der Schluessel ist der
 * deutsche Text, die Console uebersetzt ihn ueber ihren Katalog, und der
 * Vertrag `console-i18n-contract` liest diese Tabellen mit und verlangt fuer
 * jeden Text en, fr und it. Das eigene Modul braucht es, weil die Ansicht
 * `t(variable)` aufruft: Der Zustand des Feeds und die Rolle eines Absenders
 * kommen aus der Antwort der Route, und ein Text hinter einer Variablen faellt
 * durch die Suche nach `t("...")`.
 *
 * Das Modul ist rein: keine Datenbank, kein React, keine Farbe.
 *
 * Der Platzhalter versprach dreierlei, und nur zwei davon gibt es. Was hier
 * steht, ist nachgeschlagen und nicht geschaetzt:
 *
 * **Verbindungen** fuehrt der Realtime-Prozess in einer Map im eigenen
 * Speicher (`lib/server/realtime/service.ts`). Es gibt dafuer keine Tabelle,
 * keine Route und keinen Verlauf. Das ist ein Satz auf der Seite und keine
 * Kachel.
 *
 * **Kanaele und Nachrichten** stehen seit Migration 0030 dauerhaft in
 * `realtime_channel_sequences` und `realtime_events`, je Broadcast eine Zeile.
 *
 * **Der Rueckstand** des Aenderungs-Feeds ist die Zahl, auf die es im Betrieb
 * ankommt: `qkern_internal.change_feed` in der Projektdatenbank gegen die
 * Position in `project_database_webhook_cursors` der Kontrollebene.
 */

/* ------------------------------------------------------------------ Seite */

export const REALTIME_LOG_TEXTS = {
  kicker: "LOGS",
  title: "Realtime: zwei von drei Versprechen lassen sich halten",
  /** Der Satz, der die Seite eroeffnet. Er nennt die Luecke zuerst. */
  scope:
    "Diese Seite hat „Verbindungen, Kanäle und Nachrichten über die Zeit“ versprochen. Kanäle und Nachrichten gibt es wirklich, dauerhaft und je Zeile nachzählbar. Verbindungen gibt es nicht, und sie fehlen nicht bloss noch: Sie werden nirgends aufgeschrieben. Dazu kommt eine Zahl, die der Platzhalter nicht versprochen hat und die im Betrieb mehr zählt als alle drei, nämlich der Rückstand des Änderungs-Feeds.",

  /* --- Verbindungen: der Satz statt der Kachel --- */
  connectionsTitle: "Verbindungen schreibt niemand auf",
  connectionsNoRecord:
    "Der Realtime-Prozess kennt seine offenen Verbindungen genau: Er führt sie in einer Map im eigenen Speicher, mit Abonnements je Verbindung. Nur verlässt diese Map den Prozess nie. Es gibt keine Tabelle, in der eine Verbindung stünde, keine Route, die danach fragt, und nach einem Neustart ist die Zahl weg. Die Presence eines Abonnenten liegt inzwischen in einer eigenen Tabelle und überlebt den Neustart; die Verbindung, an der sie hängt, überlebt ihn nicht.",
  connectionsWhyNot:
    "Die Console und der Realtime-Server sind zwei Prozesse. Eine Leseroute der Console könnte die Zahl nur bekommen, indem sie den anderen Prozess über das Netz fragt. Das wäre eine Wirkung nach aussen und keine Lesung, und QKERN hat dafür heute keinen Weg. Die Route zu den Realtime-Grenzen sagt denselben Satz und meldet aus demselben Grund keine Betriebszahlen.",
  connectionsNoHistory:
    "Ein Verlauf wäre auch mit dieser Zahl noch nicht da. Niemand schreibt eine Zeile, wenn eine Verbindung aufgeht oder zugeht; es gibt kein Ereignis dafür und keine Aufbewahrung. Wie viele Verbindungen vor einer Stunde offen waren, weiss niemand, und diese Seite schätzt es nicht.",
  connectionsWhatInstead:
    "Was es stattdessen gibt: Die Grenzen des Transports stehen unter Realtime → Einstellungen, und wer eine einzelne Verbindung von Hand sehen will, öffnet sie im Realtime-Inspector. Beides ist kein Log und gibt sich auch nicht als eines aus.",

  /* --- Kanaele --- */
  channelsTitle: "Kanäle, so weit der Zähler reicht",
  channelsMeaning:
    "Jeder Kanal, auf dem je ein Broadcast lag, hat eine Zeile in realtime_channel_sequences. Sie trägt den Zähler, aus dem die Sequenz einer Nachricht kommt, und sie überlebt die Aufbewahrung der Nachrichten selbst. Darum steht hier neben den Nachrichten, die noch im Log liegen, auch die Zahl der je vergebenen Sequenzen.",
  channelsRetention:
    "Die Differenz zwischen vergeben und vorhanden ist kein Verlust, sondern die Aufbewahrung bei der Arbeit: Sie entfernt alte Ereignisse, lässt den Zähler aber stehen, damit eine Sequenz nie zweimal vergeben wird. Ein Kanal ohne eine einzige verbliebene Nachricht ist deshalb ein Kanal mit Vergangenheit und kein leerer.",
  channelsLimit:
    "Im Log steht nur, was ein Client als Broadcast geschickt hat. Zugestellte Datenbankänderungen stehen nicht darin: Sie werden je Abonnent einzeln mit dessen Rechten gelesen und nie gemeinsam gespeichert. Presence steht ebenfalls nicht darin. Diese Zahlen sind also kein Mass für den Verkehr auf einem Kanal, sondern für die Broadcasts darauf.",

  /* --- Nachrichten --- */
  messagesTitle: "Die jüngsten Nachrichten",
  messagesMeaning:
    "Je Broadcast eine Zeile, mit Kanal, Sequenz, Ereignisnamen, Rolle des Absenders und Zeitpunkt. Die Reihenfolge ist die der Datenbank, die jüngste zuerst; Kanal und Sequenz entscheiden, wenn zwei Nachrichten denselben Zeitpunkt tragen.",
  messagesNoPayload:
    "Die Nutzlast steht hier nicht, und sie wird auch nicht gelesen. Sie stammt von einem Client des Projekts und kann alles enthalten, was dieser Client geschickt hat. Gefragt wird nur ihre Grösse, und die verrät nichts über ihren Inhalt. Wer eine Nutzlast sehen will, abonniert den Kanal im Inspector und sieht, was ab jetzt kommt.",
  messagesLimit:
    "Diese Liste ist ein Ausschnitt und kein Verlauf. Sie zeigt die jüngsten Zeilen, die das Log noch hält; was die Aufbewahrung entfernt hat, steht in keiner Abfrage mehr. Eine Zeitreihe der Nachrichten führt die Nutzungsmessung, nicht diese Seite.",

  /* --- Rueckstand --- */
  feedTitle: "Der Rückstand des Änderungs-Feeds",
  feedMeaning:
    "Eine Änderung an einer erfassten Tabelle schreibt eine Zeile in qkern_internal.change_feed der Projektdatenbank. Die Zeile bleibt liegen, bis ein Leser sie geholt hat. Der Rückstand ist die Zahl der Zeilen oberhalb der zuletzt gelesenen Position, und er wird in der Datenbank gezählt und nicht aus zwei Positionen gerechnet: Zwischen ihnen können Zeilen fehlen, die schon abgeräumt sind.",
  feedCursorMeaning:
    "Die gelesene Position steht in project_database_webhook_cursors der Kontrollebene, je Umgebung eine Zeile. Sie wird nur vorwärts geschrieben, und zwar in der Datenbank: Zwei Compute-Prozesse dürfen dieselbe Änderung doppelt einreihen, aber keiner darf den anderen zurückdrehen.",
  feedCursorLimit:
    "Diese Position gehört der Webhook-Brücke und nicht dem Realtime-Transport. Realtime liest denselben Feed, führt seine Position aber je Instanz im Prozess: Sie überlebt keinen Neustart und steht in keiner Tabelle. Ein Rückstand für Realtime lässt sich deshalb nicht angeben, und diese Seite gibt keinen an.",
  feedCaptureMeaning:
    "Erfasst wird nur, wo ein Trigger auf qkern_internal.capture_change sitzt. Steht dort keiner, bleibt der Feed leer, und das ist keine Störung, sondern eine Einrichtung, die aussteht. Die Zahl der erfassenden Tabellen steht deshalb neben dem Rückstand.",
  feedNoRowValues:
    "Der Feed hält ausschliesslich Primärschlüsselwerte, und diese Seite liest auch die nicht. Die eigentlichen Zeilenwerte werden je Abonnent frisch mit dessen Claims gelesen; lägen sie im Feed, bräuchte es eine zweite Sichtbarkeitsprüfung ausserhalb der Datenbank.",

  /* --- Abgrenzung zur Berichte-Seite --- */
  reportsTitle: "Was die Berichte-Seite beantwortet und diese nicht",
  reportsMeaning:
    "Berichte → Realtime liest die Metrik realtime_messages: je dauerhaft gespeicherter Broadcast eine Einheit, gebündelt geschrieben, abfragbar in Stundenschritten über 48 Stunden oder in Tagesschritten über 90 Tage. Das ist die Frage nach der Menge über die Zeit, und sie ist dort beantwortet.",
  reportsDifference:
    "Diese Seite beantwortet die andere Frage: welche Kanäle es gibt, wie viel auf jedem liegt, wann dort zuletzt etwas ankam und mit welcher Rolle. Die Nutzungsreihe gruppiert nur nach Metrik und kennt keinen Kanal; sie könnte das nicht sagen. Umgekehrt hält das Log keine abgeschlossenen Stunden vor und taugt nicht für eine Kurve.",

  /* --- Betreiber --- */
  operatorTitle: "Wenn Sie mehr brauchen",
  operatorSteps:
    "Eine wachsende Zahl beim Rückstand heisst, dass niemand liest oder dass der Leser nicht nachkommt. Die Kopplungen und der Stand der Brücke stehen unter Integrationen → Datenbank-Webhooks. Wächst der Rückstand, ohne dass eine Kopplung eingerichtet ist, räumt nur die Aufbewahrung den Feed ab.",
  operatorDrain:
    "Ein Log-Drain kann den Realtime-Log nicht nach draussen tragen. Seine Quellen sind das Auth-Protokoll, die Function-Aufrufe, die Inhaltslogs der Functions, die Speicherobjekte, die Webhook-Zustellungen und die Nutzungsreihe; realtime_events ist keine davon. Die Nutzungsreihe trägt die Metrik realtime_messages allerdings mit.",
} as const;

/* ------------------------------------------------------- Spalten und Rollen */

/** Die Spalten der Kanalliste, jede mit ihrem Gegenstueck im Backend. */
export const REALTIME_CHANNEL_COLUMNS = [
  { label: "Kanal", meaning: "Der Name, unter dem abonniert und gesendet wird. Er kommt aus realtime_channel_sequences." },
  { label: "Im Log", meaning: "Nachrichten, die jetzt noch in realtime_events liegen." },
  { label: "Je vergeben", meaning: "Sequenzen, die der Zähler dieses Kanals je ausgegeben hat." },
  { label: "Zuletzt", meaning: "Der Zeitpunkt der jüngsten Nachricht, die noch im Log liegt." },
] as const;

/** Die Spalten der Nachrichtenliste. */
export const REALTIME_MESSAGE_COLUMNS = [
  { label: "Zeitpunkt", meaning: "created_at der Zeile, also wann die Nachricht dauerhaft wurde." },
  { label: "Kanal und Sequenz", meaning: "Beide zusammen benennen eine Nachricht innerhalb einer Umgebung eindeutig." },
  { label: "Ereignis", meaning: "Der Name, den der Absender gewählt hat. Kleinbuchstaben, höchstens 64 Zeichen." },
  { label: "Rolle", meaning: "Mit welcher Rolle der Absender angemeldet war, als die Nachricht angenommen wurde." },
  { label: "Nutzlast", meaning: "Die Grösse in Bytes. Der Inhalt wird nicht gelesen." },
] as const;

export type RealtimeActorRoleId = "anon" | "authenticated" | "service_role";

export const REALTIME_ROLE_LABELS: Record<RealtimeActorRoleId, string> = {
  anon: "anonym",
  authenticated: "angemeldet",
  service_role: "Service-Rolle",
};

/* ----------------------------------------------------------------- Zustaende */

/** Zustandstexte, die die Ansicht ueber `t(variable)` zeigt. */
export const REALTIME_LOG_STATES = {
  loading: "Realtime-Seite wird geladen…",
  unavailable: "Diese Lesung ist gerade nicht erreichbar. Das ist kein Befund über Ihre Umgebung, sondern über diese Abfrage.",
  noChannels: "Auf keinem Kanal dieser Umgebung lag je ein Broadcast. Das heisst nicht, dass niemand abonniert hat: Ein Abonnement allein legt keine Zeile an.",
  noMessages: "Im Log liegt gerade keine Nachricht. Entweder wurde noch keine gesendet, oder die Aufbewahrung hat die vorhandenen bereits entfernt.",
  cursorNever: "Die Brücke hat den Feed dieser Umgebung noch nie gelesen. Das ist keine Position null, sondern gar keine Position.",
  feedAbsent: "In dieser Projektdatenbank ist der Änderungs-Feed nicht angelegt. Ohne qkern_internal.change_feed wird keine Änderung erfasst, und ein Rückstand kann gar nicht entstehen.",
  feedNoCapture: "Der Feed ist angelegt, aber keine Tabelle erfasst ihre Änderungen. Solange kein Trigger auf qkern_internal.capture_change sitzt, bleibt der Feed leer.",
  feedDisabled: "Die Data Plane ist für diese Umgebung abgeschaltet. Ohne sie gibt es keine Projektdatenbank, die über ihren Änderungs-Feed berichten könnte.",
  feedNotReady: "Für diese Umgebung ist noch keine Projektdatenbank gebunden. Einen Feed kann es deshalb noch nicht geben.",
  feedUnavailable: "Die Projektdatenbank antwortet gerade nicht. Der Rückstand steht deshalb hier nicht, und geschätzt wird er nicht. Die Kanäle daneben kommen aus der Kontrollebene und sind davon nicht betroffen.",
  channelsTruncated: "Es gibt mehr Kanäle als hier stehen; die Liste wurde an ihrer Grenze abgeschnitten.",
  messagesTruncated: "Es gibt mehr Nachrichten als hier stehen; gezeigt sind die jüngsten.",
} as const;

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function realtimeLogTexts(): string[] {
  return [
    ...Object.values(REALTIME_LOG_TEXTS),
    ...REALTIME_CHANNEL_COLUMNS.flatMap((entry) => [entry.label, entry.meaning]),
    ...REALTIME_MESSAGE_COLUMNS.flatMap((entry) => [entry.label, entry.meaning]),
    ...Object.values(REALTIME_ROLE_LABELS),
    ...Object.values(REALTIME_LOG_STATES),
  ];
}
