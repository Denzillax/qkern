import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Environment } from "@/lib/types";
import type { ProjectDatabaseBackupRecord } from "@/lib/server/backup/project-database";
import {
  ProjectDatabaseBackupScheduler,
  type ProjectDatabaseBackupSchedule,
  type ProjectDatabaseBackupScheduleStore,
} from "@/lib/server/backup/project-database-schedule";

/**
 * Der Zeitplan, ohne Datenbank (2.129).
 *
 * Was hier geprueft wird, sind die drei Entscheidungen aus
 * `project-database-schedule.ts`: es entsteht kein zweiter Auftrag, der Takt
 * laeuft trotzdem weiter und zaehlt, und `pruneExpired` hat einen Aufrufer.
 * Was eine echte Datenbank braucht -- die Anweisung, die faellige Zeilen holt
 * **und** fortschreibt, und dass zwei Wirte sich nicht in die Quere kommen --
 * steht im Fall `(2.130)`.
 */

const organizationId = randomUUID();
const projectId = randomUUID();

/**
 * Eine Haelfte des Zeitplan-Katalogs. `claimDue` schreibt fort, bevor es
 * zurueckgibt, genau wie die Anweisung in PostgreSQL.
 */
class MemoryScheduleStore implements ProjectDatabaseBackupScheduleStore {
  readonly rows: ProjectDatabaseBackupSchedule[] = [];
  readonly ticks: { backupId: string; busy: boolean }[] = [];

  constructor(rows: readonly Partial<ProjectDatabaseBackupSchedule>[]) {
    for (const row of rows) {
      this.rows.push(Object.freeze({
        organizationId,
        projectId,
        environment: "production" as Environment,
        enabled: true,
        intervalHours: 24,
        retentionDays: 30,
        nextDueAt: new Date("2026-10-01T00:00:00.000Z"),
        lastEnqueuedAt: null,
        lastBackupId: null,
        busyCount: 0,
        databaseInstanceRef: "managed:schedule-one",
        ...row,
      }));
    }
  }

  async claimDue(now: Date, limit: number) {
    const due = this.rows
      .filter((row) => row.enabled && row.nextDueAt.getTime() <= now.getTime())
      .slice(0, limit);
    for (const row of due) {
      const index = this.rows.indexOf(row);
      this.rows[index] = Object.freeze({
        ...row,
        nextDueAt: new Date(now.getTime() + row.intervalHours * 3_600_000),
      });
    }
    return due;
  }

  async recordTick(
    key: Readonly<{ projectId: string; environment: Environment }>,
    outcome: Readonly<{ backupId: string; busy: boolean; at: Date }>,
  ) {
    this.ticks.push({ backupId: outcome.backupId, busy: outcome.busy });
    const index = this.rows.findIndex((row) =>
      row.projectId === key.projectId && row.environment === key.environment);
    if (index < 0) return;
    this.rows[index] = Object.freeze({
      ...this.rows[index],
      lastEnqueuedAt: outcome.at,
      lastBackupId: outcome.backupId,
      busyCount: this.rows[index].busyCount + (outcome.busy ? 1 : 0),
    });
  }

  async get(key: Readonly<{ projectId: string; environment: Environment }>) {
    return this.rows.find((row) =>
      row.projectId === key.projectId && row.environment === key.environment) ?? null;
  }
}

function record(id: string, status: ProjectDatabaseBackupRecord["status"], createdAt: Date) {
  return Object.freeze({
    id, organizationId, projectId, environment: "production" as Environment,
    databaseInstanceRef: "managed:schedule-one", status,
    objectKey: null, artifactSha256: null, sizeBytes: null, wrappedDataKey: null, keyId: null,
    manifestSha256: null, includes: [], artifactFormat: "chunked" as const,
    partCount: null, partPlaintextBytes: null,
    restoreStatus: null, restoreRequestedAt: null, restoreRequestedBy: null,
    restoreDatabaseName: null, restoreCompletedAt: null, restoreErrorCode: null,
    snapshotAt: null, completedAt: null, expiresAt: null,
    attemptCount: 0, maxAttempts: 3, lastErrorCode: null, createdAt,
  }) as ProjectDatabaseBackupRecord;
}

