import { randomBytes, randomUUID } from "node:crypto";
import { RealtimeCursorCodec } from "@/lib/server/realtime/cursor";
import type {
  RealtimeJson,
  RealtimePresenceEntry,
  RealtimePrincipal,
  RealtimeScope,
  RealtimeServerMessage,
  RealtimeSink,
  RealtimeStoredEvent,
} from "@/lib/server/realtime/model";
import { RealtimeError } from "@/lib/server/realtime/model";
import { assertRealtimeChannel, type RealtimeAuthorizationPort } from "@/lib/server/realtime/policy";
import type {
  RealtimeChange,
  RealtimeChangeReader,
} from "@/lib/server/realtime/change-source";
import type { RealtimeEventBus, RealtimeEventReference } from "@/lib/server/realtime/event-bus";
import type { RealtimeEventLog } from "@/lib/server/realtime/repository";

type Connection = {
  id: string;
  scope: RealtimeScope;
  principal: RealtimePrincipal;
  sink: RealtimeSink;
  subscriptions: Set<string>;
  presence: Map<string, RealtimePresenceEntry>;
};

export type RealtimeServiceOptions = {
  eventLog: RealtimeEventLog;
  authorization: RealtimeAuthorizationPort;
  /**
   * Optionale instanzübergreifende Zustellung. Ohne Bus verhält sich der Dienst
   * exakt wie zuvor: ein Broadcast erreicht ausschließlich Verbindungen dieses
   * Prozesses. Mit Bus erreicht er zusätzlich jede andere Instanz, die
   * denselben Event-Log liest.
   */
  eventBus?: RealtimeEventBus;
  /**
   * Liest eine geänderte Zeile mit den Claims eines Abonnenten. Ohne Reader
   * werden `changes:`-Kanäle nicht beliefert; ein Abonnement bleibt dann leer,
   * statt ungeprüfte Daten auszuliefern.
   */
  changeReader?: RealtimeChangeReader;
  /** Kennung dieser Instanz. Verhindert, dass ein eigenes Ereignis doppelt ankommt. */
  instanceId?: string;
  cursor?: RealtimeCursorCodec;
  now?: () => Date;
  id?: () => string;
  maxSubscriptionsPerConnection?: number;
  replayLimit?: number;
  maxPayloadBytes?: number;
  maxPresenceBytes?: number;
  heartbeatSeconds?: number;
};

export class RealtimeService {
  readonly instanceId: string;
  private readonly connections = new Map<string, Connection>();
  private readonly locks = new Map<string, Promise<void>>();
  /** Zuletzt an lokale Abonnenten zugestellte Sequenz je Kanal. */
  private readonly delivered = new Map<string, number>();
  private readonly cursor: RealtimeCursorCodec;
  private readonly now: () => Date;
  private readonly id: () => string;
  private readonly maxSubscriptions: number;
  private readonly replayLimit: number;
  private readonly maxPayloadBytes: number;
  private readonly maxPresenceBytes: number;
  readonly heartbeatSeconds: number;

  constructor(private readonly options: RealtimeServiceOptions) {
    this.instanceId = options.instanceId ?? randomUUID();
    this.cursor = options.cursor ?? new RealtimeCursorCodec(randomBytes(32));
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? (() => randomUUID());
    this.maxSubscriptions = bounded(options.maxSubscriptionsPerConnection ?? 32, 1, 128);
    this.replayLimit = bounded(options.replayLimit ?? 100, 1, 500);
    this.maxPayloadBytes = bounded(options.maxPayloadBytes ?? 16 * 1024, 256, 256 * 1024);
    this.maxPresenceBytes = bounded(options.maxPresenceBytes ?? 4 * 1024, 128, 32 * 1024);
    this.heartbeatSeconds = bounded(options.heartbeatSeconds ?? 30, 5, 120);
  }

