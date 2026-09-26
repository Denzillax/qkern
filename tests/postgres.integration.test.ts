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
import { evaluateHealthRules, type HealthAdvisorInput } from "@/lib/server/advisors/health-rules";
import { probeDatabaseHealth } from "@/app/api/v1/projects/[projectId]/environments/[environment]/advisors/health/route";
import { PERFORMANCE_THRESHOLDS } from "@/lib/console/performance-advisor-texts";
import { PostgresUsageRepository } from "@/lib/server/usage/postgres-repository";
import { UsageService } from "@/lib/server/usage/service";
// Der Tabellen-Designer (2.49): Generator, Control Plane, Apply-Dienst,
// Worker und Executor: jeder Teil des Weges als das, was er im Betrieb ist.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { AesGcmStatementCipher, sha256 } from "@/lib/server/control-plane/crypto";
import { PostgresControlPlaneService } from "@/lib/server/control-plane/postgres";
import { PostgresChangeSetApplyService } from "@/lib/server/migrations/services";
import { PostgresMigrationQueue } from "@/lib/server/migrations/postgres-queue";
import { PostgresProjectDatabaseExecutor } from "@/lib/server/migrations/postgres-executor";
import { MigrationWorker } from "@/lib/server/migrations/worker";
import { createTableStatement, TableChangeSetError } from "@/lib/console/table-change-sets";
import { PostgresProjectAuthAuditSink } from "@/lib/server/project-auth/audit-postgres";
// Der erzwingbare zweite Faktor (2.52): echte Repository-, Audit- und
// Token-Teile hinter dem echten Dienst.
import { createHmac, generateKeyPairSync } from "node:crypto";
import { Argon2idPasswordHasher } from "@/lib/server/auth/password";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import { PostgresProjectAuthRepository } from "@/lib/server/project-auth/postgres-repository";
import { ProjectAuthSecretProtector, ProjectAuthTotp } from "@/lib/server/project-auth/mfa";
import { ProjectAuthOidcCatalog, ProjectAuthOidcClient } from "@/lib/server/project-auth/oidc";
import { NoopDevelopmentProjectAuthDelivery, ProjectAuthService } from "@/lib/server/project-auth/service";
import { ProjectAuthTokenService } from "@/lib/server/project-auth/tokens";
// Grenzen je Zeitfenster (2.56): dieselbe reine Formel, die der Dienst
// benutzt, damit der Fall den Hash nachrechnen kann statt ihn zu glauben.
import { projectAuthRateSubjectHash } from "@/lib/server/project-auth/rate-limits";
import {
  buildProjectAuthAuditSeries,
  projectAuthSeriesRowLimit,
  projectAuthSeriesWindow,
} from "@/lib/server/project-auth/audit-series";
// Datenbank-Webhooks (2.50): echter Change Feed, echte Control Plane, echte
// Outbox, echter Zusteller, echter Vault.
import { DatabaseWebhookService } from "@/lib/server/compute/database-webhook-definitions";
import { PostgresDatabaseWebhookRepository } from
  "@/lib/server/compute/database-webhook-postgres-repository";
import { DatabaseWebhookBridge } from "@/lib/server/compute/database-webhook-bridge";
import { PostgresRealtimeChangeSource } from "@/lib/server/realtime/postgres-change-source";
import { WebhookOutbox } from "@/lib/server/compute/webhook-outbox";
import { PostgresWebhookOutboxRepository } from
  "@/lib/server/compute/webhook-postgres-repository";
