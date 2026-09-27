/**
 * Die Texte und die Ableitungen der Seite Branches (2.81), deutsch und an
 * einer Stelle.
 *
 * Gleiche Bauart wie `infrastructure-texts` (2.68): Der Schluessel ist der
 * deutsche Text, die Console uebersetzt ihn ueber ihren Katalog, und der
 * Vertrag `console-i18n-contract` liest diese Tabellen mit und verlangt fuer
 * jeden Text en, fr und it. Ein eigenes Modul braucht es, weil die Ansicht
 * `t(variable)` aufruft: Jeder Zustandsname kommt aus einer Zaehlung, und ein
 * Text hinter einer Variablen faellt durch die Suche nach `t("...")`.
 *
 * Das Modul ist rein: keine Datenbank, kein React, kein `fetch`.
 *
 * Die Seite ersetzt zwei Platzhalter, "Branches" und "Merge-Anfragen", und
 * sagt als Erstes, was QKERN nicht hat. Es gibt keine frei benannten Zweige
 * und keine Abstammung zwischen Umgebungen. Was es gibt, ist der Pruefschritt:
 * ein Change Set traegt eine Aenderung, eine Freigabe prueft sie, ein Worker
 * wendet sie an.
 */

export type BranchFlowNote = {
  title: string;
  body: string;
};

/** Dieselben Klassen wie die Berater und die Infrastrukturseite. */
export type Tone = "secure" | "muted" | "risk medium" | "risk high";

export type StateText = {
  label: string;
  explains: string;
  tone: Tone;
};

export type EnvironmentId = "development" | "staging" | "production";

/**
 * Der erste Absatz der Seite. Er steht vor jeder Zahl, weil die Zahlen ohne
 * ihn falsch gelesen wuerden: Wer "Branches" im Menue anklickt, erwartet eine
 * Liste von Zweigen, und diese Liste gibt es nicht.
 */
export const NO_FREE_BRANCHES =
  "QKERN hat keine frei benannten Zweige. Jedes Projekt hat genau drei Umgebungen, Development, Staging und Production, und diese drei stehen fest. Eine Umgebung ist kein Zweig: Sie entsteht nicht auf Zuruf, sie verschwindet nicht nach dem Zusammenführen, und keine stammt von einer anderen ab.";

/** Warum die Seite trotzdem etwas zu zeigen hat. */
export const REVIEW_EXISTS_NOTE =
  "Den Prüfschritt, den eine Merge-Anfrage leisten soll, gibt es in QKERN wirklich, nur anders gebaut. Was hier steht, sind die echten Zahlen der Kontrollebene: wie viele Änderungen je Umgebung offen, freigegeben, angewandt oder abgelehnt sind, und was von den freigegebenen wirklich angekommen ist.";

/** Wo diese Seite endet und die Infrastruktur beginnt. */
export const SCOPE_NOTE =
  "Diese Seite beantwortet, was unterwegs und was angekommen ist. Worauf eine Umgebung läuft, also Region, Postgres-Version und Grösse, steht unter Einstellungen → Infrastruktur und wird hier nicht wiederholt.";

/**
 * Die drei Umgebungen mit ihrer Rolle. Die Reihenfolge ist die, in der eine
 * Aenderung sie durchlaeuft; sie ist keine Abstammung, und das steht dabei.
 */
export const ENVIRONMENT_TEXTS: Record<EnvironmentId, StateText> = {
  development: {
    label: "Development",
    explains: "Hier entsteht eine Änderung. Ein Change Set dieser Umgebung wird gegen die Entwicklungsdatenbank angewandt und nicht gegen eine andere.",
    tone: "muted",
  },
  staging: {
    label: "Staging",
    explains: "Hier wird eine Änderung ein zweites Mal angewandt, mit denselben Schritten und derselben Freigabe. Sie wird nicht von Development übernommen, sondern als eigenes Change Set eingereicht.",
    tone: "muted",
  },
  production: {
    label: "Production",
    explains: "Hier zählt jede Änderung. Ein Change Set dieser Umgebung wird strenger eingeschätzt, und eine Freigabe ohne Mensch gibt es nur, wenn die Automationsregel des Projekts sie ausdrücklich erlaubt.",
    tone: "secure",
  },
};

