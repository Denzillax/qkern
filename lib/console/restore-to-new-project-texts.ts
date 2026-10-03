import type { PointInTimeRecoveryOverview } from "@/lib/server/backup/point-in-time";

/**
 * Die Texte und die eine Ableitung der Seite „In neues Projekt
 * wiederherstellen" (2.87).
 *
 * Gleiche Bauart wie `point-in-time-texts` (2.53) und `missing-log-texts`
 * (2.84): Der Schluessel ist der deutsche Text, die Console uebersetzt ihn
 * ueber ihren Katalog, und der Vertrag `console-i18n-contract` liest diese
 * Tabellen mit und verlangt fuer jeden Text en, fr und it. Ein eigenes Modul
 * braucht es, weil die Ansicht `t(variable)` aufruft: Der Text haengt an
 * einem Kuerzel, und ein Text hinter einer Variablen faellt durch die Suche
 * nach `t("...")`.
 *
 * Das Modul ist rein: keine Datenbank, kein React, kein `fetch`.
 *
 * Warum die Seite nichts Eigenes liest: QKERN fuehrt ueber seine Backups
 * nichts in der Kontrollebene. Keine Migration legt eine Tabelle fuer
 * Sicherungslaeufe, Sicherungspunkte oder Groessen an. Die einzigen echten
 * Zahlen stammen aus der signierten Evidenz des letzten Restore-Drills, und
 * die holt schon die Route `/database/backups/point-in-time`. Eine zweite
 * Route daneben haette dieselbe Datei noch einmal gelesen und nichts
 * hinzugefuegt. Die Seite fragt dieselbe Route und stellt eine andere Frage
 * an dieselbe Antwort.
 */

/** Die eine Frage, die diese Seite beantwortet. */
export const RESTORE_QUESTION = "Kann aus einem Backup ein neues Projekt werden?";

export const RESTORE_ANSWER =
  "Nein, und es scheitert nicht am Backup. Den Wiederherstellungslauf gibt es, und er ist zertifiziert. Was fehlt, ist das neue Projekt: Niemand legt die frische Datenbank an, es entsteht keine zweite Umgebung, die sie tragen könnte, und die Bindung einer bestehenden Umgebung lässt sich nicht umlenken.";

export const RESTORE_HONESTY =
  "QKERN führt keinen Katalog seiner Backups. Keine Tabelle der Kontrollebene hält einen Sicherungslauf, einen Sicherungspunkt oder eine Grösse. Jede Zahl auf dieser Seite stammt aus der signierten Evidenz des letzten Restore-Drills und sonst nirgendwoher.";

export const RESTORE_SAME_EVIDENCE =
  "Dieselbe Evidenz liegt der Seite Point-in-time Recovery zugrunde. Hier steht sie nicht noch einmal als Stand der Wiederherstellung, sondern als Antwort auf die Frage, wie weit ein neues Projekt damit käme.";

/** Was die Kontrollebene ueber ihre Backups weiss, und was sie nicht weiss. */
export const RESTORE_KNOWLEDGE_ITEMS = [
  "no_catalogue",
  "no_sizes",
  "encrypted_is_a_condition",
  "scope_is_control_plane",
  "archive_is_declared",
] as const;
export type RestoreKnowledgeItem = (typeof RESTORE_KNOWLEDGE_ITEMS)[number];

