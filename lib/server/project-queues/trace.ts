/**
 * Die Spur einer Nachricht: Stationen, Grenzen, Frist und der Anschluss nach
 * draussen (2.121). Migration 0081 legt die Tabelle an.
 *
 * ## Welche Form, und warum
 *
 * Zwei Formen standen zur Wahl, und die Entscheidung steht hier, weil der
 * naechste Leser sie hier sucht.
 *
 * **Eine Spur je Nachricht.** Gewaehlt, und zwar als Traeger. Der Grund ist
 * nicht Geschmack: QKERN hat die Korrelationskennung schon. Die
 * Nachrichten-Id entsteht beim Einstellen, steht in der Quittung
 * (`ProjectQueueEnqueueReceipt.id`), kommt im Claim zurueck
 * (`ProjectQueueClaim.id`), benennt Ack, Fail und Lease-Erneuerung in der
 * Route und steht in der Dead-Letter-Liste. Sie ueberlebt jede
 * Prozessgrenze, weil sie in der Datenbank steht und nicht im Prozess. Eine
 * zweite Kennung daneben waere eine zweite Antwort auf dieselbe Frage, und
 * zwei Antworten laufen auseinander; `projectQueueDedupeKeyHash` in
 * `service.ts` ist aus genau diesem Grund exportiert und nicht nachgebaut.
 *
 * **W3C Trace Context.** Dazugenommen, aber nur am Rand. `traceparent` loest
 * ein Problem, das die Nachrichten-Id nicht loesen kann: Sie endet an der
 * QKERN-Grenze. Wer QKERN zwischen anderen Diensten betreibt, hat schon eine
 * Spur, und die soll durchlaufen. Also darf das Einreihen einen `traceparent`
 * mitbringen; Spur-Id und Eltern-Span wandern auf die **erste** Station und
 * stehen in jeder Antwort der Trace-Route. Das kostet eine Kopfzeile, einen
 * Leser dafuer und zwei Spalten.
 *
 * Was es ausdruecklich **nicht** kostet: QKERN entscheidet an diesen beiden
 * Werten nichts. Kein Claim, kein Retry, kein Dead Letter sieht sie an.
 * Fehlen sie, traegt die Spur sich weiter selbst. Ein `traceparent`, der nicht
 * zur Form passt, wird weggelassen und nicht abgewiesen: Ein kaputter
 * Beobachtungskopf darf ein Einreihen nicht umbringen. Was QKERN hier
 * **nicht** tut, steht unter "Offen" am Ende dieser Datei.
 *
 * ## Welche Stationen eine Spur traegt
 *
 * Geschrieben wird eine Station dort, wo der Zustand wechselt, und in
 * derselben Transaktion. Acht Stationen, und die Liste ist absichtlich kurz:
 *
 * | Station | entsteht bei | Wirt | Grund |
 * | --- | --- | --- | --- |
 * | `enqueued` | Einstellen einer neuen Nachricht | nein | nein |
 * | `deduplicated` | Einstellen trifft einen gueltigen Zwilling | nein | nein |
 * | `replayed` | Wiedereinreihen eines Dead Letters | nein | nein |
 * | `claimed` | ein Worker bekommt die Pacht | ja | nein |
 * | `completed` | Ack | ja | nein |
 * | `retry_scheduled` | Fail, Nachricht kommt zurueck | ja | ja |
 * | `dead_lettered` | Fail ohne Versuch mehr, oder verfallene Pacht ohne | ja | ja |
 * | `lease_expired` | verfallene Pacht gibt die Nachricht frei | ja | `LEASE_EXPIRED` |
 *
 * ## Was eine Spur ausdruecklich nicht traegt
 *
 * **Die Erneuerung der Pacht.** `renewLease` ist der Herzschlag des Workers,
 * im Vorgabewert alle zehn Sekunden. Eine Nachricht, die eine Viertelstunde
 * laeuft, brachte neunzig Stationen, und keine einzige davon sagt etwas ueber
 * den Ausgang. Das waere der Takt protokolliert statt die Arbeit; dieselbe
 * Entscheidung trifft `ProjectAuthExpiryRetentionRuntime` fuer die leere
 * Runde. Wer wissen will, ob eine Pacht gehalten hat, sieht das am Ausgang:
 * `completed` heisst gehalten, `lease_expired` heisst verloren.
 *
 * **Jede Nutzlast.** Migration 0081 hat keine Spalte dafuer. Auch kein
 * Dedupe-Verifikator, kein Lease-Token, keine Fehlermeldung aus der Datenbank
 * oder aus fremdem Code. Was bleibt, sind Zeitpunkte, feste Codes, die
 * Wirt-Kennung und Zaehler.
 */
import type { ProjectQueue, ProjectQueueFailureCode } from "@/lib/server/project-queues/model";

export const PROJECT_QUEUE_TRACE_STATIONS = [
  "enqueued", "deduplicated", "replayed", "claimed",
  "completed", "retry_scheduled", "dead_lettered", "lease_expired",
] as const;

