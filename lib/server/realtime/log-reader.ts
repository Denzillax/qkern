import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlQueryable } from "@/lib/server/db/sql";
import type { Environment } from "@/lib/types";

/**
 * Was die Kontrollebene ueber den Realtime-Transport einer Umgebung wirklich
 * festhaelt (2.86), nur lesend.
 *
 * Drei Dinge hat die Platzhalterseite versprochen, und nur zwei davon gibt es.
 * Dieser Leser holt das, was es gibt, und er holt es an einem Stueck:
 *
 * **Kanaele.** `realtime_channel_sequences` fuehrt je Kanal den Zaehler, aus
 * dem die Sequenz einer Nachricht stammt. Die Zeile ueberlebt die Aufbewahrung
 * der Ereignisse, und genau darum steht hier neben der Zahl der noch
 * vorhandenen Nachrichten auch die Zahl der jemals vergebenen Sequenzen. Die
 * Differenz ist kein Schaden, sondern die Aufbewahrung bei der Arbeit.
 *
 * **Nachrichten.** `realtime_events` haelt je Broadcast eine Zeile mit Kanal,
 * Sequenz, Ereignisnamen, Rolle des Absenders und Zeitpunkt. Die Nutzlast wird
 * **nicht** gelesen, nur ihre Groesse: Sie stammt von einem Client des
 * Projekts und kann alles enthalten, was dieser Client geschickt hat. Eine
 * Logseite muss nicht wissen, was drinstand, um zu sagen, dass es sie gab.
 *
 * **Die Position der Webhook-Bruecke.** `project_database_webhook_cursors`
 * sagt, bis wohin diese Umgebung den Aenderungs-Feed gelesen hat. Sie wird in
 * derselben Transaktion gelesen wie die Kanaele, damit die Seite nicht zwei
 * Augenblicke nebeneinanderstellt.
 *
 * Gelesen wird unter dem Aufrufer der Ansicht und damit unter RLS. Ein eigener
 * Leser mit weiteren Rechten waere nichts als eine zweite Tuer.
 */
export type RealtimeLogScope = {
  organizationId: string;
  projectId: string;
  environment: Environment;
};

export type RealtimeLogPrincipal = {
  organizationId: string;
  actorRef: string;
};

/** Die drei Rollen, die `realtime_events.actor_role` zulaesst. */
export const REALTIME_ACTOR_ROLES = ["anon", "authenticated", "service_role"] as const;
export type RealtimeActorRole = (typeof REALTIME_ACTOR_ROLES)[number];

export type RealtimeChannelEntry = {
  channel: string;
  /** Zeilen, die noch im Log liegen. */
  stored: number;
  /** Jemals vergebene Sequenzen. Die Differenz zu `stored` ist die Aufbewahrung. */
  assigned: number;
  firstSequence: number | null;
  lastSequence: number | null;
  firstCreatedAt: string | null;
  lastCreatedAt: string | null;
  /** Wann der Zaehler zuletzt eine Sequenz vergeben hat. */
  counterUpdatedAt: string;
  byRole: Record<RealtimeActorRole, number>;
};

export type RealtimeMessageEntry = {
  channel: string;
  sequence: number;
  event: string;
  actorRole: RealtimeActorRole;
  createdAt: string;
  /** Die Groesse der Nutzlast, nicht die Nutzlast. */
  payloadBytes: number;
};

export type RealtimeBridgeCursor = {
  position: number;
  updatedAt: string;
};

export type RealtimeLogReading = {
  source: "postgres";
  channels: RealtimeChannelEntry[];
  /** Mehr Kanaele als die Grenze zulaesst. */
  channelsTruncated: boolean;
  messages: RealtimeMessageEntry[];
  /** Mehr Nachrichten als die Grenze zulaesst; die Liste ist ein Ausschnitt. */
  messagesTruncated: boolean;
  /** `null` heisst: Die Bruecke hat diese Umgebung noch nie gelesen. */
  cursor: RealtimeBridgeCursor | null;
};

export const MAX_REALTIME_CHANNELS = 200;
export const MAX_REALTIME_MESSAGES = 100;

/**
 * Kanaele mit ihrem Zaehler und dem, was von ihren Nachrichten noch da ist.
 *
 * Der LEFT JOIN geht bewusst von den Zaehlern aus und nicht von den
 * Ereignissen: Ein Kanal, dessen Nachrichten die Aufbewahrung entfernt hat,
 * verschwaende sonst aus der Liste, und die Seite behauptete, es habe ihn nie
 * gegeben. `count(event.sequence)` statt `count(*)`, damit die leere Seite des
 * JOIN nicht als eine Nachricht durchgeht.
 *
 * Die Ordnung ist festgelegt und hat einen Zweitschluessel: Zwei Kanaele ohne
 * eine einzige verbliebene Nachricht haetten sonst keine bestimmte Reihenfolge.
 */
const CHANNELS_SQL = `
  SELECT sequences.channel AS channel,
         (sequences.next_sequence - 1)::text AS assigned,
         sequences.updated_at AS counter_updated_at,
         count(event.sequence)::text AS stored,
         min(event.sequence)::text AS first_sequence,
         max(event.sequence)::text AS last_sequence,
         min(event.created_at) AS first_created_at,
         max(event.created_at) AS last_created_at,
         count(event.sequence) FILTER (WHERE event.actor_role = 'anon')::text AS anon,
         count(event.sequence) FILTER (WHERE event.actor_role = 'authenticated')::text AS authenticated,
         count(event.sequence) FILTER (WHERE event.actor_role = 'service_role')::text AS service_role
    FROM realtime_channel_sequences AS sequences
    LEFT JOIN realtime_events AS event
      ON event.organization_id = sequences.organization_id
     AND event.project_id = sequences.project_id
     AND event.environment = sequences.environment
     AND event.channel = sequences.channel
   WHERE sequences.organization_id = $1 AND sequences.project_id = $2
     AND sequences.environment = $3
   GROUP BY sequences.channel, sequences.next_sequence, sequences.updated_at
   ORDER BY sequences.updated_at DESC, sequences.channel ASC
   LIMIT $4`;

