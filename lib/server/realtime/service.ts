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
  RealtimeChangeHistory,
  RealtimeChangeReader,
} from "@/lib/server/realtime/change-source";
import type {
  RealtimeEventBus,
  RealtimeEventReference,
  RealtimePresenceReference,
} from "@/lib/server/realtime/event-bus";
import {
  MAX_PRESENCE_PER_CHANNEL,
  MemoryRealtimePresenceStore,
  type RealtimePresenceStore,
} from "@/lib/server/realtime/presence-store";
import type { RealtimeEventLog } from "@/lib/server/realtime/repository";
import { DisabledUsageEmitter, type UsageEmitterPort } from "@/lib/server/usage/emitter";

type Connection = {
  id: string;
  scope: RealtimeScope;
  principal: RealtimePrincipal;
  sink: RealtimeSink;
  subscriptions: Set<string>;
  presence: Map<string, RealtimePresenceEntry>;
  /**
   * Höchste Feed-Position, die diese Verbindung je `changes:`-Kanal schon
   * gesehen hat.
   *
   * Sie steht hier und nicht je Kanal oder je Instanz, weil sie eine Zusage an
   * **diese** Verbindung ist: Nach einem Nachreichen bis Position P darf der
   * Poller, dessen eigene Position unabhängig davon läuft, nichts mehr unter
   * oder auf P zustellen. Ohne diese Zahl sähe ein Abonnent, der gerade wieder
   * aufgesetzt hat, dieselbe Änderung zweimal — und zwar genau dann, wenn sein
   * Cursor von einer Instanz kam, die weiter war als diese.
   */
  changePositions: Map<string, number>;
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
   * Wo Presence liegt. Ohne Angabe im Prozessspeicher: Dann überlebt sie
   * weder einen Neustart noch erreicht sie eine zweite Instanz, und das ist
   * ausdrücklich der Default für Test und Entwicklung. Der dauerhafte Store
   * (0077) ist dasselbe Muster wie beim Event-Log.
   */
  presence?: RealtimePresenceStore;
  /**
   * Reicht verpasste Änderungen ab einer Position nach. Ohne Quelle beginnt ein
   * `changes:`-Abonnement immer am aktuellen Ende, und ein mitgegebener Cursor
   * wird mit `REALTIME_CURSOR_STALE` abgewiesen — nicht ignoriert: Ein
   * ignorierter Cursor wäre eine verschwiegene Lücke.
   */
  changeHistory?: RealtimeChangeHistory;
  /** Zeilen, die ein Nachreichen höchstens liefert. Ohne Angabe wie `replayLimit`. */
  historyLimit?: number;
  /**
   * Das Alter, bis zu dem nachgereicht wird. Älter heißt `stale`, nicht
   * „so viel, wie noch da ist". Die Vorgabe ist das Fenster, mit dem die
   * Aufbewahrung den Feed schneidet.
   */
  historyMaxAgeMs?: number;
  /**
   * Liest eine geänderte Zeile mit den Claims eines Abonnenten. Ohne Reader
   * werden `changes:`-Kanäle nicht beliefert; ein Abonnement bleibt dann leer,
   * statt ungeprüfte Daten auszuliefern.
   */
  changeReader?: RealtimeChangeReader;
  /**
   * Ohne Emitter zählt nichts. Sinnvoll ist hier nur ein bündelnder: Eine
   * Control-Plane-Buchung je Broadcast wäre auf diesem Pfad ein absehbarer
   * Fehler.
   */
  usage?: UsageEmitterPort;
  /** Kennung dieser Instanz. Verhindert, dass ein eigenes Ereignis doppelt ankommt. */
  instanceId?: string;
  cursor?: RealtimeCursorCodec;
  now?: () => Date;
  id?: () => string;
  maxSubscriptionsPerConnection?: number;
  replayLimit?: number;
  maxPayloadBytes?: number;
  maxPresenceBytes?: number;
  /**
   * Wie lange ein Presence-Eintrag ohne Erneuerung gilt.
   *
   * Das ist die Antwort auf die eine Frage, die dauerhafte Presence stellt: Was
   * passiert mit dem Eintrag einer Verbindung, die ohne Abmeldung verschwindet?
   * Sie wird nicht mehr erneuert, und nach dieser Frist zählt sie für keinen
   * Leser mehr. Der Wert muss deutlich über dem Takt liegen, mit dem
   * `sweepPresence` läuft; die Vorgabe ist das Dreifache des Heartbeats.
   */
  presenceLeaseMs?: number;
  /** Höchstzahl der Einträge, die ein Kanal zurückgibt. */
  presenceLimit?: number;
  heartbeatSeconds?: number;
};

