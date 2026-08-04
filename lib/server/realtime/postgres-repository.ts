import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlQueryable } from "@/lib/server/db/sql";
import type { RealtimeJson, RealtimeRole, RealtimeScope, RealtimeStoredEvent } from
  "@/lib/server/realtime/model";
import { RealtimeError } from "@/lib/server/realtime/model";
import type { RealtimeEventLog } from "@/lib/server/realtime/repository";

type RealtimeDatabase = Pick<PostgresControlPlane, "withTenant">;

type EventRow = {
  channel: string;
  sequence: string | number;
  event: string;
  payload: RealtimeJson;
  actor_role: string;
  created_at: Date;
};

const ROLES: readonly string[] = ["anon", "authenticated", "service_role"];

/**
 * Dauerhafter Event-Log über die tenantgebundene Runtime-Transaktion.
 *
 * Der Port bleibt unverändert, damit `MemoryRealtimeEventLog` weiterhin der
 * Default für Test und Entwicklung sein kann. Neu ist ausschließlich, dass die
 * Sequenz pro Kanal aus der Datenbank stammt: Nur so sehen mehrere Instanzen
 * dieselbe Reihenfolge, und nur so überlebt sie einen Neustart.
 */
export class PostgresRealtimeEventLog implements RealtimeEventLog {
  constructor(
    private readonly database: RealtimeDatabase,
    private readonly actorRef = "realtime",
  ) {}

  async append(event: Omit<RealtimeStoredEvent, "sequence">): Promise<RealtimeStoredEvent> {
    return await this.withTenant(event, false, async (database) => {
      // Atomar und ohne Sperrklausel: der Upsert serialisiert auf der
      // Zählerzeile und gibt die vergebene Sequenz im selben Statement zurück.
      const claimed = await database.query<{ sequence: string | number }>(
        `INSERT INTO realtime_channel_sequences
           (organization_id, project_id, environment, channel, next_sequence, updated_at)
         VALUES ($1,$2,$3,$4,2,$5)
         ON CONFLICT (organization_id, project_id, environment, channel)
         DO UPDATE SET next_sequence = realtime_channel_sequences.next_sequence + 1,
                       updated_at = $5
         RETURNING next_sequence - 1 AS sequence`,
        [event.organizationId, event.projectId, event.environment, event.channel, event.createdAt],
      );

      const sequence = boundedSequence(claimed.rows[0]?.sequence);
      await database.query(
        `INSERT INTO realtime_events
           (organization_id, project_id, environment, channel, sequence, event, payload,
            actor_role, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          event.organizationId, event.projectId, event.environment, event.channel, sequence,
          event.event, event.payload as never, event.actorRole, event.createdAt,
        ],
      );

      return { ...event, sequence };
    });
  }

  async replay(scope: RealtimeScope, channel: string, afterSequence: number, limit: number) {
    return await this.withTenant(scope, true, async (database) => {
      const latest = await this.latestFor(database, scope, channel);

      // Eine Zeile mehr als angefordert entscheidet, ob weitere Ereignisse
      // ausstehen. Ohne diese Unterscheidung könnte ein Cursor stillschweigend
      // hinter dem Log zurückbleiben.
      const rows = await database.query<EventRow>(
        `SELECT channel, sequence, event, payload, actor_role, created_at
           FROM realtime_events
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND channel=$4
            AND sequence > $5
          ORDER BY sequence
          LIMIT $6`,
        [scope.organizationId, scope.projectId, scope.environment, channel, afterSequence, limit + 1],
      );

      const earliest = await this.earliestFor(database, scope, channel);
      const events = rows.rows.slice(0, limit).map((row) => this.toEvent(scope, row));

      return {
        events,
        latestSequence: latest,
        // Der Cursor ist unbrauchbar, wenn er hinter das Log zeigt, wenn die
        // Aufbewahrung den angeforderten Bereich bereits entfernt hat, oder
        // wenn mehr Ereignisse ausstehen als das Limit zulässt.
        stale: afterSequence > latest
          || (earliest !== null && afterSequence < earliest - 1)
          || rows.rows.length > limit,
      };
    });
  }

  async latestSequence(scope: RealtimeScope, channel: string): Promise<number> {
    return await this.withTenant(scope, true, (database) => this.latestFor(database, scope, channel));
  }

  /**
   * Entfernt Ereignisse jenseits der Aufbewahrung. Bewusst kein Teil des Ports:
   * Aufräumen ist Betrieb, nicht Zustellung.
   */
  async prune(scope: RealtimeScope, olderThan: Date): Promise<number> {
    return await this.withTenant(scope, false, async (database) => {
      const removed = await database.query<{ count: string | number }>(
        `WITH deleted AS (
           DELETE FROM realtime_events
            WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND created_at < $4
            RETURNING 1
         ) SELECT count(*)::bigint AS count FROM deleted`,
        [scope.organizationId, scope.projectId, scope.environment, olderThan],
      );
      return boundedSequence(removed.rows[0]?.count ?? 0, 0);
    });
  }

  private async latestFor(database: SqlQueryable, scope: RealtimeScope, channel: string) {
    const result = await database.query<{ sequence: string | number | null }>(
      `SELECT coalesce(max(sequence), 0) AS sequence FROM realtime_events
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND channel=$4`,
      [scope.organizationId, scope.projectId, scope.environment, channel],
    );
    return boundedSequence(result.rows[0]?.sequence ?? 0, 0);
  }

  private async earliestFor(database: SqlQueryable, scope: RealtimeScope, channel: string) {
    const result = await database.query<{ sequence: string | number | null }>(
      `SELECT min(sequence) AS sequence FROM realtime_events
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND channel=$4`,
      [scope.organizationId, scope.projectId, scope.environment, channel],
    );
    const value = result.rows[0]?.sequence;
    return value === null || value === undefined ? null : boundedSequence(value);
  }

  private toEvent(scope: RealtimeScope, row: EventRow): RealtimeStoredEvent {
    if (!ROLES.includes(row.actor_role)) throw new RealtimeError("REALTIME_INVALID_MESSAGE");
    return {
      ...scope,
      channel: row.channel,
      sequence: boundedSequence(row.sequence),
      event: row.event,
      payload: row.payload,
      actorRole: row.actor_role as RealtimeRole,
      createdAt: new Date(row.created_at),
    };
  }

  private withTenant<T>(
    scope: RealtimeScope,
    readOnly: boolean,
    work: (database: SqlQueryable) => Promise<T>,
  ): Promise<T> {
    return this.database.withTenant(
      { organizationId: scope.organizationId, actorRef: this.actorRef, readOnly },
      async (repositories) => work(repositories.transaction),
    );
  }
}

/**
 * `bigint` erreicht den Treiber als Zeichenkette. Ein ungeprüfter Wert würde
 * still zu NaN werden und die Reihenfolge zerstören — dieselbe Fehlerklasse,
 * die in Release 1.9 die Schema-Introspektion unbrauchbar gemacht hat.
 */
function boundedSequence(value: string | number | null | undefined, minimum = 1): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new RealtimeError("REALTIME_INVALID_MESSAGE");
  }
  return parsed;
}
