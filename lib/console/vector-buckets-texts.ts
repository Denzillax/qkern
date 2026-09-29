/**
 * Die Texte und die nachgeprueften Angaben der Seite Storage -> Vektor-Buckets
 * (2.93), deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `wrappers-texts` (2.72): Der Schluessel ist der deutsche
 * Text, die Console uebersetzt ihn ueber ihren Katalog, und der Vertrag
 * `console-i18n-contract` liest diese Tabellen mit und verlangt fuer jeden
 * Text en, fr und it. Ein eigenes Modul braucht es, weil die Ansicht
 * `t(variable)` aufruft: Das Urteil ueber den Server entsteht aus einer
 * Ableitung, und ein Text hinter einer Variablen faellt durch die Suche nach
 * `t("...")`.
 *
 * Das Modul ist rein: keine Datenbank, kein React, kein `fetch`.
 *
 * ## Warum diese Seite nichts kann
 *
 * Der Platzhalter versprach "Ablage fuer Embeddings mit Aehnlichkeitssuche".
 * Dafuer braucht es einen Vektortyp im Server, und den gibt es hier nicht.
 * Nachgesehen wurde, statt es zu glauben:
 *
 *   - Der Zertifizierungsstack faehrt `postgres:17-alpine`. Das Image bringt
 *     59 Erweiterungen mit, `vector` ist keine davon.
 *   - `CREATE EXTENSION vector` endet dort mit `extension "vector" is not
 *     available`. Die Kontrolldatei fehlt schlicht.
 *   - Alpine 3.24 hat zwar ein Paket `postgresql-pgvector` (0.8.1), aber es
 *     ist gegen Alpines eigenes PostgreSQL 18 gebaut und landet unter
 *     `/usr/share/postgresql18`. Der Server im Image ist ein selbst gebautes
 *     PostgreSQL 17 unter `/usr/local` und kann es nicht laden.
 *   - Das naechste, was PostgreSQL selbst mitbringt, ist `cube`. Es rechnet
 *     Abstaende, hoert aber bei 100 Dimensionen fest auf.
 *   - Die Buckets, die es gibt, halten Bytes. `db/migrations/0025` fuehrt
 *     Name, MIME-Liste, Groesse, Kontingent und Aufbewahrung; keine Spalte
 *     fuer eine Dimension, ein Abstandsmass oder eine Einbettung.
 *
 * Die Seite behauptet darum nichts, sondern liest bei jedem Oeffnen den
 * Katalog dieser einen Projektdatenbank und sagt, was er hergibt. Auf einem
 * Server, der `vector` eines Tages anbietet, dreht sich das Urteil von selbst.
 */

/**
 * Die Namen und Grenzen, ueber die diese Seite eine Aussage macht.
 *
 * Sie stehen hier und nicht in der Ansicht, weil der Fall (2.93) gegen die
 * echte Datenbank genau diese Werte prueft: den Namen der fehlenden
 * Erweiterung, den Namen des Ersatzes und dessen feste Obergrenze. Aendert
 * jemand einen davon, faellt der Fall, statt dass die Seite still etwas
 * anderes behauptet.
 */
export const VECTOR_FACTS = {
  /** Die Erweiterung, die einen Vektortyp mitbraechte. Sie fehlt. */
  extension: "vector",
  /** Was PostgreSQL selbst fuer Abstaende mitbringt. */
  fallbackExtension: "cube",
  /** Die feste Obergrenze von `cube`, aus PostgreSQL selbst. */
  fallbackMaxDimensions: 100,
} as const;

export type VectorVerdictId = "missing" | "available" | "installed";

export type VectorVerdict = {
  label: string;
  explains: string;
  /** Dieselben Klassen wie die Berater. */
  tone: "secure" | "muted" | "risk medium" | "risk high";
};

/**
 * Das Urteil ueber diesen einen Server, aus dem Katalog abgeleitet.
 *
 * Drei Faelle, und alle drei sind erreichbar: Heute faellt jeder Server auf
 * `missing`; ein Server mit pgvector im Image faellt auf `available`; eine
 * Datenbank, in der jemand die Erweiterung schon angelegt hat, auf
 * `installed`.
 */
export const VECTOR_VERDICTS: Record<VectorVerdictId, VectorVerdict> = {
  missing: {
    label: "kein Vektortyp auf diesem Server",
    explains: "Dieser Server bietet die Erweiterung vector nicht an. Sie steht nicht unter den verfügbaren Erweiterungen, und CREATE EXTENSION vector endet mit der Meldung, dass es sie nicht gibt. Ohne sie hat die Datenbank keinen Typ, in dem eine Einbettung stehen könnte, und keinen Operator, der zwei davon vergleicht.",
    tone: "risk medium",
  },
  available: {
    label: "Vektortyp verfügbar, nicht angelegt",
    explains: "Dieser Server bietet die Erweiterung vector an, in dieser Datenbank ist sie nicht angelegt. Anlegen geht über ein Change Set mit CREATE EXTENSION; ob es erlaubt ist, entscheidet die Migration. Eine Ablage für Einbettungen gibt es damit noch nicht, nur den Typ.",
    tone: "muted",
  },
  installed: {
    label: "Vektortyp in dieser Datenbank angelegt",
    explains: "Die Erweiterung vector ist in dieser Datenbank angelegt. Damit gibt es den Typ und die Abstandsoperatoren. Eine Ablage mit Buckets, Dimension je Bucket und einer Suche darüber hat QKERN trotzdem nicht; dafür fehlt die Tabelle, der Dienst und die Route.",
    tone: "secure",
  },
};

export function vectorVerdict(installedVersion: string | null, offered: boolean): VectorVerdictId {
  if (installedVersion !== null) return "installed";
  return offered ? "available" : "missing";
}

