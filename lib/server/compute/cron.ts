import type { CronDefinition } from "@/lib/server/compute/model";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import type { ProjectQueueService } from "@/lib/server/project-queues/service";

/**
 * Fuenf-Feld-Cron in UTC — seit 1.87 die ganze klassische Grammatik.
 *
 * Bis 1.86 kannte QKERN nur `*\/N * * * *` und `M H * * *`. Jetzt gelten je
 * Feld `*`, `*\/N`, `a`, `a-b`, `a-b/N` und Listen daraus; Minute 0-59,
 * Stunde 0-23, Tag 1-31, Monat 1-12, Wochentag 0-7 (7 ist Sonntag wie 0).
 * Die klassische Regel fuer Tag und Wochentag: Sind **beide** eingeschraenkt,
 * genuegt einer von beiden; sonst zaehlt der eingeschraenkte. Namen (JAN,
 * MON) und Sonderformen (@daily, L, W, #) gibt es bewusst nicht — jede davon
 * waere eine zweite Grammatik, und die Release Note nennt sie als offen.
 */
type CronField = { values: Set<number>; restricted: boolean };
type CronSchedule = {
  minutes: number[]; hours: number[]; daysOfMonth: CronField; months: number[]; daysOfWeek: CronField;
};

const UNSUPPORTED = "Unsupported cron expression.";
const MAX_SEARCH_DAYS = 366 * 5;

export function parseCronExpression(expression: string): CronSchedule {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(UNSUPPORTED);
  const minutes = parseField(fields[0], 0, 59);
  const hours = parseField(fields[1], 0, 23);
  const daysOfMonth = parseField(fields[2], 1, 31);
  const months = parseField(fields[3], 1, 12);
  const daysOfWeek = parseField(fields[4], 0, 7);
  // 7 ist Sonntag — auf 0 gefaltet, damit die Menge eindeutig bleibt.
  if (daysOfWeek.values.has(7)) { daysOfWeek.values.delete(7); daysOfWeek.values.add(0); }
  return {
    minutes: [...minutes.values].sort((a, b) => a - b),
    hours: [...hours.values].sort((a, b) => a - b),
    daysOfMonth,
    months: [...months.values].sort((a, b) => a - b),
    daysOfWeek,
  };
}

function parseField(field: string, min: number, max: number): CronField {
  if (field.length < 1 || field.length > 64) throw new Error(UNSUPPORTED);
  const values = new Set<number>();
  let restricted = false;
  for (const part of field.split(",")) {
    const match = /^(\*|(\d{1,2})(?:-(\d{1,2}))?)(?:\/(\d{1,2}))?$/.exec(part);
    if (!match) throw new Error(UNSUPPORTED);
    const step = match[4] === undefined ? 1 : Number(match[4]);
    if (!Number.isInteger(step) || step < 1 || step > max) throw new Error(UNSUPPORTED);
    let start: number; let end: number;
    if (match[1] === "*") {
      start = min; end = max;
      if (step > 1) restricted = true;
    } else {
      start = Number(match[2]);
      end = match[3] === undefined ? (match[4] === undefined ? start : max) : Number(match[3]);
      if (start < min || start > max || end < min || end > max || end < start) throw new Error(UNSUPPORTED);
      restricted = true;
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  if (values.size === 0) throw new Error(UNSUPPORTED);
  return { values, restricted };
}

function dayMatches(schedule: CronSchedule, day: Date): boolean {
  if (!schedule.months.includes(day.getUTCMonth() + 1)) return false;
  const domOk = schedule.daysOfMonth.values.has(day.getUTCDate());
  const dowOk = schedule.daysOfWeek.values.has(day.getUTCDay());
  if (schedule.daysOfMonth.restricted && schedule.daysOfWeek.restricted) return domOk || dowOk;
  if (schedule.daysOfMonth.restricted) return domOk;
  if (schedule.daysOfWeek.restricted) return dowOk;
  return true;
}

/** Das erste Vorkommen **nach** `after`, minutengenau in UTC. */
export function nextCronOccurrence(expression: string, after: Date): Date {
  const schedule = parseCronExpression(expression);
  const cursor = new Date(after);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  const day = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()));
  for (let offset = 0; offset < MAX_SEARCH_DAYS; offset += 1) {
    if (dayMatches(schedule, day)) {
      const sameDay = offset === 0;
      for (const hour of schedule.hours) {
        if (sameDay && hour < cursor.getUTCHours()) continue;
        for (const minute of schedule.minutes) {
          if (sameDay && hour === cursor.getUTCHours() && minute < cursor.getUTCMinutes()) continue;
          return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute));
        }
      }
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  // Ein Ausdruck ohne Vorkommen in fuenf Jahren (z. B. 31 2 — den 31. Februar)
  // ist keine Planung, sondern ein Fehler.
  throw new Error(UNSUPPORTED);
}

/**
 * Der Dedupe-Schluessel eines Vorkommens: `cron:<id>:<zeitpunkt>`.
 *
 * Bis 2.42 stand diese Form nur hier im Aufruf des Dispatchers und ausserdem
 * in zwei Migrationskommentaren. Das Cron-Log liest die Queue ueber genau
 * diesen Schluessel wieder; damit es nicht an einer zweiten Schreibweise
 * scheitert, gibt es die Form jetzt einmal als Funktion, und der Dispatcher
 * benutzt sie selbst. Der Zeitpunkt ist ISO-8601 in UTC mit Millisekunden,
 * wie `Date.prototype.toISOString` ihn schreibt.
 */
export function cronOccurrenceDedupeKey(definitionId: string, scheduledAt: Date): string {
  return `cron:${definitionId}:${scheduledAt.toISOString()}`;
}

export class CronDispatcher {
  constructor(private readonly queues: Pick<ProjectQueueService, "enqueue">) {}

  async dispatch(
    definition: CronDefinition,
    scheduledAt: Date,
    principal: ProjectQueuePrincipal,
  ) {
    if (!definition.enabled || principal.role !== "service_role" ||
        principal.organizationId !== definition.organizationId ||
        nextCronOccurrence(definition.expression, new Date(scheduledAt.getTime() - 60_000)).getTime() !== scheduledAt.getTime()) {
      throw new Error("Cron dispatch is not authorized for this occurrence.");
    }
    const receipt = await this.queues.enqueue(principal, {
      organizationId: definition.organizationId,
      projectId: definition.projectId,
      environment: definition.environment,
    }, definition.queue, {
      payload: definition.payload,
      dedupeKey: cronOccurrenceDedupeKey(definition.id, scheduledAt),
      // Bewusst **kein** scheduledAt. Ein Vorkommen ist faellig, wenn es
      // ausgeloest wird; die Nachricht soll sofort verfuegbar sein. Wurde der
      // Zeitpunkt weitergereicht, wies die Queue jedes nachgeholte Vorkommen
      // ab: sie akzeptiert hoechstens fuenf Minuten Rueckdatierung, und ein
      // Rueckstand nach einem Ausfall ist aelter. Das Nachholen konnte damit
      // nie funktionieren. Die Identitaet des Vorkommens steckt im
      // Dedupe-Key, nicht in der Verfuegbarkeit.
    });
    return Object.freeze({
      status: receipt.deduplicated ? "already_dispatched" as const : "dispatched" as const,
      messageId: receipt.id,
      scheduledAt: scheduledAt.toISOString(),
    });
  }
}