export type ProjectQueueTraceStation = (typeof PROJECT_QUEUE_TRACE_STATIONS)[number];

/** Die Stationen, die ein Worker ausloest, also die mit Wirt-Kennung. */
export const PROJECT_QUEUE_TRACE_WORKER_STATIONS: ReadonlySet<ProjectQueueTraceStation> =
  new Set(["claimed", "completed", "retry_scheduled", "dead_lettered", "lease_expired"]);

/** Der Anschluss nach draussen, so wie er aus einem `traceparent` kommt. */
export type ProjectQueueTraceAnchor = Readonly<{
  traceId: string;
  parentSpanId: string;
}>;

/** Eine Station, wie sie der Leser herausgibt. Kein Inhalt, nie. */
export type ProjectQueueTraceEntry = Readonly<{
  sequence: number;
  station: ProjectQueueTraceStation;
  attempt: number;
  workerId: string | null;
  failureCode: ProjectQueueFailureCode | null;
  occurredAt: string;
}>;

/**
 * Eine gelesene Spur.
 *
 * `complete` ist die ehrliche Antwort auf die Mengengrenze: Sobald eine Spur
 * die Obergrenze erreicht hat, kann der Leser nicht mehr wissen, ob danach
 * noch etwas geschehen ist, und sagt darum nicht mehr, sie sei vollstaendig.
 * Eine Spur, die genau auf der Grenze endet, gilt dabei als unvollstaendig;
 * das ist die vorsichtige Richtung und die einzige, die nie luegt.
 *
 * `replayedIntoMessageId` ist die Spur vorwaerts: Ist aus diesem Dead Letter
 * eine neue Nachricht entstanden, steht ihre Id hier, und ein zweiter Aufruf
 * liest deren Spur. `source` ist derselbe Schritt rueckwaerts.
 */
export type ProjectQueueTrace = Readonly<{
  messageId: string;
  queue: string;
  traceId: string | null;
  parentSpanId: string | null;
  sourceMessageId: string | null;
  replayedIntoMessageId: string | null;
  /** `false`, wenn die Nachricht selbst schon weggeraeumt ist. */
  messageExists: boolean;
  complete: boolean;
  stations: readonly ProjectQueueTraceEntry[];
}>;

/**
 * Die Mengengrenze je Nachricht, und die Rechnung dahinter.
 *
 * Eine Nachricht darf hoechstens zwanzigmal versucht werden (`max_attempts`
 * BETWEEN 1 AND 20 in 0026). Je Versuch entstehen hoechstens zwei Stationen:
 * `claimed` und genau ein Ausgang. Das sind vierzig. Dazu die erste Station,
 * `enqueued` oder `replayed`, also einundvierzig. So weit ist die Spur durch
 * die Queue selbst begrenzt und braucht keine Grenze von aussen.
 *
 * Genau eine Station ist das nicht: `deduplicated`. Sie entsteht, wenn ein
 * Aufrufer denselben Dedupe-Schluessel noch einmal schickt, und das darf er so
 * oft, wie er will. Ohne Grenze waechst die Spur **einer** Nachricht damit
 * unbegrenzt, waehrend die Nachricht selbst eine bleibt.
 *
 * 64 laesst damit dreiundzwanzig Dedupe-Treffer stehen, und das ist die
 * Groessenordnung, in der ein Mensch noch etwas erkennt ("es kommt dauernd
 * dasselbe"). Darueber hinaus sagt eine vierundzwanzigste Zeile nichts Neues,
 * und die Zahl, wie oft es insgesamt war, steht ohnehin im Metrics-Export.
 */
export const PROJECT_QUEUE_TRACE_MAX_STATIONS = 64;

/** Zeilen je Aufraeum-Anweisung. Eine Portion, nicht die ganze Tabelle. */
export const PROJECT_QUEUE_TRACE_PRUNE_BATCH = 500;

/**
 * Die kuerzeste Frist, die eine Spur haben darf: ein Betriebstag.
 *
 * Was am Morgen schiefging, hat am Abend noch seine Zeilen. Dieselbe Zahl und
 * dieselbe Begruendung wie beim Aufraeumer der Auth-Einmalartefakte.
 */
export const PROJECT_QUEUE_TRACE_MIN_RETENTION_SECONDS = 86_400;