  connect(scope: RealtimeScope, principal: RealtimePrincipal, sink: RealtimeSink, connectionId = this.id()) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(connectionId) || this.connections.has(connectionId) ||
        principal.organizationId !== scope.organizationId || !principal.actorRef ||
        principal.actorRef.length > 320 || !principal.subject || principal.subject.length > 320) {
      throw new RealtimeError("REALTIME_AUTH_FAILED");
    }
    this.connections.set(connectionId, {
      id: connectionId, scope: { ...scope }, principal: { ...principal }, sink,
      subscriptions: new Set(), presence: new Map(),
    });
    return connectionId;
  }

  async disconnect(connectionId: string) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    this.connections.delete(connectionId);
    for (const [channel, presence] of connection.presence) {
      await this.exclusive(connection.scope, channel, async () => {
        this.deliverPresence(connection.scope, channel, [], [presence.presenceKey]);
      });
    }
  }

  async subscribe(connectionId: string, requestId: string, channel: string, cursor?: string) {
    const connection = this.connection(connectionId);
    assertRealtimeChannel(channel);
    await this.authorize(connection, channel, "subscribe");
    if (!connection.subscriptions.has(channel) && connection.subscriptions.size >= this.maxSubscriptions) {
      throw new RealtimeError("REALTIME_CHANNEL_LIMIT");
    }
    await this.exclusive(connection.scope, channel, async () => {
      this.assertActive(connection);
      const latestBefore = await this.options.eventLog.latestSequence(connection.scope, channel);
      const after = cursor ? this.cursor.decode(cursor, connection.scope, channel) : latestBefore;
      const replay = await this.options.eventLog.replay(connection.scope, channel, after, this.replayLimit);
      if (replay.stale) throw new RealtimeError("REALTIME_CURSOR_STALE");
      connection.subscriptions.add(channel);
      this.send(connection, {
        type: "subscribed", requestId, channel,
        cursor: this.cursor.encode(connection.scope, channel, replay.latestSequence),
        replayed: replay.events.length,
      });
      for (const event of replay.events) this.send(connection, this.eventMessage(event, true));
      const currentPresence = this.presenceFor(connection.scope, channel);
      if (currentPresence.length) this.send(connection, {
        type: "presence", channel, joins: currentPresence, leaves: [],
      });
    });
  }

  async unsubscribe(connectionId: string, requestId: string, channel: string) {
    const connection = this.connection(connectionId);
    if (!connection.subscriptions.has(channel)) throw new RealtimeError("REALTIME_NOT_SUBSCRIBED");
    await this.exclusive(connection.scope, channel, async () => {
      this.assertActive(connection);
      const presence = connection.presence.get(channel);
      connection.presence.delete(channel);
      connection.subscriptions.delete(channel);
      this.send(connection, { type: "unsubscribed", requestId, channel });
      if (presence) this.deliverPresence(connection.scope, channel, [], [presence.presenceKey]);
    });
  }

  async broadcast(connectionId: string, requestId: string, channel: string, event: string, payload: unknown) {
    const connection = this.connection(connectionId);
    this.assertSubscribed(connection, channel);
    if (!/^[a-z][a-z0-9._-]{0,63}$/.test(event)) {
      throw new RealtimeError("REALTIME_INVALID_MESSAGE");
    }
    await this.authorize(connection, channel, "broadcast");
    const safePayload = safeJson(payload, this.maxPayloadBytes, false) as RealtimeJson;
    await this.exclusive(connection.scope, channel, async () => {
      this.assertActive(connection);
      const stored = await this.options.eventLog.append({
        ...connection.scope, channel, event, payload: safePayload,
        actorRole: connection.principal.role, createdAt: this.now(),
      });
      const cursor = this.cursor.encode(connection.scope, channel, stored.sequence);
      this.send(connection, { type: "ack", requestId, operation: "broadcast", cursor });
      const message = this.eventMessage(stored, false);
      for (const subscriber of this.subscribers(connection.scope, channel)) this.send(subscriber, message);
      this.markDelivered(connection.scope, channel, stored.sequence);
    });

    // Erst nach der lokalen Zustellung und außerhalb der Kanalsperre: Ein
    // Fehler beim Hinweis darf weder den bestätigten Broadcast zurücknehmen
    // noch die Sperre halten. Das Ereignis liegt bereits dauerhaft im Log,
    // andere Instanzen holen es spätestens mit dem nächsten Hinweis nach.
    await this.notifyPeers(connection.scope, channel);
  }

  /**
   * Verarbeitet den Verweis einer anderen Instanz.
   *
   * Es wird bewusst nicht das genannte Ereignis geholt, sondern ab der zuletzt
   * zugestellten Sequenz nachgelesen. `NOTIFY` ist nicht dauerhaft; ein
   * verpasster Hinweis würde sonst eine stille Lücke hinterlassen, die genau
   * dem Vertrag widerspricht, den die Cursor-Prüfung zusichert.
   */
  async deliverRemote(reference: RealtimeEventReference): Promise<void> {
    if (reference.origin === this.instanceId) return;
    const scope: RealtimeScope = {
      organizationId: reference.organizationId,
      projectId: reference.projectId,
      environment: reference.environment,
    };
    if (this.subscribers(scope, reference.channel).length === 0) return;

    await this.exclusive(scope, reference.channel, async () => {
      const key = deliveredKey(scope, reference.channel);
      const after = this.delivered.get(key) ?? 0;
      if (reference.sequence <= after) return;

      const replay = await this.options.eventLog.replay(scope, reference.channel, after, this.replayLimit);
      for (const event of replay.events) {
        const message = this.eventMessage(event, false);
        for (const subscriber of this.subscribers(scope, reference.channel)) this.send(subscriber, message);
        this.delivered.set(key, event.sequence);
      }
    });
  }

  /**
   * Stellt erfasste Datenbankänderungen zu — je Abonnent einzeln geprüft.
   *
   * Es gibt bewusst keinen gemeinsamen Fan-out: Ob eine Zeile sichtbar ist,
   * hängt von den Claims des Abonnenten ab. Zwei Abonnenten desselben Kanals
   * dürfen unterschiedliche Teilmengen derselben Änderung erhalten. Ein
   * gemeinsamer Fan-out wäre ein Cross-Tenant-Leck.
   *
   * Gibt die Verbindungs-IDs zurück, die wegen Rückstaus geschlossen werden
   * müssen. Ereignisse stillschweigend zu überspringen würde demselben Vertrag
   * widersprechen, den die Cursor-Prüfung zusichert.
   */
  async deliverChanges(changes: readonly RealtimeChange[]): Promise<string[]> {
    const reader = this.options.changeReader;
    if (!reader) return [];
    const overloaded = new Set<string>();

    for (const change of changes) {
      const channel = changeChannel(change);
      const scope: RealtimeScope = {
        organizationId: change.organizationId,
        projectId: change.projectId,
        environment: change.environment,
      };

      for (const subscriber of this.subscribers(scope, channel)) {
        if (overloaded.has(subscriber.id)) continue;
        const record = await reader.read(change, {
          role: subscriber.principal.role,
          subject: subscriber.principal.subject,
        });
        if (!record) continue;

        const accepted = this.trySend(subscriber, {
          type: "change",
          channel,
          schema: change.schema,
          table: change.table,
          operation: change.operation,
          position: change.position,
          record,
        });
        if (!accepted) {
          overloaded.add(subscriber.id);
          this.send(subscriber, { type: "error", code: "REALTIME_BACKPRESSURE" });
        }
      }
    }

    return [...overloaded];
  }

  /** Wie `send`, meldet aber, ob die Senke die Nachricht angenommen hat. */
  private trySend(connection: Connection, message: RealtimeServerMessage): boolean {
    try {
      return connection.sink.send(message);
    } catch {
      return false;
    }
  }

  private async notifyPeers(scope: RealtimeScope, channel: string): Promise<void> {
    const bus = this.options.eventBus;
    if (!bus) return;
    const sequence = this.delivered.get(deliveredKey(scope, channel));
    if (sequence === undefined) return;
    try {
      await bus.publish({ ...scope, channel, sequence, origin: this.instanceId });
    } catch {
      // Siehe oben: der Log bleibt die Wahrheit, der Hinweis ist nur eine
      // Beschleunigung.
    }
  }

  private markDelivered(scope: RealtimeScope, channel: string, sequence: number): void {
    const key = deliveredKey(scope, channel);
    if ((this.delivered.get(key) ?? 0) < sequence) this.delivered.set(key, sequence);
  }

  async trackPresence(connectionId: string, requestId: string, channel: string, state: unknown) {
    const connection = this.connection(connectionId);
    this.assertSubscribed(connection, channel);
    await this.authorize(connection, channel, "presence");
    const safeState = safeJson(state, this.maxPresenceBytes, true) as Record<string, RealtimeJson>;
    if (Object.keys(safeState).length > 16) throw new RealtimeError("REALTIME_PAYLOAD_TOO_LARGE");
    await this.exclusive(connection.scope, channel, async () => {
      this.assertActive(connection);
      const presence: RealtimePresenceEntry = {
        presenceKey: connection.presence.get(channel)?.presenceKey ?? this.cursor.presenceKey(
          connection.scope, channel, connection.principal.subject, connection.id,
        ),
        state: safeState,
      };
      connection.presence.set(channel, presence);
      this.send(connection, { type: "ack", requestId, operation: "presence.track" });
      this.deliverPresence(connection.scope, channel, [presence], []);
    });
  }

  async untrackPresence(connectionId: string, requestId: string, channel: string) {
    const connection = this.connection(connectionId);
    this.assertSubscribed(connection, channel);
    await this.authorize(connection, channel, "presence");
    await this.exclusive(connection.scope, channel, async () => {
      this.assertActive(connection);
      const presence = connection.presence.get(channel);
      connection.presence.delete(channel);
      this.send(connection, { type: "ack", requestId, operation: "presence.untrack" });
      if (presence) this.deliverPresence(connection.scope, channel, [], [presence.presenceKey]);
    });
  }

  ping(connectionId: string, requestId: string, nonce?: string) {
    this.send(this.connection(connectionId), { type: "pong", requestId, ...(nonce ? { nonce } : {}) });
  }

  stats() {
    let subscriptions = 0;
    for (const connection of this.connections.values()) subscriptions += connection.subscriptions.size;
    return { connections: this.connections.size, subscriptions };
  }

  private connection(connectionId: string) {
    const connection = this.connections.get(connectionId);
    if (!connection) throw new RealtimeError("REALTIME_AUTH_REQUIRED");
    return connection;
  }

  private assertSubscribed(connection: Connection, channel: string) {
    assertRealtimeChannel(channel);
    if (!connection.subscriptions.has(channel)) throw new RealtimeError("REALTIME_NOT_SUBSCRIBED");
  }

  private assertActive(connection: Connection) {
    if (this.connections.get(connection.id) !== connection) {
      throw new RealtimeError("REALTIME_AUTH_REQUIRED");
    }
  }

  private async authorize(connection: Connection, channel: string, action: "subscribe" | "broadcast" | "presence") {
    if (!await this.options.authorization.authorize({
      scope: connection.scope, principal: connection.principal, channel, action,
    })) throw new RealtimeError("REALTIME_ACCESS_DENIED");
  }

  /**
   * Scopes, für die aktuell mindestens eine Verbindung einen `changes:`-Kanal
   * abonniert hat.
   *
   * Der Poller braucht das, um nur für tatsächlich beobachtete Projekte zu
   * arbeiten. Ohne diese Auskunft müsste er entweder alle Projekte pollen oder
   * gar keines — Ersteres belastet jede Projektdatenbank ohne Anlass,
   * Letzteres liefert Abonnenten stumm nichts aus.
   */
  changeSubscriptionScopes(): RealtimeScope[] {
    const scopes = new Map<string, RealtimeScope>();
    for (const connection of this.connections.values()) {
      for (const channel of connection.subscriptions) {
        if (!channel.startsWith("changes:")) continue;
        const key = deliveredKey(connection.scope, "");
        if (!scopes.has(key)) scopes.set(key, { ...connection.scope });
      }
    }
    return [...scopes.values()];
  }

  private subscribers(scope: RealtimeScope, channel: string) {
    return [...this.connections.values()].filter((connection) => sameScope(connection.scope, scope) &&
      connection.subscriptions.has(channel));
  }

  private presenceFor(scope: RealtimeScope, channel: string) {
    return this.subscribers(scope, channel).flatMap((connection) => {
      const presence = connection.presence.get(channel);
      return presence ? [{ ...presence, state: structuredClone(presence.state) }] : [];
    });
  }

  private deliverPresence(scope: RealtimeScope, channel: string, joins: RealtimePresenceEntry[], leaves: string[]) {
    const message: RealtimeServerMessage = {
      type: "presence", channel,
      joins: joins.map((entry) => ({ ...entry, state: structuredClone(entry.state) })),
      leaves: [...leaves],
    };
    for (const subscriber of this.subscribers(scope, channel)) this.send(subscriber, message);
  }

  private eventMessage(event: RealtimeStoredEvent, replay: boolean): RealtimeServerMessage {
    return {
      type: "broadcast", channel: event.channel, event: event.event,
      payload: structuredClone(event.payload),
      cursor: this.cursor.encode(event, event.channel, event.sequence),
      actorRole: event.actorRole, createdAt: event.createdAt.toISOString(), replay,
    };
  }

  private send(connection: Connection, message: RealtimeServerMessage) {
    try { connection.sink.send(message); } catch { /* transport closes independently */ }
  }

  private async exclusive<T>(scope: RealtimeScope, channel: string, work: () => Promise<T>): Promise<T> {
    const key = `${scope.organizationId}\u0000${scope.projectId}\u0000${scope.environment}\u0000${channel}`;
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const gate = previous.then(() => current);
    this.locks.set(key, gate);
    await previous;
    try { return await work(); }
    finally {
      release();
      if (this.locks.get(key) === gate) this.locks.delete(key);
    }
  }
}

