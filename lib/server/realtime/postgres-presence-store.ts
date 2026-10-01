import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlQueryable } from "@/lib/server/db/sql";
import type {
  RealtimeJson,
  RealtimePresenceEntry,
  RealtimeScope,
} from "@/lib/server/realtime/model";
import { RealtimeError } from "@/lib/server/realtime/model";
import {
  MAX_PRESENCE_PER_CHANNEL,
  type RealtimePresenceStore,
  type RealtimePresenceWrite,
} from "@/lib/server/realtime/presence-store";

type PresenceDatabase = Pick<PostgresControlPlane, "withTenant">;

type PresenceRow = { presence_key: string; state: RealtimeJson };

/**
 * Dauerhafte Presence ueber die tenantgebundene Runtime-Transaktion (0077).
 *
 * Der Port bleibt derselbe, damit `MemoryRealtimePresenceStore` weiterhin der
 * Default fuer Test und Entwicklung sein kann. Neu ist, dass ein Eintrag die
 * Instanz verlaesst: Erst damit sieht ein Abonnent der zweiten Instanz die
 * Abonnenten der ersten, und erst damit ueberlebt Presence einen Neustart.
 *
 * **`now` kommt vom Aufrufer, nicht aus `now()` der Datenbank.** Dieselbe Uhr
 * entscheidet dann ueber Pacht und Ablauf, die auch die Pacht gesetzt hat; eine
 * zweite Uhr mitten im Vertrag waere eine Abweichung, die niemand sieht, bis
 * Presence unter Last flackert. Die Faelle setzen die Uhr, und das koennen sie
 * nur so.
 */
export class PostgresRealtimePresenceStore implements RealtimePresenceStore {
  constructor(
    private readonly database: PresenceDatabase,
    private readonly actorRef = "realtime",
  ) {}

  async put(scope: RealtimeScope, channel: string, entry: RealtimePresenceWrite): Promise<void> {
    if (entry.expiresAt.getTime() <= entry.trackedAt.getTime()) {
      throw new RealtimeError("REALTIME_INVALID_MESSAGE");
    }
    await this.withTenant(scope, false, async (database) => {
      await database.query(
        `INSERT INTO realtime_presence
           (organization_id, project_id, environment, channel, presence_key, instance_id,
            state, tracked_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (organization_id, project_id, environment, channel, presence_key)
         DO UPDATE SET instance_id = $6, state = $7, tracked_at = $8, expires_at = $9`,
        [
          scope.organizationId, scope.projectId, scope.environment, channel, entry.presenceKey,
          entry.instanceId, entry.state as never, entry.trackedAt, entry.expiresAt,
        ],
      );
    });
  }

  async remove(scope: RealtimeScope, channel: string, presenceKey: string): Promise<void> {
    await this.withTenant(scope, false, async (database) => {
      await database.query(
        `DELETE FROM realtime_presence
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3
            AND channel=$4 AND presence_key=$5`,
        [scope.organizationId, scope.projectId, scope.environment, channel, presenceKey],
      );
    });
  }

  async list(
    scope: RealtimeScope, channel: string, now: Date, limit: number,
  ): Promise<RealtimePresenceEntry[]> {
    boundedLimit(limit);
    return await this.withTenant(scope, true, async (database) => {
      // `expires_at > $5` ist die erste der beiden Stufen aus 0077: Die
      // Sichtbarkeit endet am Ablauf, nicht am Loeschen. Eine Zeile, deren
      // Pacht niemand erneuert hat, zaehlt hier ab der Sekunde nicht mehr mit,
      // auch wenn der Aufraeumer sie erst spaeter wegnimmt.
      const result = await database.query<PresenceRow>(
        `SELECT presence_key, state FROM realtime_presence
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3
            AND channel=$4 AND expires_at > $5
          ORDER BY presence_key
          LIMIT $6`,
        [scope.organizationId, scope.projectId, scope.environment, channel, now, limit],
      );
      return result.rows.map((row) => toEntry(row));
    });
  }

  async renew(
    scope: RealtimeScope, channel: string, instanceId: string,
    presenceKeys: readonly string[], expiresAt: Date,
  ): Promise<number> {
    if (presenceKeys.length === 0) return 0;
    boundedLimit(presenceKeys.length);
    return await this.withTenant(scope, false, async (database) => {
      // `instance_id = $6` ist keine Vorsichtsmassnahme, sondern die Aussage:
      // Nur die Instanz, die die Verbindung haelt, darf behaupten, dass dieser
      // Abonnent noch da ist. Ohne diese Bedingung koennte eine Instanz die
      // Waisen einer anderen beliebig lange am Leben halten.
      const result = await database.query<{ presence_key: string }>(
        `UPDATE realtime_presence SET expires_at = $5
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3
            AND channel=$4 AND presence_key = ANY($7::text[]) AND instance_id = $6
          RETURNING presence_key`,
        [
          scope.organizationId, scope.projectId, scope.environment, channel, expiresAt,
          instanceId, [...presenceKeys],
        ],
      );
      return result.rows.length;
    });
  }

  async prune(scope: RealtimeScope, expiredBefore: Date, limit: number): Promise<number> {
    boundedLimit(limit);
    return await this.withTenant(scope, false, async (database) => {
      // Haeppchenweise ueber eine Unterabfrage statt mit einem nackten DELETE:
      // Eine Tabelle voller Waisen wird so ueber viele Runden leer, statt in
      // einer einzigen Anweisung gesperrt zu werden. Dasselbe Muster wie beim
      // Auth-Aufraeumer aus 0063.
      const result = await database.query<{ presence_key: string }>(
        `DELETE FROM realtime_presence WHERE (organization_id, project_id, environment,
            channel, presence_key) IN (
           SELECT organization_id, project_id, environment, channel, presence_key
             FROM realtime_presence
            WHERE organization_id=$1 AND project_id=$2 AND environment=$3
              AND expires_at < $4
            ORDER BY expires_at
            LIMIT $5
         ) RETURNING presence_key`,
        [scope.organizationId, scope.projectId, scope.environment, expiredBefore, limit],
      );
      return result.rows.length;
    });
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

function toEntry(row: PresenceRow): RealtimePresenceEntry {
  if (typeof row.presence_key !== "string" || !row.state || typeof row.state !== "object"
    || Array.isArray(row.state)) {
    throw new RealtimeError("REALTIME_INVALID_MESSAGE");
  }
  return { presenceKey: row.presence_key, state: row.state as Record<string, RealtimeJson> };
}

function boundedLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PRESENCE_PER_CHANNEL) {
    throw new RealtimeError("REALTIME_INVALID_MESSAGE");
  }
  return limit;
}
