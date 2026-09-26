import { cronOccurrenceDedupeKey, nextCronOccurrence } from "@/lib/server/compute/cron";
import { projectQueueDedupeKeyHash } from "@/lib/server/project-queues/service";

/**
 * Das Cron-Log (2.42) — zusammengesetzt, nicht aufgezeichnet.
 *
 * QKERN schreibt kein Protokoll je Cron-Lauf. Es gibt nur zwei Tatsachen: den
 * Ausdruck der Definition und die Nachrichten der Queue. Die Bruecke zwischen
 * beiden ist der Dedupe-Schluessel `cron:<id>:<zeitpunkt>`, den der Dispatcher
 * beim Einreihen setzt; die Queue speichert davon nur `dedupe_key_hash`
 * (sha256 hex). Also: erwartete Vorkommen aus dem Ausdruck rechnen, je
 * Vorkommen denselben Schluessel bilden, denselben Verifikator bilden, und die
 * gefundene Nachricht daneben stellen.
 *
 * Diese Rekonstruktion hat Grenzen, und sie werden benannt statt verschwiegen:
 *
 * - Ein Vorkommen **vor** dem Anlegen der Definition wurde nie ausgeloest. Der
 *   Scheduler holt fuer eine neue Definition nichts nach.
 * - Nach Ablauf des Dedupe-Fensters setzt die Queue `dedupe_key_hash` auf NULL
 *   (Migration 0026). Ein aelteres Vorkommen ist danach nicht mehr auffindbar,
 *   auch wenn seine Nachricht noch liegt. Abwesenheit beweist dort nichts.
 * - Ein geaenderter Ausdruck ist nicht ausdrueckbar: Ausdruck und Queue sind
 *   unveraenderlich (0031), eine Aenderung ist Loeschen und Neuanlegen. Die
 *   alten Vorkommen gehoeren dann zur alten Id und damit zu einem anderen Log.
 *
 * Deshalb vier Zustaende und nicht zwei. `expected` ist der ehrliche: Das
 * Vorkommen gehoert zum Plan, aber sein Ausgang laesst sich aus den zwei
 * Tatsachen nicht rekonstruieren.
 */

/** Nutzlast, Dedupe-Schluessel und Nachrichten-Id bleiben ausdruecklich draussen. */
export type CronOccurrenceMessageState = "pending" | "in_flight" | "done" | "dead_letter";

export type CronOccurrenceStatus = "found" | "missing" | "not_yet_due" | "expected";

/** Die Nachricht zu einem Vorkommen, ohne alles, was Kundendaten traegt. */
export type CronOccurrenceMessage = Readonly<{
  state: CronOccurrenceMessageState;
  attempts: number;
  enqueuedAt: string;
  /** Abschluss: erledigt oder ins Dead Letter gelegt. Sonst `null`. */
  settledAt: string | null;
}>;

export type CronOccurrenceRecord = Readonly<{
  occurredAt: string;
  status: CronOccurrenceStatus;
  message: CronOccurrenceMessage | null;
}>;

export type CronOccurrenceLog = Readonly<{
  cronId: string;
  name: string;
  expression: string;
  queue: string;
  enabled: boolean;
  createdAt: string;
  /** Der gezeigte Abschnitt und die Obergrenze, beides in der Antwort. */
  window: Readonly<{ from: string; to: string; maxOccurrences: number; queueFound: boolean }>;
  counts: Readonly<{ found: number; missing: number; notYetDue: number; expected: number }>;
  occurrences: readonly CronOccurrenceRecord[];
}>;

/** Die letzten 24 Stunden. */
export const CRON_OCCURRENCE_WINDOW_SECONDS = 24 * 60 * 60;
/** Hoechstens so viele Vorkommen, neueste zuerst. */
export const CRON_OCCURRENCE_LIMIT = 50;
/**
 * Die naechste Stunde kommt mit ins Fenster, damit die Ansicht zeigt, was als
 * Naechstes ansteht, ohne dass ein Betreiber rechnen muss.
 */
export const CRON_OCCURRENCE_LOOKAHEAD_SECONDS = 60 * 60;
/**
 * Ein gerade eben vergangenes Vorkommen ist keine Luecke.
 *
 * Der Dispatcher laeuft im Intervall (Vorgabe im Compute-Prozess: Sekunden bis
 * Minuten), und die Uhr der Console ist nicht die Uhr des Schedulers. Ohne
 * Karenz meldete das Log bei jedem Aufruf ein "fehlt", das eine Minute spaeter
 * verschwindet. Fuenf Minuten sind grosszuegig und immer noch kurz gegen den
 * kuerzesten Takt, den ein Cron-Ausdruck kennt, naemlich eine Minute.
 */
export const CRON_OCCURRENCE_GRACE_SECONDS = 300;
/**
 * Harte Obergrenze der Aufzaehlung. Ein Minutentakt ergibt im Fenster rund
 * 1500 Vorkommen; die Grenze schuetzt vor einem Ausdruck, der mehr erzeugt,
 * als je gezeigt wird.
 */
const MAX_ENUMERATED = 2_000;

