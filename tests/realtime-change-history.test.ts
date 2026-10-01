import { describe, expect, it } from "vitest";
import { RealtimeCursorCodec } from "@/lib/server/realtime/cursor";
import type {
  RealtimeChange,
  RealtimeChangeHistory,
  RealtimeChangeReader,
} from "@/lib/server/realtime/change-source";
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

/**
 * Nachreichen auf einem `changes:`-Kanal.
 *
 * Der Fall, der hier am meisten wiegt, ist der zweite: **Ein Nachreichen, das
 * die Zeilensicherheit nicht erneut anwendet, ist ein Leck.** Alles andere hier
 * sind die Grenzen, an denen es geschlossen fallen muss.
 */

const scope: RealtimeScope = {
  organizationId: "org-history", projectId: "project-history", environment: "development",
};
const CHANNEL = "changes:public.orders";
const SECRET = Buffer.alloc(32, 19);
const NOW = new Date("2026-10-01T12:00:00.000Z");

class Sink implements RealtimeSink {
  readonly messages: RealtimeServerMessage[] = [];
  send(message: RealtimeServerMessage) { this.messages.push(structuredClone(message)); return true; }
}

function principal(role: RealtimePrincipal["role"], subject: string): RealtimePrincipal {
  return { organizationId: scope.organizationId, actorRef: `${role}:${subject}`, role, subject };
}

function feedEntry(position: number, overrides: Partial<RealtimeChange> = {}): RealtimeChange {
  return {
    ...scope,
    position,
    schema: "public",
    table: "orders",
    operation: "insert",
    key: { id: `order-${position}` },
    committedAt: new Date(NOW.getTime() - 60_000),
    ...overrides,
  };
}

/**
 * Ein Feed im Speicher, der sich wie `qkern_internal.change_feed` verhält:
 * Positionen über alle Tabellen hinweg, Schnitt nach Tabelle, Spanne nach dem
 * ganzen Feed. Die Spanne ist der Punkt, an dem eine Aufbewahrung sichtbar wird.
 */
function historySource(feed: readonly RealtimeChange[]): RealtimeChangeHistory & {
  calls: number;
} {
  const source = {
    calls: 0,
    async latestPosition() {
      return feed.reduce((highest, entry) => Math.max(highest, entry.position), 0);
    },
    async history(
      _scope: RealtimeScope, schema: string, table: string, after: number, limit: number,
      notBefore: Date,
    ) {
      source.calls += 1;
      const earliest = feed.reduce(
        (lowest, entry) => (lowest === 0 ? entry.position : Math.min(lowest, entry.position)), 0);
      const latest = feed.reduce((highest, entry) => Math.max(highest, entry.position), 0);
      const matching = feed
        .filter((entry) => entry.schema === schema && entry.table === table
          && entry.position > after)
        .sort((left, right) => left.position - right.position);
      const changes = matching.slice(0, limit);
      return Object.freeze({
        changes,
        latestPosition: latest,
        stale: after > latest
          || (earliest > 0 && after < earliest - 1)
          || matching.length > limit
          || (changes[0] !== undefined && changes[0].committedAt.getTime() < notBefore.getTime()),
      });
    },
  };
  return source;
}

/** Reader, der je Abonnent eine andere Sicht liefert — genau der kritische Fall. */
function readerFor(
  visible: Record<string, (change: RealtimeChange) => Record<string, RealtimeJson> | null>,
): RealtimeChangeReader & { subjects: string[] } {
  const reader = {
    subjects: [] as string[],
    async read(change: RealtimeChange, subscriber: { subject?: string }) {
      reader.subjects.push(subscriber.subject ?? "anon");
      return visible[subscriber.subject ?? "anon"]?.(change) ?? null;
    },
  };
  return reader;
}

