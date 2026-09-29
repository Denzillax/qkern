/**
 * Die Texte und die nachgeprueften Angaben der Seite Storage -> Analytics-
 * Buckets (2.99), deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `vector-buckets-texts` (2.93): Der Schluessel ist der
 * deutsche Text, die Console uebersetzt ihn ueber ihren Katalog, und der
 * Vertrag `console-i18n-contract` liest diese Tabellen mit und verlangt fuer
 * jeden Text en, fr und it. Ein eigenes Modul braucht es, weil die Ansicht
 * `t(variable)` aufruft: Das Urteil ueber den Server entsteht aus einer
 * Ableitung, und ein Text hinter einer Variablen faellt durch die Suche nach
 * `t("...")`.
 *
 * Das Modul ist rein: keine Datenbank, kein React, kein `fetch`.
 *
 * ## Warum diese Seite nichts kann
 *
 * Der Platzhalter versprach eine "spaltenorientierte Ablage fuer grosse
 * Auswertungen (Iceberg)". Bei Supabase ist das eine Ablage fuer
 * Iceberg-Tabellen: Parquet-Dateien im Storage, ein Katalog nach der
 * Iceberg-REST-Schnittstelle fuer Namensraeume und Tabellen, Zugang mit
 * S3-Schluesseln, Abfragen ueber eine Engine ausserhalb der Datenbank.
 * Nachgesehen wurde, was QKERN davon hat, statt es zu glauben:
 *
 *   - Buckets halten Bytes (`db/migrations/0025`): Name, MIME-Liste, Groesse,
 *     Kontingent, Aufbewahrung. Keine Tabelle kennt eine Spalte, einen
 *     Namensraum oder einen Metadatenzeiger.
 *   - Der S3-Endpunkt `/s3` (2.96, erweitert 2.99) nimmt Dateien an, wie ein
 *     Iceberg-Client sie schreibt, aber nur in einem Stueck bis 64 MiB;
 *     Multipart ueber S3 antwortet mit 501.
 *   - Es gibt keine Route, die die Iceberg-REST-Schnittstelle spricht, und
 *     keinen Dienst dahinter; `app/api` kennt weder `iceberg` noch `parquet`.
 *   - Keine Compose-Datei faehrt eine Engine (Spark, Trino, DuckDB) oder
 *     einen Katalogdienst.
 *   - Ob der PostgreSQL-Server eine Erweiterung anbietet, die Parquet oder
 *     Iceberg liest, sagt die Seite nicht aus dem Quelltext, sondern liest es
 *     bei jedem Oeffnen aus dem Katalog dieser einen Projektdatenbank.
 */

/**
 * Die Namen und Grenzen, ueber die diese Seite eine Aussage macht.
 *
 * Sie stehen hier und nicht in der Ansicht, weil der Vertrag der Seite genau
 * diese Werte gegen das Repository prueft: den Pfad des S3-Endpunkts, seine
 * Obergrenze je PutObject und die Erweiterungen, nach denen die Seite im
 * Katalog sucht. Aendert jemand einen davon, faellt der Vertrag, statt dass
 * die Seite still etwas anderes behauptet.
 */
export const ANALYTICS_FACTS = {
  /** Der S3-Endpunkt von QKERN, pfadadressiert. */
  s3EndpointPath: "/s3",
  /** Die Obergrenze eines PutObject durch den Endpunkt, in MiB. */
  s3MaxPutMiB: 64,
  /**
   * Erweiterungen, die Parquet oder Iceberg aus PostgreSQL heraus lesen
   * wuerden. Die Seite sucht im Katalog nach genau diesen Namen.
   */
  extensions: ["pg_parquet", "pg_duckdb", "pg_mooncake", "pg_lakehouse", "pg_analytics", "parquet_s3_fdw", "duckdb_fdw"],
} as const;

export type AnalyticsVerdictId = "missing" | "available" | "installed";

export type AnalyticsVerdict = {
  label: string;
  explains: string;
  /** Dieselben Klassen wie die Berater. */
  tone: "secure" | "muted" | "risk medium" | "risk high";
};

/**
 * Das Urteil ueber diesen einen Server, aus dem Katalog abgeleitet.
 *
 * Drei Faelle, und alle drei sind erreichbar: Ein Server ohne eine der
 * genannten Erweiterungen faellt auf `missing`; einer, der eine anbietet, auf
 * `available`; eine Datenbank, in der jemand eine schon angelegt hat, auf
 * `installed`. Auch mit `installed` gibt es keinen Katalog und keine Tabelle;
 * der Satz dazu sagt das.
 */
