/**
 * Die Texte der Projekt-Gesundheit (2.44), deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `security-advisor-texts` (2.39) und
 * `performance-advisor-texts` (2.40): Der Schluessel ist der deutsche Text,
 * die Console uebersetzt ihn ueber ihren Katalog, und der Vertrag
 * `console-i18n-contract` liest diese Tabellen mit und verlangt fuer jeden
 * Text en, fr und it. Das Modul ist rein, damit Server und Console es
 * gleichermassen laden duerfen: keine Datenbank, kein React, keine Farbe
 * ausser der Tonangabe, die die Ansicht als Klasse verwendet.
 *
 * Wichtig fuer die Geheimhaltung: Ein Befund dieser Seite kann nur aus dieser
 * Datei stammen. `detail` ist ein Schluessel aus `HEALTH_DETAILS`, und
 * `evidence` ist ein Schluessel aus `HEALTH_MEASURES` mit hoechstens einer
 * Zahl. Ein Verbindungsstring, ein Token oder ein Kundenwert passt in keines
 * von beiden, weil keine Variable in einen dieser Texte laeuft.
 */

export const HEALTH_SUBSYSTEM_IDS = [
  "database",
  "data_api",
  "auth",
  "storage",
  "compute",
  "queues_cron",
  "realtime",
  "vault",
] as const;

export type HealthSubsystemId = (typeof HEALTH_SUBSYSTEM_IDS)[number];

/**
 * Die sechs Zustaende. `degraded` ist der schlimmste: Etwas ist eingerichtet
 * und antwortet trotzdem nicht. `unknown` steht darueber, weil eine fehlende
 * Probe kein gutes Zeugnis ist, aber unter `degraded`, weil sie kein Defekt
 * ist. `off` und `unconfigured` sind Entscheidungen, keine Stoerungen.
 *
 * `configured` ist seit 2.57 dabei und trennt zwei Aussagen, die 2.44 beide
 * `ok` genannt hat. `ok` heisst: Der Dienst wurde gefragt und hat
 * geantwortet. `configured` heisst: Es ist etwas hinterlegt, gefragt wurde
 * niemand. Realtime und Vault tragen genau das; sie als `ok` mit dem Label
 * "erreichbar" zu zeigen, war die Unwahrheit, die 2.44 selbst als offen
 * notiert hat.
 */
export const HEALTH_STATES = ["ok", "configured", "off", "unconfigured", "unknown", "degraded"] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

/**
 * Je hoeher, desto schlimmer. Das Gesamturteil ist das Maximum.
 *
 * `configured` liegt ueber `ok` und unter `off`: Ein Dienst, von dem nur die
 * Einrichtung bekannt ist, ist kein bewiesen erreichbarer, aber auch keine
 * Entscheidung gegen ihn. Solange Realtime oder Vault eingerichtet sind,
 * sagt das Gesamturteil darum nicht mehr "erreichbar", und das ist der
 * Punkt.
 */
export const HEALTH_STATE_RANK: Record<HealthState, number> = {
  ok: 0,
  configured: 1,
  off: 2,
  unconfigured: 3,
  unknown: 4,
  degraded: 5,
};

export type HealthStateText = {
  label: string;
  explains: string;
  /** Wie die Ansicht den Zustand einfaerbt; dieselben Klassen wie die Berater. */
  tone: "secure" | "muted" | "risk medium" | "risk high";
};

export const HEALTH_STATE_TEXTS: Record<HealthState, HealthStateText> = {
  ok: {
    label: "erreichbar",
    explains: "Der Dienst ist eingerichtet und hat auf eine Leseanfrage geantwortet.",
    tone: "secure",
  },
  configured: {
    label: "eingerichtet",
    explains: "Für den Dienst ist etwas hinterlegt. Gefragt wurde er nicht, also sagt diese Seite auch nicht, dass er antwortet.",
    tone: "muted",
  },
  off: {
    label: "abgeschaltet",
    explains: "Der Dienst ist in dieser Installation bewusst nicht freigeschaltet. Das ist kein Defekt.",
    tone: "muted",
  },
  unconfigured: {
    label: "nicht eingerichtet",
    explains: "Der Dienst wäre verfügbar, aber für dieses Projekt ist nichts eingerichtet.",
    tone: "muted",
  },
  unknown: {
    label: "unbekannt",
    explains: "Die Probe konnte nicht laufen. Daneben steht, woran es lag; ein Urteil steht hier bewusst nicht.",
    tone: "risk medium",
  },
  degraded: {
    label: "gestört",
    explains: "Der Dienst ist eingerichtet und hat nicht oder nicht in der erwarteten Form geantwortet.",
    tone: "risk high",
  },
};

