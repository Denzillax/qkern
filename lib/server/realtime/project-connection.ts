import type { ProjectDataPlaneTargetResolver } from "@/lib/server/data-plane/service";
import type { ProjectDatabaseConnectionResolver } from "@/lib/server/migrations/postgres-executor";
import type { RealtimeScope } from "@/lib/server/realtime/model";
import { RealtimeError } from "@/lib/server/realtime/model";
import type { ProjectConnection, ProjectQueryable } from
  "@/lib/server/realtime/postgres-change-source";

type BoundaryRow = {
  role_name: string;
  session_name: string;
  database_name: string;
  can_login: boolean;
  superuser: boolean;
  bypass_rls: boolean;
  replication: boolean;
};

/**
 * Löst je Scope die Projektdatenbank auf, in der der Änderungs-Feed liegt.
 *
 * Ohne diesen Port blieb ein `changes:`-Abonnement in der Realtime-Runtime leer:
 * Registry, Quelle und Reader waren zertifiziert, aber niemand konnte ihnen eine
 * Verbindung geben. Der Weg ist derselbe wie in der Generated Data API — erst
 * die Control Plane nach dem Katalogverweis fragen, dann den Katalog nach der
 * Verbindung.
 *
 * Die Rollen- und Datenbankgrenze wird bei **jedem** Zugriff geprüft, nicht
 * einmal beim Start. Ein Katalog, der auf eine andere Datenbank oder eine
 * privilegiertere Rolle zeigt, würde sonst unbemerkt Feed-Zeilen fremder
 * Projekte liefern — und der Reader löst daraufhin Lesevorgänge mit den Claims
 * echter Abonnenten aus.
 */
export class ControlPlaneRealtimeProjectConnection implements ProjectConnection {
  constructor(
    private readonly targets: ProjectDataPlaneTargetResolver,
    private readonly connections: ProjectDatabaseConnectionResolver,
    private readonly actorRef = "realtime",
  ) {}

  async withProject<T>(
    scope: RealtimeScope,
    work: (database: ProjectQueryable) => Promise<T>,
  ): Promise<T> {
    const target = await this.targets.resolveTarget(
      { organizationId: scope.organizationId, actorRef: this.actorRef },
      { projectId: scope.projectId, environment: scope.environment },
    ).catch(() => null);
    if (!target?.databaseInstanceRef) throw new RealtimeError("REALTIME_ACCESS_DENIED");

    const resolved = await this.connections.resolve(target.databaseInstanceRef);
    if (!resolved?.pool || typeof resolved.expectedRole !== "string"
      || typeof resolved.expectedDatabase !== "string") {
      throw new RealtimeError("REALTIME_ACCESS_DENIED");
    }

    const client = await resolved.pool.connect();
    try {
      const boundary = await client.query<BoundaryRow>(
        `SELECT current_user AS role_name, session_user AS session_name,
                current_database() AS database_name, role.rolcanlogin AS can_login,
                role.rolsuper AS superuser, role.rolbypassrls AS bypass_rls,
                role.rolreplication AS replication
           FROM pg_catalog.pg_roles AS role WHERE role.rolname = current_user`,
      );
      const checked = boundary.rows[0];
      if (!checked || checked.role_name !== resolved.expectedRole
        || checked.session_name !== resolved.expectedRole
        || checked.database_name !== resolved.expectedDatabase
        || !checked.can_login || checked.superuser || checked.bypass_rls || checked.replication) {
        throw new RealtimeError("REALTIME_ACCESS_DENIED");
      }
      // Der Feed wird ausschliesslich gelesen und aufgeraeumt; ein
      // Schreibvorgang von hier waere ein erfundenes Aenderungsereignis.
      return await work({
        query: (text, values) => client.query(text, values as never) as never,
      });
    } finally {
      client.release();
    }
  }
}
