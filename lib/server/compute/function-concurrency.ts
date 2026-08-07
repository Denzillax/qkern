import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlQueryable } from "@/lib/server/db/sql";
import type { ComputeDefinitionScope } from "@/lib/server/compute/definitions";

/** Ein belegter Platz. Wird immer freigegeben, auch nach einem Fehlschlag. */
export type FunctionSlot = Readonly<{ release(): Promise<void> }>;

export interface FunctionConcurrencyPort {
  /**
   * Belegt einen Platz oder gibt `null` zurück, wenn die Grenze erreicht ist.
   *
   * `leaseMs` ist die Zeit, nach der ein Platz auch ohne Freigabe verfällt. Er
   * muss länger sein als der Timeout der Function: Ein Platz, der vor dem
   * Container abläuft, würde die Grenze stillschweigend überschreiten lassen.
   */
  claim(
    scope: ComputeDefinitionScope,
    functionId: string,
    limit: number,
    leaseMs: number,
  ): Promise<FunctionSlot | null>;
}

/**
 * Teilt die Grenze über Prozesse hinweg — ein Platz ist eine Zeile.
 *
 * Bis Release 1.35 galt `maxConcurrency` **prozesslokal**. Zwei Web-Instanzen
 * zählten getrennt, die tatsächliche Obergrenze war also
 * `maxConcurrency × Instanzen`. Das stand in jeder Release-Notiz seit 1.23 als
 * offener Punkt.
 *
 * Gezählt und eingefügt wird unter einer transaktionsgebundenen Vorsperre.
 * Ohne sie könnten zwei Instanzen gleichzeitig denselben freien Platz sehen und
 * beide belegen — die Grenze wäre dann eine Empfehlung.
 *
 * Der Halter steht in der Zeile, aber **nicht** in der Bedingung: Ein Adapter,
 * der nur eigene Plätze zählte, würde fremde übersehen und genau das Problem
 * wiederholen, das er lösen soll.
 */
export class PostgresFunctionConcurrency implements FunctionConcurrencyPort {
  constructor(
    private readonly database: Pick<PostgresControlPlane, "withTenant">,
    private readonly holder: string,
    private readonly actorRef = "service-role:functions",
  ) {}

  async claim(
    scope: ComputeDefinitionScope,
    functionId: string,
    limit: number,
    leaseMs: number,
  ): Promise<FunctionSlot | null> {
    const now = new Date();
    const slotId = await this.withTenant(scope, async (database) => {
      await database.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `qkern:function-slot:${scope.organizationId}:${functionId}`,
      ]);
      // Ein Prozess, der zwischen Belegen und Freigeben gestorben ist, gibt
      // seinen Platz von selbst zurueck: Der Ablaufvergleich unten zaehlt ihn
      // nicht mehr mit. Das Loeschen hier raeumt nur auf — nicht es macht die
      // Zusage,
      // das tut der Ablaufvergleich unten —, aber ohne sie waechst die Tabelle
      // um jeden abgestuerzten Prozess.
      await database.query(
        `DELETE FROM project_function_slots
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3
            AND function_id=$4 AND expires_at <= $5`,
        [scope.organizationId, scope.projectId, scope.environment, functionId, now],
      );
      const active = await database.query<{ used: number }>(
        `SELECT count(*)::int AS used FROM project_function_slots
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3
            AND function_id=$4 AND expires_at > $5`,
        [scope.organizationId, scope.projectId, scope.environment, functionId, now],
      );
      if ((active.rows[0]?.used ?? 0) >= limit) return null;

      const inserted = await database.query<{ id: string }>(
        `INSERT INTO project_function_slots
           (organization_id, project_id, environment, function_id, holder, claimed_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [scope.organizationId, scope.projectId, scope.environment, functionId, this.holder,
          now, new Date(now.getTime() + leaseMs)],
      );
      return inserted.rows[0]?.id ?? null;
    });

    if (!slotId) return null;
    return Object.freeze({ release: () => this.release(scope, slotId) });
  }

  /** Laufende Plätze einer Definition. Nur zur Beobachtung. */
  async active(scope: ComputeDefinitionScope, functionId: string): Promise<number> {
    return await this.withTenant(scope, async (database) => {
      const result = await database.query<{ used: number }>(
        `SELECT count(*)::int AS used FROM project_function_slots
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3
            AND function_id=$4 AND expires_at > $5`,
        [scope.organizationId, scope.projectId, scope.environment, functionId, new Date()],
      );
      return result.rows[0]?.used ?? 0;
    });
  }

  private async release(scope: ComputeDefinitionScope, slotId: string): Promise<void> {
    // Schlaegt die Freigabe fehl, bleibt der Ablauf. Eine Ausnahme hier wuerde
    // den Aufruf nachtraeglich rot machen, obwohl die Function gelaufen ist.
    try {
      await this.withTenant(scope, async (database) => {
        await database.query(
          "DELETE FROM project_function_slots WHERE organization_id=$1 AND id=$2",
          [scope.organizationId, slotId],
        );
      });
    } catch { /* Der Ablauf raeumt auf. */ }
  }

  private withTenant<T>(
    scope: ComputeDefinitionScope,
    work: (database: SqlQueryable) => Promise<T>,
  ): Promise<T> {
    return this.database.withTenant({
      organizationId: scope.organizationId, actorRef: this.actorRef, readOnly: false,
    }, async (repositories) => work(repositories.transaction));
  }
}