/** Ob die Kontrollebene fuer eine der drei festen Umgebungen schon eine Zeile fuehrt. */
export type PresenceId = "present" | "absent";

export const PRESENCE_TEXTS: Record<PresenceId, StateText> = {
  present: {
    label: "eingerichtet",
    explains: "Die Kontrollebene führt für diese Umgebung eine Zeile mit einer Datenbankreferenz.",
    tone: "secure",
  },
  absent: {
    label: "nicht eingerichtet",
    explains: "Die Kontrollebene führt für diese Umgebung noch keine Zeile. Das ist eine unfertige Einrichtung und kein Zweig, der fehlt: Die Umgebung gibt es als Begriff, sie wartet nur auf ihre Datenbank.",
    tone: "muted",
  },
};

/** Die acht Zustaende von `change_sets.status`. */
export type ChangeStatusId =
  | "draft" | "validating" | "ready" | "approved" | "applied" | "rejected" | "failed" | "rolled_back";

export const CHANGE_STATUS_TEXTS: Record<ChangeStatusId, StateText> = {
  draft: { label: "Entwurf", explains: "Angelegt, aber noch nicht zur Prüfung gestellt.", tone: "muted" },
  validating: { label: "wird geprüft", explains: "Die Anweisung wird gerade gegen die Regeln gelesen.", tone: "muted" },
  ready: { label: "wartet", explains: "Geprüft und eingereicht. Solange eine Freigabe offen ist, passiert an der Datenbank nichts.", tone: "risk medium" },
  approved: { label: "freigegeben", explains: "Eine Freigabe liegt vor. Angewandt ist damit noch nichts; das tut der Worker.", tone: "secure" },
  applied: { label: "angewandt", explains: "In der Zieldatenbank ausgeführt, transaktional, mit einem Eintrag im Ledger.", tone: "secure" },
  rejected: { label: "abgelehnt", explains: "Die Freigabe wurde verweigert. Die Anweisung hat die Datenbank nie berührt.", tone: "risk medium" },
  failed: { label: "fehlgeschlagen", explains: "Der Versuch, sie anzuwenden, ist gescheitert. Die Transaktion ist zurückgerollt.", tone: "risk high" },
  rolled_back: { label: "zurückgerollt", explains: "Angewandt und danach wieder zurückgenommen.", tone: "risk medium" },
};

/** Die vier Zustaende von `approval_requests.status`. */
export type ApprovalStatusId = "pending" | "approved" | "rejected" | "expired";

export const APPROVAL_STATUS_TEXTS: Record<ApprovalStatusId, StateText> = {
  pending: { label: "offen", explains: "Wartet auf eine Entscheidung. Eine Freigabe hat eine Frist und läuft ohne Entscheidung ab.", tone: "risk medium" },
  approved: { label: "freigegeben", explains: "Ein Mensch oder die Automationsregel des Projekts hat entschieden. Die Entscheidung hängt am Prüfwert der Anweisung.", tone: "secure" },
  rejected: { label: "abgelehnt", explains: "Entschieden, und zwar dagegen. Die Anweisung bleibt lesbar, wird aber nie ausgeführt.", tone: "risk medium" },
  expired: { label: "abgelaufen", explains: "Die Frist ist verstrichen, ohne dass entschieden wurde. Wer die Änderung noch will, reicht sie neu ein.", tone: "muted" },
};

/** Die fuenf Zustaende von `migration_jobs.status`. */
export type MigrationStatusId = "queued" | "running" | "applied" | "failed" | "review_required";