export type HealthSubsystemText = {
  title: string;
  /** Was die Probe liest, fuer die Zeile unter dem Titel. */
  probes: string;
};

export const HEALTH_SUBSYSTEMS: Record<HealthSubsystemId, HealthSubsystemText> = {
  database: {
    title: "Datenbank",
    probes: "Ein Katalogabruf im Schema public über die Leserolle der Data API. Gezählt werden Tabellen, nichts wird gelesen, was in ihnen steht.",
  },
  data_api: {
    title: "Data API",
    probes: "Das generierte OpenAPI-Dokument dieser Umgebung. Gezählt werden die Tabellen, die es freigibt.",
  },
  auth: {
    title: "Auth",
    probes: "Die Liste der Anmeldeanbieter und die öffentlichen Signaturschlüssel aus dem JWKS. Kein Client-Secret, kein Token.",
  },
  storage: {
    title: "Storage",
    probes: "Die Bucket-Liste der Umgebung. Gezählt werden Buckets, keine Objekte.",
  },
  compute: {
    title: "Compute",
    probes: "Die Function-Definitionen der Umgebung und ob die Sandbox freigeschaltet ist. Kein Aufruf, kein Container.",
  },
  queues_cron: {
    title: "Queues und Cron",
    probes: "Die Queue- und Cron-Definitionen der Umgebung, dazu der Ausdruck jeder aktiven Cron-Definition und ob sie je ausgelöst hat.",
  },
  realtime: {
    title: "Realtime",
    probes: "Ob für diese Installation eine Adresse des Realtime-Servers hinterlegt ist. Keine Verbindung wird aufgebaut.",
  },
  vault: {
    title: "Vault",
    probes: "Ob überhaupt ein Vault verbunden ist. Kein Pfad, kein Secret, keine Anfrage an den Vault.",
  },
};

/**
 * Warum ein Dienst so beurteilt wird, wie er beurteilt wird.
 *
 * Die ersten acht gelten fuer jeden Teil und bestimmen zugleich den Zustand
 * (siehe `HEALTH_REASON_STATES` in `lib/server/advisors/health-rules.ts`); die
 * uebrigen gehoeren je zu einem Teil.
 */