/**
 * Die juengsten Nachrichten, quer ueber alle Kanaele.
 *
 * `payload` steht in keiner Spalte dieser Anweisung. Gefragt wird nur ihre
 * Groesse, und die verraet nichts ueber ihren Inhalt.
 *
 * Die Ordnung traegt Kanal und Sequenz als Zweitschluessel: Zwei Nachrichten
 * koennen denselben Zeitstempel haben, und dann waere die Reihenfolge ohne sie
 * offen.
 */
const MESSAGES_SQL = `
  SELECT channel, sequence::text AS sequence, event, actor_role,
         created_at, octet_length(payload::text)::text AS payload_bytes
    FROM realtime_events
   WHERE organization_id = $1 AND project_id = $2 AND environment = $3
   ORDER BY created_at DESC, channel ASC, sequence DESC
   LIMIT $4`;

const CURSOR_SQL = `
  SELECT position::text AS position, updated_at
    FROM project_database_webhook_cursors
   WHERE organization_id = $1 AND project_id = $2 AND environment = $3`;

type ChannelRow = {
  channel: string;
  assigned: string;
  counter_updated_at: Date;
  stored: string;
  first_sequence: string | null;
  last_sequence: string | null;
  first_created_at: Date | null;
  last_created_at: Date | null;
  anon: string;
  authenticated: string;
  service_role: string;
};

type MessageRow = {
  channel: string;
  sequence: string;
  event: string;
  actor_role: string;
  created_at: Date;
  payload_bytes: string;
};

type CursorRow = { position: string; updated_at: Date };

export class PostgresRealtimeLogReader {
  constructor(private readonly database: Pick<PostgresControlPlane, "withTenant">) {}

  async read(principal: RealtimeLogPrincipal, scope: RealtimeLogScope): Promise<RealtimeLogReading> {
    // Eine Transaktion fuer alle drei Lesungen. Getrennt gefragt koennten sie
    // aus drei Augenblicken stammen und eine Umgebung beschreiben, die es so
    // nie gab.
    return await this.database.withTenant(
      { organizationId: principal.organizationId, actorRef: principal.actorRef, readOnly: true },
      async (repositories) => {
        const transaction: SqlQueryable = repositories.transaction;
        const values = [scope.organizationId, scope.projectId, scope.environment];

        const channelRows = await transaction.query<ChannelRow>(
          CHANNELS_SQL, [...values, MAX_REALTIME_CHANNELS + 1]);
        const messageRows = await transaction.query<MessageRow>(
          MESSAGES_SQL, [...values, MAX_REALTIME_MESSAGES + 1]);
        const cursorRows = await transaction.query<CursorRow>(CURSOR_SQL, values);

        const channels = channelRows.rows.slice(0, MAX_REALTIME_CHANNELS).map(toChannel);
        const messages = messageRows.rows.slice(0, MAX_REALTIME_MESSAGES).map(toMessage);
        const cursorRow = cursorRows.rows[0];

        return {
          source: "postgres" as const,
          channels,
          channelsTruncated: channelRows.rows.length > channels.length,
          messages,
          messagesTruncated: messageRows.rows.length > messages.length,
          cursor: cursorRow === undefined
            ? null
            : { position: count(cursorRow.position), updatedAt: moment(cursorRow.updated_at) },
        };
      });
  }
}

function toChannel(row: ChannelRow): RealtimeChannelEntry {
  return {
    channel: String(row.channel),
    stored: count(row.stored),
    assigned: count(row.assigned),
    firstSequence: row.first_sequence === null ? null : count(row.first_sequence),
    lastSequence: row.last_sequence === null ? null : count(row.last_sequence),
    firstCreatedAt: row.first_created_at === null ? null : moment(row.first_created_at),
    lastCreatedAt: row.last_created_at === null ? null : moment(row.last_created_at),
    counterUpdatedAt: moment(row.counter_updated_at),
    byRole: {
      anon: count(row.anon),
      authenticated: count(row.authenticated),
      service_role: count(row.service_role),
    },
  };
}

function toMessage(row: MessageRow): RealtimeMessageEntry {
  const role = String(row.actor_role);
  if (!(REALTIME_ACTOR_ROLES as readonly string[]).includes(role)) {
    // Die Spalte hat einen CHECK auf genau diese drei. Steht etwas anderes
    // darin, ist die Annahme ueber die Tabelle falsch und nicht die Zeile
    // erklaerungsbeduerftig.
    throw new TypeError("A realtime event carries an unknown actor role.");
  }
  return {
    channel: String(row.channel),
    sequence: count(row.sequence),
    event: String(row.event),
    actorRole: role as RealtimeActorRole,
    createdAt: moment(row.created_at),
    payloadBytes: count(row.payload_bytes),
  };
}

/** `bigint` erreicht den Treiber als Zeichenkette; ungeprueft wuerde daraus still `NaN`. */
function count(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError("A realtime log count must be a bounded integer.");
  }
  return parsed;
}

function moment(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("A realtime log moment must be a real point in time.");
  }
  return parsed.toISOString();
}
