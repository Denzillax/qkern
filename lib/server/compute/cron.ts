import type { CronDefinition } from "@/lib/server/compute/model";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import type { ProjectQueueService } from "@/lib/server/project-queues/service";

/**
 * Fuenf-Feld-Cron, seit 1.87 die ganze klassische Grammatik, seit 2.66 auch
 * Namen, `@`-Kuerzel, eine Zeitzone je Zeitplan und die Sonderformen `L`,
 * `W` und `#`.
 *
 * Je Feld gelten `*`, `*\/N`, `a`, `a-b`, `a-b/N` und Listen daraus; Minute
 * 0-59, Stunde 0-23, Tag 1-31, Monat 1-12, Wochentag 0-7 (7 ist Sonntag wie
 * 0). Im Monatsfeld stehen wahlweise JAN..DEC, im Wochentagsfeld SUN..SAT,
 * gross oder klein, auch in Bereichen und Listen (`MON-FRI`, `JAN,JUL`). Die
 * Kuerzel `@yearly @annually @monthly @weekly @daily @midnight @hourly` stehen
 * fuer je einen Fuenf-Feld-Ausdruck und werden vor dem Parsen ersetzt.
 * Die klassische Regel fuer Tag und Wochentag: Sind **beide** eingeschraenkt,
 * genuegt einer von beiden; sonst zaehlt der eingeschraenkte.
 *
 * Ohne Zeitzone rechnet alles in UTC, genau wie bis 2.65; dieser Pfad ist
 * unveraendert, damit kein bestehender Zeitplan nach dem Deploy ein anderes
 * Vorkommen und damit einen anderen Dedupe-Schluessel bekommt. Mit einer
 * IANA-Zeitzone werden die Felder als Wanduhr dieser Zone gelesen und jedes
 * Vorkommen in einen UTC-Zeitpunkt uebersetzt; die Rechnung macht `Intl`,
 * keine fremde Bibliothek. Sommerzeit wie bei Vixie-Cron: Ein Plan mit fester
 * Stunde (`30 2 * * *`) meint einen Termin am Tag. Gibt es die Wanduhrzeit
 * zweimal, zaehlt sie einmal, beim ersten Mal; gibt es sie nicht, feuert der
 * Plan in dem Moment, in dem die Uhr darueber hinwegspringt. Ein Plan ohne
 * feste Stunde (`*\/30 * * * *`) meint einen Takt und folgt der echten Zeit:
 * in der doppelten Stunde feuert er in beiden Durchgaengen, in der fehlenden
 * gibt es nichts nachzuholen.
 *
 * Die Sonderformen (2.66, Schritt d): im Tagesfeld `L` (letzter Tag des
 * Monats), `LW` (letzter Werktag) und `NW` (der Werktag, der dem N. am
 * naechsten liegt, im selben Monat); im Wochentagsfeld `NL` (der letzte
 * N-Wochentag des Monats) und `N#K` (der K. N-Wochentag). Jede davon steht
 * allein in ihrem Feld, ohne Liste; sie ist ein Praedikat ueber den Kalendertag
 * und keine Menge von Zahlen, und eine Liste daraus haette zwei Bedeutungen.
 */
type CronField = {
  values: Set<number>;
  restricted: boolean;
  /** Eine Sonderform (`L`, `W`, `#`), als Praedikat ueber den Kalendertag. */
  matches?: (day: Date) => boolean;
};
type CronSchedule = {
  minutes: number[]; hours: number[]; daysOfMonth: CronField; months: number[]; daysOfWeek: CronField;
  /** Ist die Stunde festgelegt? Entscheidet, wie ein Sommerzeitwechsel zaehlt. */
  hoursRestricted: boolean;
};

const UNSUPPORTED = "Unsupported cron expression.";
const UNSUPPORTED_TIME_ZONE = "Unsupported cron time zone.";
const MAX_SEARCH_DAYS = 366 * 5;
const MINUTE = 60_000;
const DAY = 86_400_000;

