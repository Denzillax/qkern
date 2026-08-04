import { InvalidRecordError, mapPostgresError } from "@/lib/server/db/errors";
import type { SqlPool, SqlValue } from "@/lib/server/db/sql";
import { withTenantTransaction } from "@/lib/server/db/transaction";
import type { Membership, OrganizationRole, OrganizationSummary } from "@/lib/server/tenancy";

type DbRow = Record<string, unknown>;

const ORGANIZATION_ROLES: ReadonlySet<string> = new Set([
  "owner", "administrator", "developer", "deployer", "analyst", "support", "read_only",
]);

function membershipFromRow(row: DbRow): Membership {
  const role = String(row.membership_role ?? row.role);
  if (!ORGANIZATION_ROLES.has(role)) throw new InvalidRecordError("The database returned an invalid organization role.");
  return {
    organization: {
      id: String(row.organization_id),
      name: String(row.organization_name ?? row.name),
      slug: String(row.organization_slug ?? row.slug),
    },
    userId: String(row.membership_user_id ?? row.user_id),
    role: role as OrganizationRole,
  };
}

export type WorkspaceProjectInput = {
  id: string;
  name: string;
  slug: string;
  region: string;
  status?: "provisioning" | "ready" | "degraded";
  environment?: "development" | "staging" | "production";
};

export class PostgresTenancyRepository {
  constructor(private readonly pool: SqlPool, private readonly authPool: SqlPool = pool) {}

  async listMemberships(userId: string): Promise<Membership[]> {
    try {
      const result = await this.authPool.query(
        `SELECT organization_id, organization_name, organization_slug,
                membership_user_id, membership_role
         FROM qkern_memberships_for_user($1)`,
        [userId],
      );
      return result.rows.map(membershipFromRow);
    } catch (error) {
      throw mapPostgresError(error);
    }
  }

  async getMembership(userId: string, organizationId: string): Promise<Membership | null> {
    return withTenantTransaction(
      this.pool,
      { organizationId, actorRef: userId, readOnly: true },
      async (transaction) => {
        const result = await transaction.query(
          `SELECT organization.id AS organization_id,
                  organization.name AS organization_name,
                  organization.slug AS organization_slug,
                  member.user_id AS membership_user_id,
                  member.role AS membership_role
           FROM organization_members AS member
           JOIN organizations AS organization
             ON organization.id = member.organization_id
           WHERE member.organization_id = $1
             AND member.user_id = $2
             AND organization.deleted_at IS NULL`,
          [organizationId, userId],
        );
        return result.rows[0] ? membershipFromRow(result.rows[0]) : null;
      },
    );
  }

  async createWorkspace(input: {
    organization: OrganizationSummary;
    userId: string;
    project?: WorkspaceProjectInput;
  }): Promise<Membership> {
    const { organization, userId, project } = input;
    return withTenantTransaction(this.pool, { organizationId: organization.id, actorRef: userId }, async (transaction) => {
      await transaction.query(
        `INSERT INTO organizations (id, name, slug, created_by)
         VALUES ($1, $2, $3, $4)`,
        [organization.id, organization.name, organization.slug, userId],
      );
      await transaction.query(
        `INSERT INTO organization_members (organization_id, user_id, role, is_personal_workspace)
         VALUES ($1, $2, 'owner', true)`,
        [organization.id, userId],
      );
      if (project) {
        await transaction.query(
          `INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [project.id, organization.id, project.name, project.slug, project.region, project.status ?? "provisioning", userId],
        );
        await transaction.query(
          `INSERT INTO project_environments
             (organization_id, project_id, environment, database_instance_ref)
           VALUES ($1, $2, $3, $4)`,
          [organization.id, project.id, project.environment ?? "development", `pending:${project.id}`],
        );
      }
      return { organization: { ...organization }, userId, role: "owner" };
    });
  }

  async addMembership(input: {
    organizationId: string;
    userId: string;
    role: OrganizationRole;
    actorRef: string;
  }): Promise<void> {
    if (!ORGANIZATION_ROLES.has(input.role)) throw new InvalidRecordError("Invalid organization role.");
    await withTenantTransaction(
      this.pool,
      { organizationId: input.organizationId, actorRef: input.actorRef },
      async (transaction) => {
        await transaction.query(
          `INSERT INTO organization_members (organization_id, user_id, role)
           VALUES ($1, $2, $3)`,
          [input.organizationId, input.userId, input.role] as readonly SqlValue[],
        );
      },
    );
  }
}
