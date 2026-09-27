/**
 * Die Texte der Seite Datenbank -> Replikation (2.74), deutsch und an einer
 * Stelle.
 *
 * Gleiche Bauart wie `wrappers-texts` (2.72): Der Schluessel ist der deutsche
 * Text, die Console uebersetzt ihn ueber ihren Katalog, und der Vertrag
 * `console-i18n-contract` liest diese Tabellen mit und verlangt fuer jeden Text
 * en, fr und it. Ein eigenes Modul braucht es, weil die Ansicht `t(variable)`
 * aufruft: Der Zustand eines Slots kommt aus einer Ableitung, und ein Text
 * hinter einer Variablen faellt durch die Suche nach `t("...")`.
 *
 * Das Modul ist rein: keine Datenbank, kein React, kein `fetch`. Hier steht
 * kein Wert aus einer Projektdatenbank, nur die festen Begriffe von PostgreSQL
 * in Prosa.
 */

export type ReplicationNote = {
  title: string;
  body: string;
};

export type ReplicationStateText = {
  label: string;
  explains: string;
  /** Dieselben Klassen wie die Berater. */
  tone: "secure" | "muted" | "risk medium" | "risk high";
};

/**
 * Der Zustand eines Slots, abgeleitet aus `wal_status` und `active`.
 *
 * Die Reihenfolge der Ableitung ist die des Schadens und nicht die der Spalten:
 * Ein verlorener Slot ist ein anderer Fall als ein verlassener, und ein Slot
 * ohne Position haelt trotz fehlendem Konsumenten nichts fest.
 */
export type SlotStateId = "lost" | "unpositioned" | "unreserved" | "abandoned" | "extended" | "attached";

export const SLOT_STATE_TEXTS: Record<SlotStateId, ReplicationStateText> = {
  lost: {
    label: "verloren",
    explains: "PostgreSQL hat WAL entfernt, das dieser Slot noch braucht. Ein Konsument kann hier nicht mehr fortsetzen; das Abonnement drüben muss neu aufgesetzt werden. Der Server hält für diesen Slot nichts mehr fest.",
    tone: "risk high",
  },
  unpositioned: {
    label: "ohne Position",
    explains: "Dieser Slot hat noch keine Position im WAL reserviert und hält darum nichts fest. Das ist der Zustand direkt nach dem Anlegen, solange niemand daran gelesen hat.",
    tone: "muted",
  },
  unreserved: {
    label: "Rückstand über der Grenze",
    explains: "Der Slot hält mehr WAL fest, als max_slot_wal_keep_size erlaubt. Beim nächsten Checkpoint kann PostgreSQL das benötigte WAL entfernen, und dann ist der Slot verloren.",
    tone: "risk high",
  },
  abandoned: {
    label: "verlassen",
    explains: "An diesem Slot hängt kein Konsument, und er hält trotzdem WAL fest. Genau so füllt ein vergessener Slot die Platte: Der Rückstand wächst mit jeder Änderung weiter, und PostgreSQL gibt das WAL erst frei, wenn jemand liest oder der Slot fällt.",
    tone: "risk high",
  },
  extended: {
    label: "Rückstand über max_wal_size",
    explains: "Ein Konsument hängt daran, kommt aber nicht nach: Der Slot hält mehr WAL fest, als der Server ohne ihn behalten würde. Noch ist nichts verloren, der Abstand sollte aber wieder kleiner werden.",
    tone: "risk medium",
  },
  attached: {
    label: "in Betrieb",
    explains: "Ein Konsument hängt an diesem Slot, und der festgehaltene Rückstand liegt im Rahmen, den der Server ohnehin vorhält.",
    tone: "secure",
  },
};

export function slotState(input: {
  active: boolean;
  walStatus: "reserved" | "extended" | "unreserved" | "lost" | null;
}): SlotStateId {
  if (input.walStatus === "lost") return "lost";
  // Ohne Position haelt der Slot nichts fest, auch ohne Konsumenten. Diese
  // Pruefung steht vor der auf `active`, sonst hiesse ein frisch angelegter
  // Slot „verlassen" und die Seite warnte vor etwas, das nichts kostet.
  if (input.walStatus === null) return "unpositioned";
  if (input.walStatus === "unreserved") return "unreserved";
  if (!input.active) return "abandoned";
  if (input.walStatus === "extended") return "extended";
  return "attached";
}

/** Was `wal_level` fuer diese Datenbank bedeutet. */
export type WalLevelId = "minimal" | "replica" | "logical";

