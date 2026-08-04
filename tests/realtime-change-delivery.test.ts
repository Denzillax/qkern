import { describe, expect, it } from "vitest";
import { RealtimeCursorCodec } from "@/lib/server/realtime/cursor";
import type { RealtimeChange, RealtimeChangeReader } from "@/lib/server/realtime/change-source";
import type {
  RealtimeJson,
  RealtimePrincipal,
  RealtimeScope,
  RealtimeServerMessage,
  RealtimeSink,
} from "@/lib/server/realtime/model";
import { PrefixRealtimeAuthorization } from "@/lib/server/realtime/policy";
import { MemoryRealtimeEventLog } from "@/lib/server/realtime/repository";
import { RealtimeService } from "@/lib/server/realtime/service";

const scope: RealtimeScope = {
  organizationId: "org-1", projectId: "project-1", environment: "development",
};
const CHANNEL = "changes:public.items";

class Sink implements RealtimeSink {
  readonly messages: RealtimeServerMessage[] = [];
  constructor(private readonly accept = true) {}
  send(message: RealtimeServerMessage) {
    this.messages.push(structuredClone(message));
    return this.accept;
  }
}

function principal(role: RealtimePrincipal["role"], subject: string): RealtimePrincipal {
  return { organizationId: scope.organizationId, actorRef: `${role}:${subject}`, role, subject };
}

function change(overrides: Partial<RealtimeChange> = {}): RealtimeChange {
  return {
    ...scope,
    position: 1,
    schema: "public",
    table: "items",
    operation: "insert",
    key: { id: "row-1" },
    committedAt: new Date("2026-08-04T12:00:00.000Z"),
    ...overrides,
  };
}

/** Reader, der je Abonnent eine andere Sicht liefert — genau der kritische Fall. */
function readerFor(visible: Record<string, Record<string, RealtimeJson> | null>): RealtimeChangeReader {
  return {
    async read(_change, subscriber) {
      return visible[subscriber.subject ?? "anon"] ?? null;
    },
  };
}

function service(changeReader?: RealtimeChangeReader) {
  let connection = 0;
  return new RealtimeService({
    eventLog: new MemoryRealtimeEventLog(20),
    authorization: new PrefixRealtimeAuthorization(),
    cursor: new RealtimeCursorCodec(Buffer.alloc(32, 3)),
    id: () => `connection-${++connection}`,
    changeReader,
  });
}

function changes(sink: Sink) {
  return sink.messages.filter((message) => message.type === "change");
}

describe("change channel policy", () => {
  it("lets authenticated and service_role subscribe", async () => {
    const instance = service(readerFor({ alice: { id: "row-1" } }));
    const sink = new Sink();
    const id = instance.connect(scope, principal("authenticated", "alice"), sink);
    await expect(instance.subscribe(id, "r1", CHANNEL)).resolves.toBeUndefined();
  });

  it("refuses an anonymous subscriber", async () => {
    // RLS wuerde zwar ohnehin nichts ausliefern, aber schon der Takt der
    // Aenderungen verraet Schreibaktivitaet.
    const instance = service(readerFor({}));
    const id = instance.connect(scope, principal("anon", "anon-key"), new Sink());
    await expect(instance.subscribe(id, "r1", CHANNEL)).rejects.toMatchObject({
      code: "REALTIME_ACCESS_DENIED",
    });
  });

  it("refuses a broadcast onto a change channel", async () => {
    // Sonst liesse sich eine Aenderung vortaeuschen, die nie stattfand.
    const instance = service(readerFor({}));
    const sink = new Sink();
    const id = instance.connect(scope, principal("service_role", "worker"), sink);
    await instance.subscribe(id, "r1", CHANNEL);
    await expect(instance.broadcast(id, "r2", CHANNEL, "forged", { fake: true }))
      .rejects.toMatchObject({ code: "REALTIME_ACCESS_DENIED" });
  });
});

describe("change delivery", () => {
  it("delivers the row a subscriber may see", async () => {
    const instance = service(readerFor({ alice: { id: "row-1", label: "visible" } }));
    const sink = new Sink();
    const id = instance.connect(scope, principal("authenticated", "alice"), sink);
    await instance.subscribe(id, "r1", CHANNEL);

    const closed = await instance.deliverChanges([change()]);

    expect(closed).toEqual([]);
    expect(changes(sink)).toHaveLength(1);
    expect(changes(sink)[0]).toMatchObject({
      channel: CHANNEL, schema: "public", table: "items", operation: "insert", position: 1,
      record: { id: "row-1", label: "visible" },
    });
  });

  it("gives two subscribers of one channel different subsets", async () => {
    // Der entscheidende Fall: ein gemeinsamer Fan-out waere hier ein Leck.
    const instance = service(readerFor({
      alice: { id: "row-1", label: "for alice" },
      bob: null,
    }));
    const aliceSink = new Sink();
    const bobSink = new Sink();
    const alice = instance.connect(scope, principal("authenticated", "alice"), aliceSink);
    const bob = instance.connect(scope, principal("authenticated", "bob"), bobSink);
    await instance.subscribe(alice, "r1", CHANNEL);
    await instance.subscribe(bob, "r2", CHANNEL);

    await instance.deliverChanges([change()]);

    expect(changes(aliceSink)).toHaveLength(1);
    expect(changes(bobSink)).toHaveLength(0);
  });

  it("delivers nothing without a configured reader", async () => {
    const instance = service();
    const sink = new Sink();
    const id = instance.connect(scope, principal("authenticated", "alice"), sink);
    await instance.subscribe(id, "r1", CHANNEL);

    expect(await instance.deliverChanges([change()])).toEqual([]);
    expect(changes(sink)).toHaveLength(0);
  });

  it("reports a backpressured subscriber instead of skipping events", async () => {
    const instance = service(readerFor({ alice: { id: "row-1" } }));
    const sink = new Sink(false);
    const id = instance.connect(scope, principal("authenticated", "alice"), sink);
    await instance.subscribe(id, "r1", CHANNEL);

    const closed = await instance.deliverChanges([change(), change({ position: 2 })]);

    expect(closed).toEqual([id]);
    expect(sink.messages.some((message) =>
      message.type === "error" && message.code === "REALTIME_BACKPRESSURE")).toBe(true);
    // Nach dem Rueckstau wird nicht weiter zugestellt, sondern geschlossen.
    expect(changes(sink)).toHaveLength(1);
  });

  it("does not deliver a change to a different organization", async () => {
    const instance = service(readerFor({ alice: { id: "row-1" } }));
    const sink = new Sink();
    const id = instance.connect(scope, principal("authenticated", "alice"), sink);
    await instance.subscribe(id, "r1", CHANNEL);

    await instance.deliverChanges([change({ organizationId: "org-other" })]);

    expect(changes(sink)).toHaveLength(0);
  });

  it("does not deliver a change for a table nobody subscribes to", async () => {
    const instance = service(readerFor({ alice: { id: "row-1" } }));
    const sink = new Sink();
    const id = instance.connect(scope, principal("authenticated", "alice"), sink);
    await instance.subscribe(id, "r1", CHANNEL);

    await instance.deliverChanges([change({ table: "other" })]);

    expect(changes(sink)).toHaveLength(0);
  });
});
