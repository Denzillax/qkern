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
    // Der Eltern-Span bleibt der von draussen, auch beim Wiedereinreihen: Die
    // Spalte heisst "die Span draussen, an der diese Nachricht haengt", und die
    // Ursache steht genauer in `source_message_id` (2.124, siehe `traceAnchor`
    // im Postgres-Port).
    expect(replayed.parentSpanId).toBe(SPAN_ID);
    expect(replayed.parentSpanId).not.toBe(source.stations[source.stations.length - 1]!.spanId);
  });

  it("hands the claim a traceparent that continues the trace with its own span", async () => {
    const { service } = setup(() => new Date("2026-10-01T08:00:00.000Z"));
    await service.createQueue(admin, scope, { name: "pass-queue", maxAttempts: 1 });
    const receipt = await service.enqueue(admin, scope, "pass-queue", {
      payload: { task: "x" }, traceparent: `00-${TRACE_ID}-${SPAN_ID}-01`,
    });
    const claim = await service.claim(worker, scope, "pass-queue", { workerId: "host-a" });
    expect(claim[0]?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    const trace = await service.readTrace(admin, scope, "pass-queue", receipt.id);
    // Dieselbe Spur, aber die Span der Station, die dieser Claim geschrieben
    // hat. Nicht der Span des Einreichers: Was der Worker jetzt tut, haengt an
    // der Abholung.
    expect(claim[0]?.traceparent)
      .toBe(`00-${TRACE_ID}-${trace.stations[1]!.spanId}-01`);
    expect(claim[0]?.traceparent).not.toContain(SPAN_ID);
    // Jede Station hat ihre eigene Span, auch die, die niemand herausgibt.
    expect(trace.stations.map((entry) => entry.spanId))
      .toEqual(trace.stations.map((entry) => entry.spanId).filter((value) => /^[0-9a-f]{16}$/.test(value)));
    expect(new Set(trace.stations.map((entry) => entry.spanId)).size).toBe(trace.stations.length);
  });

  it("invents no trace id where none came in, and says so with null", async () => {
    const { service } = setup(() => new Date("2026-10-01T08:00:00.000Z"));
    await service.createQueue(admin, scope, { name: "plain-queue", maxAttempts: 1 });
    const receipt = await service.enqueue(admin, scope, "plain-queue", { payload: { task: "x" } });
    const claim = await service.claim(worker, scope, "plain-queue", { workerId: "host-a" });
    // Eine erfundene Spur-Id waere draussen eine Spur mit einem Teilnehmer, und
    // in der Antwort der Trace-Route von einem echten Anschluss nicht zu
    // unterscheiden. Die Begruendung steht in Migration 0082.
    expect(claim[0]?.traceparent).toBeNull();
    const trace = await service.readTrace(admin, scope, "plain-queue", receipt.id);
    expect(trace.traceId).toBeNull();
    // Span-Ids gibt es trotzdem: Eine Station ist ein Span, ob jemand danach
    // fragt oder nicht.
    for (const station of trace.stations) expect(station.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("drops a header that does not fit the shape instead of refusing the enqueue", async () => {
    const { service } = setup(() => new Date("2026-10-01T08:00:00.000Z"));
    await service.createQueue(admin, scope, { name: "broken-queue", maxAttempts: 1 });
    // Die Regel aus 2.72.0, hier fuer die Richtung nach innen nachgeprueft: Ein
    // Beobachtungskopf ist kein Teil des Auftrags, und eine 400 darauf hiesse,
    // eine Nachricht an einem Kopf scheitern zu lassen, den niemand braucht.
    const receipt = await service.enqueue(admin, scope, "broken-queue", {
      payload: { task: "x" }, traceparent: `00-${TRACE_ID.toUpperCase()}-${SPAN_ID}-01`,
    });
    expect(receipt.status).toBe("available");
    const claim = await service.claim(worker, scope, "broken-queue", { workerId: "host-a" });
    expect(claim[0]?.id).toBe(receipt.id);
    expect(claim[0]?.traceparent).toBeNull();
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

/**
 * Die Suche nach einer Spur-Id und die Anwendungstuer im Speicher-Port (2.131).
 *
 * Was einen Stack braucht — der Teilindex aus 0085, die Policy aus 0081, die
 * Keyset-Abfrage gegen echte `timestamptz` und `uuid` — steht in
 * `postgres.integration.test.ts` als `(2.131)`. Was hier steht, ist die Zusage,
 * die **beide** Ports tragen muessen: Ein Port, der eine andere Ordnung oder eine
 * andere Grenze faehrt als der andere, ist ein Port, der etwas anderes zusagt als
 * das Produkt.
 */
describe("project queue trace search in the memory port", () => {
  function setup(now: () => Date) {
    const repository = new MemoryProjectQueueRepository();
    return { repository, service: new ProjectQueueService({ repository, now }) };
  }

  const appUser: ProjectQueuePrincipal = {
    organizationId: scope.organizationId, actorRef: "app-user@qkern.test",
    role: "authenticated", subject: "app-subject",
  };

  it("finds the messages of one trace across two queues, oldest first, and leaves the other scope alone", async () => {
    let clock = new Date("2026-10-01T08:00:00.000Z");
    const { service } = setup(() => clock);
    for (const target of [scope, other]) {
      await service.createQueue(admin, target, { name: "search-a" });
      await service.createQueue(admin, target, { name: "search-b" });
    }
    const traceparent = formatProjectQueueTraceparent({ traceId: TRACE_ID, parentSpanId: SPAN_ID });
    const first = await service.enqueue(admin, scope, "search-a", { payload: { task: "a" }, traceparent });
    clock = new Date(clock.getTime() + 1_000);
    const second = await service.enqueue(admin, scope, "search-b", { payload: { task: "b" }, traceparent });
    // Dieselbe Spur-Id in einem anderen Projekt derselben Organisation. Sie darf
    // nicht mitkommen, und das haelt im Speicher-Port dieselbe Bedingung wie im
    // Postgres-Port.
    clock = new Date(clock.getTime() + 1_000);
    const foreign = await service.enqueue(admin, other, "search-a", { payload: { task: "c" }, traceparent });
    // Und eine andere Spur in derselben Queue.
    const unrelated = await service.enqueue(admin, scope, "search-a", {
      payload: { task: "d" },
      traceparent: formatProjectQueueTraceparent({ traceId: `${"0".repeat(31)}1`, parentSpanId: SPAN_ID }),
    });

    const found = await service.searchTraces(admin, scope, { traceId: TRACE_ID });
    expect(found.traceId).toBe(TRACE_ID);
    expect(found.messages.map((entry) => [entry.messageId, entry.queue, entry.station])).toEqual([
      [first.id, "search-a", "enqueued"],
      [second.id, "search-b", "enqueued"],
    ]);
    expect(found.nextCursor).toBeNull();
    const ids = found.messages.map((entry) => entry.messageId);
    expect(ids).not.toContain(foreign.id);
    expect(ids).not.toContain(unrelated.id);
    // Keine Nutzlast und kein Wirt, und der Wirt nicht als `null`: Die erste
    // Station hat keinen, also hat die Trefferzeile das Feld nicht.
    expect(Object.keys(found.messages[0]!).sort()).toEqual([
      "messageId", "occurredAt", "parentSpanId", "queue", "sourceMessageId", "spanId", "station",
    ]);
  });

  it("pages by keyset and answers a cursor whose row is gone with nothing", async () => {
    let clock = new Date("2026-10-01T08:00:00.000Z");
    const { service } = setup(() => clock);
    await service.createQueue(admin, scope, { name: "page-queue" });
    const traceparent = formatProjectQueueTraceparent({ traceId: TRACE_ID, parentSpanId: SPAN_ID });
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      ids.push((await service.enqueue(admin, scope, "page-queue", { payload: { index }, traceparent })).id);
      clock = new Date(clock.getTime() + 1_000);
    }
    const page1 = await service.searchTraces(admin, scope, { traceId: TRACE_ID, limit: 2 });
    expect(page1.messages.map((entry) => entry.messageId)).toEqual([ids[0], ids[1]]);
    expect(page1.nextCursor).toBe(ids[1]);
    const page2 = await service.searchTraces(admin, scope, {
      traceId: TRACE_ID, limit: 2, cursor: page1.nextCursor!,
    });
    expect(page2.messages.map((entry) => entry.messageId)).toEqual([ids[2]]);
    expect(page2.nextCursor).toBeNull();
    // Ein Cursor, dessen Zeile es nicht gibt, liefert nichts statt der ersten
    // Seite: Die Seite, die jemand wollte, existiert wirklich nicht.
    const stale = await service.searchTraces(admin, scope, {
      traceId: TRACE_ID, limit: 2, cursor: "weg",
    });
    expect(stale.messages).toEqual([]);
    expect(stale.nextCursor).toBeNull();
  });

  it("refuses anything that is not a trace id instead of answering empty", async () => {
    const clock = new Date("2026-10-01T08:00:00.000Z");
    const { service } = setup(() => clock);
    await service.createQueue(admin, scope, { name: "guard-search" });
    for (const invalid of [TRACE_ID.toUpperCase(), "0".repeat(32), "abc", `${TRACE_ID}0`, ""]) {
      await expect(service.searchTraces(admin, scope, { traceId: invalid }))
        .rejects.toMatchObject({ code: "QUEUE_INVALID_INPUT" });
    }
    // Und die Suche bleibt beim Betreiber: Sie nennt Nachrichten verschiedener
    // Besitzer ueber mehrere Queues.
    await expect(service.searchTraces(appUser, scope, { traceId: TRACE_ID }))
      .rejects.toMatchObject({ code: "QUEUE_ACCESS_DENIED" });
    await expect(service.searchTraces(worker, scope, { traceId: TRACE_ID }))
      .rejects.toMatchObject({ code: "QUEUE_ACCESS_DENIED" });
  });

  it("gives an application the trace of its own message, without the host, and nothing of a foreign one", async () => {
    let clock = new Date("2026-10-01T08:00:00.000Z");
    const { service } = setup(() => clock);
    await service.createQueue(admin, scope, {
      name: "own-queue", maxAttempts: 2, visibilityTimeoutSeconds: 5,
    });
    const mine = await service.enqueue(appUser, scope, "own-queue", { payload: { task: "mine" } });
    const theirs = await service.enqueue(admin, scope, "own-queue", { payload: { task: "theirs" } });
    const claimed = await service.claim(worker, scope, "own-queue", { workerId: "own-host", limit: 2 });
    clock = new Date(clock.getTime() + 1_000);
    await service.acknowledge(worker, scope, "own-queue", mine.id, {
      workerId: "own-host", leaseToken: claimed.find((entry) => entry.id === mine.id)!.leaseToken,
    });

    // Der Betreiber sieht den Wirt.
    const operator = await service.readTrace(admin, scope, "own-queue", mine.id);
    expect(operator.stations.map((entry) => entry.workerId)).toEqual([null, "own-host", "own-host"]);
    // Die Anwendung sieht dieselben Stationen ohne ihn, und das Feld fehlt.
    const own = await service.readMessageTrace(appUser, scope, "own-queue", mine.id);
    expect(own.stations.map((entry) => entry.station)).toEqual(["enqueued", "claimed", "completed"]);
    for (const station of own.stations) {
      expect(Object.keys(station).sort())
        .toEqual(["attempt", "failureCode", "occurredAt", "sequence", "spanId", "station"]);
    }
    expect(JSON.stringify(own)).not.toContain("own-host");

    // Die richtige Id einer fremden Nachricht reicht nicht: Die Id ist in der
    // Quittung herausgegeben, der Besitzer entscheidet.
    await expect(service.readMessageTrace(appUser, scope, "own-queue", theirs.id))
      .rejects.toMatchObject({ code: "QUEUE_RESOURCE_NOT_FOUND" });
    // Dieselbe Ablehnung wie fuer eine Id, die es nie gab.
    await expect(service.readMessageTrace(appUser, scope, "own-queue", "unbekannt"))
      .rejects.toMatchObject({ code: "QUEUE_RESOURCE_NOT_FOUND" });
    // Ein anonymer Aufrufer kann nichts besitzen und bekommt nichts.
    await expect(service.readMessageTrace({ ...appUser, role: "anon" }, scope, "own-queue", mine.id))
      .rejects.toMatchObject({ code: "QUEUE_ACCESS_DENIED" });
    // Der Service-Key dieser Umgebung sieht jede Nachricht: Mit demselben Key
    // holt er sie samt Nutzlast ab.
    expect((await service.readMessageTrace(worker, scope, "own-queue", theirs.id)).messageId)
      .toBe(theirs.id);
    // Und ein anderes Projekt sieht nichts, auch mit derselben Id nicht.
    await service.createQueue(admin, other, { name: "own-queue" });
    await expect(service.readMessageTrace(worker, other, "own-queue", mine.id))
      .rejects.toMatchObject({ code: "QUEUE_RESOURCE_NOT_FOUND" });
  });
});