function safeJson(value: unknown, maxBytes: number, requireObject: boolean): RealtimeJson {
  let serialized: string | undefined;
  try { serialized = JSON.stringify(value); } catch { throw new RealtimeError("REALTIME_INVALID_MESSAGE"); }
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new RealtimeError("REALTIME_PAYLOAD_TOO_LARGE");
  }
  const parsed = JSON.parse(serialized) as RealtimeJson;
  if (requireObject && (!parsed || Array.isArray(parsed) || typeof parsed !== "object")) {
    throw new RealtimeError("REALTIME_INVALID_MESSAGE");
  }
  assertJsonDepth(parsed, 0, { nodes: 0 });
  return parsed;
}

function assertJsonDepth(value: RealtimeJson, depth: number, state: { nodes: number }) {
  state.nodes += 1;
  if (depth > 10 || state.nodes > 2_000) throw new RealtimeError("REALTIME_PAYLOAD_TOO_LARGE");
  if (Array.isArray(value)) for (const item of value) assertJsonDepth(item, depth + 1, state);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (!key || key.length > 128 || key === "__proto__" || key === "constructor" || key === "prototype") {
        throw new RealtimeError("REALTIME_INVALID_MESSAGE");
      }
      assertJsonDepth(item, depth + 1, state);
    }
  }
}

function sameScope(left: RealtimeScope, right: RealtimeScope) {
  return left.organizationId === right.organizationId && left.projectId === right.projectId &&
    left.environment === right.environment;
}

function bounded(value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RealtimeError("REALTIME_INVALID_MESSAGE");
  }
  return value;
}

function deliveredKey(scope: RealtimeScope, channel: string) {
  return `${scope.organizationId} ${scope.projectId} ${scope.environment} ${channel}`;
}

/** `changes:<schema>.<table>` — die Kanalform fuer erfasste Aenderungen. */
export function changeChannel(change: { schema: string; table: string }): string {
  return `changes:${change.schema}.${change.table}`;
}
