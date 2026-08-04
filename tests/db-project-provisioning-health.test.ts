import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = path.resolve(
  process.cwd(),
  "db/migrations/0021_project_database_provisioning_health.sql",
);

describe("project database provisioning health migration", () => {
  it("binds each heartbeat to the transaction tenant and provisioner identity", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("ALTER TABLE project_database_provisioner_heartbeats FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("organization_id = qkern_current_organization_id()");
    expect(sql).toContain("provisioner_id = nullif(current_setting('qkern.actor_ref', true), '')");
    expect(sql).toContain("GRANT INSERT (organization_id, provisioner_id, started_at, last_seen_at)");
    expect(sql).toContain("GRANT UPDATE (last_seen_at)");
    expect(sql).not.toMatch(
      /GRANT\s+SELECT[\s\S]{0,120}project_database_provisioner_heartbeats[\s\S]{0,80}qkern_provisioner/i,
    );
  });

  it("exposes only tenant-bound aggregates with fixed queue and heartbeat SLOs", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("CREATE FUNCTION qkern_project_database_provisioning_health()");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = pg_catalog, public");
    expect(sql).toContain("interval '5 minutes'");
    expect(sql).toContain("interval '2 minutes'");
    expect(sql).toContain("interval '24 hours'");
    expect(sql).toContain("job.organization_id = public.qkern_current_organization_id()");
    expect(sql).toContain("heartbeat.organization_id = public.qkern_current_organization_id()");
  });

  it("keeps operational identities, leases, targets and secrets out of the runtime projection", async () => {
    const sql = await readFile(migration, "utf8");
    const returns = sql.slice(sql.indexOf("RETURNS TABLE"), sql.indexOf(")\nLANGUAGE sql"));
    expect(returns).not.toMatch(
      /organization_id|project_id|environment|job_id|provisioner_id|lease_owner|lease_token|host|port|vault|credential|endpoint/i,
    );
    expect(sql).toContain("REVOKE ALL ON project_database_provisioner_heartbeats");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION qkern_project_database_provisioning_health()");
    expect(sql).toContain("TO qkern_runtime");
    expect(sql).not.toMatch(
      /GRANT\s+SELECT[\s\S]{0,120}project_database_provisioner_heartbeats[\s\S]{0,80}qkern_runtime/i,
    );
  });
});
