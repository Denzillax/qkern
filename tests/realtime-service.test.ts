import { describe, expect, it } from "vitest";
import { RealtimeCursorCodec } from "@/lib/server/realtime/cursor";
import type {
  RealtimePrincipal,
  RealtimeScope,
  RealtimeServerMessage,
  RealtimeSink,
} from "@/lib/server/realtime/model";
import { PrefixRealtimeAuthorization } from "@/lib/server/realtime/policy";
import { MemoryRealtimeEventLog } from "@/lib/server/realtime/repository";
import { RealtimeService } from "@/lib/server/realtime/service";

const scope: RealtimeScope = {
  organizationId: "org-realtime", projectId: "project-realtime", environment: "development",
};

class Sink implements RealtimeSink {
  readonly messages: RealtimeServerMessage[] = [];
  send(message: RealtimeServerMessage) { this.messages.push(structuredClone(message)); return true; }
}

function principal(
  role: RealtimePrincipal["role"],
  subject = role === "authenticated" ? "alice" : `${role}-key`,
  organizationId = scope.organizationId,
): RealtimePrincipal {
  return { organizationId, actorRef: `${role}:${subject}`, role, subject };
}

function fixture(options: {
  history?: number;
  maxSubscriptions?: number;
  maxPayloadBytes?: number;
  replayLimit?: number;
} = {}) {
  let connection = 0;
  let event = 0;
  const service = new RealtimeService({
    eventLog: new MemoryRealtimeEventLog(options.history ?? 20),
    authorization: new PrefixRealtimeAuthorization(),
    cursor: new RealtimeCursorCodec(Buffer.alloc(32, 7)),
    now: () => new Date(`2026-08-04T12:00:${String(event++).padStart(2, "0")}.000Z`),
    id: () => `connection-${++connection}`,
    maxSubscriptionsPerConnection: options.maxSubscriptions,
    maxPayloadBytes: options.maxPayloadBytes,
    replayLimit: options.replayLimit,
  });
  return { service, connect: (who: RealtimePrincipal, at = scope) => {
    const sink = new Sink();
    const id = service.connect(at, who, sink);
    return { id, sink };
  } };
}

function latest<T extends RealtimeServerMessage["type"]>(sink: Sink, type: T) {
  const message = [...sink.messages].reverse().find((candidate) => candidate.type === type);
  if (!message) throw new Error(`Missing ${type} message`);
  return message as Extract<RealtimeServerMessage, { type: T }>;
}