export const MIGRATION_STATUS_TEXTS: Record<MigrationStatusId, StateText> = {
  queued: { label: "eingereiht", explains: "Freigegeben und in der Warteschlange. Es fehlt nur noch der Worker, der sie sich holt.", tone: "risk medium" },
  running: { label: "läuft", explains: "Ein Worker hält die Lease und arbeitet gerade daran.", tone: "muted" },
  applied: { label: "angekommen", explains: "In der Zieldatenbank ausgeführt und im Ledger eingetragen.", tone: "secure" },
  failed: { label: "fehlgeschlagen", explains: "Alle Versuche sind verbraucht. Die Datenbank steht so da wie vorher.", tone: "risk high" },
  review_required: { label: "braucht eine Entscheidung", explains: "Die Maschine konnte den Ausgang nicht selbst klären und darf nichts mehr ausführen, nur noch nachsehen. Die Liste steht unter Datenbank → Migrationen.", tone: "risk high" },
};

/** Die Schritte, die den Pruefschritt einer Merge-Anfrage ersetzen. */
export const REVIEW_STEPS: readonly BranchFlowNote[] = [
  {
    title: "Ein Change Set trägt die Änderung",
    body: "Genau eine SQL-Anweisung, verschlüsselt abgelegt, mit ihrem Prüfwert und mit einer Risikoeinschätzung, die aus der Anweisung und der Zielumgebung kommt. Das ist die Einheit, die geprüft wird, nicht ein Zweig mit vielen Commits.",
  },
  {
    title: "Eine Freigabe prüft sie",
    body: "Die Freigabe hängt an einem Prüfwert über Change Set, Projekt, Umgebung, Datenbankreferenz und Frist. Ändert sich eines davon, passt der Prüfwert nicht mehr und die Freigabe gilt nicht mehr. Entschieden wird einmal, und die Entscheidung steht in der Audit-Kette.",
  },
  {
    title: "Ein Worker wendet sie an",
    body: "Erst nach der Freigabe kommt die Anweisung in die Warteschlange. Ein Worker holt sie mit einer Lease, führt sie in einer Transaktion aus und schreibt den Ledger-Eintrag. Kein Weg von der Console führt an diesen Schritt vorbei.",
  },
];

/**
 * Was es hier nicht gibt, jeweils mit Grund. Kein Eintrag beschreibt eine
 * Oberflaeche, die es nicht gibt; jeder sagt, warum QKERN das nicht kann.
 */
export const MISSING_BRANCHING: readonly BranchFlowNote[] = [
  {
    title: "Keine Datenbank je Zweig auf Zuruf",
    body: "Eine Umgebung bekommt ihre Datenbank von der Provisionierung, und die legt drei an, nicht beliebig viele. Es gibt keinen Aufruf, der zu einem Namen eine vierte Datenbank erzeugt, und es gäbe auch keinen, der sie wieder wegräumt. Ein Zweig, dessen Datenbank nach dem Zusammenführen bliebe, wäre schlimmer als keiner.",
  },
  {
    title: "Keine Abstammung zwischen Umgebungen",
    body: "Development ist nicht der Vorfahr von Staging. Die drei Umgebungen stehen nebeneinander, jede mit ihrer eigenen Datenbank, und nichts in der Kontrollebene hält fest, dass die eine aus der anderen hervorgegangen wäre. Die Reihenfolge auf dieser Seite ist die Reihenfolge, in der Menschen üblicherweise vorgehen, und keine Herkunft.",
  },
  {
    title: "Kein automatisches Zusammenführen von Schemaänderungen",
    body: "Eine Änderung wandert nicht von einer Umgebung in die nächste. Wer sie in Staging haben will, reicht sie dort als eigenes Change Set ein, mit eigener Freigabe und eigenem Ledger-Eintrag. Das ist mehr Arbeit als ein Knopf, und es ist der Grund, warum keine Umgebung still etwas bekommt, das niemand für sie freigegeben hat.",
  },
  {
    title: "Kein Vergleich zweier Umgebungen",
    body: "Was diese Seite zählt, sind Change Sets, Freigaben und Aufträge, also der Weg einer Änderung. Ob zwei Umgebungen dasselbe Schema haben, sagt sie nicht: Dafür müsste QKERN beide Datenbanken gleichzeitig lesen und Tabelle gegen Tabelle stellen, und das tut hier nichts.",
  },
  {
    title: "Keine Merge-Anfrage als eigenes Ding",
    body: "Es gibt kein Objekt, das man öffnen, kommentieren und schliessen könnte. Die Einheit der Prüfung ist das Change Set, und die Entscheidung darüber ist die Freigabe. Eine zusätzliche Hülle darum wäre eine zweite Wahrheit neben der Audit-Kette.",
  },
];