export const RESTORE_KNOWLEDGE_TEXTS: Record<RestoreKnowledgeItem, { label: string; explains: string }> = {
  no_catalogue: {
    label: "Ein Katalog, den diese Seite nicht liest",
    explains: "Migration 0083 hält die Backups einer Projektdatenbank in der Kontrollebene. Diese Seite liest ihn nicht: sie liest die Route unter point-in-time, und die kennt nur die Erklärung des Betreibers und die Evidenz des Drills. Ein Zeitpunkt eines letzten Backups steht deshalb hier weiterhin nicht.",
  },
  no_sizes: {
    label: "Keine Grössen",
    explains: "Die Evidenz trägt einen SHA-256 über das Sicherungsartefakt, aber keine Bytezahl. Die Route gibt auch den Hash nicht heraus. Eine Grösse eines Backups steht deshalb nirgends, und geschätzt wird sie nicht.",
  },
  encrypted_is_a_condition: {
    label: "Verschlüsselung ist eine Bedingung des Verifiers",
    explains: "Der Verifier nimmt nur Evidenz an, in der encrypted, checksumVerified, schemaVerified, rowCountsVerified und auditChainVerified alle wahr sind und das Ergebnis passed lautet. Evidenz, die etwas anderes behauptet, gilt als nicht vorhanden. Ein Backup ohne Verschlüsselung zählt hier also gar nicht.",
  },
  scope_is_control_plane: {
    label: "Geltungsbereich ist die Kontrollebene",
    explains: "Die Evidenz kennt genau einen Bereich, control_plane. Der Drill stellt die Datenbank der Kontrollebene wieder her, nicht die Datenbank, in der Ihre Tabellen liegen. Über die Projektdatenbank dieser Umgebung sagt er nichts.",
  },
  archive_is_declared: {
    label: "Der Stand des Archivs ist erklärt, nicht gemessen",
    explains: "QKERN liest kein WAL-Archiv. Ob eines existiert und wie weit es zurückreicht, ist eine Angabe des Betreibers. Was daraus für ein Wiederherstellungsfenster folgt, steht auf der Seite Point-in-time Recovery.",
  },
};

/**
 * Die vier Glieder der Kette „Backup → neues Projekt". Drei davon fehlen
 * oder sind gesperrt; welches davon, sagt der Text, und der Vertrag prueft
 * es am Quelltext nach.
 */
export const RESTORE_CHAIN_STEPS = ["restore_run", "fresh_database", "new_environment", "binding"] as const;
export type RestoreChainStep = (typeof RESTORE_CHAIN_STEPS)[number];

export type RestoreChainState = "certified" | "unproven" | "once_only" | "missing";

export const RESTORE_CHAIN_STATE_TEXTS: Record<RestoreChainState, { label: string; tone: "secure" | "muted" | "risk medium" | "risk high" }> = {
  certified: { label: "zertifiziert", tone: "secure" },
  unproven: { label: "gebaut, gerade nicht belegt", tone: "muted" },
  once_only: { label: "genau einmal erlaubt", tone: "risk medium" },
  missing: { label: "fehlt", tone: "risk high" },
};

export type RestoreChainTexts = {
  title: string;
  /** Wer diesen Schritt tun muesste. */
  component: string;
  finding: string;
};

export const RESTORE_CHAIN_TEXTS: Record<RestoreChainStep, RestoreChainTexts> = {
  restore_run: {
    title: "Der Wiederherstellungslauf",
    component: "Der Drill in tests/backup-restore-drill.integration.test.ts, gefahren von npm run test:backup:docker.",
    finding: "Er läuft gegen ein echtes PostgreSQL 17 mit TLS-Pflicht, zieht ein verschlüsseltes Basisbackup über die Replikationsverbindung, stellt daraus und aus dem WAL-Archiv auf einen gewählten Zeitpunkt wieder her und belegt danach Schema, Zeilen, Audit-Kette und Datenmanifest. Die Evidenz wird signiert und vom Verifier des Produkts gelesen. Dieses Glied ist das einzige, das steht.",
  },
  fresh_database: {
    title: "Eine frische Datenbank anlegen",
    component: "Der externe Broker hinter dem signierten Client SignedProjectProvisioningBrokerAdapter.",
    finding: "Den Client gibt es, den Dienst nicht. QKERN legt selbst keine Datenbank an: Migration 0020 erzeugt die Rolle qkern_provisioner mit NOCREATEDB und NOCREATEROLE, und im ganzen Quelltext steht kein CREATE DATABASE. Ohne erreichbaren Broker endet ein Provisionierungsauftrag mit PROVIDER_UNAVAILABLE. Genau hier bricht die Kette.",
  },
  new_environment: {
    title: "Eine Umgebung, die sie tragen könnte",
    component: "Die Kontrollebene, die heute keine zweite Umgebung anlegt.",
    finding: "Es gibt zwei Stellen im Quelltext, die eine Umgebung einfügt: die Registrierung einer Organisation und, seit 2.147, das Anlegen eines Projekts über POST auf die Route über Projekte. Beide schreiben eine wartende Marke, und beide gelten nur für ein neues Projekt. Ein bestehendes Projekt bekommt auf keinem Weg eine zusätzliche Umgebung, und die Route über Umgebungen kennt weiterhin nur GET. Eine zweite Umgebung, die eine wiederhergestellte Datenbank aufnehmen könnte, entsteht darum nirgends.",
  },
  binding: {
    title: "Die Umgebung auf sie zeigen lassen",
    component: "Der Provisionierer, begrenzt durch einen Trigger der Datenbank.",
    finding: "Eine wartende Marke darf der Provisionierer genau einmal durch eine Referenz ersetzen. Danach weist der Trigger project_environments_database_ref_immutable jede Änderung ab, mit dem Satz a provisioned project database reference is immutable. Der Trigger ist genau dafür da: Ein bereits freigegebener Change Set soll nicht stillschweigend auf eine andere Datenbank gelenkt werden. Für eine Wiederherstellung heisst es, dass ein zweiter Server nicht an die Stelle eines laufenden treten kann.",
  },
};