function service(options: {
  history?: RealtimeChangeHistory;
  reader?: RealtimeChangeReader;
  historyLimit?: number;
  historyMaxAgeMs?: number;
} = {}) {
  let connection = 0;
  return new RealtimeService({
    eventLog: new MemoryRealtimeEventLog(20),
    authorization: new PrefixRealtimeAuthorization(),
    cursor: new RealtimeCursorCodec(SECRET),
    now: () => NOW,
    id: () => `connection-${++connection}`,
    ...(options.history ? { changeHistory: options.history } : {}),
    ...(options.reader ? { changeReader: options.reader } : {}),
    ...(options.historyLimit ? { historyLimit: options.historyLimit } : {}),
    ...(options.historyMaxAgeMs ? { historyMaxAgeMs: options.historyMaxAgeMs } : {}),
  });
}

function changes(sink: Sink) {
  return sink.messages.filter((message) => message.type === "change");
}

function subscribed(sink: Sink) {
  const message = sink.messages.find((candidate) => candidate.type === "subscribed");
  if (!message || message.type !== "subscribed") throw new Error("Missing subscribed message");
  return message;
}

describe("change history", () => {
  it("hands out a cursor on the feed position and resumes from it", async () => {
    const feed = [feedEntry(1), feedEntry(2), feedEntry(3)];
    const reader = readerFor({ alice: (change) => ({ ...change.key }) });
    const instance = service({ history: historySource(feed), reader });

    const first = new Sink();
    const alice = instance.connect(scope, principal("authenticated", "alice"), first);
    await instance.subscribe(alice, "s1", CHANNEL);
    // Ohne Cursor beginnt das Abonnement am Ende des Feeds und reicht nichts nach.
    expect(subscribed(first)).toMatchObject({ replayed: 0 });
    expect(changes(first)).toEqual([]);

    // Die Position steht im Cursor, nicht im Klartext: Er ist signiert, und bis
    // zu diesem Slice gab es ihn auf diesem Kanal gar nicht.
    const codec = new RealtimeCursorCodec(SECRET);
    expect(codec.decode(subscribed(first).cursor, scope, CHANNEL)).toBe(3);

    const resumeFrom = codec.encode(scope, CHANNEL, 1);
    const second = new Sink();
    const again = instance.connect(scope, principal("authenticated", "alice"), second);
    await instance.subscribe(again, "s2", CHANNEL, resumeFrom);
    expect(subscribed(second)).toMatchObject({ replayed: 2 });
    expect(changes(second).map((message) =>
      message.type === "change" && [message.position, message.replay]))
      .toEqual([[2, true], [3, true]]);
  });

  it("applies row level security again on every replayed row, per subscriber", async () => {
    // **Der Fall, der zaehlt.** Zwei Abonnenten, derselbe Kanal, dieselbe
    // Position -- und zwei verschiedene Teilmengen. Wer hier einmal liest und
    // das Ergebnis verteilt, hat ein Cross-Tenant-Leck gebaut, und zwar ein
    // stilles: Die Nachricht sieht aus wie eine lebende.
    const feed = [feedEntry(1), feedEntry(2), feedEntry(3)];
    const reader = readerFor({
      alice: (change) => (change.position === 2 ? { ...change.key, owner: "alice" } : null),
      bob: (change) => ({ ...change.key, owner: "bob" }),
    });
    const instance = service({ history: historySource(feed), reader });
    const codec = new RealtimeCursorCodec(SECRET);
    const cursor = codec.encode(scope, CHANNEL, 0);

    const aliceSink = new Sink();
    const alice = instance.connect(scope, principal("authenticated", "alice"), aliceSink);
    await instance.subscribe(alice, "s1", CHANNEL, cursor);

    const bobSink = new Sink();
    const bob = instance.connect(scope, principal("authenticated", "bob"), bobSink);
    await instance.subscribe(bob, "s2", CHANNEL, cursor);

    expect(subscribed(aliceSink)).toMatchObject({ replayed: 1 });
    expect(changes(aliceSink).map((message) => message.type === "change" && message.record))
      .toEqual([{ id: "order-2", owner: "alice" }]);
    // Die Zahl im `subscribed` ist seine Zahl, nicht die des Feeds: Sonst
    // verraet sie ihm, wie viele Zeilen es gibt, die er nicht sehen darf.
    expect(subscribed(bobSink)).toMatchObject({ replayed: 3 });
    expect(changes(bobSink)).toHaveLength(3);
    // Gelesen wurde je Abonnent, nicht einmal fuer beide.
    expect(reader.subjects).toEqual(["alice", "alice", "alice", "bob", "bob", "bob"]);
  });

  it("reaches a deletion only with service_role, in the replay as in the live path", async () => {
    // Dieselbe Regel wie im Livebetrieb, und sie liegt beim Leser. Der Fall
    // haelt sie fest, damit das Nachreichen sie nicht umgeht.
    const feed = [feedEntry(1, { operation: "delete" })];
    const reader: RealtimeChangeReader = {
      async read(change, subscriber) {
        if (change.operation === "delete") {
          return subscriber.role === "service_role" ? { ...change.key } : null;
        }
        return { ...change.key };
      },
    };
    const instance = service({ history: historySource(feed), reader });
    const cursor = new RealtimeCursorCodec(SECRET).encode(scope, CHANNEL, 0);

    const userSink = new Sink();
    const user = instance.connect(scope, principal("authenticated", "alice"), userSink);
    await instance.subscribe(user, "s1", CHANNEL, cursor);
    expect(changes(userSink)).toEqual([]);

    const serviceSink = new Sink();
    const robot = instance.connect(scope, principal("service_role", "robot"), serviceSink);
    await instance.subscribe(robot, "s2", CHANNEL, cursor);
    expect(changes(serviceSink)).toHaveLength(1);
  });

  it("refuses a cursor that asks for more rows than the limit instead of skipping any", async () => {
    const feed = [feedEntry(1), feedEntry(2), feedEntry(3)];
    const reader = readerFor({ alice: (change) => ({ ...change.key }) });
    const instance = service({ history: historySource(feed), reader, historyLimit: 2 });
    const cursor = new RealtimeCursorCodec(SECRET).encode(scope, CHANNEL, 0);
    const sink = new Sink();
    const alice = instance.connect(scope, principal("authenticated", "alice"), sink);
    await expect(instance.subscribe(alice, "s1", CHANNEL, cursor))
      .rejects.toMatchObject({ code: "REALTIME_CURSOR_STALE" });
    expect(changes(sink)).toEqual([]);
  });

  it("refuses a cursor whose oldest row lies beyond the age window", async () => {
    const feed = [feedEntry(1, { committedAt: new Date(NOW.getTime() - 7 * 86_400_000) })];
    const reader = readerFor({ alice: (change) => ({ ...change.key }) });
    const instance = service({
      history: historySource(feed), reader, historyMaxAgeMs: 3_600_000,
    });
    const cursor = new RealtimeCursorCodec(SECRET).encode(scope, CHANNEL, 0);
    const sink = new Sink();
    const alice = instance.connect(scope, principal("authenticated", "alice"), sink);
    await expect(instance.subscribe(alice, "s1", CHANNEL, cursor))
      .rejects.toMatchObject({ code: "REALTIME_CURSOR_STALE" });
  });

  it("refuses a cursor whose range the retention already removed, and one beyond the feed", async () => {
    // Der Feed faengt bei 5 an: Die Positionen 1 bis 4 hat die Aufbewahrung
    // genommen. Ein Cursor auf 2 kann nicht mehr vollstaendig bedient werden.
    const feed = [feedEntry(5), feedEntry(6)];
    const reader = readerFor({ alice: (change) => ({ ...change.key }) });
    const instance = service({ history: historySource(feed), reader });
    const codec = new RealtimeCursorCodec(SECRET);
    const sink = new Sink();
    const alice = instance.connect(scope, principal("authenticated", "alice"), sink);

    await expect(instance.subscribe(alice, "s1", CHANNEL, codec.encode(scope, CHANNEL, 2)))
      .rejects.toMatchObject({ code: "REALTIME_CURSOR_STALE" });
    await expect(instance.subscribe(alice, "s2", CHANNEL, codec.encode(scope, CHANNEL, 99)))
      .rejects.toMatchObject({ code: "REALTIME_CURSOR_STALE" });
    // Genau an der Kante geht es: Alles ab 5 liegt noch da.
    await expect(instance.subscribe(alice, "s3", CHANNEL, codec.encode(scope, CHANNEL, 4)))
      .resolves.toBeUndefined();
    expect(changes(sink).map((message) => message.type === "change" && message.position))
      .toEqual([5, 6]);
  });

  it("refuses a cursor from another channel and another scope", async () => {
    const feed = [feedEntry(1)];
    const reader = readerFor({ alice: (change) => ({ ...change.key }) });
    const instance = service({ history: historySource(feed), reader });
    const codec = new RealtimeCursorCodec(SECRET);
    const sink = new Sink();
    const alice = instance.connect(scope, principal("authenticated", "alice"), sink);

    await expect(instance.subscribe(alice, "s1", CHANNEL, codec.encode(scope, "changes:public.other", 0)))
      .rejects.toMatchObject({ code: "REALTIME_CURSOR_INVALID" });
    await expect(instance.subscribe(alice, "s2", CHANNEL,
      codec.encode({ ...scope, environment: "staging" }, CHANNEL, 0)))
      .rejects.toMatchObject({ code: "REALTIME_CURSOR_INVALID" });
  });

  it("refuses a cursor when no history source is configured instead of silently starting at the end", async () => {
    // Einen Cursor als "ab jetzt" zu lesen waere die verschwiegene Luecke: Der
    // Abonnent glaubte, nichts verpasst zu haben.
    const reader = readerFor({ alice: (change) => ({ ...change.key }) });
    const instance = service({ reader });
    const cursor = new RealtimeCursorCodec(SECRET).encode(scope, CHANNEL, 1);
    const sink = new Sink();
    const alice = instance.connect(scope, principal("authenticated", "alice"), sink);
    await expect(instance.subscribe(alice, "s1", CHANNEL, cursor))
      .rejects.toMatchObject({ code: "REALTIME_CURSOR_STALE" });
    // Ohne Cursor bleibt der Kanal abonnierbar: Der Poller stellt zu, sobald er laeuft.
    await expect(instance.subscribe(alice, "s2", CHANNEL)).resolves.toBeUndefined();
  });

  it("does not deliver a position twice to a connection that just caught up", async () => {
    // Die Position des Pollers laeuft unabhaengig von der eines Abonnenten. Ohne
    // die Zusage je Verbindung saehe er dieselbe Aenderung zweimal -- und zwar
    // genau dann, wenn sein Cursor von einer Instanz kam, die weiter war.
    const feed = [feedEntry(1), feedEntry(2), feedEntry(3)];
    const reader = readerFor({ alice: (change) => ({ ...change.key }) });
    const instance = service({ history: historySource(feed), reader });
    const cursor = new RealtimeCursorCodec(SECRET).encode(scope, CHANNEL, 0);
    const sink = new Sink();
    const alice = instance.connect(scope, principal("authenticated", "alice"), sink);
    await instance.subscribe(alice, "s1", CHANNEL, cursor);
    expect(changes(sink)).toHaveLength(3);

    // Der Poller kommt mit demselben Bereich noch einmal.
    await instance.deliverChanges(feed);
    expect(changes(sink)).toHaveLength(3);

    // Was danach kommt, kommt an.
    await instance.deliverChanges([feedEntry(4)]);
    expect(changes(sink).map((message) => message.type === "change" && message.position))
      .toEqual([1, 2, 3, 4]);
  });

  it("marks a live change as not replayed and gives it a cursor on its own position", async () => {
    const reader = readerFor({ alice: (change) => ({ ...change.key }) });
    const instance = service({ reader });
    const sink = new Sink();
    const alice = instance.connect(scope, principal("authenticated", "alice"), sink);
    await instance.subscribe(alice, "s1", CHANNEL);
    await instance.deliverChanges([feedEntry(7)]);
    const message = changes(sink)[0];
    expect(message.type === "change" && message.replay).toBe(false);
    expect(message.type === "change"
      && new RealtimeCursorCodec(SECRET).decode(message.cursor, scope, CHANNEL)).toBe(7);
  });
});
