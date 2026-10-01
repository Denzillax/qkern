import { describe, expect, it } from "vitest";
import type { ProjectQueuePrincipal, ProjectQueueScope } from "@/lib/server/project-queues/model";
import { MemoryProjectQueueRepository } from "@/lib/server/project-queues/repository";
import { ProjectQueueService } from "@/lib/server/project-queues/service";
import {
  formatProjectQueueTraceparent,
  parseProjectQueueTraceparent,
  PROJECT_QUEUE_TRACE_MAX_STATIONS,
  PROJECT_QUEUE_TRACE_MIN_RETENTION_SECONDS,
  projectQueueTraceExpiresAt,
  projectQueueTraceRetentionSeconds,
} from "@/lib/server/project-queues/trace";

/**
 * Die Spur einer Nachricht ohne Datenbank (2.121, 2.122).
 *
 * Was hier steht, braucht keinen Stack: der Leser des `traceparent`, die
 * Fristformel und der Speicher-Port. Was einen Stack braucht — Rechte,
 * Policies, die CHECKs aus 0081, die Ordnung ueber zwei Instanzen und der
 * Unterschied zwischen Ablauf und Verbrauch an einer echten Tabelle — steht in
 * `postgres.integration.test.ts` als `(2.121)` und `(2.122)`.
 */
const scope: ProjectQueueScope = {
  organizationId: "org-trace", projectId: "project-trace", environment: "development",
};
const other: ProjectQueueScope = { ...scope, projectId: "project-anders" };

const admin: ProjectQueuePrincipal = {
  organizationId: scope.organizationId, actorRef: "admin@qkern.test",
  role: "admin", subject: "admin-subject",
};
const worker: ProjectQueuePrincipal = {
  organizationId: scope.organizationId, actorRef: "service-role:worker",
  role: "service_role", subject: "worker-subject",
};

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID = "00f067aa0ba902b7";

describe("project queue traceparent", () => {
  it("reads the one version it understands and nothing else", () => {
    expect(parseProjectQueueTraceparent(`00-${TRACE_ID}-${SPAN_ID}-01`))
      .toEqual({ traceId: TRACE_ID, parentSpanId: SPAN_ID });
    // Umgebende Leerzeichen kommen aus jedem zweiten Proxy.
    expect(parseProjectQueueTraceparent(`  00-${TRACE_ID}-${SPAN_ID}-00  `))
      .toEqual({ traceId: TRACE_ID, parentSpanId: SPAN_ID });
    // Eine spaetere Version darf nach der Spezifikation Felder anhaengen. Was
    // QKERN davon haelt, weiss QKERN nicht, und eine geratene Spur-Id ist
    // schlechter als keine.
    expect(parseProjectQueueTraceparent(`01-${TRACE_ID}-${SPAN_ID}-01-extra`)).toBeNull();
    // Die Spezifikation schreibt Kleinbuchstaben vor. Wer gross schickt,
    // schickt etwas anderes, als er glaubt, und bekommt darum keine Spur.
    expect(parseProjectQueueTraceparent(`00-${TRACE_ID.toUpperCase()}-${SPAN_ID}-01`)).toBeNull();
    // Die beiden Nullspuren sind ungueltig, und sie anzunehmen hiesse, einen
    // kaputten Kopf als Spur auszugeben.
    expect(parseProjectQueueTraceparent(`00-${"0".repeat(32)}-${SPAN_ID}-01`)).toBeNull();
    expect(parseProjectQueueTraceparent(`00-${TRACE_ID}-${"0".repeat(16)}-01`)).toBeNull();
    expect(parseProjectQueueTraceparent("nonsense")).toBeNull();
    expect(parseProjectQueueTraceparent(null)).toBeNull();
    expect(parseProjectQueueTraceparent(undefined)).toBeNull();
  });

  it("writes a sampled header back, because a trace it hands out has stations", () => {
    expect(formatProjectQueueTraceparent({ traceId: TRACE_ID, parentSpanId: SPAN_ID }))
      .toBe(`00-${TRACE_ID}-${SPAN_ID}-01`);
  });
});