/** Die Zeitzone, in der jeder Zeitplan ohne eigene Angabe rechnet. */
export const CRON_DEFAULT_TIME_ZONE = "UTC";

const SHORTCUTS: Readonly<Record<string, string>> = Object.freeze({
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
});

const MONTH_NAMES: Readonly<Record<string, number>> = Object.freeze({
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
});
const WEEKDAY_NAMES: Readonly<Record<string, number>> = Object.freeze({
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
});

/** Die `@`-Kuerzel und wofuer sie stehen; fuer Doku und Console. */
export const CRON_SHORTCUTS: ReadonlyArray<readonly [string, string]> =
  Object.freeze(Object.entries(SHORTCUTS).map(([name, fields]) => Object.freeze([name, fields] as const)));

export function parseCronExpression(expression: string): CronSchedule {
  const trimmed = expression.trim();
  const expanded = trimmed.startsWith("@") ? SHORTCUTS[trimmed.toLowerCase()] : trimmed;
  if (expanded === undefined) throw new Error(UNSUPPORTED);
  const fields = expanded.split(/\s+/);
  if (fields.length !== 5) throw new Error(UNSUPPORTED);
  const minutes = parseField(fields[0], 0, 59);
  const hours = parseField(fields[1], 0, 23);
  const daysOfMonth = parseDayOfMonthSpecial(fields[2]) ?? parseField(fields[2], 1, 31);
  const months = parseField(fields[3], 1, 12, MONTH_NAMES);
  const daysOfWeek = parseDayOfWeekSpecial(fields[4]) ?? parseField(fields[4], 0, 7, WEEKDAY_NAMES);
  // 7 ist Sonntag, auf 0 gefaltet, damit die Menge eindeutig bleibt.
  if (daysOfWeek.values.has(7)) { daysOfWeek.values.delete(7); daysOfWeek.values.add(0); }
  return {
    minutes: [...minutes.values].sort((a, b) => a - b),
    hours: [...hours.values].sort((a, b) => a - b),
    daysOfMonth,
    months: [...months.values].sort((a, b) => a - b),
    daysOfWeek,
    hoursRestricted: hours.restricted,
  };
}

function parseField(
  field: string, min: number, max: number, names?: Readonly<Record<string, number>>,
): CronField {
  if (field.length < 1 || field.length > 64) throw new Error(UNSUPPORTED);
  const values = new Set<number>();
  let restricted = false;
  for (const part of field.split(",")) {
    const match = /^(\*|([0-9a-z]{1,3})(?:-([0-9a-z]{1,3}))?)(?:\/(\d{1,2}))?$/i.exec(part);
    if (!match) throw new Error(UNSUPPORTED);
    const step = match[4] === undefined ? 1 : Number(match[4]);
    if (!Number.isInteger(step) || step < 1 || step > max) throw new Error(UNSUPPORTED);
    let start: number; let end: number;
    if (match[1] === "*") {
      start = min; end = max;
      if (step > 1) restricted = true;
    } else {
      start = fieldValue(match[2], names);
      end = match[3] === undefined ? (match[4] === undefined ? start : max) : fieldValue(match[3], names);
      if (start < min || start > max || end < min || end > max || end < start) throw new Error(UNSUPPORTED);
      restricted = true;
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  if (values.size === 0) throw new Error(UNSUPPORTED);
  return { values, restricted };
}

function daysInMonth(day: Date): number {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
}

function isWeekday(dayOfWeek: number): boolean {
  return dayOfWeek >= 1 && dayOfWeek <= 5;
}

/**
 * Der Tag, an dem `NW` feuert: N selbst, wenn N ein Werktag ist; sonst der
 * naechste Werktag im selben Monat. Samstag heisst Freitag davor, Sonntag
 * heisst Montag danach, und am Monatsrand wird die Richtung gewechselt, damit
 * der Monat nicht verlassen wird.
 */
function nearestWeekday(target: number, day: Date): number | null {
  const length = daysInMonth(day);
  if (target > length) return null;
  const weekday = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), target)).getUTCDay();
  if (isWeekday(weekday)) return target;
  if (weekday === 6) return target === 1 ? 3 : target - 1;
  return target === length ? target - 2 : target + 1;
}