describe("Realtime service", () => {
  it("enforces channel policy and isolates organization, project and environment scopes", async () => {
    const { service, connect } = fixture();
    const anonymous = connect(principal("anon"));
    await service.subscribe(anonymous.id, "sub-public", "public:news");
    await expect(service.subscribe(anonymous.id, "sub-private", "private:news"))
      .rejects.toMatchObject({ code: "REALTIME_ACCESS_DENIED" });
    await expect(service.broadcast(anonymous.id, "send-anon", "public:news", "update", {}))
      .rejects.toMatchObject({ code: "REALTIME_ACCESS_DENIED" });

    const alice = connect(principal("authenticated", "alice"));
    await service.subscribe(alice.id, "sub-alice", "user:alice:inbox");
    await expect(service.subscribe(alice.id, "sub-bob", "user:bob:inbox"))
      .rejects.toMatchObject({ code: "REALTIME_ACCESS_DENIED" });

    const otherScope: RealtimeScope = { ...scope, organizationId: "org-other" };
    const other = connect(principal("authenticated", "alice", otherScope.organizationId), otherScope);
    await service.subscribe(other.id, "other-sub", "public:news");
    const publisher = connect(principal("authenticated", "publisher"));
    await service.subscribe(publisher.id, "publisher-sub", "public:news");
    await service.broadcast(publisher.id, "send-1", "public:news", "update", { value: 1 });

    expect(latest(anonymous.sink, "broadcast")).toMatchObject({ payload: { value: 1 }, replay: false });
    expect(other.sink.messages.some((message) => message.type === "broadcast")).toBe(false);
  });

  it("preserves live order and replays only events after a scope-bound signed cursor", async () => {
    const { service, connect } = fixture();
    const publisher = connect(principal("authenticated", "publisher"));
    await service.subscribe(publisher.id, "sub-publisher", "private:orders");
    await service.broadcast(publisher.id, "send-1", "private:orders", "created", { order: 1 });
    await service.broadcast(publisher.id, "send-2", "private:orders", "created", { order: 2 });
    const live = publisher.sink.messages.filter((message) => message.type === "broadcast");
    expect(live.map((message) => message.payload)).toEqual([{ order: 1 }, { order: 2 }]);

    const replayed = connect(principal("authenticated", "reader"));
    await service.subscribe(replayed.id, "sub-replay", "private:orders", live[0].cursor);
    expect(replayed.sink.messages.map((message) => message.type)).toEqual(["subscribed", "broadcast"]);
    expect(latest(replayed.sink, "broadcast")).toMatchObject({ payload: { order: 2 }, replay: true });

    const tampered = `${live[0].cursor.slice(0, -1)}X`;
    const invalid = connect(principal("authenticated", "reader-2"));
    await expect(service.subscribe(invalid.id, "bad-signature", "private:orders", tampered))
      .rejects.toMatchObject({ code: "REALTIME_CURSOR_INVALID" });
    await expect(service.subscribe(invalid.id, "wrong-channel", "private:other", live[0].cursor))
      .rejects.toMatchObject({ code: "REALTIME_CURSOR_INVALID" });
  });

  it("rejects cursors older than the bounded event history", async () => {
    const { service, connect } = fixture({ history: 2 });
    const publisher = connect(principal("authenticated", "publisher"));
    await service.subscribe(publisher.id, "initial", "private:history");
    const cursorZero = latest(publisher.sink, "subscribed").cursor;
    for (let index = 1; index <= 3; index += 1) {
      await service.broadcast(publisher.id, `send-${index}`, "private:history", "changed", { index });
    }
    const reader = connect(principal("authenticated", "reader"));
    await expect(service.subscribe(reader.id, "stale", "private:history", cursorZero))
      .rejects.toMatchObject({ code: "REALTIME_CURSOR_STALE" });
  });

  it("fails closed instead of silently skipping events when replay exceeds its bound", async () => {
    const { service, connect } = fixture({ history: 10, replayLimit: 2 });
    const publisher = connect(principal("authenticated", "publisher"));
    await service.subscribe(publisher.id, "initial", "private:bounded");
    const cursorZero = latest(publisher.sink, "subscribed").cursor;
    for (let index = 1; index <= 3; index += 1) {
      await service.broadcast(publisher.id, `send-${index}`, "private:bounded", "changed", { index });
    }
    const reader = connect(principal("authenticated", "reader"));
    await expect(service.subscribe(reader.id, "bounded", "private:bounded", cursorZero))
      .rejects.toMatchObject({ code: "REALTIME_CURSOR_STALE" });
    expect(reader.sink.messages).toEqual([]);
  });

  it("tracks private presence keys, snapshots joins and emits leaves on disconnect", async () => {
    const { service, connect } = fixture();
    const alice = connect(principal("authenticated", "alice"));
    const bob = connect(principal("authenticated", "bob"));
    await service.subscribe(alice.id, "alice-sub", "private:room");
    await service.subscribe(bob.id, "bob-sub", "private:room");
    await service.trackPresence(alice.id, "alice-track", "private:room", { online: true });

    const joined = latest(bob.sink, "presence");
    expect(joined.joins).toHaveLength(1);
    expect(joined.joins[0].presenceKey).toMatch(/^qk_presence_/);
    expect(JSON.stringify(joined)).not.toContain("alice");

    const late = connect(principal("authenticated", "charlie"));
    await service.subscribe(late.id, "late-sub", "private:room");
    expect(latest(late.sink, "presence").joins).toHaveLength(1);
    await service.disconnect(alice.id);
    expect(latest(bob.sink, "presence").leaves).toEqual([joined.joins[0].presenceKey]);

    const anonymous = connect(principal("anon"));
    await service.subscribe(anonymous.id, "anon-sub", "public:lobby");
    await expect(service.trackPresence(anonymous.id, "anon-track", "public:lobby", { online: true }))
      .rejects.toMatchObject({ code: "REALTIME_ACCESS_DENIED" });
    const elevated = connect(principal("service_role"));
    await service.subscribe(elevated.id, "service-sub", "private:room");
    await expect(service.trackPresence(elevated.id, "service-track", "private:room", { online: true }))
      .rejects.toMatchObject({ code: "REALTIME_ACCESS_DENIED" });
  });

  it("does not publish ghost presence when disconnect wins an authorization race", async () => {
    let release!: () => void;
    let startedResolve!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { startedResolve = resolve; });
    const prefix = new PrefixRealtimeAuthorization();
    const service = new RealtimeService({
      eventLog: new MemoryRealtimeEventLog(),
      authorization: {
        async authorize(input) {
          if (input.action === "presence" && input.principal.subject === "alice") {
            startedResolve();
            await blocked;
          }
          return await prefix.authorize(input);
        },
      },
      cursor: new RealtimeCursorCodec(Buffer.alloc(32, 8)),
    });
    const aliceSink = new Sink();
    const bobSink = new Sink();
    const aliceId = service.connect(scope, principal("authenticated", "alice"), aliceSink, "alice-connection");
    const bobId = service.connect(scope, principal("authenticated", "bob"), bobSink, "bob-connection");
    await service.subscribe(aliceId, "alice-sub", "private:race");
    await service.subscribe(bobId, "bob-sub", "private:race");
    const tracking = service.trackPresence(aliceId, "alice-track", "private:race", { online: true });
    await started;
    await service.disconnect(aliceId);
    release();
    await expect(tracking).rejects.toMatchObject({ code: "REALTIME_AUTH_REQUIRED" });
    expect(bobSink.messages.some((message) => message.type === "presence")).toBe(false);
  });

  it("bounds subscriptions and rejects invalid events, oversized or unsafe payloads", async () => {
    const { service, connect } = fixture({ maxSubscriptions: 1, maxPayloadBytes: 256 });
    const client = connect(principal("authenticated"));
    await service.subscribe(client.id, "sub-one", "private:one");
    await expect(service.subscribe(client.id, "sub-two", "private:two"))
      .rejects.toMatchObject({ code: "REALTIME_CHANNEL_LIMIT" });
    await expect(service.broadcast(client.id, "invalid-event", "private:one", "Invalid Event", {}))
      .rejects.toMatchObject({ code: "REALTIME_INVALID_MESSAGE" });
    await expect(service.broadcast(client.id, "oversized", "private:one", "update", { value: "x".repeat(300) }))
      .rejects.toMatchObject({ code: "REALTIME_PAYLOAD_TOO_LARGE" });
    await expect(service.broadcast(
      client.id, "unsafe", "private:one", "update", JSON.parse('{"__proto__":"blocked"}'),
    )).rejects.toMatchObject({ code: "REALTIME_INVALID_MESSAGE" });
  });
});
