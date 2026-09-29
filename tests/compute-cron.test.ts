import { describe, expect, it, vi } from "vitest";
import type { CronDefinition } from "@/lib/server/compute/model";
import {
  CronDispatcher, cronOccurrenceDedupeKey, nextCronOccurrence, validateCronTimeZone,
} from "@/lib/server/compute/cron";
import { MemoryProjectQueueRepository } from "@/lib/server/project-queues/repository";
import { ProjectQueueService } from "@/lib/server/project-queues/service";

const definition: CronDefinition = {
  organizationId: "org-compute", projectId: "project-compute", environment: "development",
  id: "cron-id", name: "hourly_sync", expression: "*/15 * * * *", queue: "jobs",
  payload: { task: "sync" }, enabled: true,
};

describe("Compute cron boundary", () => {
  it("computes deterministic UTC interval and daily occurrences", () => {
    expect(nextCronOccurrence("*/15 * * * *", new Date("2026-08-04T12:07:30Z")).toISOString())
      .toBe("2026-08-04T12:15:00.000Z");
    expect(nextCronOccurrence("30 2 * * *", new Date("2026-08-04T03:00:00Z")).toISOString())
      .toBe("2026-08-05T02:30:00.000Z");
    expect(() => nextCronOccurrence("60 * * * *", new Date())).toThrow("Unsupported cron");
  });

  /**
   * Die ganze Fuenf-Feld-Grammatik (1.87): Listen, Bereiche, Schritte, die
   * ODER-Regel fuer Tag und Wochentag, Monatsgrenzen ueber den Jahreswechsel.
   * Die Mutationsprobe dieses Releases nimmt die Bereichsform `a-b` heraus —
   * dann faellt genau dieser Fall (und sein Zwilling im Postgres-Stack).
   */
  it("evaluates lists, ranges, steps and the day-of-month/day-of-week rule", () => {
    const at = (expression: string, after: string) => nextCronOccurrence(expression, new Date(after)).toISOString();
    // Listen und Bereiche in Minute und Stunde.
    expect(at("0,30 6-8 * * *", "2026-08-04T06:31:00Z")).toBe("2026-08-04T07:00:00.000Z");
    expect(at("0,30 6-8 * * *", "2026-08-04T08:30:00Z")).toBe("2026-08-05T06:00:00.000Z");
    // Schritt ueber einen Bereich: 10-50/20 -> 10, 30, 50.
    expect(at("10-50/20 * * * *", "2026-08-04T12:31:00Z")).toBe("2026-08-04T12:50:00.000Z");
    // Nur Wochentage: Freitag 2026-08-07 -> Montag 2026-08-10.
    expect(at("0 9 * * 1-5", "2026-08-07T09:00:00Z")).toBe("2026-08-10T09:00:00.000Z");
    // 7 ist Sonntag wie 0.
    expect(at("0 9 * * 7", "2026-08-04T09:00:00Z")).toBe("2026-08-09T09:00:00.000Z");
    // Beide eingeschraenkt: der 15. ODER ein Montag — Montag 2026-08-10 kommt vor dem 15.
    expect(at("0 0 15 * 1", "2026-08-05T00:00:00Z")).toBe("2026-08-10T00:00:00.000Z");
    // Nur der Tag eingeschraenkt: 2026-08-15 ist ein Samstag und zaehlt trotzdem.
    expect(at("0 0 15 * *", "2026-08-05T00:00:00Z")).toBe("2026-08-15T00:00:00.000Z");
    // Monatsgrenze ueber den Jahreswechsel: 1. Januar 2027.
    expect(at("0 0 1 1 *", "2026-08-05T00:00:00Z")).toBe("2027-01-01T00:00:00.000Z");
    // Jede Minute ist gueltiges Cron.
    expect(at("* * * * *", "2026-08-04T12:07:30Z")).toBe("2026-08-04T12:08:00.000Z");
    // Ungueltig: Schritt 0, verkehrter Bereich, Feld ausserhalb, sechs Felder, nie erreichbar.
    for (const bad of ["*/0 * * * *", "5-1 * * * *", "0 24 * * *", "0 0 * * * *", "0 0 31 2 *", "a b c d e"]) {
      expect(() => nextCronOccurrence(bad, new Date("2026-08-04T00:00:00Z")), bad).toThrow("Unsupported cron");
    }
  });

  /**
   * Namen und Kuerzel (2.66). Ein Name ist dieselbe Zahl mit anderem Etikett:
   * `MON-FRI` muss genau die Vorkommen von `1-5` haben, und `@daily` genau die
   * von `0 0 * * *`. Die Mutationsprobe verschiebt einen Namen um eins; dann
   * fallen die Zwillingsvergleiche hier und der Fall im Postgres-Stack.
   */
  it("reads month and weekday names and the @ shortcuts as the numbers they stand for", () => {
    const at = (expression: string, after: string) => nextCronOccurrence(expression, new Date(after)).toISOString();
    const twins: Array<[string, string]> = [
      ["0 9 * * MON-FRI", "0 9 * * 1-5"],
      ["0 9 * * mon,wed,fri", "0 9 * * 1,3,5"],
      ["0 9 * * SUN", "0 9 * * 0"],
      ["0 9 * * SAT", "0 9 * * 6"],
      ["0 9 * * MON-FRI/2", "0 9 * * 1-5/2"],
      ["0 0 1 JAN *", "0 0 1 1 *"],
      ["0 0 1 jan,jul *", "0 0 1 1,7 *"],
      ["0 0 1 FEB-APR *", "0 0 1 2-4 *"],
      ["0 0 1 DEC *", "0 0 1 12 *"],
      ["0 0 15 * TUE", "0 0 15 * 2"],
      ["@yearly", "0 0 1 1 *"],
      ["@annually", "0 0 1 1 *"],
      ["@monthly", "0 0 1 * *"],
      ["@weekly", "0 0 * * 0"],
      ["@daily", "0 0 * * *"],
      ["@midnight", "0 0 * * *"],
      ["@hourly", "0 * * * *"],
      ["@DAILY", "0 0 * * *"],
      ["  @daily  ", "0 0 * * *"],
    ];
    for (const [named, numeric] of twins) {
      let cursor = "2026-08-04T12:07:30Z";
      for (let index = 0; index < 4; index += 1) {
        const expected = at(numeric, cursor);
        expect(at(named, cursor), `${named} nach ${cursor}`).toBe(expected);
        cursor = expected;
      }
    }
    // Ein paar feste Werte, damit die Zwillinge nicht beide falsch sein koennen.
    expect(at("0 9 * * MON-FRI", "2026-08-07T09:00:00Z")).toBe("2026-08-10T09:00:00.000Z");
    expect(at("0 0 1 JAN *", "2026-08-05T00:00:00Z")).toBe("2027-01-01T00:00:00.000Z");
    expect(at("@daily", "2026-08-04T12:07:30Z")).toBe("2026-08-05T00:00:00.000Z");
    expect(at("@weekly", "2026-08-04T12:07:30Z")).toBe("2026-08-09T00:00:00.000Z");
    expect(at("@hourly", "2026-08-04T12:07:30Z")).toBe("2026-08-04T13:00:00.000Z");
    // Namen nur im passenden Feld, Kuerzel nur allein, keine ausgeschriebenen Namen.
    for (const bad of [
      "0 9 JAN * *", "0 9 * * JAN", "0 9 * MON *", "MON * * * *", "0 SUN * * *",
      "0 9 * * MONDAY", "0 9 * * FRI-MON", "0 0 1 MAY-JAN *", "@daily * * * *", "@reboot", "@every",
      "@", "@yearly,@daily",
    ]) {
      expect(() => nextCronOccurrence(bad, new Date("2026-08-04T00:00:00Z")), bad).toThrow("Unsupported cron");
    }
  });

  /**
   * Eine Zeitzone je Zeitplan (2.66), gerechnet mit `Intl`.
   *
   * Europa/Berlin 2026: Die Uhr springt am 29. Maerz um 02:00 auf 03:00
   * (01:00Z) und am 25. Oktober von 03:00 auf 02:00 (01:00Z). Ein Plan mit
   * fester Stunde meint einen Termin am Tag: Die doppelte 02:30 zaehlt einmal,
   * die fehlende 02:30 feuert im Moment des Sprungs. Ein Takt ohne feste
   * Stunde folgt der echten Zeit. Die Mutationsprobe laesst die Zeitzone
   * ungelesen; dann fallen alle Erwartungen hier, die nicht auf UTC stehen.
   */
  it("reads the expression as the wall clock of the schedule's time zone, including both DST edges", () => {
    const at = (expression: string, after: string, zone: string) =>
      nextCronOccurrence(expression, new Date(after), zone).toISOString();
    // Sommer: 02:30 in Berlin ist 00:30Z.
    expect(at("30 2 * * *", "2026-08-04T03:00:00Z", "Europe/Berlin")).toBe("2026-08-05T00:30:00.000Z");
    // Winter: 02:30 in Berlin ist 01:30Z.
    expect(at("30 2 * * *", "2026-01-04T03:00:00Z", "Europe/Berlin")).toBe("2026-01-05T01:30:00.000Z");
    // Halbe Stunde Versatz.
    expect(at("0 9 * * *", "2026-08-04T03:30:00Z", "Asia/Kolkata")).toBe("2026-08-05T03:30:00.000Z");
    // Westlich von Greenwich, Wochentage nach der Wanduhr von New York: Montag
    // 9:00 EST ist 14:00Z, im Sommer 13:00Z.
    expect(at("0 9 * * MON-FRI", "2026-01-05T14:00:00Z", "America/New_York")).toBe("2026-01-06T14:00:00.000Z");
    expect(at("0 9 * * MON-FRI", "2026-07-03T13:00:00Z", "America/New_York")).toBe("2026-07-06T13:00:00.000Z");
    // Der Wanduhrtag endet nicht um 00:00Z: 23:30 in Auckland am 4. August ist 11:30Z.
    expect(at("30 23 * * *", "2026-08-04T00:00:00Z", "Pacific/Auckland")).toBe("2026-08-04T11:30:00.000Z");
    // UTC ausdruecklich ist derselbe Weg wie ohne Angabe.
    expect(at("30 2 * * *", "2026-08-04T03:00:00Z", "UTC")).toBe("2026-08-05T02:30:00.000Z");
    expect(at("30 2 * * *", "2026-08-04T03:00:00Z", "Etc/UTC")).toBe("2026-08-05T02:30:00.000Z");

    // Die Stunde, die es nicht gibt: 02:30 am 29. Maerz 2026 feuert um 01:00Z,
    // dem Moment, in dem die Uhr auf 03:00 springt. Danach wieder normal.
    expect(at("30 2 * * *", "2026-03-28T01:30:00Z", "Europe/Berlin")).toBe("2026-03-29T01:00:00.000Z");
    expect(at("30 2 * * *", "2026-03-29T01:00:00Z", "Europe/Berlin")).toBe("2026-03-30T00:30:00.000Z");
    // 03:00 an diesem Tag ist derselbe Moment; ein Plan auf 03:00 feuert genau einmal.
    expect(at("0 3 * * *", "2026-03-28T02:00:00Z", "Europe/Berlin")).toBe("2026-03-29T01:00:00.000Z");
    expect(at("0 3 * * *", "2026-03-29T01:00:00Z", "Europe/Berlin")).toBe("2026-03-30T01:00:00.000Z");

    // Die Stunde, die es zweimal gibt: 02:30 am 25. Oktober 2026 zaehlt einmal,
    // beim ersten Mal (00:30Z, noch Sommerzeit). Das zweite 02:30 (01:30Z)
    // ist kein Vorkommen.
    expect(at("30 2 * * *", "2026-10-24T00:30:00Z", "Europe/Berlin")).toBe("2026-10-25T00:30:00.000Z");
    expect(at("30 2 * * *", "2026-10-25T00:30:00Z", "Europe/Berlin")).toBe("2026-10-26T01:30:00.000Z");
    expect(at("30 2 * * *", "2026-10-25T01:00:00Z", "Europe/Berlin")).toBe("2026-10-26T01:30:00.000Z");

    // Ein Takt ohne feste Stunde folgt der echten Zeit: alle 30 Minuten durch
    // die doppelte Stunde hindurch, keine Pause, kein Doppel.
    const chain = (expression: string, from: string, zone: string, count: number) => {
      const out: string[] = [];
      let cursor = new Date(from);
      for (let index = 0; index < count; index += 1) {
        cursor = nextCronOccurrence(expression, cursor, zone);
        out.push(cursor.toISOString());
      }
      return out;
    };
    expect(chain("*/30 * * * *", "2026-10-24T23:45:00Z", "Europe/Berlin", 5)).toEqual([
      "2026-10-25T00:00:00.000Z", "2026-10-25T00:30:00.000Z", "2026-10-25T01:00:00.000Z",
      "2026-10-25T01:30:00.000Z", "2026-10-25T02:00:00.000Z",
    ]);
    // Und durch die fehlende Stunde: nichts nachzuholen, nichts verloren.
    expect(chain("*/30 * * * *", "2026-03-29T00:15:00Z", "Europe/Berlin", 4)).toEqual([
      "2026-03-29T00:30:00.000Z", "2026-03-29T01:00:00.000Z", "2026-03-29T01:30:00.000Z",
      "2026-03-29T02:00:00.000Z",
    ]);
    // Ein taeglicher Plan ueber beide Wechsel hinweg: genau ein Vorkommen je Tag.
    const days = chain("30 2 * * *", "2026-03-27T12:00:00Z", "Europe/Berlin", 4)
      .map((iso) => iso.slice(0, 10));
    expect(days).toEqual(["2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31"]);

    // Nur IANA-Namen, kein Versatz, kein Unsinn.
    expect(validateCronTimeZone("Europe/Berlin")).toBe("Europe/Berlin");
    expect(validateCronTimeZone(" UTC ")).toBe("UTC");
    for (const bad of ["+02:00", "Mars/Olympus", "", "CEST-1", "Europe/Berlin; DROP", "x".repeat(65)]) {
      expect(() => validateCronTimeZone(bad), bad).toThrow("Unsupported cron time zone");
      expect(() => nextCronOccurrence("0 9 * * *", new Date(), bad), bad).toThrow("Unsupported cron time zone");
    }
  });

  /**
   * Die Sonderformen (2.66, Schritt d): `L`, `LW`, `NW` im Tagesfeld, `NL` und
   * `N#K` im Wochentagsfeld. Alle Daten sind nachgerechnet: Der 1. August 2026
   * ist ein Samstag, der 31. ein Montag; der 31. Mai 2026 ein Sonntag; der
   * 15. November 2026 ein Sonntag; der 31. Oktober 2026 ein Samstag.
   */
  it("reads L, W and # as predicates over the calendar day", () => {
    const at = (expression: string, after: string, zone?: string) =>
      nextCronOccurrence(expression, new Date(after), zone).toISOString();
    // L: der letzte Tag des Monats, auch im Februar eines Schaltjahres.
    expect(at("0 0 L * *", "2026-02-10T00:00:00Z")).toBe("2026-02-28T00:00:00.000Z");
    expect(at("0 0 L * *", "2026-02-28T00:00:00Z")).toBe("2026-03-31T00:00:00.000Z");
    expect(at("0 0 L * *", "2028-02-10T00:00:00Z")).toBe("2028-02-29T00:00:00.000Z");
    expect(at("0 0 l * *", "2026-02-10T00:00:00Z")).toBe("2026-02-28T00:00:00.000Z");
    // LW: der letzte Werktag. August 2026 endet an einem Montag, Mai an einem Sonntag.
    expect(at("0 0 LW * *", "2026-08-01T00:00:00Z")).toBe("2026-08-31T00:00:00.000Z");
    expect(at("0 0 LW * *", "2026-05-01T00:00:00Z")).toBe("2026-05-29T00:00:00.000Z");
    // NW: der Werktag, der dem N. am naechsten liegt, ohne den Monat zu verlassen.
    expect(at("0 0 15W * *", "2026-08-01T00:00:00Z")).toBe("2026-08-14T00:00:00.000Z");
    expect(at("0 0 15W * *", "2026-11-01T00:00:00Z")).toBe("2026-11-16T00:00:00.000Z");
    expect(at("0 0 1W * *", "2026-07-31T12:00:00Z")).toBe("2026-08-03T00:00:00.000Z");
    expect(at("0 0 31W * *", "2026-10-01T00:00:00Z")).toBe("2026-10-30T00:00:00.000Z");
    expect(at("0 0 31W * *", "2026-05-01T00:00:00Z")).toBe("2026-05-29T00:00:00.000Z");
    // Ein 31W im Juni gibt es nicht; der naechste Treffer liegt im Juli.
    expect(at("0 0 31W * *", "2026-06-01T00:00:00Z")).toBe("2026-07-31T00:00:00.000Z");
    // NL: der letzte Freitag; N#K: der dritte Freitag, der fuenfte Montag.
    expect(at("0 0 * * 5L", "2026-08-01T00:00:00Z")).toBe("2026-08-28T00:00:00.000Z");
    expect(at("0 0 * * FRIL", "2026-08-01T00:00:00Z")).toBe("2026-08-28T00:00:00.000Z");
    expect(at("0 0 * * FRI#3", "2026-08-01T00:00:00Z")).toBe("2026-08-21T00:00:00.000Z");
    expect(at("0 0 * * 1#5", "2026-08-01T00:00:00Z")).toBe("2026-08-31T00:00:00.000Z");
    expect(at("0 0 * * MON#5", "2026-08-31T00:00:00Z")).toBe("2026-11-30T00:00:00.000Z");
    // Die ODER-Regel gilt auch hier: der 15. oder der letzte Freitag.
    expect(at("0 0 15 * 5L", "2026-08-15T00:00:00Z")).toBe("2026-08-28T00:00:00.000Z");
    // In einer Zeitzone: Mitternacht am letzten Tag des Monats in Berlin.
    expect(at("0 0 L * *", "2026-08-01T00:00:00Z", "Europe/Berlin")).toBe("2026-08-30T22:00:00.000Z");
    // Sonderformen stehen allein: keine Liste, kein falsches Feld, kein Unsinn.
    for (const bad of [
      "0 0 L,1 * *", "0 0 1-L * *", "L 0 * * *", "0 L * * *", "0 0 32W * *", "0 0 0W * *",
      "0 0 W * *", "0 0 * L *", "0 0 * * L", "0 0 * * 8L", "0 0 * * 5#6", "0 0 * * 5#0",
      "0 0 * * 5L,1", "0 0 * * #3", "0 0 * * MONDAYL", "0 0 LW,1 * *",
    ]) {
      expect(() => nextCronOccurrence(bad, new Date("2026-08-04T00:00:00Z")), bad).toThrow("Unsupported cron");
    }
  });

  /**
   * Der Beweis, dass kein bestehender Zeitplan nach dem Deploy doppelt feuert.
   *
   * Diese Schluessel wurden mit dem Parser von 2.65.0 (Commit 9e01d31)
   * berechnet, **bevor** Namen, Kuerzel und Zeitzone dazukamen, und stehen
   * hier als Konstanten. Ein Zeitplan ohne Zeitzone muss dieselben Vorkommen
   * und damit dieselben Schluessel liefern; sonst waere jedes vorhandene
   * Vorkommen fuer die Queue ein neues.
   */
  it("keeps the dedupe key of every pre-2.66 expression identical to the recorded value", () => {
    const id = "2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90";
    const recorded: Array<[string, string, string[]]> = [
      ["*/15 * * * *", "2026-08-04T12:07:30Z", ["cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2026-08-04T12:15:00.000Z", "cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2026-08-04T12:30:00.000Z", "cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2026-08-04T12:45:00.000Z"]],
      ["30 2 * * *", "2026-08-04T03:00:00Z", ["cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2026-08-05T02:30:00.000Z", "cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2026-08-06T02:30:00.000Z", "cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2026-08-07T02:30:00.000Z"]],
      ["0,30 6-8 * * 1-5", "2026-08-07T08:30:00Z", ["cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2026-08-10T06:00:00.000Z", "cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2026-08-10T06:30:00.000Z", "cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2026-08-10T07:00:00.000Z"]],
      ["0 0 15 * 1", "2026-08-05T00:00:00Z", ["cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2026-08-10T00:00:00.000Z", "cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2026-08-15T00:00:00.000Z", "cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2026-08-17T00:00:00.000Z"]],
      ["0 0 1 1 *", "2026-08-05T00:00:00Z", ["cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2027-01-01T00:00:00.000Z", "cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2028-01-01T00:00:00.000Z", "cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2029-01-01T00:00:00.000Z"]],
      ["0 9 * * 7", "2026-08-04T09:00:00Z", ["cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2026-08-09T09:00:00.000Z", "cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2026-08-16T09:00:00.000Z", "cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2026-08-23T09:00:00.000Z"]],
      ["10-50/20 * * * *", "2026-08-04T12:31:00Z", ["cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2026-08-04T12:50:00.000Z", "cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2026-08-04T13:10:00.000Z", "cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2026-08-04T13:30:00.000Z"]],
      ["* * * * *", "2026-12-31T23:59:30Z", ["cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2027-01-01T00:00:00.000Z", "cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2027-01-01T00:01:00.000Z", "cron:2d9d0b4e-7c1e-4d2a-9a6b-3f7e5c1a8b90:2027-01-01T00:02:00.000Z"]],
    ];
    for (const [expression, after, keys] of recorded) {
      // Wie eine gespeicherte Definition von vor 2.66: ohne Zeitzone, und
      // mit dem Vorgabewert der Migration, beides muss dasselbe ergeben.
      for (const zone of [undefined, "UTC"]) {
        let cursor = new Date(after);
        const computed: string[] = [];
        for (let index = 0; index < 3; index += 1) {
          cursor = nextCronOccurrence(expression, cursor, zone);
          computed.push(cronOccurrenceDedupeKey(id, cursor));
        }
        expect(computed, `${expression} (${zone ?? "ohne Zone"})`).toEqual(keys);
      }
    }
  });

  it("dispatches a zoned occurrence and refuses the UTC reading of the same wall clock", async () => {
    const enqueue = vi.fn(async () => ({ id: "message-id", deduplicated: false }));
    const zoned: CronDefinition = { ...definition, expression: "30 2 * * *", timeZone: "Europe/Berlin" };
    const principal = {
      organizationId: definition.organizationId, actorRef: "service:cron",
      role: "service_role" as const, subject: "cron",
    };
    // 02:30 Berlin im August ist 00:30Z; genau das ist das Vorkommen.
    const scheduledAt = new Date("2026-08-05T00:30:00.000Z");
    await expect(new CronDispatcher({ enqueue } as never).dispatch(zoned, scheduledAt, principal))
      .resolves.toMatchObject({ status: "dispatched" });
    const call = enqueue.mock.calls[0] as unknown as [unknown, unknown, unknown, Record<string, unknown>];
    // Der Schluessel traegt den UTC-Moment, nicht die Wanduhr.
    expect(call[3]).toMatchObject({ dedupeKey: `cron:${definition.id}:2026-08-05T00:30:00.000Z` });
    // 02:30Z waere die UTC-Lesart desselben Ausdrucks; fuer diesen Plan ist es kein Vorkommen.
    await expect(new CronDispatcher({ enqueue } as never).dispatch(zoned, new Date("2026-08-05T02:30:00.000Z"), principal))
      .rejects.toThrow("not authorized");
  });

  it("dispatches one deterministic queue dedupe key for an exact occurrence", async () => {
    const enqueue = vi.fn(async () => ({ id: "message-id", deduplicated: false }));
    const scheduledAt = new Date("2026-08-04T12:15:00.000Z");
    await expect(new CronDispatcher({ enqueue } as never).dispatch(definition, scheduledAt, {
      organizationId: definition.organizationId, actorRef: "service:cron", role: "service_role", subject: "cron",
    })).resolves.toEqual({ status: "dispatched", messageId: "message-id", scheduledAt: scheduledAt.toISOString() });
    const call = enqueue.mock.calls[0] as unknown as [unknown, unknown, unknown, Record<string, unknown>];
    expect(call[3]).toMatchObject({
      dedupeKey: `cron:${definition.id}:${scheduledAt.toISOString()}`,
    });
    // Der Vorkommenszeitpunkt darf **nicht** als Zustellzeit weitergereicht
    // werden. Die Queue akzeptiert hoechstens fuenf Minuten Rueckdatierung; ein
    // nachgeholtes Vorkommen ist aelter und wurde bis Release 1.18
    // ausnahmslos abgewiesen. Die Identitaet steckt im Dedupe-Key.
    expect(call[3]).not.toHaveProperty("scheduledAt");
  });

  /**
   * Eine Queue ohne Dedupe-Fenster hat bis 2.43 jedes Vorkommen scheitern
   * lassen: Der Dispatcher reicht immer einen Dedupe-Key, die Queue schrieb
   * den Verifikator ohne Frist, und der CHECK aus 0026 wies die Zeile ab. Der
   * Cron-Job sah aus, als liefe er, und reihte nie etwas ein.
   *
   * Jetzt laeuft er, ohne Schutz vor einer zweiten Nachricht, denn genau das
   * heisst ein Fenster von null. Die Zusage "Crash/Retry erzeugt keine zweite
   * Nachricht" gilt nur mit einem Fenster groesser null.
   */
  it("dispatches into a queue without a dedupe window and no longer promises uniqueness", async () => {
    const queues = new ProjectQueueService({ repository: new MemoryProjectQueueRepository() });
    const scope = {
      organizationId: definition.organizationId, projectId: definition.projectId,
      environment: definition.environment,
    };
    const admin = {
      organizationId: definition.organizationId, actorRef: "admin:cron",
      role: "admin" as const, subject: "admin",
    };
    const service = {
      organizationId: definition.organizationId, actorRef: "service:cron",
      role: "service_role" as const, subject: "cron",
    };
    await queues.createQueue(admin, scope, { name: definition.queue, dedupeWindowSeconds: 0 });
    const dispatcher = new CronDispatcher(queues);
    const scheduledAt = new Date("2026-08-04T12:15:00.000Z");

    const first = await dispatcher.dispatch(definition, scheduledAt, service);
    expect(first.status).toBe("dispatched");
    const second = await dispatcher.dispatch(definition, scheduledAt, service);
    expect(second.status).toBe("dispatched");
    expect(second.messageId).not.toBe(first.messageId);

    // Mit Fenster bleibt die Zusage: dasselbe Vorkommen, dieselbe Nachricht.
    await queues.createQueue(admin, scope, { name: "guarded", dedupeWindowSeconds: 3_600 });
    const guarded = { ...definition, queue: "guarded" };
    const once = await dispatcher.dispatch(guarded, scheduledAt, service);
    const again = await dispatcher.dispatch(guarded, scheduledAt, service);
    expect(again).toMatchObject({ status: "already_dispatched", messageId: once.messageId });
  });

  it("rejects a non-occurrence and a cross-tenant scheduler", async () => {
    const dispatcher = new CronDispatcher({ enqueue: vi.fn() } as never);
    const principal = { organizationId: definition.organizationId, actorRef: "service:cron", role: "service_role" as const, subject: "cron" };
    await expect(dispatcher.dispatch(definition, new Date("2026-08-04T12:16:00Z"), principal)).rejects.toThrow("not authorized");
    await expect(dispatcher.dispatch(definition, new Date("2026-08-04T12:15:00Z"), {
      ...principal, organizationId: "org-other",
    })).rejects.toThrow("not authorized");
  });
});
