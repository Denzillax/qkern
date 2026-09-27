/**
 * Die Texte und die Ableitungen der Seite Infrastruktur (2.67), deutsch und
 * an einer Stelle.
 *
 * Gleiche Bauart wie `database-settings-texts` (2.53): Der Schluessel ist der
 * deutsche Text, die Console uebersetzt ihn ueber ihren Katalog, und der
 * Vertrag `console-i18n-contract` liest diese Tabellen mit und verlangt fuer
 * jeden Text en, fr und it. Ein eigenes Modul braucht es, weil die Ansicht
 * `t(variable)` aufruft: Ein Zustandsname kommt aus einer Ableitung, und ein
 * Text hinter einer Variablen faellt durch die Suche nach `t("...")`.
 *
 * Das Modul ist rein: keine Datenbank, kein React, kein `fetch`.
 *
 * Hier steht kein Wert aus einer Projektdatenbank und keine Adresse. Die
 * Woerter sind die festen Begriffe von PostgreSQL und der Kontrollebene, in
 * Prosa uebersetzt.
 */

export type InfrastructureNote = {
  title: string;
  body: string;
};

/** Der Zustand eines Projekts, wie `projects.status` ihn fuehrt. */
export type ProjectStatusId = "ready" | "provisioning" | "degraded";

export type ProjectStatusText = {
  label: string;
  explains: string;
  /** Dieselben Klassen wie die Berater. */
  tone: "secure" | "muted" | "risk medium" | "risk high";
};

export const PROJECT_STATUS_TEXTS: Record<ProjectStatusId, ProjectStatusText> = {
  ready: {
    label: "bereit",
    explains: "Die Kontrollebene hat dieses Projekt als bereit eingetragen. Das sagt nichts darüber, ob eine einzelne Umgebung gerade antwortet.",
    tone: "secure",
  },
  provisioning: {
    label: "wird eingerichtet",
    explains: "Für dieses Projekt läuft die Einrichtung noch. Eine Umgebung ohne gebundene Datenbank ist in diesem Zustand normal.",
    tone: "muted",
  },
  degraded: {
    label: "beeinträchtigt",
    explains: "Die Kontrollebene hat dieses Projekt als beeinträchtigt eingetragen. Der Grund steht nicht in der Projektzeile und ist hier deshalb nicht zu lesen.",
    tone: "risk medium",
  },
};

/** Wo die Verbindung dieser Umgebung gerade liest. */
export type RecoveryStateId = "primary" | "standby";

export const RECOVERY_STATE_TEXTS: Record<RecoveryStateId, ProjectStatusText> = {
  primary: {
    label: "schreibfähiger Server",
    explains: "pg_is_in_recovery() meldet false. Diese Verbindung liest den Server, auf dem auch geschrieben wird.",
    tone: "secure",
  },
  standby: {
    label: "Standby",
    explains: "pg_is_in_recovery() meldet true. Diese Verbindung liest einen Server, der einem anderen folgt und selbst nicht schreibt.",
    tone: "muted",
  },
};

/** Ob die Referenz einer Umgebung schon die Form einer Bindung hat. */
export type BindingStateId = "bound" | "pending";

export const BINDING_STATE_TEXTS: Record<BindingStateId, ProjectStatusText> = {
  bound: {
    label: "gebunden",
    explains: "Die Referenz hat die Form, die der Katalog der Verbindungen annimmt. Ob dahinter eine erreichbare Datenbank steht, sagt diese Zeile nicht.",
    tone: "secure",
  },
  pending: {
    label: "wartet",
    explains: "Die Umgebung trägt eine wartende Marke statt einer Referenz. Bis der Provisionierer sie ersetzt, zeigt sie auf keine Datenbank.",
    tone: "muted",
  },
};

export function projectStatus(status: string): ProjectStatusId {
  return status === "ready" || status === "provisioning" || status === "degraded" ? status : "provisioning";
}

export function bindingState(bound: boolean): BindingStateId {
  return bound ? "bound" : "pending";
}

export function recoveryState(inRecovery: boolean): RecoveryStateId {
  return inRecovery ? "standby" : "primary";
}