describe("project queue trace retention", () => {
  it("never falls below the queue retention and never below one operating day", () => {
    // Die kuerzeste Aufbewahrung, die 0026 zulaesst, hebt die Frist auf den
    // Betriebstag: Eine Spur eine Minute nach dem Ausgang wegzunehmen hiesse,
    // sie gar nicht zu schreiben.
    expect(projectQueueTraceRetentionSeconds({ retentionSeconds: 60 }))
      .toBe(PROJECT_QUEUE_TRACE_MIN_RETENTION_SECONDS);
    expect(projectQueueTraceRetentionSeconds({ retentionSeconds: 86_400 })).toBe(86_400);
    // Darueber zieht die Spur mit der Queue mit und bleibt damit nie hinter
    // ihrer Nachricht zurueck. Sieben Tage ist das Maximum aus 0026, und die
    // Spur geht nicht darueber: Das waere eine zweite Aufbewahrung.
    expect(projectQueueTraceRetentionSeconds({ retentionSeconds: 604_800 })).toBe(604_800);
  });

  it("dates the expiry from the station and not from the outcome", () => {
    const occurred = new Date("2026-10-01T08:00:00.000Z");
    expect(projectQueueTraceExpiresAt({ retentionSeconds: 60 }, occurred).toISOString())
      .toBe("2026-10-02T08:00:00.000Z");
  });
});

