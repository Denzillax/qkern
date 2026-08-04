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

export interface RealtimeEventBus {
  /** Meldet ein neu geschriebenes Ereignis an alle anderen Instanzen. */
  publish(reference: RealtimeEventReference): Promise<void>;
  /** Registriert genau einen Empfänger. Ein zweiter Aufruf ist ein Fehler. */
  subscribe(handler: (reference: RealtimeEventReference) => void): Promise<void>;
  close(): Promise<void>;
}

/**
 * Prozesslokaler Bus. Nützlich für Tests, die zwei Service-Instanzen in einem
 * Prozess verbinden. Er ersetzt keinen Mehrinstanzbetrieb: ohne gemeinsamen
 * Prozess erreicht er nichts.
 */
export class MemoryRealtimeEventBus implements RealtimeEventBus {
  private readonly handlers = new Set<(reference: RealtimeEventReference) => void>();

  async publish(reference: RealtimeEventReference): Promise<void> {
    for (const handler of this.handlers) {
      if (reference.origin === handlerOrigin.get(handler)) continue;
      handler({ ...reference });
    }
  }

  async subscribe(handler: (reference: RealtimeEventReference) => void): Promise<void> {
    this.handlers.add(handler);
  }

  /** Bindet einen Empfänger an eine Instanz, damit er sein eigenes Ereignis überspringt. */
  subscribeAs(origin: string, handler: (reference: RealtimeEventReference) => void): void {
    handlerOrigin.set(handler, origin);
    this.handlers.add(handler);
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }
}

const handlerOrigin = new WeakMap<(reference: RealtimeEventReference) => void, string>();

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
    if (this.closed) return;
    const payload = JSON.stringify(encode(reference));
    if (Buffer.byteLength(payload, "utf8") > MAX_NOTIFICATION_BYTES) {
      throw new RealtimeError("REALTIME_PAYLOAD_TOO_LARGE");
    }
    this.publisher ??= await this.options.connect();
    await this.publisher.query("SELECT pg_notify($1, $2)", [this.channelName, payload]);
  }

  async subscribe(handler: (reference: RealtimeEventReference) => void): Promise<void> {
    if (this.listener) throw new RealtimeError("REALTIME_INVALID_MESSAGE");
    const connection = await this.options.connect();
    this.listener = connection;

    connection.on("notification", (message) => {
      if (message.channel !== this.channelName || !message.payload) return;
      const reference = decode(message.payload);
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

/** Gibt `null` zurück, statt bei fremder oder beschädigter Nutzlast zu werfen. */
function decode(payload: string): RealtimeEventReference | null {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const sequence = parsed.s;
    if (
      typeof parsed.o !== "string" || typeof parsed.p !== "string" || typeof parsed.e !== "string"
      || typeof parsed.c !== "string" || typeof parsed.i !== "string"
      || typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 1
      || parsed.c.length > 128 || parsed.i.length > 64
    ) {
      return null;
    }
    return {
      organizationId: parsed.o,
      projectId: parsed.p,
      environment: parsed.e as Environment,
      channel: parsed.c,
      sequence,
      origin: parsed.i,
    };
  } catch {
    return null;
  }
}
