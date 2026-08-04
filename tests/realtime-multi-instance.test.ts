import { describe, expect, it } from "vitest";
import { RealtimeCursorCodec } from "@/lib/server/realtime/cursor";
import {
  MemoryRealtimeEventBus,
  type RealtimeEventReference,
} from "@/lib/server/realtime/event-bus";
import type {
  RealtimePrincipal,
  RealtimeScope,
  RealtimeServerMessage,
  RealtimeSink,
} from "@/lib/server/realtime/model";
import { PrefixRealtimeAuthorization } from "@/lib/server/realtime/policy";
import { MemoryRealtimeEventLog } from "@/lib/server/realtime/repository";
import { RealtimeService } from "@/lib/server/realtime/service";

/**
 * Zustellung über Instanzgrenzen hinweg.
 *
 * Beide Dienste teilen sich einen Event-Log — im Betrieb ist das dieselbe
 * PostgreSQL-Tabelle — und einen Bus, der nur Verweise transportiert. Was hier
 * geprüft wird, ist die Zustelllogik: dass ein Broadcast die andere Instanz
 * erreicht, dass er die eigene nicht doppelt erreicht und dass ein verpasster
 * Hinweis nachgeholt wird.
 *
 * Was hier ausdrücklich **nicht** geprüft wird, ist echter Mehrprozessbetrieb.
 * Dafür gibt es den Zertifizierungsstack mit zwei getrennten Prozessen gegen
 * echtes PostgreSQL; ein In-Process-Test kann das nicht ersetzen.
 */

const scope: RealtimeScope = {
  organizationId: "org-realtime", projectId: "project-realtime", environment: "development",
};

class Sink implements RealtimeSink {
  readonly messages: RealtimeServerMessage[] = [];
  send(message: RealtimeServerMessage) { this.messages.push(structuredClone(message)); return true; }
}

function principal(subject: string): RealtimePrincipal {
  return {
    organizationId: scope.organizationId,
    actorRef: `authenticated:${subject}`,
    role: "authenticated",
    subject,
  };
}

function broadcasts(sink: Sink) {
  return sink.messages.filter((message) => message.type === "broadcast");
}

/** Liest ein Zahlenfeld aus einer Broadcast-Payload ohne unsicheren Cast. */
function indices(sink: Sink, field: string): number[] {
  return broadcasts(sink).map((message) => {
    const payload = (message as { payload: unknown }).payload;
    if (typeof payload !== "object" || payload === null) throw new Error("payload is not an object");
    const value = (payload as Record<string, unknown>)[field];
    if (typeof value !== "number") throw new Error(`payload.${field} is not a number`);
    return value;
  });
}

/** Zwei Instanzen über einem gemeinsamen Log und einem gemeinsamen Bus. */
function cluster(options: { connectBus?: boolean } = {}) {
  const eventLog = new MemoryRealtimeEventLog(50);
  const bus = new MemoryRealtimeEventBus();
  const cursor = new RealtimeCursorCodec(Buffer.alloc(32, 7));
  let event = 0;
  const now = () => new Date(`2026-08-04T12:00:${String(event++).padStart(2, "0")}.000Z`);

  const build = (instanceId: string) => {
    let connection = 0;
    const service = new RealtimeService({
      eventLog,
      eventBus: bus,
      instanceId,
      authorization: new PrefixRealtimeAuthorization(),
      cursor,
      now,
      id: () => `${instanceId}-connection-${++connection}`,
    });
    if (options.connectBus !== false) {
      bus.subscribeAs(instanceId, (reference) => { void service.deliverRemote(reference); });
    }
    return service;
  };

  const a = build("instance-a");
  const b = build("instance-b");

  const connect = (service: RealtimeService, subject: string) => {
    const sink = new Sink();
    const id = service.connect(scope, principal(subject), sink);
    return { id, sink };
  };

  return { a, b, bus, eventLog, connect };
}