/**
 * Wie lange eine Station steht, und woran die Zahl haengt.
 *
 * **Geschnitten wird am Ablauf der Station, nie am Ausgang der Nachricht.**
 * Der Ausgang ist der Verbrauch: Eine Nachricht, die gerade fehlgeschlagen
 * ist, ist der Gegenstand der Fehlersuche, die in diesem Augenblick anfaengt.
 * Wer an `completed_at` oder `dead_lettered_at` schneidet, nimmt genau die
 * Spur weg, die jemand sucht, und eine Nachricht ohne Stationen sieht aus wie
 * eine, fuer die nie welche geschrieben wurden. Jede Zeile traegt darum ihr
 * eigenes `expires_at`, und der Aufraeumer sieht nur darauf.
 *
 * **Die Untergrenze ist das Fenster, in dem die Zeile noch gebraucht wird**,
 * und das sind zwei Fenster uebereinander:
 *
 * 1. **So lange, wie die Nachricht selbst steht.** `cleanup()` loescht eine
 *    erledigte Nachricht erst `retention_seconds` nach ihrem Ausgang (0026,
 *    60 bis 604800 Sekunden). Waere die Spur kuerzer, zeigte die Console eine
 *    Nachricht, deren Spur schon weg ist, und der Betreiber schloesse daraus,
 *    dass nie Stationen geschrieben wurden. Darum nie kuerzer als die
 *    Aufbewahrung der Queue.
 * 2. **Mindestens einen Betriebstag**, auch bei einer Queue mit sechzig
 *    Sekunden Aufbewahrung. Die Spur ist nach Schritt eins das Einzige, was
 *    von der Nachricht uebrig ist; sie eine Minute nach dem Ausgang
 *    wegzunehmen hiesse, sie gar nicht zu schreiben.
 *
 * Laenger als das Maximum der Nachrichten-Aufbewahrung wird es nicht: Sieben
 * Tage ist die Obergrenze, die 0026 fuer eine Queue zulaesst, und eine Spur,
 * die laenger steht als jede Nachricht stehen darf, waere eine zweite
 * Aufbewahrung mit eigener Begruendung. Die gibt es hier nicht.
 */
export function projectQueueTraceRetentionSeconds(queue: Pick<ProjectQueue, "retentionSeconds">): number {
  return Math.max(PROJECT_QUEUE_TRACE_MIN_RETENTION_SECONDS, queue.retentionSeconds);
}

/** Der Ablauf einer Station, aus ihrem Zeitpunkt und der Frist ihrer Queue. */
export function projectQueueTraceExpiresAt(
  queue: Pick<ProjectQueue, "retentionSeconds">,
  occurredAt: Date,
): Date {
  return new Date(occurredAt.getTime() + projectQueueTraceRetentionSeconds(queue) * 1_000);
}

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;
const ZERO_TRACE = "0".repeat(32);
const ZERO_SPAN = "0".repeat(16);

/**
 * Liest einen `traceparent` nach W3C Trace Context.
 *
 * `null`, wenn der Kopf fehlt oder nicht passt, und zwar ohne Fehler: Ein
 * Beobachtungskopf ist kein Teil des Auftrags, und ein kaputter darf ein
 * Einreihen nicht umbringen. Genommen wird nur Version `00`; eine spaetere
 * Version darf nach der Spezifikation Felder anhaengen, aber was QKERN davon
 * haelt, weiss QKERN nicht, und eine geratene Spur-Id ist schlechter als
 * keine. Die beiden Nullspuren sind nach der Spezifikation ungueltig und
 * werden wie ein fehlender Kopf behandelt; `project_queue_message_traces`
 * weist sie zusaetzlich am CHECK ab.
 *
 * Gross geschriebenes Hex wird abgewiesen und nicht kleingeschrieben: Die
 * Spezifikation schreibt Kleinbuchstaben vor, und wer gross schickt, schickt
 * etwas anderes, als er glaubt.
 */
export function parseProjectQueueTraceparent(header: string | null | undefined): ProjectQueueTraceAnchor | null {
  if (typeof header !== "string") return null;
  const match = TRACEPARENT.exec(header.trim());
  if (!match) return null;
  const [, traceId, parentSpanId] = match;
  if (traceId === ZERO_TRACE || parentSpanId === ZERO_SPAN) return null;
  return Object.freeze({ traceId, parentSpanId });
}

/**
 * Schreibt einen Anschluss zurueck in die Kopfzeilenform.
 *
 * Die Flags stehen auf `01` (sampled): Eine Spur, die QKERN herausgibt, hat
 * Stationen, also ist sie aufgezeichnet. `00` zu melden hiesse, dem naechsten
 * Dienst zu sagen, es sei nichts aufgeschrieben, waehrend es das ist.
 */
export function formatProjectQueueTraceparent(anchor: ProjectQueueTraceAnchor): string {
  return `00-${anchor.traceId}-${anchor.parentSpanId}-01`;
}

/* Offen, und hier aufgeschrieben statt woanders behauptet:
 *
 * - **QKERN gibt keinen `traceparent` weiter.** Der Anschluss kommt herein und
 *   steht in der Spur; ein Worker, der eine Nachricht verarbeitet, bekommt ihn
 *   im Claim nicht mitgeliefert, und ein Webhook, der danach feuert, traegt ihn
 *   nicht. Das ist der naechste Schritt und nicht dieser: Er braucht eine
 *   eigene Span-Id je Station und damit eine Entscheidung darueber, wer in
 *   QKERN Spans erzeugt.
 * - **Es gibt keine Suche nach Spur-Id.** Gelesen wird je Nachricht. Eine
 *   Abfrage "alle Nachrichten dieser fremden Spur" braucht einen Index und
 *   eine Seitenform, und ohne einen Betreiber, der sie verlangt, waere beides
 *   geraten.
 */
