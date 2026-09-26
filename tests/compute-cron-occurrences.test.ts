import { describe, expect, it } from "vitest";
import { cronOccurrenceDedupeKey } from "@/lib/server/compute/cron";
import {
  cronOccurrenceCandidates,
  CRON_OCCURRENCE_LIMIT,
  type CronOccurrenceMessageRow,
} from "@/lib/server/compute/cron-occurrences";
import {
  ComputeDefinitionError,
  ComputeDefinitionService,
  type ComputeDefinitionRepository,
  type ComputeDefinitionScope,
  type CronDefinitionRecord,
} from "@/lib/server/compute/definitions";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import { projectQueueDedupeKeyHash } from "@/lib/server/project-queues/service";

/**
 * Das Cron-Log (2.42) ist zusammengesetzt, nicht aufgezeichnet.
 *
 * Gepruefte Zusagen: eine gefundene Nachricht steht mit ihrem Zustand da, ein
 * faelliges Vorkommen ohne Nachricht ist eine Luecke, ein kuenftiges und ein
 * Vorkommen vor dem Anlegen sind **keine**, das Fenster ist gebunden, die
 * Reihenfolge ist deterministisch — und der Dedupe-Schluessel verlaesst den
 * Dienst nie.
 */
const scope: ComputeDefinitionScope = {
  organizationId: "org-1", projectId: "project-1", environment: "development",
};
const admin: ProjectQueuePrincipal = {
  organizationId: "org-1", actorRef: "owner@qkern.test", role: "admin", subject: "user-1",
};
const cronId = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-08-04T12:00:00.000Z");
/** Ein Tag Dedupe-Fenster: im Prueffenster verfaellt kein Verifikator. */
const LONG_WINDOW = 86_400;

function definition(overrides: Partial<CronDefinitionRecord> = {}): CronDefinitionRecord {
  return Object.freeze({
    ...scope, id: cronId, name: "nightly-report", expression: "*/15 * * * *",
    queue: "report_jobs", payload: { secret: "kundendaten" }, enabled: true,
    lastDispatchedAt: null, createdAt: "2026-08-04T06:00:00.000Z", ...overrides,
  });
}

function hashOf(occurredAt: string): string {
  return projectQueueDedupeKeyHash(cronOccurrenceDedupeKey(cronId, new Date(occurredAt)));
}

function message(occurredAt: string, overrides: Partial<CronOccurrenceMessageRow> = {}):
CronOccurrenceMessageRow {
  return {
    dedupeKeyHash: hashOf(occurredAt),
    state: "done",
    attempts: 1,
    enqueuedAt: new Date(occurredAt),
    settledAt: new Date(occurredAt),
    ...overrides,
  };
}

function harness(options: {
  record?: CronDefinitionRecord | null;
  messages?: CronOccurrenceMessageRow[];
  dedupeWindowSeconds?: number | null;
  now?: Date;
} = {}) {
  const record = options.record === undefined ? definition() : options.record;
  const asked: Array<{ queue: string; hashes: readonly string[] }> = [];
  const repository = {
    async getCron() { return record; },
    async listCronOccurrenceMessages(
      _principal: ProjectQueuePrincipal, _scope: ComputeDefinitionScope,
      queue: string, hashes: readonly string[],
    ) {
      asked.push({ queue, hashes });
      return {
        dedupeWindowSeconds: options.dedupeWindowSeconds === undefined
          ? LONG_WINDOW : options.dedupeWindowSeconds,
        messages: options.messages ?? [],
      };
    },
  } as unknown as ComputeDefinitionRepository;
  const service = new ComputeDefinitionService({
    repository, now: () => options.now ?? NOW,
  });
  return { service, asked };
}