export const ANALYTICS_VERDICTS: Record<AnalyticsVerdictId, AnalyticsVerdict> = {
  missing: {
    label: "keine Erweiterung für Parquet oder Iceberg auf diesem Server",
    explains: "Dieser Server bietet keine der Erweiterungen an, die Parquet-Dateien oder Iceberg-Tabellen aus PostgreSQL heraus lesen. Keine davon steht unter den verfügbaren Erweiterungen. Ohne eine solche Erweiterung kann die Datenbank eine Parquet-Datei im Storage nur als Bytes sehen, und eine Abfrage darüber gibt es nicht.",
    tone: "risk medium",
  },
  available: {
    label: "eine Erweiterung für Parquet ist verfügbar, nicht angelegt",
    explains: "Dieser Server bietet eine Erweiterung an, die Parquet lesen kann; in dieser Datenbank ist sie nicht angelegt. Anlegen geht über ein Change Set mit CREATE EXTENSION, und ob es erlaubt ist, entscheidet die Migration. Einen Katalog mit Namensräumen und Tabellen gibt es damit noch nicht, nur einen Leser für Dateien.",
    tone: "muted",
  },
  installed: {
    label: "eine Erweiterung für Parquet ist in dieser Datenbank angelegt",
    explains: "In dieser Datenbank ist eine Erweiterung angelegt, die Parquet lesen kann. Damit liesse sich eine Datei aus dem Storage als Tabelle lesen, sofern die Erweiterung an ihn kommt. Einen Katalog mit Namensräumen, Tabellen und einem Metadatenzeiger je Tabelle hat QKERN trotzdem nicht; dafür fehlen die Tabelle, der Dienst und die Route.",
    tone: "secure",
  },
};

export type AnalyticsExtension = { name: string; installedVersion: string | null };

/**
 * Welche der gesuchten Erweiterungen der Katalog kennt, und das Urteil daraus.
 * Angelegt schlaegt angeboten; angeboten schlaegt fehlt.
 */
export function analyticsVerdict(extensions: readonly AnalyticsExtension[]): { id: AnalyticsVerdictId; found: AnalyticsExtension[] } {
  const wanted = new Set<string>(ANALYTICS_FACTS.extensions);
  const found = extensions.filter((entry) => wanted.has(entry.name));
  if (found.some((entry) => entry.installedVersion !== null)) return { id: "installed", found };
  if (found.length > 0) return { id: "available", found };
  return { id: "missing", found };
}

export const ANALYTICS_BUCKET_TEXTS = {
  kicker: "STORAGE",
  title: "Analytics-Buckets: es gibt keinen Katalog und keine Engine",

  /** Der Satz, der die Seite eroeffnet. */
  opening:
    "Bei Supabase steht unter diesem Menüpunkt eine Ablage für Iceberg-Tabellen: Parquet-Dateien im Storage, ein Katalog nach der Iceberg-REST-Schnittstelle, der Namensräume und Tabellen führt, und der Zugang darauf mit S3-Schlüsseln. QKERN hat davon den S3-Zugang und Buckets für Bytes. Es hat keinen Katalog, keine Tabelle und keine Engine, die eine Abfrage darüber rechnet. Diese Seite sagt das, statt eine leere Tabellenliste zu zeigen.",

  /** Was ein Bucket bei QKERN heute ist. */
  bucketsTitle: "Was ein Bucket bei QKERN hält",
  bucketsMeaning:
    "Ein Bucket des Projekts hält Bytes, gefunden über den Schlüssel eines Objekts. Eine Parquet-Datei kann darin liegen wie jede andere Datei, mit MIME-Liste, Grösse, Kontingent und Virenprüfung. Der Bucket weiss nicht, dass sie Spalten hat, und niemand liest sie als Tabelle.",

  /** Was der S3-Endpunkt fuer einen Iceberg-Client leistet. */
  s3Title: "Was der S3-Zugang kann",
  s3Meaning:
    "Der Endpunkt nimmt an, was ein Iceberg-Client an Dateien schreibt: PutObject in einem Stück, GetObject ganz oder als Bytebereich, CopyObject, DeleteObjects, Presigned URLs. Was fehlt, ist Multipart über S3; eine grössere Datei ginge darum nur über den REST-Weg. Und jede Datei geht durch den Scanner, bevor sie lesbar ist, was bei vielen kleinen Dateien Zeit kostet.",

  /** Was der Server wirklich anbietet. */
  serverTitle: "Was dieser Server anbietet",
  serverMeaning:
    "Gelesen wird der Katalog dieser einen Projektdatenbank, dieselbe Route wie unter Datenbank → Erweiterungen. Gesucht wird nach Erweiterungen, die Parquet oder Iceberg aus PostgreSQL heraus lesen. Die Zahl ist die des Servers und keine Annahme über andere Server.",

  /** Was ein Katalog waere, und warum er der Kern der Sache ist. */
  catalogTitle: "Was ein Katalog wäre",
  catalogMeaning:
    "Ein Iceberg-Katalog führt je Namensraum die Tabellen und je Tabelle den Zeiger auf die aktuelle Metadatendatei. Jede Änderung ist ein Tausch dieses Zeigers, und der Katalog lehnt einen Tausch ab, der auf einem alten Stand beruht. Genau das hat QKERN nicht: keine Tabelle in der Kontrollebene, keine Route, die die Iceberg-REST-Schnittstelle spricht, und keinen Dienst, der den Tausch prüft.",

  /** Was der naechste Schritt waere, in der Reihenfolge. */
  nextTitle: "Was der nächste Schritt wäre",
  nextLead:
    "In dieser Reihenfolge, und der erste Schritt ist der, ohne den die anderen nichts nützen. Diese Seite führt keinen davon aus.",

  /** Was die Seite ausdruecklich nicht tut. */
  readOnly:
    "Diese Seite legt nichts an, ändert nichts und löscht nichts. Es gibt dafür keine Route.",
  noNumbers:
    "Hier steht keine geschätzte Zahl. Was die Seite über den Server sagt, kommt aus dem Katalog; was sie über QKERN sagt, steht im Quelltext und wird vom Vertrag der Seite gegen das Repository geprüft.",
} as const;