export const VECTOR_BUCKET_TEXTS = {
  kicker: "STORAGE",
  title: "Vektor-Buckets: die Datenbank hat keinen Vektortyp",

  /** Der Satz, der die Seite eroeffnet. */
  opening:
    "Bei Supabase steht unter diesem Menüpunkt eine Ablage für Einbettungen mit Ähnlichkeitssuche. QKERN hat davon nichts: keine Tabelle, keinen Dienst, keine Route und keinen Typ, in dem eine Einbettung überhaupt stehen könnte. Diese Seite sagt das, statt auf ein Backend zu warten, das niemand angefangen hat.",

  /** Was ein Bucket bei QKERN heute ist. */
  bucketsTitle: "Was ein Bucket bei QKERN hält",
  bucketsMeaning:
    "Ein Bucket des Projekts hält Bytes. Seine Zeile führt Namen, Leserecht, Schreibrecht, die erlaubten MIME-Typen, die grösste Objektgrösse, das Kontingent und eine Aufbewahrungsregel. Es gibt darin keine Spalte für eine Dimension, kein Abstandsmass und keinen Platz für eine Einbettung.",
  bucketsLimit:
    "Eine Einbettung liesse sich als Datei in einen dieser Buckets legen. Gefunden würde sie damit nicht: Storage sucht über den Schlüssel eines Objekts und rechnet keinen Abstand zwischen Inhalten.",

  /** Was der Server wirklich anbietet. */
  serverTitle: "Was dieser Server anbietet",
  serverMeaning:
    "Gelesen wird der Katalog dieser einen Projektdatenbank, dieselbe Route wie unter Datenbank → Erweiterungen. Die Zahl ist die des Servers und keine Annahme über andere Server.",
  fallbackTitle: "Der nächste Verwandte im Server",
  fallbackMeaning:
    "cube kommt mit PostgreSQL selbst und rechnet Abstände zwischen Punkten. Ein Würfel hört bei 100 Dimensionen fest auf. Die Grenze steckt im Server und lässt sich nicht einstellen. Wie viele Dimensionen eine Einbettung hat, bestimmt das Modell, das sie erzeugt, und QKERN kennt es nicht.",
  fallbackAbsent:
    "Auch cube bietet dieser Server nicht an. Damit gibt es hier nicht einmal den beschränkten Ersatz.",

  /** Was der naechste Schritt waere, in der Reihenfolge. */
  nextTitle: "Was der nächste Schritt wäre",
  nextLead:
    "In dieser Reihenfolge, und der erste Schritt ist der, an dem es heute hängt. Diese Seite führt keinen davon aus.",

  /** Was die Seite ausdruecklich nicht tut. */
  readOnly:
    "Diese Seite legt nichts an, ändert nichts und löscht nichts. Es gibt dafür keine Route.",
  noNumbers:
    "Hier steht keine geschätzte Zahl. Was die Seite über den Server sagt, kommt aus dem Katalog; was sie über QKERN sagt, steht im Quelltext und wird vom Fall (2.93) gegen die echte Datenbank geprüft.",
} as const;

export type VectorStep = { title: string; body: string };

/**
 * Die Schritte, die es braucht, bis diese Seite mehr als einen Befund zeigen
 * kann. Jeder Schritt nennt, was wirklich dahinter steckt, und keiner tut so,
 * als waere er klein.
 */
export const VECTOR_NEXT_STEPS: readonly VectorStep[] = [
  {
    title: "1. Der Server muss den Typ mitbringen",
    body: "Das Image des Zertifizierungsstacks ist postgres:17-alpine, und es bringt die Erweiterung vector nicht mit. Alpine hat zwar ein Paket postgresql-pgvector, aber es ist gegen Alpines eigenes PostgreSQL 18 gebaut und landet in dessen Verzeichnis; der Server im Image ist ein selbst gebautes PostgreSQL 17 unter /usr/local und kann es nicht laden. Es braucht also ein anderes Image oder ein eigenes, in dem die Erweiterung gebaut ist. Fünf Compose-Dateien fahren heute dasselbe Image; ein Wechsel betrifft jede davon und jeden Stack, der darauf zertifiziert.",
  },
  {
    title: "2. Die Ablage braucht eine Migration",
    body: "Ein Vektor-Bucket ist eine Sammlung mit einer festen Dimension und einem Abstandsmass, dazu die Einbettungen selbst mit Schlüssel und Beiwerk. Beides gehört in die Kontrollebene, mit denselben Grenzen wie jede andere Projekttabelle: Organisation, Projekt, Umgebung, Zeilensicherheit und ein Recht je Rolle.",
  },
  {
    title: "3. Ohne Index läuft jede Suche über alle Zeilen",
    body: "Eine Suche über alle Zeilen eines Buckets rechnet jeden Abstand einzeln. Das geht für hundert Zeilen und für hunderttausend nicht mehr. Ein Index für ungefähre Nachbarn gehört zur Sache dazu, und mit ihm die Frage, wie genau die Antwort noch ist.",
  },
  {
    title: "4. Einbettungen entstehen ausserhalb",
    body: "QKERN rechnet keine Einbettungen und ruft dafür kein Modell. Wer Vektoren ablegt, bringt sie mit. Ein Bucket müsste darum sagen, welche Dimension er annimmt, und eine Zeile mit einer anderen Länge ablehnen, statt sie zu verrechnen.",
  },
];

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function vectorBucketTexts(): string[] {
  return [
    ...Object.values(VECTOR_VERDICTS).flatMap((entry) => [entry.label, entry.explains]),
    ...VECTOR_NEXT_STEPS.flatMap((entry) => [entry.title, entry.body]),
    ...Object.values(VECTOR_BUCKET_TEXTS),
  ];
}