export const WAL_LEVEL_TEXTS: Record<WalLevelId, ReplicationStateText> = {
  minimal: {
    label: "keine Replikation möglich",
    explains: "Das WAL trägt nur, was für eine Wiederherstellung nach einem Absturz nötig ist. Weder ein Standby noch ein Abonnement kann von diesem Server lesen.",
    tone: "risk medium",
  },
  replica: {
    label: "nur physische Replikation",
    explains: "Das WAL reicht für ein Standby und für eine Wiederherstellung auf einen Zeitpunkt. Für logische Replikation reicht es nicht: Ein logischer Slot lässt sich damit nicht anlegen.",
    tone: "muted",
  },
  logical: {
    label: "logische Replikation möglich",
    explains: "Das WAL trägt genug für logische Dekodierung. Publikationen und Abonnements sind damit möglich, und das WAL wird pro Änderung etwas größer.",
    tone: "muted",
  },
};

export const SCOPE_NOTE =
  "Diese Seite liest, was PostgreSQL über die Replikation dieser einen Projektdatenbank hergibt: die Publikationen, die Abonnements, die Replikations-Slots mit ihrem Rückstand und die beiden Einstellungen, ohne die der Rest nichts bedeutet. Sie öffnet keine Verbindung nach draussen und misst nichts an einem fremden Server.";

export const LAG_NOTE =
  "Der Rückstand eines Slots ist die Zahl, auf die es im Betrieb ankommt. Ein Slot merkt sich, bis wohin ein Konsument gelesen hat, und PostgreSQL hält dafür jedes WAL-Segment ab dieser Stelle fest. Liest niemand mehr, wächst der Rückstand mit jeder Änderung weiter, bis die Platte voll ist. Das ist kein Fehler des Servers, so arbeitet ein Slot.";

export const SAFE_SIZE_NOTE =
  "Die Restfrist kommt aus safe_wal_size: so viel WAL darf noch geschrieben werden, bevor dieser Slot ungültig wird. Steht dort keine Zahl, ist das keine Entwarnung, sondern max_slot_wal_keep_size = -1: Es gibt keine Grenze, bei der PostgreSQL den Slot fallen lässt, statt weiter WAL zu halten.";

export const SLOT_SOURCE_NOTE =
  "Die Slots kommen aus pg_replication_slots. Der Rückstand wird in der Datenbank gerechnet, als Abstand zwischen der Schreibposition des Servers und der Position des Slots. Die Position selbst steht hier nicht: Eine LSN ist eine Stelle im WAL und keine Angabe, die eine Oberfläche erklären kann.";

export const SUBSCRIPTION_SOURCE_NOTE =
  "Die Abonnements kommen aus pg_subscription, und zwar nur die dieser Datenbank. Die Spalte subconninfo wird nicht ausgewählt: Dort steht die Verbindungszeichenfolge zum Herausgeber, und in ihr steht im Regelfall ein Passwort. PostgreSQL entzieht public das Recht auf diese eine Spalte; QKERN verlässt sich darauf nicht und fragt sie gar nicht.";

export const PUBLICATION_SOURCE_NOTE =
  "Die Publikationen kommen aus pg_publication, aus derselben Lesung wie die Seite Datenbank → Publikationen. Eine Publikation sagt nur, welche Tabellen Änderungen anbieten würden. Ob jemand sie liest, steht nicht dort, sondern an einem Slot.";

export const REALTIME_NOTE =
  "QKERN richtet auf dieser Seite selbst nichts ein. Der Änderungs-Feed von Realtime läuft über einen Trigger und die Tabelle qkern_internal.change_feed, nicht über logische Replikation: Jede Rolle eines Projekts wird ausdrücklich ohne Replikationsrecht angelegt, und ein hängender Konsument an einem Slot wäre genau das Betriebsrisiko, das der Absatz darüber beschreibt. Jede Publikation und jeder Slot auf dieser Seite ist darum von einem Menschen oder einem anderen Werkzeug angelegt worden.";

export const RECOVERY_NOTE =
  "Ob dieser Server eine Wiederherstellung fährt, sagt pg_is_in_recovery(). True heisst: Diese Verbindung liest ein Standby. Eine Liste der Standbys gibt es hier nicht; sie stünde in pg_stat_replication des Primärservers und setzt ein Recht voraus, das die Leserolle eines Projekts nicht hat und nicht bekommen soll.";

