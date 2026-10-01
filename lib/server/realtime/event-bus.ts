import { randomUUID } from "node:crypto";
import type { Environment } from "@/lib/types";
import { RealtimeError, type RealtimeScope } from "@/lib/server/realtime/model";

/**
 * Verweis auf ein bereits dauerhaft gespeichertes Ereignis.
 *
 * Die Benachrichtigung trägt bewusst **keine Payload**. Zwei Gründe: Der
 * `NOTIFY`-Kanal von PostgreSQL begrenzt die Nutzlast auf 8000 Byte, und eine
 * Payload auf einem Seitenkanal umginge den Log als einzige Wahrheit über
 * Reihenfolge und Inhalt. Die empfangende Instanz liest das Ereignis stattdessen
 * aus dem Log, dessen Zugriff bereits RLS-geprüft ist.
 */
export type RealtimeEventReference = RealtimeScope & {
  channel: string;
  sequence: number;
  /** Instanz, die das Ereignis erzeugt hat. Verhindert doppelte Zustellung. */
  origin: string;
};

/**
 * Hinweis, dass sich die Presence eines Kanals geändert hat.
 *
 * Er trägt **keine Einträge**, nicht einmal einen Schlüssel. Der Grund ist
 * derselbe wie beim Ereignisverweis, und er wiegt hier schwerer: Presence liegt
 * seit 0077 in einer Tabelle, deren Lesung RLS-geprüft ist und deren Pacht über
 * die Sichtbarkeit entscheidet. Einen Eintrag über `NOTIFY` zu schicken hieße,
 * genau diese beiden Prüfungen zu umgehen — und eine Pacht, die unterwegs
 * abläuft, käme als anwesend an. Die empfangende Instanz liest den Kanal
 * stattdessen frisch und bildet die Differenz zu dem, was sie zuletzt
 * zugestellt hat.
 */
export type RealtimePresenceReference = RealtimeScope & {
  channel: string;
  /** Instanz, in der sich etwas geändert hat. Verhindert doppelte Zustellung. */
  origin: string;
};

export interface RealtimeEventBus {
  /** Meldet ein neu geschriebenes Ereignis an alle anderen Instanzen. */
  publish(reference: RealtimeEventReference): Promise<void>;
  /** Meldet eine geänderte Presence an alle anderen Instanzen. */
  publishPresence(reference: RealtimePresenceReference): Promise<void>;
  /**
   * Registriert genau einen Empfänger je Art. Ein zweiter Aufruf ist ein
   * Fehler. Der Presence-Empfänger ist optional: Ohne ihn bleibt
   * instanzübergreifende Presence ein Schnappschuss beim Abonnieren, und das
   * ist eine andere Zusage als keine.
   */
  subscribe(
    handler: (reference: RealtimeEventReference) => void,
    presenceHandler?: (reference: RealtimePresenceReference) => void,
  ): Promise<void>;
  close(): Promise<void>;
}

/**
 * Prozesslokaler Bus. Nützlich für Tests, die zwei Service-Instanzen in einem
 * Prozess verbinden. Er ersetzt keinen Mehrinstanzbetrieb: ohne gemeinsamen
 * Prozess erreicht er nichts.
 */
export class MemoryRealtimeEventBus implements RealtimeEventBus {
  private readonly handlers = new Set<(reference: RealtimeEventReference) => void>();
  private readonly presenceHandlers = new Set<(reference: RealtimePresenceReference) => void>();

  async publish(reference: RealtimeEventReference): Promise<void> {
    for (const handler of this.handlers) {
      if (reference.origin === handlerOrigin.get(handler)) continue;
      handler({ ...reference });
    }
  }

  async publishPresence(reference: RealtimePresenceReference): Promise<void> {
    for (const handler of this.presenceHandlers) {
      if (reference.origin === handlerOrigin.get(handler)) continue;
      handler({ ...reference });
    }
  }

  async subscribe(
    handler: (reference: RealtimeEventReference) => void,
    presenceHandler?: (reference: RealtimePresenceReference) => void,
  ): Promise<void> {
    this.handlers.add(handler);
    if (presenceHandler) this.presenceHandlers.add(presenceHandler);
  }

  /** Bindet einen Empfänger an eine Instanz, damit er sein eigenes Ereignis überspringt. */
  subscribeAs(
    origin: string,
    handler: (reference: RealtimeEventReference) => void,
    presenceHandler?: (reference: RealtimePresenceReference) => void,
  ): void {
    handlerOrigin.set(handler, origin);
    this.handlers.add(handler);
    if (presenceHandler) {
      handlerOrigin.set(presenceHandler, origin);
      this.presenceHandlers.add(presenceHandler);
    }
  }

  async close(): Promise<void> {
    this.handlers.clear();
    this.presenceHandlers.clear();
  }
}

const handlerOrigin = new WeakMap<object, string>();

export type PostgresRealtimeEventBusOptions = {
  /** Eigene Verbindung. `LISTEN` belegt sie dauerhaft und gehört nicht in einen Pool. */
  connect: () => Promise<ListenConnection>;
  channelName?: string;
  origin?: string;
};

export interface ListenConnection {
  query(text: string, values?: readonly unknown[]): Promise<unknown>;
  on(event: "notification", handler: (message: { channel: string; payload?: string }) => void): void;
  on(event: "error", handler: (error: unknown) => void): void;
  end(): Promise<void>;
}

const DEFAULT_CHANNEL = "qkern_realtime_events";
const MAX_NOTIFICATION_BYTES = 7_000;

