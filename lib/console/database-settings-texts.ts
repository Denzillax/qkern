/**
 * Die Texte und die Ableitungen der Seite Datenbank-Einstellungen (2.53),
 * deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `database-activity-texts` (2.46) und
 * `vault-overview-texts` (2.58): Der Schluessel ist der deutsche Text, die
 * Console uebersetzt ihn ueber ihren Katalog, und der Vertrag
 * `console-i18n-contract` liest diese Tabellen mit und verlangt fuer jeden
 * Text en, fr und it. Das eigene Modul braucht es, weil die Ansicht
 * `t(variable)` aufruft: Der Name eines Rechts kommt aus einer Ableitung, und
 * ein Text hinter einer Variablen faellt durch die Suche nach `t("...")`.
 *
 * Das Modul ist rein: keine Datenbank, kein React, kein `fetch`.
 *
 * Wichtig fuer die Geheimhaltung: Hier steht kein Wert aus der
 * Projektdatenbank, keine Adresse und kein Geheimnis. Die Woerter sind die
 * festen Begriffe des PostgreSQL-Katalogs, in Prosa uebersetzt.
 */

/** Ein Rollenrecht, wie `pg_roles` es meldet. */
export type RoleRightId =
  | "login"
  | "group"
  | "createDatabase"
  | "createRole"
  | "replication"
  | "bypassRowSecurity"
  | "noInherit"
  | "connectionLimit"
  | "validUntil";

export type RoleRightText = {
  label: string;
  explains: string;
  /** Wie die Ansicht das Recht einfaerbt; dieselben Klassen wie die Berater. */
  tone: "secure" | "muted" | "risk medium" | "risk high";
};

export const ROLE_RIGHT_TEXTS: Record<RoleRightId, RoleRightText> = {
  login: {
    label: "darf sich anmelden",
    explains: "Mit dieser Rolle kann sich ein Client verbinden.",
    tone: "muted",
  },
  group: {
    label: "Gruppenrolle",
    explains: "Diese Rolle kann sich nicht verbinden. Sie bündelt Rechte und wird vererbt.",
    tone: "secure",
  },
  createDatabase: {
    label: "darf Datenbanken anlegen",
    explains: "Die Rolle kann neue Datenbanken im selben Cluster erzeugen.",
    tone: "risk medium",
  },
  createRole: {
    label: "darf Rollen anlegen",
    explains: "Die Rolle kann weitere Rollen erzeugen und ihnen Rechte geben.",
    tone: "risk high",
  },
  replication: {
    label: "darf replizieren",
    explains: "Die Rolle kann einen Replikationsstrom öffnen und damit den ganzen Inhalt abziehen.",
    tone: "risk high",
  },
  bypassRowSecurity: {
    label: "umgeht Row Level Security",
    explains: "Für diese Rolle greifen die Policies der Tabellen nicht.",
    tone: "risk high",
  },
  noInherit: {
    label: "erbt nicht automatisch",
    explains: "Rechte aus Mitgliedschaften gelten erst nach einem ausdrücklichen SET ROLE.",
    tone: "muted",
  },
  connectionLimit: {
    label: "begrenzte Verbindungszahl",
    explains: "Für diese Rolle hält der Server eine eigene Obergrenze offener Verbindungen.",
    tone: "muted",
  },
  validUntil: {
    label: "befristetes Passwort",
    explains: "Nach diesem Datum nimmt der Server das Passwort dieser Rolle nicht mehr an.",
    tone: "muted",
  },
};

/** Was `inspectSettings` je Rolle meldet; die Ansicht reicht es unverändert durch. */
export type SettingsRole = {
  name: string;
  superuser: boolean;
  createDatabase: boolean;
  createRole: boolean;
  inherit: boolean;
  login: boolean;
  replication: boolean;
  bypassRowSecurity: boolean;
  connectionLimit: number | null;
  validUntil: string | null;
};

/**
 * Die Rechte einer Rolle in Worten, in fester Reihenfolge.
 *
 * Die erste Angabe ist immer, ob die Rolle sich verbinden darf: Das ist die
 * Frage, die ein Betreiber zuerst stellt. Danach kommt nur, was tatsaechlich
 * gesetzt ist — eine Rolle ohne Sonderrecht bekommt keine Liste von
 * Verneinungen, sondern eine kurze Zeile.
 */