export const REGION_SOURCE_NOTE =
  "Die Region ist der Text, der beim Anlegen in die Projektzeile geschrieben wurde. QKERN prüft ihn gegen keinen Standort, wählt danach keine Hardware und kann ihn hier nicht ändern.";

export const RUNTIME_SOURCE_NOTE =
  "Version, Kodierung und Sortierung fragt QKERN bei jedem Aufruf die Projektdatenbank selbst (server_version, server_encoding, pg_database). Nichts davon ist hinterlegt.";

export const SIZE_SOURCE_NOTE =
  "Die Grösse ist pg_database_size für diese eine Datenbank, gemessen im Moment des Aufrufs. Sie enthält keine WAL-Dateien und keine Backups.";

export const ENVIRONMENTS_SOURCE_NOTE =
  "Die Umgebungen stehen in project_environments. Die Referenz ist die Kennung, unter der eine Umgebung im Katalog der Verbindungen nachschlägt: kein Host, kein Port, kein Passwort.";

export const EXTENSIONS_SOURCE_NOTE =
  "Gezählt und gezeigt werden nur die Erweiterungen, die in dieser Datenbank wirklich installiert sind. Die volle Liste des Servers steht unter Datenbank → Erweiterungen.";

export const SCOPE_NOTE =
  "Diese Seite beantwortet, worauf diese Umgebung läuft. Wie die Datenbank eingestellt ist, also Rollen, TLS und Verbindungsgrenzen, steht unter Datenbank → Einstellungen.";

/**
 * Was es hier nicht gibt, jeweils mit Grund. Kein Eintrag beschreibt eine
 * Oberflaeche, die es nicht gibt; jeder sagt, warum QKERN die Angabe nicht
 * machen kann.
 */
export const MISSING_INFRASTRUCTURE: readonly InfrastructureNote[] = [
  {
    title: "Keine Lese-Replikate",
    body: "QKERN richtet keine Lese-Replikate ein und führt keine Liste davon. Eine solche Liste stünde in pg_stat_replication des Primärservers und setzt ein Recht voraus, das die Leserolle eines Projekts nicht hat und nicht bekommen soll. Was hier steht, ist nur, ob diese eine Verbindung gerade ein Standby liest.",
  },
  {
    title: "Keine Grösse der Instanz, keine Grösse der Platte",
    body: "Wie viel CPU, Arbeitsspeicher und Plattenplatz dem Server zur Verfügung stehen, weiss QKERN nicht. Die Provisionierung übergibt eine Datenbankreferenz, keine Ausstattung.",
  },
  {
    title: "Kein Wechsel der Region",
    body: "Die Region steht in der Projektzeile und wird beim Anlegen gesetzt. Es gibt keinen Weg, sie von hier aus zu ändern, und es gäbe auch nichts, was umzöge.",
  },
  {
    title: "Keine Adresse der Datenbank",
    body: "Host, Port und Verbindungszeichenfolge stehen im Katalog der Verbindungen, verlassen ihn nie und sind hier nicht ausgelassen, sondern nie gelesen worden.",
  },
  {
    title: "Kein Aufwärtsweg auf eine neue Postgres-Version",
    body: "Die Version ist eine Auskunft, kein Schalter. Ein Versionssprung ist eine Migration des Servers und gehört an die Hand eines Menschen, der ihn vor sich hat.",
  },
];

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function infrastructureTexts(): string[] {
  return [
    ...Object.values(PROJECT_STATUS_TEXTS).flatMap((entry) => [entry.label, entry.explains]),
    ...Object.values(RECOVERY_STATE_TEXTS).flatMap((entry) => [entry.label, entry.explains]),
    ...Object.values(BINDING_STATE_TEXTS).flatMap((entry) => [entry.label, entry.explains]),
    ...MISSING_INFRASTRUCTURE.flatMap((entry) => [entry.title, entry.body]),
    REGION_SOURCE_NOTE,
    RUNTIME_SOURCE_NOTE,
    SIZE_SOURCE_NOTE,
    ENVIRONMENTS_SOURCE_NOTE,
    EXTENSIONS_SOURCE_NOTE,
    SCOPE_NOTE,
  ];
}
