import { describe, expect, it, vi } from "vitest";
import type { CronDefinition } from "@/lib/server/compute/model";
import { CronDispatcher, nextCronOccurrence } from "@/lib/server/compute/cron";
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