describe("cron occurrence assembly", () => {
  it("builds every dedupe verifier exactly as the dispatcher and the queue do", () => {
    // Der Kern der Rekonstruktion. Eine zweite Schreibweise des Schluessels
    // oder ein zweiter Hash waere eine Ansicht, die dauerhaft "fehlt" meldet.
    const candidates = cronOccurrenceCandidates(
      { id: cronId, expression: "0 * * * *" },
      { from: new Date("2026-08-04T09:00:00.000Z"), to: new Date("2026-08-04T11:00:00.000Z"), limit: 10 },
    );
    expect(candidates.map((candidate) => candidate.occurredAt.toISOString())).toEqual([
      "2026-08-04T11:00:00.000Z", "2026-08-04T10:00:00.000Z", "2026-08-04T09:00:00.000Z",
    ]);
    for (const candidate of candidates) {
      expect(candidate.dedupeKeyHash).toBe(projectQueueDedupeKeyHash(
        `cron:${cronId}:${candidate.occurredAt.toISOString()}`,
      ));
      expect(candidate.dedupeKeyHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("puts the found message beside its occurrence, with state, attempts and enqueue time", async () => {
    const { service, asked } = harness({
      messages: [message("2026-08-04T11:45:00.000Z", { state: "dead_letter", attempts: 3 })],
    });
    const log = await service.listCronOccurrences(admin, scope, cronId);
    const found = log.occurrences.filter((entry) => entry.status === "found");
    expect(found).toHaveLength(1);
    expect(found[0]).toEqual({
      occurredAt: "2026-08-04T11:45:00.000Z",
      status: "found",
      message: {
        state: "dead_letter", attempts: 3,
        enqueuedAt: "2026-08-04T11:45:00.000Z", settledAt: "2026-08-04T11:45:00.000Z",
      },
    });
    expect(log.counts.found).toBe(1);
    // Gefragt wird die Zielqueue der Definition, mit genau den Verifikatoren
    // der gezeigten Vorkommen.
    expect(asked[0]?.queue).toBe("report_jobs");
    expect(asked[0]?.hashes).toHaveLength(log.occurrences.length);
  });

  it("returns neither the dedupe key nor its verifier nor the payload", async () => {
    const { service } = harness({ messages: [message("2026-08-04T11:45:00.000Z")] });
    const log = await service.listCronOccurrences(admin, scope, cronId);
    const serialised = JSON.stringify(log);
    expect(serialised).not.toContain(hashOf("2026-08-04T11:45:00.000Z"));
    expect(serialised).not.toContain("cron:");
    expect(serialised).not.toContain("kundendaten");
    expect(serialised).not.toContain("payload");
    expect(serialised).not.toContain("dedupeKey");
    for (const occurrence of log.occurrences) {
      expect(Object.keys(occurrence).sort()).toEqual(["message", "occurredAt", "status"]);
      if (occurrence.message) {
        expect(Object.keys(occurrence.message).sort())
          .toEqual(["attempts", "enqueuedAt", "settledAt", "state"]);
      }
    }
  });

  it("calls a due occurrence without a message a gap", async () => {
    const { service } = harness();
    const log = await service.listCronOccurrences(admin, scope, cronId);
    const gap = log.occurrences.find((entry) => entry.occurredAt === "2026-08-04T11:45:00.000Z");
    expect(gap).toMatchObject({ status: "missing", message: null });
    // Alles zwischen Anlagezeit und Karenz ist faellig: 06:00 bis 11:45 im
    // Viertelstundentakt sind 24 Vorkommen.
    expect(log.counts.missing).toBe(24);
  });

  it("calls a future occurrence not yet due, and a just-passed one too", async () => {
    const { service } = harness();
    const log = await service.listCronOccurrences(admin, scope, cronId);
    const future = log.occurrences.filter((entry) => entry.status === "not_yet_due");
    // 12:00 (gerade vergangen, innerhalb der Karenz) bis 13:00 einschliesslich.
    expect(future.map((entry) => entry.occurredAt)).toEqual([
      "2026-08-04T13:00:00.000Z", "2026-08-04T12:45:00.000Z", "2026-08-04T12:30:00.000Z",
      "2026-08-04T12:15:00.000Z", "2026-08-04T12:00:00.000Z",
    ]);
    expect(log.counts.notYetDue).toBe(5);
  });

  it("does not blame an occurrence from before the definition existed", async () => {
    const { service } = harness();
    const log = await service.listCronOccurrences(admin, scope, cronId);
    const before = log.occurrences.filter((entry) => entry.occurredAt < "2026-08-04T06:00:00.000Z");
    expect(before.length).toBeGreaterThan(0);
    for (const occurrence of before) expect(occurrence.status).toBe("expected");
  });

  it("does not claim a gap once the dedupe window of the queue has expired", async () => {
    // Nach Ablauf setzt die Queue `dedupe_key_hash` auf NULL (Migration 0026).
    // Danach beweist eine fehlende Nachricht nichts mehr.
    const { service } = harness({ dedupeWindowSeconds: 900 });
    const log = await service.listCronOccurrences(admin, scope, cronId);
    expect(log.counts.missing).toBe(0);
    expect(log.occurrences.find((entry) => entry.occurredAt === "2026-08-04T10:00:00.000Z"))
      .toMatchObject({ status: "expected" });
  });

  it("says when the target queue does not exist at all", async () => {
    const { service } = harness({ dedupeWindowSeconds: null });
    const log = await service.listCronOccurrences(admin, scope, cronId);
    expect(log.window.queueFound).toBe(false);
    // Ohne Queue ist jede fehlende Nachricht eine echte Luecke: Das Einreihen
    // kann gar nicht gelungen sein.
    expect(log.counts.missing).toBeGreaterThan(0);
  });

  it("bounds the window and orders it newest first, always the same way", async () => {
    const { service } = harness({ record: definition({ expression: "*/1 * * * *" }) });
    const log = await service.listCronOccurrences(admin, scope, cronId);
    expect(log.occurrences).toHaveLength(CRON_OCCURRENCE_LIMIT);
    expect(log.window.maxOccurrences).toBe(CRON_OCCURRENCE_LIMIT);
    expect(log.window.from).toBe("2026-08-03T12:00:00.000Z");
    expect(log.window.to).toBe("2026-08-04T13:00:00.000Z");
    const times = log.occurrences.map((entry) => entry.occurredAt);
    expect([...times].sort().reverse()).toEqual(times);
    // Der Minutentakt reicht im Fenster weiter zurueck, als 50 Vorkommen
    // zeigen: die neuesten 50 endet bei 12:11.
    expect(times.at(0)).toBe("2026-08-04T13:00:00.000Z");
    expect(times.at(-1)).toBe("2026-08-04T12:11:00.000Z");
    const again = await service.listCronOccurrences(admin, scope, cronId);
    expect(again).toEqual(log);
  });

  it("answers 404 for an unknown definition and never asks the queue", async () => {
    const { service, asked } = harness({ record: null });
    await expect(service.listCronOccurrences(admin, scope, cronId))
      .rejects.toMatchObject({ code: "COMPUTE_NOT_FOUND" });
    await expect(service.listCronOccurrences(admin, scope, "not-a-uuid"))
      .rejects.toBeInstanceOf(ComputeDefinitionError);
    // Eine fremde Organisation sieht nichts, auch nicht den Unterschied.
    await expect(service.listCronOccurrences(
      { ...admin, organizationId: "org-2" }, scope, cronId,
    )).rejects.toMatchObject({ code: "COMPUTE_NOT_FOUND" });
    expect(asked).toEqual([]);
  });

  it("refuses a stored expression that no longer parses instead of showing an empty log", async () => {
    // Eine Stunde 24 gibt es nicht. Der Dienst laesst sie nicht entstehen, ein
    // direkter INSERT schon: Der CHECK in 0031 prueft nur die Laenge.
    const { service } = harness({ record: definition({ expression: "0 24 * * *" }) });
    await expect(service.listCronOccurrences(admin, scope, cronId))
      .rejects.toMatchObject({ code: "COMPUTE_INVALID_INPUT" });
  });
});
