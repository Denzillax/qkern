import { describe, expect, it } from "vitest";
import { PostgresTenancyRepository } from "@/lib/server/tenancy-postgres";
import type { SqlPool, SqlPoolClient, SqlQueryResult, SqlValue } from "@/lib/server/db/sql";

const ORGANIZATION_ID = "0d9423d9-7437-4f66-898a-86275e6598fb";
const USER_ID = "b05b5e3f-8baf-4a6b-965d-d0087a6c7bca";
const PROJECT_ID = "9730b448-7fd0-4c4f-9553-33220752bdf6";

class RecordingPool implements SqlPool, SqlPoolClient {
  readonly calls: Array<{ text: string; values?: readonly SqlValue[] }> = [];
  released = false;

  constructor(private readonly membershipRows: Record<string, unknown>[] = []) {}

  async query<Row extends Record<string, unknown>>(
    text: string,
    values?: readonly SqlValue[],
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    const rows = text.includes("qkern_memberships_for_user") || text.includes("FROM organization_members")
      ? this.membershipRows
      : [];
    return { rows: rows as Row[], rowCount: rows.length };
  }

  async connect(): Promise<SqlPoolClient> {
    return this;
  }

  release(): void {
    this.released = true;
  }

  async end(): Promise<void> {}
}

const membershipRow = {
  organization_id: ORGANIZATION_ID,
  organization_name: "Owner Workspace",
  organization_slug: "owner-workspace",
  membership_user_id: USER_ID,
  membership_role: "owner",
};

describe("PostgreSQL tenancy repository", () => {
  it("discovers memberships only through the user-filtered database function", async () => {
    const pool = new RecordingPool([membershipRow]);
    const memberships = await new PostgresTenancyRepository(pool).listMemberships(USER_ID);

    expect(memberships).toHaveLength(1);
    expect(memberships[0].organization.id).toBe(ORGANIZATION_ID);
    expect(pool.calls[0].text).toContain("qkern_memberships_for_user($1)");
    expect(pool.calls[0].values).toEqual([USER_ID]);
  });

  it("creates organization, owner membership and first project atomically under tenant RLS", async () => {
    const pool = new RecordingPool();
    const membership = await new PostgresTenancyRepository(pool).createWorkspace({
      organization: { id: ORGANIZATION_ID, name: "Owner Workspace", slug: "owner-workspace" },
      userId: USER_ID,
      project: { id: PROJECT_ID, name: "First Project", slug: "first-project", region: "ch-zrh-1" },
    });

    expect(membership.role).toBe("owner");
    expect(pool.calls.map((call) => call.text.trim().split(/\s+/).slice(0, 3).join(" "))).toEqual([
      "BEGIN",
      "SELECT set_config('qkern.organization_id', $1,",
      "INSERT INTO organizations",
      "INSERT INTO organization_members",
      "INSERT INTO projects",
      "INSERT INTO project_environments",
      "COMMIT",
    ]);
    expect(pool.calls[1].values?.[0]).toBe(ORGANIZATION_ID);
    expect(pool.calls[3].values).toEqual([ORGANIZATION_ID, USER_ID]);
    expect(pool.released).toBe(true);
  });

  it("uses the tenant transaction for membership authorization checks", async () => {
    const pool = new RecordingPool([membershipRow]);
    const membership = await new PostgresTenancyRepository(pool).getMembership(USER_ID, ORGANIZATION_ID);

    expect(membership?.userId).toBe(USER_ID);
    const membershipQuery = pool.calls.find((call) => call.text.includes("FROM organization_members"));
    expect(membershipQuery?.text).toContain("member.organization_id = $1");
    expect(membershipQuery?.text).toContain("member.user_id = $2");
    expect(membershipQuery?.values).toEqual([ORGANIZATION_ID, USER_ID]);
  });
});