describe("Der Zeitplan eines Projektdatenbank-Backups (2.129)", () => {
  it("stellt einen faelligen Auftrag ein und schreibt den Takt fort", async () => {
    const now = new Date("2026-10-01T06:00:00.000Z");
    const store = new MemoryScheduleStore([{}]);
    const created = record(randomUUID(), "pending", now);
    const scheduler = new ProjectDatabaseBackupScheduler({
      store,
      target: { enqueueBackup: async () => ({ record: created, created: true }), pruneExpired: async () => 0 },
      now: () => now,
    });
    expect(await scheduler.tick()).toMatchObject({ due: 1, enqueued: 1, busy: 0, failed: 0 });
    expect(store.ticks).toEqual([{ backupId: created.id, busy: false }]);
    expect(store.rows[0].nextDueAt.toISOString()).toBe("2026-10-02T06:00:00.000Z");
  });

  it("stellt keinen zweiten Auftrag ein, zaehlt es in der Zeile und laeuft trotzdem weiter",
    async () => {
      // Der vorige Auftrag laeuft noch. `enqueue` gibt ihn zurueck, statt einen
      // zweiten anzulegen (0083), und der Takt erkennt das an der Id.
      const now = new Date("2026-10-02T06:00:00.000Z");
      const running = record(randomUUID(), "running", new Date("2026-10-01T06:00:00.000Z"));
      const store = new MemoryScheduleStore([{
        lastBackupId: running.id,
        lastEnqueuedAt: new Date("2026-10-01T06:00:00.000Z"),
      }]);
      const scheduler = new ProjectDatabaseBackupScheduler({
        store,
        target: { enqueueBackup: async () => ({ record: running, created: false }), pruneExpired: async () => 0 },
        now: () => now,
      });
      expect(await scheduler.tick()).toMatchObject({ due: 1, enqueued: 0, busy: 1, failed: 0 });
      expect(store.rows[0].busyCount).toBe(1);
      // Fortgeschrieben wird trotzdem, und zwar auf `now + interval`: sonst
      // waere jede Runde des Provisioners ein weiterer faelliger Takt.
      expect(store.rows[0].nextDueAt.toISOString()).toBe("2026-10-03T06:00:00.000Z");
    });

  it("holt nach einem Ausfall nichts nach", async () => {
    // Faellig seit drei Tagen. Was entsteht, ist **ein** Auftrag und nicht drei:
    // ein nachgeholtes Backup von vorletzter Woche sichert den Stand von heute.
    const now = new Date("2026-10-04T06:00:00.000Z");
    const store = new MemoryScheduleStore([{ nextDueAt: new Date("2026-10-01T06:00:00.000Z") }]);
    let enqueued = 0;
    const scheduler = new ProjectDatabaseBackupScheduler({
      store,
      target: {
        enqueueBackup: async () => {
          enqueued += 1;
          return { record: record(randomUUID(), "pending", now), created: true };
        },
        pruneExpired: async () => 0,
      },
      now: () => now,
    });
    await scheduler.tick();
    expect(enqueued).toBe(1);
    expect(store.rows[0].nextDueAt.toISOString()).toBe("2026-10-05T06:00:00.000Z");
  });

  it("laesst einen abgeschalteten Zeitplan liegen", async () => {
    const now = new Date("2026-10-04T06:00:00.000Z");
    const store = new MemoryScheduleStore([{ enabled: false }]);
    const scheduler = new ProjectDatabaseBackupScheduler({
      store,
      target: {
        enqueueBackup: async () => { throw new Error("darf nicht gerufen werden"); },
        pruneExpired: async () => 0,
      },
      now: () => now,
    });
    expect(await scheduler.tick()).toMatchObject({ due: 0, enqueued: 0 });
  });

  it("reisst die uebrigen Zeitplaene nicht mit, wenn einer scheitert", async () => {
    const now = new Date("2026-10-04T06:00:00.000Z");
    const other = randomUUID();
    const store = new MemoryScheduleStore([{}, { projectId: other, environment: "staging" }]);
    let calls = 0;
    const scheduler = new ProjectDatabaseBackupScheduler({
      store,
      target: {
        enqueueBackup: async () => {
          calls += 1;
          if (calls === 1) throw Object.assign(new Error("no"), { code: "PERSISTENCE_ERROR" });
          return { record: record(randomUUID(), "pending", now), created: true };
        },
        pruneExpired: async () => 0,
      },
      now: () => now,
    });
    expect(await scheduler.tick()).toMatchObject({ due: 2, enqueued: 1, failed: 1 });
  });

  it("ruft den Aufraeumer, aber hoechstens einmal je Takt des Aufraeumers", async () => {
    let now = new Date("2026-10-04T06:00:00.000Z");
    const store = new MemoryScheduleStore([]);
    let prunes = 0;
    const scheduler = new ProjectDatabaseBackupScheduler({
      store,
      target: {
        enqueueBackup: async () => { throw new Error("kein Zeitplan"); },
        pruneExpired: async () => { prunes += 1; return 2; },
      },
      pruneIntervalMs: 3_600_000,
      now: () => now,
    });
    expect(await scheduler.tick()).toMatchObject({ pruned: 2 });
    // Zwei Runden des Provisioners spaeter ist der Aufraeumer nicht wieder dran.
    expect(await scheduler.tick()).toMatchObject({ pruned: 0 });
    expect(prunes).toBe(1);
    now = new Date(now.getTime() + 3_600_001);
    expect(await scheduler.tick()).toMatchObject({ pruned: 2 });
    expect(prunes).toBe(2);
  });

  it("gibt die Frist der Umgebung heraus, und nichts, wenn es keine Zeile gibt", async () => {
    const store = new MemoryScheduleStore([{ retentionDays: 7 }]);
    const scheduler = new ProjectDatabaseBackupScheduler({
      store,
      target: {
        enqueueBackup: async () => { throw new Error("nicht gerufen"); },
        pruneExpired: async () => 0,
      },
    });
    expect(await scheduler.retentionDaysFor({ projectId, environment: "production" })).toBe(7);
    expect(await scheduler.retentionDaysFor({ projectId, environment: "staging" })).toBeNull();
  });
});