export function roleRights(role: SettingsRole): RoleRightId[] {
  const rights: RoleRightId[] = [role.login ? "login" : "group"];
  if (role.createDatabase) rights.push("createDatabase");
  if (role.createRole) rights.push("createRole");
  if (role.replication) rights.push("replication");
  if (role.bypassRowSecurity) rights.push("bypassRowSecurity");
  if (!role.inherit) rights.push("noInherit");
  if (role.connectionLimit !== null) rights.push("connectionLimit");
  if (role.validUntil !== null) rights.push("validUntil");
  return rights;
}

export type RoleVerdictId = "superuser" | "privileged" | "restricted";

export const ROLE_VERDICT_TEXTS: Record<RoleVerdictId, RoleRightText> = {
  superuser: {
    label: "Superuser",
    explains: "Alle Rechte im ganzen Cluster. In einer Projektdatenbank sollte keine solche Rolle nötig sein.",
    tone: "risk high",
  },
  privileged: {
    label: "erweitert",
    explains: "Die Rolle trägt ein Recht, das über Lesen und Schreiben in den eigenen Tabellen hinausgeht.",
    tone: "risk medium",
  },
  restricted: {
    label: "eingeschränkt",
    explains: "Die Rolle hat kein Sonderrecht; es gelten die Rechte auf den einzelnen Objekten.",
    tone: "secure",
  },
};

/** Das Urteil ueber eine Rolle. Es faellt nach den Flags, nie nach dem Namen. */
export function roleVerdict(role: SettingsRole): RoleVerdictId {
  if (role.superuser) return "superuser";
  if (role.createDatabase || role.createRole || role.replication || role.bypassRowSecurity) return "privileged";
  return "restricted";
}

export type DatabaseTls = { encrypted: boolean; version: string | null; serverEnabled: boolean };

export type TlsStateId = "encrypted" | "plaintextServerReady" | "plaintextServerOff";

export const TLS_STATE_TEXTS: Record<TlsStateId, RoleRightText> = {
  encrypted: {
    label: "verschlüsselt",
    explains: "Die Verbindung, mit der QKERN diese Seite gelesen hat, lief über TLS.",
    tone: "secure",
  },
  plaintextServerReady: {
    label: "unverschlüsselt, Server könnte TLS",
    explains: "Der Server bietet TLS an, diese Verbindung hat es nicht benutzt.",
    tone: "risk high",
  },
  plaintextServerOff: {
    label: "unverschlüsselt, Server ohne TLS",
    explains: "Der Server ist ohne TLS gestartet. Keine Verbindung zu ihm kann verschlüsselt sein.",
    tone: "risk high",
  },
};

/**
 * Der TLS-Zustand als ein Wort. Unterschieden wird zwischen einem Server, der
 * TLS anbietet und hier nicht benutzt wurde, und einem, der es gar nicht
 * kann: Das eine ist eine Fehlkonfiguration der Verbindung, das andere eine
 * des Servers, und ein Betreiber tut dagegen Verschiedenes.
 */
export function tlsState(tls: DatabaseTls): TlsStateId {
  if (tls.encrypted) return "encrypted";
  return tls.serverEnabled ? "plaintextServerReady" : "plaintextServerOff";
}

/**
 * Der Satz ueber dem TLS-Zustand. `SHOW ssl` sagt, ob der Server TLS
 * anbietet, nicht, ob er es verlangt; das steht in `pg_hba.conf`, und die
 * liest QKERN nicht.
 */
export const TLS_SOURCE_NOTE =
  "Gelesen aus pg_stat_ssl für die Verbindung dieser Abfrage und aus der Servereinstellung ssl. Ob der Server TLS erzwingt, steht in pg_hba.conf und wird hier nicht gelesen.";

/** Der Satz ueber den Grenzen. */
export const LIMITS_SOURCE_NOTE =
  "Die Grenzen gelten für den Server, nicht für QKERN. max_connections zählt alle Datenbanken dieses Clusters mit.";