/** Woher jede Zahl dieser Seite kommt. */
export const CHANGE_SETS_SOURCE_NOTE =
  "Die Change Sets zählt die Datenbank selbst, gruppiert nach Umgebung und Zustand, über change_sets. Keine Zahl kommt aus einer abgeschnittenen Liste, und keine wird geschätzt.";

export const APPROVALS_SOURCE_NOTE =
  "Die Freigaben stehen in approval_requests, eine je geprüfter Änderung. Wer entschieden hat, steht nicht hier, sondern unter Freigaben und in der Audit-Kette.";

export const MIGRATIONS_SOURCE_NOTE =
  "Die Aufträge stehen in migration_jobs, also in der Warteschlange, aus der der Worker holt. Sie sagen, was von den freigegebenen Änderungen wirklich angekommen ist.";

export const NO_QUEUE_NOTE =
  "Diese Installation führt keine Warteschlange für Migrationen: Es gibt hier keinen Worker, der etwas anwenden könnte. Das ist nicht dasselbe wie eine leere Warteschlange, und darum steht hier keine Null.";

export const ENVIRONMENT_SET_NOTE =
  "Die drei Umgebungen stehen hier immer, auch die ohne eine einzige Zeile. Wären nur die gezeigt, zu denen etwas vorliegt, sähe die Seite wie eine Liste von Zweigen aus, die wächst und schrumpft.";

export function environmentText(environment: string): EnvironmentId {
  return environment === "staging" || environment === "production" ? environment : "development";
}

export function presence(present: boolean): PresenceId {
  return present ? "present" : "absent";
}

/**
 * Wie viel einer Umgebung noch nicht angekommen ist.
 *
 * Offen heisst: eingereicht, aber weder angewandt noch abgelehnt. Die
 * fehlgeschlagenen zaehlen nicht mit, denn sie warten nicht, sie sind
 * gescheitert; sie stehen daneben mit ihrer eigenen Zahl.
 */
export function openChangeCount(byStatus: Readonly<Record<ChangeStatusId, number>>): number {
  return byStatus.draft + byStatus.validating + byStatus.ready + byStatus.approved;
}

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function branchFlowTexts(): string[] {
  return [
    ...Object.values(ENVIRONMENT_TEXTS).flatMap((entry) => [entry.label, entry.explains]),
    ...Object.values(PRESENCE_TEXTS).flatMap((entry) => [entry.label, entry.explains]),
    ...Object.values(CHANGE_STATUS_TEXTS).flatMap((entry) => [entry.label, entry.explains]),
    ...Object.values(APPROVAL_STATUS_TEXTS).flatMap((entry) => [entry.label, entry.explains]),
    ...Object.values(MIGRATION_STATUS_TEXTS).flatMap((entry) => [entry.label, entry.explains]),
    ...REVIEW_STEPS.flatMap((entry) => [entry.title, entry.body]),
    ...MISSING_BRANCHING.flatMap((entry) => [entry.title, entry.body]),
    NO_FREE_BRANCHES,
    REVIEW_EXISTS_NOTE,
    SCOPE_NOTE,
    CHANGE_SETS_SOURCE_NOTE,
    APPROVALS_SOURCE_NOTE,
    MIGRATIONS_SOURCE_NOTE,
    NO_QUEUE_NOTE,
    ENVIRONMENT_SET_NOTE,
  ];
}
