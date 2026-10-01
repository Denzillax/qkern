import { describe, expect, it } from "vitest";
import { RealtimeCursorCodec } from "@/lib/server/realtime/cursor";
import { MemoryRealtimeEventBus } from "@/lib/server/realtime/event-bus";
import type {
  RealtimePrincipal,
  RealtimeScope,
  RealtimeServerMessage,
  RealtimeSink,
} from "@/lib/server/realtime/model";
import { PrefixRealtimeAuthorization } from "@/lib/server/realtime/policy";
import { MemoryRealtimePresenceStore } from "@/lib/server/realtime/presence-store";
import { MemoryRealtimeEventLog } from "@/lib/server/realtime/repository";
import { RealtimeRetentionRuntime } from "@/lib/server/realtime/retention-runtime";
import { RealtimeService } from "@/lib/server/realtime/service";

/**
 * Dauerhafte Presence, und zwar genau die Fragen, die sie stellt.
 *
 * Presence ist die einzige Angabe im Produkt, die etwas Lebendes behauptet.
 * Darum hängt alles hier an einer Uhr, die der Fall selbst stellt: Eine Pacht,
 * die man nicht ablaufen lassen kann, ist keine.
 */

const scope: RealtimeScope = {
  organizationId: "org-presence", projectId: "project-presence", environment: "development",
};
const CHANNEL = "public:lobby";
const LEASE_MS = 30_000;

class Sink implements RealtimeSink {
  readonly messages: RealtimeServerMessage[] = [];
  send(message: RealtimeServerMessage) { this.messages.push(structuredClone(message)); return true; }
}

function principal(subject: string): RealtimePrincipal {
  return {
    organizationId: scope.organizationId, actorRef: `authenticated:${subject}`,
    role: "authenticated", subject,
  };
}

function presenceMessages(sink: Sink) {
  return sink.messages.filter((message) => message.type === "presence");
}

/**
 * Eine Instanz über einem geteilten Store und einer geteilten Uhr. Beides geteilt
 * zu halten ist der ganze Punkt: Zwei Instanzen, die sich dieselbe Tabelle und
 * dieselbe Zeit teilen, sind der Mehrinstanzbetrieb im Kleinen.
 */
function instance(
  name: string,
  presence: MemoryRealtimePresenceStore,
  clock: { now: Date },
  bus?: MemoryRealtimeEventBus,
) {
  let connection = 0;
  const service = new RealtimeService({
    eventLog: new MemoryRealtimeEventLog(20),
    authorization: new PrefixRealtimeAuthorization(),
    cursor: new RealtimeCursorCodec(Buffer.alloc(32, 11)),
    presence,
    presenceLeaseMs: LEASE_MS,
    instanceId: name,
    now: () => new Date(clock.now),
    id: () => `${name}-connection-${++connection}`,
    ...(bus ? { eventBus: bus } : {}),
  });
  bus?.subscribeAs(
    name,
    (reference) => { void service.deliverRemote(reference); },
    (reference) => { void service.deliverRemotePresence(reference); },
  );
  return {
    service,
    connect(subject: string) {
      const sink = new Sink();
      const id = service.connect(scope, principal(subject), sink);
      return { id, sink };
    },
  };
}

