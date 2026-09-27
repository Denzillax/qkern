/**
 * Die Texte der Seite Integrationen -> Wrappers (2.72), deutsch und an einer
 * Stelle.
 *
 * Gleiche Bauart wie `infrastructure-texts` (2.68): Der Schluessel ist der
 * deutsche Text, die Console uebersetzt ihn ueber ihren Katalog, und der
 * Vertrag `console-i18n-contract` liest diese Tabellen mit und verlangt fuer
 * jeden Text en, fr und it. Ein eigenes Modul braucht es, weil die Ansicht
 * `t(variable)` aufruft: Der Zustand eines Wrappers kommt aus einer Ableitung,
 * und ein Text hinter einer Variablen faellt durch die Suche nach `t("...")`.
 *
 * Das Modul ist rein: keine Datenbank, kein React, kein `fetch`.
 *
 * Hier steht kein Wert aus einer Projektdatenbank. Die Woerter sind die festen
 * Begriffe von PostgreSQL, in Prosa uebersetzt.
 */

export type WrapperNote = {
  title: string;
  body: string;
};

/** Ob ein Wrapper eine Funktion hat, die seine Optionen prueft. */
export type ValidatorStateId = "checked" | "unchecked";

export type WrapperStateText = {
  label: string;
  explains: string;
  /** Dieselben Klassen wie die Berater. */
  tone: "secure" | "muted" | "risk medium" | "risk high";
};

export const VALIDATOR_STATE_TEXTS: Record<ValidatorStateId, WrapperStateText> = {
  checked: {
    label: "prüft seine Optionen",
    explains: "Dieser Wrapper bringt eine Validator-Funktion mit. PostgreSQL ruft sie beim Anlegen eines Servers und einer Zuordnung auf und weist unbekannte Optionen zurück.",
    tone: "secure",
  },
  unchecked: {
    label: "prüft seine Optionen nicht",
    explains: "Dieser Wrapper hat keine Validator-Funktion. Ein Server darunter nimmt jede Option an, die jemand hinschreibt, auch eine mit einem Geheimnis darin.",
    tone: "risk medium",
  },
};

export function validatorState(validator: string | null): ValidatorStateId {
  return validator === null ? "unchecked" : "checked";
}

export const SCOPE_NOTE =
  "Diese Seite liest den Katalog dieser einen Projektdatenbank: welche Foreign Data Wrapper installiert sind, welche Fremdserver darauf stehen, wer ihnen zugeordnet ist und welche Fremdtabellen darüber gelesen werden. Sie spricht kein fremdes System an und misst nichts.";

export const OPTION_POLICY_NOTE =
  "Von den Optionen eines Fremdservers zeigt QKERN nur die, die beschreiben, wohin verbunden wird und wie gelesen wird. Jede andere Option steht mit ihrem Namen da, ihr Wert bleibt zurückgehalten. Die Liste des Erlaubten steht im Code und nicht in dieser Ansicht, damit sie auch für die MCP-Brücke gilt.";

export const OPTION_EXPOSURE_NOTE =
  "srvoptions ist für jede Rolle lesbar, die den Katalog lesen darf. Wer ein Passwort in eine Serveroption schreibt, legt es damit im Katalog offen, und keine Oberfläche kann das rückgängig machen. Zugangsdaten gehören in eine Benutzerzuordnung.";

export const USER_MAPPING_NOTE =
  "Eine Benutzerzuordnung sagt, als wer QKERN beim fremden System auftritt. Ihre Optionen tragen den Kontonamen und das Passwort dort. QKERN wählt die Spalte umoptions nicht aus, weder für die Anzeige noch für eine Zählung.";

export const WRAPPER_SOURCE_NOTE =
  "Die Wrapper kommen aus pg_foreign_data_wrapper. Handler und Validator sind die beiden Funktionen, die eine Erweiterung mitbringt; die Optionen des Wrappers selbst liest QKERN nicht.";

export const SERVER_SOURCE_NOTE =
  "Die Fremdserver kommen aus pg_foreign_server. Typ und Version sind zwei freie Textfelder, die beim Anlegen gesetzt werden können und die PostgreSQL nicht auswertet. Meist sind sie leer.";