import { WebhookDeliveryRuntime } from "@/lib/server/compute/webhook-delivery-runtime";
import { WebhookDeliverer } from "@/lib/server/compute/webhooks";
import { HmacWebhookSigner, verifyWebhookSignature } from "@/lib/server/compute/webhook-signer";
import { VaultWebhookSecretProvider } from "@/lib/server/compute/webhook-secret-vault";
import { VaultTokenFileProvider } from "@/lib/server/migrations/connection-catalog-vault";
// Das Aufrufprotokoll (2.55): echte Definition, echter Aufrufdienst, echtes
// Protokoll. Nur die Sandbox ist ersetzt, die ist im Functions-Stack eigens
// zertifiziert.
import { FunctionInvocationService } from "@/lib/server/compute/function-invocation";
import { FunctionInvocationError } from "@/lib/server/compute/functions";
// Die Bruecke als Prozess (2.53): derselbe Prozess, den der Betrieb startet.
import { spawn } from "node:child_process";

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const projectApiUrl = process.env.QKERN_TEST_PROJECT_API_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const authUrl = process.env.QKERN_TEST_AUTH_DATABASE_URL;
const vaultKvUrl = process.env.QKERN_TEST_VAULT_KV_URL;
const vaultTokenFile = process.env.QKERN_TEST_VAULT_TOKEN_FILE;
const databaseWebhookSecretRef = process.env.QKERN_TEST_DATABASE_WEBHOOK_SECRET_REF;
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
        // Die achte Regel hat ihren eigenen Fall (2.57); hier geht es um den
        // Katalog, darum bleibt die Anbieterliste leer.
        authProviders: { providers: [] },
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
        // Die Statement-Regel hat ihren eigenen Fall (2.57); hier geht es um
        // die Tabellen- und Indexstatistik.
        statements: { unavailable: "statementsUnavailable" },
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
    // Eigene Organisation mit eigenem Besitzer, wie die Faelle 2.35 und 2.36:
    // Das Anlegen einer Cron-Definition schreibt eine Audit-Zeile, und eine
    // Organisation mit Audit-Zeilen laesst sich wegen
    // audit_logs_organization_id_fkey nicht mehr loeschen. afterAll raeumt
    // organizationA und organizationB weg; die muessen darum frei von
    // Audit-Zeilen bleiben. Diese Organisation bleibt als erwarteter Rest im
    // Wegwerf-Stack.
    const cronOwner = randomUUID();
    const cronOrganization = randomUUID();
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`, [cronOwner, `cron-log-owner-${cronOwner}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Cron Log', $2, $3)`, [cronOrganization, `cron-log-${cronOrganization}`, cronOwner]);
    const projectId = randomUUID();
    const scope = { organizationId: cronOrganization, projectId, environment: "development" as const };
    const admin = {
      organizationId: cronOrganization, actorRef: "cron-log@qkern.test",
      role: "admin" as const, subject: cronOwner,
    };
    const dispatcher = {
      organizationId: cronOrganization, actorRef: "service-role:cron",
      role: "service_role" as const, subject: "cron",
    };
    const plane = new PostgresControlPlane(runtime);
    const queues = new ProjectQueueService({ repository: new PostgresProjectQueueRepository(plane) });
    const queue = `cron-log-${randomUUID().slice(0, 8)}`;
    try {
      await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
        VALUES ($1, $2, 'Cron Log', $3, 'test', 'ready', $4)`,
      [projectId, cronOrganization, `cron-log-${projectId}`, cronOwner]);
      await owner.query(`INSERT INTO project_environments
        (organization_id, project_id, environment, database_instance_ref)
        VALUES ($1, $2, 'development', $3)`, [cronOrganization, projectId, `managed:${projectId}`]);
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
        [cronOrganization, projectId],
      );
      expect(stored.rows[0]?.count).toBe(1);
    } finally {
      // Weggeraeumt wird nur, was das Produkt wegraeumen laesst. Zwei Zusagen
      // stehen dem grossen Aufraeumen im Weg, und beide sind gewollt:
      // `audit_logs` verweist auf das Projekt und ist nachtraeglich
      // unveraenderlich (0046), und eine Queue-Nachricht mit Dedupe-Schluessel
      // darf vor Ablauf der Aufbewahrung nicht geloescht werden (0026). Der
      // Fall arbeitet ohnehin mit eigener Organisation, eigenem Projekt und
      // eigenen Namen; der Wegwerf-Stack faellt nach dem Lauf weg.
      await owner.query(
        "DELETE FROM project_cron_definitions WHERE organization_id=$1 AND project_id=$2",
        [cronOrganization, projectId],
      );
    }
    // Ohne eigenes Zeitbudget: ein Projekt, eine Queue, eine Definition, eine
    // Einreihung und zwei Lesevorgaenge. Kein Statistik-Kollektor und kein
    // Prozessstart, auf den gewartet werden muesste.
  });

  it("(2.43) enqueues a dedupe key into a queue without a dedupe window against the real pair constraint", async () => {
    // Eine Queue darf mit `dedupeWindowSeconds: 0` entstehen (CHECK 0..86400 in
    // 0026). Bis 2.43 schrieb das Einreihen dann trotzdem den Verifikator, aber
    // keine Frist, und `project_queue_messages_dedupe_pair` wies die Zeile ab:
    // Jedes Einreihen mit Dedupe-Key scheiterte mit einem generischen
    // `QUEUE_CONFLICT`, und jeder Cron-Job auf so einer Queue fiel bei jedem
    // Vorkommen aus. Gegen den Memory-Port war davon nichts zu sehen, denn der
    // kennt die Frist gar nicht. Deshalb steht der Fall hier.
    // Eigene Organisation mit eigenem Besitzer, wie 2.35, 2.36 und 2.42: Das
    // Anlegen von Queue und Cron-Definition schreibt Audit-Zeilen, und eine
    // Organisation mit Audit-Zeilen laesst sich nicht mehr loeschen; das
    // gemeinsame afterAll muss organizationA und organizationB loswerden.
    const zeroOwner = randomUUID();
    const zeroOrganization = randomUUID();
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [zeroOwner, `zero-window-owner-${zeroOwner}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Zero Window', $2, $3)`, [zeroOrganization, `zero-window-${zeroOrganization}`, zeroOwner]);
    const projectId = randomUUID();
    const scope = { organizationId: zeroOrganization, projectId, environment: "development" as const };
    const admin = {
      organizationId: zeroOrganization, actorRef: "zero-window@qkern.test",
      role: "admin" as const, subject: zeroOwner,
    };
    const dispatcher = {
      organizationId: zeroOrganization, actorRef: "service-role:cron",
      role: "service_role" as const, subject: "cron",
    };
    const plane = new PostgresControlPlane(runtime);
    const queues = new ProjectQueueService({ repository: new PostgresProjectQueueRepository(plane) });
    const open = `zero-window-${randomUUID().slice(0, 8)}`;
    const guarded = `one-second-${randomUUID().slice(0, 8)}`;
    try {
      await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
        VALUES ($1, $2, 'Zero Window', $3, 'test', 'ready', $4)`,
      [projectId, zeroOrganization, `zero-window-${projectId}`, zeroOwner]);
      await owner.query(`INSERT INTO project_environments
        (organization_id, project_id, environment, database_instance_ref)
        VALUES ($1, $2, 'development', $3)`, [zeroOrganization, projectId, `managed:${projectId}`]);

      const created = await queues.createQueue(admin, scope, { name: open, dedupeWindowSeconds: 0 });
      expect(created.dedupeWindowSeconds).toBe(0);

      // Der Fall, der vorher scheiterte: Dedupe-Key in eine Queue ohne Fenster.
      const first = await queues.enqueue(dispatcher, scope, open, {
        payload: { task: "zero" }, dedupeKey: "cron:zero:first",
      });
      expect(first.deduplicated).toBe(false);

      // Abgelegt wird weder Verifikator noch Frist. Ein Verifikator ohne Frist
      // waere nicht nur ein CHECK-Bruch, sondern eine Zeile, die der
      // Sperrindex fuer immer besetzt haelt und der Loeschwaechter nie gehen
      // laesst: Das Aufraeumen loescht nur **abgelaufene** Fristen.
      const stored = await owner.query<{ dedupe_key_hash: string | null; dedupe_expires_at: Date | null }>(
        `SELECT dedupe_key_hash, dedupe_expires_at FROM project_queue_messages
          WHERE organization_id=$1 AND project_id=$2 AND id=$3`,
        [zeroOrganization, projectId, first.id],
      );
      expect(stored.rows[0]).toMatchObject({ dedupe_key_hash: null, dedupe_expires_at: null });

      // Ohne Fenster dedupliziert nichts. Das ist die Zusage, nicht ein Fehler.
      const second = await queues.enqueue(dispatcher, scope, open, {
        payload: { task: "zero" }, dedupeKey: "cron:zero:first",
      });
      expect(second.deduplicated).toBe(false);
      expect(second.id).not.toBe(first.id);

      // Ein Cron-Job auf so einer Queue laeuft jetzt, statt bei jedem
      // Vorkommen auszufallen.
      const definitions = new ComputeDefinitionService({
        repository: new PostgresComputeDefinitionRepository(plane),
      });
      const definition = await definitions.createCron(admin, scope, {
        name: `zero-window-${randomUUID().slice(0, 8)}`, expression: "*/5 * * * *", queue: open,
        payload: { task: "run" },
      });
      const occurredAt = new Date(Math.floor(Date.now() / 300_000) * 300_000 + 300_000);
      const receipt = await new CronDispatcher(queues).dispatch(definition, occurredAt, dispatcher);
      expect(receipt.status).toBe("dispatched");

      // Gegenprobe am kleinsten echten Fenster: Dort entsteht der Verifikator
      // mit einer Frist echt nach `created_at`, und dasselbe Vorkommen bleibt
      // eine Nachricht.
      await queues.createQueue(admin, scope, { name: guarded, dedupeWindowSeconds: 1 });
      const once = await queues.enqueue(dispatcher, scope, guarded, {
        payload: { task: "guarded" }, dedupeKey: "cron:guarded:first",
      });
      const again = await queues.enqueue(dispatcher, scope, guarded, {
        payload: { task: "guarded" }, dedupeKey: "cron:guarded:first",
      });
      expect(again).toMatchObject({ id: once.id, deduplicated: true });
      const guardedRow = await owner.query<{ ok: boolean }>(
        `SELECT (dedupe_key_hash IS NOT NULL AND dedupe_expires_at > created_at) AS ok
           FROM project_queue_messages WHERE organization_id=$1 AND project_id=$2 AND id=$3`,
        [zeroOrganization, projectId, once.id],
      );
      expect(guardedRow.rows[0]?.ok).toBe(true);

      // Und der CHECK, um den es geht, ist wirklich da: Ein Verifikator ohne
      // Frist bleibt auf Datenbankebene unmoeglich. Ginge diese Zeile durch,
      // wuerde der Fall oben nichts beweisen.
      const queueRow = await owner.query<{ id: string }>(
        "SELECT id FROM project_queues WHERE organization_id=$1 AND project_id=$2 AND name=$3",
        [zeroOrganization, projectId, open],
      );
      await expect(owner.query(`INSERT INTO project_queue_messages
        (organization_id,project_id,environment,queue_id,payload,owner_subject,dedupe_key_hash)
        VALUES ($1,$2,'development',$3,'{}'::jsonb,'probe',$4)`,
      [zeroOrganization, projectId, queueRow.rows[0]?.id, "f".repeat(64)]))
        .rejects.toMatchObject({ constraint: "project_queue_messages_dedupe_pair" });
    } finally {
      // Weggeraeumt wird nur, was das Produkt wegraeumen laesst: Die
      // Nachrichten sind nicht abgeschlossen und bleiben darum liegen (0026),
      // die Audit-Zeilen sind unveraenderlich. Eigene Organisation, eigenes
      // Projekt, eigene Namen. Der Wegwerf-Stack faellt nach dem Lauf weg.
      await owner.query(
        "DELETE FROM project_cron_definitions WHERE organization_id=$1 AND project_id=$2",
        [zeroOrganization, projectId],
      );
    }
    // Ohne eigenes Zeitbudget: ein Projekt, zwei Queues, vier Einreihungen,
    // eine Definition und eine abgewiesene Direkteinfuegung.
  });
  it("(2.44) reads a real catalog as a healthy database and a binding that points nowhere as degraded", async () => {
    // Die Datenbankprobe der Projekt-Gesundheit gegen echte Verbindungen.
    // Zwei Haelften, und die zweite ist die, die im Speicherbetrieb nie
    // auffaellt: Eine Umgebung, deren Bindung ins Leere zeigt, darf keinen
    // Stacktrace und keinen Verbindungsstring in die Antwort tragen, sondern
    // nur die Fehlerklasse. Geschrieben wird nichts ausser dem eigenen
    // Schema, und das faellt am Ende samt Inhalt weg.
    expect(projectApiUrl, "QKERN_TEST_PROJECT_API_DATABASE_URL fehlt").toBeTruthy();
    const schema = `health_${randomUUID().replaceAll("-", "_")}`;
    const projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
    const nowhereUrl = new URL(projectApiUrl!);
    nowhereUrl.pathname = `/absent_${randomUUID().replaceAll("-", "_")}`;
    const nowhere = createPostgresPool({ connectionString: nowhereUrl.toString(), max: 1 });
    const context = { organizationId: organizationA, actorRef: "health@qkern.test" };
    const scope = { projectId: "certification-project", environment: "development" as const };
    try {
      await owner.query(`CREATE SCHEMA "${schema}"`);
      await owner.query(`CREATE TABLE "${schema}".orders (id integer PRIMARY KEY, total integer NOT NULL)`);
      await owner.query(`CREATE TABLE "${schema}".invoices (id integer PRIMARY KEY, total integer NOT NULL)`);
      await owner.query(`CREATE TABLE "${schema}".notes (id integer PRIMARY KEY, body text)`);
      await owner.query(`GRANT USAGE ON SCHEMA "${schema}" TO qkern_project_api_app`);

      const reachable = new ProjectDataPlaneService(
        { resolveTarget: async () => ({ databaseInstanceRef: "managed:certification" }) },
        { resolve: async () => ({
          pool: projectApi,
          expectedRole: "qkern_project_api_app",
          expectedDatabase: new URL(projectApiUrl!).pathname.slice(1),
          expectedLedgerOwner: "qkern",
        }) },
      );
      const healthy = await probeDatabaseHealth(reachable, context, scope, schema);
      expect(healthy).toEqual({ tables: 3 });
      const good = evaluateHealthRules(healthyInput({ database: healthy }));
      expect(good.subsystems.find((subsystem) => subsystem.id === "database")).toEqual({
        id: "database", state: "ok",
        detail: "Die Projektdatenbank hat einen Katalogabruf beantwortet.",
        evidence: [{ measure: "tables", label: "Tabellen im Schema public", count: 3 }],
      });
      expect(good.overall).toBe("ok");

      // Zweite Haelfte: dieselbe Probe, aber die Bindung zeigt auf eine
      // Datenbank, die es auf dem Cluster nicht gibt. PostgreSQL antwortet,
      // und was ankommt, ist eine Fehlerklasse und kein Text der Datenbank.
      const broken = new ProjectDataPlaneService(
        { resolveTarget: async () => ({ databaseInstanceRef: "managed:absent" }) },
        { resolve: async () => ({
          pool: nowhere,
          expectedRole: "qkern_project_api_app",
          expectedDatabase: nowhereUrl.pathname.slice(1),
          expectedLedgerOwner: "qkern",
        }) },
      );
      const failed = await probeDatabaseHealth(broken, context, scope, schema);
      expect(failed).toEqual({ unavailable: "unavailable" });
      const bad = evaluateHealthRules(healthyInput({ database: failed }));
      const report = bad.subsystems.find((subsystem) => subsystem.id === "database")!;
      expect(report.state).toBe("degraded");
      expect(report.evidence).toEqual([
        { measure: "errorUnavailable", label: "Fehlerklasse: keine oder keine gültige Antwort", count: null },
      ]);
      expect(bad.overall).toBe("degraded");
      // Kein Stacktrace, kein Verbindungsstring, kein Datenbankname.
      const serialised = JSON.stringify(report);
      expect(serialised).not.toContain("postgres");
      expect(serialised).not.toContain(nowhereUrl.pathname.slice(1));
      // Eine Stapelzeile hat die Form "at datei:zeile:spalte". Die blosse
      // Zeichenfolge "at " taugt nicht als Probe: sie steckt in jedem
      // deutschen "hat".
      expect(serialised).not.toMatch(/at [^\s"]+:\d+:\d+/);
      expect(serialised).not.toContain("Error");
      // Und der Beleg traegt nur bekannte Messgroessen mit Zahl oder null.
      for (const entry of report.evidence) {
        expect(typeof entry.measure, entry.measure).toBe("string");
        expect(entry.count === null || typeof entry.count === "number", `count ${entry.count}`).toBe(true);
      }
    } finally {
      await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await Promise.all([projectApi.end(), nowhere.end()]);
    }
    // Ohne eigenes Zeitbudget: ein Schema, drei Tabellen, ein Katalogabruf und
    // ein Verbindungsversuch, der abgewiesen wird. Keine Organisation und kein
    // Projekt entstehen, darum auch keine Audit-Zeile, die das gemeinsame
    // afterAll am Loeschen hindern koennte.
  });

  it("(2.45) aggregates usage events written through the real service into the right hourly buckets", async () => {
    // Die Zeitreihe entsteht in der Datenbank: date_trunc, GROUP BY, ORDER BY
    // ueber `usage_events`. Gegen den Memory-Port ist davon nichts zu sehen,
    // denn der kann die Aggregation gar nicht; und die drei Dinge, die hier
    // schiefgehen koennen, gehen nur echt schief: die Zeitzone von
    // `date_trunc`, die Trennung von angenommen und abgelehnt (die eine echte
    // Quota-Entscheidung braucht) und die Grenze des Fensters.
    // Eigene Organisation mit eigenem Besitzer, wie 2.35, 2.36, 2.42 und 2.43:
    // Das Setzen der Quota schreibt eine Audit-Zeile, und eine Organisation
    // mit Audit-Zeilen laesst sich nicht mehr loeschen; das gemeinsame
    // afterAll muss organizationA und organizationB loswerden.
    const seriesOwner = randomUUID();
    const seriesOrganization = randomUUID();
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [seriesOwner, `series-owner-${seriesOwner}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Usage Series', $2, $3)`, [seriesOrganization, `usage-series-${seriesOrganization}`, seriesOwner]);
    const projectId = randomUUID();
    const scope = { organizationId: seriesOrganization, projectId, environment: "development" as const };
    const base = { organizationId: seriesOrganization, subject: seriesOwner, actorRef: "series@qkern.test" };
    const meter = { ...base, role: "meter" as const };
    const operator = { ...base, role: "operator" as const };
    const reader = { ...base, role: "reader" as const };

    // Die Uhr des Dienstes steht fest, damit Fenster und Eimer berechenbar
    // sind: der laufende Eimer ist die Stunde von `hour`.
    const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
    const at = (hours: number, minutes = 0) =>
      new Date(hour.getTime() - hours * 3_600_000 + minutes * 60_000);
    const service = new UsageService({
      repository: new PostgresUsageRepository(new PostgresControlPlane(runtime)),
      now: () => new Date(hour.getTime() + 30 * 60_000),
    });
    const key = randomUUID().slice(0, 8);
    const record = (suffix: string, quantity: number, observedAt: Date) => service.record(meter, scope, {
      metric: "api_requests", source: "data_plane", quantity,
      idempotencyKey: `series-${key}-${suffix}`, observedAt,
    });

    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Usage Series', $3, 'test', 'ready', $4)`,
    [projectId, seriesOrganization, `usage-series-${projectId}`, seriesOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [seriesOrganization, projectId, `managed:${projectId}`]);

    // Eine harte Quota, damit es ueberhaupt eine abgelehnte Menge geben kann.
    // Ohne sie waere jedes Ereignis angenommen, und die Trennung der beiden
    // Summen bliebe unbelegt.
    await service.setQuota(operator, scope, {
      metric: "api_requests", limit: 120, mode: "enforce", expectedRevision: null,
    });

    // Genau am Fensteranfang (Ende minus 48 Stunden) und eine Minute davor.
    await record("edge-in", 3, at(47));
    await record("edge-out", 999, at(47, -1));
    // Zwei Ereignisse in derselben Stunde, drei Stunden zurueck.
    await record("a", 5, at(3, 10));
    await record("b", 7, at(3, 50));
    // Die Stunde davor bleibt leer; zwei Stunden spaeter greift die Quota.
    await record("c", 100, at(1, 5));
    const denied = await record("d", 50, at(1, 40));
    expect(denied).toMatchObject({ accepted: false, rejectionCode: "QUOTA_EXCEEDED", mode: "enforce" });

    const series = await service.readSeries(reader, scope, { metric: "api_requests", bucket: "hour" });
    expect(series.bucketCount).toBe(48);
    expect(series.buckets).toHaveLength(48);
    expect(series.windowStart).toBe(at(47).toISOString());
    expect(series.windowEnd).toBe(at(-1).toISOString());
    expect(series.truncated).toBe(false);

    const bucketAt = (hours: number) =>
      series.buckets.find((entry) => entry.start === at(hours).toISOString());
    // Der Eimer genau auf der Fenstergrenze traegt das Ereignis; das eine
    // Minute aeltere Ereignis taucht nirgends auf.
    expect(bucketAt(47)).toMatchObject({ accepted: "3", rejected: "0", events: 1 });
    expect(series.buckets[0]?.start).toBe(at(47).toISOString());
    // Zwei Ereignisse derselben Stunde werden eine Zeile.
    expect(bucketAt(3)).toMatchObject({ accepted: "12", rejected: "0", events: 2 });
    // Eine Stunde ohne Ereignis ist Null, nicht abwesend.
    expect(bucketAt(2)).toMatchObject({ accepted: "0", rejected: "0", events: 0 });
    // Angenommen und abgelehnt in derselben Stunde, getrennt gezaehlt.
    expect(bucketAt(1)).toMatchObject({ accepted: "100", rejected: "50", events: 2 });
    // Fuenf Ereignisse, nicht sechs: `edge-out` liegt eine Minute vor dem
    // Fenster und zaehlt nirgends mit, wie die naechste Zusicherung verlangt.
    // 115 = 3 + 5 + 7 + 100, dazu 50 abgelehnt.
    expect(series.totals).toEqual({ accepted: "115", rejected: "50", events: 5 });
    // 999 lag vor dem Fenster und ist in keiner Summe.
    expect(JSON.stringify(series)).not.toContain("999");

    // Dieselben Ereignisse in Tageseimern, aber in einem anderen Fenster: 90
    // Tage statt 48 Stunden. `edge-out` liegt darin, und die Quota hat es
    // abgelehnt (999 ueber dem Limit 120). Deshalb sechs Ereignisse und
    // 1049 = 999 + 50 abgelehnt. Genau daran zeigt sich, dass das Fenster und
    // nicht die Eimergroesse darueber entscheidet, was mitzaehlt.
    const daily = await service.readSeries(reader, scope, { metric: "api_requests", bucket: "day" });
    expect(daily.bucketCount).toBe(90);
    expect(daily.buckets).toHaveLength(90);
    expect(daily.totals).toEqual({ accepted: "115", rejected: "1049", events: 6 });
    for (const entry of daily.buckets) {
      expect(entry.start.endsWith("T00:00:00.000Z"), entry.start).toBe(true);
    }
    expect(daily.buckets.filter((entry) => entry.events > 0).length).toBeLessThanOrEqual(3);

    // Weggeraeumt wird nichts: `usage_events` ist append-only (der Trigger aus
    // 0028 weist DELETE ab), die Audit-Zeile der Quota ist unveraenderlich.
    // Eigene Organisation, eigenes Projekt, eigene Schluessel; der
    // Wegwerf-Stack faellt nach dem Lauf weg.
    // Ohne eigenes Zeitbudget: sechs Buchungen, eine Quota und zwei Aggregationen.
  });

  it("(2.46) counts the sessions of the project read role and carries no query text out of the database", async () => {
    // Die Betriebszahlen und die Verbindungsgruppen an einem echten Server.
    // Nur echt zu belegen ist die eine Zusage, auf die es hier ankommt: In
    // `pg_stat_activity` steht der Abfragetext laufender Statements, und
    // dieser Fall stellt ihn absichtlich hinein — mit einem Literal, das
    // sonst nirgends vorkommt. Danach muss die ganze Antwort frei davon
    // sein. Gegen einen Fake waere das keine Aussage, weil der Fake den Text
    // gar nicht erst hat.
    //
    // Geschrieben wird nichts: keine Audit-Zeile, keine Organisation, kein
    // Projekt. Darum braucht dieser Fall auch keine eigene Organisation wie
    // 2.35, 2.36, 2.42, 2.43 und 2.45; er liest nur, unter organizationA.
    expect(projectApiUrl, "QKERN_TEST_PROJECT_API_DATABASE_URL fehlt").toBeTruthy();
    const role = decodeURIComponent(new URL(projectApiUrl!).username);
    const projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
    // Die zweite Verbindung derselben Projekt-Leserolle: Sie bleibt offen und
    // traegt als letztes Statement ein wiedererkennbares Literal.
    const second = createPostgresPool({ connectionString: projectApiUrl!, max: 1 });
    const marker = `aktivitaetsprobe_${randomUUID().replaceAll("-", "_")}`;
    try {
      const echoed = await second.query<{ probe: string }>(`SELECT '${marker}'::text AS probe`);
      expect(echoed.rows[0]?.probe).toBe(marker);

      const service = new ProjectDataPlaneService(
        { resolveTarget: async () => ({ databaseInstanceRef: "managed:certification" }) },
        { resolve: async () => ({
          pool: projectApi,
          expectedRole: "qkern_project_api_app",
          expectedDatabase: new URL(projectApiUrl!).pathname.slice(1),
          expectedLedgerOwner: "qkern",
        }) },
      );
      const activity = await service.inspectActivity(
        { organizationId: organizationA, actorRef: "activity@qkern.test" },
        { projectId: "certification-project", environment: "development" },
      );

      // Die Betriebszahlen sind plausibel: Der Stack hat migriert und gelesen.
      expect(activity.source).toBe("postgres");
      expect(activity.database.commits).toBeGreaterThan(0);
      expect(activity.database.blocksHit + activity.database.blocksRead).toBeGreaterThan(0);
      expect(activity.database.backends).toBeGreaterThanOrEqual(1);
      expect(activity.database.maxConnections).toBeGreaterThanOrEqual(300);
      expect(activity.truncated).toBe(false);

      // Die zweite Sitzung steckt in der Gruppe ihrer Rolle. Gezaehlt wird sie
      // zusammen mit der lesenden Sitzung; einzeln zeigt QKERN keine.
      const own = activity.connections.filter((group) => group.role === role);
      const counted = own.reduce((sum, group) => sum + group.count, 0);
      expect(counted,
        `Gruppen: ${JSON.stringify(activity.connections)}`).toBeGreaterThanOrEqual(2);
      for (const group of activity.connections) {
        expect(group.count).toBeGreaterThan(0);
        expect(group.oldestSeconds).toBeGreaterThanOrEqual(0);
        expect(Object.keys(group).sort()).toEqual(["count", "oldestSeconds", "role", "state"]);
      }
      // Was diese Rolle nicht sehen darf, fehlt in der Zaehlung; mehr als die
      // Datenbank selbst meldet, kann sie nie sein.
      const visible = activity.connections.reduce((sum, group) => sum + group.count, 0);
      expect(visible).toBeLessThanOrEqual(activity.database.backends);

      // Der Kern des Falls: kein Feld der ganzen Antwort traegt den Text der
      // Abfrage, die auf der zweiten Verbindung lief.
      const serialised = JSON.stringify(activity);
      expect(serialised).not.toContain(marker);
      expect(serialised).not.toContain("aktivitaetsprobe");
      expect(serialised.toLowerCase()).not.toContain("select");
      expect(serialised.toLowerCase()).not.toContain("probe");
      // Und die zweite Verbindung stand zu diesem Zeitpunkt wirklich mit
      // diesem Text in der Sicht: Sonst waere die Zusage oben geschenkt.
      // Gefragt wird ueber den Pool der Data Plane, also aus derselben Rolle
      // (eine Rolle sieht ihre eigenen Sitzungen immer), damit die zweite
      // Verbindung ihren letzten Abfragetext behaelt; und mit Parameter,
      // damit der Abfragetext dieser Pruefung selbst das Literal nicht traegt.
      const raw = await projectApi.query<{ hits: string }>(
        "SELECT count(*)::text AS hits FROM pg_catalog.pg_stat_activity WHERE query LIKE $1", [`%${marker}%`]);
      expect(Number(raw.rows[0]?.hits ?? 0),
        "Die Sicht traegt den Abfragetext nicht; dann prueft dieser Fall nichts.").toBeGreaterThan(0);
    } finally {
      await Promise.all([projectApi.end(), second.end()]);
    }
  });

  it("(2.49) applies a console change set through the approval path and leaves the table as described", async () => {
    // Der Tabellen-Designer (2.49) ist die erste Ansicht der Console, aus der
    // eine Schemaaenderung hervorgeht. Der Beleg dafuer steht nicht in der
    // Control Plane, sondern in der Zieldatenbank: Die Tabelle gibt es, ihre
    // Spalten sehen aus wie beschrieben, und im Ledger steht, welches Change
    // Set sie angelegt hat.
    //
    // Nachgebaut ist an diesem Weg nichts: echter Generator, echte
    // Change-Set-Erstellung mit echter SQL-Pruefung und echter Verschluesselung,
    // echte Freigabe, echter Apply-Dienst, echter Worker mit echtem Executor,
    // echte Zieldatenbank mit echtem Ledger und Zaun.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.35, 2.36, 2.42, 2.43 und
    // 2.45: Das Erstellen eines Change Sets schreibt Audit-Zeilen, und eine
    // Organisation mit Audit-Zeilen laesst sich wegen
    // audit_logs_organization_id_fkey nicht mehr loeschen. Das gemeinsame
    // afterAll muss organizationA und organizationB loswerden; diese
    // Organisation bleibt als erwarteter Rest im Wegwerf-Stack. Abgeraeumt
    // wird, was das Produkt hergibt: die Wegwerf-Projektdatenbank.
    const allowCreate = process.env.QKERN_TEST_ALLOW_DATABASE_CREATE_DROP === "true";
    expect(allowCreate, "QKERN_TEST_ALLOW_DATABASE_CREATE_DROP fehlt").toBe(true);

    const migratorPassword = "qkern_project_migrator_local_only";
    const designerOwner = randomUUID();
    const designerOrganization = randomUUID();
    const projectId = randomUUID();
    const instanceRef = `managed:${projectId}`;
    const databaseName = `qkern_designer_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const table = `designer_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    expect(databaseName).toMatch(/^[a-z][a-z0-9_]{1,60}$/);

    /** `postgres://user:pw@host:port/other` mit ausgetauschtem Datenbanknamen. */
    const withDatabase = (base: string, name: string, credentials?: string) => {
      const url = new URL(credentials ? base.replace(/\/\/[^@]+@/, `//${credentials}@`) : base);
      url.pathname = `/${name}`;
      return url.toString();
    };

    // Die Rollen sind clusterweit; ein zweiter Lauf im selben Cluster findet
    // sie vor, und das ist kein Fehler. `IF NOT EXISTS` vor `CREATE ROLE` ist
    // nicht atomar, der Ausnahmezweig schon.
    await owner.query(`DO $$ BEGIN
      CREATE ROLE qkern_ledger_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
        NOREPLICATION NOBYPASSRLS;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await owner.query(`DO $$ BEGIN
      CREATE ROLE qkern_project_migrator LOGIN PASSWORD '${migratorPassword}'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    // Der Zaun verlangt einen Ledger-Eigentuemer ohne jede Mitgliedschaft, und
    // PostgreSQL arbeitet dagegen: Seit 16 teilt `CREATE ROLE` die neue Rolle
    // dem Erzeuger mit ADMIN OPTION zu. Aufgeraeumt wird deshalb hier und
    // nicht einmalig im Setup, dieselbe Stelle wie im Migrations-Prozessfall.
    await owner.query(`DO $$ DECLARE entry record; BEGIN
      FOR entry IN SELECT m.member::regrole::text AS role FROM pg_auth_members m
        WHERE m.roleid = 'qkern_ledger_owner'::regrole LOOP
        EXECUTE format('REVOKE qkern_ledger_owner FROM %I', entry.role);
      END LOOP;
      FOR entry IN SELECT m.roleid::regrole::text AS role FROM pg_auth_members m
        WHERE m.member = 'qkern_ledger_owner'::regrole LOOP
        EXECUTE format('REVOKE %I FROM qkern_ledger_owner', entry.role);
      END LOOP;
    END $$;`);

    await owner.query(`CREATE DATABASE "${databaseName}"`);
    let project: SqlPool | undefined;
    let migrator: SqlPool | undefined;
    try {
      project = createPostgresPool({
        connectionString: withDatabase(ownerUrl!, databaseName), max: 2, statementTimeoutMillis: 120_000,
      });
      // Genau das, was der Provisioner taete: Ledger und Zaun der
      // Projektdatenbank, dann das Recht, im Anwendungsschema anzulegen.
      for (const file of ["0001_qkern_migration_ledger.sql", "0002_qkern_migration_fence.sql"]) {
        await project.query(await readFile(path.resolve(process.cwd(), "db/project", file), "utf8"));
      }
      await project.query("GRANT CREATE, USAGE ON SCHEMA public TO qkern_project_migrator");

      await owner.query(`INSERT INTO users (id, email, password_hash, status)
        VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
      [designerOwner, `designer-${designerOwner}@qkern.test`]);
      await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
        VALUES ($1, 'Table Designer', $2, $3)`,
      [designerOrganization, `table-designer-${designerOrganization}`, designerOwner]);
      await owner.query(`INSERT INTO organization_members (organization_id, user_id, role, is_personal_workspace)
        VALUES ($1, $2, 'owner', true)`, [designerOrganization, designerOwner]);
      await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
        VALUES ($1, $2, 'Table Designer', $3, 'test', 'ready', $4)`,
      [projectId, designerOrganization, `table-designer-${projectId}`, designerOwner]);
      await owner.query(`INSERT INTO project_environments
        (organization_id, project_id, environment, database_instance_ref)
        VALUES ($1, $2, 'development', $3)`, [designerOrganization, projectId, instanceRef]);

      // Der Entwurf, wie ihn die Ansicht zusammenstellt.
      const statement = createTableStatement({
        table,
        columns: [
          { name: "id", type: "uuid", notNull: true, default: "uuid" },
          { name: "name", type: "text", notNull: true, default: "none" },
          { name: "erstellt_am", type: "timestamptz", notNull: false, default: "now" },
        ],
      });
      expect(statement).toBe(`CREATE TABLE "public"."${table}" ` +
        `("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" text NOT NULL, ` +
        `"erstellt_am" timestamptz DEFAULT now())`);

      // Der feindliche Name faellt im Generator, also bevor irgendetwas
      // gesendet, verschluesselt oder geschrieben wird.
      expect(() => createTableStatement({
        table: `${table}"); DROP SCHEMA public CASCADE; --`,
        columns: [{ name: "id", type: "uuid", notNull: true, default: "uuid" }],
      })).toThrowError(TableChangeSetError);
      const beforeChangeSets = await owner.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM change_sets WHERE project_id = $1", [projectId]);
      expect(beforeChangeSets.rows[0]?.n, "der abgewiesene Name darf kein Change Set erzeugt haben").toBe("0");

      const cipher = new AesGcmStatementCipher(Buffer.from("0".repeat(64), "hex"));
      const control = new PostgresControlPlane(owner);
      const service = new PostgresControlPlaneService(control, cipher);
      const context = {
        organizationId: designerOrganization,
        actor: { id: designerOwner, ref: `designer-${designerOwner}@qkern.test`, type: "user" as const },
      };

      const change = await service.createChangeSet(context, {
        projectId, environment: "development", title: `Tabelle anlegen: ${table}`, statement,
      });
      expect(change.status).toBe("ready");

      // Freigabe ueber denselben Dienst, den die Freigabezentrale ruft. Er
      // entschluesselt das Statement noch einmal und rechnet den Aktionshash
      // nach; eine erfundene Freigabe kaeme hier nicht durch.
      const approvals = await owner.query<{ id: string }>(
        "SELECT id FROM approval_requests WHERE change_set_id = $1", [change.id]);
      expect(approvals.rows, "eine Schemaaenderung braucht eine Freigabe").toHaveLength(1);
      const decided = await service.decideApproval(context, {
        approvalId: approvals.rows[0].id, decision: "approved",
      });
      expect(decided.status).toBe("approved");

      const queued = await new PostgresChangeSetApplyService(control)
        .queueApprovedChangeSet(context, { changeSetId: change.id });
      expect(queued.outcome).toBe("queued");

      migrator = createPostgresPool({
        connectionString: withDatabase(ownerUrl!, databaseName, `qkern_project_migrator:${migratorPassword}`),
        max: 2,
        statementTimeoutMillis: 120_000,
      });
      const resolvedMigrator = migrator;
      const worker = new MigrationWorker(
        new PostgresMigrationQueue(control, designerOrganization),
        new PostgresProjectDatabaseExecutor({
          resolve: () => ({
            pool: resolvedMigrator,
            expectedRole: "qkern_project_migrator",
            expectedDatabase: databaseName,
            expectedLedgerOwner: "qkern_ledger_owner",
          }),
        }),
        cipher,
        { workerId: "certification-table-designer-1" },
      );
      const applied = await worker.runOnce();
      expect(applied, "der Worker hat nicht angewendet").toMatchObject({ status: "applied" });

      // Der Beleg: der Katalog der Zieldatenbank, nicht die Control Plane.
      const columns = await project.query<{
        column_name: string; data_type: string; is_nullable: string; column_default: string | null;
      }>(`SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1
           ORDER BY ordinal_position`, [table]);
      expect(columns.rows.map((row) => row.column_name)).toEqual(["id", "name", "erstellt_am"]);
      expect(columns.rows.map((row) => row.data_type)).toEqual(["uuid", "text", "timestamp with time zone"]);
      expect(columns.rows.map((row) => row.is_nullable)).toEqual(["NO", "NO", "YES"]);
      expect(columns.rows[0].column_default).toBe("gen_random_uuid()");
      expect(columns.rows[1].column_default).toBeNull();
      expect(columns.rows[2].column_default).toBe("now()");

      const ledger = await project.query<{ change_set_id: string; statement_sha256: string }>(
        "SELECT change_set_id::text AS change_set_id, statement_sha256 FROM qkern_internal.migration_ledger");
      expect(ledger.rows.map((row) => row.change_set_id)).toEqual([change.id]);
      expect(ledger.rows[0].statement_sha256).toBe(sha256(statement));

      // Und nichts sonst: kein Schema verloren, keine Tabelle mit einem Namen,
      // der aus dem Anfuehrungszeichen ausgebrochen waere.
      const relations = await project.query<{ relname: string }>(
        `SELECT relname FROM pg_catalog.pg_class relation
           JOIN pg_catalog.pg_namespace space ON space.oid = relation.relnamespace
          WHERE space.nspname = 'public' AND relation.relkind = 'r'`);
      expect(relations.rows.map((row) => row.relname)).toEqual([table]);
    } finally {
      await Promise.allSettled([project?.end(), migrator?.end()]);
      await owner.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).catch(() => undefined);
    }
  }, 180_000);
  it("(2.47) aggregates project auth audit rows into buckets without carrying an address", async () => {
    // Die Zeitreihe der Anmeldungen entsteht in der Datenbank: date_trunc,
    // GROUP BY, ORDER BY ueber `audit_logs`, gefiltert auf
    // `project_auth.*`. Drei Dinge gehen nur echt schief und sind darum nur
    // echt zu belegen: die Zeitzone von `date_trunc`, die Trennung von
    // gelungen und gescheitert ueber `COUNT(*) FILTER`, und die Grenze des
    // Fensters, die als WHERE in der Abfrage steht und nicht in JavaScript.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.35, 2.36, 2.42, 2.43
    // und 2.45: Die Eintraege sind Audit-Zeilen, und eine Organisation mit
    // Audit-Zeilen laesst sich nicht mehr loeschen; das gemeinsame afterAll
    // muss organizationA und organizationB loswerden. Weggeraeumt wird
    // darum nichts: audit_logs ist append-only (der Trigger aus 0002 weist
    // UPDATE und DELETE ab), und der Wegwerf-Stack faellt nach dem Lauf weg.
    const seriesOwner = randomUUID();
    const seriesOrganization = randomUUID();
    const seriesProject = randomUUID();
    const scope = { organizationId: seriesOrganization, projectId: seriesProject, environment: "development" as const };
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [seriesOwner, `auth-series-owner-${seriesOwner}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Auth Series', $2, $3)`, [seriesOrganization, `auth-series-${seriesOrganization}`, seriesOwner]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Auth Series', $3, 'test', 'ready', $4)`,
    [seriesProject, seriesOrganization, `auth-series-${seriesProject}`, seriesOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [seriesOrganization, seriesProject, `managed:${seriesProject}`]);

    const sink = new PostgresProjectAuthAuditSink(auth);
    const appUser = randomUUID();
    const userRef = `project_auth_user:${appUser}`;
    // `created_at` setzt die Datenbank selbst (DEFAULT now()), und die Kette
    // ist append-only: Ein Zeitpunkt laesst sich nachtraeglich nicht setzen.
    // Der bekannte Zeitpunkt ist darum die Stunde des Schreibens, aus der
    // Kette zurueckgelesen und nicht von der Uhr dieses Prozesses; das
    // Fenster wird um sie herum verschoben.
    for (const event of [
      { action: "project_auth.signup.succeeded", status: "succeeded" as const },
      { action: "project_auth.login.succeeded", status: "succeeded" as const },
      { action: "project_auth.login.failed", status: "failed" as const },
    ]) {
      await sink.record({
        scope, actorType: "app_user", actorRef: userRef, resourceRef: userRef,
        action: event.action, status: event.status, metadata: { method: "password" },
      });
    }
    // Eine E-Mail kommt gar nicht erst in die Kette: Der Sanitizer wirft,
    // bevor irgendetwas geschrieben wird. Ohne diese Zusicherung koennte die
    // Reihe unten frei von "@" sein, nur weil nie eines geschrieben wurde.
    await expect(sink.record({
      scope, actorType: "app_user", actorRef: `app-${appUser}@example.test`,
      resourceRef: userRef, action: "project_auth.login.succeeded", status: "succeeded",
    })).rejects.toMatchObject({ name: "InvalidProjectAuthAuditEventError" });

    const page = await sink.list(scope, { limit: 10 });
    expect(page.events.map((event) => event.action)).toEqual([
      "project_auth.login.failed", "project_auth.login.succeeded", "project_auth.signup.succeeded",
    ]);
    expect(page.events[0]).toMatchObject({ actorRef: userRef, resourceRef: userRef, status: "failed" });
    const written = new Date(page.events[0].createdAt);
    const hour = new Date(Math.floor(written.getTime() / 3_600_000) * 3_600_000);
    // Alle drei Zeilen in derselben Stunde: Sonst haette das Schreiben eine
    // Stundengrenze ueberquert, und die Zusicherungen unten meinten zwei
    // Eimer statt einen.
    for (const event of page.events) {
      expect(new Date(event.createdAt).getTime()).toBeGreaterThanOrEqual(hour.getTime());
      expect(new Date(event.createdAt).getTime()).toBeLessThan(hour.getTime() + 3_600_000);
    }

    const read = async (bucket: "hour" | "day", now: Date) => {
      const window = projectAuthSeriesWindow(bucket, now);
      const records = await sink.series(scope, {
        bucket, from: window.start, to: window.end, limit: projectAuthSeriesRowLimit(bucket) + 1,
      });
      return buildProjectAuthAuditSeries({ bucket, now, records });
    };

    const series = await read("hour", written);
    expect(series.bucketCount).toBe(48);
    expect(series.buckets).toHaveLength(48);
    expect(series.windowEnd).toBe(new Date(hour.getTime() + 3_600_000).toISOString());
    expect(series.truncated).toBe(false);
    // Drei Zeilen, in derselben Stunde, nach Handlung getrennt und nach
    // Ausgang aufgeteilt. Die Aufteilung kommt aus COUNT(*) FILTER.
    const current = series.buckets.find((entry) => entry.start === hour.toISOString())!;
    expect(current).toMatchObject({ total: 3, succeeded: 2, failed: 1 });
    expect(current.actions["project_auth.signup.succeeded"]).toBe(1);
    expect(current.actions["project_auth.login.succeeded"]).toBe(1);
    expect(current.actions["project_auth.login.failed"]).toBe(1);
    expect(current.actions.other).toBe(0);
    expect(series.totals).toMatchObject({ total: 3, succeeded: 2, failed: 1 });
    // Jede andere Stunde ist Null, nicht abwesend.
    expect(series.buckets.filter((entry) => entry.total > 0)).toHaveLength(1);
    // `date_trunc` hat in UTC geschnitten: jede Eimergrenze eine volle Stunde.
    for (const entry of series.buckets) expect(entry.start.endsWith(":00:00.000Z")).toBe(true);

    // Die Fenstergrenze steckt in der Abfrage, nicht in JavaScript. 47
    // Stunden spaeter liegen die Zeilen genau im ersten Eimer des Fensters,
    // 48 Stunden spaeter liegen sie eine Stunde davor und zaehlen nirgends.
    const edgeIn = await read("hour", new Date(written.getTime() + 47 * 3_600_000));
    expect(edgeIn.buckets[0].start).toBe(hour.toISOString());
    expect(edgeIn.buckets[0]).toMatchObject({ total: 3, succeeded: 2, failed: 1 });
    expect(edgeIn.totals.total).toBe(3);
    const edgeOut = await read("hour", new Date(written.getTime() + 48 * 3_600_000));
    expect(new Date(edgeOut.windowStart).getTime()).toBe(hour.getTime() + 3_600_000);
    expect(edgeOut.totals).toMatchObject({ total: 0, succeeded: 0, failed: 0 });
    expect(edgeOut.buckets.every((entry) => entry.total === 0)).toBe(true);

    // Dieselben Zeilen in Tageseimern: ein anderes Fenster, dieselbe Summe.
    const daily = await read("day", written);
    expect(daily.bucketCount).toBe(90);
    expect(daily.totals).toMatchObject({ total: 3, succeeded: 2, failed: 1 });
    for (const entry of daily.buckets) expect(entry.start.endsWith("T00:00:00.000Z")).toBe(true);

    // Der Kern des Falls: Die Reihe traegt Zahlen und Zeitpunkte, sonst
    // nichts. Kein "@", keine Referenz, kein Token, kein Kettenhash.
    for (const answer of [series, edgeIn, edgeOut, daily]) {
      const serialised = JSON.stringify(answer);
      expect(serialised).not.toContain("@");
      expect(serialised).not.toContain(appUser);
      expect(serialised).not.toContain("project_auth_user");
      expect(serialised).not.toMatch(/qk_|entry_hash/);
    }
    // Ohne eigenes Zeitbudget: drei Eintraege, ein Auszug und vier Aggregationen.
  });

  it("(2.52) refuses a usable session without the second factor when the project requires it", async () => {
    // Der tragende Teil dieses Slices gegen die echte Datenbank: Steht der
    // Schalter der Umgebung auf "verlangt", darf keine Anmeldung ohne
    // zweiten Faktor eine brauchbare Sitzung ergeben — und ein Nutzer ohne
    // Faktor muss trotzdem an die Einrichtung kommen, sonst sperrte das
    // Einschalten jeden aus.
    //
    // Echt ist hier alles, worauf es ankommt: das PostgreSQL-Repository, der
    // Audit-Sink in der Hash-Kette, der Argon2-Hasher, der Ed25519-Signierer
    // und TOTP. Nur die Uhr und die Zustellung sind fest; beide gehoeren
    // nicht zur Aussage.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.35, 2.42, 2.45 und
    // 2.47: Das Aendern des Schalters schreibt eine Audit-Zeile, und eine
    // Organisation mit Audit-Zeilen laesst sich wegen
    // audit_logs_organization_id_fkey nicht mehr loeschen; das gemeinsame
    // afterAll muss organizationA und organizationB loswerden. Weggeraeumt
    // wird darum nur, was das Produkt selbst loescht: der App-Nutzer.
    const mfaOwner = randomUUID();
    const mfaOrganization = randomUUID();
    const mfaProject = randomUUID();
    const scope = { organizationId: mfaOrganization, projectId: mfaProject, environment: "development" as const };
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [mfaOwner, `auth-mfa-owner-${mfaOwner}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Auth MFA', $2, $3)`, [mfaOrganization, `auth-mfa-${mfaOrganization}`, mfaOwner]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Auth MFA', $3, 'test', 'ready', $4)`,
    [mfaProject, mfaOrganization, `auth-mfa-${mfaProject}`, mfaOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [mfaOrganization, mfaProject, `managed:${mfaProject}`]);

    const at = new Date("2026-09-26T12:00:00.000Z");
    const { privateKey } = generateKeyPairSync("ed25519");
    const service = new ProjectAuthService({
      repository: new PostgresProjectAuthRepository(auth),
      audit: new PostgresProjectAuthAuditSink(auth),
      passwords: new Argon2idPasswordHasher({}),
      rateLimiter: new InMemoryRateLimiter(),
      tokens: new ProjectAuthTokenService({ kid: "certification-2-52", privateKey }, "https://qkern.test"),
      mfa: new ProjectAuthTotp(),
      secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 5)),
      delivery: new NoopDevelopmentProjectAuthDelivery(),
      oidcCatalog: new ProjectAuthOidcCatalog([]),
      oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
      callbackBaseUrl: "https://qkern.test",
      allowedRedirectOrigins: new Set(["https://app.test"]),
      exposeDeliveryTokens: true,
      now: () => new Date(at),
    });
    const email = `app-${randomUUID()}@example.test`;
    const password = "a sufficiently long certification password";

    // Ohne Schalter: eine gewoehnliche aal1-Sitzung, und sie gilt.
    const signup = await service.signUp(scope, {
      email, password, redirectTo: "https://app.test/callback", rateLimitKey: randomUUID(),
    });
    const first = await service.consumeEmailToken(scope, {
      token: signup.debugToken!, purpose: "email_verification",
    });
    if ("mfaRequired" in first) throw new Error("unexpected MFA");
    const principal = await service.verifyAccess(scope, first.accessToken);
    expect(principal.claims.aal).toBe("aal1");

    // Der Schalter, ueber den echten Dienst und in die echte Tabelle.
    const policy = await service.setMfaRequired(scope, true, { id: mfaOwner });
    expect(policy).toMatchObject({ required: true, users: 1, enrolled: 0, notEnrolled: 1 });
    const stored = await auth.query<{ mfa_required: boolean }>(
      `SELECT mfa_required FROM project_auth_settings
       WHERE organization_id = $1 AND project_id = $2 AND environment = 'development'`,
      [mfaOrganization, mfaProject],
    );
    expect(stored.rows).toEqual([{ mfa_required: true }]);

    // Die bestehende aal1-Sitzung hoert auf zu gelten — an der Pruefung des
    // Access Tokens und am Erneuern, und das Erneuern widerruft die Familie
    // in der Datenbank, nicht nur im Speicher.
    await expect(service.verifyAccess(scope, first.accessToken)).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    await expect(service.refresh(scope, first.refreshToken)).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    const revoked = await auth.query<{ revoked: boolean }>(
      `SELECT revoked_at IS NOT NULL AS revoked FROM project_auth_sessions
       WHERE organization_id = $1 AND project_id = $2 AND environment = 'development' AND id = $3`,
      [mfaOrganization, mfaProject, principal.session.id],
    );
    expect(revoked.rows).toEqual([{ revoked: true }]);

    // Eine neue Anmeldung mit richtigem Passwort ergibt keine Sitzung,
    // sondern einen Einrichtungsschein. Der Beweis steht in der Tabelle:
    // keine einzige lebende Sitzung dieses Nutzers.
    const blocked = await service.passwordSignIn(scope, { email, password, rateLimitKey: randomUUID() });
    if (!("enrollmentRequired" in blocked)) throw new Error("expected an enrolment grant");
    expect(blocked).toMatchObject({ mfaRequired: true, enrollmentRequired: true });
    expect(blocked).not.toHaveProperty("accessToken");
    const live = async () => (await auth.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM project_auth_sessions
       WHERE organization_id = $1 AND project_id = $2 AND environment = 'development'
         AND auth_user_id = $3 AND revoked_at IS NULL AND compromised_at IS NULL`,
      [mfaOrganization, mfaProject, principal.user.id],
    )).rows[0].count;
    expect(await live()).toBe("0");

    // Und trotzdem kommt er an die Einrichtung: Der Schein loest auf, das
    // Geheimnis entsteht, ein echter TOTP-Code bestaetigt es.
    const grant = await service.resolveMfaEnrollment(scope, blocked.enrollmentToken);
    expect(grant.user.id).toBe(principal.user.id);
    const enrollment = await service.enrollMfa(grant);
    expect(enrollment.recoveryCodes).toHaveLength(10);
    await expect(service.confirmMfa(grant, certificationTotp(enrollment.secret, at)))
      .resolves.toEqual({ verified: true });
    // Der Schein ist verbraucht; ein zweites Mal oeffnet er nichts.
    await expect(service.resolveMfaEnrollment(scope, blocked.enrollmentToken))
      .rejects.toMatchObject({ code: "INVALID_TOKEN" });
    // Bis hierher ist immer noch keine Sitzung entstanden.
    expect(await live()).toBe("0");

    // Jetzt, und erst jetzt, endet die Anmeldung in einer brauchbaren
    // Sitzung — und die traegt aal2.
    const challenge = await service.passwordSignIn(scope, { email, password, rateLimitKey: randomUUID() });
    if (!("challengeToken" in challenge)) throw new Error("expected a challenge");
    const session = await service.verifyMfaChallenge(scope, {
      challengeToken: challenge.challengeToken, code: certificationTotp(enrollment.secret, at),
      rateLimitKey: randomUUID(),
    });
    expect((await service.verifyAccess(scope, session.accessToken)).claims.aal).toBe("aal2");
    expect(await live()).toBe("1");
    const rotated = await service.refresh(scope, session.refreshToken);
    expect((await service.verifyAccess(scope, rotated.accessToken)).claims.aal).toBe("aal2");

    // Die Aenderung des Schalters steht in der Hash-Kette, mit dem neuen
    // Zustand und ohne Adresse.
    const page = await service.listAuditEvents(scope, 50);
    const changed = page.events.filter((event) => event.action === "project_auth.mfa.enforcement_changed");
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({
      actorType: "admin", actorRef: mfaOwner, status: "succeeded",
      resourceRef: "project_auth_environment:development", metadata: { required: true },
    });
    expect(JSON.stringify(page.events)).not.toContain("@");
    expect(JSON.stringify(page.events)).not.toMatch(/qk_/);

    // Aufgeraeumt wird nur, was das Produkt loescht: der App-Nutzer. Seine
    // Sitzungen, Token und sein Faktor haengen per ON DELETE CASCADE daran.
    // Organisation, Projekt und Umgebung bleiben, weil an ihnen Audit-Zeilen
    // haengen; audit_logs ist append-only.
    await owner.query("DELETE FROM project_auth_users WHERE id = $1", [principal.user.id]);
    expect(await live()).toBe("0");
  });


  it("(2.54) refuses a return target outside the allowed list of the project", async () => {
    // Der tragende Teil dieses Slices gegen die echte Datenbank: Die Liste
    // der Projektumgebung verengt die aeussere Grenze des Betriebs, und
    // zwar dort, wo ein Ruecksprungziel wirklich angenommen wird — im
    // Anmeldedienst, bevor ein Token entsteht oder eine Mail hinausgeht.
    //
    // Echt ist hier alles, worauf es ankommt: das PostgreSQL-Repository mit
    // der Spalte aus 0050, der Audit-Sink in der Hash-Kette, der
    // Argon2-Hasher und der Ed25519-Signierer. Nur die Uhr und die
    // Zustellung sind fest; beide gehoeren nicht zur Aussage.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.35, 2.45, 2.50 und
    // 2.52: Das Aendern der Liste schreibt eine Audit-Zeile, und eine
    // Organisation mit Audit-Zeilen laesst sich wegen
    // audit_logs_organization_id_fkey nicht mehr loeschen; das gemeinsame
    // afterAll muss organizationA und organizationB loswerden. Weggeraeumt
    // wird darum nur, was das Produkt selbst loescht: der App-Nutzer.
    const targetOwner = randomUUID();
    const targetOrganization = randomUUID();
    const targetProject = randomUUID();
    const scope = {
      organizationId: targetOrganization, projectId: targetProject, environment: "development" as const,
    };
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [targetOwner, `auth-targets-owner-${targetOwner}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Auth Targets', $2, $3)`,
    [targetOrganization, `auth-targets-${targetOrganization}`, targetOwner]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Auth Targets', $3, 'test', 'ready', $4)`,
    [targetProject, targetOrganization, `auth-targets-${targetProject}`, targetOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [targetOrganization, targetProject, `managed:${targetProject}`]);

    const at = new Date("2026-09-26T12:00:00.000Z");
    const { privateKey } = generateKeyPairSync("ed25519");
    // Die aeussere Grenze des Betriebs: zwei Herkuenfte, wie sie
    // QKERN_PROJECT_AUTH_REDIRECT_ORIGINS beim Start ergeben haette.
    const outerBound = new Set(["https://app.test", "https://admin.app.test"]);
    const service = new ProjectAuthService({
      repository: new PostgresProjectAuthRepository(auth),
      audit: new PostgresProjectAuthAuditSink(auth),
      passwords: new Argon2idPasswordHasher({}),
      rateLimiter: new InMemoryRateLimiter(),
      tokens: new ProjectAuthTokenService({ kid: "certification-2-54", privateKey }, "https://qkern.test"),
      mfa: new ProjectAuthTotp(),
      secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 9)),
      delivery: new NoopDevelopmentProjectAuthDelivery(),
      // Ein echter Provider im Katalog, damit startOidc wirklich bis zur
      // Pruefung des Ruecksprungziels kommt; das Netz wird dabei nicht
      // beruehrt, startOidc baut nur eine Adresse.
      oidcCatalog: new ProjectAuthOidcCatalog([{
        id: "certification", issuer: "https://idp.test",
        authorizationEndpoint: "https://idp.test/auth", tokenEndpoint: "https://idp.test/token",
        jwksUri: "https://idp.test/keys", clientId: "qkern-certification", scopes: ["openid", "email"],
      }]),
      oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
      callbackBaseUrl: "https://qkern.test",
      allowedRedirectOrigins: outerBound,
      exposeDeliveryTokens: true,
      now: () => new Date(at),
    });
    const password = "a sufficiently long certification password";
    const signUp = (redirectTo: string) => service.signUp(scope, {
      email: `app-${randomUUID()}@example.test`, password, redirectTo, rateLimitKey: randomUUID(),
    });

    // Ohne Zeile in project_auth_settings verengt die Umgebung nichts:
    // beide Herkuenfte der aeusseren Grenze gehen, eine fremde nicht.
    expect(await service.readReturnTargets(scope)).toMatchObject({
      targets: [], outerBound: [...outerBound], effective: [...outerBound], updatedAt: null,
    });
    const first = await signUp("https://admin.app.test/willkommen");
    expect(first.accepted).toBe(true);
    await expect(signUp("https://attacker.test/")).rejects.toMatchObject({ code: "INVALID_INPUT" });

    // Die Verengung, ueber den echten Dienst und in die echte Spalte.
    const narrowed = await service.setReturnTargets(scope, ["https://app.test"], { id: targetOwner });
    expect(narrowed).toMatchObject({
      targets: ["https://app.test"], outerBound: [...outerBound], effective: ["https://app.test"],
    });
    const stored = await auth.query<{ redirect_allow_list: string[] }>(
      `SELECT redirect_allow_list FROM project_auth_settings
       WHERE organization_id = $1 AND project_id = $2 AND environment = 'development'`,
      [targetOrganization, targetProject],
    );
    expect(stored.rows).toEqual([{ redirect_allow_list: ["https://app.test"] }]);

    // Und jetzt der Satz, um den es geht: Ein Ziel ausserhalb der Liste
    // wird abgewiesen, obwohl der Betrieb es erlaubt.
    await expect(signUp("https://admin.app.test/willkommen"))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    // Der Beweis steht in der Datenbank: Die abgewiesene Anmeldung hat
    // weder einen Nutzer noch ein Aktionstoken hinterlassen.
    const users = await auth.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM project_auth_users
       WHERE organization_id = $1 AND project_id = $2 AND environment = 'development'`,
      [targetOrganization, targetProject],
    );
    expect(users.rows[0].count).toBe("1");

    // Alle vier Wege, die ein Ruecksprungziel annehmen, gehen durch
    // dieselbe Pruefung — und alle vier weisen dieselbe Herkunft ab.
    const outside = "https://admin.app.test/willkommen";
    await expect(service.requestMagicLink(scope, {
      email: `app-${randomUUID()}@example.test`, redirectTo: outside, rateLimitKey: randomUUID(),
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.requestPasswordReset(scope, {
      email: `app-${randomUUID()}@example.test`, redirectTo: outside, rateLimitKey: randomUUID(),
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.startOidc(scope, {
      provider: "certification", redirectTo: outside, rateLimitKey: randomUUID(),
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });

    // Was auf der Liste steht, geht weiterhin — die Verengung sperrt nicht
    // alles aus, sie sperrt genau das Uebrige aus.
    expect((await signUp("https://app.test/willkommen")).accepted).toBe(true);
    // Und jede Form, die keine reine Herkunft ist, geht an keiner Stelle.
    for (const hostile of [
      "https://app.test.attacker.test/", "https://user:secret@app.test/", "http://app.test/",
      "javascript:alert(1)", "https://app.test/willkommen#token",
    ]) {
      await expect(signUp(hostile), hostile).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }

    // Weiten kann die Liste nicht: Was die aeussere Grenze nie hatte, kommt
    // auch mit einem Schreibzugriff nicht hinein — mit Grund, und ohne dass
    // sich die gespeicherte Zeile bewegt.
    await expect(service.setReturnTargets(scope, ["https://attacker.test"], { id: targetOwner }))
      .rejects.toMatchObject({ reason: "outside_outer_bound", value: "https://attacker.test" });
    const unchanged = await auth.query<{ redirect_allow_list: string[] }>(
      `SELECT redirect_allow_list FROM project_auth_settings
       WHERE organization_id = $1 AND project_id = $2 AND environment = 'development'`,
      [targetOrganization, targetProject],
    );
    expect(unchanged.rows).toEqual([{ redirect_allow_list: ["https://app.test"] }]);

    // Der Schalter aus 2.52 und die Liste aus 2.54 teilen sich eine Zeile,
    // fassen einander aber nicht an.
    await service.setMfaRequired(scope, true, { id: targetOwner });
    expect(await service.readReturnTargets(scope)).toMatchObject({ targets: ["https://app.test"] });
    const both = await auth.query<{ mfa_required: boolean; redirect_allow_list: string[] }>(
      `SELECT mfa_required, redirect_allow_list FROM project_auth_settings
       WHERE organization_id = $1 AND project_id = $2 AND environment = 'development'`,
      [targetOrganization, targetProject],
    );
    expect(both.rows).toEqual([{ mfa_required: true, redirect_allow_list: ["https://app.test"] }]);

    // Leeren nimmt die Verengung wieder weg; das ist kein Weiten, sondern
    // die Rueckkehr auf die aeussere Grenze.
    expect(await service.setReturnTargets(scope, [], { id: targetOwner }))
      .toMatchObject({ targets: [], effective: [...outerBound] });

    // Jede Aenderung steht in der Hash-Kette, mit der Anzahl danach und
    // ohne Adresse und ohne Herkunft.
    const page = await service.listAuditEvents(scope, 50);
    const changed = page.events.filter((event) => event.action === "project_auth.return_targets.changed");
    expect(changed).toHaveLength(2);
    expect(changed[0]).toMatchObject({
      actorType: "admin", actorRef: targetOwner, status: "succeeded",
      resourceRef: "project_auth_environment:development", metadata: { count: 0 },
    });
    expect(changed[1].metadata).toEqual({ count: 1 });
    expect(JSON.stringify(changed)).not.toContain("@");
    expect(JSON.stringify(changed)).not.toContain("app.test");

    // Aufgeraeumt wird nur, was das Produkt loescht: die App-Nutzer. Ihre
    // Token haengen per ON DELETE CASCADE daran. Organisation, Projekt und
    // Umgebung bleiben, weil an ihnen Audit-Zeilen haengen; audit_logs ist
    // append-only.
    await owner.query(`DELETE FROM project_auth_users
      WHERE organization_id = $1 AND project_id = $2`, [targetOrganization, targetProject]);
  });

  it("(2.56) refuses the login attempt that crosses the limit and lets the next window through", async () => {
    // Der tragende Teil dieses Slices gegen die echte Datenbank, und zwar an
    // der Stelle, an der er vor 2.56 falsch war: **zwei Dienstinstanzen an
    // einer Datenbank**. Ein Zaehler im Prozessspeicher haette jeder von
    // beiden ihre eigenen Versuche gegeben, also in Wahrheit das Doppelte der
    // eingestellten Grenze. Hier zaehlt PostgreSQL, und darum ist die Summe
    // beider Instanzen die Grenze.
    //
    // Echt ist alles, worauf es ankommt: zwei PostgreSQL-Repositorien am
    // selben Pool, der Audit-Sink in der Hash-Kette, der Argon2-Hasher und
    // der Ed25519-Signierer. Fest sind nur die Uhr und die Zustellung; die
    // Uhr ist hier sogar noetig, weil der Fensterwechsel die zweite Haelfte
    // der Aussage ist und nicht 15 Minuten dauern darf.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.35, 2.45, 2.52 und
    // 2.54: Das Setzen der Grenzen und jede greifende Grenze schreiben eine
    // Audit-Zeile, und eine Organisation mit Audit-Zeilen laesst sich wegen
    // audit_logs_organization_id_fkey nicht mehr loeschen; das gemeinsame
    // afterAll muss organizationA und organizationB loswerden. Weggeraeumt
    // wird darum nur, was das Produkt selbst loescht: der App-Nutzer.
    const rateOwner = randomUUID();
    const rateOrganization = randomUUID();
    const rateProject = randomUUID();
    const scope = {
      organizationId: rateOrganization, projectId: rateProject, environment: "development" as const,
    };
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [rateOwner, `auth-rate-owner-${rateOwner}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Auth Rate Limits', $2, $3)`,
    [rateOrganization, `auth-rate-${rateOrganization}`, rateOwner]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Auth Rate Limits', $3, 'test', 'ready', $4)`,
    [rateProject, rateOrganization, `auth-rate-${rateProject}`, rateOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [rateOrganization, rateProject, `managed:${rateProject}`]);

    // Eine Uhr, die beide Instanzen teilen — im Betrieb waere das die echte
    // Zeit, und die teilen sie auch.
    let at = new Date("2026-09-26T12:00:00.000Z");
    const { privateKey } = generateKeyPairSync("ed25519");
    // Zwei Instanzen. Jede hat ihr **eigenes** Repository-Objekt, ihren
    // eigenen Token-Dienst und ihren eigenen Zaehler im Prozessspeicher —
    // gemeinsam ist allein die Datenbank. Genau so steht es im Betrieb
    // hinter einem Lastverteiler.
    const instance = (label: string) => new ProjectAuthService({
      repository: new PostgresProjectAuthRepository(auth),
      audit: new PostgresProjectAuthAuditSink(auth),
      passwords: new Argon2idPasswordHasher({}),
      rateLimiter: new InMemoryRateLimiter(),
      tokens: new ProjectAuthTokenService({ kid: `certification-2-56-${label}`, privateKey }, "https://qkern.test"),
      mfa: new ProjectAuthTotp(),
      secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 9)),
      delivery: new NoopDevelopmentProjectAuthDelivery(),
      oidcCatalog: new ProjectAuthOidcCatalog([]),
      oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
      callbackBaseUrl: "https://qkern.test",
      allowedRedirectOrigins: new Set(["https://app.test"]),
      exposeDeliveryTokens: true,
      now: () => new Date(at),
    });
    const first = instance("a");
    const second = instance("b");

    // Ohne Zeile in project_auth_settings gelten die Vorgaben, und das ist
    // etwas anderes als "jemand hat sie eingetragen".
    expect(await first.readRateLimits(scope)).toMatchObject({
      limits: { sign_in: { max: 10, windowSeconds: 900 } }, configured: false, updatedAt: null,
    });

    const password = "a sufficiently long certification password";
    const email = `app-${randomUUID()}@example.test`;
    const signUp = await first.signUp(scope, {
      email, password, redirectTo: "https://app.test/willkommen", rateLimitKey: randomUUID(),
    });
    const verified = await second.consumeEmailToken(scope, {
      token: signUp.debugToken!, purpose: "email_verification",
    });
    if ("mfaRequired" in verified) throw new Error("unexpected MFA");

    // Die Grenze, ueber den echten Dienst und in die echten Spalten.
    const stored = await second.setRateLimits(scope, {
      sign_in: { max: 3, windowSeconds: 900 },
      mail: { max: 5, windowSeconds: 3600 },
      refresh: { max: 2, windowSeconds: 900 },
    }, { id: rateOwner });
    expect(stored).toMatchObject({ limits: { sign_in: { max: 3, windowSeconds: 900 } }, configured: true });
    const columns = await auth.query<{ sign_in_max: number; sign_in_window_seconds: number; refresh_max: number }>(
      `SELECT sign_in_max, sign_in_window_seconds, refresh_max FROM project_auth_settings
       WHERE organization_id = $1 AND project_id = $2 AND environment = 'development'`,
      [rateOrganization, rateProject],
    );
    expect(columns.rows).toEqual([{ sign_in_max: 3, sign_in_window_seconds: 900, refresh_max: 2 }]);

    // Und jetzt der Satz, um den es geht. Drei Fehlversuche, abwechselnd an
    // beiden Instanzen: einer unter der Grenze, einer darunter, einer genau
    // darauf. Alle drei kommen bis zur Passwortpruefung.
    for (const [attempt, service] of [[1, first], [2, second], [3, first]] as const) {
      await expect(service.passwordSignIn(scope, { email, password: "wrong", rateLimitKey: randomUUID() }), `attempt ${attempt}`)
        .rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
    // Der vierte ueberschreitet sie — an der **anderen** Instanz, die selbst
    // erst einen Versuch gesehen hat. Ihr eigener Prozesszaehler stuende bei
    // eins; die Datenbank steht bei vier, und die entscheidet.
    await expect(second.passwordSignIn(scope, { email, password, rateLimitKey: randomUUID() }))
      .rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 900 });

    // Dieselbe Antwort fuer eine Adresse, die es gar nicht gibt: aus einer
    // Abweisung laesst sich nicht lesen, ob das Konto existiert.
    const ghost = `ghost-${randomUUID()}@example.test`;
    for (const attempt of [1, 2, 3]) {
      await expect(first.passwordSignIn(scope, { email: ghost, password, rateLimitKey: randomUUID() }), `ghost ${attempt}`)
        .rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
    await expect(second.passwordSignIn(scope, { email: ghost, password, rateLimitKey: randomUUID() }))
      .rejects.toMatchObject({ code: "RATE_LIMITED" });

    // Der Beweis steht in der Zaehltabelle: der Stand vier, und nirgends eine
    // Adresse — nur ein SHA-256 in base64url.
    const signInHash = projectAuthRateSubjectHash({ ...scope, kind: "sign_in", subject: email });
    const counters = await auth.query<{ kind: string; subject_hash: string; attempts: number }>(
      `SELECT kind, subject_hash, attempts FROM project_auth_rate_counters
       WHERE organization_id = $1 AND project_id = $2 AND environment = 'development'
       ORDER BY kind, attempts DESC`,
      [rateOrganization, rateProject],
    );
    expect(counters.rows.find((row) => row.subject_hash === signInHash)?.attempts).toBe(4);
    for (const row of counters.rows) {
      expect(row.subject_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    expect(JSON.stringify(counters.rows)).not.toContain("@");
    expect(JSON.stringify(counters.rows)).not.toContain("example.test");

    // Und die zweite Haelfte: Das naechste Fenster laesst wieder durch, ohne
    // dass jemand etwas aufraeumen muesste.
    at = new Date("2026-09-26T12:15:00.000Z");
    const session = await second.passwordSignIn(scope, { email, password, rateLimitKey: randomUUID() });
    if ("mfaRequired" in session) throw new Error("unexpected MFA");
    expect(session.accessToken.length).toBeGreaterThan(20);
    // Dieselbe Anweisung, die hochzaehlt, hat die abgelaufene Zeile
    // desselben Schluessels weggeraeumt: hoechstens eine Zeile je Schluessel.
    const afterRollover = await auth.query<{ attempts: number; window_start: Date }>(
      `SELECT attempts, window_start FROM project_auth_rate_counters
       WHERE organization_id = $1 AND project_id = $2 AND environment = 'development'
         AND kind = 'sign_in' AND subject_hash = $3`,
      [rateOrganization, rateProject, signInHash],
    );
    expect(afterRollover.rows).toHaveLength(1);
    expect(afterRollover.rows[0].attempts).toBe(1);
    expect(new Date(afterRollover.rows[0].window_start).toISOString()).toBe("2026-09-26T12:15:00.000Z");

    // Die Erneuerung zaehlt nach der Sitzungsfamilie, und auch sie teilt sich
    // die Zaehlung ueber beide Instanzen.
    const refreshed = await first.refresh(scope, session.refreshToken);
    const again = await second.refresh(scope, refreshed.refreshToken);
    await expect(first.refresh(scope, again.refreshToken))
      .rejects.toMatchObject({ code: "RATE_LIMITED" });

    // Die Datenbank haelt die Raender selbst, nicht nur der Dienst.
    await expect(auth.query(
      `UPDATE project_auth_settings SET sign_in_max = 0
       WHERE organization_id = $1 AND project_id = $2 AND environment = 'development'`,
      [rateOrganization, rateProject],
    )).rejects.toBeInstanceOf(Error);

    // Der Schalter aus 2.52 und die Liste aus 2.54 teilen sich die Zeile mit
    // den Grenzen, fassen einander aber nicht an.
    await first.setMfaRequired(scope, true, { id: rateOwner });
    await first.setReturnTargets(scope, ["https://app.test"], { id: rateOwner });
    const shared = await auth.query<{ mfa_required: boolean; redirect_allow_list: string[]; sign_in_max: number }>(
      `SELECT mfa_required, redirect_allow_list, sign_in_max FROM project_auth_settings
       WHERE organization_id = $1 AND project_id = $2 AND environment = 'development'`,
      [rateOrganization, rateProject],
    );
    expect(shared.rows).toEqual([{
      mfa_required: true, redirect_allow_list: ["https://app.test"], sign_in_max: 3,
    }]);

    // Jede Aenderung und jede greifende Grenze stehen in der Hash-Kette, ohne
    // Adresse, ohne Schluessel und ohne Hash.
    const page = await first.listAuditEvents(scope, 100);
    const changed = page.events.filter((event) => event.action === "project_auth.rate_limits.changed");
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({
      actorType: "admin", actorRef: rateOwner, status: "succeeded",
      resourceRef: "project_auth_environment:development",
      metadata: { signInMax: 3, signInWindow: 900, refreshMax: 2, refreshWindow: 900 },
    });
    const blocked = page.events.filter((event) => event.action === "project_auth.rate_limit.blocked");
    expect(blocked.length).toBeGreaterThanOrEqual(3);
    expect(blocked.some((event) => event.metadata.kind === "sign_in" && event.metadata.max === 3)).toBe(true);
    expect(blocked.some((event) => event.metadata.kind === "refresh" && event.metadata.max === 2)).toBe(true);
    const serialised = JSON.stringify(blocked);
    expect(serialised).not.toContain("@");
    expect(serialised).not.toContain("example.test");
    expect(serialised).not.toContain(signInHash);

    // Aufgeraeumt wird nur, was das Produkt loescht: die App-Nutzer. Ihre
    // Token und Sitzungen haengen per ON DELETE CASCADE daran. Die Zeilen der
    // Zaehltabelle haengen an der Umgebung und nicht am Nutzer; sie bleiben
    // wie Organisation, Projekt und Umgebung stehen, an denen Audit-Zeilen
    // haengen — audit_logs ist append-only.
    await owner.query(`DELETE FROM project_auth_users
      WHERE organization_id = $1 AND project_id = $2`, [rateOrganization, rateProject]);
  });



  it("(2.57) proves the advisor rules that used to be unreachable", async () => {
    // Zwei Regeln, die es seit 2.39 und 2.40 gibt und die bis 2.56 nie liefen,
    // gegen die echte Datenbank -- jede mit dem Beleg, warum sie jetzt laufen
    // darf, ohne dass ein Geheimnis mitgeht.
    //
    // 1. `auth_provider_unverified_email`: Die Provider-Projektion nannte nur
    //    Slug und Issuer, also konnte die Regel nie sehen, ob ein Anbieter
    //    ohne `email_verified` zugelassen ist. Sie nennt jetzt zusaetzlich ein
    //    abgeleitetes `boolean`. Gelesen wird es hier aus dem echten
    //    Anmeldedienst mit dem echten PostgreSQL-Repository, nicht aus einem
    //    Nachbau.
    // 2. `slow_statement`: `pg_stat_statements` gilt fuer den ganzen Cluster,
    //    und ein Utility-Befehl behaelt seine Literale. Genau das stellt
    //    dieser Fall absichtlich her -- ein Marker steckt als Literal im Text
    //    eines Utility-Statements, und die Sicht traegt ihn nachweislich --
    //    und danach muss die ganze Antwort von `inspectStatements` frei davon
    //    sein. Gegen einen Fake waere das keine Aussage, weil der Fake den
    //    Text gar nicht erst hat.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.35, 2.45, 2.52 und 2.54:
    // Das gemeinsame afterAll muss organizationA und organizationB loswerden,
    // und dieser Fall soll ihm dabei nicht im Weg stehen. Weggeraeumt wird nur,
    // was das Produkt selbst loescht; Organisation, Projekt und Umgebung
    // bleiben stehen wie in 2.54.
    expect(projectApiUrl, "QKERN_TEST_PROJECT_API_DATABASE_URL fehlt").toBeTruthy();
    const advisorOwner = randomUUID();
    const advisorOrganization = randomUUID();
    const advisorProject = randomUUID();
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [advisorOwner, `advisor-2-57-owner-${advisorOwner}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Advisor 2.57', $2, $3)`,
    [advisorOrganization, `advisor-2-57-${advisorOrganization}`, advisorOwner]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Advisor 2.57', $3, 'test', 'ready', $4)`,
    [advisorProject, advisorOrganization, `advisor-2-57-${advisorProject}`, advisorOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [advisorOrganization, advisorProject, `managed:${advisorProject}`]);

    // --- Regel 1: der Anmeldeanbieter ohne E-Mail-Bestaetigung ---
    const { privateKey } = generateKeyPairSync("ed25519");
    const authService = new ProjectAuthService({
      repository: new PostgresProjectAuthRepository(auth),
      audit: new PostgresProjectAuthAuditSink(auth),
      passwords: new Argon2idPasswordHasher({}),
      rateLimiter: new InMemoryRateLimiter(),
      tokens: new ProjectAuthTokenService({ kid: "certification-2-57", privateKey }, "https://qkern.test"),
      mfa: new ProjectAuthTotp(),
      secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 7)),
      delivery: new NoopDevelopmentProjectAuthDelivery(),
      // Zwei echte Katalogeintraege: einer verlangt `email_verified` (die
      // Voreinstellung), einer ist als vertrauenswuerdig hinterlegt. Beide
      // tragen Client-ID, Endpunkte und Issuer -- genau das, was nicht
      // hinausgehen darf.
      oidcCatalog: new ProjectAuthOidcCatalog([
        {
          id: "strict", issuer: "https://strict-2-57.idp.test",
          authorizationEndpoint: "https://strict-2-57.idp.test/auth",
          tokenEndpoint: "https://strict-2-57.idp.test/token",
          jwksUri: "https://strict-2-57.idp.test/keys",
          clientId: "qkern-strict-secret-client", scopes: ["openid", "email"],
        },
        {
          id: "trusting", issuer: "https://trusting-2-57.idp.test",
          authorizationEndpoint: "https://trusting-2-57.idp.test/auth",
          tokenEndpoint: "https://trusting-2-57.idp.test/token",
          jwksUri: "https://trusting-2-57.idp.test/keys",
          clientId: "qkern-trusting-secret-client", scopes: ["openid", "email"],
          clientSecretEnv: "QKERN_OIDC_TRUSTING_SECRET",
          emailVerification: "trusted",
        },
      ]),
      oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
      callbackBaseUrl: "https://qkern.test",
      allowedRedirectOrigins: new Set(["https://app.test"]),
      now: () => new Date("2026-09-26T12:00:00.000Z"),
    });

    // Die Projektion selbst: drei Felder, und das dritte ist ein `boolean`.
    const projected = authService.listOidcProviders();
    expect(projected).toEqual([
      { id: "strict", issuer: "https://strict-2-57.idp.test", requiresVerifiedEmail: true },
      { id: "trusting", issuer: "https://trusting-2-57.idp.test", requiresVerifiedEmail: false },
    ]);
    for (const provider of projected) {
      expect(Object.keys(provider).sort()).toEqual(["id", "issuer", "requiresVerifiedEmail"]);
      expect(typeof provider.requiresVerifiedEmail).toBe("boolean");
    }
    // Weder die Client-ID noch der Name der Secret-Umgebungsvariablen stehen
    // darin; beide sind im Katalog, und beide bleiben drinnen.
    const projectedText = JSON.stringify(projected);
    expect(projectedText).not.toContain("secret-client");
    expect(projectedText).not.toContain("QKERN_OIDC_TRUSTING_SECRET");

    const securityResult = evaluateSecurityRules({
      environment: "development",
      now: new Date("2026-09-26T12:00:00.000Z"),
      database: { unavailable: "databaseDisabled" },
      storage: { unavailable: "storageDisabled" },
      apiKeys: { unavailable: "consoleOnly" },
      authProviders: { providers: projected.map((provider) => ({
        id: provider.id, requiresVerifiedEmail: provider.requiresVerifiedEmail,
      })) },
    });
    // Die Regel laeuft -- das ist der ganze Punkt -- und sie meldet genau den
    // einen Anbieter, der ohne `email_verified` auskommt.
    expect(securityResult.checks.find((check) => check.rule === "auth_provider_unverified_email"))
      .toEqual({ rule: "auth_provider_unverified_email", ran: true });
    expect(securityResult.findings.map((finding) => finding.id))
      .toEqual(["auth_provider_unverified_email:auth_provider:trusting"]);
    const securityText = JSON.stringify(securityResult);
    expect(securityText).not.toContain("idp.test");
    expect(securityText).not.toContain("secret-client");

    // --- Regel 2: das teure Statement, ohne seinen Text ---
    const marker = `statementprobe_${randomUUID().replaceAll("-", "_")}`;
    const projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
    try {
      // Ist die Erweiterung ueberhaupt da? Ohne sie hat dieser Teil nichts,
      // wogegen er laufen koennte, und ein stillschweigend gruener Fall waere
      // schlimmer als ein roter.
      const installed = await owner.query<{ present: boolean }>(
        "SELECT to_regclass('pg_stat_statements') IS NOT NULL AS present");
      expect(installed.rows[0]?.present,
        "pg_stat_statements fehlt; der Stack laedt sie ueber shared_preload_libraries").toBe(true);

      // Ein Utility-Befehl mit dem Marker im Text. `pg_stat_statements`
      // normalisiert Abfragen, aber keine Utility-Befehle: Der Name bleibt im
      // gespeicherten Text stehen. Genau das ist der Grund, aus dem 2.40 die
      // Sicht gar nicht erst gelesen hat.
      await owner.query(`CREATE SCHEMA "${marker}"`);
      await owner.query(`DROP SCHEMA "${marker}"`);
      // Und eine Abfrage der Leserolle selbst, damit mindestens eine Zeile mit
      // sichtbarer Kennung existiert: Ohne pg_read_all_stats zeigt PostgreSQL
      // fremde Zeilen ohne `queryid`.
      for (let round = 0; round < 3; round += 1) {
        await projectApi.query("SELECT count(*) FROM pg_catalog.pg_class WHERE oid > $1", [round]);
      }

      // Der Marker steht wirklich in der Sicht. Sonst waere die Zusage unten
      // geschenkt. Gefragt wird mit Parameter, damit der Abfragetext dieser
      // Pruefung selbst den Marker nicht traegt.
      const raw = await owner.query<{ hits: string }>(
        "SELECT count(*)::text AS hits FROM pg_stat_statements WHERE query LIKE $1", [`%${marker}%`]);
      expect(Number(raw.rows[0]?.hits ?? 0),
        "Die Sicht traegt den Marker nicht; dann prueft dieser Fall nichts.").toBeGreaterThan(0);

      const service = new ProjectDataPlaneService(
        { resolveTarget: async () => ({ databaseInstanceRef: "managed:certification" }) },
        { resolve: async () => ({
          pool: projectApi,
          expectedRole: "qkern_project_api_app",
          expectedDatabase: new URL(projectApiUrl!).pathname.slice(1),
          expectedLedgerOwner: "qkern",
        }) },
      );
      const digests = await service.inspectStatements(
        { organizationId: advisorOrganization, actorRef: "advisor-2-57@qkern.test" },
        { projectId: advisorProject, environment: "development" },
      );

      expect(digests.source).toBe("postgres");
      expect(digests.installed).toBe(true);
      expect(digests.statements.length).toBeGreaterThan(0);
      for (const digest of digests.statements) {
        // Drei Felder, und keines davon ist ein Text: eine Kennung aus
        // Ziffern und zwei Zaehler. Ein Abfragetext hat hier keine Stelle.
        expect(Object.keys(digest).sort()).toEqual(["calls", "id", "totalTimeMs"]);
        expect(digest.id).toMatch(/^-?[0-9]{1,20}$/);
        expect(Number.isInteger(digest.calls) && digest.calls > 0).toBe(true);
        expect(Number.isInteger(digest.totalTimeMs) && digest.totalTimeMs >= 0).toBe(true);
      }

      // Der Kern des Falls: kein Feld der ganzen Antwort traegt den Text
      // irgendeines Statements -- weder den Marker noch ein SQL-Wort.
      const serialised = JSON.stringify(digests);
      expect(serialised).not.toContain(marker);
      expect(serialised).not.toContain("statementprobe");
      expect(serialised.toLowerCase()).not.toContain("select");
      expect(serialised.toLowerCase()).not.toContain("schema");
      expect(serialised.toLowerCase()).not.toContain("pg_");

      // Und die Regel rechnet damit. Die Schwelle von 10 Sekunden erreicht
      // dieser Lauf nicht, darum zaehlt hier die Zusage, die zaehlbar ist:
      // Die Regel lief, und ohne Schwellenwert gibt es keinen Befund.
      const performance = evaluatePerformanceRules({
        statistics: { unavailable: "databaseDisabled" },
        statements: { entries: digests.statements.map((digest) => ({
          id: digest.id, calls: digest.calls, totalTimeMs: digest.totalTimeMs,
        })) },
      });
      expect(performance.checks.find((check) => check.rule === "slow_statement"))
        .toEqual({ rule: "slow_statement", ran: true });
      for (const finding of performance.findings) {
        expect(finding.object.kind).toBe("statement");
        expect(finding.object.name).toMatch(/^-?[0-9]{1,20}$/);
      }

      // Dieselbe Eingabe, nur mit einer Gesamtzeit ueber der Schwelle: Dann
      // gibt es einen Befund, und er nennt genau die Kennung.
      const expensive = digests.statements[0];
      const raised = evaluatePerformanceRules({
        statistics: { unavailable: "databaseDisabled" },
        statements: { entries: [{
          id: expensive.id, calls: expensive.calls,
          totalTimeMs: PERFORMANCE_THRESHOLDS.slowStatementMinTotalMs,
        }] },
      });
      expect(raised.findings.map((finding) => finding.id))
        .toEqual([`slow_statement:statement:${expensive.id}`]);
    } finally {
      await owner.query(`DROP SCHEMA IF EXISTS "${marker}" CASCADE`);
      await projectApi.end();
    }
  });

  it("(2.50) turns a real table change into a signed webhook delivery", async () => {
    // Der ganze Weg der Datenbank-Webhooks (2.50) an einem Stueck, und zwar an
    // dem Stueck, an dem er zerbrechen kann: Eine Zeile entsteht in einer
    // echten Projektdatenbank, der Trigger aus `db/project/0003` erfasst sie,
    // die Bruecke macht daraus eine wartende Zustellung in der echten Outbox,
    // der echte Zustellprozess holt sie und signiert mit einem Schluessel, den
    // ein echter HashiCorp Vault haelt. Nachgerechnet wird die Signatur am Ende
    // ohne den Produktcode, mit demselben Schluessel aus demselben Vault.
    //
    // Nachgebaut ist an diesem Weg nur der Empfaenger: Er nimmt die Anfrage
    // entgegen, statt sie ins Internet zu senden. Genau diese Stelle ist
    // ausserdem der Beleg dafuer, was **nicht** mitgeht -- die Zeile traegt
    // einen Wert, den niemand sehen darf, und er steht weder in der
    // gespeicherten Nutzlast noch im gesendeten Koerper.
    //
    // Der Stack: seit 2.50 laeuft im PostgreSQL-Stack auch ein Vault, weil
    // dieser Fall beides an einem Ort braucht. Der Vault-Stack hat keine
    // Datenbank; ein Fall, der die ganze Kette belegt, haette sonst nirgends
    // laufen koennen.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.35, 2.42, 2.45, 2.47 und
    // 2.49: Das gemeinsame afterAll muss organizationA und organizationB
    // loswerden, und eine Organisation, an der Audit-Zeilen haengen, laesst
    // sich wegen audit_logs_organization_id_fkey nicht mehr loeschen.
    // Abgeraeumt wird, was das Produkt hergibt: die Wegwerf-Projektdatenbank.
    expect(process.env.QKERN_TEST_ALLOW_DATABASE_CREATE_DROP,
      "QKERN_TEST_ALLOW_DATABASE_CREATE_DROP fehlt").toBe("true");
    expect(vaultKvUrl, "QKERN_TEST_VAULT_KV_URL fehlt").toBeTruthy();
    expect(vaultTokenFile, "QKERN_TEST_VAULT_TOKEN_FILE fehlt").toBeTruthy();
    expect(databaseWebhookSecretRef, "QKERN_TEST_DATABASE_WEBHOOK_SECRET_REF fehlt").toBeTruthy();

    const hookOwner = randomUUID();
    const hookOrganization = randomUUID();
    const projectId = randomUUID();
    const databaseName = `qkern_dbhook_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const table = `bestellungen_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const other = `fremde_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const rowId = randomUUID();
    // Ein Wert, der den Empfaenger nichts angeht. Er ist der Lackmustest.
    const confidential = `IBAN-CH93-${randomUUID()}`;

    const withDatabase = (base: string, name: string) => {
      const url = new URL(base);
      url.pathname = `/${name}`;
      return url.toString();
    };

    // Die Rollen sind clusterweit; ein zweiter Lauf im selben Cluster findet
    // sie vor, und das ist kein Fehler. `IF NOT EXISTS` vor `CREATE ROLE` ist
    // nicht atomar, der Ausnahmezweig schon. `db/project/0001` verlangt beide
    // Rollen und dass die Migrationsrolle den Ledger-Eigentuemer nicht erbt.
    await owner.query(`DO $$ BEGIN
      CREATE ROLE qkern_ledger_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
        NOREPLICATION NOBYPASSRLS;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await owner.query(`DO $$ BEGIN
      CREATE ROLE qkern_project_migrator LOGIN PASSWORD 'qkern_project_migrator_local_only'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    // Seit PostgreSQL 16 teilt `CREATE ROLE` die neue Rolle dem Erzeuger mit
    // ADMIN OPTION zu. Der Zaun verlangt einen Ledger-Eigentuemer ohne jede
    // Mitgliedschaft; aufgeraeumt wird deshalb hier, dieselbe Stelle wie im
    // Fall 2.49.
    await owner.query(`DO $$ DECLARE entry record; BEGIN
      FOR entry IN SELECT m.member::regrole::text AS role FROM pg_auth_members m
        WHERE m.roleid = 'qkern_ledger_owner'::regrole LOOP
        EXECUTE format('REVOKE qkern_ledger_owner FROM %I', entry.role);
      END LOOP;
      FOR entry IN SELECT m.roleid::regrole::text AS role FROM pg_auth_members m
        WHERE m.member = 'qkern_ledger_owner'::regrole LOOP
        EXECUTE format('REVOKE %I FROM qkern_ledger_owner', entry.role);
      END LOOP;
    END $$;`);

    await owner.query(`CREATE DATABASE "${databaseName}"`);
    let project: SqlPool | undefined;
    try {
      project = createPostgresPool({
        connectionString: withDatabase(ownerUrl!, databaseName), max: 2,
        statementTimeoutMillis: 120_000,
      });
      // Genau das, was der Provisioner taete: Ledger, Zaun und der echte
      // Change Feed -- die ausgelieferten Dateien, nicht Nachbauten.
      for (const file of ["0001_qkern_migration_ledger.sql", "0002_qkern_migration_fence.sql",
        "0003_qkern_change_feed.sql"]) {
        await project.query(await readFile(path.resolve(process.cwd(), "db/project", file), "utf8"));
      }
      // Die Tabelle des Kunden, mit der Aenderungserfassung angeschaltet. Das
      // ist derselbe Trigger, den Realtime benutzt; ein zweiter wird nicht
      // angelegt.
      await project.query(
        `CREATE TABLE public.${table} (id uuid PRIMARY KEY, iban text NOT NULL)`);
      await project.query(`CREATE TRIGGER ${table}_capture
        AFTER INSERT OR UPDATE OR DELETE ON public.${table}
        FOR EACH ROW EXECUTE FUNCTION qkern_internal.capture_change()`);
      // Eine zweite Tabelle mit demselben Trigger, aber ohne Kopplung. Ohne sie
      // bewiese der Fall nichts ueber den Tabellenfilter: Eine Bruecke, die
      // jede Tabelle des Projekts nimmt, saehe genauso aus wie eine, die nur
      // die genannte nimmt.
      await project.query(
        `CREATE TABLE public.${other} (id uuid PRIMARY KEY, iban text NOT NULL)`);
      await project.query(`CREATE TRIGGER ${other}_capture
        AFTER INSERT OR UPDATE OR DELETE ON public.${other}
        FOR EACH ROW EXECUTE FUNCTION qkern_internal.capture_change()`);

      await owner.query(`INSERT INTO users (id, email, password_hash, status)
        VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
      [hookOwner, `database-webhook-${hookOwner}@qkern.test`]);
      await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
        VALUES ($1, 'Database Webhooks', $2, $3)`,
      [hookOrganization, `database-webhooks-${hookOrganization}`, hookOwner]);
      await owner.query(`INSERT INTO organization_members
        (organization_id, user_id, role, is_personal_workspace)
        VALUES ($1, $2, 'owner', true)`, [hookOrganization, hookOwner]);
      await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
        VALUES ($1, $2, 'Database Webhooks', $3, 'test', 'ready', $4)`,
      [projectId, hookOrganization, `database-webhooks-${projectId}`, hookOwner]);
      await owner.query(`INSERT INTO project_environments
        (organization_id, project_id, environment, database_instance_ref)
        VALUES ($1, $2, 'development', $3)`,
      [hookOrganization, projectId, `managed:${projectId}`]);

      const control = new PostgresControlPlane(owner);
      const repository = new PostgresDatabaseWebhookRepository(control);
      const scope = {
        organizationId: hookOrganization, projectId, environment: "development" as const,
      };
      const principal = {
        organizationId: hookOrganization,
        actorRef: `database-webhook-${hookOwner}@qkern.test`,
        role: "admin" as const,
        subject: hookOwner,
      };

      // Die Definition ueber den echten Dienst, mit der echten Pruefung.
      const definition = await new DatabaseWebhookService({ repository }).create(principal, scope, {
        name: "bestellungen-an-erp",
        table,
        events: ["insert", "delete"],
        url: "https://empfaenger.example.com/hooks/qkern",
        signingSecretRef: databaseWebhookSecretRef!,
      });
      expect(definition.schema).toBe("public");
      expect(definition.eventTypes).toEqual(["db.insert", "db.delete"]);
      expect(definition.enabled).toBe(true);
      // Kein Geheimniswert, nirgends -- nur die Referenz.
      expect(JSON.stringify(definition)).not.toContain("secret\":\"");
      expect(definition.signingSecretRef).toBe(databaseWebhookSecretRef);

      // Die Aenderung. Ab hier macht der Trigger die Arbeit.
      await project.query(
        `INSERT INTO public.${table} (id, iban) VALUES ($1, $2)`, [rowId, confidential]);
      // Dieselbe Sorte Aenderung in der nicht gekoppelten Tabelle.
      await project.query(
        `INSERT INTO public.${other} (id, iban) VALUES ($1, $2)`, [randomUUID(), confidential]);
      const feed = await project.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM qkern_internal.change_feed WHERE table_name = $1`, [table]);
      expect(feed.rows[0]?.n, "der Trigger hat die Aenderung nicht erfasst").toBe("1");
      const otherFeed = await project.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM qkern_internal.change_feed WHERE table_name = $1`, [other]);
      expect(otherFeed.rows[0]?.n, "die zweite Tabelle wurde nicht erfasst").toBe("1");

      const resolvedProject = project;
      const outboxRepository = new PostgresWebhookOutboxRepository(control);
      const bridge = new DatabaseWebhookBridge({
        source: new PostgresRealtimeChangeSource({
          withProject: async (_scope, work) => work(resolvedProject),
        }),
        bindings: repository,
        outbox: new WebhookOutbox({ repository: outboxRepository }),
        scope,
      });
      expect(await bridge.poll(), "die Bruecke hat nichts eingereiht").toBe(1);

      // Der Beleg in der Control Plane: eine wartende Zustellung, und ihre
      // Nutzlast traegt genau das, was der Feed traegt.
      const pending = await owner.query<{
        event_type: string; status: string; payload: Record<string, unknown>;
      }>(`SELECT event_type, status, payload FROM project_webhook_deliveries
           WHERE organization_id = $1 AND project_id = $2`, [hookOrganization, projectId]);
      expect(pending.rows).toHaveLength(1);
      expect(pending.rows[0].event_type).toBe("db.insert");
      expect(pending.rows[0].status).toBe("pending");
      expect(Object.keys(pending.rows[0].payload).sort()).toEqual([
        "committedAt", "key", "operation", "position", "schema", "table",
      ]);
      expect(pending.rows[0].payload.key).toEqual({ id: rowId });
      expect(JSON.stringify(pending.rows[0].payload),
        "die Nutzlast traegt einen Spaltenwert, den der Empfaenger nie lesen duerfte")
        .not.toContain(confidential);

      // Der echte Zustellprozess mit dem echten Signierer und dem echten Vault.
      const secrets = new VaultWebhookSecretProvider({
        vaultKvUrl: new URL(vaultKvUrl!),
        tokenProvider: new VaultTokenFileProvider(vaultTokenFile!),
        cacheTtlMs: 0,
      });
      const sent: Array<{ headers: Record<string, string>; body: string; url: string }> = [];
      const runtime = new WebhookDeliveryRuntime({
        outbox: new WebhookOutbox({ repository: outboxRepository }),
        definitions: outboxRepository,
        deliverer: new WebhookDeliverer(new HmacWebhookSigner(secrets), {
          // Der Empfaenger ist die eine nachgebaute Stelle: Er bestaetigt die
          // Zustellung so, wie der Vertrag es verlangt, und haelt fest, was
          // wirklich gesendet wurde.
          send: async (request) => {
            sent.push({
              headers: { ...request.headers }, body: request.body, url: request.url,
            });
            return {
              status: 200,
              acknowledgementId: request.headers["x-qkern-delivery-id"] ?? null,
            };
          },
        }),
        scope,
        workerId: "certification-database-webhooks-1",
      });
      const result = await runtime.runOnce();
      expect(result, "der Zustellprozess hat nicht zugestellt")
        .toMatchObject({ delivered: 1, failed: 0, skipped: 0 });
      expect(sent).toHaveLength(1);

      const delivered = sent[0];
      expect(delivered.url).toBe("https://empfaenger.example.com/hooks/qkern");
      expect(delivered.headers["x-qkern-event"]).toBe("db.insert");
      expect(delivered.body).not.toContain(confidential);
      expect(delivered.body).toContain(rowId);

      // Die Gegenrechnung: der Schluessel aus dem Vault, die Pruefung ohne den
      // Signierer. Eine Signatur, die nur gegen sich selbst stimmt, waere
      // keine.
      const key = await secrets.resolve(databaseWebhookSecretRef!);
      expect(key, "der Vault haelt den Schluessel nicht").not.toBeNull();
      const signature = delivered.headers["x-qkern-signature"];
      expect(signature).toMatch(/^v1=[A-Za-z0-9_-]{43,128};key=[A-Za-z0-9._:-]{1,64}$/);
      const presented = signature.slice("v1=".length, signature.indexOf(";key="));
      expect(signature.endsWith(`;key=${key!.keyId}`)).toBe(true);
      expect(verifyWebhookSignature({
        secret: key!.secret,
        canonicalPayload: `${delivered.headers["x-qkern-timestamp"]}.${delivered.body}`,
        signature: presented,
      }), "die Signatur stimmt nicht mit dem Schluessel des Vaults").toBe(true);
      // Und sie stimmt nicht gegen einen anderen Koerper: Der Zeitstempel steht
      // **im** signierten Text, nicht nur im Header.
      expect(verifyWebhookSignature({
        secret: key!.secret,
        canonicalPayload: `${Number(delivered.headers["x-qkern-timestamp"]) + 1}.${delivered.body}`,
        signature: presented,
      })).toBe(false);

      const settled = await owner.query<{ status: string; attempt_count: number }>(
        `SELECT status, attempt_count FROM project_webhook_deliveries
          WHERE organization_id = $1 AND project_id = $2`, [hookOrganization, projectId]);
      expect(settled.rows[0]).toMatchObject({ status: "delivered", attempt_count: 1 });

      // Abgeschaltet erzeugt die Kopplung nichts Neues. Die zweite Aenderung
      // liegt im Feed und bleibt dort -- das ist der Unterschied zwischen
      // pausieren und stauen.
      await new DatabaseWebhookService({ repository })
        .setEnabled(principal, scope, definition.id, false);
      await project.query(`DELETE FROM public.${table} WHERE id = $1`, [rowId]);
      expect(await bridge.poll()).toBe(0);
      const afterDisable = await owner.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM project_webhook_deliveries
          WHERE organization_id = $1 AND project_id = $2`, [hookOrganization, projectId]);
      expect(afterDisable.rows[0]?.n).toBe("1");
    } finally {
      await Promise.allSettled([project?.end()]);
      await owner.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
        .catch(() => undefined);
    }
  });

  it("(2.55) lists function invocations with outcome and duration without the container output", async () => {
    // Das Aufrufprotokoll aus Migration 0045 an einem echten Server. Nur echt
    // zu belegen sind die Dinge, auf die es hier ankommt: die Formpruefung
    // `project_function_invocations_outcome_shape` (Status oder Fehlercode,
    // nie beides), die Sortierung und der Seitenschnitt in SQL, die Zaehlung
    // je Ausgang, die den Ausgangsfilter ignoriert, und die RLS der Tabelle.
    // Gegen einen Memory-Port waere davon nichts zu sehen.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.35, 2.45, 2.50 und 2.52:
    // Das gemeinsame afterAll muss organizationA und organizationB loswerden,
    // und eine Organisation mit unloeschbaren Zeilen darunter blockiert das.
    const logOwner = randomUUID();
    const logOrganization = randomUUID();
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [logOwner, `function-log-${logOwner}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Function Log', $2, $3)`, [logOrganization, `function-log-${logOrganization}`, logOwner]);
    const logProject = randomUUID();
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Function Log', $3, 'test', 'ready', $4)`,
    [logProject, logOrganization, `function-log-${logProject}`, logOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [logOrganization, logProject, `managed:${logProject}`]);

    const scope = {
      organizationId: logOrganization, projectId: logProject, environment: "development" as const,
    };
    const admin = {
      organizationId: logOrganization, actorRef: `function-log-${logOwner}@qkern.test`,
      role: "admin" as const, subject: logOwner,
    };
    const repository = new PostgresComputeDefinitionRepository(new PostgresControlPlane(runtime));
    const definitions = new ComputeDefinitionService({ repository });
    const image = `registry.example.com/qkern/probe@sha256:${"b".repeat(64)}`;
    const suffix = randomUUID().slice(0, 8);
    const green = await definitions.createFunction(admin, scope, {
      name: `log-green-${suffix}`, image, entrypoint: "handler.mjs",
      secretRefs: [], enabled: true,
    });
    const red = await definitions.createFunction(admin, scope, {
      name: `log-red-${suffix}`, image, entrypoint: "handler.mjs",
      secretRefs: [], enabled: true,
    });

    // Genau das, was ein Container drucken wuerde. Es darf nirgends im
    // Protokoll wieder auftauchen: 0045 speichert stdout und stderr nicht.
    const containerOutput = `stdout-${randomUUID()}`;
    const succeeding = new FunctionInvocationService({
      repository, invocationLog: repository,
      invoker: {
        async invoke() {
          return Object.freeze({ statusCode: 201, headers: {}, body: { printed: containerOutput } });
        },
      },
    });
    const failing = new FunctionInvocationService({
      repository, invocationLog: repository,
      invoker: { async invoke() { throw new FunctionInvocationError("FUNCTION_TIMEOUT"); } },
    });

    await succeeding.invoke(admin, scope, green.name, { probe: containerOutput });
    await succeeding.invoke(admin, scope, green.name, { probe: containerOutput });
    await expect(failing.invoke(admin, scope, red.name, { probe: containerOutput }))
      .rejects.toBeInstanceOf(FunctionInvocationError);

    const page = await definitions.readFunctionInvocationLog(admin, scope, { limit: 2, offset: 0 });
    expect(page.rows).toHaveLength(2);
    expect(page.limit).toBe(2);
    expect(page.offset).toBe(0);
    // Drei Aufrufe, zwei je Seite: Es gibt eine zweite Seite.
    expect(page.hasMore).toBe(true);
    // Die Zaehlung kommt aus der Datenbank, nicht aus den geladenen Zeilen.
    expect(page.counts).toEqual({ completed: 2, failed: 1 });

    // Die Formpruefung der Migration, an echten Zeilen: erfolgreich traegt
    // einen Status und keinen Fehlercode, fehlgeschlagen umgekehrt.
    for (const row of page.rows) {
      expect(row.durationMs, row.invocationId).toBeGreaterThanOrEqual(0);
      expect(row.invokedBy).toBe(admin.actorRef);
      if (row.outcome === "completed") {
        expect(row.statusCode).toBe(201);
        expect(row.errorCode).toBeNull();
      } else {
        expect(row.statusCode).toBeNull();
        expect(row.errorCode).toBe("FUNCTION_TIMEOUT");
      }
    }

    // Der Kern dieses Falls: Weder die Nutzlast noch die Ausgabe des
    // Containers steht irgendwo in der Antwort.
    expect(JSON.stringify(page)).not.toContain(containerOutput);

    const second = await definitions.readFunctionInvocationLog(admin, scope, { limit: 2, offset: 2 });
    expect(second.rows).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    // Keine Zeile steht auf beiden Seiten.
    expect(page.rows.map((row) => row.invocationId))
      .not.toContain(second.rows[0]?.invocationId);

    // Filter nach Ausgang: nur die gescheiterte Zeile, aber dieselbe Zaehlung.
    const failed = await definitions.readFunctionInvocationLog(admin, scope, { outcome: "failed" });
    expect(failed.rows.map((row) => row.outcome)).toEqual(["failed"]);
    expect(failed.rows[0]?.functionName).toBe(red.name);
    expect(failed.counts).toEqual({ completed: 2, failed: 1 });

    // Filter nach Function: die Zaehlung folgt diesem Filter.
    const onlyGreen = await definitions.readFunctionInvocationLog(admin, scope, { functionId: green.id });
    expect(onlyGreen.rows).toHaveLength(2);
    expect(onlyGreen.counts).toEqual({ completed: 2, failed: 0 });
    expect(new Set(onlyGreen.rows.map((row) => row.functionName))).toEqual(new Set([green.name]));
    // Neueste zuerst: Die Sortierung steht in SQL, nicht in JavaScript.
    const times = onlyGreen.rows.map((row) => Date.parse(row.startedAt));
    expect(times[0]).toBeGreaterThanOrEqual(times[1]);

    // Eine fremde Organisation sieht nichts, auch nicht ueber denselben Pool:
    // Die RLS von 0045 haengt an qkern_current_organization_id().
    const foreign = await definitions.readFunctionInvocationLog(
      { ...admin, organizationId: organizationA },
      { ...scope, organizationId: organizationA },
    );
    expect(foreign.rows).toEqual([]);
    expect(foreign.counts).toEqual({ completed: 0, failed: 0 });

    // Weggeraeumt wird nichts: `project_function_invocations` ist append-only
    // (0045 hat weder UPDATE- noch DELETE-Policy). Eigene Organisation,
    // eigenes Projekt, eigene Namen; der Wegwerf-Stack faellt nach dem Lauf
    // weg. Loeschen laesst das Produkt hier nur die Function selbst, und die
    // naehme ihr Protokoll mit; also bleibt beides stehen.
  });

  /**
   * Die Bruecke als **Prozess** (2.53).
   *
   * Der Fall (2.50) daneben belegt die Kette und ruft die Bruecke dabei selbst
   * auf: `await bridge.poll()`. Genau das ist der Unterschied, den dieser Fall
   * schliesst. Niemand ruft hier irgendetwas auf. Es laeuft `npm run
   * worker:compute` -- derselbe Prozess, den der Betrieb startet -- und die
   * Zustellung entsteht, weil er sie erzeugt.
   *
   * Belegt werden vier Dinge, die eine Bibliothek nicht belegen kann:
   *
   * 1. Der Prozess findet die Umgebung selbst. In der Konfiguration steht eine
   *    Scope-Liste, keine Kopplung; welche Umgebung gelesen wird, entscheidet
   *    er aus der Control Plane.
   * 2. Er haelt seine Position dauerhaft. Nach dem zweiten Start entsteht
   *    **keine** zweite Zustellung fuer dieselbe Aenderung, und die Aenderung
   *    aus der Pause geht nicht verloren -- kein Wiederholen, kein
   *    Ueberspringen.
   * 3. Er hoert auf dasselbe Signal wie die anderen Worker und endet sauber.
   * 4. Er ist danach wirklich aus: Eine Aenderung waehrend der Pause erzeugt
   *    nichts. Ein Fall, der nur das Ende des Kindprozesses prueft, koennte
   *    einen Prozess uebersehen, der weiterarbeitet.
   *
   * Eigene Organisation mit eigenem Besitzer, wie 2.35, 2.42, 2.45, 2.49 und
   * 2.50: Das gemeinsame afterAll muss organizationA und organizationB
   * loswerden, und eine Organisation mit Audit-Zeilen laesst sich wegen
   * audit_logs_organization_id_fkey nicht mehr loeschen. Abgeraeumt wird, was
   * das Produkt hergibt: die Wegwerf-Projektdatenbank.
   *
   * Das Zeitbudget ist ausdruecklich gross: Der Fall startet zweimal einen
   * echten Node-Prozess mit `tsx`, und jeder Start uebersetzt die Module neu.
   * Gewartet wird trotzdem nie blind -- jede Wartezeit hat eine Bedingung, eine
   * Frist und eine Meldung, die sagt, was stattdessen dastand.
   */
  it("(2.53) delivers a table change through the running bridge process", async () => {
    expect(process.env.QKERN_TEST_ALLOW_DATABASE_CREATE_DROP,
      "QKERN_TEST_ALLOW_DATABASE_CREATE_DROP fehlt").toBe("true");
    expect(projectApiUrl, "QKERN_TEST_PROJECT_API_DATABASE_URL fehlt").toBeTruthy();
    expect(vaultKvUrl, "QKERN_TEST_VAULT_KV_URL fehlt").toBeTruthy();
    expect(vaultTokenFile, "QKERN_TEST_VAULT_TOKEN_FILE fehlt").toBeTruthy();
    expect(databaseWebhookSecretRef, "QKERN_TEST_DATABASE_WEBHOOK_SECRET_REF fehlt").toBeTruthy();

    const bridgeOwner = randomUUID();
    const bridgeOrganization = randomUUID();
    const projectId = randomUUID();
    const databaseName = `qkern_bridge_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const table = `lieferungen_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const firstRow = randomUUID();
    const secondRow = randomUUID();
    const thirdRow = randomUUID();
    // Ein Wert, der den Empfaenger nichts angeht -- und der Beleg dafuer, dass
    // auch der laufende Prozess ihn nicht mitnimmt.
    const confidential = `IBAN-CH93-${randomUUID()}`;
    const scope = {
      organizationId: bridgeOrganization, projectId, environment: "development" as const,
    };

    const withDatabase = (base: string, name: string) => {
      const url = new URL(base);
      url.pathname = `/${name}`;
      return url.toString();
    };

    await owner.query(`DO $$ BEGIN
      CREATE ROLE qkern_ledger_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
        NOREPLICATION NOBYPASSRLS;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await owner.query(`DO $$ BEGIN
      CREATE ROLE qkern_project_migrator LOGIN PASSWORD 'qkern_project_migrator_local_only'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    // Wie im Fall 2.49 und 2.50: Seit PostgreSQL 16 teilt `CREATE ROLE` die
    // neue Rolle dem Erzeuger mit ADMIN OPTION zu, und der Zaun aus 0002
    // verlangt einen Ledger-Eigentuemer ohne jede Mitgliedschaft.
    await owner.query(`DO $$ DECLARE entry record; BEGIN
      FOR entry IN SELECT m.member::regrole::text AS role FROM pg_auth_members m
        WHERE m.roleid = 'qkern_ledger_owner'::regrole LOOP
        EXECUTE format('REVOKE qkern_ledger_owner FROM %I', entry.role);
      END LOOP;
      FOR entry IN SELECT m.roleid::regrole::text AS role FROM pg_auth_members m
        WHERE m.member = 'qkern_ledger_owner'::regrole LOOP
        EXECUTE format('REVOKE %I FROM qkern_ledger_owner', entry.role);
      END LOOP;
    END $$;`);

    await owner.query(`CREATE DATABASE "${databaseName}"`);
    let project: SqlPool | undefined;
    const children: ReturnType<typeof spawn>[] = [];
    try {
      project = createPostgresPool({
        connectionString: withDatabase(ownerUrl!, databaseName), max: 2,
        statementTimeoutMillis: 120_000,
      });
      for (const file of ["0001_qkern_migration_ledger.sql", "0002_qkern_migration_fence.sql",
        "0003_qkern_change_feed.sql"]) {
        await project.query(await readFile(path.resolve(process.cwd(), "db/project", file), "utf8"));
      }
      await project.query(
        `CREATE TABLE public.${table} (id uuid PRIMARY KEY, iban text NOT NULL)`);
      await project.query(`CREATE TRIGGER ${table}_capture
        AFTER INSERT OR UPDATE OR DELETE ON public.${table}
        FOR EACH ROW EXECUTE FUNCTION qkern_internal.capture_change()`);

      await owner.query(`INSERT INTO users (id, email, password_hash, status)
        VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
      [bridgeOwner, `bridge-process-${bridgeOwner}@qkern.test`]);
      await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
        VALUES ($1, 'Bridge Process', $2, $3)`,
      [bridgeOrganization, `bridge-process-${bridgeOrganization}`, bridgeOwner]);
      await owner.query(`INSERT INTO organization_members
        (organization_id, user_id, role, is_personal_workspace)
        VALUES ($1, $2, 'owner', true)`, [bridgeOrganization, bridgeOwner]);
      await owner.query(`INSERT INTO projects
        (id, organization_id, name, slug, region, status, created_by)
        VALUES ($1, $2, 'Bridge Process', $3, 'test', 'ready', $4)`,
      [projectId, bridgeOrganization, `bridge-process-${projectId}`, bridgeOwner]);
      await owner.query(`INSERT INTO project_environments
        (organization_id, project_id, environment, database_instance_ref)
        VALUES ($1, $2, 'development', $3)`,
      [bridgeOrganization, projectId, `managed:${projectId}`]);

      // Die Kopplung ueber den echten Dienst. Sie ist das Einzige, was dieser
      // Fall dem Prozess mitgibt -- seine Konfiguration nennt sie nicht.
      const repository = new PostgresDatabaseWebhookRepository(new PostgresControlPlane(owner));
      const definition = await new DatabaseWebhookService({ repository }).create({
        organizationId: bridgeOrganization,
        actorRef: `bridge-process-${bridgeOwner}@qkern.test`,
        role: "admin" as const,
        subject: bridgeOwner,
      }, scope, {
        name: "lieferungen-an-erp",
        table,
        events: ["insert"],
        url: "https://empfaenger.example.com/hooks/qkern",
        signingSecretRef: databaseWebhookSecretRef!,
      });
      expect(definition.enabled).toBe(true);

      /** Der ausgelieferte Prozess, nichts daneben. */
      const start = () => {
        const child = spawn(process.execPath, ["--import", "tsx", "workers/compute-runtime.mts"], {
          cwd: process.cwd(),
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            NODE_ENV: "test",
            QKERN_COMPUTE_RUNTIME_ENABLED: "true",
            // Cron aus: Dieser Fall misst die Bruecke, und ein Cron-Lauf
            // braeuchte eine Warteschlange, die hier nichts zu suchen hat.
            QKERN_COMPUTE_CRON_ENABLED: "false",
            QKERN_COMPUTE_WEBHOOKS_ENABLED: "true",
            QKERN_COMPUTE_DATABASE_WEBHOOKS_ENABLED: "true",
            QKERN_COMPUTE_DATABASE_WEBHOOK_POLL_MS: "200",
            QKERN_COMPUTE_DATABASE_WEBHOOK_DISCOVERY_MS: "1000",
            QKERN_COMPUTE_WORKER_ID: "certification-bridge-1",
            // Die Scope-Liste nennt die Umgebung, nicht die Kopplung. Welche
            // Umgebung ueberhaupt gelesen wird, entscheidet der Prozess.
            QKERN_COMPUTE_SCOPES_JSON: JSON.stringify([scope]),
            QKERN_RUNTIME_MODE: "postgres",
            QKERN_STATEMENT_ENCRYPTION_KEY: "0".repeat(64),
            QKERN_RUNTIME_DATABASE_URL: runtimeUrl!,
            // Derselbe Katalog wie bei Realtime Changes: dieselbe
            // unprivilegierte Rolle, der `db/project/0003` das Leserecht auf
            // dem Feed erteilt.
            QKERN_ALLOW_LOCAL_PROJECT_DATA_API_CATALOG: "true",
            QKERN_LOCAL_PROJECT_DATA_API_CATALOG_JSON: JSON.stringify([{
              databaseInstanceRef: `managed:${projectId}`,
              connectionString: withDatabase(projectApiUrl!, databaseName),
              expectedRole: "qkern_project_api_app",
              expectedDatabase: databaseName,
              expectedLedgerOwner: "qkern_ledger_owner",
            }]),
            QKERN_WEBHOOK_VAULT_KV_URL: vaultKvUrl!,
            QKERN_VAULT_TOKEN_FILE: vaultTokenFile!,
          },
        });
        let noise = "";
        child.stderr?.on("data", (chunk: Buffer) => { noise += chunk.toString(); });
        child.stdout?.on("data", (chunk: Buffer) => { noise += chunk.toString(); });
        children.push(child);
        return { child, output: () => noise };
      };

      const deliveries = async () => {
        const result = await owner.query<{
          event_type: string; payload: Record<string, unknown>;
        }>(`SELECT event_type, payload FROM project_webhook_deliveries
             WHERE organization_id = $1 AND project_id = $2
             ORDER BY (payload->>'position')::bigint`, [bridgeOrganization, projectId]);
        return result.rows;
      };

      /** Wartet auf eine Bedingung mit Frist und Diagnose, nie blind. */
      const until = async (
        what: string, budgetMs: number, condition: () => Promise<boolean>, diagnose: () => string,
      ) => {
        const deadline = Date.now() + budgetMs;
        while (Date.now() < deadline) {
          if (await condition()) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        expect.fail(`${what} blieb ${budgetMs} ms aus. ${diagnose()}`);
      };

      /** Beendet den Prozess ueber **das** Signal und wartet auf sein Ende. */
      const stop = async (runner: { child: ReturnType<typeof spawn>; output: () => string }) => {
        runner.child.kill("SIGTERM");
        const exit = await Promise.race([
          new Promise<number | null>((resolve) => runner.child.once("exit", resolve)),
          new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 30_000)),
        ]);
        expect(exit, `Der Prozess endete nicht auf SIGTERM: ${runner.output().slice(-800)}`)
          .not.toBe("timeout");
        return exit;
      };

      // --- Erster Lauf -------------------------------------------------------
      const first = start();
      await until("Die Startzeile des Prozesses", 120_000,
        async () => first.output().includes("database webhook bridge"),
        () => `Ausgabe: ${first.output().slice(-800)}`);

      await project.query(
        `INSERT INTO public.${table} (id, iban) VALUES ($1, $2)`, [firstRow, confidential]);

      await until("Die Zustellung aus dem laufenden Prozess", 90_000,
        async () => (await deliveries()).length >= 1,
        () => `Ausgabe: ${first.output().slice(-800)}`);

      const afterFirst = await deliveries();
      expect(afterFirst).toHaveLength(1);
      expect(afterFirst[0].event_type).toBe("db.insert");
      expect(afterFirst[0].payload.key).toEqual({ id: firstRow });
      expect(JSON.stringify(afterFirst[0].payload),
        "die Nutzlast traegt einen Spaltenwert, den der Empfaenger nie lesen duerfte")
        .not.toContain(confidential);
      // Die Position liegt dauerhaft in der Control Plane, nicht im Prozess.
      const cursor = await owner.query<{ position: string }>(
        `SELECT position::text FROM project_database_webhook_cursors
          WHERE organization_id = $1 AND project_id = $2 AND environment = 'development'`,
        [bridgeOrganization, projectId]);
      expect(Number(cursor.rows[0]?.position),
        "der Prozess hat seine Position nicht festgehalten").toBeGreaterThan(0);

      // --- Anhalten ----------------------------------------------------------
      expect(await stop(first)).toBe(0);

      // Und er ist wirklich aus: Eine Aenderung waehrend der Pause erzeugt
      // nichts. Ohne diese Probe pruefte der Fall nur das Ende eines
      // Kindprozesses, nicht das Ende seiner Arbeit.
      await project.query(
        `INSERT INTO public.${table} (id, iban) VALUES ($1, $2)`, [secondRow, confidential]);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect(await deliveries(),
        "der angehaltene Prozess hat weitergearbeitet").toHaveLength(1);

      // --- Zweiter Lauf: kein Wiederholen, kein Ueberspringen ----------------
      const second = start();
      await until("Die Startzeile des zweiten Prozesses", 120_000,
        async () => second.output().includes("database webhook bridge"),
        () => `Ausgabe: ${second.output().slice(-800)}`);

      await project.query(
        `INSERT INTO public.${table} (id, iban) VALUES ($1, $2)`, [thirdRow, confidential]);
      await until("Die beiden Zustellungen nach dem Neustart", 90_000,
        async () => (await deliveries()).length >= 3,
        () => `Ausgabe: ${second.output().slice(-800)}`);

      const afterSecond = await deliveries();
      // Genau drei: die erste aus dem ersten Lauf, die aus der Pause und die
      // nach dem Neustart. Eine vierte waere eine Wiederholung, zwei waeren
      // eine verlorene Aenderung.
      expect(afterSecond, `Ausgabe: ${second.output().slice(-800)}`).toHaveLength(3);
      expect(afterSecond.map((row) => (row.payload as { key: { id: string } }).key.id))
        .toEqual([firstRow, secondRow, thirdRow]);

      expect(await stop(second)).toBe(0);

      // Was der Prozess ueber sich meldet, ist redigiert: keine Verbindung,
      // kein Geheimnis, kein Tabellenname des Kunden.
      for (const runner of [first, second]) {
        expect(runner.output()).not.toContain(confidential);
        expect(runner.output()).not.toContain(databaseName);
        expect(runner.output()).not.toContain("qkern_project_api_local_only");
      }
    } finally {
      for (const child of children) child.kill("SIGKILL");
      await Promise.allSettled([project?.end()]);
      await owner.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
        .catch(() => undefined);
    }
    // 600 Sekunden: zwei echte Node-Starts mit `tsx`, jeder mit eigener
    // Uebersetzung der Module, dazu zwei bewusst grosszuegige Wartefristen.
    // Jede einzelne Wartezeit hat trotzdem ihre eigene, engere Frist.
  }, 600_000);
});

/**
 * TOTP wie RFC 6238, dieselbe Rechnung wie `ProjectAuthTotp`, nur von aussen:
 * Der Fall (2.52) muss einen echten Code vorzeigen, sonst pruefte er die
 * Bestaetigung des Faktors gar nicht.
 */
function certificationTotp(secret: string, now: Date): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const decoded: number[] = [];
  for (const character of secret) {
    value = (value << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) { decoded.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now.getTime() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(decoded)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}


/** Alle Teile ausser dem genannten erreichbar; nur die Datenbank wird echt geprobt. */
function healthyInput(overrides: Partial<HealthAdvisorInput>): HealthAdvisorInput {
  return {
    now: new Date("2026-09-26T12:00:00.000Z"),
    database: { tables: 0 },
    dataApi: { exposedTables: 2 },
    auth: { providers: 1, signingKeys: 1 },
    storage: { buckets: 1 },
    compute: { functions: 1, sandboxConfigured: true },
    queuesCron: { queues: 1, cronDefinitions: 1, cronStale: 0 },
    realtime: { configured: true },
    vault: { connected: true },
    ...overrides,
  };
}