describe("durable presence", () => {
  it("survives a restart of the process that wrote it", async () => {
    const store = new MemoryRealtimePresenceStore();
    const clock = { now: new Date("2026-10-01T10:00:00.000Z") };

    const first = instance("instance-a", store, clock);
    const alice = first.connect("alice");
    await first.service.subscribe(alice.id, "s1", CHANNEL);
    await first.service.trackPresence(alice.id, "t1", CHANNEL, { typing: true });

    // Der Prozess ist weg. Nicht `disconnect`: Das waere eine Abmeldung, und die
    // ist der andere Fall. Hier stirbt die Instanz, und ihre Verbindungen mit
    // ihr.
    const second = instance("instance-b", store, clock);
    const bob = second.connect("bob");
    await second.service.subscribe(bob.id, "s2", CHANNEL);

    const snapshot = presenceMessages(bob.sink);
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({ channel: CHANNEL, leaves: [] });
    expect(snapshot[0].type === "presence" && snapshot[0].joins).toHaveLength(1);
    expect(snapshot[0].type === "presence" && snapshot[0].joins[0].state).toEqual({ typing: true });
  });

  it("merges the subscribers of two instances into one snapshot and one delta", async () => {
    const store = new MemoryRealtimePresenceStore();
    const clock = { now: new Date("2026-10-01T10:00:00.000Z") };
    const bus = new MemoryRealtimeEventBus();
    const a = instance("instance-a", store, clock, bus);
    const b = instance("instance-b", store, clock, bus);

    const alice = a.connect("alice");
    await a.service.subscribe(alice.id, "s1", CHANNEL);
    await a.service.trackPresence(alice.id, "t1", CHANNEL, { seat: 1 });

    const bob = b.connect("bob");
    await b.service.subscribe(bob.id, "s2", CHANNEL);
    // Der Schnappschuss der zweiten Instanz traegt den Abonnenten der ersten.
    // Bis zu diesem Slice las er die Verbindungen seines eigenen Prozesses und
    // war damit leer.
    expect(presenceMessages(bob.sink)).toHaveLength(1);

    await b.service.trackPresence(bob.id, "t2", CHANNEL, { seat: 2 });
    // Und die erste Instanz erfaehrt den Beitritt in der zweiten, ueber den Bus.
    const delta = presenceMessages(alice.sink).at(-1);
    expect(delta?.type === "presence" && delta.joins.map((entry) => entry.state))
      .toEqual([{ seat: 2 }]);
    expect(delta?.type === "presence" && delta.leaves).toEqual([]);
  });

  it("lets the entry of a connection that vanished without a goodbye expire and reports the leave", async () => {
    // **Die Frage dieses Slices.** Eine Verbindung, die ohne Abmeldung
    // verschwindet, hinterlaesst einen Eintrag, den niemand mehr erneuert. Ein
    // Eintrag, der ewig bliebe, zeigte Leute an, die nicht da sind, und das ist
    // schlimmer als keine Presence.
    const store = new MemoryRealtimePresenceStore();
    const clock = { now: new Date("2026-10-01T10:00:00.000Z") };
    const a = instance("instance-a", store, clock);
    const b = instance("instance-b", store, clock);

    const ghost = a.connect("ghost");
    await a.service.subscribe(ghost.id, "s1", CHANNEL);
    await a.service.trackPresence(ghost.id, "t1", CHANNEL, { online: true });

    const watcher = b.connect("watcher");
    await b.service.subscribe(watcher.id, "s2", CHANNEL);
    expect(presenceMessages(watcher.sink)).toHaveLength(1);

    // Die Instanz, die die Verbindung hielt, antwortet nicht mehr. Nur die Uhr
    // laeuft weiter.
    clock.now = new Date(clock.now.getTime() + LEASE_MS + 1_000);

    // Der Takt der ueberlebenden Instanz sammelt die Waise ein.
    await b.service.sweepPresence();
    const leave = presenceMessages(watcher.sink).at(-1);
    expect(leave?.type === "presence" && leave.joins).toEqual([]);
    expect(leave?.type === "presence" && leave.leaves).toHaveLength(1);

    // Und ein Abonnent, der danach kommt, sieht gar niemanden mehr.
    const late = b.connect("late");
    await b.service.subscribe(late.id, "s3", CHANNEL);
    expect(presenceMessages(late.sink)).toEqual([]);
  });

  it("keeps a live subscriber present across the lease because its own tick renews it", async () => {
    // Die Gegenprobe zum Ablauf. Ohne sie wuerde eine Pacht, die niemand
    // erneuert, als "Presence laeuft ab" durchgehen -- und Presence liefe
    // staendig ab.
    const store = new MemoryRealtimePresenceStore();
    const clock = { now: new Date("2026-10-01T10:00:00.000Z") };
    const a = instance("instance-a", store, clock);
    const alice = a.connect("alice");
    await a.service.subscribe(alice.id, "s1", CHANNEL);
    await a.service.trackPresence(alice.id, "t1", CHANNEL, { online: true });

    for (let tick = 0; tick < 4; tick += 1) {
      clock.now = new Date(clock.now.getTime() + LEASE_MS / 2);
      const swept = await a.service.sweepPresence();
      expect(swept.renewed).toBe(1);
    }
    // Zwei Pachtlaengen spaeter steht sie noch, und kein Leave ist gefallen.
    expect(await store.list(scope, CHANNEL, clock.now, 10)).toHaveLength(1);
    expect(presenceMessages(alice.sink).some((message) =>
      message.type === "presence" && message.leaves.length > 0)).toBe(false);
  });

  it("takes the entry away at once when the connection says goodbye", async () => {
    const store = new MemoryRealtimePresenceStore();
    const clock = { now: new Date("2026-10-01T10:00:00.000Z") };
    const a = instance("instance-a", store, clock);
    const alice = a.connect("alice");
    await a.service.subscribe(alice.id, "s1", CHANNEL);
    await a.service.trackPresence(alice.id, "t1", CHANNEL, { online: true });
    expect(await store.list(scope, CHANNEL, clock.now, 10)).toHaveLength(1);

    // Ein geschlossener Socket ist eine Abmeldung. Auf die Pacht zu warten hiesse,
    // eine halbe Minute jemanden anzuzeigen, von dem der Prozess gerade erfahren
    // hat, dass er weg ist.
    await a.service.disconnect(alice.id);
    expect(await store.list(scope, CHANNEL, clock.now, 10)).toEqual([]);
  });

  it("reports a changed state as a join under the same key, and not twice when nothing changed", async () => {
    const store = new MemoryRealtimePresenceStore();
    const clock = { now: new Date("2026-10-01T10:00:00.000Z") };
    const a = instance("instance-a", store, clock);
    const alice = a.connect("alice");
    const bob = a.connect("bob");
    await a.service.subscribe(alice.id, "s1", CHANNEL);
    await a.service.subscribe(bob.id, "s2", CHANNEL);
    await a.service.trackPresence(alice.id, "t1", CHANNEL, { seat: 1, typing: false });
    const after = presenceMessages(bob.sink).length;

    // Derselbe Zustand, nur andere Schluesselreihenfolge: kein Join. Ohne eine
    // vergleichbare Fassung machte jeder Takt daraus einen.
    await a.service.trackPresence(alice.id, "t2", CHANNEL, { typing: false, seat: 1 });
    expect(presenceMessages(bob.sink)).toHaveLength(after);

    await a.service.trackPresence(alice.id, "t3", CHANNEL, { seat: 1, typing: true });
    const delta = presenceMessages(bob.sink).at(-1);
    expect(delta?.type === "presence" && delta.joins.map((entry) => entry.state))
      .toEqual([{ seat: 1, typing: true }]);
    expect(delta?.type === "presence" && delta.leaves).toEqual([]);
  });

  it("removes the orphan row only a grace after the lease ran out", async () => {
    const store = new MemoryRealtimePresenceStore();
    const clock = { now: new Date("2026-10-01T10:00:00.000Z") };
    const a = instance("instance-a", store, clock);
    const ghost = a.connect("ghost");
    await a.service.subscribe(ghost.id, "s1", CHANNEL);
    await a.service.trackPresence(ghost.id, "t1", CHANNEL, { online: true });

    const retention = () => new RealtimeRetentionRuntime({
      eventLog: { async prune() { return 0; } },
      presence: store,
      scopes: [scope],
      eventRetentionMs: 60_000,
      changeRetentionMs: 60_000,
      presenceRetentionMs: 600_000,
      now: () => new Date(clock.now),
    });

    // Abgelaufen, aber innerhalb der Frist: Die Zeile steht noch, und sie zaehlt
    // trotzdem fuer niemanden mehr. Zwei Stufen, und beide noetig.
    clock.now = new Date(clock.now.getTime() + LEASE_MS + 60_000);
    expect(await store.list(scope, CHANNEL, clock.now, 10)).toEqual([]);
    await expect(retention().runOnce()).resolves.toEqual({ events: 0, changes: 0, presence: 0 });

    // Eine Frist spaeter ist sie weg.
    clock.now = new Date(clock.now.getTime() + 600_000);
    await expect(retention().runOnce()).resolves.toEqual({ events: 0, changes: 0, presence: 1 });
    await expect(retention().runOnce()).resolves.toEqual({ events: 0, changes: 0, presence: 0 });
  });

  it("lets no instance renew the lease of a connection it does not hold", async () => {
    // Ohne diese Grenze koennte eine Instanz die Waisen einer anderen beliebig
    // lange am Leben halten, und die Pacht waere wirkungslos.
    const store = new MemoryRealtimePresenceStore();
    const clock = { now: new Date("2026-10-01T10:00:00.000Z") };
    const a = instance("instance-a", store, clock);
    const alice = a.connect("alice");
    await a.service.subscribe(alice.id, "s1", CHANNEL);
    await a.service.trackPresence(alice.id, "t1", CHANNEL, { online: true });
    const key = (await store.list(scope, CHANNEL, clock.now, 10))[0].presenceKey;

    await expect(store.renew(
      scope, CHANNEL, "instance-b", [key], new Date(clock.now.getTime() + 86_400_000),
    )).resolves.toBe(0);
    await expect(store.renew(
      scope, CHANNEL, "instance-a", [key], new Date(clock.now.getTime() + 86_400_000),
    )).resolves.toBe(1);
  });

  it("keeps presence inside its own scope", async () => {
    const store = new MemoryRealtimePresenceStore();
    const clock = { now: new Date("2026-10-01T10:00:00.000Z") };
    const a = instance("instance-a", store, clock);
    const alice = a.connect("alice");
    await a.service.subscribe(alice.id, "s1", CHANNEL);
    await a.service.trackPresence(alice.id, "t1", CHANNEL, { online: true });

    const other: RealtimeScope = { ...scope, environment: "staging" };
    expect(await store.list(other, CHANNEL, clock.now, 10)).toEqual([]);
    expect(await store.list({ ...scope, projectId: "other" }, CHANNEL, clock.now, 10)).toEqual([]);
    expect(await store.list(scope, "public:other", clock.now, 10)).toEqual([]);
  });
});