export type AnalyticsStep = { title: string; body: string };

/**
 * Die Schritte, die es braucht, bis diese Seite mehr als einen Befund zeigen
 * kann. Jeder Schritt nennt, was wirklich dahinter steckt, und keiner tut so,
 * als waere er klein.
 */
export const ANALYTICS_NEXT_STEPS: readonly AnalyticsStep[] = [
  {
    title: "1. Der Katalog braucht eine Migration und eine Route",
    body: "Namensräume, Tabellen und der Metadatenzeiger je Tabelle gehören in die Kontrollebene, mit denselben Grenzen wie jede Projekttabelle: Organisation, Projekt, Umgebung, Zeilensicherheit. Darüber eine Route, die die Iceberg-REST-Schnittstelle spricht: Namensräume auflisten, Tabelle anlegen, Metadaten laden und den Zeiger tauschen, mit Prüfung des alten Stands. Ohne diese Prüfung schreibt jeder Client am anderen vorbei.",
  },
  {
    title: "2. Die Dateien brauchen Multipart über S3",
    body: "Ein Iceberg-Client schreibt Parquet-Dateien und Metadaten über S3. PutObject in einem Stück reicht für kleine Tabellen; grössere Dateien schickt jeder Client als Multipart, und das antwortet am Endpunkt heute mit 501. Dazu kommt der Scanner: Er sieht jede Datei, bevor sie lesbar ist, und ein Client, der hundert Dateien schreibt und gleich wieder liest, wartet hundertmal darauf.",
  },
  {
    title: "3. Eine Engine muss die Dateien lesen",
    body: "Nichts im Stack liest Parquet. Ob der Server dieser Datenbank eine Erweiterung dafür anbietet, liest die Karte oben bei jedem Öffnen nach; heute fällt sie auf fehlt, und dann stellt sich dieselbe Frage wie bei den Vektor-Buckets: ein anderes Image für jede Compose-Datei. Der andere Weg ist eine Engine ausserhalb der Datenbank, die den Katalog fragt und die Dateien über S3 liest. Die gibt es bei QKERN nicht, und sie wäre ein eigener Dienst mit eigener Zulassung.",
  },
  {
    title: "4. Der Zugang muss dieselben Grenzen kennen",
    body: "Ein S3-Schlüsselpaar handelt als Service-Rolle über seinen Bucket-Satz. Ein Katalog müsste dieselbe Zugangsart kennen, damit ein Paar nur die Tabellen sieht, deren Dateien es lesen darf, und damit ein widerrufenes Paar auch aus dem Katalog fällt.",
  },
];

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function analyticsBucketTexts(): string[] {
  return [
    ...Object.values(ANALYTICS_VERDICTS).flatMap((entry) => [entry.label, entry.explains]),
    ...ANALYTICS_NEXT_STEPS.flatMap((entry) => [entry.title, entry.body]),
    ...Object.values(ANALYTICS_BUCKET_TEXTS),
  ];
}