function special(matches: (day: Date) => boolean): CronField {
  return { values: new Set<number>(), restricted: true, matches };
}

/** `L`, `LW`, `NW` im Tagesfeld; sonst `null`, und das Feld wird gewoehnlich gelesen. */
function parseDayOfMonthSpecial(field: string): CronField | null {
  const upper = field.toUpperCase();
  if (upper === "L") return special((day) => day.getUTCDate() === daysInMonth(day));
  if (upper === "LW") {
    return special((day) => {
      const length = daysInMonth(day);
      const lastWeekday = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), length)).getUTCDay();
      const last = lastWeekday === 6 ? length - 1 : lastWeekday === 0 ? length - 2 : length;
      return day.getUTCDate() === last;
    });
  }
  const nearest = /^(\d{1,2})W$/i.exec(field);
  if (nearest !== null) {
    const target = Number(nearest[1]);
    if (target < 1 || target > 31) throw new Error(UNSUPPORTED);
    return special((day) => nearestWeekday(target, day) === day.getUTCDate());
  }
  if (/[LW]/i.test(field)) throw new Error(UNSUPPORTED);
  return null;
}

/** `NL` und `N#K` im Wochentagsfeld; sonst `null`. */
function parseDayOfWeekSpecial(field: string): CronField | null {
  const last = /^([0-7]|[a-z]{3})L$/i.exec(field);
  if (last !== null) {
    const weekday = fieldValue(last[1], WEEKDAY_NAMES) % 7;
    return special((day) => day.getUTCDay() === weekday && day.getUTCDate() + 7 > daysInMonth(day));
  }
  const nth = /^([0-7]|[a-z]{3})#([1-5])$/i.exec(field);
  if (nth !== null) {
    const weekday = fieldValue(nth[1], WEEKDAY_NAMES) % 7;
    const ordinal = Number(nth[2]);
    return special((day) => day.getUTCDay() === weekday && Math.ceil(day.getUTCDate() / 7) === ordinal);
  }
  if (/[L#]/i.test(field)) throw new Error(UNSUPPORTED);
  return null;
}

/** Eine Zahl, oder in Monat und Wochentag ein Name wie `JAN` oder `mon`. */
function fieldValue(token: string, names?: Readonly<Record<string, number>>): number {
  if (/^\d{1,2}$/.test(token)) return Number(token);
  const named = names?.[token.toLowerCase()];
  if (named === undefined) throw new Error(UNSUPPORTED);
  return named;
}

function dayMatches(schedule: CronSchedule, day: Date): boolean {
  if (!schedule.months.includes(day.getUTCMonth() + 1)) return false;
  const domOk = schedule.daysOfMonth.values.has(day.getUTCDate()) || (schedule.daysOfMonth.matches?.(day) ?? false);
  const dowOk = schedule.daysOfWeek.values.has(day.getUTCDay()) || (schedule.daysOfWeek.matches?.(day) ?? false);
  if (schedule.daysOfMonth.restricted && schedule.daysOfWeek.restricted) return domOk || dowOk;
  if (schedule.daysOfMonth.restricted) return domOk;
  if (schedule.daysOfWeek.restricted) return dowOk;
  return true;
}

/**
 * Prueft einen Zeitzonennamen und gibt ihn zurueck, wie er kam.
 *
 * Erlaubt ist, was `Intl` als Zeitzone kennt und wie ein IANA-Name aussieht
 * (`Europe/Berlin`, `America/New_York`, `UTC`). Ein Versatz wie `+02:00` ist
 * absichtlich keiner: Er wuerde die Sommerzeit gerade nicht mitnehmen, und
 * genau dafuer ist die Zeitzone da.
 */
export function validateCronTimeZone(timeZone: string): string {
  const trimmed = timeZone.trim();
  if (trimmed.length < 1 || trimmed.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(trimmed)) {
    throw new Error(UNSUPPORTED_TIME_ZONE);
  }
  try {
    zoneFormatter(trimmed);
  } catch {
    throw new Error(UNSUPPORTED_TIME_ZONE);
  }
  return trimmed;
}

function isUtc(timeZone: string | undefined): boolean {
  return timeZone === undefined || timeZone === CRON_DEFAULT_TIME_ZONE;
}

/**
 * Das erste Vorkommen **nach** `after`, minutengenau.
 *
 * Ohne `timeZone` (oder mit `UTC`) rechnet die Funktion wie bis 2.65 in UTC.
 * Mit einer Zeitzone ist das Ergebnis der UTC-Zeitpunkt, an dem die Wanduhr
 * dieser Zone den Ausdruck zum ersten Mal erfuellt.
 */
export function nextCronOccurrence(expression: string, after: Date, timeZone?: string): Date {
  const schedule = parseCronExpression(expression);
  if (!isUtc(timeZone)) return nextInZone(schedule, after, validateCronTimeZone(timeZone!));
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
  // Ein Ausdruck ohne Vorkommen in fuenf Jahren (z. B. 31 2, den 31. Februar)
  // ist keine Planung, sondern ein Fehler.
  throw new Error(UNSUPPORTED);
}

/*
 * Zeitzonenrechnung mit `Intl`.
 *
 * Eine Wanduhrzeit wird als "falsche UTC" gefuehrt: `Date.UTC(jahr, monat,
 * tag, stunde, minute)` der Wanduhrwerte. Kalenderfragen (Wochentag,
 * Monatslaenge) beantwortet dann `Date` selbst, und die Uebersetzung in den
 * echten Zeitpunkt ist eine Subtraktion des Versatzes. Der Versatz wird je
 * Wanduhrtag bestimmt: einmal deutlich vor dem Tag, einmal deutlich danach.
 * Sind beide gleich, gilt er fuer den ganzen Tag, und kein weiterer
 * `Intl`-Aufruf ist noetig. Sind sie verschieden, liegt an diesem Tag ein
 * Wechsel, und eine Suche findet den Zeitpunkt, an dem er eintritt.
 */
type ZoneDay = {
  /** Versatz (Wanduhr minus UTC, in ms) vor dem Wechsel; ohne Wechsel der einzige. */
  before: number;
  /** Versatz nach dem Wechsel; ohne Wechsel gleich `before`. */
  after: number;
  /** Der Zeitpunkt des Wechsels in UTC-ms, oder `null`, wenn es an dem Tag keinen gibt. */
  transition: number | null;
};

const formatters = new Map<string, Intl.DateTimeFormat>();
const zoneDays = new Map<string, ZoneDay>();
const ZONE_DAY_CACHE_LIMIT = 2_048;

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
    });
    if (formatters.size > 256) formatters.clear();
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Die Wanduhr der Zone zu einem Zeitpunkt, als "falsche UTC" in ms. */
function wallClockMs(timeZone: string, instantMs: number): number {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(instantMs));
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(read("year"), read("month") - 1, read("day"), read("hour") % 24, read("minute"), read("second"));
}