/**
 * Instanzübergreifende Zustellung über `LISTEN`/`NOTIFY`.
 *
 * Bewusst kein zusätzlicher Broker: Die Ereignisse liegen bereits dauerhaft in
 * derselben Datenbank. Ein zweites System einzuführen, nur um auf sie
 * hinzuweisen, brächte eine weitere Ausfall- und Betriebsfläche ohne
 * zusätzliche Garantie.
 *
 * Grenze: `NOTIFY` ist nicht dauerhaft. Verliert eine Instanz die Verbindung,
 * verpasst sie Hinweise. Deshalb löst ein eingehender Verweis stets ein Replay
 * ab der zuletzt zugestellten Sequenz aus statt nur das genannte Ereignis zu
 * holen — eine verpasste Benachrichtigung wird so von der nächsten eingeholt.
 */
export class PostgresRealtimeEventBus implements RealtimeEventBus {
  readonly origin: string;
  private readonly channelName: string;
  private listener: ListenConnection | undefined;
  private publisher: ListenConnection | undefined;
  private closed = false;

  constructor(private readonly options: PostgresRealtimeEventBusOptions) {
    this.origin = options.origin ?? randomUUID();
    this.channelName = notifyChannel(options.channelName ?? DEFAULT_CHANNEL);
  }

  async publish(reference: RealtimeEventReference): Promise<void> {
    await this.notify(encode(reference));
  }

  async publishPresence(reference: RealtimePresenceReference): Promise<void> {
    await this.notify(encodePresence(reference));
  }

  private async notify(body: Record<string, unknown>): Promise<void> {
    if (this.closed) return;
    const payload = JSON.stringify(body);
    if (Buffer.byteLength(payload, "utf8") > MAX_NOTIFICATION_BYTES) {
      throw new RealtimeError("REALTIME_PAYLOAD_TOO_LARGE");
    }
    this.publisher ??= await this.options.connect();
    await this.publisher.query("SELECT pg_notify($1, $2)", [this.channelName, payload]);
  }

  async subscribe(
    handler: (reference: RealtimeEventReference) => void,
    presenceHandler?: (reference: RealtimePresenceReference) => void,
  ): Promise<void> {
    if (this.listener) throw new RealtimeError("REALTIME_INVALID_MESSAGE");
    const connection = await this.options.connect();
    this.listener = connection;

    connection.on("notification", (message) => {
      if (message.channel !== this.channelName || !message.payload) return;
      // Ein Kanal fuer beide Arten, und zwar derselbe: `LISTEN` belegt eine
      // Verbindung dauerhaft, und eine zweite davon nur fuer Presence waere ein
      // zweiter dauerhafter Platz in `max_connections` ohne Gegenwert. Die Art
      // steht im Koerper, im Feld `k`.
      const parsed = parse(message.payload);
      if (!parsed) return;
      if (parsed.k === "p") {
        const presence = decodePresence(parsed);
        if (!presence || presence.origin === this.origin) return;
        presenceHandler?.(presence);
        return;
      }
      const reference = decode(parsed);
      // Das eigene Ereignis wurde lokal bereits zugestellt.
      if (!reference || reference.origin === this.origin) return;
      handler(reference);
    });
    connection.on("error", () => {
      // Eine abgerissene Listener-Verbindung darf den Prozess nicht beenden.
      // Die Zustellung fällt auf den Log zurück, sobald wieder ein Verweis
      // eintrifft oder ein Client mit Cursor neu abonniert.
      this.listener = undefined;
    });

    await connection.query(`LISTEN ${this.channelName}`);
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([this.listener?.end(), this.publisher?.end()]);
    this.listener = undefined;
    this.publisher = undefined;
  }
}

/** Kanalnamen gehen unquotiert in `LISTEN`, deshalb eine enge Allowlist. */
function notifyChannel(value: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new RealtimeError("REALTIME_INVALID_MESSAGE");
  return value;
}

function encode(reference: RealtimeEventReference) {
  return {
    o: reference.organizationId,
    p: reference.projectId,
    e: reference.environment,
    c: reference.channel,
    s: reference.sequence,
    i: reference.origin,
  };
}

/** Presence trägt keine Sequenz: Es gibt keine, nur einen Kanal, der sich geändert hat. */
function encodePresence(reference: RealtimePresenceReference) {
  return {
    k: "p",
    o: reference.organizationId,
    p: reference.projectId,
    e: reference.environment,
    c: reference.channel,
    i: reference.origin,
  };
}

/** Gibt `null` zurück, statt bei fremder oder beschädigter Nutzlast zu werfen. */
function parse(payload: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Der gemeinsame Teil beider Arten: Scope, Kanal und Ursprung. */
function decodeScope(parsed: Record<string, unknown>): (RealtimeScope & {
  channel: string; origin: string;
}) | null {
  if (
    typeof parsed.o !== "string" || typeof parsed.p !== "string" || typeof parsed.e !== "string"
    || typeof parsed.c !== "string" || typeof parsed.i !== "string"
    || parsed.c.length > 128 || parsed.i.length > 64
  ) {
    return null;
  }
  return {
    organizationId: parsed.o,
    projectId: parsed.p,
    environment: parsed.e as Environment,
    channel: parsed.c,
    origin: parsed.i,
  };
}

function decode(parsed: Record<string, unknown>): RealtimeEventReference | null {
  const base = decodeScope(parsed);
  const sequence = parsed.s;
  if (!base || typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 1) {
    return null;
  }
  return { ...base, sequence };
}

function decodePresence(parsed: Record<string, unknown>): RealtimePresenceReference | null {
  return decodeScope(parsed);
}
