import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import type { SqlPool } from "@/lib/server/db/sql";
import { AuditRepository, PostgresControlPlane } from "@/lib/server/db/repositories";
import { CronDispatcher } from "@/lib/server/compute/cron";
import { ComputeDefinitionService } from "@/lib/server/compute/definitions";
import { PostgresComputeDefinitionRepository } from "@/lib/server/compute/definitions-postgres-repository";
import { PostgresProjectQueueRepository } from "@/lib/server/project-queues/postgres-repository";
import { ProjectQueueService } from "@/lib/server/project-queues/service";
import { withTenantTransaction } from "@/lib/server/db/transaction";
import { ProjectDataPlaneService } from "@/lib/server/data-plane/service";
import { evaluateSecurityRules } from "@/lib/server/advisors/security-rules";
import { evaluatePerformanceRules } from "@/lib/server/advisors/performance-rules";
import { PERFORMANCE_THRESHOLDS } from "@/lib/console/performance-advisor-texts";

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

  it("finds the suspected missing index, the unused index, the bloat and the missing sample in real statistics (2.40)", async () => {
    // Der Leistungsberater ueber echten Zaehlern: ein eigenes Schema, damit die
    // Zaehler dieses Falls nur von ihm kommen und kein Reset fremde Statistik
    // trifft. Autovacuum ist je Tabelle abgeschaltet, sonst raeumt der Daemon
    // waehrend des Laufs auf und macht aus einem Befund Zufall.
    expect(projectApiUrl, "QKERN_TEST_PROJECT_API_DATABASE_URL fehlt").toBeTruthy();
    const schema = `perf_${randomUUID().replaceAll("-", "_")}`;
    const projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
    try {
      await owner.query(`CREATE SCHEMA "${schema}"`);
      const options = "WITH (autovacuum_enabled = false)";
      await owner.query(`CREATE TABLE "${schema}".busy (id integer PRIMARY KEY, tag text NOT NULL) ${options}`);
      await owner.query(`CREATE TABLE "${schema}".churn (id integer PRIMARY KEY, tag text NOT NULL) ${options}`);
      await owner.query(`CREATE TABLE "${schema}".untouched (id integer PRIMARY KEY, tag text NOT NULL) ${options}`);
      await owner.query(`CREATE TABLE "${schema}".calm (id integer PRIMARY KEY, tag text NOT NULL) ${options}`);
      // `served` sieht aus wie `busy`, hat aber einen Index, den der Planer
      // nutzt. Die Regel darf sie nicht melden; genau daran haengt die zweite
      // Haelfte der Bedingung. Ohne diese Tabelle faellt eine Mutation, die
      // die Indexscans ignoriert, im Stack nicht auf.
      await owner.query(`CREATE TABLE "${schema}".served (id integer PRIMARY KEY, tag text NOT NULL) ${options}`);
      await owner.query(`INSERT INTO "${schema}".busy SELECT g, 'tag-' || (g % 7) FROM generate_series(1, 60000) AS g`);
      await owner.query(`INSERT INTO "${schema}".churn SELECT g, 'tag' FROM generate_series(1, 3000) AS g`);
      await owner.query(`INSERT INTO "${schema}".untouched SELECT g, 'tag' FROM generate_series(1, 2000) AS g`);
      await owner.query(`INSERT INTO "${schema}".calm SELECT g, 'tag' FROM generate_series(1, 1500) AS g`);
      await owner.query(`INSERT INTO "${schema}".served SELECT g, 'tag-' || (g % 7) FROM generate_series(1, 60000) AS g`);
      await owner.query(`CREATE INDEX served_tag_idx ON "${schema}".served (tag)`);
      // ANALYZE auf drei Tabellen, absichtlich nicht auf `untouched`.
      await owner.query(`ANALYZE "${schema}".busy, "${schema}".churn, "${schema}".calm, "${schema}".served`);
      // Sequenzielle Scans erzwingen: `tag` hat noch keinen Index.
      for (let round = 0; round < PERFORMANCE_THRESHOLDS.missingIndexMinSeqScans; round += 1) {
        await owner.query(`SELECT count(*) FROM "${schema}".busy WHERE tag = 'tag-3'`);
      }
      // `served` bekommt gleich viele sequenzielle Scans wie `busy`, dazu aber
      // mehr Indexscans als ein Zehntel davon. Der erzwungene Plan macht die
      // Zahl unabhaengig von der Schaetzung des Planers.
      for (let round = 0; round < PERFORMANCE_THRESHOLDS.missingIndexMinSeqScans; round += 1) {
        await owner.query(`SELECT count(*) FROM "${schema}".served`);
      }
      await owner.query("SET enable_seqscan = off");
      for (let round = 0; round < PERFORMANCE_THRESHOLDS.missingIndexMinSeqScans; round += 1) {
        await owner.query(`SELECT count(*) FROM "${schema}".served WHERE tag = 'tag-3'`);
      }
      await owner.query("RESET enable_seqscan");
      // Der Index entsteht erst jetzt und wird von niemandem benutzt.
      await owner.query(`CREATE INDEX busy_tag_idx ON "${schema}".busy (tag, id)`);
      // Tote Zeilen, die niemand aufraeumt.
      await owner.query(`UPDATE "${schema}".churn SET tag = tag || 'x'`);
      await owner.query(`GRANT USAGE ON SCHEMA "${schema}" TO qkern_project_api_app`);
      await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO qkern_project_api_app`);

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

      // Der Statistiksammler schreibt verzoegert. Gewartet wird auf die
      // Bedingung, nicht auf eine Dauer, mit Budget und mit dem letzten
      // gesehenen Zustand in der Meldung. Die Zusicherung bleibt dieselbe.
      const settled = (result: Awaited<ReturnType<typeof service.inspectStatistics>>) => {
        const busy = result.tables.find((table) => table.table === "busy");
        const churn = result.tables.find((table) => table.table === "churn");
        const untouched = result.tables.find((table) => table.table === "untouched");
        const served = result.tables.find((table) => table.table === "served");
        return Boolean(busy && churn && untouched && served &&
          busy.seqScan >= PERFORMANCE_THRESHOLDS.missingIndexMinSeqScans &&
          busy.liveTuples >= PERFORMANCE_THRESHOLDS.missingIndexMinLiveTuples &&
          churn.deadTuples >= 3000 && untouched.liveTuples >= 2000 &&
          served.seqScan >= PERFORMANCE_THRESHOLDS.missingIndexMinSeqScans &&
          served.idxScan * PERFORMANCE_THRESHOLDS.missingIndexSeqToIdxFactor > served.seqScan);
      };
      const deadline = Date.now() + 20_000;
      let statistics = await service.inspectStatistics(context, scope, schema);
      let attempts = 1;
      while (!settled(statistics) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        statistics = await service.inspectStatistics(context, scope, schema);
        attempts += 1;
      }
      expect(settled(statistics),
        `Zaehler nach ${attempts} Abfragen in 20 s nicht vollstaendig: ${JSON.stringify(statistics.tables)}`).toBe(true);
      expect(statistics.source).toBe("postgres");
      expect(statistics.truncated).toBe(false);
      const unusedIndex = statistics.indexes.find((index) => index.name === "busy_tag_idx");
      expect(unusedIndex?.sizeBytes ?? 0,
        `busy_tag_idx bleibt unter der Schwelle: ${JSON.stringify(unusedIndex)}`).toBeGreaterThanOrEqual(PERFORMANCE_THRESHOLDS.unusedIndexMinBytes);
      expect(unusedIndex).toMatchObject({ table: "busy", scans: 0, isUnique: false, isPrimary: false });

      const result = evaluatePerformanceRules({
        statistics: {
          schema,
          tables: statistics.tables.map((table) => ({
            name: table.table, seqScan: table.seqScan, seqTupRead: table.seqTupRead, idxScan: table.idxScan,
            liveTuples: table.liveTuples, deadTuples: table.deadTuples,
            lastAutovacuum: table.lastAutovacuum, lastAnalyze: table.lastAnalyze,
          })),
          indexes: statistics.indexes,
          truncated: statistics.truncated,
        },
        statements: { unavailable: "statementsNotRead" },
      });
      expect(result.findings.map((finding) => finding.id)).toEqual([
        "missing_index_suspected:table:busy",
        "unused_index:index:busy_tag_idx",
        "bloat_suspected:table:churn",
        "never_analyzed:table:untouched",
      ]);
      // Die gesunde Tabelle traegt keinen Befund, auch nicht ueber ihren Primaerschluessel.
      expect(result.findings.some((finding) => finding.object.name.startsWith("calm"))).toBe(false);
      // Und `served` auch nicht: viele sequenzielle Scans, aber genug Indexscans.
      const served = statistics.tables.find((table) => table.table === "served");
      expect(
        served,
        `served fehlt in der Statistik: ${statistics.tables.map((table) => table.table).join(", ")}`,
      ).toBeDefined();
      expect(
        served!.idxScan * PERFORMANCE_THRESHOLDS.missingIndexSeqToIdxFactor > served!.seqScan,
        `served: ${served!.seqScan} sequenzielle, ${served!.idxScan} Indexscans`,
      ).toBe(true);
      expect(result.findings.some((finding) => finding.object.name.startsWith("served"))).toBe(false);
      expect(result.checks.filter((check) => check.ran).map((check) => check.rule).sort()).toEqual([
        "bloat_suspected", "missing_index_suspected", "never_analyzed", "unused_index",
      ]);
      expect(result.checks.find((check) => check.rule === "slow_statement")?.ran).toBe(false);
    } finally {
      await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await projectApi.end();
    }
    // Ausdrueckliches Budget: Der Fall baut 60'000 Zeilen, erzwingt 50
    // sequenzielle Scans und wartet danach auf den Statistik-Kollektor, der
    // asynchron schreibt. Die 5 Sekunden der Datei reichen dafuer nicht; die
    // Zusicherungen bleiben unveraendert scharf.
  }, 120_000);

  it("reads composite, self-referencing and cross-schema foreign keys through the project read role (2.41)", async () => {
    // Der Schema-Visualizer ueber echten Katalogzeilen: zwei eigene Schemas,
    // damit ein Schluessel wirklich ueber die Schemagrenze zeigt. Gelesen wird
    // durch `qkern_project_api_app`, also durch dieselbe Leserolle wie in der
    // Console, nicht als Eigentuemer.
    expect(projectApiUrl, "QKERN_TEST_PROJECT_API_DATABASE_URL fehlt").toBeTruthy();
    const nonce = randomUUID().replaceAll("-", "_");
    const schema = `fk_${nonce}`;
    const other = `fkother_${nonce}`;
    const projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
    try {
      await owner.query(`CREATE SCHEMA "${other}"`);
      await owner.query(`CREATE TABLE "${other}".region (code text PRIMARY KEY)`);
      await owner.query(`CREATE SCHEMA "${schema}"`);
      // Der Elternschluessel ist zusammengesetzt, und `child` verweist mit
      // vertauschten Spaltennamen darauf: `branch` gehoert zu `tenant_id`,
      // `owner_id` zu `id`. Nur die Reihenfolge aus `conkey` und `confkey`
      // bringt das richtig heraus; eine alphabetische Sortierung waere falsch.
      await owner.query(`CREATE TABLE "${schema}".parent (tenant_id integer NOT NULL, id integer NOT NULL, PRIMARY KEY (tenant_id, id))`);
      await owner.query(`CREATE TABLE "${schema}".child (
        id integer PRIMARY KEY,
        branch integer NOT NULL,
        owner_id integer NOT NULL,
        parent_child integer,
        region_code text,
        CONSTRAINT child_parent_fkey FOREIGN KEY (branch, owner_id) REFERENCES "${schema}".parent (tenant_id, id) ON DELETE CASCADE ON UPDATE RESTRICT,
        CONSTRAINT child_self_fkey FOREIGN KEY (parent_child) REFERENCES "${schema}".child (id) ON DELETE SET NULL,
        CONSTRAINT child_region_fkey FOREIGN KEY (region_code) REFERENCES "${other}".region (code) ON UPDATE CASCADE
      )`);
      for (const name of [schema, other]) {
        await owner.query(`GRANT USAGE ON SCHEMA "${name}" TO qkern_project_api_app`);
        await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${name}" TO qkern_project_api_app`);
      }

      const service = new ProjectDataPlaneService(
        { resolveTarget: async () => ({ databaseInstanceRef: "managed:certification" }) },
        { resolve: async () => ({
          pool: projectApi,
          expectedRole: "qkern_project_api_app",
          expectedDatabase: new URL(projectApiUrl!).pathname.slice(1),
          expectedLedgerOwner: "qkern",
        }) },
      );
      const result = await service.inspectForeignKeys(
        { organizationId: organizationA, actorRef: "visualizer@qkern.test" },
        { projectId: "certification-project", environment: "development" },
        schema,
      );
      expect(result.source).toBe("postgres");
      expect(result.schema).toBe(schema);
      expect(result.truncated).toBe(false);
      // Sortiert nach Tabelle und Constraint-Name; `parent` traegt keinen Schluessel.
      expect(result.foreignKeys.map((key) => key.name)).toEqual([
        "child_parent_fkey", "child_region_fkey", "child_self_fkey",
      ]);
      expect(result.foreignKeys.find((key) => key.name === "child_parent_fkey")).toEqual({
        name: "child_parent_fkey", table: "child", columns: ["branch", "owner_id"],
        referencedSchema: schema, referencedTable: "parent", referencedColumns: ["tenant_id", "id"],
        onDelete: "cascade", onUpdate: "restrict",
      });
      expect(result.foreignKeys.find((key) => key.name === "child_self_fkey")).toEqual({
        name: "child_self_fkey", table: "child", columns: ["parent_child"],
        referencedSchema: schema, referencedTable: "child", referencedColumns: ["id"],
        onDelete: "set_null", onUpdate: "no_action",
      });
      // Der Schluessel ueber die Schemagrenze bleibt drin und nennt das fremde Schema.
      expect(result.foreignKeys.find((key) => key.name === "child_region_fkey")).toEqual({
        name: "child_region_fkey", table: "child", columns: ["region_code"],
        referencedSchema: other, referencedTable: "region", referencedColumns: ["code"],
        onDelete: "no_action", onUpdate: "cascade",
      });
      // Das zweite Schema kennt den Schluessel nicht: gefiltert wird nach der verweisenden Tabelle.
      const fromOther = await service.inspectForeignKeys(
        { organizationId: organizationA, actorRef: "visualizer@qkern.test" },
        { projectId: "certification-project", environment: "development" },
        other,
      );
      expect(fromOther.foreignKeys).toEqual([]);
    } finally {
      await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await owner.query(`DROP SCHEMA IF EXISTS "${other}" CASCADE`);
      await projectApi.end();
    }
    // Ohne eigenes Budget: der Fall legt zwei Schemas mit vier kleinen Tabellen
    // an und liest zweimal aus dem Katalog. Kein Statistik-Kollektor, auf den
    // gewartet werden muesste, also reichen die 5 Sekunden der Datei.
  });
  it("(2.42) reconstructs the cron log from the real dedupe verifier of an enqueued occurrence", async () => {
    // Das Cron-Log behauptet, ein Vorkommen in der Queue wiederzufinden, ohne
    // dass irgendwo ein Lauf protokolliert wird. Diese Behauptung steht und
    // faellt mit einer Sache: dass der Verifikator, den der Dispatcher beim
    // Einreihen schreibt, derselbe ist, den der Leser bildet. Deshalb wird hier
    // **nicht** von Hand eingefuegt, sondern ueber CronDispatcher und
    // ProjectQueueService eingereiht, genau wie im Betrieb.
    const projectId = randomUUID();
    const scope = { organizationId: organizationA, projectId, environment: "development" as const };
    const admin = {
      organizationId: organizationA, actorRef: "cron-log@qkern.test",
      role: "admin" as const, subject: userId,
    };
    const dispatcher = {
      organizationId: organizationA, actorRef: "service-role:cron",
      role: "service_role" as const, subject: "cron",
    };
    const plane = new PostgresControlPlane(runtime);
    const queues = new ProjectQueueService({ repository: new PostgresProjectQueueRepository(plane) });
    const queue = `cron-log-${randomUUID().slice(0, 8)}`;
    try {
      await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
        VALUES ($1, $2, 'Cron Log', $3, 'test', 'ready', $4)`,
      [projectId, organizationA, `cron-log-${projectId}`, userId]);
      await owner.query(`INSERT INTO project_environments
        (organization_id, project_id, environment, database_instance_ref)
        VALUES ($1, $2, 'development', $3)`, [organizationA, projectId, `managed:${projectId}`]);
      // Ein Tag Dedupe-Fenster: Im Pruefzeitraum verfaellt kein Verifikator,
      // sonst waere ein "nicht nachweisbar" das richtige Urteil und der Fall
      // wuerde die falsche Frage stellen.
      await queues.createQueue(admin, scope, { name: queue, dedupeWindowSeconds: 86_400 });

      const definitions = new ComputeDefinitionService({
        repository: new PostgresComputeDefinitionRepository(plane),
      });
      const definition = await definitions.createCron(admin, scope, {
        name: `cron-log-${randomUUID().slice(0, 8)}`, expression: "*/5 * * * *", queue,
        payload: { task: "run", customer: "darf-nicht-im-log-stehen" },
      });

      // Zwei Vorkommen **nach** dem Anlegen: das erste wird eingereiht, das
      // zweite bleibt leer. Vor dem Anlegen holt der Scheduler nichts nach,
      // deshalb waeren vergangene Vorkommen keine Luecke.
      const created = new Date(definition.createdAt).getTime();
      const first = new Date(Math.floor(created / 300_000) * 300_000 + 300_000);
      const second = new Date(first.getTime() + 300_000);
      const receipt = await new CronDispatcher(queues).dispatch(definition, first, dispatcher);
      expect(receipt.status).toBe("dispatched");

      // Gelesen wird mit einer Uhr hinter dem zweiten Vorkommen: Beide sind
      // dann faellig, und die Karenz von fuenf Minuten deckt keines mehr.
      const reader = new ComputeDefinitionService({
        repository: new PostgresComputeDefinitionRepository(plane),
        now: () => new Date(second.getTime() + 6 * 60_000),
      });
      const log = await reader.listCronOccurrences(admin, scope, definition.id);

      expect(log.window.queueFound).toBe(true);
      expect(log.expression).toBe("*/5 * * * *");
      const found = log.occurrences.find((entry) => entry.occurredAt === first.toISOString());
      expect(found?.status).toBe("found");
      expect(found?.message).toMatchObject({ state: "pending", attempts: 0 });
      // Die Einreihung traegt die echte Zeit der Transaktion, nicht die des
      // Vorkommens: Der Dispatcher reicht ausdruecklich kein scheduledAt weiter.
      expect(new Date(found!.message!.enqueuedAt).getTime())
        .toBeGreaterThanOrEqual(created - 1_000);
      expect(found!.message!.settledAt).toBeNull();

      const gap = log.occurrences.find((entry) => entry.occurredAt === second.toISOString());
      expect(gap).toMatchObject({ status: "missing", message: null });
      expect(log.counts.found).toBeGreaterThanOrEqual(1);
      expect(log.counts.missing).toBeGreaterThanOrEqual(1);

      // Nutzlast und Verifikator bleiben drinnen, auch wenn beide in derselben
      // Zeile der Datenbank stehen.
      const serialised = JSON.stringify(log);
      expect(serialised).not.toContain("darf-nicht-im-log-stehen");
      expect(serialised).not.toMatch(/[0-9a-f]{64}/);

      // Und die Queue hat wirklich genau eine Nachricht mit einem Verifikator.
      const stored = await owner.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM project_queue_messages
          WHERE organization_id=$1 AND project_id=$2 AND dedupe_key_hash IS NOT NULL`,
        [organizationA, projectId],
      );
      expect(stored.rows[0]?.count).toBe(1);
    } finally {
      // Das Projekt loeschen genuegt: project_environments haengt mit ON DELETE
      // CASCADE daran, und Queue, Nachrichten und Cron-Definition daran.
      await owner.query("DELETE FROM projects WHERE id=$1", [projectId]);
    }
    // Ohne eigenes Zeitbudget: ein Projekt, eine Queue, eine Definition, eine
    // Einreihung und zwei Lesevorgaenge. Kein Statistik-Kollektor und kein
    // Prozessstart, auf den gewartet werden muesste.
  });
});