function offsetAt(timeZone: string, instantMs: number): number {
  return wallClockMs(timeZone, instantMs) - instantMs;
}

/** Versatz und Wechsel fuer den Wanduhrtag, der bei `dayMs` (falsche UTC) beginnt. */
function zoneDay(timeZone: string, dayMs: number): ZoneDay {
  const key = `${timeZone}:${dayMs}`;
  const cached = zoneDays.get(key);
  if (cached !== undefined) return cached;
  // Ein Wanduhrtag liegt als Zeitpunkte innerhalb von [dayMs - 14h, dayMs + 38h].
  // Einen Tag davor und zwei danach ist man in jedem Fall auf der jeweils
  // anderen Seite eines Wechsels, der in diesen Tag faellt.
  const before = offsetAt(timeZone, dayMs - DAY);
  const after = offsetAt(timeZone, dayMs + 2 * DAY);
  let transition: number | null = null;
  if (before !== after) {
    // Binaere Suche nach der ersten Minute mit dem neuen Versatz.
    let low = dayMs - DAY;
    let high = dayMs + 2 * DAY;
    while (high - low > MINUTE) {
      const middle = Math.floor((low + high) / 2 / MINUTE) * MINUTE;
      if (offsetAt(timeZone, middle) === before) low = middle; else high = middle;
    }
    transition = high;
  }
  const result: ZoneDay = { before, after, transition };
  if (zoneDays.size >= ZONE_DAY_CACHE_LIMIT) zoneDays.clear();
  zoneDays.set(key, result);
  return result;
}