export const FOREIGN_TABLE_SOURCE_NOTE =
  "Die Fremdtabellen kommen aus pg_foreign_table, verbunden mit pg_class. Wie die Tabelle im fremden System heisst, steht in ftoptions und wird hier nicht gelesen.";

export const READ_ONLY_NOTE =
  "Diese Seite legt nichts an, ändert nichts und löscht nichts. Es gibt dafür keine Route.";

/**
 * Was ein Mensch mit Superuser-Rechten tut, wenn er einen Wrapper braucht.
 * Vier Schritte, in der Reihenfolge, in der PostgreSQL sie verlangt.
 */
export const CREATE_STEPS: readonly WrapperNote[] = [
  {
    title: "1. Erweiterung installieren",
    body: "CREATE EXTENSION postgres_fdw; Ein Wrapper ist Code im Server und keine Einstellung. Welche Erweiterungen dieser Server überhaupt anbietet, steht unter Datenbank → Erweiterungen.",
  },
  {
    title: "2. Fremdserver anlegen",
    body: "CREATE SERVER … FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host …, port …, dbname …); Hier steht, wohin verbunden wird, und nichts darüber, als wer. Ein Geheimnis gehört nicht in diese Zeile.",
  },
  {
    title: "3. Benutzerzuordnung anlegen",
    body: "CREATE USER MAPPING FOR … SERVER … OPTIONS (user …, password …); Diesen Befehl führt ein Mensch an der Datenbank aus, nicht QKERN. Das Passwort ist das des fremden Systems.",
  },
  {
    title: "4. Fremdtabelle anlegen",
    body: "IMPORT FOREIGN SCHEMA … oder CREATE FOREIGN TABLE …; Erst danach ist die fremde Quelle eine Tabelle, die eine Abfrage benutzen kann.",
  },
];

/**
 * Was es hier nicht gibt, jeweils mit Grund. Kein Eintrag beschreibt eine
 * Oberflaeche, die es nicht gibt; jeder sagt, warum QKERN sie nicht anbietet.
 */
export const MISSING_WRAPPER_SURFACE: readonly WrapperNote[] = [
  {
    title: "Kein Anlegen aus der Console",
    body: "CREATE FOREIGN DATA WRAPPER verlangt Superuser-Rechte, und die Leserolle eines Projekts hat sie nicht und soll sie nicht bekommen. Ein Knopf hier müsste eine Verbindung mit anderen Rechten öffnen, und das wäre ein eigener Schnitt mit eigener Prüfung.",
  },
  {
    title: "Kein Eingabefeld für Zugangsdaten",
    body: "Ein Formular für eine Benutzerzuordnung nähme ein fremdes Passwort entgegen und trüge es durch den Browser, die Route und das Protokoll. QKERN hat dafür heute keinen Weg, der die Zusagen des Vault einhält.",
  },
  {
    title: "Kein Blick in das fremde System",
    body: "Ob der Server drüben erreichbar ist, ob das Konto gilt und welche Tabellen es dort gibt, sagt diese Seite nicht. Sie liest den Katalog hier und öffnet keine Verbindung nach draussen.",
  },
  {
    title: "Keine Optionen der Benutzerzuordnungen",
    body: "Sie stehen in umoptions und tragen die Zugangsdaten zum fremden System. PostgreSQL sperrt die Spalte für nicht privilegierte Rollen ohnehin; QKERN verlässt sich darauf nicht und liest sie gar nicht erst.",
  },
];

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function wrappersTexts(): string[] {
  return [
    ...Object.values(VALIDATOR_STATE_TEXTS).flatMap((entry) => [entry.label, entry.explains]),
    ...CREATE_STEPS.flatMap((entry) => [entry.title, entry.body]),
    ...MISSING_WRAPPER_SURFACE.flatMap((entry) => [entry.title, entry.body]),
    SCOPE_NOTE,
    OPTION_POLICY_NOTE,
    OPTION_EXPOSURE_NOTE,
    USER_MAPPING_NOTE,
    WRAPPER_SOURCE_NOTE,
    SERVER_SOURCE_NOTE,
    FOREIGN_TABLE_SOURCE_NOTE,
    READ_ONLY_NOTE,
  ];
}