export const READ_ONLY_NOTE =
  "Diese Seite legt nichts an, ändert nichts und löscht nichts. Es gibt dafür keine Route.";

/**
 * Was ein Mensch an der Datenbank tut, wenn Daten nach draussen sollen. Die
 * Reihenfolge ist die, die PostgreSQL verlangt, und der letzte Schritt ist der,
 * den diese Seite nicht anbietet.
 */
export const CREATE_STEPS: readonly ReplicationNote[] = [
  {
    title: "1. wal_level auf logical stellen",
    body: "ALTER SYSTEM SET wal_level = 'logical'; und ein Neustart des Servers. Ohne diesen Schritt gibt es keine logische Replikation, und ein logischer Slot lässt sich nicht anlegen.",
  },
  {
    title: "2. Publikation anlegen",
    body: "CREATE PUBLICATION … FOR TABLE …; Das läuft wie jede Schemaänderung über ein Change Set: im SQL Editor schreiben, Vorschau, Freigabe. Eine Publikation kostet nichts und hält nichts fest.",
  },
  {
    title: "3. Abonnement drüben anlegen",
    body: "CREATE SUBSCRIPTION … CONNECTION … PUBLICATION …; Diesen Befehl führt ein Mensch am Ziel aus, nicht QKERN. In der Verbindungszeichenfolge steht ein Passwort für diese Datenbank hier.",
  },
  {
    title: "4. Den Rückstand im Auge behalten",
    body: "Ab hier hält ein Slot WAL fest. Diese Seite zeigt den Rückstand; wer das Abonnement abschaltet oder wegwirft, muss den Slot mit pg_drop_replication_slot ebenfalls wegwerfen.",
  },
];

/**
 * Was es hier nicht gibt, jeweils mit Grund. Kein Eintrag beschreibt eine
 * Oberflaeche, die es nicht gibt; jeder sagt, warum QKERN sie nicht anbietet.
 */
export const MISSING_REPLICATION_SURFACE: readonly ReplicationNote[] = [
  {
    title: "Kein Einrichten eines Abonnements",
    body: "Ein Abonnement braucht eine Verbindung nach draussen und ein Geheimnis, das durch Browser, Route und Protokoll ginge. Dafür hat QKERN heute keinen Weg, der die Zusagen des Vault einhält. Das ist ein eigener Schnitt.",
  },
  {
    title: "Kein Anlegen und kein Wegwerfen eines Slots",
    body: "Beides verlangt das Replikationsrecht, und jede Rolle eines Projekts wird ausdrücklich ohne dieses Recht angelegt. Ein Knopf hier müsste eine Verbindung mit anderen Rechten öffnen, und das wäre eine eigene Prüfung wert.",
  },
  {
    title: "Kein Blick auf den anderen Server",
    body: "Ob der Herausgeber eines Abonnements erreichbar ist, wie weit er ist und ob das Konto dort noch gilt, sagt diese Seite nicht. Sie liest den Katalog hier.",
  },
  {
    title: "Keine Verbindungsangabe eines Abonnements",
    body: "Host, Port und Zeichenfolge des Herausgebers stehen in subconninfo, zusammen mit dem Passwort. Die Spalte wird nicht gelesen, auch nicht für eine Zählung, und darum kann aus ihr auch nichts durchsickern.",
  },
  {
    title: "Kein Verzug in Sekunden",
    body: "Wie alt die letzte Änderung ist, die drüben angekommen ist, steht in pg_stat_replication oder pg_stat_subscription und setzt ein Recht voraus, das diese Lesung nicht hat. Der Rückstand steht darum in Bytes, so wie der Katalog ihn hergibt, und nicht in Zeit.",
  },
];

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function replicationTexts(): string[] {
  return [
    ...Object.values(SLOT_STATE_TEXTS).flatMap((entry) => [entry.label, entry.explains]),
    ...Object.values(WAL_LEVEL_TEXTS).flatMap((entry) => [entry.label, entry.explains]),
    ...CREATE_STEPS.flatMap((entry) => [entry.title, entry.body]),
    ...MISSING_REPLICATION_SURFACE.flatMap((entry) => [entry.title, entry.body]),
    SCOPE_NOTE,
    LAG_NOTE,
    SAFE_SIZE_NOTE,
    SLOT_SOURCE_NOTE,
    SUBSCRIPTION_SOURCE_NOTE,
    PUBLICATION_SOURCE_NOTE,
    REALTIME_NOTE,
    RECOVERY_NOTE,
    READ_ONLY_NOTE,
  ];
}
