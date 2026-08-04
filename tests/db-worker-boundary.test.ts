import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "db/migrations/0006_worker_runtime_boundary.sql");
const loginPath = path.resolve(process.cwd(), "db/docker/999-runtime-login.sh");
const composePath = path.resolve(process.cwd(), "docker-compose.yml");

describe("dedicated worker database boundary", () => {
  it("removes queue state transitions from the web runtime", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE ROLE qkern_worker NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT");
    expect(sql).toContain("REVOKE UPDATE ON migration_jobs, migration_outbox FROM qkern_runtime");
    expect(sql).toContain(") ON migration_jobs FROM qkern_runtime");
    expect(sql).toContain(") ON migration_outbox FROM qkern_runtime");
  });

  it("grants the worker only referenced artifacts, fenced state updates and redacted audit append", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("GRANT SELECT ON migration_jobs, migration_outbox, change_sets, approval_requests TO qkern_worker");
    expect(sql).toContain("GRANT UPDATE (\n  status, attempt_count, available_at, lease_owner, lease_token, lease_expires_at,");
    expect(sql).toContain("GRANT UPDATE (status, updated_at) ON change_sets TO qkern_worker");
    expect(sql).toContain("GRANT SELECT, INSERT ON audit_logs TO qkern_worker");
    expect(sql).not.toContain("GRANT ALL");
    expect(sql).not.toContain("GRANT SELECT ON users");
  });

  it("binds every migration job to the exact tenant-scoped approval snapshot", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("ADD COLUMN approval_request_id uuid");
    expect(sql).toContain("ALTER COLUMN approval_request_id SET NOT NULL");
    expect(sql).toContain("FOREIGN KEY (organization_id, project_id, environment, change_set_id, approval_request_id)");
    expect(sql).toContain("REFERENCES approval_requests (organization_id, project_id, environment, change_set_id, id)");
    expect(sql).toContain("GRANT INSERT (approval_request_id) ON migration_jobs TO qkern_runtime");
  });

  it("creates distinct worker and provisioner logins and checks every boundary", async () => {
    const [login, compose] = await Promise.all([readFile(loginPath, "utf8"), readFile(composePath, "utf8")]);
    expect(login).toContain("CREATE ROLE qkern_worker_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT");
    expect(login).toContain("GRANT qkern_worker TO qkern_worker_app");
    expect(login).toContain("REVOKE qkern_runtime, qkern_auth, qkern_provisioner FROM qkern_worker_app");
    expect(compose).toContain("postgres-worker-check:");
    expect(compose).toContain("postgresql://qkern_worker_app@postgres:5432/qkern_control");
    expect(login).toContain("CREATE ROLE qkern_provisioner_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT");
    expect(login).toContain("GRANT qkern_provisioner TO qkern_provisioner_app");
    expect(compose).toContain("postgres-provisioner-check:");
  });
});
