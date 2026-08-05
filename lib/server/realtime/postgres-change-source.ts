import type { RealtimeJson, RealtimeScope } from "@/lib/server/realtime/model";
import { RealtimeError } from "@/lib/server/realtime/model";
import type {
  RealtimeChange,
  RealtimeChangeOperation,
  RealtimeChangeSource,
} from "@/lib/server/realtime/change-source";

/**
 * Verbindung zu einer Projektdatenbank, wie die Data Plane sie auflöst.
 * Nur die Teilmenge, die diese Quelle braucht.
 */
export interface ProjectQueryable {
  query<Row extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[] }>;
}

export interface ProjectConnection {
  withProject<T>(scope: RealtimeScope, work: (database: ProjectQueryable) => Promise<T>): Promise<T>;
}

type FeedRow = {
  position: string | number;
  schema_name: string;
  table_name: string;
  operation: string;
  row_key: Record<string, RealtimeJson>;
  committed_at: Date;
};

const OPERATIONS: readonly string[] = ["insert", "update", "delete"];
const MAX_LIMIT = 500;

/**
 * Liest `qkern_internal.change_feed` einer Projektdatenbank.
 *
 * Die Quelle hält keinen Zustand: Der Aufrufer führt die Position und bestimmt
 * den Takt. Das hält sie über Instanzgrenzen hinweg unproblematisch — zwei
 * Instanzen, die denselben Bereich lesen, erzeugen dieselben Änderungen, und
 * die Sichtbarkeitsprüfung entscheidet ohnehin je Abonnent neu.
 */
export class PostgresRealtimeChangeSource implements RealtimeChangeSource {
  constructor(private readonly connection: ProjectConnection) {}

  async read(scope: RealtimeScope, after: number, limit: number): Promise<RealtimeChange[]> {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit)
      || limit < 1 || limit > MAX_LIMIT) {
      throw new RealtimeError("REALTIME_INVALID_MESSAGE");
    }

    return await this.connection.withProject(scope, async (database) => {
      const result = await database.query<FeedRow>(
        `SELECT position, schema_name, table_name, operation, row_key, committed_at
           FROM qkern_internal.change_feed
          WHERE position > $1
          ORDER BY position
          LIMIT $2`,
        [after, limit],
      );
      return result.rows.map((row) => toChange(scope, row));
    });
  }

  async prune(scope: RealtimeScope, before: Date): Promise<number> {
    if (!(before instanceof Date) || Number.isNaN(before.getTime())) {
      throw new RealtimeError("REALTIME_INVALID_MESSAGE");
    }
    return await this.connection.withProject(scope, async (database) => {
      const result = await database.query<{ count: string | number }>(
        `WITH deleted AS (
           DELETE FROM qkern_internal.change_feed WHERE committed_at < $1 RETURNING 1
         ) SELECT count(*)::bigint AS count FROM deleted`,
        [before],
      );
      return boundedPosition(result.rows[0]?.count ?? 0, 0);
    });
  }
}

function toChange(scope: RealtimeScope, row: FeedRow): RealtimeChange {
  if (!OPERATIONS.includes(row.operation)) throw new RealtimeError("REALTIME_INVALID_MESSAGE");
  if (typeof row.row_key !== "object" || row.row_key === null || Array.isArray(row.row_key)) {
    throw new RealtimeError("REALTIME_INVALID_MESSAGE");
  }
  return {
    ...scope,
    position: boundedPosition(row.position),
    schema: row.schema_name,
    table: row.table_name,
    operation: row.operation as RealtimeChangeOperation,
    key: row.row_key,
    committedAt: new Date(row.committed_at),
  };
}

/**
 * `bigint` erreicht den Treiber als Zeichenkette. Ungeprüft würde daraus still
 * `NaN` und die Position wäre wertlos — dieselbe Fehlerklasse, die in Release
 * 1.9 die Schema-Introspektion unbrauchbar gemacht hat.
 */
function boundedPosition(value: string | number, minimum = 1): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new RealtimeError("REALTIME_INVALID_MESSAGE");
  }
  return parsed;
}
