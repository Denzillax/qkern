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
 * **Und seit 2.124 laeuft er auch wieder hinaus.** 2.72.0 hat ihn nur
 * hereingelassen: Die Spur hoerte an der QKERN-Grenze auf, obwohl sie draussen
 * anfing und draussen weiterging. Ein Claim liefert jetzt einen `traceparent`
 * mit, der die Spur dieser Nachricht fortsetzt (`projectQueueClaimTraceparent`),
 * und eine ausgehende Webhook-Zustellung traegt ihn in ihren Kopfzeilen. Dafuer
 * braucht jede Station eine eigene Span-Id; wer sie erzeugt und warum sie in der
 * Datenbank steht, entscheidet Migration 0082 und begruendet es dort.
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
import { randomBytes } from "node:crypto";
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

/**
 * Eine Station, wie sie der Leser herausgibt. Kein Inhalt, nie.
 *
 * `spanId` ist die Span dieser Station, von QKERN erzeugt (2.124). Sie steht in
 * der Antwort, weil sie sonst unsichtbar waere: Der Claim gibt genau eine davon
 * als `traceparent` heraus, und ein Betreiber, der in seinem Collector eine
 * Span-Id sieht und wissen will, welche Station von QKERN sie war, hat ohne
 * diese Angabe keinen Weg zurueck. Woher sie kommt und warum sie nicht aus den
 * Koordinaten der Zeile abgeleitet wird, steht in Migration 0082.
 */
export type ProjectQueueTraceEntry = Readonly<{
  sequence: number;
  station: ProjectQueueTraceStation;
  attempt: number;
  workerId: string | null;
  failureCode: ProjectQueueFailureCode | null;
  spanId: string;
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
 *
 * Seit 2.124 ist das keine Behauptung mehr, sondern die Sampling-Entscheidung
 * dieses Dienstes, und sie steht in Migration 0082 mit ihrem Preis: Die Flags
 * des Aufrufers werden nicht gespeichert, wer draussen `00` setzt, bekommt
 * hinter QKERN `01`. Nach W3C beschreiben die Flags die Span, die im Kopf
 * **steht**, und das ist hier eine Station von QKERN. Die ist aufgezeichnet.
 */
export function formatProjectQueueTraceparent(anchor: ProjectQueueTraceAnchor): string {
  return `00-${anchor.traceId}-${anchor.parentSpanId}-01`;
}

/**
 * Eine neue Span-Id: acht Zufallsbytes in Kleinhex.
 *
 * Wer in QKERN Spans erzeugt, ist damit entschieden: QKERN selbst, einmal je
 * Station, beim Schreiben der Station. Die Begruendung in voller Laenge steht in
 * Migration 0082, inklusive der beiden verworfenen Alternativen (der Aufrufer
 * liefert sie mit; sie wird aus `message_id` und `sequence` abgeleitet).
 *
 * Die Nullspan wird ausgeschlossen und nicht erneut gewuerfelt: Sie ist einer von
 * 2^64 Werten, eine Wiederholung waere ein Zweig, den kein Fall je betritt, und
 * ein unbetretener Zweig ist eine Zusage ohne Beleg. Ein gesetztes Bit ist
 * genauso zufaellig wie der Rest und macht aus dem Wert keine Mustervorgabe.
 */
export function projectQueueTraceSpanId(): string {
  const bytes = randomBytes(8);
  if (bytes.every((byte) => byte === 0)) bytes[7] = 1;
  return bytes.toString("hex");
}

/**
 * Der `traceparent`, den ein Worker im Claim mitbekommt (2.124).
 *
 * **Die Fortsetzung, nicht die Wiederholung.** Spur-Id bleibt die der Nachricht,
 * also die, die von draussen kam. Der Eltern-Span ist aber **nicht** mehr der
 * Span des Aufrufers, sondern der der `claimed`-Station: Was der Worker jetzt
 * tut, haengt an der Abholung und nicht am Einreihen, und zwischen beiden liegt
 * im Zweifel eine Woche. Den Span des Aufrufers weiterzugeben hiesse, dem
 * Collector zu sagen, der Aufrufer habe den Worker gerufen; gerufen hat ihn der
 * Claim.
 *
 * `null`, wenn die Nachricht keinen Anschluss hat, und das ist die Haelfte der
 * Entscheidung, die 0082 begruendet: QKERN erfindet keine Spur-Id. Ein Worker,
 * der hier `null` bekommt, weiss damit etwas Wahres ("zu dieser Nachricht gibt
 * es keine Spur von draussen") statt etwas Erfundenes.
 *
 * `null` auch dann, wenn die Station gar nicht geschrieben wurde, weil die Spur
 * ihre Mengengrenze erreicht hat: Dann gibt es keine Span, an die sich jemand
 * haengen koennte, und eine Id fuer eine Zeile, die es nicht gibt, waere eine
 * Luege mit sechzehn Zeichen.
 */
export function projectQueueClaimTraceparent(
  traceId: string | null,
  stationSpanId: string | null,
): string | null {
  if (!traceId || !stationSpanId) return null;
  return formatProjectQueueTraceparent({ traceId, parentSpanId: stationSpanId });
}

/* Offen, und hier aufgeschrieben statt woanders behauptet:
 *
 * - **Es gibt keine Suche nach Spur-Id.** Gelesen wird je Nachricht. Eine
 *   Abfrage "alle Nachrichten dieser fremden Spur" braucht einen Index und
 *   eine Seitenform, und ohne einen Betreiber, der sie verlangt, waere beides
 *   geraten. Mit den Span-Ids aus 2.124 wird die Frage haeufiger werden, denn
 *   jetzt steht QKERN in fremden Spuren drin.
 * - **QKERN exportiert keine Spans.** Es erzeugt Span-Ids und gibt einen
 *   Anschluss heraus; es spricht kein OTLP und meldet nichts an einen
 *   Collector. Die Stationen bleiben in `project_queue_message_traces` und
 *   werden ueber die Trace-Route gelesen. Wer beide Seiten in einem Werkzeug
 *   sehen will, muss QKERN's Stationen dort selbst einspeisen.
 * - **Innerhalb einer Spur gibt es keine Span-Kanten.** Jede Station hat ihre
 *   eigene Span-Id, aber keine Zeile sagt, welche Station die Eltern der
 *   naechsten ist. Die Ordnung einer Spur ist `sequence`, und eine zweite
 *   Darstellung derselben Ordnung liefe irgendwann auseinander. Nach draussen
 *   gegeben wird genau eine Kante, die vom Claim zum Worker.
 * - **Ein ausgehender Webhook traegt den Anschluss, aber kein ausgelieferter
 *   Sammler setzt ihn.** Die Zustellung kann ihn fuehren (0082,
 *   `WebhookOutbox.enqueue`), und der Zusteller macht die Kopfzeile daraus.
 *   Wer ihn mitgeben koennte, hat ihn heute nicht: Die Datenbank-Bruecke liest
 *   einen Change Feed, der Dashboard-Sammler eine Audit-Kette, der
 *   Log-Drain-Sammler ein Protokoll. Keine dieser drei Quellen traegt einen
 *   `traceparent`. Das ist die naechste Luecke und sie steht hier, statt dass
 *   jemand sie fuer geschlossen haelt.
 * - **Der Function-Aufruf aus der Queue traegt ihn nicht.**
 *   `ProjectQueueFunctionDispatch` reicht die Nachricht an einen Sandbox-Port
 *   weiter, nicht an eine HTTP-Gegenstelle; ein `traceparent` muesste in den
 *   Aufrufvertrag der Sandbox, und der ist eine andere Grenze als diese.
 */