export class RealtimeService {
  readonly instanceId: string;
  private readonly connections = new Map<string, Connection>();
  private readonly locks = new Map<string, Promise<void>>();
  /** Zuletzt an lokale Abonnenten zugestellte Sequenz je Kanal. */
  private readonly delivered = new Map<string, number>();
  /**
   * Die Presence, die lokale Abonnenten eines Kanals zuletzt gesehen haben:
   * Schlüssel auf die serialisierte Fassung ihres Zustands.
   *
   * Sie ist der Grund, warum eine Änderung als Join und ein Ablauf als Leave
   * ankommt, obwohl der Store nur den Istzustand kennt. Ohne diese Buchführung
   * müsste jede Änderung einen vollen Schnappschuss schicken, und ein Abonnent
   * könnte nie unterscheiden, wer gegangen ist.
   */
  private readonly presenceDelivered = new Map<string, Map<string, string>>();
  private readonly presenceStore: RealtimePresenceStore;
  private readonly presenceLeaseMs: number;
  private readonly presenceLimit: number;
  private readonly cursor: RealtimeCursorCodec;
  private readonly now: () => Date;
  private readonly id: () => string;
  private readonly maxSubscriptions: number;
  private readonly replayLimit: number;
  private readonly historyLimit: number;
  private readonly historyMaxAgeMs: number;
  private readonly maxPayloadBytes: number;
  private readonly maxPresenceBytes: number;
  private readonly usage: UsageEmitterPort;
  readonly heartbeatSeconds: number;

  constructor(private readonly options: RealtimeServiceOptions) {
    this.usage = options.usage ?? new DisabledUsageEmitter();
    this.instanceId = options.instanceId ?? randomUUID();
    this.cursor = options.cursor ?? new RealtimeCursorCodec(randomBytes(32));
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? (() => randomUUID());
    this.maxSubscriptions = bounded(options.maxSubscriptionsPerConnection ?? 32, 1, 128);
    this.replayLimit = bounded(options.replayLimit ?? 100, 1, 500);
    this.maxPayloadBytes = bounded(options.maxPayloadBytes ?? 16 * 1024, 256, 256 * 1024);
    this.maxPresenceBytes = bounded(options.maxPresenceBytes ?? 4 * 1024, 128, 32 * 1024);
    this.heartbeatSeconds = bounded(options.heartbeatSeconds ?? 30, 5, 120);
    this.presenceStore = options.presence ?? new MemoryRealtimePresenceStore();
    this.presenceLeaseMs = bounded(
      options.presenceLeaseMs ?? this.heartbeatSeconds * 3_000, 1_000, 3_600_000,
    );
    this.presenceLimit = bounded(options.presenceLimit ?? 200, 1, MAX_PRESENCE_PER_CHANNEL);
    this.historyLimit = bounded(options.historyLimit ?? this.replayLimit, 1, 500);
    this.historyMaxAgeMs = bounded(options.historyMaxAgeMs ?? 86_400_000, 60_000, 90 * 86_400_000);
  }

