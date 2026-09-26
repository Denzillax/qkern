import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import type { SqlPool } from "@/lib/server/db/sql";
import { AuditRepository } from "@/lib/server/db/repositories";
import { withTenantTransaction } from "@/lib/server/db/transaction";
import { ProjectDataPlaneService } from "@/lib/server/data-plane/service";
import { evaluateSecurityRules } from "@/lib/server/advisors/security-rules";

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const projectApiUrl = process.env.QKERN_TEST_PROJECT_API_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const authUrl = process.env.QKERN_TEST_AUTH_DATABASE_URL;
const enabled = Boolean(ownerUrl && runtimeUrl && authUrl);

describe.runIf(enabled)("PostgreSQL 17 role and RLS integration", () => {
  let owner: SqlPool;
  let runtime: SqlPool;
  let auth: SqlPool;
  const userId = randomUUID();
  const secondUserId = randomUUID();
  const organizationA = randomUUID();
  const organizationB = randomUUID();

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    runtime = verifyDatabaseBoundary(createPostgresPool({ connectionString: runtimeUrl!, max: 2 }), "runtime");
    auth = verifyDatabaseBoundary(createPostgresPool({ connectionString: authUrl!, max: 2 }), "auth");
    await owner.query(
      `INSERT INTO users (id, email, password_hash, status) VALUES
         ($1, $2, '$argon2id$integration-only', 'active'),
         ($3, $4, '$argon2id$integration-only', 'active')`,
      [userId, `integration-${userId}@qkern.test`, secondUserId, `integration-${secondUserId}@qkern.test`],
    );
    await owner.query(
      `INSERT INTO organizations (id, name, slug, created_by) VALUES
         ($1, 'Integration A', $2, $3), ($4, 'Integration B', $5, $6)`,
      [organizationA, `integration-a-${organizationA}`, userId, organizationB, `integration-b-${organizationB}`, secondUserId],
    );
    await owner.query(
      `INSERT INTO organization_members (organization_id, user_id, role, is_personal_workspace)
       VALUES ($1, $2, 'owner', true), ($3, $4, 'owner', true)`,
      [organizationA, userId, organizationB, secondUserId],
    );
    await owner.query(
      `INSERT INTO projects (organization_id, name, slug, region, status, created_by)
       VALUES ($1, 'A', 'a', 'test', 'ready', $2), ($3, 'B', 'b', 'test', 'ready', $4)`,
      [organizationA, userId, organizationB, secondUserId],
    );
  });

  afterAll(async () => {
    // organizations.created_by references users and is intentionally not
    // cascading: a user who owns organizations must not disappear silently.
    // Everything below an organization cascades, so the organization goes first.
    if (owner) {
      await owner.query("DELETE FROM organizations WHERE id IN ($1, $2)", [organizationA, organizationB]);
      await owner.query("DELETE FROM users WHERE id IN ($1, $2)", [userId, secondUserId]);
    }
    await Promise.all([owner?.end(), runtime?.end(), auth?.end()]);
  });

  /**
   * Die Verbindungsgrenze des Stacks (1.90): Die Suite deklariert 76 Pools
   * mit 233 Verbindungen, und vitest faehrt Dateien parallel. Mit der
   * Voreinstellung 100 riss in 1.89 ein Lauf mit "remaining connection slots
   * are reserved". Der Wert steht im Compose; hier wird geprueft, dass er
   * auch wirkt — die Mutationsprobe nimmt den Parameter aus dem Compose, und
   * genau dieser Fall faellt.
   */
  it("runs the certification cluster with room for every declared pool", async () => {
    const result = await owner.query<{ max_connections: string }>("SHOW max_connections");
    expect(Number(result.rows[0]?.max_connections)).toBeGreaterThanOrEqual(300);
  });

  it("keeps global auth and tenant runtime privileges separated", async () => {
    await expect(runtime.query("SELECT id FROM users LIMIT 1")).rejects.toBeTruthy();
    await expect(auth.query("SELECT id FROM projects LIMIT 1")).rejects.toBeTruthy();
  });

  it("enforces tenant isolation through a non-superuser runtime connection", async () => {
    const rows = await withTenantTransaction(runtime, { organizationId: organizationA, readOnly: true }, async (transaction) =>
      transaction.query<{ organization_id: string }>("SELECT organization_id FROM projects ORDER BY organization_id"));
    expect(rows.rows).toEqual([{ organization_id: organizationA }]);
  });

  it("discovers memberships only through the auth boundary", async () => {
    const result = await auth.query<{ organization_id: string }>("SELECT organization_id FROM qkern_memberships_for_user($1)", [userId]);
    expect(result.rows).toEqual([{ organization_id: organizationA }]);
  });

  it("keeps audit chain order equal to (created_at, id) order under concurrent writers (2.36)", async () => {
    // Eigene Organisation mit eigenem Besitzer, wie Fall 2.35: audit_logs ist
    // append-only, und eine Organisation mit Audit-Zeilen laesst sich wegen
    // audit_logs_organization_id_fkey (ON DELETE RESTRICT) nicht loeschen.
    // afterAll loescht organizationA und organizationB; die bleiben darum
    // ohne Audit-Zeilen. Diese Organisation, ihr Besitzer und die zwei Zeilen
    // bleiben als erwarteter Rest im Wegwerf-Stack.
    const chainOwner = randomUUID();
    const chainOrganization = randomUUID();
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`, [chainOwner, `audit-chain-owner-${chainOwner}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Audit Chain Order', $2, $3)`, [chainOrganization, `audit-chain-order-${chainOrganization}`, chainOwner]);
    const entry = (action: string) => ({ actorType: "system", actorRef: "integration", action, resourceRef: "audit-chain-order", status: "success" });

    // Das Rennen deterministisch: A beginnt zuerst (now() von A steht damit
    // fest), B schreibt und committet, erst dann schreibt A. A bekommt den
    // Lock der Kette als zweite und haengt an B an.
    const { first, second, startedA } = await withTenantTransaction(runtime, { organizationId: chainOrganization }, async (a) => {
      const started = await a.query<{ started: string }>("SELECT now()::text AS started");
      await new Promise((resolve) => setTimeout(resolve, 5));
      const b = await withTenantTransaction(runtime, { organizationId: chainOrganization }, (transaction) =>
        new AuditRepository(transaction).append(entry("integration.chain_order.b")));
      const late = await new AuditRepository(a).append(entry("integration.chain_order.a"));
      return { first: b, second: late, startedA: started.rows[0].started };
    });

    const rows = await owner.query<{ action: string; previous_hash: string | null; entry_hash: string }>(
      `SELECT action, previous_hash, entry_hash FROM audit_logs
       WHERE organization_id = $1 ORDER BY created_at, id`, [chainOrganization]);
    expect(rows.rows.map((row) => row.action)).toEqual(["integration.chain_order.b", "integration.chain_order.a"]);
    const [rowB, rowA] = rows.rows;
    expect(rowB.entry_hash).toBe(first.entryHash);
    expect(rowA.entry_hash).toBe(second.entryHash);
    // A traegt nicht mehr die Startzeit seiner Transaktion, sondern liegt nach B.
    const order = await owner.query<{ after_start: boolean; after_b: boolean }>(
      `SELECT a.created_at > $3::timestamptz AS after_start, a.created_at > b.created_at AS after_b
       FROM audit_logs AS a, audit_logs AS b
       WHERE a.organization_id = $4 AND b.organization_id = $4 AND a.entry_hash = $1 AND b.entry_hash = $2`,
      [rowA.entry_hash, rowB.entry_hash, startedA, chainOrganization]);
    expect(order.rows[0]).toEqual({ after_start: true, after_b: true });
    expect(rowB.previous_hash).toBeNull();
    expect(rowA.previous_hash).toBe(rowB.entry_hash);

    // Die Kette neu rechnen wie auditChainIntact im Backup-Drill.
    const chain = await owner.query<{ ok: boolean; linked: boolean }>(`
      WITH ordered AS (
        SELECT *, lag(entry_hash) OVER (PARTITION BY organization_id ORDER BY created_at, id) AS expected_previous
        FROM audit_logs WHERE organization_id = $1
      )
      SELECT bool_and(entry_hash = encode(digest(jsonb_build_object(
               'id', id, 'organization_id', organization_id, 'project_id', project_id, 'environment', environment,
               'actor_type', actor_type, 'actor_ref', actor_ref, 'action', action, 'resource_ref', resource_ref,
               'status', status, 'redacted_metadata', redacted_metadata, 'previous_hash', previous_hash, 'created_at', created_at
             )::text, 'sha256'), 'hex')) AS ok,
             bool_and(previous_hash IS NOT DISTINCT FROM expected_previous) AS linked
      FROM ordered`, [chainOrganization]);
    expect(chain.rows[0]).toEqual({ ok: true, linked: true });
  });

  it("finds exactly the open table and the USING (true) policy through the real catalog (2.39)", async () => {
    // Der Sicherheitsberater ueber echter Katalogausgabe: drei Tabellen in
    // einem eigenen Schema der Projektdatenbank, gelesen ueber die Leserolle
    // der Data API, dann durch das reine Regelmodul. Die saubere Tabelle darf
    // keinen Befund tragen. Das Schema faellt am Ende samt Inhalt weg.
    expect(projectApiUrl, "QKERN_TEST_PROJECT_API_DATABASE_URL fehlt").toBeTruthy();
    const schema = `advisor_${randomUUID().replaceAll("-", "_")}`;
    const projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
    try {
      await owner.query(`CREATE SCHEMA "${schema}"`);
      await owner.query(`CREATE TABLE "${schema}".open_notes (id integer PRIMARY KEY, body text)`);
      await owner.query(`CREATE TABLE "${schema}".public_posts (id integer PRIMARY KEY, body text)`);
      await owner.query(`ALTER TABLE "${schema}".public_posts ENABLE ROW LEVEL SECURITY`);
      await owner.query(`CREATE POLICY read_all ON "${schema}".public_posts FOR SELECT USING (true)`);
      await owner.query(`CREATE TABLE "${schema}".own_rows (id integer PRIMARY KEY, owner text NOT NULL)`);
      await owner.query(`ALTER TABLE "${schema}".own_rows ENABLE ROW LEVEL SECURITY`);
      await owner.query(`CREATE POLICY own_select ON "${schema}".own_rows FOR SELECT TO qkern_project_api_app USING (owner = current_user)`);
      await owner.query(`CREATE POLICY own_insert ON "${schema}".own_rows FOR INSERT TO qkern_project_api_app WITH CHECK (owner = current_user)`);
      await owner.query(`GRANT USAGE ON SCHEMA "${schema}" TO qkern_project_api_app`);

      const service = new ProjectDataPlaneService(
        { resolveTarget: async () => ({ databaseInstanceRef: "managed:certification" }) },
        { resolve: async () => ({
          pool: projectApi,
          expectedRole: "qkern_project_api_app",
          expectedDatabase: new URL(projectApiUrl!).pathname.slice(1),
          expectedLedgerOwner: "qkern",
        }) },
      );
      const context = { organizationId: organizationA, actorRef: "advisor@qkern.test" };
      const scope = { projectId: "certification-project", environment: "development" as const };
      const [tables, policies] = await Promise.all([
        service.inspectSchema(context, scope, schema),
        service.inspectPolicies(context, scope, schema),
      ]);
      const result = evaluateSecurityRules({
        environment: "development",
        now: new Date(),
        database: { schema, tables: tables.tables, tablesTruncated: tables.truncated, policies: policies.policies, policiesTruncated: policies.truncated },
        storage: { buckets: [] },
        apiKeys: { keys: [] },
      });
      expect(result.findings.map((finding) => finding.id)).toEqual([
        "rls_disabled:table:open_notes",
        "policy_always_true:policy:public_posts.read_all",
      ]);
      expect(result.findings.some((finding) => finding.object.name.startsWith("own_rows"))).toBe(false);
      expect(result.checks.filter((check) => ["rls_disabled", "rls_no_policies", "policy_always_true", "policy_check_missing"].includes(check.rule)))
        .toEqual([
          { rule: "rls_disabled", ran: true }, { rule: "rls_no_policies", ran: true },
          { rule: "policy_always_true", ran: true }, { rule: "policy_check_missing", ran: true },
        ]);
    } finally {
      await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await projectApi.end();
    }
  });
});