describe("realtime delivery across instances", () => {
  it("delivers a broadcast from one instance to a subscriber on another", async () => {
    const { a, b, connect } = cluster();
    const publisher = connect(a, "publisher");
    const reader = connect(b, "reader");

    await a.subscribe(publisher.id, "r1", "public:room");
    await b.subscribe(reader.id, "r2", "public:room");
    await a.broadcast(publisher.id, "r3", "public:room", "message", { text: "hello" });

    const received = broadcasts(reader.sink);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ channel: "public:room", event: "message", replay: false });
    expect(received[0]).toMatchObject({ payload: { text: "hello" } });
  });

  it("never delivers an event twice on the publishing instance", async () => {
    const { a, b, connect } = cluster();
    const publisher = connect(a, "publisher");
    const local = connect(a, "local-reader");
    const remote = connect(b, "remote-reader");

    await a.subscribe(publisher.id, "r1", "public:room");
    await a.subscribe(local.id, "r2", "public:room");
    await b.subscribe(remote.id, "r3", "public:room");
    await a.broadcast(publisher.id, "r4", "public:room", "message", { n: 1 });

    expect(broadcasts(publisher.sink)).toHaveLength(1);
    expect(broadcasts(local.sink)).toHaveLength(1);
    expect(broadcasts(remote.sink)).toHaveLength(1);
  });

  it("keeps the order of several broadcasts on the receiving instance", async () => {
    const { a, b, connect } = cluster();
    const publisher = connect(a, "publisher");
    const reader = connect(b, "reader");

    await a.subscribe(publisher.id, "r1", "public:room");
    await b.subscribe(reader.id, "r2", "public:room");
    for (let index = 1; index <= 5; index += 1) {
      await a.broadcast(publisher.id, `r${index + 2}`, "public:room", "tick", { index });
    }

    expect(indices(reader.sink, "index")).toEqual([1, 2, 3, 4, 5]);
  });

  it("catches up events whose notification was lost", async () => {
    // NOTIFY ist nicht dauerhaft. Ein Verweis loest deshalb ein Replay ab der
    // zuletzt zugestellten Sequenz aus, statt nur das genannte Ereignis zu
    // holen — sonst bliebe eine stille Luecke zurueck.
    const { a, b, connect } = cluster({ connectBus: false });
    const publisher = connect(a, "publisher");
    const reader = connect(b, "reader");

    await a.subscribe(publisher.id, "r1", "public:room");
    await b.subscribe(reader.id, "r2", "public:room");

    await a.broadcast(publisher.id, "r3", "public:room", "tick", { index: 1 });
    await a.broadcast(publisher.id, "r4", "public:room", "tick", { index: 2 });
    expect(broadcasts(reader.sink)).toHaveLength(0);

    const third = await a.broadcast(publisher.id, "r5", "public:room", "tick", { index: 3 });
    void third;
    await b.deliverRemote({ ...scope, channel: "public:room", sequence: 3, origin: "instance-a" });

    expect(indices(reader.sink, "index")).toEqual([1, 2, 3]);
  });

  it("ignores a reference that this instance published itself", async () => {
    const { a, connect } = cluster({ connectBus: false });
    const publisher = connect(a, "publisher");
    await a.subscribe(publisher.id, "r1", "public:room");
    await a.broadcast(publisher.id, "r2", "public:room", "message", { n: 1 });

    await a.deliverRemote({ ...scope, channel: "public:room", sequence: 1, origin: a.instanceId });

    expect(broadcasts(publisher.sink)).toHaveLength(1);
  });

  it("ignores a reference for a channel nobody on this instance subscribes to", async () => {
    const { a, b, connect } = cluster({ connectBus: false });
    const publisher = connect(a, "publisher");
    const reader = connect(b, "reader");
    await a.subscribe(publisher.id, "r1", "public:room");
    await b.subscribe(reader.id, "r2", "public:other");
    await a.broadcast(publisher.id, "r3", "public:room", "message", { n: 1 });

    await b.deliverRemote({ ...scope, channel: "public:room", sequence: 1, origin: "instance-a" });

    expect(broadcasts(reader.sink)).toHaveLength(0);
  });

  it("does not cross tenant boundaries", async () => {
    const { a, b } = cluster({ connectBus: false });
    const foreign: RealtimeScope = { ...scope, organizationId: "org-other" };
    const sink = new Sink();
    b.connect(foreign, { ...principal("reader"), organizationId: foreign.organizationId }, sink);

    await b.deliverRemote({ ...foreign, channel: "public:room", sequence: 1, origin: "instance-a" });
    void a;

    expect(broadcasts(sink)).toHaveLength(0);
  });

  it("keeps working without a bus, exactly as before", async () => {
    const eventLog = new MemoryRealtimeEventLog(20);
    const service = new RealtimeService({
      eventLog, authorization: new PrefixRealtimeAuthorization(),
      cursor: new RealtimeCursorCodec(Buffer.alloc(32, 7)),
    });
    const sink = new Sink();
    const id = service.connect(scope, principal("solo"), sink);

    await service.subscribe(id, "r1", "public:room");
    await service.broadcast(id, "r2", "public:room", "message", { n: 1 });

    expect(broadcasts(sink)).toHaveLength(1);
  });
});

describe("realtime event reference", () => {
  it("carries no payload", () => {
    const reference: RealtimeEventReference = {
      ...scope, channel: "public:room", sequence: 7, origin: "instance-a",
    };
    expect(Object.keys(reference).sort()).toEqual([
      "channel", "environment", "organizationId", "origin", "projectId", "sequence",
    ]);
  });
});