  connect(scope: RealtimeScope, principal: RealtimePrincipal, sink: RealtimeSink, connectionId = this.id()) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(connectionId) || this.connections.has(connectionId) ||
        principal.organizationId !== scope.organizationId || !principal.actorRef ||
        principal.actorRef.length > 320 || !principal.subject || principal.subject.length > 320) {
      throw new RealtimeError("REALTIME_AUTH_FAILED");
    }
    this.connections.set(connectionId, {
      id: connectionId, scope: { ...scope }, principal: { ...principal }, sink,
      subscriptions: new Set(), presence: new Map(), changePositions: new Map(),
    });
    return connectionId;
  }

  async disconnect(connectionId: string) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    this.connections.delete(connectionId);
    for (const [channel, presence] of connection.presence) {
      // Die geordnete Trennung nimmt den Eintrag sofort weg, statt ihn ablaufen
      // zu lassen: Ein geschlossener Socket ist eine Abmeldung, und auf die
      // Pacht zu warten hiesse, eine Minute lang jemanden anzuzeigen, von dem
      // dieser Prozess gerade erfahren hat, dass er weg ist. Die Pacht ist fuer
      // den anderen Fall da, den ungeordneten.
      await this.exclusive(connection.scope, channel, async () => {
        try { await this.presenceStore.remove(connection.scope, channel, presence.presenceKey); }
        catch { /* die Pacht raeumt auf, siehe oben */ }
        await this.publishPresenceLocally(connection.scope, channel);
      });
      await this.notifyPresencePeers(connection.scope, channel);
    }
  }

  async subscribe(connectionId: string, requestId: string, channel: string, cursor?: string) {
    const connection = this.connection(connectionId);
    assertRealtimeChannel(channel);
    await this.authorize(connection, channel, "subscribe");
    if (!connection.subscriptions.has(channel) && connection.subscriptions.size >= this.maxSubscriptions) {
      throw new RealtimeError("REALTIME_CHANNEL_LIMIT");
    }
    // `changes:`-Kanäle haben keinen Event-Log und können keinen haben: Was dort
    // ankommt, entsteht in der Projektdatenbank und nicht durch einen Broadcast.
    // Ihr Cursor zeigt deshalb auf eine Feed-Position und nicht auf eine
    // Kanalsequenz. Bis zu diesem Slice las dieselbe Zeile `realtime_events`
    // unter dem Kanalnamen `changes:...` -- eine Tabelle, in die auf diesem Weg
    // nie etwas geschrieben wird. Ein Abonnent bekam darum immer die Sequenz 0
    // zurück, und ein Nachreichen gab es nicht.
    if (changeChannelTarget(channel)) {
      await this.subscribeToChanges(connection, requestId, channel, cursor);
      return;
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
      // Der Schnappschuss kommt aus dem Store und damit instanzuebergreifend:
      // Wer gerade an der anderen Instanz haengt, steht hier mit drin. Bis zu
      // diesem Punkt las dieselbe Zeile die Verbindungen dieses Prozesses, und
      // ein Abonnent erfuhr genau die Haelfte eines Kanals mit zwei Instanzen.
      const currentPresence = await this.presenceStore.list(
        connection.scope, channel, this.now(), this.presenceLimit,
      );
      // Die Buchfuehrung wird auf den gerade verschickten Stand gesetzt, nicht
      // ergaenzt: Der Schnappschuss ist der Istzustand des Kanals, und jeder
      // lokale Abonnent hat ihn jetzt gesehen -- die anderen, weil sie dieselben
      // Differenzen bekommen haben.
      this.presenceDelivered.set(
        deliveredKey(connection.scope, channel),
        new Map(currentPresence.map((entry) => [entry.presenceKey, stableState(entry.state)])),
      );
      if (currentPresence.length) this.send(connection, {
        type: "presence", channel, joins: currentPresence, leaves: [],
      });
    });
  }

  /**
   * Abonniert einen `changes:`-Kanal und reicht ab der Position des Cursors nach.
   *
   * ## Die eine Regel, an der alles hängt
   *
   * **Jede nachgereichte Zeile geht durch denselben Leser wie eine lebende.**
   * `changeReader.read` liest sie mit den Claims **dieses** Abonnenten, und Row
   * Level Security entscheidet dabei neu. Ein Nachreichen, das die
   * Zeilensicherheit nicht erneut anwendet, wäre ein Leck -- und es wäre ein
   * besonders stilles, weil der Abonnent dieselbe Nachricht bekäme wie im
   * Livebetrieb und nichts daran anders aussähe.
   *
   * Der Feed gibt das her, weil er gar keine Zeilenwerte hält: Er trägt den
   * Primärschlüssel und sonst nichts. Es gibt hier also keinen zweiten Weg, auf
   * dem eine Zeile an RLS vorbeikäme; nicht aus Vorsicht, sondern weil die
   * Werte nirgends liegen. Löschungen erreichen weiterhin nur `service_role`,
   * aus demselben Grund wie im Livebetrieb: Nach einem `DELETE` kann RLS nicht
   * mehr beantworten, wer die Zeile hätte sehen dürfen.
   *
   * ## Warum erst gelesen und dann bestätigt wird
   *
   * `subscribed.replayed` nennt die Zahl der Zeilen, die dieser Abonnent
   * wirklich bekommt -- nicht die, die im Feed stehen. Beides zu verwechseln
   * hieße, ihm über die Zahl zu verraten, wie viele Zeilen es gibt, die er nicht
   * sehen darf.
   */
  private async subscribeToChanges(
    connection: Connection, requestId: string, channel: string, cursor?: string,
  ) {
    const target = changeChannelTarget(channel);
    if (!target) throw new RealtimeError("REALTIME_INVALID_MESSAGE");
    const history = this.options.changeHistory;
    const reader = this.options.changeReader;
    // Ohne Quelle oder ohne Leser ist ein Cursor nicht erfüllbar. Ihn
    // stillschweigend als "ab jetzt" zu lesen wäre die verschwiegene Lücke,
    // gegen die der Cursor-Vertrag angetreten ist.
    if (cursor && (!history || !reader)) throw new RealtimeError("REALTIME_CURSOR_STALE");

    await this.exclusive(connection.scope, channel, async () => {
      this.assertActive(connection);
      if (!history) {
        // Ohne Quelle gibt es keine Position zu nennen. Der Kanal ist trotzdem
        // abonnierbar: Der Poller stellt zu, sobald er läuft.
        connection.subscriptions.add(channel);
        connection.changePositions.set(channel, 0);
        this.send(connection, {
          type: "subscribed", requestId, channel,
          cursor: this.cursor.encode(connection.scope, channel, 0), replayed: 0,
        });
        return;
      }

      const latest = await history.latestPosition(connection.scope);
      const after = cursor ? this.cursor.decode(cursor, connection.scope, channel) : latest;
      const result = cursor
        ? await history.history(
          connection.scope, target.schema, target.table, after, this.historyLimit,
          new Date(this.now().getTime() - this.historyMaxAgeMs),
        )
        : { changes: [] as readonly RealtimeChange[], latestPosition: latest, stale: false };
      if (result.stale) throw new RealtimeError("REALTIME_CURSOR_STALE");

      const claims = {
        role: connection.principal.role,
        subject: connection.principal.subject,
      };
      const visible: Array<{ change: RealtimeChange; record: Record<string, RealtimeJson> }> = [];
      for (const change of result.changes) {
        const record = reader ? await reader.read(change, claims) : null;
        if (record) visible.push({ change, record });
      }

      connection.subscriptions.add(channel);
      // Die Position steht auf dem Ende des Nachreichens und nicht auf der
      // letzten sichtbaren Zeile: Eine Zeile, die dieser Abonnent nicht sehen
      // darf, ist für ihn erledigt, und ein zweiter Versuch darüber wäre nur
      // eine zweite Gelegenheit, nichts zu bekommen.
      //
      // Das Maximum aus beidem, weil die Spanne des Feeds und die Zeilen in zwei
      // Anweisungen gelesen werden: Eine Änderung, die dazwischen entsteht, kommt
      // in den Zeilen vor und in der Spanne nicht. Ohne das Maximum stünde die
      // Position darunter, und der Poller lieferte sie ein zweites Mal.
      const reached = result.changes.reduce(
        (highest, change) => Math.max(highest, change.position), result.latestPosition,
      );
      connection.changePositions.set(channel, reached);
      this.send(connection, {
        type: "subscribed", requestId, channel,
        cursor: this.cursor.encode(connection.scope, channel, reached),
        replayed: visible.length,
      });
      for (const entry of visible) {
        this.send(connection, this.changeMessage(connection.scope, channel, entry.change,
          entry.record, true));
      }
    });
  }

  async unsubscribe(connectionId: string, requestId: string, channel: string) {
    const connection = this.connection(connectionId);
    if (!connection.subscriptions.has(channel)) throw new RealtimeError("REALTIME_NOT_SUBSCRIBED");
    let released = false;
    await this.exclusive(connection.scope, channel, async () => {
      this.assertActive(connection);
      const presence = connection.presence.get(channel);
      connection.presence.delete(channel);
      connection.subscriptions.delete(channel);
      this.send(connection, { type: "unsubscribed", requestId, channel });
      if (!presence) return;
      released = true;
      await this.presenceStore.remove(connection.scope, channel, presence.presenceKey);
      await this.publishPresenceLocally(connection.scope, channel);
    });
    // Nur wenn wirklich ein Eintrag fiel. Ein Hinweis ohne Aenderung waere eine
    // Lesung in jeder anderen Instanz ohne Anlass.
    if (released) await this.notifyPresencePeers(connection.scope, channel);
  }

  async broadcast(connectionId: string, requestId: string, channel: string, event: string, payload: unknown) {
    const connection = this.connection(connectionId);
    this.assertSubscribed(connection, channel);
    if (!/^[a-z][a-z0-9._-]{0,63}$/.test(event)) {
      throw new RealtimeError("REALTIME_INVALID_MESSAGE");
    }
    await this.authorize(connection, channel, "broadcast");
    const safePayload = safeJson(payload, this.maxPayloadBytes, false) as RealtimeJson;
    let storedId: string | null = null;
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
      // Kanal und Sequenz identifizieren das Ereignis innerhalb des Scopes.
      // Auf 64 Zeichen gekürzt, weil ein Bezug nicht länger sein darf; der
      // bündelnde Emitter benutzt ihn ohnehin nicht, er summiert nur.
      storedId = `${stored.channel}:${stored.sequence}`.slice(0, 64);
    });

    // Gemessen wird die Nachricht, die dauerhaft im Log liegt — nicht die
    // Zustellungen, die daraus entstehen. Ein Kanal mit hundert Abonnenten
    // erzeugt eine Nachricht, nicht hundert.
    //
    // Der Emitter sammelt und schreibt gebündelt; er kann deshalb nicht
    // ablehnen, und seine Antwort wird sichtbar ignoriert.
    if (storedId) {
      await this.usage.admit(connection.scope, {
        metric: "realtime_messages", reference: storedId,
      });
    }

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

      let reached = false;
      // Unter derselben Kanalsperre wie das Nachreichen beim Abonnieren. Ohne
      // sie könnte eine lebende Änderung mitten in ein laufendes Nachreichen
      // fallen und vor einer älteren ankommen -- genau die Zusage, die das
      // Protokoll für Broadcasts seit Anfang macht und die für Änderungen bis zu
      // diesem Slice niemand einhielt, weil es dort nichts nachzureichen gab.
      await this.exclusive(scope, channel, async () => {
        for (const subscriber of this.subscribers(scope, channel)) {
          if (overloaded.has(subscriber.id)) continue;
          // Was diese Verbindung schon gesehen hat, bekommt sie nicht wieder.
          // Siehe `changePositions`: Die Position des Pollers läuft unabhängig
          // von der eines Abonnenten, der gerade wieder aufgesetzt hat.
          const seen = subscriber.changePositions.get(channel) ?? 0;
          if (change.position <= seen) continue;
          const record = await reader.read(change, {
            role: subscriber.principal.role,
            subject: subscriber.principal.subject,
          });
          subscriber.changePositions.set(channel, change.position);
          if (!record) continue;

          const accepted = this.trySend(subscriber,
            this.changeMessage(scope, channel, change, record, false));
          if (accepted) reached = true;
          else {
            overloaded.add(subscriber.id);
            this.send(subscriber, { type: "error", code: "REALTIME_BACKPRESSURE" });
          }
        }
      });

      // Einmal je zugestellter Änderung, nicht je Abonnent — dieselbe Regel wie
      // beim Broadcast. Eine Änderung, die kein Abonnent sehen darf oder die
      // niemand abonniert hat, zählt nicht: Es ist keine Nachricht entstanden.
      //
      // Ohne diese Zeile zeigte ein Projekt, das ausschliesslich
      // `changes:`-Kanäle benutzt, dauerhaft null — gemessen, aber am falschen
      // Weg.
      if (reached) {
        await this.usage.admit(scope, {
          metric: "realtime_messages",
          reference: `${channel}:${change.position}`.slice(0, 64),
        });
      }
    }

    return [...overloaded];
  }

  /**
   * Eine Änderungsnachricht, für den Livebetrieb und für das Nachreichen
   * dieselbe Funktion.
   *
   * Zwei Stellen, die dieselbe Nachricht bauen, wären zwei Stellen, an denen
   * `replay` oder der Cursor auseinanderlaufen können -- und ein Abonnent kann
   * an der Nachricht nicht nachprüfen, welche von beiden ihn beliefert hat.
   */
  private changeMessage(
    scope: RealtimeScope, channel: string, change: RealtimeChange,
    record: Record<string, RealtimeJson>, replay: boolean,
  ): RealtimeServerMessage {
    return {
      type: "change",
      channel,
      schema: change.schema,
      table: change.table,
      operation: change.operation,
      position: change.position,
      cursor: this.cursor.encode(scope, channel, change.position),
      record,
      replay,
    };
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
      // Erst schreiben, dann bestaetigen. Scheitert der Store, bekommt der
      // Abonnent einen Fehler und keine Bestaetigung: Eine bestaetigte Presence,
      // die nirgends liegt, waere genau die Haelfte, gegen die dieser Slice
      // angetreten ist.
      const trackedAt = this.now();
      await this.presenceStore.put(connection.scope, channel, {
        ...presence,
        instanceId: this.instanceId,
        trackedAt,
        expiresAt: new Date(trackedAt.getTime() + this.presenceLeaseMs),
      });
      connection.presence.set(channel, presence);
      this.send(connection, { type: "ack", requestId, operation: "presence.track" });
      await this.publishPresenceLocally(connection.scope, channel);
    });
    await this.notifyPresencePeers(connection.scope, channel);
  }

  async untrackPresence(connectionId: string, requestId: string, channel: string) {
    const connection = this.connection(connectionId);
    this.assertSubscribed(connection, channel);
    await this.authorize(connection, channel, "presence");
    let released = false;
    await this.exclusive(connection.scope, channel, async () => {
      this.assertActive(connection);
      const presence = connection.presence.get(channel);
      connection.presence.delete(channel);
      if (presence) {
        released = true;
        await this.presenceStore.remove(connection.scope, channel, presence.presenceKey);
      }
      this.send(connection, { type: "ack", requestId, operation: "presence.untrack" });
      if (presence) await this.publishPresenceLocally(connection.scope, channel);
    });
    if (released) await this.notifyPresencePeers(connection.scope, channel);
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

  /**
   * Liest die Presence eines Kanals frisch und stellt die Differenz zu dem zu,
   * was lokale Abonnenten zuletzt gesehen haben.
   *
   * Hier laufen alle drei Anlässe zusammen, und das ist der Punkt: ein `track`
   * oder `untrack` in diesem Prozess, ein Hinweis einer anderen Instanz, und der
   * Takt, der abgelaufene Pachten einsammelt. Alle drei führen zur **gleichen**
   * Rechnung auf dem gleichen Istzustand. Ohne diese Zusammenführung müsste
   * jeder Anlass seine eigene Vorstellung davon haben, wer gerade da ist, und
   * zwei Instanzen würden auseinanderlaufen, sobald ein Hinweis verloren geht.
   *
   * Muss unter der Kanalsperre laufen.
   */
  private async publishPresenceLocally(scope: RealtimeScope, channel: string): Promise<void> {
    const key = deliveredKey(scope, channel);
    const subscribers = this.subscribers(scope, channel);
    if (subscribers.length === 0) {
      // Keine Buchführung ohne Zuhörer: Der nächste Abonnent bekommt einen
      // vollen Schnappschuss, und eine liegengebliebene alte Buchführung würde
      // ihm danach Leaves für Einträge schicken, die er nie gesehen hat.
      this.presenceDelivered.delete(key);
      return;
    }
    const current = await this.presenceStore.list(scope, channel, this.now(), this.presenceLimit);
    const previous = this.presenceDelivered.get(key) ?? new Map<string, string>();
    const next = new Map(current.map((entry) => [entry.presenceKey, stableState(entry.state)]));
    // Ein geänderter Zustand ist ein Join mit demselben Schlüssel: Der Abonnent
    // ersetzt den Eintrag, statt ihn erst gehen und dann kommen zu sehen.
    const joins = current.filter((entry) => previous.get(entry.presenceKey)
      !== next.get(entry.presenceKey));
    const leaves = [...previous.keys()].filter((presenceKey) => !next.has(presenceKey));
    if (next.size === 0) this.presenceDelivered.delete(key);
    else this.presenceDelivered.set(key, next);
    if (joins.length === 0 && leaves.length === 0) return;
    const message: RealtimeServerMessage = {
      type: "presence", channel,
      joins: joins.map((entry) => ({ ...entry, state: structuredClone(entry.state) })),
      leaves,
    };
    for (const subscriber of subscribers) this.send(subscriber, message);
  }

  /**
   * Meldet anderen Instanzen, dass sich die Presence dieses Kanals geändert hat.
   *
   * Wie beim Ereignisverweis: außerhalb der Kanalsperre, und ein Fehler nimmt
   * die bereits geschriebene Presence nicht zurück. Der Store ist die Wahrheit,
   * der Hinweis ist nur die Beschleunigung — ohne ihn sieht die andere Instanz
   * die Änderung spätestens beim nächsten Takt oder beim nächsten Abonnieren.
   */
  private async notifyPresencePeers(scope: RealtimeScope, channel: string): Promise<void> {
    const bus = this.options.eventBus;
    if (!bus) return;
    try { await bus.publishPresence({ ...scope, channel, origin: this.instanceId }); }
    catch { /* siehe oben */ }
  }

  /** Verarbeitet den Presence-Hinweis einer anderen Instanz. */
  async deliverRemotePresence(reference: RealtimePresenceReference): Promise<void> {
    if (reference.origin === this.instanceId) return;
    const scope: RealtimeScope = {
      organizationId: reference.organizationId,
      projectId: reference.projectId,
      environment: reference.environment,
    };
    if (this.subscribers(scope, reference.channel).length === 0) return;
    await this.exclusive(scope, reference.channel, async () => {
      await this.publishPresenceLocally(scope, reference.channel);
    });
  }

  /**
   * Ein Takt der Presence: erst die eigenen Pachten erneuern, dann jeden Kanal
   * mit lokalen Abonnenten neu rechnen.
   *
   * **Das ist die Antwort auf die verschwundene Verbindung.** Eine Verbindung,
   * die ohne Abmeldung weg ist, wird hier nicht mehr erneuert; ihre Pacht läuft
   * ab, die nächste Lesung zählt sie nicht mehr mit, und die Rechnung in
   * `publishPresenceLocally` macht daraus ein Leave an alle, die zuhören. Ohne
   * diesen Takt bliebe der Eintrag bis zum nächsten fremden `track` sichtbar —
   * also womöglich für immer, denn in einem Kanal, in dem nichts mehr passiert,
   * passiert auch kein Anlass.
   *
   * Es wird ausdrücklich **nicht** an andere Instanzen gemeldet: Ein Ablauf ist
   * keine Änderung, die jemand geschrieben hat, sondern eine, die die Uhr
   * macht. Jede Instanz sieht sie in ihrem eigenen Takt, und ein Hinweis dafür
   * wäre eine Benachrichtigung je Instanz und Takt ohne jede Information.
   */
  async sweepPresence(): Promise<{ renewed: number; channels: number }> {
    const owned = new Map<string, { scope: RealtimeScope; channel: string; keys: string[] }>();
    for (const connection of this.connections.values()) {
      for (const [channel, presence] of connection.presence) {
        const key = deliveredKey(connection.scope, channel);
        const group = owned.get(key)
          ?? { scope: connection.scope, channel, keys: [] as string[] };
        group.keys.push(presence.presenceKey);
        owned.set(key, group);
      }
    }
    const expiresAt = new Date(this.now().getTime() + this.presenceLeaseMs);
    let renewed = 0;
    for (const group of owned.values()) {
      try {
        renewed += await this.presenceStore.renew(
          group.scope, group.channel, this.instanceId,
          group.keys.slice(0, this.presenceLimit), expiresAt,
        );
      } catch { /* naechster Kanal; der Takt wiederholt sich */ }
    }

    // Gerechnet wird für jeden Kanal, für den dieser Prozess Abonnenten hat --
    // auch für die ohne eigene Presence. Genau dort liegen die Waisen fremder
    // Instanzen, und genau dort würde sie sonst niemand einsammeln.
    const watched = new Map<string, { scope: RealtimeScope; channel: string }>();
    for (const connection of this.connections.values()) {
      for (const channel of connection.subscriptions) {
        watched.set(deliveredKey(connection.scope, channel), { scope: connection.scope, channel });
      }
    }
    for (const entry of watched.values()) {
      try {
        await this.exclusive(entry.scope, entry.channel, async () => {
          await this.publishPresenceLocally(entry.scope, entry.channel);
        });
      } catch { /* naechster Kanal */ }
    }
    return { renewed, channels: watched.size };
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

/**
 * Vergleichbare Fassung eines Presence-Zustands.
 *
 * `JSON.stringify` allein genügt nicht: Zwei gleiche Zustände mit verschiedener
 * Schlüsselreihenfolge wären verschiedene Zeichenketten, und jeder Takt machte
 * daraus einen Join. Der Zustand ist flach begrenzt, höchstens sechzehn
 * Schlüssel, deshalb reicht eine Sortierung der obersten Ebene.
 */
function stableState(state: Record<string, RealtimeJson>): string {
  return JSON.stringify(Object.keys(state).sort().map((key) => [key, state[key]]));
}

/** `changes:<schema>.<table>` — die Kanalform fuer erfasste Aenderungen. */
export function changeChannel(change: { schema: string; table: string }): string {
  return `changes:${change.schema}.${change.table}`;
}

/**
 * Schema und Tabelle eines `changes:`-Kanals, oder `null` fuer jeden anderen.
 *
 * Die Form ist dieselbe, die `validChannel` in `policy.ts` erlaubt; hier wird sie
 * zerlegt, nicht zum zweiten Mal entschieden. Ein Kanal, der die Prüfung dort
 * bestanden hat, kommt hier an und nicht umgekehrt.
 */
export function changeChannelTarget(channel: string): { schema: string; table: string } | null {
  if (!channel.startsWith("changes:")) return null;
  const parts = channel.slice("changes:".length).split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { schema: parts[0], table: parts[1] };
}