export type CronOccurrenceCandidate = Readonly<{ occurredAt: Date; dedupeKeyHash: string }>;

/**
 * Die erwarteten Vorkommen im Fenster, neueste zuerst, hoechstens `limit`.
 *
 * Aufgezaehlt wird mit **demselben** Parser, den der Scheduler benutzt, und der
 * Verifikator kommt aus demselben Modul wie beim Einreihen. Zwei Parser oder
 * zwei Hashes waeren zwei Wahrheiten.
 */
export function cronOccurrenceCandidates(definition: { id: string; expression: string }, window: {
  from: Date; to: Date; limit: number;
}): CronOccurrenceCandidate[] {
  const times: Date[] = [];
  // `nextCronOccurrence` liefert das erste Vorkommen **nach** dem Zeitpunkt,
  // deshalb beginnt die Suche eine Minute vor dem Fensteranfang: ein Vorkommen
  // genau auf `from` gehoert dazu.
  let cursor = new Date(window.from.getTime() - 60_000);
  for (let index = 0; index < MAX_ENUMERATED; index += 1) {
    const next = nextCronOccurrence(definition.expression, cursor);
    if (next.getTime() > window.to.getTime()) break;
    times.push(next);
    cursor = next;
  }
  return times
    .sort((left, right) => right.getTime() - left.getTime())
    .slice(0, Math.max(0, window.limit))
    .map((occurredAt) => Object.freeze({
      occurredAt,
      dedupeKeyHash: projectQueueDedupeKeyHash(cronOccurrenceDedupeKey(definition.id, occurredAt)),
    }));
}

/** Eine gefundene Nachricht, wie das Repository sie liefert. */
export type CronOccurrenceMessageRow = {
  dedupeKeyHash: string;
  state: CronOccurrenceMessageState;
  attempts: number;
  enqueuedAt: Date;
  settledAt: Date | null;
};

export type CronOccurrenceLogInput = {
  definition: {
    id: string; name: string; expression: string; queue: string; enabled: boolean;
    createdAt: Date;
  };
  candidates: readonly CronOccurrenceCandidate[];
  messages: readonly CronOccurrenceMessageRow[];
  now: Date;
  from: Date;
  to: Date;
  limit: number;
  /** Das Dedupe-Fenster der Zielqueue in Sekunden, oder `null`, wenn es sie nicht gibt. */
  dedupeWindowSeconds: number | null;
};

/** Setzt das Log zusammen. Rein: keine Datenbank, keine Uhr, keine Sprache. */
export function buildCronOccurrenceLog(input: CronOccurrenceLogInput): CronOccurrenceLog {
  const byHash = new Map<string, CronOccurrenceMessageRow>();
  for (const message of input.messages) {
    if (!byHash.has(message.dedupeKeyHash)) byHash.set(message.dedupeKeyHash, message);
  }
  const counts = { found: 0, missing: 0, notYetDue: 0, expected: 0 };
  const occurrences = input.candidates.map((candidate) => {
    const message = byHash.get(candidate.dedupeKeyHash) ?? null;
    const status = occurrenceStatus(candidate.occurredAt, message !== null, input);
    if (status === "found") counts.found += 1;
    else if (status === "missing") counts.missing += 1;
    else if (status === "not_yet_due") counts.notYetDue += 1;
    else counts.expected += 1;
    return Object.freeze({
      occurredAt: candidate.occurredAt.toISOString(),
      status,
      message: message === null ? null : Object.freeze({
        state: message.state,
        attempts: message.attempts,
        enqueuedAt: message.enqueuedAt.toISOString(),
        settledAt: message.settledAt === null ? null : message.settledAt.toISOString(),
      }),
    });
  });

  return Object.freeze({
    cronId: input.definition.id,
    name: input.definition.name,
    expression: input.definition.expression,
    queue: input.definition.queue,
    enabled: input.definition.enabled,
    createdAt: input.definition.createdAt.toISOString(),
    window: Object.freeze({
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      maxOccurrences: input.limit,
      queueFound: input.dedupeWindowSeconds !== null,
    }),
    counts: Object.freeze(counts),
    occurrences: Object.freeze(occurrences),
  });
}

function occurrenceStatus(
  occurredAt: Date,
  hasMessage: boolean,
  input: Pick<CronOccurrenceLogInput, "definition" | "now" | "dedupeWindowSeconds">,
): CronOccurrenceStatus {
  // Eine gefundene Nachricht schlaegt jede Ueberlegung: sie ist die Tatsache.
  if (hasMessage) return "found";
  const time = occurredAt.getTime();
  if (time > input.now.getTime() - CRON_OCCURRENCE_GRACE_SECONDS * 1_000) return "not_yet_due";
  if (time < input.definition.createdAt.getTime()) return "expected";
  if (input.dedupeWindowSeconds !== null &&
      time + input.dedupeWindowSeconds * 1_000 <= input.now.getTime()) {
    // Das Dedupe-Fenster ist abgelaufen; die Queue hat den Verifikator
    // geloescht. Ob eingereiht wurde, ist von hier aus nicht mehr zu sehen.
    return "expected";
  }
  return "missing";
}