describe("project queue trace in the memory port", () => {
  function setup(now: () => Date) {
    const repository = new MemoryProjectQueueRepository();
    return { repository, service: new ProjectQueueService({ repository, now }) };
  }

  it("carries one message through its stations and keeps the foreign trace on the first", async () => {
    let clock = new Date("2026-10-01T08:00:00.000Z");
    const { service } = setup(() => clock);
    await service.createQueue(admin, scope, {
      name: "trace-queue", maxAttempts: 2, visibilityTimeoutSeconds: 5,
    });
    const receipt = await service.enqueue(admin, scope, "trace-queue", {
      payload: { task: "send", customer: "nicht-in-die-spur" },
      traceparent: `00-${TRACE_ID}-${SPAN_ID}-01`,
    });
    const first = await service.claim(worker, scope, "trace-queue", { workerId: "host-a" });
    // Wirt A stirbt: kein Ack, kein Fail, keine Erneuerung. Die Pacht verfaellt.
    clock = new Date(clock.getTime() + 6_000);
    const second = await service.claim(worker, scope, "trace-queue", { workerId: "host-b" });
    expect(second[0]?.id).toBe(receipt.id);
    await service.fail(worker, scope, "trace-queue", receipt.id, {
      workerId: "host-b", leaseToken: second[0]!.leaseToken, failureCode: "HANDLER_ERROR",
    });

    const trace = await service.readTrace(admin, scope, "trace-queue", receipt.id);
    expect(trace.stations.map((entry) => [entry.station, entry.attempt, entry.workerId])).toEqual([
      ["enqueued", 0, null],
      ["claimed", 1, "host-a"],
      ["lease_expired", 1, "host-a"],
      ["claimed", 2, "host-b"],
      ["dead_lettered", 2, "host-b"],
    ]);
    expect(trace.traceId).toBe(TRACE_ID);
    expect(trace.parentSpanId).toBe(SPAN_ID);
    expect(trace.messageExists).toBe(true);
    expect(trace.complete).toBe(true);
    // Der Anschluss steht genau einmal, am Kopf der Spur, und nicht an jeder
    // Station: Eine Spur, die auf Station sieben eine fremde Spur-Id
    // dazubekaeme, waere ab dort eine andere Spur.
    expect(JSON.stringify(trace.stations)).not.toContain(TRACE_ID);
    // Und die Nutzlast ist nirgends.
    expect(JSON.stringify(trace)).not.toContain("nicht-in-die-spur");
    expect(first[0]?.id).toBe(receipt.id);
  });

  it("gives a replay the trace of its source and links both directions", async () => {
    const clock = new Date("2026-10-01T08:00:00.000Z");
    const { service } = setup(() => clock);
    await service.createQueue(admin, scope, { name: "replay-queue", maxAttempts: 1 });
    const receipt = await service.enqueue(admin, scope, "replay-queue", {
      payload: { task: "x" }, traceparent: `00-${TRACE_ID}-${SPAN_ID}-01`,
    });
    const claim = await service.claim(worker, scope, "replay-queue", { workerId: "host-a" });
    await service.fail(worker, scope, "replay-queue", receipt.id, {
      workerId: "host-a", leaseToken: claim[0]!.leaseToken, failureCode: "HANDLER_ERROR",
    });
    const replay = await service.replayDeadLetter(admin, scope, "replay-queue", receipt.id);

    const replayed = await service.readTrace(admin, scope, "replay-queue", replay.id);
    expect(replayed.stations.map((entry) => entry.station)).toEqual(["replayed"]);
    expect(replayed.sourceMessageId).toBe(receipt.id);
    expect(replayed.traceId).toBe(TRACE_ID);
    const source = await service.readTrace(admin, scope, "replay-queue", receipt.id);
    expect(source.replayedIntoMessageId).toBe(replay.id);
  });

  it("stops at the station limit without stopping the enqueue", async () => {
    const clock = new Date("2026-10-01T08:00:00.000Z");
    const { service } = setup(() => clock);
    await service.createQueue(admin, scope, { name: "dedupe-queue", dedupeWindowSeconds: 3_600 });
    const twin = await service.enqueue(admin, scope, "dedupe-queue", {
      payload: { task: "y" }, dedupeKey: "immer-derselbe",
    });
    for (let round = 0; round < 80; round += 1) {
      const again = await service.enqueue(admin, scope, "dedupe-queue", {
        payload: { task: "y" }, dedupeKey: "immer-derselbe",
      });
      // Die Grenze gilt fuer die Beobachtung und nie fuer die Ausfuehrung.
      expect(again.id).toBe(twin.id);
      expect(again.deduplicated).toBe(true);
    }
    const trace = await service.readTrace(admin, scope, "dedupe-queue", twin.id);
    expect(trace.stations).toHaveLength(PROJECT_QUEUE_TRACE_MAX_STATIONS);
    expect(trace.complete).toBe(false);
  });

  it("keeps the trace when the message is already pruned and cuts it at its own expiry", async () => {
    let clock = new Date("2026-10-01T08:00:00.000Z");
    const { service } = setup(() => clock);
    await service.createQueue(admin, scope, {
      name: "retention-queue", maxAttempts: 1, retentionSeconds: 60,
    });
    const receipt = await service.enqueue(admin, scope, "retention-queue", { payload: { task: "z" } });
    const claim = await service.claim(worker, scope, "retention-queue", { workerId: "host-a" });
    await service.acknowledge(worker, scope, "retention-queue", receipt.id, {
      workerId: "host-a", leaseToken: claim[0]!.leaseToken,
    });

    // Der Verbrauch: Eine Minute und eine Sekunde spaeter ist die Nachricht weg.
    clock = new Date(clock.getTime() + 61_000);
    await service.status(admin, scope, "retention-queue");
    const survived = await service.readTrace(admin, scope, "retention-queue", receipt.id);
    expect(survived.messageExists).toBe(false);
    expect(survived.stations.map((entry) => entry.station))
      .toEqual(["enqueued", "claimed", "completed"]);

    // Der Ablauf: einen Betriebstag spaeter nimmt derselbe Aufraeumer die Spur.
    clock = new Date(clock.getTime() + PROJECT_QUEUE_TRACE_MIN_RETENTION_SECONDS * 1_000);
    await service.status(admin, scope, "retention-queue");
    await expect(service.readTrace(admin, scope, "retention-queue", receipt.id))
      .rejects.toMatchObject({ code: "QUEUE_RESOURCE_NOT_FOUND" });
  });

  it("shows a trace to no other scope and to no worker", async () => {
    const clock = new Date("2026-10-01T08:00:00.000Z");
    const { service } = setup(() => clock);
    await service.createQueue(admin, scope, { name: "scoped-queue" });
    await service.createQueue({ ...admin }, other, { name: "scoped-queue" });
    const receipt = await service.enqueue(admin, scope, "scoped-queue", { payload: { task: "w" } });

    // Dieselbe Id, derselbe Queue-Name, anderes Projekt: nichts zu sehen.
    await expect(service.readTrace(admin, other, "scoped-queue", receipt.id))
      .rejects.toMatchObject({ code: "QUEUE_RESOURCE_NOT_FOUND" });
    // Eine fremde Organisation kommt nicht einmal an die Scope-Pruefung vorbei.
    await expect(service.readTrace(
      { ...admin, organizationId: "org-fremd" }, scope, "scoped-queue", receipt.id,
    )).rejects.toMatchObject({ code: "QUEUE_ACCESS_DENIED" });
    // Und die Service-Rolle, die die Nachricht verarbeitet, liest keine Spur:
    // Die Spur sagt, welcher Wirt wann woran gearbeitet hat, und das ist eine
    // Betriebsangabe.
    await expect(service.readTrace(worker, scope, "scoped-queue", receipt.id))
      .rejects.toMatchObject({ code: "QUEUE_ACCESS_DENIED" });
  });

  it("refuses a message id that is not an identifier before it looks anything up", async () => {
    const clock = new Date("2026-10-01T08:00:00.000Z");
    const { service } = setup(() => clock);
    await service.createQueue(admin, scope, { name: "guard-queue" });
    await expect(service.readTrace(admin, scope, "guard-queue", "nicht gueltig"))
      .rejects.toMatchObject({ code: "QUEUE_INVALID_INPUT" });
  });
});