/**
 * Die Zeitpunkte, an denen die Wanduhr `wallMs` zeigt, aufsteigend.
 *
 * Ohne Wechsel genau einer. Mit fester Stunde (`once`) ebenfalls genau einer:
 * bei doppelter Zeit der erste Durchgang, bei fehlender Zeit der Moment des
 * Sprungs, denn die Uhr zeigt dann schon eine spaetere Zeit, aber der Plan hat
 * seinen Termin nicht verloren. Ohne feste Stunde folgt der Plan der echten
 * Zeit: beide Durchgaenge einer doppelten Zeit, keiner fuer eine fehlende.
 */
function instantsOf(day: ZoneDay, wallMs: number, once: boolean): number[] {
  if (day.transition === null) return [wallMs - day.before];
  const early = wallMs - day.before;
  const late = wallMs - day.after;
  const earlyValid = early < day.transition;
  const lateValid = late >= day.transition;
  if (once) {
    if (earlyValid) return [early];
    if (lateValid) return [late];
    return [day.transition];
  }
  const instants: number[] = [];
  if (earlyValid) instants.push(early);
  if (lateValid) instants.push(late);
  return instants;
}

function nextInZone(schedule: CronSchedule, after: Date, timeZone: string): Date {
  const afterMs = after.getTime();
  // Die Suche beginnt am Wanduhrtag, an dem `after` in dieser Zone liegt. Ein
  // Wechsel um Mitternacht koennte den Tag davor betreffen; deshalb einen Tag
  // frueher anfangen, das kostet einen Durchlauf und keine Richtigkeit.
  const startWall = wallClockMs(timeZone, afterMs);
  let dayMs = Date.UTC(
    new Date(startWall).getUTCFullYear(), new Date(startWall).getUTCMonth(), new Date(startWall).getUTCDate(),
  ) - DAY;
  for (let offset = 0; offset < MAX_SEARCH_DAYS + 1; offset += 1) {
    const day = new Date(dayMs);
    if (dayMatches(schedule, day)) {
      const zone = zoneDay(timeZone, dayMs);
      // Innerhalb eines Tages mit Wechsel liegen die Zeitpunkte nicht in
      // Wanduhrreihenfolge (der zweite Durchgang von 02:00 kommt nach dem
      // ersten von 02:30). Deshalb das Minimum ueber den Tag, nicht der erste
      // Treffer.
      let best = Number.POSITIVE_INFINITY;
      for (const hour of schedule.hours) {
        for (const minute of schedule.minutes) {
          const wallMs = dayMs + hour * 3_600_000 + minute * MINUTE;
          for (const instant of instantsOf(zone, wallMs, schedule.hoursRestricted)) {
            if (instant > afterMs && instant < best) best = instant;
          }
        }
      }
      if (best !== Number.POSITIVE_INFINITY) return new Date(best);
    }
    dayMs += DAY;
  }
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
 * wie `Date.prototype.toISOString` ihn schreibt. Auch ein Zeitplan mit
 * Zeitzone traegt hier den UTC-Zeitpunkt: Der Schluessel haengt am Moment,
 * nicht an der Wanduhr.
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
        nextCronOccurrence(definition.expression, new Date(scheduledAt.getTime() - 60_000), definition.timeZone)
          .getTime() !== scheduledAt.getTime()) {
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