export const HEALTH_DETAILS = {
  disabled: "Der Dienst ist in dieser Installation abgeschaltet.",
  notReady: "Die Umgebung ist noch nicht fertig eingerichtet; es gibt nichts, wogegen die Probe laufen könnte.",
  notConfigured: "Für dieses Projekt ist nichts eingerichtet.",
  unavailable: "Der Dienst hat nicht oder nicht in der erwarteten Form geantwortet.",
  forbidden: "Deine Rolle darf diesen Dienst nicht lesen. Darum steht hier kein Urteil, nicht weil etwas kaputt wäre.",
  consoleOnly: "Nur mit einer Console-Sitzung prüfbar, nicht mit einem Projekt-Key.",
  noProbe: "Für diesen Teil gibt es im Code keine Probe, die etwas Ehrliches sagen könnte.",
  reachable: "Der Dienst hat auf eine Leseanfrage geantwortet.",
  databaseCatalogRead: "Die Projektdatenbank hat einen Katalogabruf beantwortet.",
  dataApiExposed: "Die generierte Data API antwortet und gibt Tabellen frei.",
  dataApiNoTables: "Die generierte Data API antwortet, gibt aber keine Tabelle frei. Ohne RLS, Primärschlüssel und mindestens eine nicht sensible Spalte nimmt sie eine Tabelle nicht auf.",
  authNoProviders: "Der Anmeldedienst antwortet, aber es ist kein Anmeldeanbieter konfiguriert.",
  authNoSigningKeys: "Der Anmeldedienst antwortet, aber es liegt kein Signaturschlüssel vor. Ohne Schlüssel kann er kein Token ausstellen.",
  storageNoBuckets: "Storage läuft, aber in dieser Umgebung gibt es noch keinen Bucket.",
  computeNoFunctions: "Die Definitionsfläche antwortet, aber es gibt keine Function-Definition.",
  computeSandboxOff: "Function-Definitionen sind lesbar, aber die Sandbox ist nicht freigeschaltet. Aufrufen lässt sich hier nichts.",
  queuesCronEmpty: "Queues und Cron antworten, aber es ist weder eine Queue noch ein Zeitplan definiert.",
  cronNeverDispatched: "Mindestens eine aktive Cron-Definition hat noch nie ausgelöst, obwohl ihr eigenes Intervall längst vergangen ist. Entweder läuft der Cron-Prozess nicht, oder das Einreihen scheitert.",
  realtimeConfigured: "Für den Realtime-Server ist eine Adresse hinterlegt. Diese Seite hat dort nicht angeklopft; ob jemand zuhört, weiss sie nicht.",
  vaultConnected: "Ein Vault ist eingerichtet. Diese Seite hat ihn nichts gefragt; ob ein einzelnes Secret darin liegt, steht unter Functions & Jobs → Secrets.",
} as const;

export type HealthDetailId = keyof typeof HEALTH_DETAILS;

/** Die ersten acht Gruende, die fuer jeden Teil gelten. */
export const HEALTH_GENERIC_REASONS = [
  "disabled", "notReady", "notConfigured", "unavailable", "forbidden", "consoleOnly", "noProbe",
] as const;

export type HealthReasonId = (typeof HEALTH_GENERIC_REASONS)[number];

/**
 * Der Beleg: ein Mass und hoechstens eine Zahl.
 *
 * `count` ist `null`, wenn das Mass keine Zahl hat — bei einer Fehlerklasse
 * etwa. Mehr kann ein Beleg nicht tragen, und genau darum kann hier kein
 * Geheimnis hindurch.
 */
export const HEALTH_MEASURES = {
  tables: "Tabellen im Schema public",
  exposedTables: "Tabellen gibt die Data API frei",
  providers: "Anmeldeanbieter konfiguriert",
  signingKeys: "Signaturschlüssel im JWKS",
  buckets: "Buckets angelegt",
  functions: "Function-Definitionen angelegt",
  queues: "Queues angelegt",
  cronDefinitions: "Cron-Definitionen angelegt",
  cronStale: "aktive Cron-Definitionen ohne erstes Auslösen",
  sandboxReady: "Sandbox freigeschaltet",
  sandboxMissing: "Sandbox nicht freigeschaltet",
  transportConfigured: "Adresse des Realtime-Servers hinterlegt",
  vaultConnected: "Vault verbunden",
  errorDisabled: "Fehlerklasse: Dienst abgeschaltet",
  errorNotReady: "Fehlerklasse: Umgebung nicht bereit",
  errorNotConfigured: "Fehlerklasse: nichts eingerichtet",
  errorUnavailable: "Fehlerklasse: keine oder keine gültige Antwort",
  errorForbidden: "Fehlerklasse: keine Berechtigung",
  errorConsoleOnly: "Fehlerklasse: ohne Console-Sitzung nicht prüfbar",
  errorNoProbe: "Fehlerklasse: keine Probe vorhanden",
} as const;

export type HealthMeasureId = keyof typeof HEALTH_MEASURES;

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function healthAdvisorTexts(): string[] {
  return [
    ...Object.values(HEALTH_STATE_TEXTS).flatMap((state) => [state.label, state.explains]),
    ...Object.values(HEALTH_SUBSYSTEMS).flatMap((subsystem) => [subsystem.title, subsystem.probes]),
    ...Object.values(HEALTH_DETAILS),
    ...Object.values(HEALTH_MEASURES),
  ];
}
