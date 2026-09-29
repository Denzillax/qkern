import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlQueryable } from "@/lib/server/db/sql";
import type { CronProgress, CronRepository } from "@/lib/server/compute/cron-scheduler";
import type { ProjectQueueJson, ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import type { Environment } from "@/lib/types";

type CronDatabase = Pick<PostgresControlPlane, "withTenant">;

type CronRow = {
  id: string;
  organization_id: string;
  project_id: string;
  environment: Environment;
  name: string;
  expression: string;
  queue: string;
  payload: ProjectQueueJson;
  enabled: boolean;
  time_zone: string;
  last_dispatched_at: Date | null;
};

/**
 * Dauerhafte Cron-Definitionen über die tenantgebundene Runtime-Transaktion.
 *
 * `recordDispatch` schreibt ausschließlich `last_dispatched_at` und verlässt
 * sich dabei auf den Trigger aus Migration 0031: Ein Rücksprung wird von der
 * Datenbank abgewiesen, nicht von dieser Klasse. Die Prüfung gehört dorthin,
 * wo sie auch ein zweiter Schreiber nicht umgehen kann.
 */
export class PostgresCronRepository implements CronRepository {
  constructor(private readonly database: CronDatabase) {}

  async listActive(principal: ProjectQueuePrincipal, scope: {
    organizationId: string; projectId: string; environment: Environment;
  }): Promise<CronProgress[]> {
    return await this.withTenant(principal, true, async (database) => {
      const result = await database.query<CronRow>(
        `SELECT id, organization_id, project_id, environment, name, expression, queue,
                payload, enabled, time_zone, last_dispatched_at
           FROM project_cron_definitions
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND enabled
          ORDER BY name`,
        [scope.organizationId, scope.projectId, scope.environment],
      );
      return result.rows.map(toProgress);
    });
  }

  async recordDispatch(
    principal: ProjectQueuePrincipal,
    definitionId: string,
    dispatchedAt: Date,
  ): Promise<void> {
    await this.withTenant(principal, false, async (database) => {
      await database.query(
        `UPDATE project_cron_definitions
            SET last_dispatched_at=$3, updated_at=now()
          WHERE organization_id=$1 AND id=$2`,
        [principal.organizationId, definitionId, dispatchedAt],
      );
    });
  }

  private withTenant<T>(
    principal: ProjectQueuePrincipal,
    readOnly: boolean,
    work: (database: SqlQueryable) => Promise<T>,
  ): Promise<T> {
    return this.database.withTenant({
      organizationId: principal.organizationId,
      actorRef: principal.actorRef,
      readOnly,
    }, async (repositories) => work(repositories.transaction));
  }
}

function toProgress(row: CronRow): CronProgress {
  return {
    organizationId: row.organization_id,
    projectId: row.project_id,
    environment: row.environment,
    id: row.id,
    name: row.name,
    expression: row.expression,
    queue: row.queue,
    payload: row.payload,
    enabled: row.enabled,
    timeZone: row.time_zone,
    lastDispatchedAt: row.last_dispatched_at === null ? null : new Date(row.last_dispatched_at),
  };
}