/** Was heute wirklich geht, und was dabei ausdruecklich nicht gemeint ist. */
export const RESTORE_TODAY_ITEMS = ["local_shortcut", "manual_restore", "not_a_path"] as const;
export type RestoreTodayItem = (typeof RESTORE_TODAY_ITEMS)[number];

export const RESTORE_TODAY_TEXTS: Record<RestoreTodayItem, string> = {
  local_shortcut: "Lokal, und nur lokal: npm run dev:bind-project-database bindet eine von Hand angelegte Datenbank an eine wartende Umgebung. Das Skript weigert sich gegen production, verlangt einen lokalen Host und schreibt weder einen Provisionierungsauftrag noch eine Zeile in project_database_bindings. Es ist eine Abkürzung für die Entwicklung und kein Betriebsweg.",
  manual_restore: "Der Wiederherstellungslauf gehört an die Hand eines Menschen am Server; die Schritte dazu stehen auf der Seite Point-in-time Recovery. Was dabei entsteht, ist ein zweiter, beförderter PostgreSQL-Server. Ein Projekt in QKERN wird daraus nicht.",
  not_a_path: "Eine neue Umgebung provisionieren zu lassen und den Wiederherstellungslauf von Hand darauf zeigen zu lassen, ist heute kein gangbarer Weg. Beide Hälften fehlen: der Dienst, der die Datenbank anlegt, und die Umgebung, die sie aufnehmen könnte. Diese Seite behauptet darum auch keinen Notbehelf.",
};

/**
 * Der Zustand des ersten Glieds haengt an der Evidenz, die anderen drei
 * haengen am Quelltext und sind darum fest. Die Ableitung ist die einzige
 * Rechnung dieses Moduls.
 */
export function restoreChain(
  overview: Pick<PointInTimeRecoveryOverview, "lastDrill">,
): ReadonlyArray<{ step: RestoreChainStep; state: RestoreChainState }> {
  return [
    { step: "restore_run", state: overview.lastDrill ? "certified" : "unproven" },
    { step: "fresh_database", state: "missing" },
    { step: "new_environment", state: "missing" },
    { step: "binding", state: "once_only" },
  ];
}

/** Alle Texte, die über `t(variable)` laufen, für den Übersetzungsvertrag. */
export function restoreToNewProjectTexts(): string[] {
  return [
    RESTORE_QUESTION,
    RESTORE_ANSWER,
    RESTORE_HONESTY,
    RESTORE_SAME_EVIDENCE,
    ...RESTORE_KNOWLEDGE_ITEMS.flatMap((key) => [
      RESTORE_KNOWLEDGE_TEXTS[key].label,
      RESTORE_KNOWLEDGE_TEXTS[key].explains,
    ]),
    ...Object.values(RESTORE_CHAIN_STATE_TEXTS).map((entry) => entry.label),
    ...RESTORE_CHAIN_STEPS.flatMap((key) => [
      RESTORE_CHAIN_TEXTS[key].title,
      RESTORE_CHAIN_TEXTS[key].component,
      RESTORE_CHAIN_TEXTS[key].finding,
    ]),
    ...RESTORE_TODAY_ITEMS.map((key) => RESTORE_TODAY_TEXTS[key]),
  ];
}