/** Der Satz ueber den Rollen. */
export const ROLES_SOURCE_NOTE =
  "Gezeigt werden die Rollen, die diese Datenbank betreffen, so wie der Katalog sie meldet. Was eine Rolle auf einer einzelnen Tabelle darf, steht unter Datenbank → Spaltenrechte und Policies.";

/**
 * Der wichtigste Satz der Seite. Er steht oben, nicht im Kleingedruckten:
 * Ein Leser, der hier eine Verbindungszeichenfolge sucht, soll in der ersten
 * Zeile erfahren, dass es sie nicht gibt.
 */
export const NO_CONNECTION_DETAILS_NOTE =
  "Diese Seite zeigt keine Verbindungsdaten. Host, Port, Benutzername und Passwort stehen im Katalog der Verbindungen auf dem Server und verlassen ihn nicht.";

export type MissingCapability = { title: string; body: string };

/**
 * Was der Platzhalter versprochen hat und was es davon nicht gibt.
 *
 * Der Platzhalter nannte vier Dinge: Verbindungsdaten, Pooler, SSL-Zwang und
 * Netzwerkbeschraenkungen. Zwei davon gibt es in QKERN ueberhaupt nicht, eins
 * gibt es nur ausserhalb der Console, und eins gibt es bewusst nicht. Das
 * steht so auf der Seite, statt vier leere Kacheln zu zeigen.
 */
export const MISSING_CAPABILITIES: readonly MissingCapability[] = [
  {
    title: "Kein Pooler",
    body: "QKERN hat keinen Verbindungspool vor der Projektdatenbank. Jeder Prozess hält seinen eigenen Pool; es gibt nichts einzustellen und nichts anzuzeigen.",
  },
  {
    title: "Keine Netzwerkbeschränkung",
    body: "Es gibt keine Liste erlaubter Adressen und keine Firewall-Regel, die QKERN verwaltet. Wer sich verbinden darf, entscheidet der Server in pg_hba.conf, ausserhalb dieser Anwendung.",
  },
  {
    title: "Kein Wechsel der Verbindung",
    body: "Die Console kann kein Passwort drehen und keine Verbindung neu binden. Die Bindung einer Umgebung an eine Datenbank ist unveränderlich, sobald sie steht.",
  },
  {
    title: "Kein TLS-Zwang von hier aus",
    body: "Ob TLS verlangt wird, entscheidet der Server. Die Console zeigt den Zustand und kann ihn nicht ändern.",
  },
];

/**
 * Wie eine Umgebung heute an eine Datenbank kommt. Ausdruecklich als
 * Anleitung und nicht als Beschreibung einer Oberflaeche, die es nicht gibt.
 */
export const BINDING_STEPS: readonly MissingCapability[] = [
  {
    title: "In Produktion bindet der Provisionierer",
    body: "Nach dem Bootstrap trägt er die Referenz der Datenbank in die Umgebung ein. Danach ist die Bindung unveränderlich.",
  },
  {
    title: "Lokal bindet ein Skript",
    body: "npm run dev:bind-project-database -- <projekt-uuid> <development|staging> bindet eine wartende Umgebung an die lokale Datenbank. Production bindet es nie.",
  },
  {
    title: "Nachzulesen im Handbuch",
    body: "Der Abschnitt Datenbank-Einstellungen im Handbuch beschreibt beide Wege und sagt, was in der Referenz steht und was nicht.",
  },
];

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function databaseSettingsTexts(): string[] {
  return [
    ...Object.values(ROLE_RIGHT_TEXTS).flatMap((right) => [right.label, right.explains]),
    ...Object.values(ROLE_VERDICT_TEXTS).flatMap((verdict) => [verdict.label, verdict.explains]),
    ...Object.values(TLS_STATE_TEXTS).flatMap((state) => [state.label, state.explains]),
    ...MISSING_CAPABILITIES.flatMap((entry) => [entry.title, entry.body]),
    ...BINDING_STEPS.flatMap((entry) => [entry.title, entry.body]),
    TLS_SOURCE_NOTE,
    LIMITS_SOURCE_NOTE,
    ROLES_SOURCE_NOTE,
    NO_CONNECTION_DETAILS_NOTE,
  ];
}
