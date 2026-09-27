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
import { isProjectDataPlaneError, ProjectDataPlaneService } from "@/lib/server/data-plane/service";
import type { ProjectDatabaseHealthResult } from "@/lib/server/data-plane/service";
// Abfrage-Einblicke (2.69): der Plan laeuft durch den echten Dienst, das
// reine Modul flacht ihn ab.
import { hottestQueryPlanNode, QUERY_PLAN_HOT_SHARE } from "@/lib/console/query-insights";
// Was ein angemeldeter Nutzer darf (2.62): dasselbe reine Regelmodul, das die
// Route benutzt, und die echte generierte Data API als Gegenprobe.
import { evaluateAuthAccess } from "@/lib/server/data-plane/auth-access-rules";
import { GeneratedDataApiService } from "@/lib/server/data-plane/generated-api";
// Datenbank -> Replikation (2.74): dieselbe reine Ableitung, mit der die
// Ansicht aus Zustand und Konsument ihr Urteil ueber einen Slot macht.
import { SLOT_STATE_TEXTS, slotState } from "@/lib/console/replication-texts";
import { evaluateSecurityRules } from "@/lib/server/advisors/security-rules";
import { evaluatePerformanceRules } from "@/lib/server/advisors/performance-rules";
import { evaluateHealthRules, type HealthAdvisorInput } from "@/lib/server/advisors/health-rules";
import { probeDatabaseHealth } from "@/app/api/v1/projects/[projectId]/environments/[environment]/advisors/health/route";
import { PERFORMANCE_THRESHOLDS } from "@/lib/console/performance-advisor-texts";
// Die Seite Abfrage-Leistung (2.67): dieselben reinen Funktionen, mit denen
// die Ansicht aus den Zaehlern Anteil, Mittelwert und Zeilen je Aufruf macht.
import { duration, durationFromMilliseconds, rowsPerCall, timeShare } from "@/lib/console/query-performance-texts";
import { PostgresUsageRepository } from "@/lib/server/usage/postgres-repository";
import { UsageService } from "@/lib/server/usage/service";
// Der Tabellen-Designer (2.49): Generator, Control Plane, Apply-Dienst,
// Worker und Executor: jeder Teil des Weges als das, was er im Betrieb ist.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { AesGcmStatementCipher, sha256 } from "@/lib/server/control-plane/crypto";
import { PostgresControlPlaneService } from "@/lib/server/control-plane/postgres";
import { PostgresProjectStorageRepository } from "@/lib/server/project-storage/postgres-repository";
// S3-Zugang (2.78): echte Buckets ueber das Produkt-Repository, echte Ausgabe,
// echter Widerruf. Der Hash wird nachgerechnet, damit der Fall sagen kann, dass
// die Liste ihn nicht kennt.
import {
  hashS3AccessKeySecret,
  PostgresProjectStorageS3AccessKeyStore,
  ProjectStorageS3AccessKeyService,
} from "@/lib/server/project-storage/s3-access-keys";
import { PostgresChangeSetApplyService } from "@/lib/server/migrations/services";
import { PostgresMigrationQueue } from "@/lib/server/migrations/postgres-queue";
import { PostgresProjectDatabaseExecutor } from "@/lib/server/migrations/postgres-executor";
import { MigrationWorker } from "@/lib/server/migrations/worker";
import { createTableStatement, TableChangeSetError } from "@/lib/console/table-change-sets";
// Die Vorlagen des SQL-Editors (2.61): dieselbe reine Liste, die die Console
// anzeigt, durch denselben Lesepfad, den die Query-Route benutzt.
import { SQL_TEMPLATES, sqlTemplateStatement } from "@/lib/console/sql-templates";
import { PostgresProjectAuthAuditSink } from "@/lib/server/project-auth/audit-postgres";
// Auth -> Auth-Leistung (2.71): dieselben reinen Funktionen, mit denen die
// Ansicht aus der Reihe den Anteil und die Rangfolge der Fehlschlaege macht.
import { authFailureRanking, authFailureShare } from "@/lib/console/auth-performance";
import { PROJECT_AUTH_AUDIT_ACTION_IDS } from "@/lib/console/auth-observability-texts";
// Der erzwingbare zweite Faktor (2.52): echte Repository-, Audit- und
// Token-Teile hinter dem echten Dienst.
import { createHash, createHmac, createSign, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { NextRequest } from "next/server";
// Fremde Anbieter (2.80): der echte Weg, den jede Data-API-Route nimmt, und der
// echte Halter der Schluesselsaetze. Es gibt keinen zweiten Weg, ein fremdes
// Token in einen Aufrufer zu verwandeln, und der Fall benutzt darum auch keinen.
import { projectApplicationPrincipal } from "@/lib/server/data-plane/generated-http";
import { ProjectAuthThirdPartyKeySets } from "@/lib/server/project-auth/third-party-keys";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { Argon2idPasswordHasher } from "@/lib/server/auth/password";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import { PostgresProjectAuthRepository } from "@/lib/server/project-auth/postgres-repository";
import { ProjectAuthSecretProtector, ProjectAuthTotp } from "@/lib/server/project-auth/mfa";
import { ProjectAuthOidcCatalog, ProjectAuthOidcClient } from "@/lib/server/project-auth/oidc";
import { NoopDevelopmentProjectAuthDelivery, ProjectAuthService } from "@/lib/server/project-auth/service";
import { hashProjectAuthToken, ProjectAuthTokenService } from "@/lib/server/project-auth/tokens";
// Grenzen je Zeitfenster (2.56): dieselbe reine Formel, die der Dienst
// benutzt, damit der Fall den Hash nachrechnen kann statt ihn zu glauben.
import { projectAuthRateSubjectHash } from "@/lib/server/project-auth/rate-limits";
// Passwoerter gegen bekannte Lecks (2.53): dieselbe reine Formel und derselbe
// Lader, die der Dienst benutzt. Der Fall schreibt eine echte Listendatei und
// laedt sie durch den Lader, damit die Datei im Fall dieselbe Reise macht wie
// im Betrieb.
import {
  projectAuthBuiltInLeakList,
  projectAuthPasswordDigest,
  projectAuthPasswordIsLeaked,
  PROJECT_AUTH_BUILT_IN_LEAKED_PASSWORDS,
} from "@/lib/server/project-auth/password-leaks";
import { leakedPasswordListFromEnv } from "@/lib/server/project-auth/runtime";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
// Der Log-Explorer (2.65): dieselbe reine Ordnung, die die Console zeigt, und
// derselbe Faecher, den die Route benutzt -- ueber echte Zeilen zweier Quellen.
import {
  LOG_EXPLORER_OUT_OF_REACH,
  parseLogExplorerQuery,
  type LogExplorerQuery,
} from "@/lib/console/log-explorer";
// Dashboard-Webhooks (2.75): echte Audit-Kette, echte Kopplung, echte Outbox,
// echter Zusteller, echter Vault. Die Abbildung `auditEventFromRecord` ist die,
// mit der die Console ihre Audit-Ansicht fuellt: Der Fall zeigt damit, dass die
// Akteursreferenz dort sichtbar ist und in der Meldung fehlt.
import {
  DashboardWebhookCollector,
  DashboardWebhookService,
} from "@/lib/server/compute/dashboard-webhooks";
import {
  PostgresDashboardEventReader,
  PostgresDashboardWebhookRepository,
} from "@/lib/server/compute/dashboard-webhook-postgres-repository";
import { PostgresDashboardWebhookCursorRepository } from
  "@/lib/server/compute/dashboard-webhook-cursor-postgres-repository";
import { DASHBOARD_EVENT_DEFINITIONS } from "@/lib/console/dashboard-webhooks";
import { auditEventFromRecord } from "@/lib/server/control-plane/mappers";
// Auth-Hooks (2.77): der echte Adapter, der einen Hook auf den vorhandenen
// Aufrufdienst legt. Es gibt keinen zweiten Aufrufweg, und der Fall benutzt
// darum auch keinen.
import { ProjectAuthFunctionHooks } from "@/lib/server/project-auth/hooks-functions";
// Integrationen -> GraphQL (2.83): die lesende Flaeche liegt auf genau dieser
// Data API und hat keinen eigenen Weg in die Datenbank. Die Grenzen kommen aus
// derselben Tabelle, die die Console anzeigt.
import { ProjectGraphqlService } from "@/lib/server/data-plane/graphql";
import { DATA_API_GRAPHQL_LIMITS } from "@/lib/data-api-graphql-limits";
import { searchLogSources } from "@/lib/server/logs/log-explorer-search";
import {
  authAuditFetcher,
  functionInvocationFetcher,
  storageObjectFetcher,
} from "@/lib/server/logs/log-explorer-fetchers";
import { RequestAuthorizationError } from "@/lib/server/request-context";
import { FunctionInvocationError } from "@/lib/server/compute/functions";
// Log-Drains (2.54): echte Definition, echte Quelle, echte Outbox, echter
// Zusteller, echter Vault.
import { LogDrainCollector, LogDrainService } from "@/lib/server/compute/log-drains";
import {
  PostgresLogDrainRepository,
  PostgresLogDrainSourceReader,
} from "@/lib/server/compute/log-drain-postgres-repository";
import { LOG_DRAIN_SOURCE_DEFINITIONS } from "@/lib/console/log-drains";
// Die Bruecke als Prozess (2.53): derselbe Prozess, den der Betrieb startet.
import { spawn } from "node:child_process";
// Die eigene Darstellung der Console (2.55): dasselbe Repository, das die
// Route benutzt, und dasselbe reine Modul, das die Ansicht anwendet.
import { PostgresConsoleDisplaySettingsRepository } from "@/lib/server/auth/console-settings";
import { CONSOLE_DISPLAY_DEFAULTS, type ConsoleDisplaySettings } from "@/lib/console/display-settings";

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
      // Seit dem sechsten Zustand heisst `ok` gefragt und geantwortet. Realtime
      // und Vault melden nur noch `configured`, und das Gesamturteil ist der
      // schlechteste vorkommende Zustand; deshalb steht hier nicht mehr `ok`.
      expect(good.overall).toBe("configured");

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

  it("(2.71) splits the failures of the real chain by action and says since when", async () => {
    // Auth -> Auth-Leistung (2.71) gegen die echte Datenbank.
    //
    // Die Seite verspricht die Fehlerrate je Handlungsart. Bis 2.71 war die
    // Antwort der Reihe dafuer zu grob: Sie trug je Eimer eine einzige Zahl
    // gescheiterter Handlungen, und "die Anmeldung scheitert" war darin nicht
    // von "der zweite Faktor scheitert" zu unterscheiden. Die Aufteilung
    // entsteht nicht in JavaScript, sondern in der Datenbank: `GROUP BY 1, 2`
    // ueber Eimer **und** Handlung, dazu
    // `COUNT(*) FILTER (WHERE status = 'failed')` je Gruppe.
    //
    // Der Unit-Test daneben (`auth-performance.test.ts`) rechnet die Rangfolge
    // aus einer Reihe, die im Test woertlich dasteht. Das ist die halbe
    // Zusage. Die andere Haelfte ist der Weg von der Kette bis in die Zeile
    // der Console, und die kann nur eine echte Datenbank belegen:
    //
    // 1. **Die gescheiterten haengen wirklich an ihrer Handlung.** In
    //    derselben Stunde stehen vier zweite Faktoren, davon drei
    //    gescheitert, und drei gelungene Anmeldungen, davon keine. Eine
    //    Antwort, die nur "fuenf gescheitert" sagt, faellt hier durch.
    // 2. **Der Dienst liest, den die Route benutzt.** Gelesen wird ueber
    //    `ProjectAuthService.readAuditSeries`, denselben Aufruf wie in
    //    `admin/audit/series`. Es gibt keinen Nachbau: echtes Repository,
    //    echter Sink, echte Kette.
    // 3. **"Seit wann" ist der Eimer der Reihe und nicht die Uhr.** 47
    //    Stunden spaeter liegt dieselbe Stunde im ersten Eimer des Fensters
    //    und die Rangfolge nennt genau ihn; 48 Stunden spaeter ist sie leer,
    //    weil die Fenstergrenze als WHERE in der Abfrage steht.
    // 4. **Die Rangfolge traegt keine Person.** Sie besteht aus Kennungen,
    //    Zahlen und einem Eimerbeginn, aus nichts sonst.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.35, 2.45 und 2.47: Die
    // Eintraege sind Audit-Zeilen, und eine Organisation mit Audit-Zeilen
    // laesst sich nicht mehr loeschen; das gemeinsame afterAll muss
    // organizationA und organizationB loswerden. Weggeraeumt wird darum
    // nichts: audit_logs ist append-only (der Trigger aus 0002 weist UPDATE
    // und DELETE ab), und der Wegwerf-Stack faellt nach dem Lauf weg.
    const rateOwner = randomUUID();
    const rateOrganization = randomUUID();
    const rateProject = randomUUID();
    const scope = { organizationId: rateOrganization, projectId: rateProject, environment: "development" as const };
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [rateOwner, `auth-performance-owner-${rateOwner}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Auth Performance 2.71', $2, $3)`,
    [rateOrganization, `auth-performance-2-71-${rateOrganization}`, rateOwner]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Auth Performance 2.71', $3, 'test', 'ready', $4)`,
    [rateProject, rateOrganization, `auth-performance-2-71-${rateProject}`, rateOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [rateOrganization, rateProject, `managed:${rateProject}`]);

    const sink = new PostgresProjectAuthAuditSink(auth);
    const appUser = randomUUID();
    const userRef = `project_auth_user:${appUser}`;
    // Der Zeitpunkt kommt aus der Kette und nicht von der Uhr dieses
    // Prozesses: `created_at` setzt die Datenbank selbst, und append-only
    // heisst, dass er sich nachtraeglich nicht setzen laesst. Nur das
    // Fenster, das der Dienst spannt, wird hier gesteuert.
    let seriesNow = new Date();
    const { privateKey } = generateKeyPairSync("ed25519");
    const service = new ProjectAuthService({
      repository: new PostgresProjectAuthRepository(auth),
      audit: sink,
      passwords: new Argon2idPasswordHasher({}),
      rateLimiter: new InMemoryRateLimiter(),
      tokens: new ProjectAuthTokenService({ kid: "certification-2-71", privateKey }, "https://qkern.test"),
      mfa: new ProjectAuthTotp(),
      secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 7)),
      delivery: new NoopDevelopmentProjectAuthDelivery(),
      oidcCatalog: new ProjectAuthOidcCatalog([]),
      oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
      callbackBaseUrl: "https://qkern.test",
      allowedRedirectOrigins: new Set(["https://app.test"]),
      exposeDeliveryTokens: true,
      now: () => new Date(seriesNow),
    });

    // Neun Handlungen dreier Arten, mit drei verschiedenen Fehlerbildern:
    // der zweite Faktor scheitert meistens, die Anmeldung gelingt immer, und
    // dazu zwei Fehlversuche, die schon als Art nichts anderes sind. Eine
    // gemeinsame Fehlerzahl je Eimer kann diese drei Lagen nicht auseinander
    // halten; genau darum geht es hier.
    const written: Array<{ action: string; status: "succeeded" | "failed" }> = [
      { action: "project_auth.mfa.verified", status: "failed" },
      { action: "project_auth.mfa.verified", status: "failed" },
      { action: "project_auth.mfa.verified", status: "failed" },
      { action: "project_auth.mfa.verified", status: "succeeded" },
      { action: "project_auth.login.failed", status: "failed" },
      { action: "project_auth.login.failed", status: "failed" },
      { action: "project_auth.login.succeeded", status: "succeeded" },
      { action: "project_auth.login.succeeded", status: "succeeded" },
      { action: "project_auth.login.succeeded", status: "succeeded" },
    ];
    for (const event of written) {
      await sink.record({
        scope, actorType: "app_user", actorRef: userRef, resourceRef: userRef,
        action: event.action, status: event.status, metadata: { method: "password" },
      });
    }

    const page = await sink.list(scope, { limit: 20 });
    expect(page.events).toHaveLength(written.length);
    const at = new Date(page.events[0].createdAt);
    const hour = new Date(Math.floor(at.getTime() / 3_600_000) * 3_600_000);
    // Alle neun Zeilen in derselben Stunde: Sonst haette das Schreiben eine
    // Stundengrenze ueberquert, und "seit wann" meinte zwei Eimer statt einen.
    for (const event of page.events) {
      expect(new Date(event.createdAt).getTime()).toBeGreaterThanOrEqual(hour.getTime());
      expect(new Date(event.createdAt).getTime()).toBeLessThan(hour.getTime() + 3_600_000);
    }

    // --- Zusage 1 und 2: der Dienst der Route, und die Aufteilung je Handlung
    seriesNow = at;
    const series = await service.readAuditSeries(scope, { bucket: "hour" });
    expect(series.truncated).toBe(false);
    const current = series.buckets.find((entry) => entry.start === hour.toISOString())!;
    expect(current).toMatchObject({ total: 9, succeeded: 4, failed: 5 });
    // Der Kern: dieselbe Stunde, dasselbe `failed`, und trotzdem drei Arten
    // mit drei verschiedenen Fehlerbildern.
    expect(current.actions["project_auth.mfa.verified"]).toBe(4);
    expect(current.failedActions["project_auth.mfa.verified"]).toBe(3);
    expect(current.actions["project_auth.login.succeeded"]).toBe(3);
    expect(current.failedActions["project_auth.login.succeeded"]).toBe(0);
    expect(current.actions["project_auth.login.failed"]).toBe(2);
    expect(current.failedActions["project_auth.login.failed"]).toBe(2);
    expect(current.failedActions.other).toBe(0);
    // Die Aufteilung ist vollstaendig: Was je Handlung gescheitert ist,
    // ergibt zusammen genau die Zahl des Eimers, keine mehr und keine
    // weniger.
    const perAction = PROJECT_AUTH_AUDIT_ACTION_IDS
      .reduce((sum, id) => sum + current.failedActions[id], 0);
    expect(perAction).toBe(current.failed);
    expect(series.totals.failedActions["project_auth.mfa.verified"]).toBe(3);
    expect(series.totals).toMatchObject({ total: 9, succeeded: 4, failed: 5 });

    // Der Anteil ist eine Rechnung auf echten Zahlen und keine Schaetzung.
    expect(authFailureShare(series.totals)).toBeCloseTo(5 / 9, 12);

    // --- Zusage 3: die Rangfolge, und seit wann ------------------------------
    const ranking = authFailureRanking(series);
    expect(ranking.map((row) => row.id)).toEqual([
      "project_auth.mfa.verified", "project_auth.login.failed",
    ]);
    expect(ranking[0]).toEqual({
      id: "project_auth.mfa.verified", total: 4, failed: 3, share: 0.75,
      firstFailureStart: hour.toISOString(),
    });
    expect(ranking[1]).toEqual({
      id: "project_auth.login.failed", total: 2, failed: 2, share: 1,
      firstFailureStart: hour.toISOString(),
    });
    // Die gelungene Anmeldung kommt neun Mal im Fenster vor und steht
    // trotzdem nicht in der Liste: Sie ist kein Mal gescheitert.
    expect(ranking.some((row) => row.id === "project_auth.login.succeeded")).toBe(false);

    // 47 Stunden spaeter liegt die Stunde genau im ersten Eimer des Fensters.
    // "Seit wann" nennt dann genau diesen Eimer und nicht etwa die Uhr.
    seriesNow = new Date(at.getTime() + 47 * 3_600_000);
    const edgeIn = await service.readAuditSeries(scope, { bucket: "hour" });
    expect(edgeIn.buckets[0].start).toBe(hour.toISOString());
    const edgeRanking = authFailureRanking(edgeIn);
    expect(edgeRanking.map((row) => [row.id, row.firstFailureStart])).toEqual([
      ["project_auth.mfa.verified", hour.toISOString()],
      ["project_auth.login.failed", hour.toISOString()],
    ]);

    // 48 Stunden spaeter liegen die Zeilen eine Stunde vor dem Fenster. Die
    // Grenze steckt als WHERE in der Abfrage; die Seite sagt dann, dass im
    // Fenster nichts gescheitert ist, und nicht, dass nichts geschah.
    seriesNow = new Date(at.getTime() + 48 * 3_600_000);
    const edgeOut = await service.readAuditSeries(scope, { bucket: "hour" });
    expect(new Date(edgeOut.windowStart).getTime()).toBe(hour.getTime() + 3_600_000);
    expect(edgeOut.totals).toMatchObject({ total: 0, failed: 0 });
    expect(authFailureRanking(edgeOut)).toEqual([]);
    expect(authFailureShare(edgeOut.totals)).toBe(0);

    // Dieselben Zeilen in Tageseimern: anderes Fenster, dieselbe Aufteilung.
    seriesNow = at;
    const daily = await service.readAuditSeries(scope, { bucket: "day" });
    const day = new Date(Math.floor(at.getTime() / 86_400_000) * 86_400_000);
    expect(daily.totals.failedActions["project_auth.mfa.verified"]).toBe(3);
    expect(authFailureRanking(daily).map((row) => [row.id, row.firstFailureStart])).toEqual([
      ["project_auth.mfa.verified", day.toISOString()],
      ["project_auth.login.failed", day.toISOString()],
    ]);

    // --- Zusage 4: die Seite traegt keine Person -----------------------------
    for (const answer of [series, edgeIn, edgeOut, daily]) {
      const serialised = JSON.stringify({ series: answer, ranking: authFailureRanking(answer) });
      expect(serialised).not.toContain("@");
      expect(serialised).not.toContain(appUser);
      expect(serialised).not.toContain("project_auth_user");
      expect(serialised).not.toMatch(/qk_|entry_hash/);
    }
    // Ohne eigenes Zeitbudget: neun Eintraege, ein Auszug und vier Reihen.
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

  it("(2.60) refuses a known leaked password at sign-up when the project requires it", async () => {
    // Der tragende Teil dieses Slices gegen die echte Datenbank: Eine
    // Umgebung schaltet die Leckpruefung ein, und eine Registrierung mit einem
    // Passwort aus der hinterlegten Liste kommt nicht durch -- ohne dass
    // irgendetwas das Netz verlaesst.
    //
    // Echt ist alles, worauf es ankommt: das PostgreSQL-Repository, der
    // Audit-Sink in der Hash-Kette, der Argon2-Hasher, der Ed25519-Signierer
    // und die Listendatei, die durch denselben Lader geht wie im Betrieb
    // (`leakedPasswordListFromEnv`). Fest sind nur die Uhr und die Zustellung.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.45, 2.52, 2.54 und 2.57:
    // Das Setzen der Regel und jede Ablehnung schreiben eine Audit-Zeile, und
    // eine Organisation mit Audit-Zeilen laesst sich wegen
    // audit_logs_organization_id_fkey nicht mehr loeschen; das gemeinsame
    // afterAll muss organizationA und organizationB loswerden. Weggeraeumt
    // wird darum nur, was das Produkt selbst loescht: der App-Nutzer.
    const leakOwner = randomUUID();
    const leakOrganization = randomUUID();
    const leakProject = randomUUID();
    const scope = {
      organizationId: leakOrganization, projectId: leakProject, environment: "development" as const,
    };
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [leakOwner, `auth-leak-owner-${leakOwner}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Auth Password Protection', $2, $3)`,
    [leakOrganization, `auth-leak-${leakOrganization}`, leakOwner]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Auth Password Protection', $3, 'test', 'ready', $4)`,
    [leakProject, leakOrganization, `auth-leak-${leakProject}`, leakOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [leakOrganization, leakProject, `managed:${leakProject}`]);

    // Die Listendatei, im Format der bekannten Listen: SHA-1 in Hex, ein
    // Doppelpunkt, eine Anzahl, die verworfen wird. Der Lader liest sie
    // genauso, wie er sie im Betrieb aus der Prozessumgebung liest.
    const leaked = "correct horse battery staple";
    const directory = mkdtempSync(path.join(tmpdir(), "qkern-cert-leaks-"));
    const listFile = path.join(directory, "leaks.txt");
    writeFileSync(listFile, [
      "# QKERN certification list, two entries",
      `${projectAuthPasswordDigest(leaked, "sha1")}:4711`,
      `${projectAuthPasswordDigest("ein zweites bekanntes Passwort", "sha1")}:1`,
      "",
    ].join("\n"), "utf8");
    const list = leakedPasswordListFromEnv({
      QKERN_PROJECT_AUTH_LEAKED_PASSWORD_FILE: listFile,
    });
    expect(list).toMatchObject({ source: "file", algorithm: "sha1", prefixLength: 40, entries: 2 });

    // Die eingebaute Liste haette hier nichts getan, und das soll der Fall
    // aussprechen: Alle 25 Eintraege sind kuerzer als die 12 Zeichen, die der
    // Dienst ohnehin verlangt. Darum prueft dieser Fall mit einer Datei.
    expect(projectAuthPasswordIsLeaked(projectAuthBuiltInLeakList(), leaked)).toBe(false);
    for (const builtIn of PROJECT_AUTH_BUILT_IN_LEAKED_PASSWORDS) {
      expect(builtIn.length, builtIn).toBeLessThan(12);
    }

    const at = new Date("2026-09-26T13:00:00.000Z");
    const { privateKey } = generateKeyPairSync("ed25519");
    const service = new ProjectAuthService({
      repository: new PostgresProjectAuthRepository(auth),
      audit: new PostgresProjectAuthAuditSink(auth),
      passwords: new Argon2idPasswordHasher({}),
      leakedPasswords: list,
      rateLimiter: new InMemoryRateLimiter(),
      tokens: new ProjectAuthTokenService({ kid: "certification-2-60", privateKey }, "https://qkern.test"),
      mfa: new ProjectAuthTotp(),
      secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 11)),
      delivery: new NoopDevelopmentProjectAuthDelivery(),
      oidcCatalog: new ProjectAuthOidcCatalog([]),
      oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
      callbackBaseUrl: "https://qkern.test",
      allowedRedirectOrigins: new Set(["https://app.test"]),
      exposeDeliveryTokens: true,
      now: () => new Date(at),
    });

    // Ohne Zeile in project_auth_settings gilt die Vorgabe, und die ist aus.
    expect(await service.readPasswordProtection(scope)).toMatchObject({
      protection: { leakedPasswordCheck: false, minLength: 12, notice: "named" },
      configured: false, updatedAt: null,
      list: { source: "file", entries: 2, builtInEntries: 25 },
    });
    // Und darum kommt das bekannte Passwort vor dem Einschalten durch.
    const before = `before-${randomUUID()}@example.test`;
    expect(await service.signUp(scope, {
      email: before, password: leaked, redirectTo: "https://app.test/willkommen",
      rateLimitKey: randomUUID(),
    })).toMatchObject({ accepted: true });

    // Die Regel, ueber den echten Dienst und in die echten Spalten.
    const stored = await service.setPasswordProtection(scope, {
      leakedPasswordCheck: true, minLength: 14, notice: "named",
    }, { id: leakOwner });
    expect(stored).toMatchObject({
      protection: { leakedPasswordCheck: true, minLength: 14, notice: "named" }, configured: true,
    });
    const columns = await auth.query<{
      leaked_password_check: boolean; password_min_length: number; leaked_password_notice: string;
    }>(
      `SELECT leaked_password_check, password_min_length, leaked_password_notice
       FROM project_auth_settings
       WHERE organization_id = $1 AND project_id = $2 AND environment = 'development'`,
      [leakOrganization, leakProject],
    );
    expect(columns.rows).toEqual([{
      leaked_password_check: true, password_min_length: 14, leaked_password_notice: "named",
    }]);

    // Und jetzt der Satz, um den es geht: Dieselbe Registrierung, dieselbe
    // Liste, dasselbe Passwort -- und sie kommt nicht durch.
    const victim = `after-${randomUUID()}@example.test`;
    await expect(service.signUp(scope, {
      email: victim, password: leaked, redirectTo: "https://app.test/willkommen",
      rateLimitKey: randomUUID(),
    })).rejects.toMatchObject({ code: "LEAKED_PASSWORD" });
    // Es ist auch wirklich kein Konto entstanden.
    const users = await auth.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM project_auth_users
       WHERE organization_id = $1 AND project_id = $2 AND email = $3`,
      [leakOrganization, leakProject, victim],
    );
    expect(users.rows[0].count).toBe("0");

    // Die Mindestlaenge dieser Umgebung greift ueber die 12 des Dienstes
    // hinaus, und sie ist ein anderer Code als die Leckpruefung.
    await expect(service.signUp(scope, {
      email: victim, password: "dreizehnzeich", redirectTo: "https://app.test/willkommen",
      rateLimitKey: randomUUID(),
    })).rejects.toMatchObject({ code: "WEAK_PASSWORD" });

    // Ein unbekanntes Passwort kommt durch, und das Konto entsteht.
    const clean = "eine ausreichend lange Parole ohne Leck";
    const signUp = await service.signUp(scope, {
      email: victim, password: clean, redirectTo: "https://app.test/willkommen",
      rateLimitKey: randomUUID(),
    });
    const verified = await service.consumeEmailToken(scope, {
      token: signUp.debugToken!, purpose: "email_verification",
    });
    if ("mfaRequired" in verified) throw new Error("unexpected MFA");
    expect(verified.accessToken.length).toBeGreaterThan(20);

    // Der zweite Weg, auf dem ein Passwort gesetzt wird: dieselbe Regel, und
    // der Zuruecksetz-Schein bleibt dabei brauchbar.
    const reset = await service.requestPasswordReset(scope, {
      email: victim, redirectTo: "https://app.test/willkommen", rateLimitKey: randomUUID(),
    });
    await expect(service.resetPassword(scope, { token: reset.debugToken!, password: leaked }))
      .rejects.toMatchObject({ code: "LEAKED_PASSWORD" });
    expect(await service.resetPassword(scope, {
      token: reset.debugToken!, password: `${clean} zwei`,
    })).toEqual({ reset: true });

    // Der Wortlaut ist eine Einstellung, und er aendert den Code, nicht die
    // Entscheidung.
    await service.setPasswordProtection(scope, {
      leakedPasswordCheck: true, minLength: 14, notice: "generic",
    }, { id: leakOwner });
    await expect(service.signUp(scope, {
      email: `quiet-${randomUUID()}@example.test`, password: leaked,
      redirectTo: "https://app.test/willkommen", rateLimitKey: randomUUID(),
    })).rejects.toMatchObject({ code: "WEAK_PASSWORD" });

    // Die Datenbank haelt die Raender selbst, nicht nur der Dienst.
    for (const statement of [
      "SET password_min_length = 11",
      "SET password_min_length = 129",
      "SET leaked_password_notice = 'loud'",
    ]) {
      await expect(auth.query(
        `UPDATE project_auth_settings ${statement}
         WHERE organization_id = $1 AND project_id = $2 AND environment = 'development'`,
        [leakOrganization, leakProject],
      ), statement).rejects.toBeInstanceOf(Error);
    }

    // Der Schalter aus 2.52, die Liste aus 2.54 und die Grenzen aus 2.56
    // teilen sich die Zeile mit dem Passwortschutz, fassen einander aber nicht
    // an.
    await service.setMfaRequired(scope, true, { id: leakOwner });
    await service.setReturnTargets(scope, ["https://app.test"], { id: leakOwner });
    await service.setRateLimits(scope, {
      sign_in: { max: 7, windowSeconds: 900 },
      mail: { max: 5, windowSeconds: 3600 },
      refresh: { max: 9, windowSeconds: 3600 },
    }, { id: leakOwner });
    const shared = await auth.query<{
      mfa_required: boolean; redirect_allow_list: string[]; sign_in_max: number;
      leaked_password_check: boolean; password_min_length: number; leaked_password_notice: string;
    }>(
      `SELECT mfa_required, redirect_allow_list, sign_in_max,
              leaked_password_check, password_min_length, leaked_password_notice
       FROM project_auth_settings
       WHERE organization_id = $1 AND project_id = $2 AND environment = 'development'`,
      [leakOrganization, leakProject],
    );
    expect(shared.rows).toEqual([{
      mfa_required: true, redirect_allow_list: ["https://app.test"], sign_in_max: 7,
      leaked_password_check: true, password_min_length: 14, leaked_password_notice: "generic",
    }]);

    // Jede Aenderung und jede Ablehnung stehen in der Hash-Kette -- und zwar
    // ohne Passwort, ohne Digest, ohne Adresse und ohne Pfad.
    const page = await service.listAuditEvents(scope, 100);
    const changed = page.events.filter((event) => event.action === "project_auth.password_protection.changed");
    expect(changed).toHaveLength(2);
    expect(changed[changed.length - 1]).toMatchObject({
      actorType: "admin", actorRef: leakOwner, status: "succeeded",
      resourceRef: "project_auth_environment:development",
      metadata: {
        leakCheck: true, minLength: 14, notice: "named",
        listSource: "file", listEntries: 2,
      },
    });
    const refused = page.events.filter((event) => event.action === "project_auth.password.refused");
    // Drei Leckablehnungen und eine wegen der Laenge.
    expect(refused.filter((event) => event.metadata.reason === "known_leak")).toHaveLength(3);
    expect(refused.filter((event) => event.metadata.reason === "too_short")).toHaveLength(1);
    expect(refused.find((event) => event.metadata.reason === "known_leak")?.metadata)
      .toEqual({ reason: "known_leak", listSource: "file", listEntries: 2 });
    const serialised = JSON.stringify(page.events);
    expect(serialised).not.toContain(leaked);
    expect(serialised).not.toContain(projectAuthPasswordDigest(leaked, "sha1"));
    expect(serialised).not.toContain("@");
    expect(serialised).not.toContain("leaks.txt");
    // Und die Anzahl aus der Listendatei taucht nirgends auf: Eine Ablehnung
    // sagt nie, wie oft ein Passwort vorkommt.
    //
    // Geprueft wird das an den Werten und nicht an der Zeichenkette. Die
    // Suche nach "4711" im JSON hat einmal angeschlagen, und zwar in einer
    // zufaelligen Kennung: Eine UUID hat 32 Hex-Stellen, und vier davon
    // treffen irgendwann jede vierstellige Zahl. Der Fall haette dann eine
    // Undichtigkeit gemeldet, die es nicht gab. Die Werte zu lesen ist auch
    // die schaerfere Probe: Sie faellt auch dort, wo die Zahl als Zahl und
    // nicht als Text stuende.
    const metadataValues = (value: unknown): unknown[] =>
      value !== null && typeof value === "object"
        ? Object.values(value as Record<string, unknown>).flatMap(metadataValues)
        : [value];
    const allValues = page.events.flatMap((event) => metadataValues(event.metadata));
    expect(allValues.filter((value) => value === 4711 || value === "4711"),
      "eine Zeile traegt die Haeufigkeit aus der Listendatei").toEqual([]);

    // Aufgeraeumt wird nur, was das Produkt loescht: die App-Nutzer. Ihre
    // Token und Sitzungen haengen per ON DELETE CASCADE daran. Organisation,
    // Projekt und Umgebung bleiben stehen, weil Audit-Zeilen daran haengen und
    // audit_logs append-only ist.
    expect(before).not.toBe(victim);
    await owner.query(`DELETE FROM project_auth_users
      WHERE organization_id = $1 AND project_id = $2`, [leakOrganization, leakProject]);
  });



  it("(2.59) reports the roles and the TLS state of the project database without a connection string", async () => {
    // Datenbank-Einstellungen (2.53) gegen die echte Datenbank. Der Fall hat
    // zwei Zusagen, und keine davon liesse sich gegen einen Nachbau pruefen:
    //
    // 1. Was die Seite zeigt, steht wirklich im Katalog. Jede gemeldete Rolle,
    //    ihre Flags, Name und Eigentuemerin der Datenbank und die
    //    Verbindungsgrenzen werden danach ein zweites Mal gelesen, als
    //    Eigentuemer und mit Parametern, und muessen uebereinstimmen. Gegen
    //    einen Fake waere das die Pruefung des Fakes.
    // 2. Der Weg, auf dem die Auskunft entsteht, kennt die Adresse der
    //    Datenbank -- der Pool ist aus QKERN_TEST_PROJECT_API_DATABASE_URL
    //    gebaut, mit Benutzer, Passwort, Host und Port. Genau darum ist es
    //    eine Aussage, dass kein Wert der Antwort einer dieser Angaben
    //    gleicht. Ein Fake hat die URL gar nicht erst.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.45, 2.52, 2.54 und 2.57:
    // Das gemeinsame afterAll muss organizationA und organizationB loswerden,
    // und dieser Fall soll ihm dabei nicht im Weg stehen. Geloescht wird nur,
    // was das Produkt loescht; dieser Fall schreibt nichts in die
    // Projektdatenbank und laesst Organisation, Projekt und Umgebung stehen
    // wie 2.54 und 2.57.
    expect(projectApiUrl, "QKERN_TEST_PROJECT_API_DATABASE_URL fehlt").toBeTruthy();
    const target = new URL(projectApiUrl!);
    const expectedDatabase = target.pathname.slice(1);
    const expectedRole = decodeURIComponent(target.username);

    const settingsOwner = randomUUID();
    const settingsOrganization = randomUUID();
    const settingsProject = randomUUID();
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [settingsOwner, `settings-2-59-owner-${settingsOwner}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Settings 2.59', $2, $3)`,
    [settingsOrganization, `settings-2-59-${settingsOrganization}`, settingsOwner]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Settings 2.59', $3, 'test', 'ready', $4)`,
    [settingsProject, settingsOrganization, `settings-2-59-${settingsProject}`, settingsOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [settingsOrganization, settingsProject, `managed:${settingsProject}`]);

    const projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
    try {
      const service = new ProjectDataPlaneService(
        { resolveTarget: async () => ({ databaseInstanceRef: `managed:${settingsProject}` }) },
        { resolve: async () => ({
          pool: projectApi,
          expectedRole,
          expectedDatabase,
          expectedLedgerOwner: "qkern",
        }) },
      );
      const settings = await service.inspectSettings(
        { organizationId: settingsOrganization, actorRef: `settings-2-59-owner-${settingsOwner}@qkern.test` },
        { projectId: settingsProject, environment: "development" },
      );

      // --- Die Form der Antwort ---
      expect(settings.source).toBe("postgres");
      expect(Object.keys(settings).sort()).toEqual([
        "currentRole", "databaseName", "databaseOwner", "limits", "roles", "source", "tls", "truncated",
      ]);
      expect(settings.databaseName).toBe(expectedDatabase);
      expect(settings.currentRole).toBe(expectedRole);
      expect(settings.truncated).toBe(false);

      // --- Zusage 1: Name, Eigentuemerin und Grenzen stehen so im Katalog ---
      const catalog = await owner.query<{
        database_owner: string; max_connections: string; superuser_reserved: string;
        database_limit: string; server_ssl: string;
      }>(`SELECT pg_catalog.pg_get_userbyid(database.datdba) AS database_owner,
                 current_setting('max_connections') AS max_connections,
                 current_setting('superuser_reserved_connections') AS superuser_reserved,
                 database.datconnlimit::text AS database_limit,
                 COALESCE(current_setting('ssl', true), 'off') AS server_ssl
          FROM pg_catalog.pg_database AS database
          WHERE database.datname = $1`, [expectedDatabase]);
      const reference = catalog.rows[0];
      expect(reference, "Die Datenbank steht nicht in pg_database; dann prueft dieser Fall nichts.").toBeDefined();
      expect(settings.databaseOwner).toBe(reference!.database_owner);
      expect(settings.limits.maxConnections).toBe(Number(reference!.max_connections));
      expect(settings.limits.superuserReserved).toBe(Number(reference!.superuser_reserved));
      // -1 heisst unbegrenzt und wird zu null; jede andere Zahl bleibt.
      expect(settings.limits.database).toBe(Number(reference!.database_limit) === -1 ? null : Number(reference!.database_limit));
      // Der Wegwerf-Stack startet Postgres mit max_connections=300.
      expect(settings.limits.maxConnections).toBeGreaterThanOrEqual(300);

      // --- Zusage 1: jede gemeldete Rolle gibt es wirklich, mit diesen Flags ---
      expect(settings.roles.length).toBeGreaterThan(0);
      const names = settings.roles.map((entry) => entry.name);
      expect(names).toContain(expectedRole);
      expect([...new Set(names)]).toHaveLength(names.length);
      // Keine vordefinierte pg_-Rolle und kein Superuser in der Ansicht eines
      // Projekts, auch nicht auf einem geteilten Cluster.
      for (const entry of settings.roles) {
        expect(entry.name.startsWith("pg_"), entry.name).toBe(false);
        expect(entry.superuser, entry.name).toBe(false);
        expect(Object.keys(entry).sort()).toEqual([
          "bypassRowSecurity", "connectionLimit", "createDatabase", "createRole",
          "inherit", "login", "name", "replication", "superuser", "validUntil",
        ]);
        if (entry.connectionLimit !== null) expect(entry.connectionLimit).toBeGreaterThanOrEqual(0);
      }
      const real = await owner.query<{
        rolname: string; rolcanlogin: boolean; rolsuper: boolean; rolinherit: boolean;
        rolcreatedb: boolean; rolcreaterole: boolean; rolreplication: boolean;
        rolbypassrls: boolean; rolconnlimit: number;
      }>(`SELECT rolname, rolcanlogin, rolsuper, rolinherit, rolcreatedb, rolcreaterole,
                 rolreplication, rolbypassrls, rolconnlimit
          FROM pg_catalog.pg_roles WHERE rolname = ANY ($1::text[])`, [names]);
      expect(real.rows.length, "Eine gemeldete Rolle gibt es nicht.").toBe(names.length);
      for (const entry of settings.roles) {
        const actual = real.rows.find((candidate) => candidate.rolname === entry.name);
        expect(actual, entry.name).toBeDefined();
        expect({
          login: entry.login, superuser: entry.superuser, inherit: entry.inherit,
          createDatabase: entry.createDatabase, createRole: entry.createRole,
          replication: entry.replication, bypassRowSecurity: entry.bypassRowSecurity,
          connectionLimit: entry.connectionLimit,
        }, entry.name).toEqual({
          login: actual!.rolcanlogin, superuser: actual!.rolsuper, inherit: actual!.rolinherit,
          createDatabase: actual!.rolcreatedb, createRole: actual!.rolcreaterole,
          replication: actual!.rolreplication, bypassRowSecurity: actual!.rolbypassrls,
          connectionLimit: actual!.rolconnlimit === -1 ? null : actual!.rolconnlimit,
        });
      }
      // Die Grenze der lesenden Rolle kommt aus derselben Zeile.
      const reader = real.rows.find((candidate) => candidate.rolname === expectedRole);
      expect(settings.limits.role).toBe(reader!.rolconnlimit === -1 ? null : reader!.rolconnlimit);

      // --- Der TLS-Zustand, wie der Server ihn meldet ---
      expect(settings.tls.serverEnabled).toBe(reference!.server_ssl === "on");
      expect(typeof settings.tls.encrypted).toBe("boolean");
      // Ein Server ohne TLS kann keine verschluesselte Verbindung haben, und
      // ohne Verschluesselung gibt es kein Protokoll zu nennen. Der Fall sagt
      // damit nicht, wie der Stack konfiguriert ist, sondern dass die Antwort
      // zu dem passt, was der Server ueber sich selbst sagt.
      if (!settings.tls.serverEnabled) expect(settings.tls.encrypted).toBe(false);
      if (!settings.tls.encrypted) expect(settings.tls.version).toBeNull();

      // --- Zusage 2: kein Wert der Antwort verraet, wo die Datenbank liegt ---
      const values: unknown[] = [];
      const walk = (value: unknown): void => {
        if (Array.isArray(value)) { for (const entry of value) walk(entry); return; }
        if (value !== null && typeof value === "object") { for (const entry of Object.values(value)) walk(entry); return; }
        values.push(value);
      };
      walk(settings);
      // Der Rechnername, der Port und die volle URL duerfen nirgends stehen.
      // Das Passwort wird weiter unten im ganzen Text gesucht, aber nicht hier
      // Wert fuer Wert: Im Zertifizierungsstack heisst der Zugang `postgres`,
      // und so heisst auch der Eigentuemer der Datenbank. Ein Katalogname, der
      // zufaellig wie ein Zugangsname klingt, ist kein Leck; die Gleichheit
      // wuerde nur den Aufbau des Stacks pruefen, nicht die Antwort.
      // Wortgleichheit taugt hier nicht: Im Stack heisst der Rechner `postgres`,
      // der Zugang `postgres` und der Eigentuemer der Datenbank ebenfalls. Ein
      // Katalogname, der so klingt, ist kein Leck. Gesucht wird deshalb die
      // volle Adresse als Wert, und die Form einer Verbindungsangabe im Text;
      // dass es ueberhaupt kein Feld fuer Rechner oder Port gibt, prueft der
      // Schluesselvergleich darunter.
      for (const value of values) {
        expect(String(value), "die volle Verbindungsadresse").not.toBe(projectApiUrl!);
      }
      const keys = new Set<string>();
      const collect = (value: unknown): void => {
        if (Array.isArray(value)) { for (const entry of value) collect(entry); return; }
        if (value !== null && typeof value === "object") {
          for (const [key, entry] of Object.entries(value)) { keys.add(key.toLowerCase()); collect(entry); }
        }
      };
      collect(settings);
      for (const forbidden of ["host", "hostname", "port", "password", "user", "username", "dsn", "url", "uri"]) {
        expect([...keys], forbidden).not.toContain(forbidden);
      }
      const serialised = JSON.stringify(settings);
      expect(serialised).not.toContain(decodeURIComponent(target.password));
      expect(serialised).not.toContain(`:${target.port || "5432"}`);
      expect(serialised).not.toContain("://");
      for (const word of ["sslmode", "connectionString", "client_addr", "client_dn", "rolpassword"]) {
        expect(serialised.toLowerCase(), word).not.toContain(word.toLowerCase());
      }
    } finally {
      await projectApi.end();
    }
  });

  it("(2.62) tells for a real table what a signed-in user may read and write", async () => {
    // Auth -> Policies (2.62) gegen die echte Datenbank. Der Fall hat zwei
    // Zusagen, und keine davon liesse sich gegen einen Nachbau pruefen:
    //
    // 1. Das Urteil steht so im Katalog. Fuenf Tabellen mit fuenf Lagen werden
    //    angelegt, ueber die Leserolle der Data API gelesen und durch das reine
    //    Regelmodul geschickt. Dass `refused`, `locked`, `open`, `readable` und
    //    `writable` dabei herauskommen, sagt nichts, wenn die Eingabe erfunden
    //    ist -- hier kommt sie aus pg_class und pg_policy.
    // 2. Das Urteil stimmt auch. Dieselben fuenf Tabellen werden danach durch
    //    die echte generierte Data API gelesen, mit den Claims eines
    //    angemeldeten Nutzers. Die Tabelle ohne Row Level Security wird
    //    wirklich verweigert, die offene gibt ihre Zeile her, die
    //    verschlossene gibt null Zeilen, und die Tabelle, deren Policy den
    //    Claim `sub` nennt, gibt genau die eigene Zeile. Ein Fake koennte das
    //    eine oder das andere zeigen, aber nicht beides aus derselben
    //    Datenbank.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.45, 2.52, 2.57 und 2.59:
    // Das gemeinsame afterAll muss organizationA und organizationB loswerden,
    // und dieser Fall soll ihm dabei nicht im Weg stehen. Geloescht wird nur,
    // was das Produkt loescht; das eigene Schema faellt samt Inhalt weg,
    // Organisation, Projekt und Umgebung bleiben stehen wie in 2.57 und 2.59.
    expect(projectApiUrl, "QKERN_TEST_PROJECT_API_DATABASE_URL fehlt").toBeTruthy();
    const target = new URL(projectApiUrl!);
    const expectedDatabase = target.pathname.slice(1);
    const expectedRole = decodeURIComponent(target.username);

    const accessOwner = randomUUID();
    const accessOrganization = randomUUID();
    const accessProject = randomUUID();
    const schema = `access_${randomUUID().replaceAll("-", "_")}`;
    // Die Nutzer-ID eines angemeldeten Nutzers; sie wird gleich der `sub`-Claim.
    const signedInUser = randomUUID();
    const strangerUser = randomUUID();
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [accessOwner, `access-2-62-owner-${accessOwner}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Access 2.62', $2, $3)`,
    [accessOrganization, `access-2-62-${accessOrganization}`, accessOwner]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Access 2.62', $3, 'test', 'ready', $4)`,
    [accessProject, accessOrganization, `access-2-62-${accessProject}`, accessOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [accessOrganization, accessProject, `managed:${accessProject}`]);

    // Eine Rolle, die es wirklich gibt und die nicht die Anwendungsrolle ist:
    // die Rolle, mit der dieser Fall selbst schreibt. Eine Policy fuer sie
    // muss fuer eine angemeldete Anfrage folgenlos bleiben.
    const foreign = await owner.query<{ role: string }>("SELECT current_user AS role");
    const foreignRole = foreign.rows[0]!.role;
    expect(foreignRole, "Die fremde Rolle darf nicht die Anwendungsrolle sein.").not.toBe(expectedRole);

    const projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
    try {
      await owner.query(`CREATE SCHEMA "${schema}"`);
      // 1. offen fuer alle: eine permissive Policy fuer PUBLIC ohne Bedingung.
      await owner.query(`CREATE TABLE "${schema}".open_posts (id uuid PRIMARY KEY, body text NOT NULL)`);
      await owner.query(`ALTER TABLE "${schema}".open_posts ENABLE ROW LEVEL SECURITY`);
      await owner.query(`CREATE POLICY read_all ON "${schema}".open_posts FOR SELECT USING (true)`);
      // 2. schreibbar, aber nur die eigenen Zeilen: die Policy nennt den Claim.
      await owner.query(`CREATE TABLE "${schema}".own_notes (id uuid PRIMARY KEY, owner text NOT NULL, body text)`);
      await owner.query(`ALTER TABLE "${schema}".own_notes ENABLE ROW LEVEL SECURITY`);
      await owner.query(`CREATE POLICY own_select ON "${schema}".own_notes FOR SELECT TO ${expectedRole}
        USING (owner = current_setting('request.jwt.claim.sub', true))`);
      await owner.query(`CREATE POLICY own_insert ON "${schema}".own_notes FOR INSERT TO ${expectedRole}
        WITH CHECK (owner = current_setting('request.jwt.claim.sub', true))`);
      // 3. verschlossen: Row Level Security an, keine einzige Policy.
      await owner.query(`CREATE TABLE "${schema}".locked_secrets (id uuid PRIMARY KEY, body text NOT NULL)`);
      await owner.query(`ALTER TABLE "${schema}".locked_secrets ENABLE ROW LEVEL SECURITY`);
      // 4. verweigert: Row Level Security aus, obwohl eine weite Policy daneben steht.
      await owner.query(`CREATE TABLE "${schema}".no_rls_audit (id uuid PRIMARY KEY, body text NOT NULL)`);
      await owner.query(`CREATE POLICY read_all ON "${schema}".no_rls_audit FOR ALL USING (true)`);
      // 5. verschlossen, obwohl eine Policy da ist: sie nennt nur eine fremde Rolle.
      await owner.query(`CREATE TABLE "${schema}".foreign_reports (id uuid PRIMARY KEY, body text NOT NULL)`);
      await owner.query(`ALTER TABLE "${schema}".foreign_reports ENABLE ROW LEVEL SECURITY`);
      await owner.query(`CREATE POLICY analyst_read ON "${schema}".foreign_reports FOR SELECT TO ${foreignRole} USING (true)`);
      // Eine View, damit der Fall auch die Zaehlung der Views trifft.
      await owner.query(`CREATE VIEW "${schema}".open_overview AS SELECT id FROM "${schema}".open_posts`);

      const mine = randomUUID();
      const theirs = randomUUID();
      await owner.query(`INSERT INTO "${schema}".open_posts (id, body) VALUES ($1, 'sichtbar')`, [mine]);
      await owner.query(`INSERT INTO "${schema}".own_notes (id, owner, body) VALUES ($1, $2, 'meine'), ($3, $4, 'fremde')`,
        [mine, signedInUser, theirs, strangerUser]);
      await owner.query(`INSERT INTO "${schema}".locked_secrets (id, body) VALUES ($1, 'nie sichtbar')`, [mine]);
      await owner.query(`INSERT INTO "${schema}".no_rls_audit (id, body) VALUES ($1, 'ohne rls')`, [mine]);
      await owner.query(`INSERT INTO "${schema}".foreign_reports (id, body) VALUES ($1, 'nur analyst')`, [mine]);

      await owner.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${expectedRole}`);
      await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO ${expectedRole}`);

      const connections = { resolve: async () => ({
        pool: projectApi,
        expectedRole,
        expectedDatabase,
        expectedLedgerOwner: "qkern",
      }) };
      const targets = { resolveTarget: async () => ({ databaseInstanceRef: `managed:${accessProject}` }) };
      const dataPlane = new ProjectDataPlaneService(targets, connections);
      const generated = new GeneratedDataApiService(targets, connections);
      const context = {
        organizationId: accessOrganization,
        actorRef: `access-2-62-owner-${accessOwner}@qkern.test`,
      };
      const scope = { projectId: accessProject, environment: "development" as const };

      // --- Zusage 1: dieselben drei Auskuenfte, die die Route liest ---
      const [tables, policies, settings] = await Promise.all([
        dataPlane.inspectSchema(context, scope, schema),
        dataPlane.inspectPolicies(context, scope, schema),
        dataPlane.inspectSettings(context, scope),
      ]);
      // Die Rolle kommt aus der Datenbank, nicht aus dem Test.
      expect(settings.currentRole).toBe(expectedRole);
      const access = evaluateAuthAccess({
        schema, role: settings.currentRole, tables: tables.tables, policies: policies.policies,
      });
      expect(access.claimRole).toBe("authenticated");
      expect(access.views).toBe(1);
      const verdicts = Object.fromEntries(access.tables.map((entry) => [entry.table, entry.verdict]));
      expect(verdicts).toEqual({
        foreign_reports: "locked",
        locked_secrets: "locked",
        no_rls_audit: "refused",
        open_posts: "open",
        own_notes: "writable",
      });
      expect(access.counts).toEqual({ refused: 1, locked: 2, readable: 0, writable: 1, open: 1 });

      const byName = (name: string) => access.tables.find((entry) => entry.table === name)!;
      // Die Tabelle, deren Policy einen Claim nennt, traegt die Unsicherheit
      // selbst -- und zwar als `request`, nicht als stilles Ja.
      const notes = byName("own_notes");
      expect(notes.uncertain).toBe(true);
      expect(notes.commands.map((entry) => [entry.command, entry.allowed, entry.condition])).toEqual([
        ["select", "sometimes", "request"],
        ["insert", "sometimes", "request"],
        ["update", "no", "none"],
        ["delete", "no", "none"],
      ]);
      expect(notes.policies.map((entry) => entry.applies)).toEqual([true, true]);
      expect(notes.foreignRolePolicies).toBe(0);
      // Die offene Tabelle ist das Gegenteil: sicher und ohne Bedingung.
      const open = byName("open_posts");
      expect(open.uncertain).toBe(false);
      expect(open.commands.find((entry) => entry.command === "select")).toMatchObject({ allowed: "always", condition: "none" });
      // Die fremde Policy steht mit Namen da und zaehlt nicht.
      const strange = byName("foreign_reports");
      expect(strange.foreignRolePolicies).toBe(1);
      expect(strange.policies.map((entry) => [entry.name, entry.applies, entry.roles])).toEqual([
        ["analyst_read", false, [foreignRole]],
      ]);
      // Und die Tabelle ohne Row Level Security zeigt ihre weite Policy, damit
      // niemand sie fuer wirksam haelt.
      const audit = byName("no_rls_audit");
      expect(audit.rowSecurityEnabled).toBe(false);
      expect(audit.policies.map((entry) => [entry.name, entry.applies])).toEqual([["read_all", true]]);

      // --- Zusage 2: genau so verhaelt sich die echte Data API ---
      const signedIn = { ...context, claims: { role: "authenticated" as const, subject: signedInUser } };
      const openRows = await generated.listRows(signedIn, scope, { schema, table: "open_posts" });
      expect(openRows.rows).toHaveLength(1);
      const noteRows = await generated.listRows(signedIn, scope, { schema, table: "own_notes" });
      expect(noteRows.rows.map((row) => row.owner)).toEqual([signedInUser]);
      const lockedRows = await generated.listRows(signedIn, scope, { schema, table: "locked_secrets" });
      expect(lockedRows.rows).toEqual([]);
      const strangeRows = await generated.listRows(signedIn, scope, { schema, table: "foreign_reports" });
      expect(strangeRows.rows).toEqual([]);
      // Die Tabelle ohne Row Level Security wird nicht offen, sondern verweigert.
      await expect(generated.listRows(signedIn, scope, { schema, table: "no_rls_audit" }))
        .rejects.toMatchObject({ code: "GENERATED_DATA_API_RLS_REQUIRED" });
      // Und in SQL waere dieselbe Tabelle fuer dieselbe Rolle lesbar: Die
      // Verweigerung ist eine Entscheidung von QKERN und kein Zufall der
      // Datenbank.
      const raw = await dataPlane.queryReadOnly(context, scope, `SELECT id FROM "${schema}".no_rls_audit`, 10);
      expect(raw.rows).toHaveLength(1);

      // Die Grenze des Urteils, ausdruecklich: Ohne den Claim sieht dieselbe
      // Rolle keine Zeile von own_notes. Genau darum steht dort `sometimes` und
      // nicht `always`.
      const withoutClaim = await dataPlane.queryReadOnly(context, scope, `SELECT id FROM "${schema}".own_notes`, 10);
      expect(withoutClaim.rows).toEqual([]);
    } finally {
      await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await projectApi.end();
    }
  });

  it("(2.61) runs every prepared template against a real catalog without writing", async () => {
    // Die Vorlagen des SQL-Editors (2.61) gegen die echte Datenbank.
    //
    // Der Unit-Test prueft, dass jede Vorlage den Waechter `isReadOnlySql`
    // besteht. Das ist die halbe Zusage. Die andere Haelfte kann nur eine
    // echte Datenbank belegen: dass PostgreSQL die Abfrage auch versteht. Ein
    // Statement kann den Parser dieses Projekts passieren und in der
    // Zieldatenbank trotzdem an einem Spaltennamen, einem Cast oder einer
    // fehlenden Sicht scheitern -- dann waere die Vorlage eine Attrappe mit
    // gruenem Test. Darum laeuft hier jede Vorlage durch `queryReadOnly`, also
    // durch denselben Weg, den die Query-Route nimmt: Waechter,
    // BEGIN READ ONLY, Zeilenlimit, Redaktion.
    //
    // Zwei Zusagen:
    //
    // 1. Jede Vorlage antwortet mit Zeilen oder mit einer leeren Menge, nie
    //    mit einem Fehler. Eine leere Menge ist in Ordnung -- ein frischer
    //    Cluster hat keinen ungenutzten Index -- ein Fehler nicht.
    // 2. Danach ist die Datenbank unveraendert: dieselben Zeilen, dieselben
    //    Relationen, kein geaendertes und kein geloeschtes Tuple.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.45, 2.52, 2.57 und 2.59:
    // Das gemeinsame afterAll muss organizationA und organizationB loswerden,
    // und eine Organisation mit Auditzeilen laesst sich nicht loeschen. Dieser
    // Fall laesst darum Organisation, Projekt und Umgebung stehen und raeumt
    // nur sein eigenes Schema weg, das er selbst mit rohem SQL angelegt hat.
    expect(projectApiUrl, "QKERN_TEST_PROJECT_API_DATABASE_URL fehlt").toBeTruthy();
    const templateOwner = randomUUID();
    const templateOrganization = randomUUID();
    const templateProject = randomUUID();
    const templateActor = `templates-2-61-owner-${templateOwner}@qkern.test`;
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`, [templateOwner, templateActor]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Templates 2.61', $2, $3)`,
    [templateOrganization, `templates-2-61-${templateOrganization}`, templateOwner]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Templates 2.61', $3, 'test', 'ready', $4)`,
    [templateProject, templateOrganization, `templates-2-61-${templateProject}`, templateOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`,
    [templateOrganization, templateProject, `managed:${templateProject}`]);

    // Das Ziel der beiden Vorlagen mit Tabelle. Der Schemaname erfuellt die
    // Grammatik der Data API -- sonst lehnte das reine Modul ihn ab. Das ist
    // hier kein Zufall, sondern die Probe darauf, dass ein echter Name durch
    // dieselbe Grenze geht wie ein feindlicher.
    const schema = `templates_${randomUUID().replaceAll("-", "_")}`;
    const projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
    try {
      await owner.query(`CREATE SCHEMA "${schema}"`);
      await owner.query(`CREATE TABLE "${schema}".vorlagen (
        id integer PRIMARY KEY,
        notiz text NOT NULL)`);
      await owner.query(`CREATE INDEX vorlagen_notiz_idx ON "${schema}".vorlagen (notiz)`);
      await owner.query(`CREATE TABLE "${schema}".ohne_schluessel (notiz text NOT NULL)`);
      await owner.query(`INSERT INTO "${schema}".vorlagen (id, notiz)
        VALUES (1, 'eins'), (2, 'zwei'), (3, 'drei')`);
      await owner.query(`INSERT INTO "${schema}".ohne_schluessel (notiz) VALUES ('eins')`);
      await owner.query(`GRANT USAGE ON SCHEMA "${schema}" TO qkern_project_api_app`);
      await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO qkern_project_api_app`);
      await owner.query(`ANALYZE "${schema}".vorlagen`);

      // Eine Vorlage braucht `pg_stat_statements`. Der Stack laedt die
      // Erweiterung; fehlte sie, antwortete PostgreSQL mit
      // "relation does not exist" statt mit einer leeren Menge, und dann
      // pruefte dieser Fall an dieser Stelle nichts. Also wird gefragt.
      const installed = await owner.query<{ present: boolean }>(
        "SELECT to_regclass('pg_stat_statements') IS NOT NULL AS present");
      expect(installed.rows[0]?.present,
        "pg_stat_statements fehlt; der Stack laedt sie ueber shared_preload_libraries").toBe(true);

      /**
       * Der Fingerabdruck: Zeilen, Relationen und Schreibzaehler dieses Falls.
       *
       * Eingegrenzt auf das eigene Schema, weil der PostgreSQL-Stack mehrere
       * Testdateien gleichzeitig laufen laesst. Ein clusterweiter Vergleich
       * wuerde die Nachbarn messen statt die Vorlagen.
       */
      const fingerprint = async () => {
        const rows = await owner.query<{ id: number; notiz: string }>(
          `SELECT id, notiz FROM "${schema}".vorlagen ORDER BY id`);
        const relations = await owner.query<{ nspname: string; relname: string; relkind: string }>(
          `SELECT ns.nspname, rel.relname, rel.relkind::text
           FROM pg_catalog.pg_class AS rel
           JOIN pg_catalog.pg_namespace AS ns ON ns.oid = rel.relnamespace
           WHERE ns.nspname = $1
           ORDER BY ns.nspname, rel.relname`, [schema]);
        const counters = await owner.query<{ updated: string; deleted: string }>(
          `SELECT COALESCE(sum(stat.n_tup_upd), 0)::text AS updated,
                  COALESCE(sum(stat.n_tup_del), 0)::text AS deleted
           FROM pg_catalog.pg_stat_all_tables AS stat
           WHERE stat.schemaname = $1`, [schema]);
        return JSON.stringify({
          rows: rows.rows,
          relations: relations.rows,
          counters: counters.rows[0],
        });
      };
      const before = await fingerprint();

      const service = new ProjectDataPlaneService(
        { resolveTarget: async () => ({ databaseInstanceRef: `managed:${templateProject}` }) },
        { resolve: async () => ({
          pool: projectApi,
          expectedRole: "qkern_project_api_app",
          expectedDatabase: new URL(projectApiUrl!).pathname.slice(1),
          expectedLedgerOwner: "qkern",
        }) },
      );
      const templateContext = { organizationId: templateOrganization, actorRef: templateActor };
      const templateScope = { projectId: templateProject, environment: "development" as const };

      // --- Zusage 1: jede Vorlage laeuft ---
      expect(SQL_TEMPLATES.length).toBeGreaterThanOrEqual(10);
      const ran: string[] = [];
      const answers = new Map<string, Array<Record<string, unknown>>>();
      for (const template of SQL_TEMPLATES) {
        const statement = sqlTemplateStatement(template.id, template.parameters.length === 0
          ? {}
          : { schema, table: "vorlagen" });
        // Kein try/catch: ein Fehler soll diesen Fall rot machen und den Namen
        // der Vorlage nennen, nicht stillschweigend gezaehlt werden.
        const result = await service.queryReadOnly(templateContext, templateScope, statement, 25);
        expect(result.source, template.id).toBe("postgres");
        expect(result.maxRows, template.id).toBe(25);
        expect(result.rowCount, template.id).toBe(result.rows.length);
        expect(result.rowCount, template.id).toBeLessThanOrEqual(25);
        // Eine leere Menge hat keine Spalten; jede Zeile bringt welche mit.
        if (result.rows.length > 0) expect(result.columns.length, template.id).toBeGreaterThan(0);
        for (const row of result.rows) {
          expect(Object.keys(row).sort(), template.id).toEqual([...result.columns].sort());
        }
        ran.push(template.id);
        answers.set(template.id, result.rows);
      }
      expect(ran).toEqual(SQL_TEMPLATES.map((template) => template.id));

      // --- Die Antworten stehen wirklich im Katalog ---
      // Sonst waere "laeuft ohne Fehler" auch mit einer Vorlage zu haben, die
      // `SELECT 1 WHERE false` heisst.
      const countRows = answers.get("table-row-count") ?? [];
      expect(countRows).toHaveLength(1);
      expect(Number(countRows[0]?.exact_rows)).toBe(3);

      const indexRows = answers.get("table-index-usage") ?? [];
      const reportedIndexes = indexRows.map((row) => String(row.index_name)).sort();
      const realIndexes = await owner.query<{ relname: string }>(
        `SELECT idx.relname
         FROM pg_catalog.pg_index AS ind
         JOIN pg_catalog.pg_class AS idx ON idx.oid = ind.indexrelid
         WHERE ind.indrelid = ($1 || '.vorlagen')::regclass`, [`"${schema}"`]);
      expect(realIndexes.rows.length, "die Fixture-Tabelle hat keine Indizes").toBeGreaterThan(0);
      expect(reportedIndexes).toEqual(realIndexes.rows.map((row) => row.relname).sort());

      // Die Vorlage zur Statement-Statistik antwortet immer, und ihre Antwort
      // stimmt mit dem Katalog ueberein.
      const availability = answers.get("statement-statistics-available") ?? [];
      expect(availability).toHaveLength(1);
      expect(availability[0]?.statements_installed).toBe(true);
      expect(availability[0]?.database_name).toBe(new URL(projectApiUrl!).pathname.slice(1));

      // Die grossen Tabellen und die Schaetzungen des Planers kommen sortiert;
      // eine Vorlage, die das nicht einhielte, waere in der Ansicht irrefuehrend.
      const sizes = (answers.get("largest-tables") ?? []).map((row) => Number(row.total_bytes));
      // Absteigend, und NULL zaehlt als 0 am Ende: In der CI hat eine frisch
      // angelegte Tabelle Groesse NULL, und PostgreSQL sortiert NULL bei DESC
      // ohne `NULLS LAST` nach vorn. Die Vorlage sagt das jetzt ausdruecklich.
      expect([...sizes].sort((left, right) => right - left)).toEqual(sizes);
      const estimates = (answers.get("planner-row-estimates") ?? [])
        .map((row) => Number(row.estimated_rows));
      expect([...estimates].sort((left, right) => right - left)).toEqual(estimates);

      // Keine Antwort traegt einen Abfragetext. Die Vorlagen lesen die Spalte
      // `query` nicht, und genau das ist hier die Probe darauf.
      const serialised = JSON.stringify([...answers.values()]);
      expect(serialised).not.toContain("SELECT ");
      expect(serialised).not.toContain("GRANT ");

      // --- Zusage 2: die Datenbank ist unveraendert ---
      const after = await fingerprint();
      expect(after).toBe(before);
      const counters = (JSON.parse(after) as { counters: { updated: string; deleted: string } }).counters;
      expect(counters.updated).toBe("0");
      expect(counters.deleted).toBe("0");
    } finally {
      await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await projectApi.end();
    }
  }, 120_000);

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
          // Der Name muss dem Muster des Validators folgen, sonst lehnt er den Anbieter ab.
          clientSecretEnv: "QKERN_PROJECT_AUTH_OIDC_SECRET_TRUSTING",
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
        // Fuenf Felder seit 2.67, und keines davon ist ein Text: eine Kennung
        // aus Ziffern und vier Zaehler. Ein Abfragetext hat hier keine Stelle.
        expect(Object.keys(digest).sort()).toEqual(["calls", "id", "meanTimeUs", "rows", "totalTimeMs"]);
        expect(digest.id).toMatch(/^-?[0-9]{1,20}$/);
        expect(Number.isInteger(digest.calls) && digest.calls > 0).toBe(true);
        expect(Number.isInteger(digest.totalTimeMs) && digest.totalTimeMs >= 0).toBe(true);
        expect(Number.isInteger(digest.meanTimeUs) && digest.meanTimeUs >= 0).toBe(true);
        expect(Number.isInteger(digest.rows) && digest.rows >= 0).toBe(true);
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

  it("(2.67) shows what a query costs in the console without showing the query", async () => {
    // Die Seite Berichte -> Abfrage-Leistung (2.67) gegen die echte Datenbank.
    //
    // Gelesen wird durch die Tuer des Produkts: `inspectStatements` mit
    // Organisation, Akteur und Scope, dieselbe Methode, die die Route
    // `database/statements` aufruft. Der Fall baut weder eine eigene Abfrage
    // noch eine eigene Projektion noch einen eigenen Filter; er stellt eine
    // Last her, liest durch das Produkt und rechnet mit denselben reinen
    // Funktionen nach, die die Ansicht benutzt.
    //
    // Die Gegenprobe kommt aus der Sicht selbst: Ein Statement mit einer
    // eindeutigen Form wird mehrfach ausgefuehrt, danach steht in
    // `pg_stat_statements`, was es gekostet hat, und die Antwort des Produkts
    // muss genau diese Zahlen tragen. Damit faellt der Fall, wenn jemand die
    // Sortierung dreht, die Grenze verschiebt oder eine Spalte vertauscht.
    //
    // Was der Fall ausserdem festhaelt: Die Antwort traegt weiterhin keinen
    // Abfragetext. 2.57 hat das fuer drei Felder belegt, 2.67 fuegt zwei
    // hinzu, und die Zusage gilt fuer alle fuenf.
    expect(projectApiUrl, "QKERN_TEST_PROJECT_API_DATABASE_URL fehlt").toBeTruthy();
    const perfOwner = randomUUID();
    const perfOrganization = randomUUID();
    const perfProject = randomUUID();
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [perfOwner, `queryperf-2-67-owner-${perfOwner}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Query performance 2.67', $2, $3)`,
    [perfOrganization, `queryperf-2-67-${perfOrganization}`, perfOwner]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Query performance 2.67', $3, 'test', 'ready', $4)`,
    [perfProject, perfOrganization, `queryperf-2-67-${perfProject}`, perfOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [perfOrganization, perfProject, `managed:${perfProject}`]);

    const projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
    const projectDatabase = new URL(projectApiUrl!).pathname.slice(1);
    try {
      const installed = await owner.query<{ present: boolean }>(
        "SELECT to_regclass('pg_stat_statements') IS NOT NULL AS present");
      expect(installed.rows[0]?.present,
        "pg_stat_statements fehlt; der Stack laedt sie ueber shared_preload_libraries").toBe(true);

      // Eine Last mit eindeutiger Form, ausgefuehrt von der Leserolle selbst,
      // damit PostgreSQL die Zeile mit `queryid` zeigt. Der Schlaf ist die
      // Zeit, die dieses Statement nachweislich kostet: ohne messbare Zeit
      // gaebe es keinen Mittelwert und keinen Anteil zu pruefen. Vier Aufrufe
      // zu 0,3 Sekunden liegen deutlich ueber einer Millisekunde und deutlich
      // unter einer Sekunde, und genau das prueft die Einheit unten.
      const CALLS = 4;
      for (let round = 0; round < CALLS; round += 1) {
        await projectApi.query(
          "SELECT pg_sleep($1), count(*) FROM pg_catalog.pg_class WHERE oid > $2 AND relkind <> $3",
          [0.3, round, "x"]);
      }

      const service = new ProjectDataPlaneService(
        { resolveTarget: async () => ({ databaseInstanceRef: "managed:certification" }) },
        { resolve: async () => ({
          pool: projectApi,
          expectedRole: "qkern_project_api_app",
          expectedDatabase: projectDatabase,
          expectedLedgerOwner: "qkern",
        }) },
      );
      const result = await service.inspectStatements(
        { organizationId: perfOrganization, actorRef: "queryperf-2-67@qkern.test" },
        { projectId: perfProject, environment: "development" },
      );

      expect(result.source).toBe("postgres");
      expect(result.installed).toBe(true);
      expect(result.statements.length).toBeGreaterThan(0);
      // Die Grenze des Dienstes: hoechstens 50 Zeilen, und `truncated` sagt,
      // ob es mehr gab.
      expect(result.statements.length).toBeLessThanOrEqual(50);

      // Die Gegenprobe: dieselben Zeilen, direkt aus der Sicht gelesen, mit
      // demselben Mandantenfilter, den der Produktcode fahren muss. Gefragt
      // wird mit Parametern, damit dieser Text nicht selbst zum Marker wird.
      const truth = await owner.query<{
        statement_id: string; calls: string; total_exec_time: number;
        mean_exec_time: number; rows: string; visible: string;
      }>(`SELECT stat.queryid::text AS statement_id, stat.calls::text AS calls,
                 stat.total_exec_time AS total_exec_time, stat.mean_exec_time AS mean_exec_time,
                 stat.rows::text AS rows,
                 (SELECT count(*)::text FROM pg_stat_statements AS all_rows
                  WHERE all_rows.dbid = stat.dbid AND all_rows.queryid IS NOT NULL) AS visible
          FROM pg_stat_statements AS stat
          WHERE stat.dbid = (SELECT database.oid FROM pg_catalog.pg_database AS database
                             WHERE database.datname = $1)
            AND stat.query LIKE $2`, [projectDatabase, "%pg_sleep%relkind%"]);
      expect(truth.rows.length,
        "Das erzeugte Statement steht nicht in der Sicht; dann prueft dieser Fall nichts.").toBe(1);
      const mirror = truth.rows[0];
      const visible = Number(mirror.visible);

      // `truncated` ist keine Vermutung: Es stimmt mit der Zahl der Zeilen
      // ueberein, die die Sicht fuer diese Datenbank haelt.
      expect(result.truncated).toBe(visible > result.statements.length);

      // Absteigend nach Gesamtzeit, wie der Dienst bestellt. Eine gedrehte
      // Sortierung faellt hier auf.
      for (let index = 1; index < result.statements.length; index += 1) {
        expect(result.statements[index - 1].totalTimeMs,
          `Zeile ${index} steht vor einer teureren`)
          .toBeGreaterThanOrEqual(result.statements[index].totalTimeMs);
      }

      // Das teure Statement steht in der Liste, und zwar mit genau den Zahlen
      // der Sicht. Es hat gut eine Sekunde gekostet; ueber der Grenze von 50
      // Zeilen faellt es in dieser Datenbank nicht heraus.
      const mine = result.statements.find((entry) => entry.id === mirror.statement_id);
      expect(mine, "Das teure Statement fehlt in der Antwort").toBeDefined();
      expect(mine!.calls).toBe(CALLS);
      expect(mine!.calls).toBe(Number(mirror.calls));
      expect(mine!.totalTimeMs).toBe(Math.floor(mirror.total_exec_time));
      expect(mine!.meanTimeUs).toBe(Math.floor(mirror.mean_exec_time * 1000));
      expect(mine!.rows).toBe(Number(mirror.rows));

      // Und dieselben reinen Funktionen, mit denen die Ansicht rechnet, ueber
      // der unveraenderten Antwort.
      const sumTotalMs = result.statements.reduce((sum, entry) => sum + entry.totalTimeMs, 0);
      const share = timeShare(mine!.totalTimeMs, sumTotalMs);
      expect(share).not.toBeNull();
      expect(share!).toBeGreaterThan(0);
      expect(share!).toBeLessThanOrEqual(1);
      // Jeder Aufruf liefert genau eine Zeile; die Spalte `rows` ist die
      // Summe darueber. Eine vertauschte Projektion faellt hier auf.
      expect(rowsPerCall(mine!.rows, mine!.calls)).toBe(1);
      // 0,3 Sekunden je Aufruf: mehr als eine Millisekunde, weniger als eine
      // Sekunde. Die Ansicht zeigt das darum in Millisekunden.
      const mean = duration(mine!.meanTimeUs);
      expect(mean.unit).toBe("Millisekunden");
      expect(mean.value).toBeGreaterThan(300);
      const total = durationFromMilliseconds(mine!.totalTimeMs);
      expect(total.unit).toBe("Sekunden");
      expect(total.value).toBeGreaterThan(1.2);

      // Die Zusage aus 2.57, jetzt ueber fuenf Felder: kein Feld der Antwort
      // traegt den Text irgendeines Statements.
      const serialised = JSON.stringify(result);
      expect(serialised.toLowerCase()).not.toContain("select");
      expect(serialised.toLowerCase()).not.toContain("pg_");
      expect(serialised.toLowerCase()).not.toContain("relkind");
      for (const digest of result.statements) {
        expect(Object.keys(digest).sort()).toEqual(["calls", "id", "meanTimeUs", "rows", "totalTimeMs"]);
        expect(digest.id).toMatch(/^-?[0-9]{1,20}$/);
      }
    } finally {
      await projectApi.end();
    }
    // Budget: vier Aufrufe zu 0,3 Sekunden plus Verbindungsaufbau gegen eine
    // echte Datenbank. 120 Sekunden lassen Luft fuer einen langsamen Stack,
    // ohne dass eine Erwartung weicher wird.
  }, 120_000);

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

  it("(2.63) forwards only the fields the console already shows", async () => {
    // Die Grenze des Log-Drain-Slices (2.54) an echten Zeilen: Was hinausgeht,
    // muss genau die Projektion der Console-Ansicht sein.
    //
    // Der Vertrag `tests/log-drain-field-boundary` vergleicht Listen am
    // Quelltext. Er kann nicht sagen, ob die Zeile aus der Datenbank wirklich
    // so aussieht -- ob also `invoked_by` beim Lesen tatsaechlich wegfaellt,
    // ob die Huelle wirklich ohne Ziel und ohne Referenz in der Outbox landet
    // und ob der Zusteller sie mit dem Schluessel aus einem echten Vault
    // signiert. Genau das laeuft hier, und zwar ueber die echte
    // Produktkette: `FunctionInvocationService` schreibt das Protokoll aus
    // 0045, `PostgresLogDrainSourceReader` liest es, `LogDrainCollector`
    // buendelt, `WebhookOutbox` reiht ein, `WebhookDeliveryRuntime` stellt zu.
    //
    // Der Lackmustest ist `invokedBy`: Die Console **zeigt** dieses Feld, und
    // es traegt hier die E-Mail-Adresse des Administrators. Im gesendeten
    // Koerper darf sie nirgends stehen.
    //
    // Der Stack: PostgreSQL, weil der Fall eine echte Control Plane **und**
    // einen echten Vault gleichzeitig braucht. Der Vault-Stack hat keine
    // Datenbank; seit 2.50 laeuft im PostgreSQL-Stack ein Vault, genau aus
    // diesem Grund.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.50, 2.53 und 2.59: Das
    // gemeinsame afterAll muss organizationA und organizationB loswerden, und
    // eine Organisation mit unloeschbaren Zeilen darunter blockiert das.
    // Abgeraeumt wird nur, was das Produkt hergibt -- und das ist hier nichts:
    // `project_function_invocations` ist append-only, und die Drain-Flaeche
    // loescht ausdruecklich nicht.
    expect(vaultKvUrl, "QKERN_TEST_VAULT_KV_URL fehlt").toBeTruthy();
    expect(vaultTokenFile, "QKERN_TEST_VAULT_TOKEN_FILE fehlt").toBeTruthy();
    expect(databaseWebhookSecretRef, "QKERN_TEST_DATABASE_WEBHOOK_SECRET_REF fehlt").toBeTruthy();

    const drainOwner = randomUUID();
    const drainOrganization = randomUUID();
    const drainProject = randomUUID();
    // Die Adresse ist der Lackmustest. `project_function_invocations.invoked_by`
    // nimmt sie auf, die Console zeigt sie, und der Drain darf sie nicht tragen.
    const actorRef = `log-drain-${drainOwner}@qkern.test`;

    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`, [drainOwner, actorRef]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Log Drains', $2, $3)`,
    [drainOrganization, `log-drains-${drainOrganization}`, drainOwner]);
    await owner.query(`INSERT INTO organization_members
      (organization_id, user_id, role, is_personal_workspace)
      VALUES ($1, $2, 'owner', true)`, [drainOrganization, drainOwner]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Log Drains', $3, 'test', 'ready', $4)`,
    [drainProject, drainOrganization, `log-drains-${drainProject}`, drainOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`,
    [drainOrganization, drainProject, `managed:${drainProject}`]);

    const scope = {
      organizationId: drainOrganization, projectId: drainProject, environment: "development" as const,
    };
    const admin = {
      organizationId: drainOrganization, actorRef, role: "admin" as const, subject: drainOwner,
    };
    const control = new PostgresControlPlane(runtime);
    const drains = new PostgresLogDrainRepository(control);

    // Die Definition ueber den echten Dienst, mit der echten Pruefung. Zwei
    // Quellen: eine mit Zeilen, eine ohne. Ohne die zweite bewiese der Fall
    // nichts darueber, dass je Quelle gebuendelt wird.
    const drain = await new LogDrainService({ repository: drains }).create(admin, scope, {
      name: "logs-an-siem",
      url: "https://siem.example.com/qkern/logs",
      sources: ["auth_audit", "function_invocations"],
      signingSecretRef: databaseWebhookSecretRef!,
    });
    expect(drain.sources).toEqual(["auth_audit", "function_invocations"]);
    expect(drain.eventTypes).toEqual(["log.auth_audit", "log.function_invocations"]);
    expect(drain.enabled).toBe(true);
    // Kein Geheimniswert, nirgends -- nur die Referenz.
    expect(JSON.stringify(drain)).not.toContain("secret\":\"");
    expect(drain.signingSecretRef).toBe(databaseWebhookSecretRef);

    const outboxRepository = new PostgresWebhookOutboxRepository(control);
    const collector = new LogDrainCollector({
      reader: new PostgresLogDrainSourceReader(control),
      drains,
      outbox: new WebhookOutbox({ repository: outboxRepository }),
      scope,
      maxBatchEntries: 2,
    });
    // Der erste Lauf setzt den Stand auf die Spitze: Ein neu angelegter Drain
    // schickt dem Empfaenger nicht als erste Handlung die Vergangenheit.
    expect(await collector.poll()).toBe(0);

    // Jetzt entstehen die Zeilen, ueber den echten Aufrufdienst. Nur die
    // Sandbox ist ersetzt; sie ist im Functions-Stack eigens zertifiziert.
    const definitions = new ComputeDefinitionService({
      repository: new PostgresComputeDefinitionRepository(control),
    });
    const image = `registry.example.com/qkern/probe@sha256:${"c".repeat(64)}`;
    const suffix = randomUUID().slice(0, 8);
    const probe = await definitions.createFunction(admin, scope, {
      name: `drain-probe-${suffix}`, image, entrypoint: "handler.mjs",
      secretRefs: [], enabled: true,
    });
    // Was ein Container drucken wuerde. 0045 speichert es nicht, und der Drain
    // kann es darum auch nicht tragen -- geprueft wird es trotzdem.
    const containerOutput = `stdout-${randomUUID()}`;
    const invocations = new PostgresComputeDefinitionRepository(control);
    const invoker = new FunctionInvocationService({
      repository: invocations, invocationLog: invocations,
      invoker: {
        async invoke() {
          return Object.freeze({ statusCode: 201, headers: {}, body: { printed: containerOutput } });
        },
      },
    });
    await invoker.invoke(admin, scope, probe.name, { probe: containerOutput });
    await invoker.invoke(admin, scope, probe.name, { probe: containerOutput });

    // Die Console zeigt beide Zeilen -- **mit** der Adresse des Aufrufers.
    const shown = await definitions.readFunctionInvocationLog(admin, scope, { limit: 10 });
    expect(shown.rows).toHaveLength(2);
    expect(shown.rows[0].invokedBy).toBe(actorRef);

    // Und jetzt der Drain.
    expect(await collector.poll()).toBe(1);

    const pending = await owner.query<{
      event_type: string; status: string; payload: Record<string, unknown>;
    }>(`SELECT event_type, status, payload FROM project_webhook_deliveries
         WHERE organization_id = $1 AND project_id = $2`, [drainOrganization, drainProject]);
    // Genau eine Ladung: Die zweite Quelle hat keine Zeilen, und eine leere
    // Ladung waere eine Behauptung ueber nichts.
    expect(pending.rows).toHaveLength(1);
    expect(pending.rows[0].event_type).toBe("log.function_invocations");
    expect(pending.rows[0].status).toBe("pending");
    expect(Object.keys(pending.rows[0].payload).sort())
      .toEqual(["count", "entries", "schemaVersion", "source"]);

    const entries = pending.rows[0].payload.entries as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(2);
    // Der Kern des Falls: Feld fuer Feld genau die Liste, die die Console zeigt.
    for (const entry of entries) {
      expect(Object.keys(entry).sort())
        .toEqual([...LOG_DRAIN_SOURCE_DEFINITIONS.function_invocations.fields].sort());
      expect(entry.functionName).toBe(probe.name);
      expect(entry.outcome).toBe("completed");
      expect(entry.statusCode).toBe(201);
      expect(entry.errorCode).toBeNull();
    }
    const stored = JSON.stringify(pending.rows[0].payload);
    expect(stored, "die Ladung traegt die Adresse des Aufrufers").not.toContain(actorRef);
    expect(stored, "die Ladung traegt die Ausgabe des Containers").not.toContain(containerOutput);
    expect(stored, "die Ladung traegt das Ziel").not.toContain("siem.example.com");
    expect(stored, "die Ladung traegt die Geheimnisreferenz")
      .not.toContain(databaseWebhookSecretRef!);

    // Der echte Zustellprozess mit dem echten Signierer und dem echten Vault.
    const secrets = new VaultWebhookSecretProvider({
      vaultKvUrl: new URL(vaultKvUrl!),
      tokenProvider: new VaultTokenFileProvider(vaultTokenFile!),
      cacheTtlMs: 0,
    });
    const sent: Array<{ headers: Record<string, string>; body: string; url: string }> = [];
    const delivery = new WebhookDeliveryRuntime({
      outbox: new WebhookOutbox({ repository: outboxRepository }),
      definitions: outboxRepository,
      deliverer: new WebhookDeliverer(new HmacWebhookSigner(secrets), {
        // Der Empfaenger ist die eine nachgebaute Stelle: Er bestaetigt die
        // Zustellung so, wie der Vertrag es verlangt, und haelt fest, was
        // wirklich gesendet wurde.
        send: async (request) => {
          sent.push({ headers: { ...request.headers }, body: request.body, url: request.url });
          return { status: 200, acknowledgementId: request.headers["x-qkern-delivery-id"] ?? null };
        },
      }),
      scope,
      workerId: "certification-log-drains-1",
    });
    expect(await delivery.runOnce(), "der Zustellprozess hat nicht zugestellt")
      .toMatchObject({ delivered: 1, failed: 0, skipped: 0 });
    expect(sent).toHaveLength(1);

    const delivered = sent[0];
    expect(delivered.url).toBe("https://siem.example.com/qkern/logs");
    expect(delivered.headers["x-qkern-event"]).toBe("log.function_invocations");
    // Dieselbe Grenze noch einmal, aber am wirklich gesendeten Koerper: Was
    // die Datenbank nicht traegt, koennte der Zusteller immer noch ergaenzt
    // haben.
    expect(delivered.body).not.toContain(actorRef);
    expect(delivered.body).not.toContain(containerOutput);
    expect(delivered.body).toContain(probe.name);
    const body = JSON.parse(delivered.body) as { data: { entries: Array<Record<string, unknown>> } };
    for (const entry of body.data.entries) {
      expect(Object.keys(entry).sort())
        .toEqual([...LOG_DRAIN_SOURCE_DEFINITIONS.function_invocations.fields].sort());
    }

    // Die Gegenrechnung: der Schluessel aus dem Vault, die Pruefung ohne den
    // Signierer. Eine Signatur, die nur gegen sich selbst stimmt, waere keine.
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

    // --- Dieselbe Zeile nur einmal, auch wenn die Datenbank den Zeitpunkt
    // setzt ------------------------------------------------------------------
    //
    // Das Aufrufprotokoll allein kann diese Zusage nicht pruefen: Dort schreibt
    // ein JavaScript-Zeitpunkt, und dessen Mikrosekunden sind immer null. In
    // `audit_logs` setzt die Datenbank `now()`, und dort waren sie es nicht.
    // Genau daran hing ein ausgelieferter Fehler: Die Position einer Zeile kam
    // aus einem JavaScript-`Date` und war damit auf Millisekunden gekuerzt,
    // also **kleiner** als die Zeile selbst. Der Zeilenvergleich `(zeit, id) >
    // (zeit, id)` liess dieselbe Zeile bei jedem Lauf wieder durch, und der
    // Empfaenger bekam sie Lauf fuer Lauf erneut.
    // Zwei Zeilen, nicht eine: Der Sammler dieses Falls fuellt eine Ladung bei
    // zwei Eintraegen (`maxBatchEntries: 2`), und eine halbe Ladung wartet auf
    // ihr Zeitfenster. Das ist kein Kniff des Falls, sondern die Buendelung des
    // Produkts.
    const auditSink = new PostgresProjectAuthAuditSink(auth);
    const drainAppUser = randomUUID();
    for (const status of ["succeeded", "failed"] as const) {
      await auditSink.record({
        scope, action: `project_auth.login.${status}`, actorType: "app_user",
        actorRef: `project_auth_user:${drainAppUser}`,
        resourceRef: `project_auth_user:${drainAppUser}`, status,
      });
    }
    // Die Gegenprobe zuerst: Die Datenbank hat wirklich Mikrosekunden gesetzt,
    // sonst prueft der Rest dieses Abschnitts nichts.
    const auditMoment = await owner.query<{ micros: string }>(
      `SELECT to_char(created_at, 'US') AS micros FROM audit_logs
        WHERE organization_id = $1 AND project_id = $2
          AND starts_with(action, 'project_auth.login.')
        ORDER BY created_at`,
      [drainOrganization, drainProject]);
    expect(auditMoment.rows).toHaveLength(2);
    expect(auditMoment.rows.some((row) => !/000$/.test(row.micros)),
      "die Datenbank hat keinen Zeitpunkt mit Mikrosekunden gesetzt").toBe(true);

    expect(await collector.poll(), "die Audit-Zeile ging nicht hinaus").toBe(1);
    const afterAudit = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM project_webhook_deliveries
        WHERE organization_id = $1 AND project_id = $2 AND event_type = 'log.auth_audit'`,
      [drainOrganization, drainProject]);
    expect(afterAudit.rows[0]?.n).toBe("1");

    // Und jetzt der Kern, und zwar am Leser und nicht am Sammler. Ein zweiter
    // Lauf des Sammlers ist dafuer zu stumpf: Eine wieder hereingelesene Zeile
    // legt sich in den Puffer und wartet dort auf ihr Zeitfenster, der Lauf
    // meldet 0, und der Fehler bliebe unsichtbar. Geprueft wird darum die
    // Zusage selbst: Die Position einer Zeile schliesst diese Zeile aus.
    const auditReader = new PostgresLogDrainSourceReader(control);
    const auditRows = await auditReader.read(scope, "auth_audit", { after: null, limit: 10 });
    expect(auditRows).toHaveLength(2);
    const lastCursor = auditRows[auditRows.length - 1].cursor;
    expect(await auditReader.read(scope, "auth_audit", { after: lastCursor, limit: 10 }),
      "der Leser gibt die Zeile wieder heraus, aus der ihre eigene Position stammt")
      .toEqual([]);
    // Und dieselbe Probe eine Zeile weiter vorn: Von zwei Zeilen darf die
    // Position der ersten genau die zweite uebriglassen.
    const afterFirstRow = await auditReader.read(
      scope, "auth_audit", { after: auditRows[0].cursor, limit: 10 });
    expect(afterFirstRow.map((row) => row.cursor)).toEqual([lastCursor]);

    // Der Sammler bleibt trotzdem geprueft: ohne neue Zeile keine neue Ladung.
    expect(await collector.poll(), "dieselbe Audit-Zeile ging ein zweites Mal hinaus").toBe(0);
    const afterSecondPoll = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM project_webhook_deliveries
        WHERE organization_id = $1 AND project_id = $2 AND event_type = 'log.auth_audit'`,
      [drainOrganization, drainProject]);
    expect(afterSecondPoll.rows[0]?.n,
      "dieselbe Audit-Zeile liegt zweimal in der Outbox").toBe("1");

    // Abgeschaltet sammelt der Drain nichts Neues. Der dritte Aufruf steht im
    // Protokoll und bleibt dort -- das ist der Unterschied zwischen pausieren
    // und stauen.
    await new LogDrainService({ repository: drains })
      .setEnabled(admin, scope, drain.id, false);
    await invoker.invoke(admin, scope, probe.name, { probe: containerOutput });
    expect(await collector.poll()).toBe(0);
    const afterDisable = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM project_webhook_deliveries
        WHERE organization_id = $1 AND project_id = $2`, [drainOrganization, drainProject]);
    // Zwei Ladungen, nicht eine: die des Aufrufprotokolls und die der
    // Audit-Zeile. Beide sind vor dem Abschalten entstanden.
    expect(afterDisable.rows[0]?.n).toBe("2");
    const stillLogged = await definitions.readFunctionInvocationLog(admin, scope, { limit: 10 });
    expect(stillLogged.rows).toHaveLength(3);
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

  it("(2.66) stores the console settings of a user and gives them back unchanged", async () => {
    // Die eigene Darstellung der Console (2.55) gegen die echte Datenbank.
    // Der Fall hat drei Zusagen, und keine davon liesse sich gegen einen
    // Nachbau pruefen:
    //
    // 1. Die Einstellung kommt unveraendert zurueck. Geschrieben wird mit dem
    //    Repository, das die Route benutzt, ueber die Anmelderolle
    //    `qkern_auth`; gelesen wird danach ein zweites Mal als Eigentuemer
    //    und mit Parametern. Nur eine echte Rolle kann zeigen, dass die
    //    Spaltenrechte aus 0055 wirklich reichen.
    // 2. Die Vorgaben und "keine Zeile" bedeuten dasselbe. Vor dem ersten
    //    Schreiben antwortet das Repository mit `CONSOLE_DISPLAY_DEFAULTS`,
    //    und genau das ist das Verhalten vor 2.55.
    // 3. Die Datenbank weist ab, was die Console nicht darstellen kann. Der
    //    CHECK aus 0055 wird als Eigentuemer geprobt, also ohne den Dienst
    //    dazwischen; gegen einen Nachbau waere das die Pruefung des Nachbaus.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.59, 2.62 und 2.63: Das
    // gemeinsame afterAll muss organizationA und organizationB loswerden, und
    // dieser Fall soll ihm dabei nicht im Weg stehen. Geloescht wird nur, was
    // das Produkt loescht; Nutzer, Organisation und die eine Einstellungszeile
    // bleiben als erwarteter Rest im Wegwerf-Stack.
    const displayOwner = randomUUID();
    const displayOther = randomUUID();
    const displayOrganization = randomUUID();
    await owner.query(`INSERT INTO users (id, email, password_hash, status) VALUES
        ($1, $2, '$argon2id$integration-only', 'active'),
        ($3, $4, '$argon2id$integration-only', 'active')`,
    [displayOwner, `display-2-66-owner-${displayOwner}@qkern.test`,
      displayOther, `display-2-66-other-${displayOther}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Display 2.66', $2, $3)`,
    [displayOrganization, `display-2-66-${displayOrganization}`, displayOwner]);

    const repository = new PostgresConsoleDisplaySettingsRepository(auth);

    // --- Zusage 2: keine Zeile heisst die Vorgaben ---
    expect(await repository.find(displayOwner)).toEqual(CONSOLE_DISPLAY_DEFAULTS);

    // --- Zusage 1: geschrieben, unveraendert zurueck ---
    const chosen: ConsoleDisplaySettings = {
      language: "fr", formatLocale: "fr-CH", timeZone: "Asia/Singapore",
      startView: "logs", theme: "dark",
    };
    expect(await repository.save(displayOwner, chosen)).toEqual(chosen);
    expect(await repository.find(displayOwner)).toEqual(chosen);

    // Und die Zeile steht wirklich so in der Tabelle, als Eigentuemer gelesen.
    const stored = await owner.query<{
      language: string; format_locale: string; time_zone: string;
      start_view: string; theme: string; created_at: Date; updated_at: Date;
    }>(`SELECT language, format_locale, time_zone, start_view, theme, created_at, updated_at
          FROM user_console_settings WHERE user_id = $1`, [displayOwner]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].language).toBe("fr");
    expect(stored.rows[0].format_locale).toBe("fr-CH");
    expect(stored.rows[0].time_zone).toBe("Asia/Singapore");
    expect(stored.rows[0].start_view).toBe("logs");
    expect(stored.rows[0].theme).toBe("dark");

    // Ein zweites Speichern aendert dieselbe Zeile und ruehrt `created_at`
    // nicht an; der Trigger aus 0055 setzt `updated_at`.
    const again = await repository.save(displayOwner, { ...chosen, theme: "light", timeZone: "UTC" });
    expect(again).toEqual({ ...chosen, theme: "light", timeZone: "UTC" });
    const second = await owner.query<{ rows: string; created_at: Date; updated_at: Date }>(
      `SELECT count(*)::text AS rows, min(created_at) AS created_at, max(updated_at) AS updated_at
         FROM user_console_settings WHERE user_id = $1`, [displayOwner]);
    expect(second.rows[0].rows).toBe("1");
    expect(new Date(second.rows[0].created_at).getTime())
      .toBe(new Date(stored.rows[0].created_at).getTime());
    expect(new Date(second.rows[0].updated_at).getTime())
      .toBeGreaterThanOrEqual(new Date(stored.rows[0].updated_at).getTime());

    // Die Darstellung der einen Person ist nicht die der anderen.
    expect(await repository.find(displayOther)).toEqual(CONSOLE_DISPLAY_DEFAULTS);

    // --- Zusage 3: die Datenbank weist ab, was die Console nicht kann ---
    for (const [column, value] of [
      ["language", "es"], ["format_locale", "de-AT"], ["theme", "sepia"],
      ["time_zone", "kein zonenname mit leerzeichen"], ["start_view", "Nicht Erlaubt"],
    ] as const) {
      await expect(owner.query(
        `INSERT INTO user_console_settings (user_id, ${column}) VALUES ($1, $2)`,
        [displayOther, value],
      ), `${column} = ${value}`).rejects.toBeTruthy();
    }
    expect((await owner.query(
      "SELECT count(*)::text AS rows FROM user_console_settings WHERE user_id = $1", [displayOther],
    )).rows[0]).toEqual({ rows: "0" });

    // Und die Anmelderolle hat weiterhin kein UPDATE auf `users`: Die eigene
    // Tabelle aus 0055 ist genau deshalb eine eigene.
    await expect(auth.query("UPDATE users SET status = 'disabled' WHERE id = $1", [displayOther]))
      .rejects.toBeTruthy();
  });
  it("(2.65) searches across the sources that have routes and says what it cannot reach", async () => {
    // Der Log-Explorer (2.65) an echten Zeilen zweier Quellen.
    //
    // Die Unit-Tests mischen erfundene Eintraege; sie koennen nicht sagen, ob
    // die Zeitpunkte, die **die Datenbank** setzt, dieselbe Ordnung ergeben.
    // Genau daran haengt der ganze Schnitt: `audit_logs.created_at` und
    // `project_function_invocations.started_at` kommen aus zwei Tabellen, mit
    // zwei Genauigkeiten und zwei Schreibwegen, und `started_at` wird als
    // `::text` gelesen. Liefen sie auseinander, saehe die gemischte Liste
    // richtig aus und waere falsch sortiert -- und das Blaettern uebersprunge
    // Eintraege, ohne dass es jemandem auffiele.
    //
    // Zweitens belegt der Fall die Eigenschaft, um die es diesem Schnitt geht:
    // Eine Quelle, die der Aufrufer nicht lesen darf, nimmt die anderen nicht
    // mit. Storage wird hier abgewiesen wie fuer eine Anmeldung ohne
    // `project_storage_admin`; Auth und Functions liefern trotzdem.
    //
    // Was der Fall **nicht** tut, ist der Punkt des Slices: Er stellt keine
    // Abfrage. Gelesen wird durch dieselben Dienste, die die vorhandenen
    // Routen benutzen.
    //
    // Der Stack: PostgreSQL. Eigene Organisation mit eigenem Besitzer, wie
    // 2.59, 2.62 und 2.63: Das gemeinsame afterAll muss organizationA und
    // organizationB loswerden, und eine Organisation mit Audit-Zeilen laesst
    // sich nicht loeschen. Abgeraeumt wird nichts -- `audit_logs` und
    // `project_function_invocations` sind append-only, und das ist richtig so.
    const explorerOwner = randomUUID();
    const explorerOrganization = randomUUID();
    const explorerProject = randomUUID();
    const actorRef = `log-explorer-${explorerOwner}@qkern.test`;

    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`, [explorerOwner, actorRef]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Log Explorer', $2, $3)`,
    [explorerOrganization, `log-explorer-${explorerOrganization}`, explorerOwner]);
    await owner.query(`INSERT INTO organization_members
      (organization_id, user_id, role, is_personal_workspace)
      VALUES ($1, $2, 'owner', true)`, [explorerOrganization, explorerOwner]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Log Explorer', $3, 'test', 'ready', $4)`,
    [explorerProject, explorerOrganization, `log-explorer-${explorerProject}`, explorerOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`,
    [explorerOrganization, explorerProject, `managed:${explorerProject}`]);

    const scope = {
      organizationId: explorerOrganization, projectId: explorerProject,
      environment: "development" as const,
    };
    const admin = {
      organizationId: explorerOrganization, actorRef, role: "admin" as const, subject: explorerOwner,
    };
    const control = new PostgresControlPlane(runtime);

    // Quelle eins: echte Eintraege der Audit-Kette, ueber den echten Sink.
    // `created_at` setzt die Datenbank (DEFAULT now()); die Kette ist
    // append-only, ein Zeitpunkt laesst sich nicht setzen.
    const sink = new PostgresProjectAuthAuditSink(auth);
    const appUser = randomUUID();
    for (const event of [
      { action: "project_auth.signup.succeeded", status: "succeeded" as const },
      { action: "project_auth.login.failed", status: "failed" as const },
    ]) {
      await sink.record({
        scope, action: event.action, actorType: "app_user",
        actorRef: `project_auth_user:${appUser}`,
        resourceRef: `project_auth_user:${appUser}`, status: event.status,
      });
    }

    // Quelle zwei: echte Zeilen des Aufrufprotokolls, ueber den echten
    // Aufrufdienst. Nur die Sandbox ist ersetzt; sie ist im Functions-Stack
    // eigens zertifiziert.
    const definitions = new ComputeDefinitionService({
      repository: new PostgresComputeDefinitionRepository(control),
    });
    const image = `registry.example.com/qkern/probe@sha256:${"e".repeat(64)}`;
    const probe = await definitions.createFunction(admin, scope, {
      name: `explorer-probe-${randomUUID().slice(0, 8)}`, image, entrypoint: "handler.mjs",
      secretRefs: [], enabled: true,
    });
    // Was ein Container drucken wuerde. 0045 speichert es nicht, und die
    // gemischte Liste kann es darum auch nicht zeigen -- geprueft wird es
    // trotzdem.
    const containerOutput = `stdout-${randomUUID()}`;
    const invocations = new PostgresComputeDefinitionRepository(control);
    const invoker = new FunctionInvocationService({
      repository: invocations, invocationLog: invocations,
      invoker: {
        async invoke() {
          return Object.freeze({ statusCode: 200, headers: {}, body: { printed: containerOutput } });
        },
      },
    });
    await invoker.invoke(admin, scope, probe.name, { probe: containerOutput });
    await invoker.invoke(admin, scope, probe.name, { probe: containerOutput });

    // Der Faecher, mit genau den Lesungen der Route. Nicht mit nachgebauten:
    // `log-explorer-fetchers` ist dieselbe Datei, die die Route benutzt, und
    // eingesetzt wird hier allein die Tuer. Ein Nachbau hatte die Projektion
    // und den Filter ein zweites Mal formuliert -- und genau daran ist dieser
    // Fall einmal vorbeigelaufen: Der Filter `authStatus` stand in der Route,
    // im Fall gar nicht, und beide waren gruen.
    const { privateKey: explorerKey } = generateKeyPairSync("ed25519");
    const authService = new ProjectAuthService({
      repository: new PostgresProjectAuthRepository(auth),
      audit: sink,
      passwords: new Argon2idPasswordHasher({}),
      rateLimiter: new InMemoryRateLimiter(),
      tokens: new ProjectAuthTokenService({ kid: "certification-2-65", privateKey: explorerKey }, "https://qkern.test"),
      mfa: new ProjectAuthTotp(),
      secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 11)),
      delivery: new NoopDevelopmentProjectAuthDelivery(),
      oidcCatalog: new ProjectAuthOidcCatalog([]),
      oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
      callbackBaseUrl: "https://qkern.test",
      allowedRedirectOrigins: new Set(["https://app.test"]),
    });
    // Storage wird abgewiesen wie fuer eine Anmeldung ohne die Rolle: Die Tuer
    // wirft, und zwar den Fehler, den die Route dort wirklich bekommt. Dass
    // die Lesung dahinter nie stattfindet, ist die Zusage, und sie wird
    // gezaehlt statt geglaubt.
    let storageReads = 0;
    // Die Suche gehoert in den Faecher, nicht daneben: Die Route baut die
    // Lesungen je Anfrage, weil der Filter in ihnen steckt. Der Fall macht es
    // genauso und kann darum drei verschiedene Suchen stellen.
    const fan = (search: LogExplorerQuery) => ({
      auth_audit: authAuditFetcher(async () => scope, authService, search),
      function_invocations: functionInvocationFetcher(
        async () => ({ principal: admin, scope }), definitions, search),
      storage_objects: storageObjectFetcher(
        async () => { throw new RequestAuthorizationError(); },
        { readObjectLog: async () => { storageReads += 1; throw new Error("not expected"); } },
        search),
    });

    const baseQuery = parseLogExplorerQuery({});
    const result = await searchLogSources(fan(baseQuery), baseQuery);

    // Zuerst der Zustand je Quelle, dann erst die Zahl. Die Reihenfolge steht
    // so, weil sie einmal gebraucht wurde: Eine Quelle, die wirft, faellt in
    // der gemischten Liste nur als fehlende Zeile auf, und eine Zahl sagt
    // nicht, welche der drei nicht geantwortet hat.
    expect(Object.fromEntries(result.sources.map((report) => [report.id, report.state])))
      .toEqual({ auth_audit: "ok", function_invocations: "ok", storage_objects: "forbidden" });

    // Vier echte Zeilen aus zwei Tabellen, in einer Liste.
    expect(result.entries).toHaveLength(4);
    expect(result.entries.filter((entry) => entry.source === "auth_audit")).toHaveLength(2);
    expect(result.entries.filter((entry) => entry.source === "function_invocations")).toHaveLength(2);

    // Der Kern: Die Ordnung stimmt ueber die Tabellengrenze hinweg. Verglichen
    // wird gegen die Zeitpunkte, die die Datenbank selbst gesetzt hat.
    const moments = result.entries.map((entry) => entry.at);
    expect([...moments].sort().reverse()).toEqual(moments);
    for (const moment of moments) {
      expect(moment, "Zeitpunkt nicht in einer Schreibweise")
        .toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }

    // Die Zeilen tragen keine Ausgabe eines Containers und keine Adresse --
    // `invoked_by` steht in 0045 und ist genau diese Adresse.
    const shown = JSON.stringify(result.entries);
    expect(shown, "die Liste traegt die Ausgabe des Containers").not.toContain(containerOutput);
    expect(shown, "die Liste traegt die Adresse des Aufrufers").not.toContain(actorRef);
    // Die Gegenprobe: Die Lesung selbst haette sie.
    const raw = await definitions.readFunctionInvocationLog(admin, scope, { limit: 10 });
    expect(raw.rows[0].invokedBy).toBe(actorRef);

    // Blaettern ueber die Quellgrenze hinweg: jede Zeile genau einmal.
    const seen: string[] = [];
    let before: string | null = null;
    for (let round = 0; round < 8; round += 1) {
      const pageQuery = parseLogExplorerQuery({ limit: "1", ...(before ? { before } : {}) });
      const page = await searchLogSources(fan(pageQuery), pageQuery);
      seen.push(...page.entries.map((entry) => `${entry.source}:${entry.id}`));
      if (!page.hasMore || page.nextCursor === null) break;
      before = page.nextCursor;
    }
    expect(seen).toEqual(result.entries.map((entry) => `${entry.source}:${entry.id}`));
    expect(new Set(seen).size).toBe(seen.length);

    // Der getypte Filter wirkt an echten Zeilen.
    const failedQuery = parseLogExplorerQuery({ sources: "auth_audit", authStatus: "failed" });
    const failedOnly = await searchLogSources(fan(failedQuery), failedQuery);
    expect(failedOnly.entries).toHaveLength(1);
    expect(failedOnly.entries[0].action).toBe("project_auth.login.failed");

    // Und was der Explorer nicht erreicht, steht mit Grund da -- die
    // Webhook-Zustellungen, die Nutzung, die Cron-Vorkommen, die
    // Container-Ausgabe und die vier Logs ohne Backend.
    expect(LOG_EXPLORER_OUT_OF_REACH.length).toBeGreaterThanOrEqual(5);
    expect(LOG_EXPLORER_OUT_OF_REACH.map((entry) => entry.label))
      .toEqual(expect.arrayContaining(["Webhook-Zustellungen", "Cron-Vorkommen"]));

    // Und die abgewiesene Quelle ist wirklich abgewiesen worden, nicht bloss
    // leer: Ueber drei Suchen hinweg hat die Lesung dahinter nie stattgefunden.
    expect(storageReads, "die abgewiesene Quelle wurde doch gelesen").toBe(0);
  });

  /**
   * Der Sammler als **Prozess** (2.64).
   *
   * Der Fall (2.63) daneben belegt die Kette und ruft den Sammler dabei selbst
   * auf: `await collector.poll()`. Genau das ist der Unterschied, den dieser
   * Fall schliesst. Niemand ruft hier irgendetwas auf. Es laeuft `npm run
   * worker:compute` -- derselbe Prozess, den der Betrieb startet -- und die
   * Ladung entsteht, weil er sie erzeugt.
   *
   * Belegt werden vier Dinge, die eine Bibliothek nicht belegen kann:
   *
   * 1. Der Prozess findet die Umgebung und den Drain selbst. In der
   *    Konfiguration steht eine Scope-Liste, kein Drain; was gesammelt wird,
   *    entscheidet er aus der Control Plane.
   * 2. Er haelt seine Position dauerhaft, je Drain und Quelle. Nach dem
   *    zweiten Start entsteht **keine** zweite Ladung fuer denselben Aufruf,
   *    und der Aufruf aus der Pause geht nicht verloren -- kein Wiederholen,
   *    kein Ueberspringen.
   * 3. Er hoert auf dasselbe Signal wie die anderen Worker und endet sauber.
   * 4. Er ist danach wirklich aus: Ein Aufruf waehrend der Pause erzeugt
   *    nichts. Ein Fall, der nur das Ende des Kindprozesses prueft, koennte
   *    einen Prozess uebersehen, der weiterarbeitet.
   *
   * Eigene Organisation mit eigenem Besitzer, wie 2.53, 2.59 und 2.63: Das
   * gemeinsame afterAll muss organizationA und organizationB loswerden, und
   * eine Organisation mit Audit-Zeilen laesst sich wegen
   * audit_logs_organization_id_fkey nicht mehr loeschen. Abgeraeumt wird nur,
   * was das Produkt hergibt -- und das ist hier nichts:
   * `project_function_invocations` ist append-only, und die Drain-Flaeche
   * loescht ausdruecklich nicht.
   *
   * Das Zeitbudget ist ausdruecklich gross: Der Fall startet zweimal einen
   * echten Node-Prozess mit `tsx`, und jeder Start uebersetzt die Module neu.
   * Gewartet wird trotzdem nie blind -- jede Wartezeit hat eine Bedingung,
   * eine Frist und eine Meldung, die sagt, was stattdessen dastand.
   */
  it("(2.64) forwards through the running collector process and continues after a restart", async () => {
    expect(vaultKvUrl, "QKERN_TEST_VAULT_KV_URL fehlt").toBeTruthy();
    expect(vaultTokenFile, "QKERN_TEST_VAULT_TOKEN_FILE fehlt").toBeTruthy();
    expect(databaseWebhookSecretRef, "QKERN_TEST_DATABASE_WEBHOOK_SECRET_REF fehlt").toBeTruthy();

    const collectorOwner = randomUUID();
    const collectorOrganization = randomUUID();
    const collectorProject = randomUUID();
    // Die Adresse steht in `project_function_invocations.invoked_by`, die
    // Console zeigt sie, und weder die Ladung noch das Log des Prozesses darf
    // sie tragen.
    const actorRef = `drain-process-${collectorOwner}@qkern.test`;

    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`, [collectorOwner, actorRef]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Drain Process', $2, $3)`,
    [collectorOrganization, `drain-process-${collectorOrganization}`, collectorOwner]);
    await owner.query(`INSERT INTO organization_members
      (organization_id, user_id, role, is_personal_workspace)
      VALUES ($1, $2, 'owner', true)`, [collectorOrganization, collectorOwner]);
    await owner.query(`INSERT INTO projects
      (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Drain Process', $3, 'test', 'ready', $4)`,
    [collectorProject, collectorOrganization, `drain-process-${collectorProject}`, collectorOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`,
    [collectorOrganization, collectorProject, `managed:${collectorProject}`]);

    const scope = {
      organizationId: collectorOrganization, projectId: collectorProject,
      environment: "development" as const,
    };
    const admin = {
      organizationId: collectorOrganization, actorRef, role: "admin" as const,
      subject: collectorOwner,
    };
    const control = new PostgresControlPlane(runtime);

    // Der Drain ueber den echten Dienst. Er ist das Einzige, was dieser Fall
    // dem Prozess mitgibt -- seine Konfiguration nennt ihn nicht.
    const drains = new PostgresLogDrainRepository(control);
    const drain = await new LogDrainService({ repository: drains }).create(admin, scope, {
      name: "prozess-logs-an-siem",
      url: "https://siem.example.com/qkern/prozess-logs",
      sources: ["function_invocations"],
      signingSecretRef: databaseWebhookSecretRef!,
    });
    expect(drain.enabled).toBe(true);

    // Die Function, deren Aufrufe der Drain traegt. Nur die Sandbox ist
    // ersetzt; sie ist im Functions-Stack eigens zertifiziert.
    const definitions = new ComputeDefinitionService({
      repository: new PostgresComputeDefinitionRepository(control),
    });
    const image = `registry.example.com/qkern/probe@sha256:${"d".repeat(64)}`;
    const probe = await definitions.createFunction(admin, scope, {
      name: `drain-process-probe-${randomUUID().slice(0, 8)}`, image, entrypoint: "handler.mjs",
      secretRefs: [], enabled: true,
    });
    // Was ein Container drucken wuerde. 0045 speichert es nicht, der Drain
    // kann es darum nicht tragen -- geprueft wird es trotzdem.
    const containerOutput = `stdout-${randomUUID()}`;
    const repository = new PostgresComputeDefinitionRepository(control);
    const invoker = new FunctionInvocationService({
      repository, invocationLog: repository,
      invoker: {
        async invoke() {
          return Object.freeze({ statusCode: 201, headers: {}, body: { printed: containerOutput } });
        },
      },
    });

    const children: ReturnType<typeof spawn>[] = [];
    try {
      /** Der ausgelieferte Prozess, nichts daneben. */
      const start = () => {
        const child = spawn(process.execPath, ["--import", "tsx", "workers/compute-runtime.mts"], {
          cwd: process.cwd(),
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            NODE_ENV: "test",
            QKERN_COMPUTE_RUNTIME_ENABLED: "true",
            // Cron aus: Dieser Fall misst den Sammler, und ein Cron-Lauf
            // braeuchte eine Warteschlange, die hier nichts zu suchen hat.
            QKERN_COMPUTE_CRON_ENABLED: "false",
            QKERN_COMPUTE_WEBHOOKS_ENABLED: "true",
            // Die Bruecke aus: Sie braeuchte eine Projektdatenbank, der
            // Sammler nicht. Alle fuenf Quellen liegen in der Control Plane.
            QKERN_COMPUTE_DATABASE_WEBHOOKS_ENABLED: "false",
            QKERN_COMPUTE_LOG_DRAINS_ENABLED: "true",
            // Eine Zeile ist eine Ladung. Sonst wartete dieser Fall auf das
            // Altersfenster der Buendelung, und das misst er gar nicht.
            QKERN_COMPUTE_LOG_DRAIN_BATCH_ENTRIES: "1",
            QKERN_COMPUTE_LOG_DRAIN_POLL_MS: "200",
            QKERN_COMPUTE_LOG_DRAIN_DISCOVERY_MS: "1000",
            QKERN_COMPUTE_WORKER_ID: "certification-drains-1",
            // Die Scope-Liste nennt die Umgebung, nicht den Drain. Was
            // ueberhaupt gesammelt wird, entscheidet der Prozess.
            QKERN_COMPUTE_SCOPES_JSON: JSON.stringify([scope]),
            QKERN_RUNTIME_MODE: "postgres",
            QKERN_STATEMENT_ENCRYPTION_KEY: "0".repeat(64),
            QKERN_RUNTIME_DATABASE_URL: runtimeUrl!,
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

      const batches = async () => {
        const result = await owner.query<{
          event_type: string; payload: { entries: Array<Record<string, unknown>> };
        }>(`SELECT event_type, payload FROM project_webhook_deliveries
             WHERE organization_id = $1 AND project_id = $2
             ORDER BY occurred_at, id`, [collectorOrganization, collectorProject]);
        return result.rows;
      };

      const cursors = async () => {
        const result = await owner.query<{ position: string; forwarded: boolean }>(
          `SELECT position, forwarded_at IS NOT NULL AS forwarded
             FROM project_log_drain_cursors
            WHERE organization_id = $1 AND project_id = $2 AND environment = 'development'`,
          [collectorOrganization, collectorProject]);
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

      const invocationIds = (rows: Awaited<ReturnType<typeof batches>>) =>
        rows.flatMap((row) => row.payload.entries.map((entry) => entry.invocationId as string));

      // --- Erster Lauf -------------------------------------------------------
      const first = start();
      await until("Die Startzeile des Prozesses", 120_000,
        async () => first.output().includes("log drain collector"),
        () => `Ausgabe: ${first.output().slice(-800)}`);

      // Erst, wenn der Prozess seinen Anfangsstand festgehalten hat, ist der
      // naechste Aufruf sicher **nach** der Spitze. Ohne diese Bedingung waere
      // der Fall ein Wettlauf zwischen Testprozess und Sammler.
      await until("Der Anfangsstand des Drains", 90_000,
        async () => (await cursors()).length === 1,
        () => `Ausgabe: ${first.output().slice(-800)}`);
      expect((await cursors())[0], "der Anfangsstand behauptet eine Weiterleitung")
        .toMatchObject({ position: "", forwarded: false });

      /** Die Kennung des juengsten Aufrufs -- der Dienst vergibt sie, nicht dieser Fall. */
      const newestInvocation = async () => (await definitions.readFunctionInvocationLog(
        admin, scope, { limit: 1 })).rows[0].invocationId;

      await invoker.invoke(admin, scope, probe.name, { probe: containerOutput });
      const firstCall = await newestInvocation();
      await until("Die Ladung aus dem laufenden Prozess", 90_000,
        async () => (await batches()).length >= 1,
        () => `Ausgabe: ${first.output().slice(-800)}`);

      const afterFirst = await batches();
      expect(afterFirst).toHaveLength(1);
      expect(afterFirst[0].event_type).toBe("log.function_invocations");
      expect(invocationIds(afterFirst)).toEqual([firstCall]);
      expect(JSON.stringify(afterFirst[0].payload),
        "die Ladung traegt die Adresse des Aufrufers").not.toContain(actorRef);
      expect(JSON.stringify(afterFirst[0].payload),
        "die Ladung traegt die Ausgabe des Containers").not.toContain(containerOutput);
      // Die Position liegt dauerhaft in der Control Plane, nicht im Prozess.
      //
      // Gewartet wird, und zwar aus einem Grund im Produkt: Der Sammler reiht
      // erst ein und haelt danach die Position fest, in zwei Anweisungen und
      // absichtlich in dieser Reihenfolge (lieber eine Ladung doppelt als eine
      // verlorene). Zwischen beiden liegt ein Fenster. Ein Fall, der direkt
      // nach der Ladung nachsieht, prueft darum nicht das Produkt, sondern wer
      // schneller war; zweimal ist er genau daran gescheitert. Die Erwartung
      // bleibt dieselbe, nur ihr Zeitpunkt wird ausgesprochen.
      await until("Die festgehaltene Position des Drains", 90_000,
        async () => (await cursors())[0]?.forwarded === true,
        () => `Ausgabe: ${first.output().slice(-800)}`);
      expect((await cursors())[0], "der Prozess hat seine Position nicht festgehalten")
        .toMatchObject({ forwarded: true });

      // --- Anhalten ----------------------------------------------------------
      expect(await stop(first)).toBe(0);

      // Und er ist wirklich aus: Ein Aufruf waehrend der Pause erzeugt nichts.
      // Ohne diese Probe pruefte der Fall nur das Ende eines Kindprozesses,
      // nicht das Ende seiner Arbeit.
      await invoker.invoke(admin, scope, probe.name, { probe: containerOutput });
      const pausedCall = await newestInvocation();
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect(await batches(), "der angehaltene Prozess hat weitergearbeitet").toHaveLength(1);

      // --- Zweiter Lauf: kein Wiederholen, kein Ueberspringen ----------------
      const second = start();
      await until("Die Startzeile des zweiten Prozesses", 120_000,
        async () => second.output().includes("log drain collector"),
        () => `Ausgabe: ${second.output().slice(-800)}`);

      await until("Die Ladung aus der Pause", 90_000,
        async () => (await batches()).length >= 2,
        () => `Ausgabe: ${second.output().slice(-800)}`);

      await invoker.invoke(admin, scope, probe.name, { probe: containerOutput });
      const thirdCall = await newestInvocation();
      await until("Die Ladung nach dem Neustart", 90_000,
        async () => (await batches()).length >= 3,
        () => `Ausgabe: ${second.output().slice(-800)}`);

      const afterSecond = await batches();
      // Genau drei: die erste aus dem ersten Lauf, die aus der Pause und die
      // nach dem Neustart. Eine vierte waere eine Wiederholung, zwei waeren
      // ein verlorener Aufruf.
      expect(afterSecond, `Ausgabe: ${second.output().slice(-800)}`).toHaveLength(3);
      expect(invocationIds(afterSecond))
        .toEqual([firstCall, pausedCall, thirdCall]);

      expect(await stop(second)).toBe(0);

      // Was der Prozess ueber sich meldet, ist redigiert: kein Ziel, keine
      // Geheimnisreferenz, keine Adresse, keine Container-Ausgabe.
      for (const runner of [first, second]) {
        expect(runner.output()).not.toContain(actorRef);
        expect(runner.output()).not.toContain(containerOutput);
        expect(runner.output()).not.toContain("siem.example.com");
        expect(runner.output()).not.toContain(databaseWebhookSecretRef!);
      }
    } finally {
      for (const child of children) child.kill("SIGKILL");
    }
    // 600 Sekunden: zwei echte Node-Starts mit `tsx`, jeder mit eigener
    // Uebersetzung der Module, dazu drei bewusst grosszuegige Wartefristen.
    // Jede einzelne Wartezeit hat trotzdem ihre eigene, engere Frist.
  }, 600_000);
  it("(2.68) reads what this environment runs on from the real server and the real control plane", async () => {
    // Einstellungen -> Infrastruktur (2.68) gegen die echte Datenbank. Der
    // Fall hat drei Zusagen, und keine davon liesse sich gegen einen Nachbau
    // pruefen:
    //
    // 1. Was die Seite ueber den Server sagt, sagt der Server selbst. Version,
    //    Versionsnummer, Kodierung, Sortierung, Zeichenklassen und Startzeit
    //    werden danach ein zweites Mal gelesen, als Eigentuemer, aus
    //    `pg_database` und `current_setting`, und muessen uebereinstimmen.
    //    Gegen einen Fake waere das die Pruefung des Fakes.
    // 2. Die Groesse ist gemessen und nicht gemeldet. Der Fall misst, schreibt
    //    dann rund vier Megabyte in ein eigenes Schema derselben Datenbank und
    //    misst noch einmal. Waechst die gemeldete Zahl nicht mit, liest die
    //    Ansicht nicht diese Datenbank. Ein Nachbau haette nichts, was waechst.
    // 3. Die Umgebungen kommen aus `project_environments`, durch die echte
    //    Kontrollebene und ueber die Laufzeitrolle, also unter RLS. Eine
    //    gebundene und eine wartende Umgebung stehen nebeneinander, und die
    //    Nachbarorganisation bekommt dasselbe Projekt nicht zu sehen. Ohne
    //    echte Policies waere das keine Aussage.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.59, 2.62 und 2.63: Das
    // gemeinsame afterAll muss organizationA und organizationB loswerden, und
    // dieser Fall soll ihm dabei nicht im Weg stehen. Das eigene Schema faellt
    // am Ende samt Inhalt weg; Organisation, Projekt und Umgebungen bleiben
    // stehen wie in 2.59 und 2.62.
    expect(projectApiUrl, "QKERN_TEST_PROJECT_API_DATABASE_URL fehlt").toBeTruthy();
    const target = new URL(projectApiUrl!);
    const expectedDatabase = target.pathname.slice(1);
    const expectedRole = decodeURIComponent(target.username);

    const infraOwner = randomUUID();
    const infraOrganization = randomUUID();
    const infraProject = randomUUID();
    const schema = `infra_${randomUUID().replaceAll("-", "_")}`;
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [infraOwner, `infra-2-68-owner-${infraOwner}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Infra 2.68', $2, $3)`,
    [infraOrganization, `infra-2-68-${infraOrganization}`, infraOwner]);
    await owner.query(`INSERT INTO organization_members (organization_id, user_id, role, is_personal_workspace)
      VALUES ($1, $2, 'owner', true)`, [infraOrganization, infraOwner]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Infra 2.68', $3, 'test', 'ready', $4)`,
    [infraProject, infraOrganization, `infra-2-68-${infraProject}`, infraOwner]);
    // Eine gebundene und eine wartende Umgebung: Die Ansicht unterscheidet
    // beide, und nur mit beiden ist die Unterscheidung belegt.
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3), ($1, $2, 'staging', $4)`,
    [infraOrganization, infraProject, `managed:${infraProject}`, `pending:${infraProject}`]);

    const context = {
      organizationId: infraOrganization,
      actor: { id: infraOwner, ref: `infra-2-68-owner-${infraOwner}@qkern.test`, type: "user" as const },
    };
    // --- Zusage 3: die Umgebungen, durch die echte Kontrollebene unter RLS ---
    const control = new PostgresControlPlaneService(
      new PostgresControlPlane(runtime),
      new AesGcmStatementCipher(Buffer.from("0".repeat(64), "hex")),
    );
    const bindings = await control.listProjectEnvironments(context, infraProject);
    expect(bindings.map((entry) => entry.environment)).toEqual(["development", "staging"]);
    for (const entry of bindings) {
      expect(Object.keys(entry).sort()).toEqual(["bound", "createdAt", "databaseInstanceRef", "environment"]);
      expect(entry.createdAt, entry.environment).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    const development = bindings.find((entry) => entry.environment === "development")!;
    const staging = bindings.find((entry) => entry.environment === "staging")!;
    expect(development.databaseInstanceRef).toBe(`managed:${infraProject}`);
    expect(development.bound).toBe(true);
    // Eine wartende Marke ist keine Bindung, und die Ansicht darf sie nicht
    // fuer eine halten.
    expect(staging.databaseInstanceRef).toBe(`pending:${infraProject}`);
    expect(staging.bound).toBe(false);
    // Die Referenzen stehen so in der Tabelle; keine traegt eine Adresse.
    const storedRefs = await owner.query<{ environment: string; database_instance_ref: string }>(
      `SELECT environment::text AS environment, database_instance_ref
       FROM project_environments WHERE project_id = $1 ORDER BY environment`, [infraProject]);
    expect(storedRefs.rows.map((row) => row.database_instance_ref).sort())
      .toEqual(bindings.map((entry) => entry.databaseInstanceRef).sort());
    // Der Nachbar sieht dieses Projekt nicht, und bekommt auch keine leere
    // Liste: eine leere Liste waere die Behauptung, es habe keine Umgebung.
    await expect(control.listProjectEnvironments({
      organizationId: organizationB,
      actor: { id: secondUserId, ref: `integration-${secondUserId}@qkern.test`, type: "user" as const },
    }, infraProject)).rejects.toThrowError(/not found/i);

    const projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
    try {
      const service = new ProjectDataPlaneService(
        { resolveTarget: async () => ({ databaseInstanceRef: `managed:${infraProject}` }) },
        { resolve: async () => ({
          pool: projectApi,
          expectedRole,
          expectedDatabase,
          expectedLedgerOwner: "qkern",
        }) },
      );
      const scope = { projectId: infraProject, environment: "development" as const };
      const inspection = {
        organizationId: infraOrganization,
        actorRef: `infra-2-68-owner-${infraOwner}@qkern.test`,
      };
      const before = await service.inspectRuntime(inspection, scope);

      // --- Die Form der Antwort ---
      expect(before.source).toBe("postgres");
      expect(Object.keys(before).sort()).toEqual([
        "collate", "ctype", "encoding", "inRecovery", "serverVersion",
        "serverVersionNum", "sizeBytes", "source", "startedAt",
      ]);

      // --- Zusage 1: jede Angabe steht so im Katalog ---
      const catalog = await owner.query<{
        server_version: string; server_version_num: string; encoding: string;
        collate: string; ctype: string; in_recovery: boolean; started_at: string;
      }>(`SELECT current_setting('server_version') AS server_version,
                 current_setting('server_version_num') AS server_version_num,
                 pg_catalog.pg_encoding_to_char(database.encoding) AS encoding,
                 database.datcollate AS collate,
                 database.datctype AS ctype,
                 pg_catalog.pg_is_in_recovery() AS in_recovery,
                 to_char(pg_catalog.pg_postmaster_start_time() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS started_at
          FROM pg_catalog.pg_database AS database
          WHERE database.datname = $1`, [expectedDatabase]);
      const reference = catalog.rows[0];
      expect(reference, "Die Datenbank steht nicht in pg_database; dann prueft dieser Fall nichts.").toBeDefined();
      expect(before.serverVersion).toBe(reference!.server_version);
      expect(before.serverVersionNum).toBe(Number(reference!.server_version_num));
      expect(before.encoding).toBe(reference!.encoding);
      expect(before.collate).toBe(reference!.collate);
      expect(before.ctype).toBe(reference!.ctype);
      expect(before.inRecovery).toBe(reference!.in_recovery);
      expect(before.startedAt).toBe(reference!.started_at);
      // Zahl und Text sind zwei Angaben desselben Servers; die Hauptversion
      // muss in beiden dieselbe sein.
      expect(Math.floor(before.serverVersionNum / 10_000))
        .toBe(Number(/^[0-9]+/.exec(before.serverVersion)![0]));
      // Der Stack faehrt PostgreSQL 17; eine aeltere Version waere ein Fund.
      expect(before.serverVersionNum).toBeGreaterThanOrEqual(170_000);
      expect(before.encoding).toBe("UTF8");
      // Der Zertifizierungsstack hat kein Standby; die Ansicht darf daraus
      // keine Replikation erfinden.
      expect(before.inRecovery).toBe(false);
      expect(Date.parse(before.startedAt)).toBeLessThanOrEqual(Date.now());

      // --- Zusage 2: die Groesse ist gemessen und waechst mit ---
      expect(before.sizeBytes).toBeGreaterThan(0);
      const ownerSize = await owner.query<{ size: string }>(
        "SELECT pg_catalog.pg_database_size($1)::text AS size", [expectedDatabase]);
      // Beide Messungen liegen Sekunden auseinander, darum keine Gleichheit,
      // aber auch keine Beliebigkeit: mehr als 64 MiB Unterschied waere eine
      // andere Datenbank.
      expect(Math.abs(before.sizeBytes - Number(ownerSize.rows[0]!.size))).toBeLessThan(64 * 1024 * 1024);

      await owner.query(`CREATE SCHEMA "${schema}"`);
      try {
        await owner.query(`CREATE TABLE "${schema}"."ballast" (id integer PRIMARY KEY, payload text NOT NULL)`);
        // Rund zehn Megabyte. Der Wert je Zeile bleibt unter der
        // TOAST-Schwelle, liegt also wirklich in der Tabelle, und jede Zeile
        // traegt einen eigenen Hash, damit die Seiten sich nicht wiederholen.
        // `gen_random_bytes` steht nicht zur Verfuegung: pgcrypto ist in
        // dieser Datenbank nicht installiert, und dieser Fall installiert
        // nichts.
        await owner.query(`INSERT INTO "${schema}"."ballast" (id, payload)
          SELECT step, repeat(md5(random()::text || step::text), 16)
          FROM generate_series(1, 20000) AS step`);
        const after = await service.inspectRuntime(inspection, scope);
        expect(after.sizeBytes - before.sizeBytes,
          "die gemeldete Groesse waechst nicht mit den geschriebenen Daten").toBeGreaterThanOrEqual(4 * 1024 * 1024);
        // Alles andere bleibt, wie es war: Ein Schreibvorgang aendert weder
        // die Version noch die Kodierung.
        expect(after.serverVersion).toBe(before.serverVersion);
        expect(after.encoding).toBe(before.encoding);
        expect(after.startedAt).toBe(before.startedAt);

        // --- Kein Wert der Antwort verraet, wo die Datenbank liegt ---
        const keys = new Set<string>();
        const values: unknown[] = [];
        const walk = (value: unknown): void => {
          if (Array.isArray(value)) { for (const entry of value) walk(entry); return; }
          if (value !== null && typeof value === "object") {
            for (const [key, entry] of Object.entries(value)) { keys.add(key.toLowerCase()); walk(entry); }
            return;
          }
          values.push(value);
        };
        walk(after);
        for (const value of values) {
          expect(String(value), "die volle Verbindungsadresse").not.toBe(projectApiUrl!);
        }
        for (const forbidden of ["host", "hostname", "port", "password", "user", "username", "dsn", "url", "uri", "path"]) {
          expect([...keys], forbidden).not.toContain(forbidden);
        }
        const serialised = JSON.stringify(after);
        expect(serialised).not.toContain(decodeURIComponent(target.password));
        expect(serialised).not.toContain(`:${target.port || "5432"}`);
        expect(serialised).not.toContain("://");
        for (const word of ["sslmode", "connectionString", "data_directory", "client_addr"]) {
          expect(serialised.toLowerCase(), word).not.toContain(word.toLowerCase());
        }
      } finally {
        await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }
    } finally {
      await projectApi.end();
    }
  });


  it("(2.69) explains a real query plan without executing the query", async () => {
    // Berichte -> Abfrage-Einblicke (2.69) gegen die echte Datenbank.
    //
    // Der Unit-Test prueft, dass aus einer JSON-Antwort eine flache Liste
    // wird. Das ist die halbe Zusage. Die andere Haelfte kann nur eine echte
    // Datenbank belegen, und sie ist die, auf der dieser Schnitt steht:
    //
    // 1. **EXPLAIN liest wirklich nichts.** Die Zusage der Seite lautet, dass
    //    sie die Abfrage nicht ausfuehrt. Ein Kommentar kann das behaupten,
    //    ein Mock auch. Beweisen kann es nur PostgreSQL selbst, und zwar am
    //    eigenen Zaehler: `pg_stat_user_tables.seq_scan` steigt bei jedem
    //    sequenziellen Lesen der Tabelle. Nach fuenf Plaenen steht er still.
    //    Danach laeuft dieselbe Abfrage durch `queryReadOnly`, und **dann**
    //    steigt er um genau eins. Ohne diese Gegenprobe hiesse "der Zaehler
    //    stand still" nur, dass niemand hinsieht.
    //    Wuerde jemand `ANALYZE` in den Dienst schreiben, stiege der Zaehler
    //    schon in der ersten Haelfte, und dieser Fall faellt.
    // 2. **Der Planer nennt den Index, der greift.** Ein Nachbau kann eine
    //    Zeichenkette "vorlagen_pkey" zurueckgeben; nur PostgreSQL kann
    //    entscheiden, dass der Primaerschluessel fuer diese Abfrage wirklich
    //    der Weg ist.
    // 3. **Der Eigenanteil stimmt gegen echte Schaetzungen.** Die Kosten eines
    //    Knotens enthalten die seiner Kinder; die Rechnung dahinter wird hier
    //    an einem echten Plan geprueft, nicht an erfundenen Zahlen.
    // 4. **Die Literale der Abfrage bleiben drinnen.** Der Plan von
    //    PostgreSQL traegt `Filter` und `Index Cond` mit dem Wert woertlich.
    //    Hier steht ein Wert im Statement, der sonst nirgends vorkommt, und
    //    die Antwort darf ihn nicht tragen.
    //
    // Gelesen wird durch denselben Dienst, den die Query-Route benutzt. Es
    // gibt keinen Nachbau: `ProjectDataPlaneService` loest auf, prueft die
    // Grenze und oeffnet `BEGIN READ ONLY`.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.61 und 2.65: Das
    // gemeinsame afterAll muss organizationA und organizationB loswerden, und
    // eine Organisation mit Auditzeilen laesst sich nicht loeschen. Dieser
    // Fall laesst Organisation, Projekt und Umgebung stehen und raeumt nur
    // sein eigenes Schema weg.
    expect(projectApiUrl, "QKERN_TEST_PROJECT_API_DATABASE_URL fehlt").toBeTruthy();
    const planOwner = randomUUID();
    const planOrganization = randomUUID();
    const planProject = randomUUID();
    const planActor = `query-insights-2-69-owner-${planOwner}@qkern.test`;
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`, [planOwner, planActor]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Query Insights 2.69', $2, $3)`,
    [planOrganization, `query-insights-2-69-${planOrganization}`, planOwner]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Query Insights 2.69', $3, 'test', 'ready', $4)`,
    [planProject, planOrganization, `query-insights-2-69-${planProject}`, planOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`,
    [planOrganization, planProject, `managed:${planProject}`]);

    const schema = `plaene_${randomUUID().replaceAll("-", "_")}`;
    const projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
    try {
      await owner.query(`CREATE SCHEMA "${schema}"`);
      await owner.query(`CREATE TABLE "${schema}".vorlagen (
        id integer PRIMARY KEY,
        notiz text NOT NULL)`);
      // Autovacuum aus, und zwar fuer diesen Fall zwingend: Ein Autoanalyze
      // liest die Tabelle sequenziell und bewegt denselben Zaehler, an dem
      // gleich gemessen wird, ob EXPLAIN gelesen hat. Ohne diese Zeile
      // pruefte der Fall Zufall statt Verhalten.
      await owner.query(`ALTER TABLE "${schema}".vorlagen SET (autovacuum_enabled = false)`);
      // Genug Zeilen, damit der Planer eine echte Wahl hat: Bei drei Zeilen
      // gewaenne der sequenzielle Scan jede Abfrage, und "welcher Index
      // greift" waere nicht pruefbar.
      await owner.query(`INSERT INTO "${schema}".vorlagen (id, notiz)
        SELECT reihe, 'notiz-' || reihe FROM generate_series(1, 5000) AS reihe`);
      await owner.query(`GRANT USAGE ON SCHEMA "${schema}" TO qkern_project_api_app`);
      await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO qkern_project_api_app`);
      await owner.query(`ANALYZE "${schema}".vorlagen`);

      const service = new ProjectDataPlaneService(
        { resolveTarget: async () => ({ databaseInstanceRef: `managed:${planProject}` }) },
        { resolve: async () => ({
          pool: projectApi,
          expectedRole: "qkern_project_api_app",
          expectedDatabase: new URL(projectApiUrl!).pathname.slice(1),
          expectedLedgerOwner: "qkern",
        }) },
      );
      const planContext = { organizationId: planOrganization, actorRef: planActor };
      const planScope = { projectId: planProject, environment: "development" as const };

      /** Wie oft PostgreSQL diese Tabelle sequenziell gelesen hat. */
      const sequentialReads = async (): Promise<number> => {
        const row = await owner.query<{ seq_scan: string | null }>(
          `SELECT COALESCE(seq_scan, 0)::text AS seq_scan
           FROM pg_catalog.pg_stat_user_tables
           WHERE schemaname = $1 AND relname = 'vorlagen'`, [schema]);
        return Number(row.rows[0]?.seq_scan ?? 0);
      };

      /**
       * Der Zaehler, nachdem er sich beruhigt hat.
       *
       * Der Statistiksammler von PostgreSQL schreibt verzoegert. Das ANALYZE
       * aus dem Aufbau liest die Tabelle ebenfalls sequenziell, und sein
       * Zaehlerstand kann erst ankommen, nachdem hier schon gemessen wurde.
       * Gewartet wird darum, bis zwei Sekunden lang nichts mehr passiert.
       */
      const settled = async (): Promise<number> => {
        let last = await sequentialReads();
        let quietSince = Date.now();
        const patience = Date.now() + 30_000;
        while (Date.now() - quietSince < 2_000 && Date.now() < patience) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          const current = await sequentialReads();
          if (current !== last) { last = current; quietSince = Date.now(); }
        }
        return last;
      };

      // --- Zusage 1: der Plan liest nicht ---------------------------------
      const statement = `SELECT id, notiz FROM "${schema}".vorlagen ORDER BY notiz`;
      const before = await settled();
      for (let round = 0; round < 5; round += 1) {
        const explained = await service.explainReadQuery(planContext, planScope, statement);
        expect(explained.source).toBe("postgres");
        // Die Zusage steht in der Antwort selbst, nicht nur im Kommentar.
        expect(explained.analyzed).toBe(false);
        expect(explained.plan.nodes.length).toBeGreaterThan(0);
      }
      // Der Statistiksammler schreibt verzoegert. Es wird also nicht einmal
      // hingesehen, sondern ueber drei Sekunden hinweg immer wieder.
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        expect(await sequentialReads(),
          "EXPLAIN hat die Tabelle gelesen; ohne ANALYZE darf das nicht passieren").toBe(before);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      // Und danach noch einmal, bis Ruhe eingekehrt ist: Ein verspaeteter
      // Zaehlerstand aus den fuenf Plaenen soll hier auffallen und nicht
      // erst weiter unten, wo er nach einem ganz anderen Fehler aussaehe.
      expect(await settled(),
        "EXPLAIN hat die Tabelle gelesen; ohne ANALYZE darf das nicht passieren").toBe(before);

      // Die Gegenprobe: Dieselbe Abfrage, diesmal wirklich ausgefuehrt. Erst
      // jetzt bewegt sich der Zaehler, und damit ist bewiesen, dass er sich
      // ueberhaupt bewegen kann.
      const rows = await service.queryReadOnly(planContext, planScope, statement, 10);
      expect(rows.rowCount).toBe(10);
      let afterRun = before;
      const runDeadline = Date.now() + 30_000;
      while (afterRun === before && Date.now() < runDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        afterRun = await sequentialReads();
      }
      expect(afterRun,
        "der Zaehler hat sich auch nach einer echten Abfrage nicht bewegt").toBe(before + 1);

      // --- Zusage 2: der Planer nennt den Index, der greift ----------------
      const withoutIndex = await service.explainReadQuery(planContext, planScope, statement);
      expect(withoutIndex.plan.indexes).toEqual([]);
      expect(withoutIndex.plan.sequentialScans).toEqual(["vorlagen"]);

      const byKey = await service.explainReadQuery(planContext, planScope,
        `SELECT notiz FROM "${schema}".vorlagen WHERE id = 4242`);
      expect(byKey.plan.indexes).toEqual(["vorlagen_pkey"]);
      expect(byKey.plan.sequentialScans).toEqual([]);
      expect(byKey.plan.nodes[0].operation).toContain("Index");
      expect(byKey.plan.nodes[0].relation).toBe("vorlagen");
      // Der Plan ueber den Schluessel ist billiger als der ueber die ganze
      // Tabelle. Das ist die Aussage, wegen der die Seite existiert.
      expect(byKey.plan.totalCost).toBeLessThan(withoutIndex.plan.totalCost);

      // --- Zusage 3: der Eigenanteil stimmt gegen echte Schaetzungen -------
      // Der Plan ueber die ganze Tabelle sortiert; die Wurzel ist ein Sort
      // ueber einem sequenziellen Scan.
      expect(withoutIndex.plan.nodes.length).toBeGreaterThanOrEqual(2);
      const [root, child] = withoutIndex.plan.nodes;
      expect(root.depth).toBe(0);
      expect(child.depth).toBe(1);
      // Die Gesamtkosten eines Knotens enthalten die seiner Kinder.
      expect(root.totalCost).toBeGreaterThan(child.totalCost);
      expect(root.ownCost).toBeCloseTo(root.totalCost - child.totalCost, 6);
      // Die Eigenanteile eines Plans summieren sich auf die Gesamtkosten.
      const own = withoutIndex.plan.nodes.reduce((sum, entry) => sum + entry.ownCost, 0);
      expect(own).toBeCloseTo(withoutIndex.plan.totalCost, 6);
      const shares = withoutIndex.plan.nodes.reduce((sum, entry) => sum + entry.costShare, 0);
      expect(shares).toBeCloseTo(1, 6);
      // Und der teuerste Knoten ist einer aus diesem Plan, kein erfundener.
      const hottest = hottestQueryPlanNode(withoutIndex.plan);
      expect(hottest).not.toBeNull();
      expect(hottest!.costShare).toBeGreaterThanOrEqual(QUERY_PLAN_HOT_SHARE);
      expect(withoutIndex.plan.nodes).toContain(hottest);

      // Die Planungszeit ist gemessen, nicht geschaetzt, und sie ist da.
      expect(withoutIndex.plan.planningTimeMs).not.toBeNull();
      expect(withoutIndex.plan.planningTimeMs!).toBeGreaterThan(0);

      // --- Zusage 4: kein Literal der Abfrage verlaesst die Datenbank ------
      const marker = `marke-${randomUUID()}`;
      const withLiteral = await service.explainReadQuery(planContext, planScope,
        `SELECT id FROM "${schema}".vorlagen WHERE notiz = '${marker}'`);
      const serialised = JSON.stringify(withLiteral);
      expect(serialised, "der Plan traegt ein Literal der Abfrage").not.toContain(marker);
      expect(serialised).not.toContain("Filter");
      expect(serialised).not.toContain("Index Cond");
      // Die Gegenprobe: PostgreSQL schickt das Literal sehr wohl mit. Ohne
      // sie pruefte der Satz darueber nichts.
      const rawPlan = await owner.query<{ plan: unknown }>(
        `EXPLAIN (FORMAT JSON) SELECT id FROM "${schema}".vorlagen WHERE notiz = '${marker}'`);
      expect(JSON.stringify(rawPlan.rows), "PostgreSQL nennt das Literal gar nicht")
        .toContain(marker);

      // --- Was die Flaeche ablehnt -----------------------------------------
      // Ein Schreibbefehl kommt gar nicht bis zur Datenbank: Der Waechter
      // steht vor dem EXPLAIN, sonst waere `EXPLAIN ANALYZE DELETE` moeglich.
      for (const rejected of [
        `DELETE FROM "${schema}".vorlagen`,
        `UPDATE "${schema}".vorlagen SET notiz = 'x'`,
        `SELECT 1; DROP TABLE "${schema}".vorlagen`,
        `EXPLAIN ANALYZE SELECT id FROM "${schema}".vorlagen`,
      ]) {
        const failure = await service.explainReadQuery(planContext, planScope, rejected)
          .catch((cause: unknown) => cause);
        expect(isProjectDataPlaneError(failure, "READ_ONLY_QUERY_REQUIRED"), rejected).toBe(true);
      }
      // Und die Tabelle steht noch, mit allen Zeilen.
      const intact = await owner.query<{ anzahl: string }>(
        `SELECT count(*)::text AS anzahl FROM "${schema}".vorlagen`);
      expect(intact.rows[0].anzahl).toBe("5000");

      // Eine lesende Abfrage, die sich nicht planen laesst, ist etwas anderes
      // als ein Ausfall: Die Datenbank hat geantwortet.
      const unplannable = await service.explainReadQuery(planContext, planScope,
        `SELECT id FROM "${schema}".gibt_es_nicht`).catch((cause: unknown) => cause);
      expect(isProjectDataPlaneError(unplannable, "QUERY_PLAN_REJECTED")).toBe(true);
      // Und der Grund nennt die Relation nicht weiter.
      expect(String(unplannable)).not.toContain("gibt_es_nicht");
    } finally {
      await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await projectApi.end();
    }
  }, 120_000);

  it("(2.70) reports the state of the real database from counters that really move", async () => {
    // Logs -> Postgres-Zustand (2.70) gegen die echte Datenbank.
    //
    // Die Seite ersetzt das Versprechen eines Serverlogs durch Zaehler aus
    // den Statistiksichten. Ein Zaehler ist ohne Datenbank nicht pruefbar:
    // Ein Nachbau gaebe eine Zahl zurueck, und die Zahl waere richtig, ohne
    // dass irgendetwas gezaehlt haette. Darum hat der Fall vier Zusagen, die
    // alle an PostgreSQL haengen:
    //
    // 1. **Die Zaehler bewegen sich mit dem, was wirklich passiert.** Der Fall
    //    misst, verursacht dann etwas Bestimmtes in derselben Datenbank und
    //    misst noch einmal: zehn gescheiterte Anweisungen muessen
    //    `rollbacks` um mindestens zehn heben, eine Sortierung mit kleinem
    //    `work_mem` muss `tempFiles` und `tempBytes` heben, und eine frisch
    //    geoeffnete Verbindung muss `sessions` heben. Gegen einen Nachbau
    //    waere das die Pruefung des Nachbaus.
    // 2. **Der Dienst liest die Sicht, die dieser Server wirklich hat.**
    //    PostgreSQL 17 hat die Checkpoint-Zaehler nach `pg_stat_checkpointer`
    //    verschoben. Welche Sicht es gibt, fragt der Fall selbst im Katalog
    //    nach, und die gemeldete Quelle muss dazu passen. Die Zahlen daneben
    //    werden gegen dieselbe Sicht als Eigentuemer gegengelesen.
    // 3. **Null ist nicht dasselbe wie nicht gemessen.** Laeuft der Server
    //    ohne Datenpruefsummen, muss `checksumFailures` `null` sein und nicht
    //    0. Ob er sie hat, liest der Fall aus `data_checksums`.
    // 4. **Kein Wortlaut verlaesst die Datenbank.** Jeder Wert der Antwort
    //    ist eine Zahl, ein Wahrheitswert, ein UTC-Zeitpunkt in fester Form
    //    oder der Name einer Statistiksicht. Ein Abfragetext, eine
    //    Fehlermeldung oder eine Adresse koennte darum gar nicht darin
    //    stehen.
    //
    // Gelesen wird durch denselben Dienst, den die Route benutzt. Eingesetzt
    // wird nur die Tuer: Scope und Principal. Es gibt keine eigene Projektion
    // und keine eigene Grenzpruefung in diesem Fall.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.68 und 2.69: Das
    // gemeinsame afterAll muss organizationA und organizationB loswerden, und
    // dieser Fall soll ihm dabei nicht im Weg stehen.
    expect(projectApiUrl, "QKERN_TEST_PROJECT_API_DATABASE_URL fehlt").toBeTruthy();
    const target = new URL(projectApiUrl!);
    const expectedDatabase = target.pathname.slice(1);
    const expectedRole = decodeURIComponent(target.username);

    const healthOwner = randomUUID();
    const healthOrganization = randomUUID();
    const healthProject = randomUUID();
    const healthActor = `health-2-70-owner-${healthOwner}@qkern.test`;
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`, [healthOwner, healthActor]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Health 2.70', $2, $3)`,
    [healthOrganization, `health-2-70-${healthOrganization}`, healthOwner]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Health 2.70', $3, 'test', 'ready', $4)`,
    [healthProject, healthOrganization, `health-2-70-${healthProject}`, healthOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`,
    [healthOrganization, healthProject, `managed:${healthProject}`]);

    const projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
    try {
      const service = new ProjectDataPlaneService(
        { resolveTarget: async () => ({ databaseInstanceRef: `managed:${healthProject}` }) },
        { resolve: async () => ({
          pool: projectApi,
          expectedRole,
          expectedDatabase,
          expectedLedgerOwner: "qkern",
        }) },
      );
      const healthContext = { organizationId: healthOrganization, actorRef: healthActor };
      const healthScope = { projectId: healthProject, environment: "development" as const };

      const before = await service.inspectDatabaseHealth(healthContext, healthScope);

      // --- Die Form der Antwort -------------------------------------------
      expect(before.source).toBe("postgres");
      expect(Object.keys(before).sort()).toEqual(["database", "source", "writeback"]);
      expect(Object.keys(before.database).sort()).toEqual([
        "backends", "blocksHit", "blocksRead", "checksumFailures", "checksumLastFailure",
        "commits", "conflicts", "deadlocks", "rollbacks", "sessions", "sessionsAbandoned",
        "sessionsFatal", "sessionsKilled", "statsReset", "tempBytes", "tempFiles",
      ]);
      expect(Object.keys(before.writeback).sort()).toEqual([
        "bgwriterStatsReset", "buffersAlloc", "buffersCheckpoint", "buffersClean",
        "checkpointSource", "checkpointSyncMs", "checkpointWriteMs", "checkpointerStatsReset",
        "checkpointsRequested", "checkpointsTimed", "maxwrittenClean",
      ]);

      // --- Zusage 2: die Quelle ist die, die dieser Server wirklich hat ----
      const catalog = await owner.query<{ has_checkpointer: boolean; checksums: string }>(
        `SELECT to_regclass('pg_catalog.pg_stat_checkpointer') IS NOT NULL AS has_checkpointer,
                current_setting('data_checksums') AS checksums`);
      const hasCheckpointer = catalog.rows[0]!.has_checkpointer;
      expect(before.writeback.checkpointSource)
        .toBe(hasCheckpointer ? "pg_stat_checkpointer" : "pg_stat_bgwriter");
      // Der Zertifizierungsstack faehrt PostgreSQL 17; dort gibt es die Sicht.
      // Faende dieser Fall sie nicht, waere das ein Fund und keine Toleranz.
      expect(hasCheckpointer, "PostgreSQL 17 kennt pg_stat_checkpointer").toBe(true);
      const checkpointer = await owner.query<{ timed: string; requested: string; written: string }>(
        `SELECT num_timed::text AS timed, num_requested::text AS requested,
                buffers_written::text AS written
         FROM pg_catalog.pg_stat_checkpointer`);
      const reference = checkpointer.rows[0]!;
      // Checkpoints laufen weiter, waehrend dieser Fall laeuft; darum keine
      // Gleichheit, aber auch keine Beliebigkeit: Die gemeldete Zahl darf die
      // des Katalogs nicht uebersteigen, denn sie wurde vorher gelesen.
      expect(before.writeback.checkpointsTimed).toBeLessThanOrEqual(Number(reference.timed));
      expect(before.writeback.checkpointsRequested).toBeLessThanOrEqual(Number(reference.requested));
      expect(before.writeback.buffersCheckpoint).toBeLessThanOrEqual(Number(reference.written));
      expect(before.writeback.checkpointsTimed + before.writeback.checkpointsRequested)
        .toBeGreaterThan(0);
      // Der Hintergrundschreiber hat Puffer angefordert, seit der Server laeuft.
      expect(before.writeback.buffersAlloc).toBeGreaterThan(0);

      // --- Zusage 3: null heisst nicht gemessen, nicht null Fehler --------
      if (catalog.rows[0]!.checksums === "on") {
        expect(before.database.checksumFailures).not.toBeNull();
      } else {
        expect(before.database.checksumFailures,
          "ohne Datenpruefsummen ist 0 eine Behauptung und null die Wahrheit").toBeNull();
        expect(before.database.checksumLastFailure).toBeNull();
      }

      /**
       * Ein Zaehler, nachdem er die Schwelle erreicht hat.
       *
       * PostgreSQL 15 und neuer sammelt die Statistik im gemeinsamen Speicher
       * und schreibt sie verzoegert fort; ein Backend meldet seine Zahlen
       * fruehestens nach `PGSTAT_MIN_INTERVAL`. 90 Sekunden sind darum kein
       * grosszuegiges Budget fuer eine schnelle Sache, sondern Raum fuer eine
       * Fortschreibung, die von sich aus wartet. Die Erwartung selbst bleibt
       * hart: Wird die Schwelle nie erreicht, faellt der Fall.
       */
      const until = async (
        reached: (value: ProjectDatabaseHealthResult) => boolean,
      ): Promise<ProjectDatabaseHealthResult> => {
        const patience = Date.now() + 90_000;
        let latest = await service.inspectDatabaseHealth(healthContext, healthScope);
        while (!reached(latest) && Date.now() < patience) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          latest = await service.inspectDatabaseHealth(healthContext, healthScope);
        }
        return latest;
      };

      // --- Zusage 1a: abgebrochene Transaktionen steigen mit ---------------
      // Zehn Anweisungen, die scheitern muessen. Jede laeuft in ihrer eigenen
      // impliziten Transaktion, also zaehlt jede einmal in `xact_rollback`.
      const failures = 10;
      for (let attempt = 0; attempt < failures; attempt += 1) {
        await owner.query("SELECT 1 / 0").catch(() => undefined);
      }
      const afterRollbacks = await until(
        (value) => value.database.rollbacks >= before.database.rollbacks + failures);
      expect(afterRollbacks.database.rollbacks,
        "die gemeldeten Rollbacks wachsen nicht mit den gescheiterten Anweisungen")
        .toBeGreaterThanOrEqual(before.database.rollbacks + failures);
      // Und die beiden Spalten sind nicht vertauscht. Der Vergleich laeuft
      // gegen dieselbe Sicht, als Eigentuemer gelesen: Beide gemeldeten Zahlen
      // wurden vorher gelesen und duerfen die des Katalogs darum nicht
      // uebersteigen. Die Reihenfolge belegt den Rest: In dieser Datenbank
      // wird um Groessenordnungen mehr abgeschlossen als zurueckgerollt, ein
      // Tausch der Spalten drehte das um.
      const columns = await owner.query<{ commits: string; rollbacks: string }>(
        `SELECT xact_commit::text AS commits, xact_rollback::text AS rollbacks
         FROM pg_catalog.pg_stat_database WHERE datname = current_database()`);
      expect(afterRollbacks.database.rollbacks).toBeLessThanOrEqual(Number(columns.rows[0]!.rollbacks));
      expect(afterRollbacks.database.commits).toBeLessThanOrEqual(Number(columns.rows[0]!.commits));
      expect(afterRollbacks.database.commits,
        "abgeschlossene und zurueckgerollte Transaktionen stehen vertauscht")
        .toBeGreaterThan(afterRollbacks.database.rollbacks);

      // --- Zusage 1b: temporaere Dateien und eine neue Sitzung -------------
      // Eine eigene Verbindung: Sie hebt `sessions`, und nur auf ihr laesst
      // sich `work_mem` so klein setzen, dass die Sortierung auf die Platte
      // ausweichen muss.
      const sorter = createPostgresPool({ connectionString: projectApiUrl!, max: 1 });
      try {
        await sorter.query("SET work_mem = '64kB'");
        await sorter.query(`SELECT count(*) FROM (
          SELECT schritt FROM generate_series(1, 400000) AS schritt
          ORDER BY md5(schritt::text)) AS sortiert`);
      } finally {
        await sorter.end();
      }
      const afterTemp = await until((value) =>
        value.database.tempFiles > afterRollbacks.database.tempFiles &&
        value.database.sessions > before.database.sessions);
      expect(afterTemp.database.tempFiles,
        "die gemeldete Zahl temporaerer Dateien waechst nicht mit einer Sortierung, die auf die Platte ging")
        .toBeGreaterThan(afterRollbacks.database.tempFiles);
      expect(afterTemp.database.tempBytes,
        "temporaere Dateien ohne Bytes gibt es nicht")
        .toBeGreaterThan(afterRollbacks.database.tempBytes);
      expect(afterTemp.database.sessions,
        "die gemeldete Zahl eroeffneter Sitzungen waechst nicht mit einer neuen Verbindung")
        .toBeGreaterThan(before.database.sessions);
      // Die Datenbank meldet offene Verbindungen; diese Messung laeuft ueber
      // mindestens eine davon.
      expect(afterTemp.database.backends).toBeGreaterThan(0);

      // --- Zusage 4: kein Wortlaut, keine Adresse -------------------------
      const allowed = new Set(["pg_stat_checkpointer", "pg_stat_bgwriter", "postgres"]);
      const walk = (value: unknown, path: string): void => {
        if (value === null || typeof value === "number" || typeof value === "boolean") {
          if (typeof value === "number") expect(Number.isFinite(value), path).toBe(true);
          return;
        }
        if (typeof value === "string") {
          // Entweder ein fester Name oder ein UTC-Zeitpunkt in genau der Form,
          // die der Dienst schreibt. Etwas anderes traegt kein Feld.
          expect(allowed.has(value) || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value), `${path}: ${value}`)
            .toBe(true);
          return;
        }
        expect(value !== null && typeof value === "object", path).toBe(true);
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
          walk(entry, `${path}.${key}`);
        }
      };
      walk(afterTemp, "health");
      const serialised = JSON.stringify(afterTemp);
      expect(serialised).not.toContain(decodeURIComponent(target.password));
      expect(serialised).not.toContain("://");
      expect(serialised).not.toContain(expectedDatabase);
      // Die Anweisung, die eben scheiterte, steht nirgends in der Antwort.
      expect(serialised).not.toContain("1 / 0");
      for (const word of ["division", "error", "query", "log_destination", "client_addr", "datname"]) {
        expect(serialised.toLowerCase(), word).not.toContain(word.toLowerCase());
      }
    } finally {
      await projectApi.end();
    }
    // 180 Sekunden: zwei Wartefristen von bis zu 90 Sekunden auf die
    // verzoegerte Fortschreibung der Statistik, dazu die Sortierung selbst.
    // Jede einzelne Frist hat trotzdem ihre eigene, engere Grenze.
  }, 180_000);
  it("(2.72) reads foreign data wrappers without carrying a foreign password out", async () => {
    // Integrationen -> Wrappers (2.72) gegen die echte Datenbank.
    //
    // Der Unit-Test prueft die Abbildung an einem Fake-Client. Das ist die
    // halbe Zusage. Die andere Haelfte kann nur ein echter Server belegen,
    // und sie ist die, auf der dieser Schnitt steht:
    //
    // 1. **Das Passwort ist wirklich da.** Der Fall legt einen echten Wrapper
    //    an (`postgres_fdw`), einen Fremdserver darauf, eine Benutzerzuordnung
    //    mit einem Passwort und eine Fremdtabelle. Dass das Geheimnis im
    //    Katalog steht, liest der Fall als Eigentuemer nach; ohne diese
    //    Gegenprobe prueft die Zusage darunter nichts.
    // 2. **Die Leserolle koennte es sehen, und QKERN zeigt es trotzdem
    //    nicht.** Bei der Serveroption ist das keine Theorie: Der Fall liest
    //    `srvoptions` mit derselben Rolle, mit der auch die Ansicht liest, und
    //    bekommt das Passwort im Klartext. In der Antwort des Produktcodes
    //    steht es nicht. Die Grenze ist also QKERNs Entscheidung und nicht
    //    ein Zufall der Rechtevergabe.
    // 3. **Die Zuordnung wird gar nicht erst gefragt.** `pg_user_mapping` ist
    //    fuer die Leserolle gesperrt; der Fall zeigt die Ablehnung und zeigt
    //    daneben, dass die Lesung trotzdem durchgeht, weil sie die Sicht
    //    nimmt und `umoptions` nicht auswaehlt.
    //
    // Ein zweiter Wrapper ohne Validator steht daneben, und zwar mit Grund:
    // `postgres_fdw` weist ein Passwort auf Serverebene selbst zurueck. Ohne
    // einen Wrapper, der jede Option annimmt, gaebe es keinen Fremdserver mit
    // einem Geheimnis in `srvoptions`, und die Liste des Erlaubten haette
    // nichts zu tun.
    expect(projectApiUrl, "QKERN_TEST_PROJECT_API_DATABASE_URL fehlt").toBeTruthy();
    const target = new URL(projectApiUrl!);
    const expectedDatabase = target.pathname.slice(1);
    const expectedRole = decodeURIComponent(target.username);

    const suffix = randomUUID().replaceAll("-", "_").slice(0, 12);
    const bareWrapper = `fdw_2_72_bare_${suffix}`;
    const shopServer = `fdw_2_72_shop_${suffix}`;
    const legacyServer = `fdw_2_72_legacy_${suffix}`;
    const schema = `fdw_2_72_${suffix}`;
    const mappingSecret = `mapping_secret_${suffix}`;
    const serverSecret = `server_secret_${suffix}`;
    const serverKey = `server_key_${suffix}`;

    // Der Aufbau laeuft als Eigentuemer. Einen Wrapper anzulegen verlangt
    // Superuser-Rechte, und genau darum kann die Seite es nicht.
    await owner.query("CREATE EXTENSION IF NOT EXISTS postgres_fdw");
    try {
      await owner.query(`CREATE SERVER "${shopServer}" FOREIGN DATA WRAPPER postgres_fdw
        OPTIONS (host 'fdw-remote.invalid', port '5432', dbname 'shop')`);
      // Das Passwort des fremden Systems, dort wo es hingehoert: in der
      // Benutzerzuordnung.
      await owner.query(`CREATE USER MAPPING FOR "${expectedRole}" SERVER "${shopServer}"
        OPTIONS (user 'remote_reader', password '${mappingSecret}')`);
      await owner.query(`CREATE FOREIGN DATA WRAPPER "${bareWrapper}"`);
      // Und ein Geheimnis dort, wo es nicht hingehoert, aber landen kann.
      await owner.query(`CREATE SERVER "${legacyServer}" FOREIGN DATA WRAPPER "${bareWrapper}"
        OPTIONS (host 'fdw-legacy.invalid', password '${serverSecret}', api_key '${serverKey}')`);
      await owner.query(`CREATE SCHEMA "${schema}"`);
      await owner.query(`CREATE FOREIGN TABLE "${schema}"."bestellungen" (id integer, betrag numeric)
        SERVER "${shopServer}" OPTIONS (schema_name 'public', table_name 'orders')`);

      // --- Zusage 1: das Geheimnis steht wirklich im Katalog ---------------
      const stored = await owner.query<{ umoptions: string[] }>(
        `SELECT mapping.umoptions AS umoptions
         FROM pg_catalog.pg_user_mapping AS mapping
         JOIN pg_catalog.pg_foreign_server AS server ON server.oid = mapping.umserver
         WHERE server.srvname = $1`, [shopServer]);
      expect(stored.rows[0]?.umoptions, "die Zuordnung traegt das Passwort nicht; dann prueft dieser Fall nichts")
        .toContain(`password=${mappingSecret}`);

      const projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
      try {
        // --- Zusage 2: dieselbe Rolle kaeme an das Geheimnis heran ---------
        const exposed = await projectApi.query<{ srvoptions: string[] }>(
          "SELECT srvoptions FROM pg_catalog.pg_foreign_server WHERE srvname = $1", [legacyServer]);
        expect(exposed.rows[0]?.srvoptions,
          "die Leserolle sieht srvoptions nicht; dann belegt dieser Fall keine Entscheidung von QKERN")
          .toContain(`password=${serverSecret}`);
        // --- Zusage 3: die Katalogtabelle der Zuordnungen ist gesperrt -----
        await expect(projectApi.query("SELECT umoptions FROM pg_catalog.pg_user_mapping"))
          .rejects.toThrowError(/permission denied/i);

        const service = new ProjectDataPlaneService(
          { resolveTarget: async () => ({ databaseInstanceRef: "managed:fdw-2-72" }) },
          { resolve: async () => ({
            pool: projectApi,
            expectedRole,
            expectedDatabase,
            expectedLedgerOwner: "qkern",
          }) },
        );
        const inspection = { organizationId: organizationA, actorRef: `integration-${userId}@qkern.test` };
        const result = await service.inspectForeignDataWrappers(inspection,
          { projectId: randomUUID(), environment: "development" });

        // --- Die Form der Antwort ------------------------------------------
        expect(result.source).toBe("postgres");
        expect(Object.keys(result).sort())
          .toEqual(["servers", "source", "tables", "truncated", "userMappings", "wrappers"]);
        expect(result.truncated).toBe(false);

        // --- Der echte Wrapper, wie der Katalog ihn fuehrt -------------------
        const postgresFdw = result.wrappers.find((entry) => entry.name === "postgres_fdw");
        expect(postgresFdw, "der angelegte Wrapper fehlt in der Antwort").toBeDefined();
        expect(postgresFdw!.handler).toBe("postgres_fdw_handler");
        expect(postgresFdw!.validator).toBe("postgres_fdw_validator");
        expect(postgresFdw!.owner).toBe("qkern");
        // Der Wrapper ohne Validator steht mit zwei Nullen da, und die Ansicht
        // macht daraus die Warnung.
        const bare = result.wrappers.find((entry) => entry.name === bareWrapper);
        expect(bare, "der Wrapper ohne Validator fehlt in der Antwort").toBeDefined();
        expect(bare!.handler).toBeNull();
        expect(bare!.validator).toBeNull();

        // --- Die Serveroptionen: gezeigt wird, wohin, nicht als wer ---------
        const shop = result.servers.find((entry) => entry.name === shopServer);
        expect(shop, "der Fremdserver fehlt in der Antwort").toBeDefined();
        expect(shop!.wrapper).toBe("postgres_fdw");
        expect(shop!.options).toEqual([
          { key: "dbname", value: "shop" },
          { key: "host", value: "fdw-remote.invalid" },
          { key: "port", value: "5432" },
        ]);
        const legacy = result.servers.find((entry) => entry.name === legacyServer);
        expect(legacy, "der Fremdserver ohne Validator fehlt in der Antwort").toBeDefined();
        // Der Schluessel steht da, der Wert nicht. Dass eine Option gesetzt
        // ist, darf man sehen; was drinsteht nicht.
        expect(legacy!.options).toEqual([
          { key: "api_key", value: null },
          { key: "host", value: "fdw-legacy.invalid" },
          { key: "password", value: null },
        ]);

        // --- Die Zuordnung: Server und Rolle, sonst nichts ------------------
        const mapping = result.userMappings.find((entry) => entry.server === shopServer);
        expect(mapping, "die Benutzerzuordnung fehlt in der Antwort").toBeDefined();
        expect(mapping!.user).toBe(expectedRole);
        expect(Object.keys(mapping!).sort()).toEqual(["server", "user"]);

        // --- Die Fremdtabelle ----------------------------------------------
        const table = result.tables.find((entry) => entry.schema === schema);
        expect(table, "die Fremdtabelle fehlt in der Antwort").toBeDefined();
        expect(table!.name).toBe("bestellungen");
        expect(table!.server).toBe(shopServer);

        // --- Kein Geheimnis in der ganzen Antwort ---------------------------
        const serialised = JSON.stringify(result);
        expect(serialised, "das Passwort der Benutzerzuordnung").not.toContain(mappingSecret);
        expect(serialised, "das Passwort in der Serveroption").not.toContain(serverSecret);
        expect(serialised, "der Schluessel in der Serveroption").not.toContain(serverKey);
        expect(serialised, "der Kontoname im fremden System").not.toContain("remote_reader");
        // Und auch nicht das Passwort der eigenen Verbindung.
        expect(serialised).not.toContain(decodeURIComponent(target.password));
        for (const forbidden of ["umoptions", "ftoptions", "fdwoptions"]) {
          expect(serialised.toLowerCase(), forbidden).not.toContain(forbidden);
        }
        // Die Gegenprobe zur Gegenprobe: Die Namen stehen sehr wohl drin. Ein
        // leerer String bestuende jede Pruefung darueber.
        expect(serialised).toContain(shopServer);
        expect(serialised).toContain(legacyServer);
      } finally {
        await projectApi.end();
      }
    } finally {
      await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await owner.query(`DROP SERVER IF EXISTS "${shopServer}" CASCADE`);
      await owner.query(`DROP SERVER IF EXISTS "${legacyServer}" CASCADE`);
      await owner.query(`DROP FOREIGN DATA WRAPPER IF EXISTS "${bareWrapper}" CASCADE`);
      await owner.query("DROP EXTENSION IF EXISTS postgres_fdw CASCADE");
    }
  }, 120_000);
  it("(2.74) reads a real replication slot with its backlog and carries no connection secret out", async () => {
    // Datenbank -> Replikation (2.74) gegen die echte Datenbank.
    //
    // Der Unit-Test prueft die Abbildung an einem Fake-Client. Das ist die
    // halbe Zusage. Die andere Haelfte kann nur ein echter Server belegen,
    // und sie ist die, auf der dieser Schnitt steht:
    //
    // 1. **Der Rueckstand ist echt und er waechst.** Der Fall legt einen
    //    echten Slot an, der WAL reserviert, und keinen Konsumenten dazu.
    //    Dann schreibt er WAL und liest zweimal: Die gemeldete Zahl waechst
    //    zwischen den beiden Lesungen. Genau so fuellt ein verlassener Slot
    //    eine Platte, und genau das ist die Zahl, die die Seite zeigt.
    // 2. **Die Publikation steht als das da, was sie ist.** Sie kommt aus
    //    derselben Anweisung wie auf der Seite Publikationen; der Fall legt
    //    eine echte an und liest sie durch den Produktcode zurueck.
    // 3. **Kein Verbindungsgeheimnis in der Antwort.** `subconninfo` waere
    //    das Feld, in dem eines stuende. Der Fall zeigt, dass die Leserolle an
    //    dieser Spalte abgewiesen wird, und dass dieselbe Lesung trotzdem
    //    durchgeht, weil sie die Spalte nicht auswaehlt. Dazu kommt die
    //    Gegenprobe auf das Passwort der eigenen Verbindung.
    //
    // Ein logischer Slot steht hier nicht, und das ist keine Luecke: Der
    // Zertifizierungsstack faehrt `wal_level = replica`, und darunter laesst
    // PostgreSQL keinen logischen Slot anlegen. Der Fall prueft darum, dass
    // die Lesung genau dieses `wal_level` meldet, statt eines zu behaupten.
    expect(projectApiUrl, "QKERN_TEST_PROJECT_API_DATABASE_URL fehlt").toBeTruthy();
    const target = new URL(projectApiUrl!);
    const expectedDatabase = target.pathname.slice(1);
    const expectedRole = decodeURIComponent(target.username);

    const suffix = randomUUID().replaceAll("-", "_").slice(0, 12);
    const slotName = `repl_2_74_${suffix}`;
    const publicationName = `repl_2_74_pub_${suffix}`;
    const schema = `repl_2_74_${suffix}`;

    // Der Aufbau laeuft als Eigentuemer. Einen Slot anzulegen verlangt das
    // Replikationsrecht, und genau darum kann die Seite es nicht.
    try {
      await owner.query(`CREATE SCHEMA "${schema}"`);
      await owner.query(`CREATE TABLE "${schema}".bestellungen (id integer PRIMARY KEY, betrag numeric NOT NULL)`);
      await owner.query(`CREATE PUBLICATION "${publicationName}" FOR TABLE "${schema}".bestellungen WITH (publish = 'insert, update')`);
      // `true` reserviert die Position sofort. Ohne sie haette der Slot keinen
      // Rueckstand, und der Fall pruefte die Zahl gar nicht.
      await owner.query("SELECT pg_catalog.pg_create_physical_replication_slot($1, true)", [slotName]);

      // --- Zusage 1: der Slot haelt wirklich WAL fest ----------------------
      const reserved = await owner.query<{ restart: string; status: string; safe: string | null }>(
        `SELECT restart_lsn::text AS restart, wal_status AS status, safe_wal_size::text AS safe
         FROM pg_catalog.pg_replication_slots WHERE slot_name = $1`, [slotName]);
      expect(reserved.rows[0]?.restart,
        "der Slot hat keine Position reserviert; dann prueft dieser Fall keinen Rueckstand")
        .toMatch(/^[0-9A-F]+\/[0-9A-F]+$/);
      expect(reserved.rows[0]?.status).toBe("reserved");
      const restartLsn = reserved.rows[0]!.restart;

      const projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
      try {
        // --- Zusage 3a: die Leserolle kommt an subconninfo nicht heran ------
        // Dieselbe Rolle, mit der die Ansicht liest. Waere die Spalte fuer sie
        // lesbar, waere die Entscheidung von QKERN nicht zu belegen; sie ist
        // es nicht, und die Lesung faellt trotzdem nicht aus, weil sie die
        // Spalte nicht auswaehlt.
        await expect(projectApi.query("SELECT subconninfo FROM pg_catalog.pg_subscription"))
          .rejects.toThrowError(/permission denied/i);

        const service = new ProjectDataPlaneService(
          { resolveTarget: async () => ({ databaseInstanceRef: "managed:repl-2-74" }) },
          { resolve: async () => ({
            pool: projectApi,
            expectedRole,
            expectedDatabase,
            expectedLedgerOwner: "qkern",
          }) },
        );
        const inspection = { organizationId: organizationA, actorRef: `integration-${userId}@qkern.test` };
        const replicationScope = { projectId: randomUUID(), environment: "development" as const };
        const before = await service.inspectReplication(inspection, replicationScope);

        // --- Die Form der Antwort ------------------------------------------
        expect(before.source).toBe("postgres");
        expect(Object.keys(before).sort()).toEqual([
          "inRecovery", "publications", "slots", "source", "subscriptions", "truncated", "walLevel",
        ]);
        expect(before.truncated).toBe(false);

        // --- Die beiden Schalter sind die des echten Servers ----------------
        const settings = await owner.query<{ level: string; recovery: boolean; keep: string }>(
          `SELECT current_setting('wal_level') AS level,
                  pg_catalog.pg_is_in_recovery() AS recovery,
                  current_setting('max_slot_wal_keep_size') AS keep`);
        expect(before.walLevel).toBe(settings.rows[0]!.level);
        expect(before.inRecovery).toBe(settings.rows[0]!.recovery);
        // Der Zertifizierungsstack faehrt einen Primaerserver ohne logische
        // Replikation. Waere das anders, waere es ein Fund und keine Toleranz.
        expect(before.walLevel, "der Stack faehrt wal_level = replica").toBe("replica");
        expect(before.inRecovery).toBe(false);

        // --- Zusage 1: der Slot, sein Zustand und sein Rueckstand -----------
        const slot = before.slots.find((entry) => entry.name === slotName);
        expect(slot, "der angelegte Slot fehlt in der Antwort").toBeDefined();
        expect(slot!.slotType).toBe("physical");
        expect(slot!.plugin).toBeNull();
        expect(slot!.database).toBeNull();
        expect(slot!.temporary).toBe(false);
        // Niemand haengt daran. Das ist der Fall, vor dem die Seite warnt.
        expect(slot!.active).toBe(false);
        expect(slot!.walStatus).toBe("reserved");
        expect(slot!.retainedBytes, "ein Slot mit reservierter Position haelt WAL fest")
          .toBeGreaterThanOrEqual(0);
        // Ohne gesetzte Grenze gibt es keine Restfrist, und `null` sagt das,
        // statt eine Zahl zu erfinden.
        expect(settings.rows[0]!.keep, "eine gesetzte Grenze wuerde diese Zusage verschieben").toBe("-1");
        expect(slot!.safeBytes).toBeNull();
        // Und das Urteil, das die Ansicht daraus macht, an einem echten Slot.
        expect(slotState(slot!)).toBe("abandoned");
        expect(SLOT_STATE_TEXTS[slotState(slot!)].tone).toBe("risk high");

        // --- Zusage 2: die Publikation --------------------------------------
        const publication = before.publications.find((entry) => entry.name === publicationName);
        expect(publication, "die angelegte Publikation fehlt in der Antwort").toBeDefined();
        expect(publication!.publishInsert).toBe(true);
        expect(publication!.publishUpdate).toBe(true);
        expect(publication!.publishDelete).toBe(false);
        expect(publication!.publishTruncate).toBe(false);
        expect(publication!.allTables).toBe(false);
        expect(publication!.tables).toEqual([`${schema}.bestellungen`]);
        expect(publication!.owner).toBe("qkern");
        // Dieselbe Publikation kommt aus der Lesung der Seite Publikationen;
        // es gibt dafuer eine Stelle im Code und nicht zwei.
        const pageRead = await service.inspectPublications(inspection, replicationScope);
        expect(pageRead.publications.find((entry) => entry.name === publicationName))
          .toEqual(publication);

        // --- Zusage 1b: der Rueckstand waechst, weil niemand liest ----------
        // Echtes WAL: Zeilen schreiben und das Segment wechseln. Der Slot
        // steht still, die Schreibposition nicht.
        await owner.query(`INSERT INTO "${schema}".bestellungen (id, betrag)
          SELECT schritt, schritt * 1.5 FROM generate_series(1, 20000) AS schritt`);
        await owner.query("SELECT pg_catalog.pg_switch_wal()");
        await owner.query(`INSERT INTO "${schema}".bestellungen (id, betrag)
          SELECT schritt, schritt * 2.5 FROM generate_series(20001, 40000) AS schritt`);

        const after = await service.inspectReplication(inspection, replicationScope);
        const later = after.slots.find((entry) => entry.name === slotName);
        expect(later, "der Slot fehlt in der zweiten Lesung").toBeDefined();
        expect(later!.retainedBytes,
          "der Rueckstand eines Slots ohne Konsumenten waechst nicht mit geschriebenem WAL")
          .toBeGreaterThan(slot!.retainedBytes!);
        // Und die Position des Slots ist dieselbe geblieben: Es waechst der
        // Abstand, nicht der Slot.
        const unmoved = await owner.query<{ restart: string }>(
          "SELECT restart_lsn::text AS restart FROM pg_catalog.pg_replication_slots WHERE slot_name = $1",
          [slotName]);
        expect(unmoved.rows[0]?.restart).toBe(restartLsn);

        // --- Zusage 3b: kein Geheimnis und keine Adresse in der Antwort -----
        const serialised = JSON.stringify(after);
        expect(serialised, "das Passwort der eigenen Verbindung")
          .not.toContain(decodeURIComponent(target.password));
        expect(serialised).not.toContain("://");
        // Keine LSN, auch nicht als Text: gerechnet wird der Abstand.
        expect(serialised).not.toContain(restartLsn);
        for (const forbidden of ["conninfo", "lsn", "origin", "password", "host"]) {
          expect(serialised.toLowerCase(), forbidden).not.toContain(forbidden);
        }
        // Die Gegenprobe zur Gegenprobe: Die Namen stehen sehr wohl drin. Ein
        // leerer String bestuende jede Pruefung darueber.
        expect(serialised).toContain(slotName);
        expect(serialised).toContain(publicationName);
      } finally {
        await projectApi.end();
      }
    } finally {
      // Der Slot muss weg, sonst haelt er WAL fest, bis die Platte voll ist,
      // und der naechste Lauf sieht Fremdes. Genau das sagt die Seite.
      await owner.query(
        `SELECT pg_catalog.pg_drop_replication_slot(slot_name)
         FROM pg_catalog.pg_replication_slots WHERE slot_name = $1`, [slotName]);
      await owner.query(`DROP PUBLICATION IF EXISTS "${publicationName}"`);
      await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  }, 120_000);
  it("(2.75) turns a real project event into a signed dashboard webhook delivery", async () => {
    // Die Grenze des Dashboard-Webhook-Slices (2.75) an echten Ereignissen der
    // Control Plane: Was hinausgeht, muss genau die Projektion der
    // Console-Ansicht sein, und der Weg dorthin muss der Produktweg sein.
    //
    // Der Vertrag `tests/dashboard-webhook-field-boundary` vergleicht Listen am
    // Quelltext. Er kann nicht sagen, ob der Audit-Eintrag aus der Datenbank
    // wirklich so aussieht -- ob also `actor_ref` beim Lesen tatsaechlich
    // wegfaellt, ob von den Metadaten nur die erlaubten Schluessel die
    // Datenbank verlassen, ob die Huelle ohne Ziel und ohne Referenz in der
    // Outbox landet und ob der Zusteller sie mit dem Schluessel aus einem
    // echten Vault signiert. Genau das laeuft hier, und zwar ueber die echte
    // Produktkette: `PostgresControlPlaneService` schreibt Change Set und
    // Freigabe und dazu den Audit-Eintrag, `PostgresDashboardEventReader` liest
    // ihn, `DashboardWebhookCollector` reiht ihn ein, `WebhookOutbox` haelt ihn,
    // `WebhookDeliveryRuntime` stellt zu.
    //
    // Der Fall hat zwei Haelften, weil die Grenze zwei verschiedene Dinge
    // zusagt. Die **menschliche** Freigabe traegt in `actor_ref` die
    // E-Mail-Adresse des Kontos und in den Metadaten den Aktionshash: Beides
    // zeigt die Console, und beides darf im gesendeten Koerper nirgends stehen.
    // Die **automatische** Freigabe traegt drei Metadatenschluessel, von denen
    // genau einer auf der Positivliste steht: `risk` geht mit, `policyMode` und
    // `policyRevision` nicht.
    //
    // Der Stack: PostgreSQL, weil der Fall eine echte Control Plane **und**
    // einen echten Vault gleichzeitig braucht. Der Vault-Stack hat keine
    // Datenbank; seit 2.50 laeuft im PostgreSQL-Stack ein Vault, genau aus
    // diesem Grund.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.50, 2.53, 2.59 und 2.63:
    // Das gemeinsame afterAll muss organizationA und organizationB loswerden,
    // und eine Organisation mit unloeschbaren Zeilen darunter blockiert das.
    // Abgeraeumt wird am Ende nur, was das Produkt selbst loeschen wuerde --
    // und das ist hier nichts: `audit_logs` ist append-only, sein
    // Fremdschluessel auf `organizations` ist `ON DELETE RESTRICT`, und die
    // Dashboard-Webhook-Flaeche loescht ausdruecklich nicht.
    expect(vaultKvUrl, "QKERN_TEST_VAULT_KV_URL fehlt").toBeTruthy();
    expect(vaultTokenFile, "QKERN_TEST_VAULT_TOKEN_FILE fehlt").toBeTruthy();
    expect(databaseWebhookSecretRef, "QKERN_TEST_DATABASE_WEBHOOK_SECRET_REF fehlt").toBeTruthy();

    const hookOwner = randomUUID();
    const hookOrganization = randomUUID();
    const hookProject = randomUUID();
    // Die Adresse ist der Lackmustest. `audit_logs.actor_ref` nimmt sie auf,
    // die Audit-Ansicht der Console zeigt sie, und eine Meldung darf sie nicht
    // tragen.
    const actorRef = `dashboard-hook-${hookOwner}@qkern.test`;

    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`, [hookOwner, actorRef]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Dashboard Webhooks', $2, $3)`,
    [hookOrganization, `dashboard-hooks-${hookOrganization}`, hookOwner]);
    await owner.query(`INSERT INTO organization_members
      (organization_id, user_id, role, is_personal_workspace)
      VALUES ($1, $2, 'owner', true)`, [hookOrganization, hookOwner]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Dashboard Webhooks', $3, 'test', 'ready', $4)`,
    [hookProject, hookOrganization, `dashboard-hooks-${hookProject}`, hookOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`,
    [hookOrganization, hookProject, `managed:${hookProject}`]);

    const scope = {
      organizationId: hookOrganization, projectId: hookProject,
      environment: "development" as const,
    };
    const admin = {
      organizationId: hookOrganization, actorRef, role: "admin" as const, subject: hookOwner,
    };
    const control = new PostgresControlPlane(runtime);
    const hooks = new PostgresDashboardWebhookRepository(control);
    const cursors = new PostgresDashboardWebhookCursorRepository(control);

    // Die Definition ueber den echten Dienst, mit der echten Pruefung. Zwei
    // Ereignisarten: eine, die vorkommt, und eine, die nicht vorkommt. Ohne die
    // zweite bewiese der Fall nichts darueber, dass je Art gelesen wird.
    const service = new DashboardWebhookService({ repository: hooks, collector: cursors });
    const hook = await service.create(admin, scope, {
      name: "ereignisse-an-chat",
      url: "https://chat.example.com/qkern/ereignisse",
      kinds: ["migration_applied", "approval_decided"],
      signingSecretRef: databaseWebhookSecretRef!,
    });
    expect(hook.kinds).toEqual(["migration_applied", "approval_decided"]);
    expect(hook.eventTypes)
      .toEqual(["project.migration_applied", "project.approval_decided"]);
    expect(hook.enabled).toBe(true);
    // Kein Geheimniswert, nirgends -- nur die Referenz.
    expect(JSON.stringify(hook)).not.toContain("secret\":\"");
    expect(hook.signingSecretRef).toBe(databaseWebhookSecretRef);

    const outboxRepository = new PostgresWebhookOutboxRepository(control);
    const collector = new DashboardWebhookCollector({
      reader: new PostgresDashboardEventReader(control),
      bindings: hooks,
      outbox: new WebhookOutbox({ repository: outboxRepository }),
      cursors,
      scope,
    });
    // Der erste Lauf setzt den Stand auf die Spitze: Ein neu angelegter
    // Dashboard-Webhook meldet dem Empfaenger nicht als erste Handlung die
    // Geschichte des Projekts.
    expect(await collector.poll()).toBe(0);
    // Und er behauptet noch nichts gemeldet zu haben.
    expect(await service.collectorState(admin, scope)).toEqual([]);

    const plane = new PostgresControlPlaneService(
      new PostgresControlPlane(owner),
      new AesGcmStatementCipher(Buffer.from("0".repeat(64), "hex")),
    );
    const context = {
      organizationId: hookOrganization,
      actor: { id: hookOwner, ref: actorRef, type: "user" as const },
    };
    const audit = () => new PostgresControlPlane(owner).withTenant(
      { organizationId: hookOrganization, actorRef, readOnly: true },
      async (repositories) => repositories.audit.list({
        projectId: hookProject, environment: "development", limit: 50,
      }));

    // ---- Erste Haelfte: die menschliche Freigabe ----
    //
    // Die Vorgabe ist `manual`, eine Schemaaenderung braucht also eine
    // Entscheidung. Entschieden wird ueber denselben Dienst, den die
    // Freigabezentrale ruft; er entschluesselt die Anweisung noch einmal und
    // rechnet den Aktionshash nach.
    const table = `dashhooks_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const statement = `CREATE TABLE ${table} (id uuid PRIMARY KEY)`;
    const change = await plane.createChangeSet(context, {
      projectId: hookProject, environment: "development",
      title: `Tabelle anlegen: ${table}`, statement,
    });
    const approvals = await owner.query<{ id: string }>(
      "SELECT id FROM approval_requests WHERE change_set_id = $1", [change.id]);
    expect(approvals.rows, "eine Schemaaenderung braucht eine Freigabe").toHaveLength(1);
    const approved = await plane.decideApproval(context, {
      approvalId: approvals.rows[0].id, decision: "approved",
    });
    expect(approved.status).toBe("approved");

    // Die Console zeigt den Eintrag -- **mit** der Adresse des Akteurs. Gelesen
    // wird er mit demselben Repository und derselben Abbildung, die den
    // Console-Snapshot fuellen.
    const afterDecision = await audit();
    const human = afterDecision.filter((record) => record.action === "approval.approved");
    expect(human, "die Entscheidung hat keinen Audit-Eintrag geschrieben").toHaveLength(1);
    expect(auditEventFromRecord(human[0])?.actor, "die Console zeigt die Adresse nicht")
      .toBe(actorRef);
    expect(Object.keys(human[0].redactedMetadata)).toEqual(["actionHash"]);
    // Die Vorschau des Change Sets steht ebenfalls im Protokoll, mit derselben
    // Adresse. Sie ist keine Ereignisart, und deshalb darf sie nichts ausloesen.
    expect(afterDecision.some((record) => record.action === "qkern_migration_preview")).toBe(true);

    // Und jetzt der Dashboard-Webhook.
    expect(await collector.poll()).toBe(1);

    const first = await owner.query<{
      event_type: string; status: string; payload: Record<string, unknown>;
    }>(`SELECT event_type, status, payload FROM project_webhook_deliveries
         WHERE organization_id = $1 AND project_id = $2
         ORDER BY occurred_at, id`, [hookOrganization, hookProject]);
    // Genau eine Meldung: Die zweite Ereignisart hat keinen Eintrag, und die
    // Vorschau des Change Sets ist keine Ereignisart.
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0].event_type).toBe("project.approval_decided");
    expect(first.rows[0].status).toBe("pending");
    expect(Object.keys(first.rows[0].payload).sort())
      .toEqual(["event", "kind", "schemaVersion"]);
    expect(first.rows[0].payload.kind).toBe("approval_decided");

    const allowed = [...DASHBOARD_EVENT_DEFINITIONS.approval_decided.fields];
    const event = first.rows[0].payload.event as Record<string, unknown>;
    // Der Kern des Falls: Feld fuer Feld nur die Liste, die die Console zeigt.
    // Die Liste ist eine Obergrenze -- ein Metadatenschluessel, den dieser
    // Eintrag nicht traegt, fehlt auch in der Meldung.
    for (const field of Object.keys(event)) {
      expect(allowed, `${field} steht nicht auf der Positivliste`).toContain(field);
    }
    for (const field of ["id", "createdAt", "action", "status", "environment", "projectId",
      "resource"]) {
      expect(Object.keys(event), field).toContain(field);
    }
    expect(event.id).toBe(human[0].id);
    expect(event.action).toBe("approval.approved");
    expect(event.status).toBe("success");
    expect(event.environment).toBe("development");
    expect(event.projectId).toBe(hookProject);
    expect(event.resource).toBe(approvals.rows[0].id);
    // Der Aktionshash steht in den Metadaten, aber nicht auf der Liste.
    expect(event).not.toHaveProperty("actionHash");

    const stored = JSON.stringify(first.rows[0].payload);
    expect(stored, "die Meldung traegt die Adresse des Akteurs").not.toContain(actorRef);
    expect(stored, "die Meldung traegt die Anweisung").not.toContain(table);
    expect(stored, "die Meldung traegt den Aktionshash")
      .not.toContain(String(human[0].redactedMetadata.actionHash));
    expect(stored, "die Meldung traegt die Hashkette").not.toContain(human[0].entryHash);
    expect(stored, "die Meldung traegt das Ziel").not.toContain("chat.example.com");
    expect(stored, "die Meldung traegt die Geheimnisreferenz")
      .not.toContain(databaseWebhookSecretRef!);

    // Der Stand des Sammlers, so wie die Ansicht ihn zeigt: je Webhook und Art
    // eine Zeile, und nur fuer die Art, die wirklich gemeldet hat.
    const state = await service.collectorState(admin, scope);
    expect(state).toHaveLength(1);
    expect(state![0].kind).toBe("approval_decided");
    expect(state![0].webhookId).toBe(hook.webhookId);
    expect(state![0].position.endsWith(`#${human[0].id}`)).toBe(true);

    // Der echte Zustellprozess mit dem echten Signierer und dem echten Vault.
    const secrets = new VaultWebhookSecretProvider({
      vaultKvUrl: new URL(vaultKvUrl!),
      tokenProvider: new VaultTokenFileProvider(vaultTokenFile!),
      cacheTtlMs: 0,
    });
    const sent: Array<{ headers: Record<string, string>; body: string; url: string }> = [];
    const delivery = new WebhookDeliveryRuntime({
      outbox: new WebhookOutbox({ repository: outboxRepository }),
      definitions: outboxRepository,
      deliverer: new WebhookDeliverer(new HmacWebhookSigner(secrets), {
        // Der Empfaenger ist die eine nachgebaute Stelle: Er bestaetigt die
        // Zustellung so, wie der Vertrag es verlangt, und haelt fest, was
        // wirklich gesendet wurde.
        send: async (request) => {
          sent.push({ headers: { ...request.headers }, body: request.body, url: request.url });
          return { status: 200, acknowledgementId: request.headers["x-qkern-delivery-id"] ?? null };
        },
      }),
      scope,
      workerId: "certification-dashboard-hooks-1",
    });
    expect(await delivery.runOnce(), "der Zustellprozess hat nicht zugestellt")
      .toMatchObject({ delivered: 1, failed: 0, skipped: 0 });
    expect(sent).toHaveLength(1);
    const delivered = sent[0];
    expect(delivered.url).toBe("https://chat.example.com/qkern/ereignisse");
    expect(delivered.headers["x-qkern-event"]).toBe("project.approval_decided");
    // Dieselbe Grenze noch einmal, aber am wirklich gesendeten Koerper: Was die
    // Datenbank nicht traegt, koennte der Zusteller immer noch ergaenzt haben.
    expect(delivered.body).not.toContain(actorRef);
    expect(delivered.body).not.toContain(table);
    expect(delivered.body).not.toContain(human[0].entryHash);
    expect(delivered.body).toContain(human[0].id);
    const body = JSON.parse(delivered.body) as {
      data: { kind: string; event: Record<string, unknown> };
    };
    expect(body.data.kind).toBe("approval_decided");
    for (const field of Object.keys(body.data.event)) {
      expect(allowed, `${field} steht nicht auf der Positivliste`).toContain(field);
    }

    // Die Gegenrechnung: der Schluessel aus dem Vault, die Pruefung ohne den
    // Signierer. Eine Signatur, die nur gegen sich selbst stimmt, waere keine.
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

    // ---- Zweite Haelfte: die automatische Freigabe ----
    //
    // Sie ist der Weg, auf dem die Metadaten `policyMode`, `policyRevision` und
    // `risk` entstehen. Genau einer davon steht auf der Positivliste.
    await plane.setAutomationPolicy(context, {
      projectId: hookProject, environment: "development", mode: "autonomous",
      maxAutoRisk: "critical", autoQueue: false, emergencyStop: false,
    });
    const autoTable = `dashhooks_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const autoChange = await plane.createChangeSet(context, {
      projectId: hookProject, environment: "development",
      title: `Tabelle anlegen: ${autoTable}`,
      statement: `CREATE TABLE ${autoTable} (id uuid PRIMARY KEY)`,
    });
    expect(autoChange.status, "die Automatik hat nicht freigegeben").toBe("approved");

    const afterAutomation = await audit();
    const automatic = afterAutomation.filter(
      (record) => record.action === "approval.automatically_approved");
    expect(automatic, "die Automatik hat keinen Audit-Eintrag geschrieben").toHaveLength(1);
    expect(Object.keys(automatic[0].redactedMetadata).sort())
      .toEqual(["policyMode", "policyRevision", "risk"]);
    // Der Akteur ist hier die Regel und nicht ein Mensch. Auch sie geht nicht
    // hinaus: Zurueckgehalten wird das Feld, nicht eine bestimmte Sorte Wert.
    expect(auditEventFromRecord(automatic[0])?.actor).toBe("qkern-automation-policy:1");
    // Und die Regelaenderung steht ebenfalls im Protokoll. Sie ist keine
    // Ereignisart, und deshalb darf sie nichts ausloesen.
    expect(afterAutomation.some((record) => record.action === "automation.policy.updated"))
      .toBe(true);

    expect(await collector.poll()).toBe(1);
    const second = await owner.query<{ event_type: string; payload: Record<string, unknown> }>(
      `SELECT event_type, payload FROM project_webhook_deliveries
        WHERE organization_id = $1 AND project_id = $2
        ORDER BY occurred_at DESC, id DESC LIMIT 1`, [hookOrganization, hookProject]);
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0].event_type).toBe("project.approval_decided");
    const autoEvent = second.rows[0].payload.event as Record<string, unknown>;
    expect(autoEvent.id).toBe(automatic[0].id);
    expect(autoEvent.action).toBe("approval.automatically_approved");
    // Der erlaubte Metadatenschluessel geht mit, die beiden anderen nicht.
    expect(autoEvent.risk).toBe(automatic[0].redactedMetadata.risk);
    expect(autoEvent).not.toHaveProperty("policyMode");
    expect(autoEvent).not.toHaveProperty("policyRevision");
    for (const field of Object.keys(autoEvent)) {
      expect(allowed, `${field} steht nicht auf der Positivliste`).toContain(field);
    }
    const autoStored = JSON.stringify(second.rows[0].payload);
    expect(autoStored, "die Meldung traegt die Fassung der Automatikregel")
      .not.toContain("policyRevision");
    expect(autoStored, "die Meldung traegt die Referenz der Automatikregel")
      .not.toContain("qkern-automation-policy");
    expect(autoStored, "die Meldung traegt die Anweisung").not.toContain(autoTable);

    // Abgeschaltet meldet der Webhook nichts Neues. Die dritte Freigabe steht im
    // Audit-Log und bleibt dort -- das ist der Unterschied zwischen pausieren
    // und stauen.
    await service.setEnabled(admin, scope, hook.id, false);
    const thirdTable = `dashhooks_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await plane.createChangeSet(context, {
      projectId: hookProject, environment: "development",
      title: `Tabelle anlegen: ${thirdTable}`,
      statement: `CREATE TABLE ${thirdTable} (id uuid PRIMARY KEY)`,
    });
    expect(await collector.poll()).toBe(0);
    const afterDisable = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM project_webhook_deliveries
        WHERE organization_id = $1 AND project_id = $2`, [hookOrganization, hookProject]);
    expect(afterDisable.rows[0]?.n).toBe("2");
    expect((await audit()).filter(
      (record) => record.action === "approval.automatically_approved")).toHaveLength(2);
  }, 120_000);
  it("(2.78) issues an S3 access key pair once, never again, and revokes without deleting", async () => {
    // Der S3-Zugang (2.78) gegen die echte Datenbank.
    //
    // Der Slice gibt Schluesselpaare aus und verwaltet sie; er prueft keine
    // Signatur, weil er das Geheimnis nicht behaelt. Genau darum haengt alles
    // an der Frage, ob das Geheimnis wirklich nur einmal vorkommt. Ein
    // Vertrag am Quelltext kann das nicht sagen: Er sieht nicht, was in der
    // Tabelle steht, welche Spalten es ueberhaupt gibt, was die Liste aus der
    // Datenbank zurueckbringt und was die Laufzeitrolle auf der Tabelle darf.
    //
    // Gelaufen wird der Produktweg: `PostgresProjectStorageRepository` legt
    // zwei echte Buckets an, `PostgresProjectStorageS3AccessKeyStore` schreibt
    // ueber `withTenant` mit der Laufzeitrolle, und
    // `ProjectStorageS3AccessKeyService` ist derselbe Dienst, den die Route
    // benutzt.
    //
    // Sieben Zusagen:
    //   1. Gespeichert ist der Hash, und es gibt keine Spalte fuer den Wert.
    //   2. Die Liste traegt weder das Geheimnis noch seinen Hash, und ihre
    //      Felder sind genau die neun erlaubten.
    //   3. Widerruf wirkt sofort, ein zweiter verschiebt den Zeitpunkt nicht,
    //      und die Zeile bleibt stehen.
    //   4. Die Laufzeitrolle darf lesen, schreiben und widerrufen, aber nicht
    //      loeschen und den Hash nicht ueberschreiben.
    //   5. Der Waechter in der Datenbank laesst den Widerruf nur einmal setzen.
    //   6. Ein fremder Bucket bekommt eine 404 und keine Constraint-Meldung.
    //   7. Die Audit-Eintraege tragen keinen Wert und keinen Hash.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.75: Das gemeinsame
    // afterAll muss organizationA und organizationB loswerden, und
    // `audit_logs` haengt mit ON DELETE RESTRICT an `organizations`. Diese
    // Organisation bleibt deshalb absichtlich stehen; die Flaeche dieses Slices
    // loescht ohnehin nichts.
    const keyOwner = randomUUID();
    const keyOrganization = randomUUID();
    const keyProject = randomUUID();
    const actorRef = `s3-keys-${keyOwner}@qkern.test`;

    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`, [keyOwner, actorRef]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'S3 Access Keys', $2, $3)`,
    [keyOrganization, `s3-keys-${keyOrganization}`, keyOwner]);
    await owner.query(`INSERT INTO organization_members
      (organization_id, user_id, role, is_personal_workspace)
      VALUES ($1, $2, 'owner', true)`, [keyOrganization, keyOwner]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'S3 Access Keys', $3, 'test', 'ready', $4)`,
    [keyProject, keyOrganization, `s3-keys-${keyProject}`, keyOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`,
    [keyOrganization, keyProject, `managed:${keyProject}`]);

    const scope = {
      organizationId: keyOrganization, projectId: keyProject, environment: "development" as const,
    };
    const principal = {
      organizationId: keyOrganization, actorRef, role: "admin" as const, subject: keyOwner,
    };
    const control = new PostgresControlPlane(runtime);
    const buckets = new PostgresProjectStorageRepository(control);
    const service = new ProjectStorageS3AccessKeyService({
      store: new PostgresProjectStorageS3AccessKeyStore(control),
      buckets,
    });

    // Zwei echte Buckets, damit der Bucket-Satz mehr als eine Zeile hat und die
    // Kopplungstabelle wirklich geprueft wird.
    const bucketAt = new Date();
    const bucketOf = async (suffix: string) => buckets.createBucket(principal, {
      ...scope, id: randomUUID(), name: `s3keys-${suffix}-${randomUUID().slice(0, 8)}`,
      readPolicy: "private", writePolicy: "private", allowedMimeTypes: ["text/plain"],
      maxObjectBytes: 1_024, quotaBytes: 8_192, usedBytes: 0, reservedBytes: 0,
      retentionDays: null, createdAt: bucketAt, updatedAt: bucketAt,
    });
    const bucketA = await bucketOf("a");
    const bucketB = await bucketOf("b");

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString();
    const issued = await service.create(principal, scope, {
      name: "Fremdes Werkzeug", bucketIds: [bucketB.id, bucketA.id], expiresAt,
    });
    expect(issued.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.key.accessKeyId).toMatch(/^QKERNS3[A-Z2-7]{16}$/);
    expect(issued.key.bucketIds).toEqual([bucketA.id, bucketB.id].sort());
    expect(issued.key.revokedAt).toBeNull();
    const secretHash = hashS3AccessKeySecret(issued.secret);

    // --- Zusage 1: der Hash steht da, der Wert hat keine Spalte -------------
    const stored = await owner.query<{ secret_hash: string }>(
      `SELECT secret_hash FROM project_storage_s3_access_keys WHERE id = $1`, [issued.key.id]);
    expect(stored.rows[0]?.secret_hash).toBe(secretHash);
    expect(stored.rows[0]?.secret_hash).not.toBe(issued.secret);
    const columns = await owner.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'project_storage_s3_access_keys'`);
    const columnNames = columns.rows.map((row) => String(row.column_name));
    // Genau eine Spalte trifft das Muster, und sie traegt den Hash. Kaeme je
    // eine zweite hinzu, die den Wert aufnehmen koennte, faellt dieser Fall.
    expect(columnNames.filter((name) => /secret|token|password|key_material/.test(name)))
      .toEqual(["secret_hash"]);

    // --- Zusage 2: die Liste kennt es nicht --------------------------------
    const listed = await service.list(principal, scope);
    expect(listed).toHaveLength(1);
    expect(Object.keys(listed[0]).sort()).toEqual([
      "accessKeyId", "bucketIds", "createdAt", "environment", "expiresAt",
      "id", "name", "projectId", "revokedAt",
    ]);
    const listedJson = JSON.stringify(listed);
    expect(listedJson).not.toContain(issued.secret);
    expect(listedJson).not.toContain(secretHash);
    expect(listed[0].accessKeyId).toBe(issued.key.accessKeyId);
    expect(listed[0].bucketIds).toEqual([bucketA.id, bucketB.id].sort());

    // --- Zusage 3: Widerruf wirkt sofort und loescht nicht -----------------
    const revoked = await service.revoke(principal, scope, issued.key.id);
    expect(revoked.revokedAt).not.toBeNull();
    const revokedAgain = await service.revoke(principal, scope, issued.key.id);
    expect(revokedAgain.revokedAt).toBe(revoked.revokedAt);
    const afterRevoke = await service.list(principal, scope);
    expect(afterRevoke).toHaveLength(1);
    expect(afterRevoke[0].revokedAt).toBe(revoked.revokedAt);
    const afterRevokeJson = JSON.stringify(afterRevoke);
    expect(afterRevokeJson).not.toContain(issued.secret);
    expect(afterRevokeJson).not.toContain(secretHash);

    // --- Zusage 4: die Rechte der Laufzeitrolle ----------------------------
    await expect(runtime.query(
      `DELETE FROM project_storage_s3_access_keys WHERE id = $1`, [issued.key.id]))
      .rejects.toThrowError(/permission denied/i);
    await expect(runtime.query(
      `UPDATE project_storage_s3_access_keys SET name = 'anders' WHERE id = $1`, [issued.key.id]))
      .rejects.toThrowError(/permission denied/i);
    const privileges = await owner.query<Record<string, boolean>>(
      `SELECT has_table_privilege('qkern_runtime', 'project_storage_s3_access_keys', 'SELECT') AS may_select,
              has_table_privilege('qkern_runtime', 'project_storage_s3_access_keys', 'INSERT') AS may_insert,
              has_table_privilege('qkern_runtime', 'project_storage_s3_access_keys', 'DELETE') AS may_delete,
              has_column_privilege('qkern_runtime', 'project_storage_s3_access_keys', 'revoked_at', 'UPDATE') AS may_revoke,
              has_column_privilege('qkern_runtime', 'project_storage_s3_access_keys', 'secret_hash', 'UPDATE') AS may_rewrite_hash,
              has_table_privilege('qkern_runtime', 'project_storage_s3_access_key_buckets', 'SELECT') AS may_read_buckets,
              has_table_privilege('qkern_runtime', 'project_storage_s3_access_key_buckets', 'DELETE') AS may_unlink_buckets`);
    expect(privileges.rows[0]).toMatchObject({
      may_select: true, may_insert: true, may_delete: false,
      may_revoke: true, may_rewrite_hash: false,
      may_read_buckets: true, may_unlink_buckets: true,
    });

    // --- Zusage 5: der Widerruf geht nur in eine Richtung ------------------
    await expect(owner.query(
      `UPDATE project_storage_s3_access_keys SET revoked_at = now() + interval '1 hour' WHERE id = $1`,
      [issued.key.id])).rejects.toMatchObject({ code: "55000" });

    // --- Zusage 6: ein fremder Bucket ist eine 404 ------------------------
    await expect(service.create(principal, scope, {
      name: "Fremder Bucket", bucketIds: [randomUUID()], expiresAt,
    })).rejects.toMatchObject({ code: "STORAGE_RESOURCE_NOT_FOUND" });

    // --- Zusage 7: die Spur traegt keinen Wert ----------------------------
    const auditRows = await owner.query<{ action: string; metadata: string }>(
      `SELECT action, redacted_metadata::text AS metadata FROM audit_logs
        WHERE organization_id = $1`, [keyOrganization]);
    const actions = auditRows.rows.map((row) => String(row.action));
    expect(actions).toContain("project.storage.s3_access_key.created");
    expect(actions).toContain("project.storage.s3_access_key.revoked");
    for (const row of auditRows.rows) {
      expect(String(row.metadata)).not.toContain(issued.secret);
      expect(String(row.metadata)).not.toContain(secretHash);
    }
  }, 120_000);
  it("(2.77) calls the auth hooks of a real sign-in and refuses one that wants a reserved claim", async () => {
    // Die ganze Kette der Auth-Hooks (2.77) an einem Stueck, gegen die echte
    // Datenbank: echte Anmeldung, echte Hook-Definition, echter Aufruf ueber
    // den vorhandenen Aufrufdienst, echtes Ergebnis im signierten Token.
    //
    // Echt ist alles, worauf es ankommt: das PostgreSQL-Repository von Project
    // Auth, der Audit-Sink in der Hash-Kette, der Argon2-Hasher, der
    // Ed25519-Signierer, die Function-Definitionen in der Control Plane, der
    // `FunctionInvocationService` samt Aufrufprotokoll und der Adapter
    // `ProjectAuthFunctionHooks`, der beide verbindet. Fest sind die Uhr, die
    // Zustellung und der Container: Eine Docker-Sandbox laesst sich hier nicht
    // starten, also steht an ihrer Stelle ein Aufrufer, der antwortet wie ein
    // Container. Genau dieselbe Grenze zieht der Fall (2.55).
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.52, 2.54, 2.55 und 2.56:
    // Jede Aenderung und jeder abgewiesene Aufruf schreiben eine Audit-Zeile,
    // und eine Organisation mit Audit-Zeilen laesst sich wegen
    // audit_logs_organization_id_fkey nicht mehr loeschen. Weggeraeumt wird
    // darum nur, was das Produkt selbst loescht: der App-Nutzer.
    const hookOwner = randomUUID();
    const hookOrganization = randomUUID();
    const hookProject = randomUUID();
    const scope = {
      organizationId: hookOrganization, projectId: hookProject, environment: "development" as const,
    };
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [hookOwner, `auth-hooks-owner-${hookOwner}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Auth Hooks', $2, $3)`, [hookOrganization, `auth-hooks-${hookOrganization}`, hookOwner]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Auth Hooks', $3, 'test', 'ready', $4)`,
    [hookProject, hookOrganization, `auth-hooks-${hookProject}`, hookOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [hookOrganization, hookProject, `managed:${hookProject}`]);

    // Die Functions, die die Hooks sind. Echte Zeilen in `project_functions`
    // durch den echten Definitionsdienst; der Aufrufdienst liest sie bei jedem
    // Aufruf frisch, so wie im Betrieb.
    const computeRepository = new PostgresComputeDefinitionRepository(new PostgresControlPlane(runtime));
    const definitions = new ComputeDefinitionService({ repository: computeRepository });
    const computeAdmin = {
      organizationId: hookOrganization, actorRef: `auth-hooks-owner-${hookOwner}@qkern.test`,
      role: "admin" as const, subject: hookOwner,
    };
    const image = `registry.example.com/qkern/hook@sha256:${"c".repeat(64)}`;
    const suffix = randomUUID().slice(0, 8);
    const names = {
      allow: `hook-allow-${suffix}`,
      deny: `hook-deny-${suffix}`,
      claims: `hook-claims-${suffix}`,
      reserved: `hook-reserved-${suffix}`,
      slow: `hook-slow-${suffix}`,
    };
    for (const name of Object.values(names)) {
      await definitions.createFunction(computeAdmin, scope, {
        name, image, entrypoint: "handler.mjs", secretRefs: [], enabled: true,
      });
    }

    // Der Container, und nur er ist gestellt. Jede Nutzlast wird mitgeschrieben,
    // damit der Fall pruefen kann, was ein Hook wirklich zu sehen bekommt.
    const seen: Array<{ name: string; payload: unknown }> = [];
    const tenant = `tenant-${randomUUID().slice(0, 8)}`;
    const invocations = new FunctionInvocationService({
      repository: computeRepository,
      invocationLog: computeRepository,
      invoker: {
        async invoke(definition, invocation) {
          seen.push({ name: definition.name, payload: invocation.payload });
          if (definition.name === names.allow) {
            return Object.freeze({ statusCode: 200, headers: {}, body: { decision: "allow" } });
          }
          if (definition.name === names.deny) {
            return Object.freeze({ statusCode: 200, headers: {}, body: { decision: "deny" } });
          }
          if (definition.name === names.claims) {
            return Object.freeze({ statusCode: 200, headers: {}, body: { claims: { tenant, tier: 3 } } });
          }
          if (definition.name === names.reserved) {
            // Der Hook, der zu viel will: `role` gibt QKERN selbst aus.
            return Object.freeze({ statusCode: 200, headers: {}, body: { claims: { role: "service_role" } } });
          }
          // Der Container, der zu lange braucht. Echter Zeitgeber, echte Frist.
          await new Promise((resolve) => setTimeout(resolve, 400));
          return Object.freeze({ statusCode: 200, headers: {}, body: { decision: "allow" } });
        },
      },
    });

    const { privateKey } = generateKeyPairSync("ed25519");
    const service = new ProjectAuthService({
      repository: new PostgresProjectAuthRepository(auth),
      audit: new PostgresProjectAuthAuditSink(auth),
      passwords: new Argon2idPasswordHasher({}),
      rateLimiter: new InMemoryRateLimiter(),
      tokens: new ProjectAuthTokenService({ kid: "certification-2-77", privateKey }, "https://qkern.test"),
      mfa: new ProjectAuthTotp(),
      secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 7)),
      delivery: new NoopDevelopmentProjectAuthDelivery(),
      oidcCatalog: new ProjectAuthOidcCatalog([]),
      oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
      hooks: new ProjectAuthFunctionHooks({ functions: invocations }),
      callbackBaseUrl: "https://qkern.test",
      allowedRedirectOrigins: new Set(["https://app.test"]),
      exposeDeliveryTokens: true,
    });

    // Ohne Zeile in project_auth_settings ruft nichts, und das ist etwas
    // anderes als "jemand hat nichts eingetragen".
    const untouched = await service.readAuthHooks(scope);
    expect(untouched).toMatchObject({
      hooks: {
        signIn: { functionName: null, timeoutMs: 2_000 },
        accessTokenClaims: { functionName: null, timeoutMs: 2_000, claims: [] },
      },
      failureMode: { sign_in: "deny", access_token_claims: "deny" },
      configured: false,
      updatedAt: null,
    });
    // Die reservierten Namen kommen aus dem Dienst und nicht aus der Ansicht.
    for (const reserved of ["sub", "iss", "aud", "exp", "iat", "role"]) {
      expect(untouched.reservedClaims).toContain(reserved);
    }

    const password = "a sufficiently long certification password";
    const email = `app-${randomUUID()}@example.test`;
    const signUp = await service.signUp(scope, {
      email, password, redirectTo: "https://app.test/willkommen", rateLimitKey: randomUUID(),
    });
    const verified = await service.consumeEmailToken(scope, {
      token: signUp.debugToken!, purpose: "email_verification",
    });
    if ("mfaRequired" in verified) throw new Error("unexpected MFA");
    // Ohne Hook stehen im Token nur die Ansprueche von QKERN.
    expect(claimsOf(verified.accessToken).tenant).toBeUndefined();
    const appUser = verified.user.id;

    // Die Definition, durch den echten Dienst in die echten Spalten.
    const stored = await service.setAuthHooks(scope, {
      signIn: { functionName: names.allow, timeoutMs: 1_500 },
      accessTokenClaims: { functionName: names.claims, timeoutMs: 1_500, claims: ["tenant", "tier"] },
    }, { id: hookOwner });
    expect(stored).toMatchObject({
      hooks: {
        signIn: { functionName: names.allow, timeoutMs: 1_500 },
        accessTokenClaims: { functionName: names.claims, timeoutMs: 1_500, claims: ["tenant", "tier"] },
      },
      configured: true,
    });
    const columns = await auth.query<{
      sign_in_hook_function: string;
      sign_in_hook_timeout_ms: number;
      access_token_hook_function: string;
      access_token_hook_claims: string[];
    }>(`SELECT sign_in_hook_function, sign_in_hook_timeout_ms,
          access_token_hook_function, access_token_hook_claims
        FROM project_auth_settings
        WHERE organization_id = $1 AND project_id = $2 AND environment = 'development'`,
    [hookOrganization, hookProject]);
    expect(columns.rows).toEqual([{
      sign_in_hook_function: names.allow,
      sign_in_hook_timeout_ms: 1_500,
      access_token_hook_function: names.claims,
      access_token_hook_claims: ["tenant", "tier"],
    }]);

    // Und jetzt der Satz, um den es geht: eine echte Anmeldung, zwei echte
    // Aufrufe, und die Ansprueche des Hooks stehen im signierten Token.
    const session = await service.passwordSignIn(scope, { email, password, rateLimitKey: randomUUID() });
    if ("mfaRequired" in session) throw new Error("unexpected MFA");
    const issued = claimsOf(session.accessToken);
    expect(issued.tenant).toBe(tenant);
    expect(issued.tier).toBe(3);
    // Die eigenen Ansprueche von QKERN stehen unveraendert daneben.
    expect(issued.sub).toBe(appUser);
    expect(issued.role).toBe("authenticated");
    expect(issued.aud).toBe(`qkern:${hookProject}:development`);
    // Das Token ist echt unterschrieben: derselbe Dienst nimmt es wieder an.
    const principal = await service.verifyAccess(scope, session.accessToken);
    expect(principal.user.id).toBe(appUser);

    // Was die Hooks gesehen haben, und vor allem, was nicht.
    const payloads = JSON.stringify(seen);
    expect(seen.map((entry) => entry.name)).toContain(names.allow);
    expect(seen.map((entry) => entry.name)).toContain(names.claims);
    expect(payloads).toContain(email);
    expect(payloads).not.toContain(password);
    expect(payloads).not.toContain(session.refreshToken);
    expect(payloads).not.toContain(session.accessToken);
    // Kein Feld fuer Herkunft oder Sitzung, auch kein leeres.
    for (const absent of ["ipAddress", "userAgent", "sessionId", "passwordHash", "user_metadata"]) {
      expect(payloads).not.toContain(absent);
    }
    const signInPayload = seen.find((entry) => entry.name === names.allow)?.payload as Record<string, unknown>;
    expect(signInPayload).toMatchObject({
      point: "sign_in", projectId: hookProject, environment: "development",
      userId: appUser, email, emailVerified: true, method: "password", assurance: "aal1",
    });
    const claimsPayload = seen.find((entry) => entry.name === names.claims)?.payload as Record<string, unknown>;
    expect(claimsPayload).toMatchObject({ point: "access_token_claims", reason: "sign_in" });

    // Der Punkt laeuft auch bei der Erneuerung. Ohne das verschwaenden die
    // Ansprueche nach einer Viertelstunde stillschweigend.
    const refreshed = await service.refresh(scope, session.refreshToken);
    expect(claimsOf(refreshed.accessToken).tenant).toBe(tenant);
    expect(seen.filter((entry) => entry.name === names.claims)).toHaveLength(2);
    expect(seen.filter((entry) => entry.name === names.allow)).toHaveLength(1);
    const onRefresh = seen.filter((entry) => entry.name === names.claims).at(-1)?.payload as Record<string, unknown>;
    expect(onRefresh.reason).toBe("refresh");

    // **Der Kern dieses Falls.** Ein Hook, der einen reservierten Anspruch
    // setzen will, wird abgewiesen, und zwar mit genau diesem Grund. Die
    // Unterscheidung traegt: Ohne die Pruefung auf reservierte Namen faenge die
    // Pruefung auf nicht erklaerte Namen den Fall auch auf, nur mit einer
    // harmlos aussehenden Begruendung. Der Fall prueft darum den Grund und
    // nicht bloss das Scheitern.
    await service.setAuthHooks(scope, {
      signIn: { functionName: null, timeoutMs: 2_000 },
      accessTokenClaims: { functionName: names.reserved, timeoutMs: 1_500, claims: ["tenant", "tier"] },
    }, { id: hookOwner });
    const sessionsBefore = await sessionCount();
    await expect(service.passwordSignIn(scope, { email, password, rateLimitKey: randomUUID() }))
      .rejects.toMatchObject({ code: "HOOK_REJECTED" });
    // Kein Token, und auch keine Sitzung: Ein Token, das anders aussieht als
    // bestellt, soll nicht entstehen, und eine Sitzung ohne Token ist ein Rest.
    expect(await sessionCount()).toBe(sessionsBefore);

    // Der Hook, der die Anmeldung abweist. Dieselbe Wirkung fuer den Nutzer,
    // ein anderer Grund fuer den Betreiber.
    await service.setAuthHooks(scope, {
      signIn: { functionName: names.deny, timeoutMs: 1_500 },
      accessTokenClaims: { functionName: null, timeoutMs: 2_000, claims: [] },
    }, { id: hookOwner });
    await expect(service.passwordSignIn(scope, { email, password, rateLimitKey: randomUUID() }))
      .rejects.toMatchObject({ code: "HOOK_DENIED" });
    expect(await sessionCount()).toBe(sessionsBefore);

    // Der Hook, der nicht rechtzeitig antwortet. Echte Frist, echter
    // Zeitgeber, echter Container, der 400 Millisekunden braucht.
    await service.setAuthHooks(scope, {
      signIn: { functionName: names.slow, timeoutMs: 100 },
      accessTokenClaims: { functionName: null, timeoutMs: 2_000, claims: [] },
    }, { id: hookOwner });
    await expect(service.passwordSignIn(scope, { email, password, rateLimitKey: randomUUID() }))
      .rejects.toMatchObject({ code: "HOOK_UNAVAILABLE" });
    expect(await sessionCount()).toBe(sessionsBefore);

    // Kein Hook mehr: Dieselbe Anmeldung kommt wieder durch, und im Token
    // stehen nur die Ansprueche von QKERN.
    await service.setAuthHooks(scope, {
      signIn: { functionName: null, timeoutMs: 2_000 },
      accessTokenClaims: { functionName: null, timeoutMs: 2_000, claims: [] },
    }, { id: hookOwner });
    const plain = await service.passwordSignIn(scope, { email, password, rateLimitKey: randomUUID() });
    if ("mfaRequired" in plain) throw new Error("unexpected MFA");
    expect(claimsOf(plain.accessToken).tenant).toBeUndefined();
    expect(await sessionCount()).toBe(sessionsBefore + 1);

    // Ein reservierter Name kommt nicht einmal in die Definition, und die
    // Route erfaehrt den Grund.
    await expect(service.setAuthHooks(scope, {
      signIn: { functionName: null, timeoutMs: 2_000 },
      accessTokenClaims: { functionName: names.claims, timeoutMs: 1_500, claims: ["role"] },
    }, { id: hookOwner })).rejects.toMatchObject({ reason: "claim_reserved", field: "accessTokenClaims" });
    // Eine Function ohne erklaerte Ansprueche waere ein Hook, dessen Antwort
    // ganz verworfen wuerde.
    await expect(service.setAuthHooks(scope, {
      signIn: { functionName: null, timeoutMs: 2_000 },
      accessTokenClaims: { functionName: names.claims, timeoutMs: 1_500, claims: [] },
    }, { id: hookOwner })).rejects.toMatchObject({ reason: "claims_required" });

    // Die Datenbank haelt die Raender selbst, nicht nur der Dienst. Alle drei
    // Pruefungen aus 0058, an echten Zeilen.
    const where = `WHERE organization_id = '${hookOrganization}' AND project_id = '${hookProject}'
      AND environment = 'development'`;
    await expect(auth.query(
      `UPDATE project_auth_settings SET access_token_hook_function = $1, access_token_hook_claims = ARRAY['role']::text[] ${where}`,
      [names.claims],
    )).rejects.toBeInstanceOf(Error);
    await expect(auth.query(`UPDATE project_auth_settings SET sign_in_hook_timeout_ms = 0 ${where}`))
      .rejects.toBeInstanceOf(Error);
    await expect(auth.query(`UPDATE project_auth_settings SET sign_in_hook_function = 'Nope!' ${where}`))
      .rejects.toBeInstanceOf(Error);
    await expect(auth.query(
      `UPDATE project_auth_settings SET access_token_hook_function = NULL, access_token_hook_claims = ARRAY['tenant']::text[] ${where}`,
    )).rejects.toBeInstanceOf(Error);

    // Gerufen wurde ueber den vorhandenen Aufrufdienst, und das steht im
    // Aufrufprotokoll: der Aktor sagt, dass der Aufruf von der Anmeldung kam
    // und von welchem Punkt. Die Nutzlast steht dort nicht.
    const log = await definitions.readFunctionInvocationLog(computeAdmin, scope, { limit: 50, offset: 0 });
    const actors = [...new Set(log.rows.map((row) => row.invokedBy))];
    expect(actors).toContain("project_auth_hook:sign_in");
    expect(actors).toContain("project_auth_hook:access_token_claims");
    expect(JSON.stringify(log)).not.toContain(email);
    expect(JSON.stringify(log)).not.toContain(tenant);

    // Jede Aenderung und jeder abgewiesene Aufruf stehen in der Hash-Kette,
    // ohne Adresse und ohne Anspruchswert.
    const page = await service.listAuditEvents(scope, 100);
    const changed = page.events.filter((event) => event.action === "project_auth.hooks.changed");
    expect(changed.length).toBeGreaterThanOrEqual(5);
    expect(changed.some((event) => event.actorType === "admin" && event.actorRef === hookOwner &&
      // Ein Punkt und kein Komma: Die Bereinigung der Kette laesst ein Komma
      // in einem Metadatenwert nicht durch und wuerfe den ganzen Wert still
      // weg. Dieser Fall hat das gefunden.
      event.metadata.claimsAllowed === "tenant.tier")).toBe(true);
    const refused = page.events.filter((event) => event.action === "project_auth.hook.refused");
    // Der Beleg, auf den die Mutationsprobe zeigt: der Grund heisst
    // `claim_reserved` und nicht `claim_not_declared`.
    const reservedRefusal = refused.find((event) => event.metadata.reason === "claim_reserved");
    expect(reservedRefusal).toBeDefined();
    expect(reservedRefusal).toMatchObject({
      status: "failed",
      metadata: { point: "access_token_claims", function: names.reserved, claim: "role" },
    });
    expect(refused.some((event) => event.metadata.reason === "denied" &&
      event.metadata.point === "sign_in")).toBe(true);
    expect(refused.some((event) => event.metadata.reason === "no_answer")).toBe(true);
    const serialised = JSON.stringify(refused);
    expect(serialised).not.toContain("@");
    expect(serialised).not.toContain("example.test");
    expect(serialised).not.toContain(tenant);
    expect(serialised).not.toContain("service_role");

    async function sessionCount(): Promise<number> {
      const result = await auth.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM project_auth_sessions
         WHERE organization_id = $1 AND project_id = $2 AND environment = 'development'`,
        [hookOrganization, hookProject],
      );
      return Number(result.rows[0]?.n);
    }

    // Aufgeraeumt wird nur, was das Produkt loescht: der App-Nutzer samt seinen
    // Sitzungen und Token. Die Function-Definitionen, die Einstellungen und die
    // Audit-Zeilen bleiben stehen; audit_logs ist append-only, und der
    // Wegwerf-Stack faellt nach dem Lauf ohnehin weg.
    await owner.query(`DELETE FROM project_auth_users
      WHERE organization_id = $1 AND project_id = $2`, [hookOrganization, hookProject]);
  }, 120_000);
  it("(2.79) registers a real passkey, signs in with a real signature and refuses replay, wrong origin and a counter that runs backwards", async () => {
    // Die ganze Kette der Anmeldung mit WebAuthn (2.79) an einem Stueck, gegen
    // die echte Datenbank.
    //
    // Echt ist hier alles, was zaehlt: ein echtes Schluesselpaar aus
    // `node:crypto`, ein echtes Attestation-Objekt in CBOR, echte
    // `clientDataJSON`, eine echte ECDSA-Unterschrift ueber
    // `authenticatorData || sha256(clientDataJSON)`, das PostgreSQL-Repository
    // von Project Auth, der Audit-Sink in der Hash-Kette, der Argon2-Hasher und
    // der Ed25519-Signierer der Access Token. Gestellt ist genau das, was in
    // einem Test nicht laufen kann: der Browser und der Authenticator. Beides
    // wird hier nachgebaut, und zwar mit demselben privaten Schluessel, den ein
    // echter Authenticator nie hergeben wuerde.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.52, 2.56 und 2.77: Jede
    // Anmeldung und jede Ablehnung schreiben eine Audit-Zeile, und eine
    // Organisation mit Audit-Zeilen laesst sich wegen
    // audit_logs_organization_id_fkey nicht mehr loeschen. Weggeraeumt wird
    // darum nur, was das Produkt selbst loescht: der App-Nutzer.
    const passkeyOwner = randomUUID();
    const passkeyOrganization = randomUUID();
    const passkeyProject = randomUUID();
    const scope = {
      organizationId: passkeyOrganization, projectId: passkeyProject,
      environment: "development" as const,
    };
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [passkeyOwner, `passkeys-owner-${passkeyOwner}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Passkeys', $2, $3)`, [passkeyOrganization, `passkeys-${passkeyOrganization}`, passkeyOwner]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Passkeys', $3, 'test', 'ready', $4)`,
    [passkeyProject, passkeyOrganization, `passkeys-${passkeyProject}`, passkeyOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [passkeyOrganization, passkeyProject, `managed:${passkeyProject}`]);

    const { privateKey: signingKey } = generateKeyPairSync("ed25519");
    const service = new ProjectAuthService({
      repository: new PostgresProjectAuthRepository(auth),
      audit: new PostgresProjectAuthAuditSink(auth),
      passwords: new Argon2idPasswordHasher({}),
      rateLimiter: new InMemoryRateLimiter(),
      tokens: new ProjectAuthTokenService({ kid: "certification-2-79", privateKey: signingKey }, "https://qkern.test"),
      mfa: new ProjectAuthTotp(),
      secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 9)),
      delivery: new NoopDevelopmentProjectAuthDelivery(),
      oidcCatalog: new ProjectAuthOidcCatalog([]),
      oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
      callbackBaseUrl: "https://qkern.test",
      // Die erlaubte Herkunft dieser Umgebung, und damit `app.test` als rpId.
      allowedRedirectOrigins: new Set(["https://app.test"]),
      exposeDeliveryTokens: true,
    });

    // Die Grenze je Zeitfenster wird hochgesetzt, und zwar durch das Produkt
    // selbst. Der Fall probiert einen Schluessel absichtlich mehrfach, und die
    // Vorgabe von zehn Versuchen je Viertelstunde waere sonst das, was ihn
    // beendet — nicht eine Pruefung, sondern ein Zaehler.
    await service.setRateLimits(scope, {
      sign_in: { max: 100, windowSeconds: 900 },
      mail: { max: 100, windowSeconds: 3_600 },
      refresh: { max: 100, windowSeconds: 3_600 },
    }, { id: passkeyOwner });

    const password = "a sufficiently long certification password";
    const email = `passkey-${randomUUID()}@example.test`;
    const signUp = await service.signUp(scope, {
      email, password, redirectTo: "https://app.test/willkommen", rateLimitKey: randomUUID(),
    });
    const verified = await service.consumeEmailToken(scope, {
      token: signUp.debugToken!, purpose: "email_verification",
    });
    if ("mfaRequired" in verified) throw new Error("unexpected MFA");
    const appUser = verified.user.id;
    // Der Nutzer kommt aus einem echten Access Token durch `verifyAccess`, so
    // wie die Route ihn holt, und nicht aus einem selbst gebauten Objekt.
    const principal = await service.verifyAccess(scope, verified.accessToken);

    // --- Der Authenticator ------------------------------------------------
    // Ein echtes P-256-Paar. Der oeffentliche Teil wandert als COSE-Schluessel
    // in das Attestation-Objekt; der private bleibt hier und unterschreibt.
    const keyPair = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = keyPair.publicKey.export({ format: "jwk" }) as { x: string; y: string };
    const coseKey = certificationCoseKey(
      Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url"),
    );
    const credentialId = randomBytes(32);
    const rpIdHash = createHash("sha256").update("app.test", "utf8").digest();

    // --- Zusage 1: eine echte Registrierung -------------------------------
    const registration = await service.beginPasskeyRegistration(principal);
    expect(registration.challengeToken).toMatch(/^qk_pkey_[A-Za-z0-9_-]{43}$/);
    // Der Schein und die Herausforderung tragen denselben Zufall. Das ist keine
    // Bequemlichkeit, sondern die Bindung: Der Browser unterschreibt den Wert,
    // den der Server in der Datenbank einloest.
    expect(registration.challenge).toBe(registration.challengeToken.slice("qk_pkey_".length));
    expect(registration.existingCredentialIds).toEqual([]);
    expect(registration.relyingParties).toEqual([{ origin: "https://app.test", rpId: "app.test" }]);
    expect(registration.algorithms).toEqual([{ type: "public-key", alg: -7 }]);

    const stored = await service.completePasskeyRegistration(principal, {
      challengeToken: registration.challengeToken,
      attestationObject: certificationAttestationObject({
        rpIdHash, signCount: 7, credentialId, coseKey,
      }).toString("base64url"),
      clientDataJSON: certificationClientData({
        type: "webauthn.create", challenge: registration.challenge, origin: "https://app.test",
      }).toString("base64url"),
      label: "Telefon der Zertifizierung",
    });
    expect(stored).toMatchObject({
      credentialId: credentialId.toString("base64url"),
      algorithm: -7, signCount: 7, userVerified: true, attestationFormat: "none",
      label: "Telefon der Zertifizierung", lastUsedAt: null,
    });

    // Was wirklich in der Datenbank steht, mit der Laufzeitrolle gelesen. Der
    // Punkt dieser Abfrage ist, was **nicht** darin steht: nichts Geheimes.
    const row = await auth.query<{
      credential_id: string; public_key: string; algorithm: number;
      sign_count: string; attestation_format: string;
    }>(`SELECT credential_id, public_key, algorithm, sign_count::text AS sign_count, attestation_format
        FROM project_auth_passkeys
        WHERE organization_id = $1 AND project_id = $2 AND environment = 'development'`,
    [passkeyOrganization, passkeyProject]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].algorithm).toBe(-7);
    expect(row.rows[0].sign_count).toBe("7");
    expect(row.rows[0].attestation_format).toBe("none");
    // Der abgelegte Schluessel ist genau der oeffentliche Teil des Paares, in
    // SPKI-DER. Nachgerechnet und nicht geglaubt.
    expect(row.rows[0].public_key).toBe(
      keyPair.publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
    );
    // Und der private Teil steht nirgends in dieser Zeile. Geprueft wird gegen
    // `d` aus dem privaten JWK, also gegen den Wert, der wirklich geheim ist,
    // und gegen den Anfang des PKCS8-Textes.
    //
    // Gegen `x` wird hier ausdruecklich **nicht** geprueft: Ein SPKI-DER traegt
    // die Koordinaten im Klartext, und sein Praefix ist 27 Byte lang, also ein
    // Vielfaches von drei. Damit steht base64url(x) je nach erstem Byte von `y`
    // woertlich im abgelegten Schluessel. Das ist kein Leck, sondern die Form
    // eines oeffentlichen Schluessels; eine Behauptung, die in einem von vier
    // Laeufen faellt, sagt darueber nichts.
    const privateJwk = keyPair.privateKey.export({ format: "jwk" }) as { d: string };
    const privatePem = keyPair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const serialisedRow = JSON.stringify(row.rows[0]);
    expect(serialisedRow).not.toContain(privatePem.split("\n")[1]);
    expect(serialisedRow).not.toContain(privateJwk.d);

    // Die Zeile traegt kein DELETE-Verbot, aber sie traegt eines auf dem
    // Schluessel: Ein Passkey, dessen oeffentlicher Teil sich aendern laesst,
    // ist kein Passkey. Die Laufzeitrolle hat auf dieser Spalte kein UPDATE.
    await expect(auth.query(
      `UPDATE project_auth_passkeys SET public_key = $1
        WHERE organization_id = $2 AND project_id = $3`,
      ["A".repeat(120), passkeyOrganization, passkeyProject])).rejects.toBeDefined();

    // --- Zusage 2: eine echte Anmeldung mit echter Unterschrift -----------
    const firstChallenge = await service.beginPasskeySignIn(scope, { rateLimitKey: randomUUID() });
    const firstAssertion = certificationAssertion({
      privateKey: keyPair.privateKey, rpIdHash, signCount: 8,
      challenge: firstChallenge.challenge, origin: "https://app.test",
    });
    const session = await service.completePasskeySignIn(scope, {
      challengeToken: firstChallenge.challengeToken,
      credentialId: credentialId.toString("base64url"),
      ...firstAssertion, rateLimitKey: randomUUID(),
    });
    if ("mfaRequired" in session) throw new Error("unexpected MFA");
    expect(session.tokenType).toBe("Bearer");
    expect(session.user.id).toBe(appUser);
    // Das Token ist echt: derselbe Dienst nimmt es an, und die Sitzung steht in
    // der Datenbank.
    const usable = await service.verifyAccess(scope, session.accessToken);
    expect(usable.user.id).toBe(appUser);
    expect(usable.session.assurance).toBe("aal1");
    expect(claimsOf(session.accessToken).aal).toBe("aal1");

    // Der Zaehler ist mitgewandert, und zwar in der Datenbank.
    const advanced = await auth.query<{ sign_count: string; last_used_at: string | null }>(
      `SELECT sign_count::text AS sign_count, last_used_at FROM project_auth_passkeys
        WHERE organization_id = $1 AND project_id = $2`, [passkeyOrganization, passkeyProject]);
    expect(advanced.rows[0].sign_count).toBe("8");
    expect(advanced.rows[0].last_used_at).not.toBeNull();

    // --- Zusage 3: eine wiederverwendete Herausforderung ------------------
    // Dieselbe Herausforderung, eine neue, gueltige Unterschrift darueber. Wer
    // eine Antwort mitgeschnitten hat, soll sie nicht noch einmal einspielen
    // koennen; wer den privaten Schluessel haette, braeuchte sie nicht.
    const replay = certificationAssertion({
      privateKey: keyPair.privateKey, rpIdHash, signCount: 9,
      challenge: firstChallenge.challenge, origin: "https://app.test",
    });
    await expect(service.completePasskeySignIn(scope, {
      challengeToken: firstChallenge.challengeToken,
      credentialId: credentialId.toString("base64url"),
      ...replay, rateLimitKey: randomUUID(),
    })).rejects.toMatchObject({ code: "INVALID_PASSKEY" });
    // Und der Zaehler ist dabei nicht gewandert: Eine abgewiesene Anmeldung
    // hinterlaesst nichts.
    const afterReplay = await auth.query<{ sign_count: string }>(
      `SELECT sign_count::text AS sign_count FROM project_auth_passkeys
        WHERE organization_id = $1 AND project_id = $2`, [passkeyOrganization, passkeyProject]);
    expect(afterReplay.rows[0].sign_count).toBe("8");

    // --- Zusage 4: ein falsches origin -----------------------------------
    // Eine gueltige Unterschrift ueber Daten einer fremden Seite. Genau so
    // sieht ein Phishing-Versuch aus, und genau darum ist ein falsches `origin`
    // ein Angriff und kein Tippfehler.
    const foreign = await service.beginPasskeySignIn(scope, { rateLimitKey: randomUUID() });
    const foreignAssertion = certificationAssertion({
      privateKey: keyPair.privateKey, rpIdHash, signCount: 9,
      challenge: foreign.challenge, origin: "https://angreifer.test",
    });
    await expect(service.completePasskeySignIn(scope, {
      challengeToken: foreign.challengeToken,
      credentialId: credentialId.toString("base64url"),
      ...foreignAssertion, rateLimitKey: randomUUID(),
    })).rejects.toMatchObject({ code: "INVALID_PASSKEY" });

    // --- Zusage 5: ein rueckwaerts laufender Zaehler ----------------------
    // Der Stand steht auf 8. Eine Antwort mit 8 ist keine neue Benutzung,
    // sondern eine zweite Kopie desselben Schluessels.
    const cloned = await service.beginPasskeySignIn(scope, { rateLimitKey: randomUUID() });
    const clonedAssertion = certificationAssertion({
      privateKey: keyPair.privateKey, rpIdHash, signCount: 8,
      challenge: cloned.challenge, origin: "https://app.test",
    });
    await expect(service.completePasskeySignIn(scope, {
      challengeToken: cloned.challengeToken,
      credentialId: credentialId.toString("base64url"),
      ...clonedAssertion, rateLimitKey: randomUUID(),
    })).rejects.toMatchObject({ code: "INVALID_PASSKEY" });

    // --- Zusage 6: eine Unterschrift von einem fremden Schluessel ---------
    const impostor = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const forged = await service.beginPasskeySignIn(scope, { rateLimitKey: randomUUID() });
    const forgedAssertion = certificationAssertion({
      privateKey: impostor.privateKey, rpIdHash, signCount: 20,
      challenge: forged.challenge, origin: "https://app.test",
    });
    await expect(service.completePasskeySignIn(scope, {
      challengeToken: forged.challengeToken,
      credentialId: credentialId.toString("base64url"),
      ...forgedAssertion, rateLimitKey: randomUUID(),
    })).rejects.toMatchObject({ code: "INVALID_PASSKEY" });

    // --- Zusage 7: derselbe Weg zur Sitzung wie beim Passwort -------------
    // Verlangt die Umgebung den zweiten Faktor, ergibt auch eine gueltige
    // Anmeldung mit Passkey keine Sitzung, sondern einen Einrichtungsschein.
    // Das ist der Beleg, dass die Anmeldung mit Passkey durch dieselbe Stelle
    // laeuft wie die mit Passwort; laeufe sie daneben, waere sie ein Loch im
    // Schalter aus 2.52.
    await service.setMfaRequired(scope, true, { id: passkeyOwner });
    const enforced = await service.beginPasskeySignIn(scope, { rateLimitKey: randomUUID() });
    const enforcedAssertion = certificationAssertion({
      privateKey: keyPair.privateKey, rpIdHash, signCount: 21,
      challenge: enforced.challenge, origin: "https://app.test",
    });
    const gated = await service.completePasskeySignIn(scope, {
      challengeToken: enforced.challengeToken,
      credentialId: credentialId.toString("base64url"),
      ...enforcedAssertion, rateLimitKey: randomUUID(),
    });
    expect(gated).toMatchObject({ mfaRequired: true, enrollmentRequired: true });
    await service.setMfaRequired(scope, false, { id: passkeyOwner });

    // --- Zusage 8: auflisten und entfernen --------------------------------
    const list = await service.listPasskeys(principal);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ label: "Telefon der Zertifizierung", signCount: 21 });
    // Kein oeffentlicher Schluessel in der Liste, und zwar nicht nur als
    // fehlendes Feld: Der Wert steht nirgends darin.
    expect(JSON.stringify(list)).not.toContain(row.rows[0].public_key);
    // Ein fremder Passkey wird nicht getroffen.
    await expect(service.removePasskey(principal, randomUUID()))
      .rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    await expect(service.removePasskey(principal, list[0].id)).resolves.toEqual({ removed: true });
    const emptied = await auth.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM project_auth_passkeys
        WHERE organization_id = $1 AND project_id = $2`, [passkeyOrganization, passkeyProject]);
    // Entfernt heisst weg und nicht markiert.
    expect(emptied.rows[0].n).toBe("0");
    expect(await service.listPasskeys(principal)).toEqual([]);
    // Und ein Schluessel, den es nicht mehr gibt, meldet niemanden mehr an.
    const gone = await service.beginPasskeySignIn(scope, { rateLimitKey: randomUUID() });
    await expect(service.completePasskeySignIn(scope, {
      challengeToken: gone.challengeToken,
      credentialId: credentialId.toString("base64url"),
      ...certificationAssertion({
        privateKey: keyPair.privateKey, rpIdHash, signCount: 30,
        challenge: gone.challenge, origin: "https://app.test",
      }),
      rateLimitKey: randomUUID(),
    })).rejects.toMatchObject({ code: "INVALID_PASSKEY" });

    // --- Zusage 9: die Uebersicht der Console -----------------------------
    const policy = await service.readPasskeyPolicy(scope);
    expect(policy).toMatchObject({
      users: 1, passkeys: 0, usersWithPasskey: 0, usersWithoutPasskey: 1,
      relyingParties: [{ origin: "https://app.test", rpId: "app.test" }],
    });

    // --- Zusage 10: die Spur nennt den Grund und nichts sonst -------------
    const page = await service.listAuditEvents(scope, 100);
    const actions = page.events.map((event) => event.action);
    expect(actions).toContain("project_auth.passkey.registered");
    expect(actions).toContain("project_auth.passkey.verified");
    expect(actions).toContain("project_auth.passkey.removed");
    const refused = page.events.filter((event) => event.action === "project_auth.passkey.refused");
    const reasons = refused.map((event) => event.metadata.reason);
    // Genau die vier Ablehnungen, um die es in diesem Fall geht.
    expect(reasons).toContain("challenge_spent");
    expect(reasons).toContain("origin_not_allowed");
    expect(reasons).toContain("sign_count_regressed");
    expect(reasons).toContain("signature_invalid");
    expect(reasons).toContain("credential_unknown");
    // Eine erfolgreiche Anmeldung mit Passkey ist auch eine Anmeldung: Ein
    // Filter auf Anmeldungen muss sie finden.
    expect(page.events.some((event) => event.action === "project_auth.login.succeeded" &&
      event.metadata.method === "passkey")).toBe(true);
    // Und in der Kette steht kein Kennzeichen des Geraets und keine Adresse.
    const serialisedTrail = JSON.stringify(page.events);
    expect(serialisedTrail).not.toContain(credentialId.toString("base64url"));
    expect(serialisedTrail).not.toContain(row.rows[0].public_key);
    expect(serialisedTrail).not.toContain(email);
    expect(serialisedTrail).not.toContain("angreifer.test");

    // Aufgeraeumt wird nur, was das Produkt loescht: der App-Nutzer samt seinen
    // Sitzungen und Token. Die Einstellungen und die Audit-Zeilen bleiben
    // stehen; audit_logs ist append-only, und der Wegwerf-Stack faellt nach dem
    // Lauf ohnehin weg.
    await owner.query(`DELETE FROM project_auth_users
      WHERE organization_id = $1 AND project_id = $2`, [passkeyOrganization, passkeyProject]);
  }, 120_000);
  it("(2.81) counts change sets, approvals and apply jobs per fixed environment under RLS", async () => {
    // Branches (2.81) gegen die echte Datenbank. Die Seite behauptet dreierlei,
    // und keine dieser Zusagen liesse sich gegen einen Nachbau pruefen:
    //
    // 1. Die Zahlen je Umgebung sind die Zahlen der Kontrollebene. Sie
    //    entstehen aus echten Change Sets in mehreren Zustaenden und mehreren
    //    Umgebungen, angelegt und entschieden ueber denselben Dienst, den die
    //    Console ruft, und danach gegen `change_sets`, `approval_requests` und
    //    `migration_jobs` nachgezaehlt. Gegen einen Fake waere das die Pruefung
    //    des Fakes.
    // 2. Die Menge der Umgebungen ist fest. Die Antwort traegt immer alle drei,
    //    auch fuer ein Projekt, das nur eine Zeile in `project_environments`
    //    hat. Genau das ist die Aussage der Seite: Es gibt keine frei benannten
    //    Zweige, also kann diese Liste nicht wachsen.
    // 3. Gelesen wird ueber die Laufzeitrolle, also unter RLS. Der Nachbar
    //    bekommt dasselbe Projekt nicht zu sehen und auch keine leere Antwort
    //    mit drei Nullreihen; eine leere Antwort waere die Behauptung, es liege
    //    nichts vor.
    //
    // Geschrieben wird ebenfalls ueber die Laufzeitrolle: Anlegen, Freigeben
    // und Einreihen laufen durch den echten Dienst, das echte Repository und
    // dieselben Policies. Nur der letzte Schritt, das Anwenden, steht hier als
    // Aktualisierung des Auftrags statt als Worker-Lauf: Der Worker mit echtem
    // Executor, echter Zieldatenbank und echtem Ledger ist der Fall (2.49), und
    // dieser Fall prueft die Zaehlung, nicht das Anwenden.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.49 und 2.68: Das Anlegen
    // eines Change Sets schreibt Audit-Zeilen, und eine Organisation mit
    // Audit-Zeilen laesst sich wegen audit_logs_organization_id_fkey nicht mehr
    // loeschen. Das gemeinsame afterAll muss organizationA und organizationB
    // loswerden; diese Organisation bleibt als erwarteter Rest im
    // Wegwerf-Stack.
    const flowOwner = randomUUID();
    const flowOrganization = randomUUID();
    const flowProject = randomUUID();
    const bareProject = randomUUID();
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [flowOwner, `branches-2-81-owner-${flowOwner}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Branches 2.81', $2, $3)`,
    [flowOrganization, `branches-2-81-${flowOrganization}`, flowOwner]);
    await owner.query(`INSERT INTO organization_members (organization_id, user_id, role, is_personal_workspace)
      VALUES ($1, $2, 'owner', true)`, [flowOrganization, flowOwner]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Branches 2.81', $3, 'test', 'ready', $4),
             ($5, $2, 'Branches 2.81 bare', $6, 'test', 'provisioning', $4)`,
    [flowProject, flowOrganization, `branches-2-81-${flowProject}`, flowOwner,
      bareProject, `branches-2-81-bare-${bareProject}`]);
    // Zwei gebundene Umgebungen und eine wartende: Nur so kann der Fall zeigen,
    // dass die Seite Zahlen je Umgebung trennt und dass eine wartende Umgebung
    // mit lauter Nullen keine fehlende Umgebung ist.
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3), ($1, $2, 'staging', $4), ($1, $2, 'production', $5)`,
    [flowOrganization, flowProject, `managed:${flowProject}-dev`, `managed:${flowProject}-stg`,
      `pending:${flowProject}-prd`]);
    // Das zweite Projekt hat genau eine Umgebung. Die Antwort muss trotzdem
    // drei tragen.
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`,
    [flowOrganization, bareProject, `managed:${bareProject}-dev`]);

    const cipher = new AesGcmStatementCipher(Buffer.from("0".repeat(64), "hex"));
    // Schreiben und Lesen durch dieselbe Laufzeitrolle: keine Abkuerzung ueber
    // den Eigentuemer, der RLS ohnehin nicht spuert.
    const control = new PostgresControlPlane(runtime);
    const service = new PostgresControlPlaneService(control, cipher);
    const context = {
      organizationId: flowOrganization,
      actor: { id: flowOwner, ref: `branches-2-81-owner-${flowOwner}@qkern.test`, type: "user" as const },
    };
    const table = `branchflow_${randomUUID().replaceAll("-", "_")}`;

    /** Ein Change Set ueber den echten Dienst, mit seiner Freigabe. */
    const submit = async (environment: "development" | "staging", suffix: string) => {
      const change = await service.createChangeSet(context, {
        projectId: flowProject,
        environment,
        title: `Branches 2.81 ${suffix}`,
        statement: `ALTER TABLE "public"."${table}" ADD COLUMN "${suffix}" text`,
      });
      expect(change.status, suffix).toBe("ready");
      const approvals = await owner.query<{ id: string }>(
        "SELECT id FROM approval_requests WHERE change_set_id = $1", [change.id]);
      // Eine Schemaaenderung braucht eine Freigabe; ohne sie pruefte dieser
      // Fall die Freigabezahlen gar nicht.
      expect(approvals.rows, suffix).toHaveLength(1);
      return { changeSetId: change.id, approvalId: approvals.rows[0].id };
    };

    // Development: eine angewandte, eine abgelehnte, eine wartende Aenderung.
    const appliedChange = await submit("development", "angewandt");
    const rejectedChange = await submit("development", "abgelehnt");
    await submit("development", "wartet");
    // Staging: eine freigegebene Aenderung, die in der Warteschlange steht.
    const queuedChange = await submit("staging", "eingereiht");

    const approved = await service.decideApproval(context, { approvalId: appliedChange.approvalId, decision: "approved" });
    expect(approved.status).toBe("approved");
    const refused = await service.decideApproval(context, { approvalId: rejectedChange.approvalId, decision: "rejected" });
    expect(refused.status).toBe("rejected");
    await service.decideApproval(context, { approvalId: queuedChange.approvalId, decision: "approved" });

    // Einreihen ueber den echten Apply-Dienst: Er rechnet den Aktionshash der
    // Freigabe noch einmal nach, also kommt hier kein erfundener Auftrag durch.
    const apply = new PostgresChangeSetApplyService(control);
    const appliedJob = await apply.queueApprovedChangeSet(context, { changeSetId: appliedChange.changeSetId });
    expect(appliedJob.outcome).toBe("queued");
    const queuedJob = await apply.queueApprovedChangeSet(context, { changeSetId: queuedChange.changeSetId });
    expect(queuedJob.outcome).toBe("queued");

    // Der Schritt, den im Betrieb der Worker tut, und nur dieser: Auftrag und
    // Change Set auf "angewandt". Der Worker selbst ist in (2.49) zertifiziert.
    const finished = await owner.query<{ finished_at: string }>(
      `UPDATE migration_jobs SET status = 'applied', finished_at = now(), updated_at = now()
       WHERE organization_id = $1 AND change_set_id = $2
       RETURNING to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS finished_at`,
      [flowOrganization, appliedChange.changeSetId]);
    expect(finished.rows, "der Auftrag der angewandten Aenderung fehlt").toHaveLength(1);
    await owner.query(
      "UPDATE change_sets SET status = 'applied', updated_at = now() WHERE organization_id = $1 AND id = $2",
      [flowOrganization, appliedChange.changeSetId]);

    // --- Zusage 1 und 3: die Zahlen, durch die Kontrollebene unter RLS ---
    const flow = await service.summariseChangeFlow(context, flowProject);
    expect(flow.projectId).toBe(flowProject);
    expect(Object.keys(flow).sort()).toEqual(["environments", "projectId"]);
    expect(flow.environments.map((entry) => entry.environment))
      .toEqual(["development", "staging", "production"]);
    for (const entry of flow.environments) {
      expect(Object.keys(entry).sort(), entry.environment)
        .toEqual(["approvals", "bound", "changeSets", "environment", "migrations", "present"]);
      // Die Antwort traegt nirgends eine Datenbankreferenz; die Seite zeigt
      // keine und koennte auch keine zeigen.
      expect(JSON.stringify(entry), entry.environment).not.toContain("managed:");
      expect(JSON.stringify(entry), entry.environment).not.toContain("pending:");
    }

    const development = flow.environments.find((entry) => entry.environment === "development")!;
    const staging = flow.environments.find((entry) => entry.environment === "staging")!;
    const production = flow.environments.find((entry) => entry.environment === "production")!;

    expect(development.present).toBe(true);
    expect(development.bound).toBe(true);
    expect(development.changeSets.total).toBe(3);
    expect(development.changeSets.byStatus).toEqual({
      draft: 0, validating: 0, ready: 1, approved: 0, applied: 1, rejected: 1, failed: 0, rolled_back: 0,
    });
    expect(development.approvals.total).toBe(3);
    expect(development.approvals.byStatus).toEqual({ pending: 1, approved: 1, rejected: 1, expired: 0 });
    expect(development.migrations).not.toBeNull();
    expect(development.migrations!.total).toBe(1);
    expect(development.migrations!.byStatus).toEqual({
      queued: 0, running: 0, applied: 1, failed: 0, review_required: 0,
    });
    // Der Zeitpunkt der Ankunft ist der, den die Datenbank geschrieben hat,
    // nicht der, den der Fall gerade fuer plausibel haelt.
    expect(development.migrations!.lastFinishedAt).toBe(finished.rows[0].finished_at);

    expect(staging.present).toBe(true);
    expect(staging.bound).toBe(true);
    expect(staging.changeSets.total).toBe(1);
    expect(staging.changeSets.byStatus.approved).toBe(1);
    expect(staging.approvals.byStatus).toEqual({ pending: 0, approved: 1, rejected: 0, expired: 0 });
    expect(staging.migrations!.byStatus).toEqual({
      queued: 1, running: 0, applied: 0, failed: 0, review_required: 0,
    });
    // Eingereiht heisst nicht angekommen, und die Zahl darf das nicht
    // verwischen: In Staging ist noch nichts angekommen.
    expect(staging.migrations!.lastFinishedAt).toBeNull();

    // Die wartende Umgebung traegt lauter Nullen, aber sie fehlt nicht.
    expect(production.present).toBe(true);
    expect(production.bound).toBe(false);
    expect(production.changeSets.total).toBe(0);
    expect(production.changeSets.latestCreatedAt).toBeNull();
    expect(production.approvals.total).toBe(0);
    expect(production.migrations!.total).toBe(0);
    expect(production.migrations!.lastFinishedAt).toBeNull();

    // --- Jede Zahl steht so in der Datenbank ---
    const stored = await owner.query<{ environment: string; status: string; n: string }>(
      `SELECT environment::text AS environment, status::text AS status, count(*)::text AS n
       FROM change_sets WHERE organization_id = $1 AND project_id = $2
       GROUP BY 1, 2 ORDER BY 1, 2`, [flowOrganization, flowProject]);
    const counted = new Map(stored.rows.map((row) => [`${row.environment}:${row.status}`, Number(row.n)]));
    for (const entry of flow.environments) {
      for (const [status, count] of Object.entries(entry.changeSets.byStatus)) {
        expect(count, `${entry.environment}:${status}`).toBe(counted.get(`${entry.environment}:${status}`) ?? 0);
      }
      // Die Summe ist die Summe der Einzelwerte und keine zweite Zahl daneben.
      expect(Object.values(entry.changeSets.byStatus).reduce((sum, value) => sum + value, 0), entry.environment)
        .toBe(entry.changeSets.total);
    }
    const storedTotal = stored.rows.reduce((sum, row) => sum + Number(row.n), 0);
    expect(flow.environments.reduce((sum, entry) => sum + entry.changeSets.total, 0)).toBe(storedTotal);
    expect(storedTotal).toBe(4);
    // Der juengste Zeitpunkt ist der juengste und nicht irgendeiner.
    const youngest = await owner.query<{ created_at: string }>(
      `SELECT to_char(max(created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
       FROM change_sets WHERE organization_id = $1 AND project_id = $2 AND environment = 'development'`,
      [flowOrganization, flowProject]);
    expect(development.changeSets.latestCreatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(development.changeSets.latestCreatedAt).toBe(youngest.rows[0].created_at);

    // --- Zusage 2: drei Umgebungen, auch wenn nur eine eingerichtet ist ---
    const bare = await service.summariseChangeFlow(context, bareProject);
    expect(bare.environments.map((entry) => entry.environment))
      .toEqual(["development", "staging", "production"]);
    expect(bare.environments.map((entry) => entry.present)).toEqual([true, false, false]);
    for (const entry of bare.environments) {
      expect(entry.changeSets.total, entry.environment).toBe(0);
      expect(entry.approvals.total, entry.environment).toBe(0);
      expect(entry.migrations!.total, entry.environment).toBe(0);
    }
    // Und die Datenbank fuehrt wirklich nur eine Zeile: Die zwei fehlenden
    // Umgebungen sind nicht erfunden, sondern als fehlend gemeldet.
    const bareRows = await owner.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM project_environments WHERE project_id = $1", [bareProject]);
    expect(bareRows.rows[0].n).toBe("1");

    // --- Zusage 3: der Nachbar sieht nichts davon ---
    const neighbour = {
      organizationId: organizationB,
      actor: { id: secondUserId, ref: `integration-${secondUserId}@qkern.test`, type: "user" as const },
    };
    // Kein "nichts vorhanden" mit drei Nullreihen, sondern "nicht gefunden".
    await expect(service.summariseChangeFlow(neighbour, flowProject)).rejects.toThrowError(/not found/i);
    await expect(service.summariseChangeFlow(neighbour, bareProject)).rejects.toThrowError(/not found/i);
    // Und auch unter der Laufzeitrolle mit dem Mandanten des Nachbarn steht
    // keine einzige Zeile dieses Projekts zur Verfuegung.
    const hidden = await withTenantTransaction(runtime, { organizationId: organizationB, readOnly: true },
      async (transaction) => transaction.query<{ change_sets: string; approvals: string; jobs: string }>(
        `SELECT (SELECT count(*)::text FROM change_sets WHERE project_id = $1) AS change_sets,
                (SELECT count(*)::text FROM approval_requests WHERE project_id = $1) AS approvals,
                (SELECT count(*)::text FROM migration_jobs WHERE project_id = $1) AS jobs`,
        [flowProject]));
    expect(hidden.rows[0]).toEqual({ change_sets: "0", approvals: "0", jobs: "0" });
    // Gegenprobe, damit die drei Nullen nicht von einer leeren Tabelle kommen:
    // Der Eigentuemer sieht dieselben Zeilen sehr wohl.
    const visible = await owner.query<{ change_sets: string; approvals: string; jobs: string }>(
      `SELECT (SELECT count(*)::text FROM change_sets WHERE project_id = $1) AS change_sets,
              (SELECT count(*)::text FROM approval_requests WHERE project_id = $1) AS approvals,
              (SELECT count(*)::text FROM migration_jobs WHERE project_id = $1) AS jobs`,
      [flowProject]);
    expect(visible.rows[0]).toEqual({ change_sets: "4", approvals: "4", jobs: "2" });
  }, 120_000);
  it("(2.80) accepts a real foreign token through the Data API under row security and refuses the four forgeries", async () => {
    // Fremde Anbieter (2.80) an einem Stueck, gegen die echte Datenbank: echtes
    // Schluesselpaar, echtes Token, echte Zeile in
    // project_auth_third_party_providers, echte Pruefung durch den Dienst, echte
    // Lesung durch die generierte Data API unter der Zeilensicherheit.
    //
    // Echt ist alles, worauf es ankommt: die Tabelle aus Migration 0061, das
    // PostgreSQL-Repository von Project Auth, der Audit-Sink in der Hash-Kette,
    // das reine Pruefmodul, der Weg `projectApplicationPrincipal`, den die
    // Data-API-Routen wirklich nehmen, die echte Projektdatenbank mit echter
    // Policy und die echte `GeneratedDataApiService`.
    //
    // Gestellt ist genau eine Stelle: der Transport zum Schluesselsatz. Der
    // gepruefte Weg (`createGuardedFetch`) verlangt https und eine oeffentlich
    // erreichbare Adresse und kann darum im Zertifizierungsnetz keinen Server
    // erreichen; die Adresspolicy selbst ist eigens zertifiziert. An seiner
    // Stelle steht hier ein Abrufer, der antwortet wie ein Aussteller.
    // Dieselbe Grenze zieht der Fall (2.77) beim Container.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.62 und 2.77: Jede
    // Aenderung schreibt eine Audit-Zeile, und eine Organisation mit
    // Audit-Zeilen laesst sich wegen audit_logs_organization_id_fkey nicht mehr
    // loeschen. Weggeraeumt wird nur das eigene Schema.
    expect(projectApiUrl, "QKERN_TEST_PROJECT_API_DATABASE_URL fehlt").toBeTruthy();
    const target = new URL(projectApiUrl!);
    const expectedDatabase = target.pathname.slice(1);
    const expectedRole = decodeURIComponent(target.username);

    const foreignOwner = randomUUID();
    const foreignOrganization = randomUUID();
    const foreignProject = randomUUID();
    const schema = `thirdparty_${randomUUID().replaceAll("-", "_")}`;
    const scope = {
      organizationId: foreignOrganization, projectId: foreignProject, environment: "development" as const,
    };
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [foreignOwner, `third-party-owner-${foreignOwner}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Third Party 2.80', $2, $3)`,
    [foreignOrganization, `third-party-${foreignOrganization}`, foreignOwner]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Third Party 2.80', $3, 'test', 'ready', $4)`,
    [foreignProject, foreignOrganization, `third-party-${foreignProject}`, foreignOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [foreignOrganization, foreignProject, `managed:${foreignProject}`]);

    // Zwei echte Schluesselpaare: eines gehoert dem Aussteller, das andere
    // niemandem, den QKERN kennt. Das zweite ist der Fall "richtig geformtes
    // Token, falsch unterschrieben", und der ist nur mit einem zweiten echten
    // Schluessel zu zeigen.
    const issuerKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const strangerKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicPem = issuerKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
    const issuer = "https://aussteller-2-80.example.com/auth";
    const audience = "qkern-app-2-80";
    const jwksUri = "https://aussteller-2-80.example.com/.well-known/jwks.json";
    const liveJwk = {
      ...issuerKeys.publicKey.export({ format: "jwk" }),
      kid: "live-2-80", alg: "RS256", use: "sig",
    };
    // Ein symmetrischer Eintrag mitten im Schluesselsatz. Er steht hier, weil
    // die zweite Tuer gegen die HS256-Faelschung sonst unbelegt bliebe: Ein
    // Token, das ein erlaubtes Verfahren nennt und auf diesen Schluessel zeigt,
    // muss am Schluesseltyp fallen und nicht erst an der Unterschrift.
    const symmetricJwk = { kty: "oct", k: Buffer.from(publicPem, "utf8").toString("base64url"), kid: "sym-2-80" };
    let fetched = 0;
    const keySets = new ProjectAuthThirdPartyKeySets({
      fetchFn: (async (input: RequestInfo | URL) => {
        expect(String(input)).toBe(jwksUri);
        fetched += 1;
        return new Response(JSON.stringify({ keys: [liveJwk, symmetricJwk] }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });

    const signingKey = generateKeyPairSync("ed25519").privateKey;
    const service = new ProjectAuthService({
      repository: new PostgresProjectAuthRepository(auth),
      audit: new PostgresProjectAuthAuditSink(auth),
      passwords: new Argon2idPasswordHasher({}),
      rateLimiter: new InMemoryRateLimiter(),
      tokens: new ProjectAuthTokenService({ kid: "certification-2-80", privateKey: signingKey }, "https://qkern.test"),
      mfa: new ProjectAuthTotp(),
      secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 9)),
      delivery: new NoopDevelopmentProjectAuthDelivery(),
      oidcCatalog: new ProjectAuthOidcCatalog([]),
      oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
      thirdPartyKeys: keySets,
      callbackBaseUrl: "https://qkern.test",
      allowedRedirectOrigins: new Set(["https://app.test"]),
      exposeDeliveryTokens: true,
    });

    const subject = `aussteller|${randomUUID()}`;
    const stranger = `aussteller|${randomUUID()}`;
    const projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
    try {
      // --- Zusage 1: service_role ist nicht eintragbar --------------------
      //
      // Zuerst, und mit eigenem Grund. Das ist die Entscheidung dieses
      // Schnittes, und sie soll nicht als allgemeine Formablehnung
      // durchgehen: Die Rolle gibt es, und sie ist hier verboten.
      await expect(service.createThirdPartyProvider(scope, {
        name: "zu-viel", issuer: "https://zu-viel.example.com", jwksUri,
        audiences: [audience], defaultRole: "service_role",
      }, { id: foreignOwner })).rejects.toMatchObject({
        name: "ProjectAuthThirdPartyError", reason: "role_forbidden", field: "defaultRole",
      });
      // Und die Datenbank sagt dasselbe, auch ohne den Dienst.
      await expect(auth.query(`INSERT INTO project_auth_third_party_providers
        (id, organization_id, project_id, environment, name, issuer, jwks_uri, audiences, default_role)
        VALUES ($1,$2,$3,$4,'direkt','https://direkt.example.com',$5,ARRAY[$6]::text[],'service_role')`,
      [randomUUID(), ...[foreignOrganization, foreignProject, "development"], jwksUri, audience]))
        .rejects.toMatchObject({ code: "23514" });
      // Ein Aussteller mit Schrägstrich am Ende faellt mit eigenem Grund: Der
      // Anspruch `iss` wird Zeichen fuer Zeichen verglichen.
      await expect(service.createThirdPartyProvider(scope, {
        name: "mit-schraegstrich", issuer: `${issuer}/`, jwksUri, audiences: [audience],
      }, { id: foreignOwner })).rejects.toMatchObject({ reason: "issuer_trailing_slash" });

      // --- Zusage 2: der Eintrag entsteht wirklich ------------------------
      const stored = await service.createThirdPartyProvider(scope, {
        name: "aussteller-2-80", issuer, jwksUri, audiences: [audience],
        subjectClaim: "sub", roleClaim: "qkern_rolle", defaultRole: "authenticated",
      }, { id: foreignOwner });
      expect(stored.configured).toBe(true);
      expect(stored.forbiddenRole).toBe("service_role");
      expect(stored.roles).toEqual(["anon", "authenticated"]);
      // Die Positivliste kommt aus dem Dienst und nicht aus diesem Fall. Was
      // nicht darin steht, ist die Aussage: kein `none`, kein HS-Verfahren.
      expect(stored.algorithms).not.toContain("none");
      expect(stored.algorithms.some((entry) => entry.startsWith("HS"))).toBe(false);
      expect(stored.algorithms).toContain("RS256");
      const providerRow = await auth.query<{ default_role: string; audiences: string[] }>(
        `SELECT default_role, audiences FROM project_auth_third_party_providers
         WHERE organization_id = $1 AND project_id = $2 AND issuer = $3`,
        [foreignOrganization, foreignProject, issuer]);
      expect(providerRow.rows[0]).toMatchObject({ default_role: "authenticated", audiences: [audience] });
      // Kein Recht zum Aendern, genau wie 0061 es sagt.
      await expect(auth.query(
        `UPDATE project_auth_third_party_providers SET jwks_uri = $1 WHERE issuer = $2`,
        ["https://woanders.example.com/jwks", issuer])).rejects.toThrowError(/permission denied/i);

      // --- Zusage 3: ein echtes Token wird angenommen ---------------------
      const token = foreignToken({
        privateKey: issuerKeys.privateKey,
        header: { alg: "RS256", typ: "JWT", kid: "live-2-80" },
        claims: { iss: issuer, aud: audience, sub: subject, qkern_rolle: "authenticated", abteilung: "einkauf" },
      });
      const accepted = await service.verifyThirdPartyToken(scope, token);
      expect(accepted.ok).toBe(true);
      if (!accepted.ok) throw new Error("unerreichbar");
      expect(accepted.identity).toMatchObject({ subject, role: "authenticated", issuer });
      // Die eigenen Ansprueche des Ausstellers wandern mit, die von QKERN nicht.
      expect(accepted.identity.claims).toEqual({ abteilung: "einkauf", qkern_rolle: "authenticated" });
      expect(fetched).toBe(1);
      // Der Schluesselsatz wird gehalten und nicht bei jeder Pruefung geholt.
      await service.verifyThirdPartyToken(scope, token);
      expect(fetched).toBe(1);

      // --- Zusage 4: die vier Faelschungen fallen, und zwar mit Grund -----
      //
      // `alg: none` zweimal: einmal so, wie ein Angreifer es schreibt (leere
      // Unterschrift), und einmal mit Muell an der Stelle der Unterschrift.
      // Der zweite Fall ist der wichtige, denn nur er kommt bis zur Wahl des
      // Verfahrens und belegt, dass sie aus der Positivliste kommt.
      const unsigned = `${base64url({ alg: "none", typ: "JWT" })}.${base64url({
        iss: issuer, aud: audience, sub: subject, exp: Math.floor(Date.now() / 1000) + 600,
      })}.`;
      await expect(service.verifyThirdPartyToken(scope, unsigned))
        .resolves.toMatchObject({ ok: false, reason: "not_three_parts" });
      const noneWithNoise = `${base64url({ alg: "none", typ: "JWT" })}.${base64url({
        iss: issuer, aud: audience, sub: subject, exp: Math.floor(Date.now() / 1000) + 600,
      })}.AAAA`;
      await expect(service.verifyThirdPartyToken(scope, noneWithNoise))
        .resolves.toMatchObject({ ok: false, reason: "algorithm_not_allowed" });

      // Das falsche Publikum.
      const wrongAudience = foreignToken({
        privateKey: issuerKeys.privateKey,
        header: { alg: "RS256", typ: "JWT", kid: "live-2-80" },
        claims: { iss: issuer, aud: "eine-andere-app", sub: subject },
      });
      await expect(service.verifyThirdPartyToken(scope, wrongAudience))
        .resolves.toMatchObject({ ok: false, reason: "audience_mismatch" });

      // Das abgelaufene Token. Weit jenseits der Toleranz von 30 Sekunden,
      // damit der Fall nicht an der Toleranz haengt, die er nicht prueft.
      const expired = foreignToken({
        privateKey: issuerKeys.privateKey,
        header: { alg: "RS256", typ: "JWT", kid: "live-2-80" },
        claims: {
          iss: issuer, aud: audience, sub: subject,
          iat: Math.floor(Date.now() / 1000) - 7_200, exp: Math.floor(Date.now() / 1000) - 3_600,
        },
      });
      await expect(service.verifyThirdPartyToken(scope, expired))
        .resolves.toMatchObject({ ok: false, reason: "expired" });

      // Die Unterschrift mit dem falschen Schluessel. Derselbe `kid`, damit
      // der Fall wirklich an der Rechnung scheitert und nicht daran, dass
      // kein Schluessel gefunden wurde.
      const forged = foreignToken({
        privateKey: strangerKeys.privateKey,
        header: { alg: "RS256", typ: "JWT", kid: "live-2-80" },
        claims: { iss: issuer, aud: audience, sub: subject },
      });
      await expect(service.verifyThirdPartyToken(scope, forged))
        .resolves.toMatchObject({ ok: false, reason: "signature_invalid" });

      // --- Zusage 5: die HS256-Faelschung, beide Tueren -------------------
      //
      // Erste Tuer: `HS256` steht nicht auf der Positivliste. Die Unterschrift
      // ist ein echtes HMAC mit dem oeffentlichen Schluessel des Ausstellers
      // als Geheimnis, also genau die Faelschung, um die es geht.
      const hsHeader = base64url({ alg: "HS256", typ: "JWT", kid: "live-2-80" });
      const hsClaims = base64url({
        iss: issuer, aud: audience, sub: subject, exp: Math.floor(Date.now() / 1000) + 600,
      });
      const hsToken = `${hsHeader}.${hsClaims}.${createHmac("sha256", publicPem)
        .update(`${hsHeader}.${hsClaims}`).digest("base64url")}`;
      await expect(service.verifyThirdPartyToken(scope, hsToken))
        .resolves.toMatchObject({ ok: false, reason: "algorithm_not_allowed" });
      // Zweite Tuer: ein erlaubtes Verfahren, aber der Schluessel im
      // Schluesselsatz ist symmetrisch. Der Schluesseltyp muss zum Verfahren
      // passen, sonst waere ein `oct`-Eintrag ein Geheimnis, das jeder kennt.
      const symmetricPointer = foreignToken({
        privateKey: issuerKeys.privateKey,
        header: { alg: "RS256", typ: "JWT", kid: "sym-2-80" },
        claims: { iss: issuer, aud: audience, sub: subject },
      });
      await expect(service.verifyThirdPartyToken(scope, symmetricPointer))
        .resolves.toMatchObject({ ok: false, reason: "key_type_mismatch" });

      // --- Zusage 6: service_role kommt auch aus dem Token nicht heraus ---
      const wantsService = foreignToken({
        privateKey: issuerKeys.privateKey,
        header: { alg: "RS256", typ: "JWT", kid: "live-2-80" },
        claims: { iss: issuer, aud: audience, sub: subject, qkern_rolle: "service_role" },
      });
      await expect(service.verifyThirdPartyToken(scope, wantsService))
        .resolves.toMatchObject({ ok: false, reason: "role_claim_not_allowed" });
      // Und ein unbekannter Aussteller findet gar keinen Eintrag.
      const unknownIssuer = foreignToken({
        privateKey: issuerKeys.privateKey,
        header: { alg: "RS256", typ: "JWT", kid: "live-2-80" },
        claims: { iss: "https://niemand.example.com", aud: audience, sub: subject },
      });
      await expect(service.verifyThirdPartyToken(scope, unknownIssuer))
        .resolves.toMatchObject({ ok: false, reason: "no_provider" });

      // --- Zusage 7: die echte Lesung durch die Data API unter RLS --------
      //
      // Die Policy nennt beides: den Anspruch `sub` und den Anspruch `iss` aus
      // `request.jwt.claims`. Damit prueft dieser Fall nicht nur, dass etwas
      // gelesen wird, sondern dass genau die Ansprueche des fremden Tokens auf
      // demselben Weg ankommen wie die eines eigenen.
      await owner.query(`CREATE SCHEMA "${schema}"`);
      await owner.query(`CREATE TABLE "${schema}".fremde_notizen (
        id uuid PRIMARY KEY, besitzer text NOT NULL, quelle text NOT NULL, inhalt text NOT NULL)`);
      await owner.query(`ALTER TABLE "${schema}".fremde_notizen ENABLE ROW LEVEL SECURITY`);
      await owner.query(`CREATE POLICY eigene_quelle ON "${schema}".fremde_notizen
        FOR SELECT TO ${expectedRole} USING (
          besitzer = current_setting('request.jwt.claim.sub', true) AND
          quelle = (current_setting('request.jwt.claims', true)::jsonb ->> 'iss'))`);
      const mine = randomUUID();
      await owner.query(`INSERT INTO "${schema}".fremde_notizen (id, besitzer, quelle, inhalt) VALUES
        ($1, $2, $3, 'meine beim fremden Anbieter'),
        ($4, $2, 'https://qkern.test/eigen', 'dasselbe Subjekt, andere Quelle'),
        ($5, $6, $3, 'fremdes Subjekt, gleiche Quelle')`,
      [mine, subject, issuer, randomUUID(), randomUUID(), stranger]);
      await owner.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${expectedRole}`);
      await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO ${expectedRole}`);

      // Der Weg, den die Data-API-Routen wirklich nehmen. Gestellt ist nur der
      // Key-Dienst: Welcher Public Key gueltig ist, ist eigens zertifiziert,
      // und der Fall soll nicht davon abhaengen. Dass ein Key **verlangt**
      // wird, prueft er gleich danach.
      const keyPrincipal = {
        id: randomUUID(), organizationId: foreignOrganization, projectId: foreignProject,
        environment: "development" as const, kind: "public" as const,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      };
      const keys = {
        authenticate: async (secret: string) => secret === "qk_pub_2_80" ? keyPrincipal : null,
      } as unknown as ProjectApiKeyService;
      const request = new NextRequest("https://qkern.test/api/v1/projects/x/environments/development/data", {
        headers: { authorization: `Bearer ${token}`, "x-qkern-key": "qk_pub_2_80" },
      });
      const principal = await projectApplicationPrincipal(
        request, { projectId: foreignProject, environment: "development" }, keys, service,
      );
      expect(principal).not.toBeNull();
      expect(principal!.role).toBe("authenticated");
      expect(principal!.subject).toBe(subject);
      // Der Aktor sagt, dass hier kein Konto steht, und nennt keine Nutzer-ID.
      expect(principal!.actorRef.startsWith("project-auth-third-party:aussteller-2-80:")).toBe(true);
      // Kein erfundenes aal, keine erfundene Sitzung.
      expect(principal!.claims.assurance).toBeUndefined();
      expect(principal!.claims.sessionId).toBeUndefined();
      expect(principal!.claims.issuer).toBe(issuer);

      // Ohne Public Key gibt es diesen Weg nicht, auch nicht mit gueltigem Token.
      await expect(projectApplicationPrincipal(
        new NextRequest("https://qkern.test/api/v1/projects/x/environments/development/data", {
          headers: { authorization: `Bearer ${token}` },
        }),
        { projectId: foreignProject, environment: "development" }, keys, service,
      )).rejects.toThrowError();

      const connections = { resolve: async () => ({
        pool: projectApi, expectedRole, expectedDatabase, expectedLedgerOwner: "qkern",
      }) };
      const targets = { resolveTarget: async () => ({ databaseInstanceRef: `managed:${foreignProject}` }) };
      const generated = new GeneratedDataApiService(targets, connections);
      const rows = await generated.listRows(
        { organizationId: principal!.organizationId, actorRef: principal!.actorRef, claims: principal!.claims },
        { projectId: foreignProject, environment: "development" },
        { schema, table: "fremde_notizen" },
      );
      // Genau eine Zeile: die mit demselben Subjekt **und** derselben Quelle.
      // Die anderen zwei belegen, dass beide Ansprueche wirklich wirken und
      // nicht bloss einer davon gesetzt ist.
      expect(rows.rows.map((row) => row.inhalt)).toEqual(["meine beim fremden Anbieter"]);

      // Und eine abgewiesene Faelschung kommt gar nicht bis zur Datenbank.
      await expect(projectApplicationPrincipal(
        new NextRequest("https://qkern.test/api/v1/projects/x/environments/development/data", {
          headers: { authorization: `Bearer ${forged}`, "x-qkern-key": "qk_pub_2_80" },
        }),
        { projectId: foreignProject, environment: "development" }, keys, service,
      )).rejects.toThrowError();

      // --- Zusage 8: das Entfernen nimmt die Erlaubnis zurueck ------------
      const after = await service.deleteThirdPartyProvider(
        scope, stored.providers[0].id, { id: foreignOwner },
      );
      expect(after.providers).toEqual([]);
      expect(after.configured).toBe(false);
      // Dasselbe Token, das eben noch gelesen hat, findet jetzt keinen Eintrag.
      await expect(service.verifyThirdPartyToken(scope, token))
        .resolves.toMatchObject({ ok: false, reason: "no_provider" });

      // --- Zusage 9: die Spur traegt kein Token --------------------------
      const auditRows = await owner.query<{ action: string; metadata: string }>(
        `SELECT action, redacted_metadata::text AS metadata FROM audit_logs
          WHERE organization_id = $1`, [foreignOrganization]);
      const actions = auditRows.rows.map((row) => String(row.action));
      expect(actions).toContain("project_auth.third_party_provider.created");
      expect(actions).toContain("project_auth.third_party_provider.removed");
      const serialised = JSON.stringify(auditRows.rows);
      expect(serialised).not.toContain(token);
      expect(serialised).not.toContain(subject);
      expect(serialised).not.toContain("service_role");
    } finally {
      await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await projectApi.end();
    }
  }, 120_000);
  /**
   * Derselbe Eintrag nur einmal, auch nach einem Neustart (2.64 mit der Lehre
   * aus 2.75).
   *
   * Der Fall (2.64) darueber belegt, dass der Prozess seinen Stand dauerhaft
   * haelt -- aber er belegt es an `function_invocations`, und genau dort kann
   * er einen Fehler nicht sehen: Dessen Zeitpunkt schreibt ein
   * JavaScript-`Date`, und dessen Mikrosekunden sind immer null. Eine auf
   * Millisekunden gekuerzte Position ist dort zufaellig richtig.
   *
   * Dieser Fall nimmt darum `auth_audit`. Dort setzt die Datenbank `now()`, und
   * `audit_logs.created_at` hat Mikrosekunden. Kuerzt der Leser seine Position
   * auf Millisekunden, ist sie **kleiner** als die Zeile, aus der sie stammt,
   * und der Zeilenvergleich `(zeit, id) > ($4::timestamptz, $5::uuid)` laesst
   * dieselbe Zeile wieder durch. Der Stand im Speicher schuetzt davor nicht:
   * Er ist dieselbe gekuerzte Zeichenkette, die der Leser zurueckgegeben hat.
   * Mit dem Fehler eingebaut hat dieser Fall darum schon im ersten Lauf drei
   * Ladungen derselben Zeile gesehen, und nach jedem Neustart kaeme sie aus
   * `project_log_drain_cursors` erneut. Beides ist dieselbe Ursache.
   *
   * Belegt werden drei Dinge, und alle drei braucht es:
   *
   * 1. Ein laufender Prozess leitet jede Zeile einmal weiter. Das ist die
   *    Stelle, an der ein gekuerzter Wert zuerst auffaellt.
   * 2. Die festgehaltene Position **ist** die Position der Zeile: dieselben
   *    sechs Stellen, die die Datenbank fuer diese Zeile ausgibt. Das ist die
   *    Aussage am Wert.
   * 3. Nach dem Neustart kommt genau eine neue Ladung, mit genau der einen
   *    neuen Zeile. Das ist die Aussage ueber die dauerhafte Position, und die
   *    ist die, um die es dem Empfaenger geht: Ein Fall, der nur den laufenden
   *    Prozess prueft, laesst offen, was aus der Zeichenkette in der Datenbank
   *    beim naechsten Start wird.
   *
   * Eigene Organisation mit eigenem Besitzer, wie (2.64): Das gemeinsame
   * afterAll muss organizationA und organizationB loswerden, und eine
   * Organisation mit Audit-Zeilen laesst sich wegen
   * audit_logs_organization_id_fkey nicht mehr loeschen. Abgeraeumt wird nur,
   * was das Produkt hergibt, und das ist hier nichts: `audit_logs` ist
   * append-only, und die Drain-Flaeche loescht ausdruecklich nicht.
   *
   * Dass ein angehaltener Prozess wirklich nichts mehr tut, prueft (2.64)
   * daneben; dieser Fall wiederholt es nicht.
   */
  it("(2.85) does not forward the same audit row again after a restart when the database sets the microseconds", async () => {
    expect(vaultKvUrl, "QKERN_TEST_VAULT_KV_URL fehlt").toBeTruthy();
    expect(vaultTokenFile, "QKERN_TEST_VAULT_TOKEN_FILE fehlt").toBeTruthy();
    expect(databaseWebhookSecretRef, "QKERN_TEST_DATABASE_WEBHOOK_SECRET_REF fehlt").toBeTruthy();

    const cursorOwner = randomUUID();
    const cursorOrganization = randomUUID();
    const cursorProject = randomUUID();
    // Die Adresse des Administrators, der den Drain anlegt. Weder die Ladung
    // noch das Log des Prozesses darf sie tragen.
    const actorRef = `drain-cursor-${cursorOwner}@qkern.test`;

    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`, [cursorOwner, actorRef]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Drain Cursor', $2, $3)`,
    [cursorOrganization, `drain-cursor-${cursorOrganization}`, cursorOwner]);
    await owner.query(`INSERT INTO organization_members
      (organization_id, user_id, role, is_personal_workspace)
      VALUES ($1, $2, 'owner', true)`, [cursorOrganization, cursorOwner]);
    await owner.query(`INSERT INTO projects
      (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Drain Cursor', $3, 'test', 'ready', $4)`,
    [cursorProject, cursorOrganization, `drain-cursor-${cursorProject}`, cursorOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`,
    [cursorOrganization, cursorProject, `managed:${cursorProject}`]);

    const scope = {
      organizationId: cursorOrganization, projectId: cursorProject,
      environment: "development" as const,
    };
    const admin = {
      organizationId: cursorOrganization, actorRef, role: "admin" as const,
      subject: cursorOwner,
    };
    const control = new PostgresControlPlane(runtime);

    const drains = new PostgresLogDrainRepository(control);
    const drain = await new LogDrainService({ repository: drains }).create(admin, scope, {
      name: "audit-logs-an-siem",
      url: "https://siem.example.com/qkern/audit-logs",
      sources: ["auth_audit"],
      signingSecretRef: databaseWebhookSecretRef!,
    });
    expect(drain.enabled).toBe(true);

    // Der echte Sink, nicht ein Einsatz in `audit_logs`: Der Zeitpunkt soll von
    // derselben Anweisung kommen, die im Betrieb schreibt.
    const auditSink = new PostgresProjectAuthAuditSink(auth);
    const appUser = randomUUID();
    const writeAudit = async () => {
      await auditSink.record({
        scope, action: "project_auth.login.succeeded", actorType: "app_user",
        actorRef: `project_auth_user:${appUser}`,
        resourceRef: `project_auth_user:${appUser}`, status: "succeeded",
      });
    };

    const children: ReturnType<typeof spawn>[] = [];
    try {
      /** Der ausgelieferte Prozess, nichts daneben. Wie in (2.64). */
      const start = () => {
        const child = spawn(process.execPath, ["--import", "tsx", "workers/compute-runtime.mts"], {
          cwd: process.cwd(),
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            NODE_ENV: "test",
            QKERN_COMPUTE_RUNTIME_ENABLED: "true",
            QKERN_COMPUTE_CRON_ENABLED: "false",
            QKERN_COMPUTE_WEBHOOKS_ENABLED: "true",
            // Die Bruecke aus: Sie braeuchte eine Projektdatenbank, der Sammler
            // nicht. `audit_logs` liegt in der Control Plane.
            QKERN_COMPUTE_DATABASE_WEBHOOKS_ENABLED: "false",
            QKERN_COMPUTE_LOG_DRAINS_ENABLED: "true",
            // Eine Zeile ist eine Ladung. Sonst wartete dieser Fall auf das
            // Altersfenster der Buendelung, und das misst er gar nicht.
            QKERN_COMPUTE_LOG_DRAIN_BATCH_ENTRIES: "1",
            QKERN_COMPUTE_LOG_DRAIN_POLL_MS: "200",
            QKERN_COMPUTE_LOG_DRAIN_DISCOVERY_MS: "1000",
            QKERN_COMPUTE_WORKER_ID: "certification-drain-cursor-1",
            QKERN_COMPUTE_SCOPES_JSON: JSON.stringify([scope]),
            QKERN_RUNTIME_MODE: "postgres",
            QKERN_STATEMENT_ENCRYPTION_KEY: "0".repeat(64),
            QKERN_RUNTIME_DATABASE_URL: runtimeUrl!,
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

      const batches = async () => {
        const result = await owner.query<{
          event_type: string; payload: { entries: Array<Record<string, unknown>> };
        }>(`SELECT event_type, payload FROM project_webhook_deliveries
             WHERE organization_id = $1 AND project_id = $2
             ORDER BY occurred_at, id`, [cursorOrganization, cursorProject]);
        return result.rows;
      };

      /** Die Kennungen aller weitergeleiteten Zeilen, in der Reihenfolge der Ladungen. */
      const forwardedIds = async () => (await batches())
        .flatMap((row) => row.payload.entries.map((entry) => entry.id as string));

      const cursors = async () => {
        const result = await owner.query<{ position: string; forwarded: boolean }>(
          `SELECT position, forwarded_at IS NOT NULL AS forwarded
             FROM project_log_drain_cursors
            WHERE organization_id = $1 AND project_id = $2 AND environment = 'development'`,
          [cursorOrganization, cursorProject]);
        return result.rows;
      };

      /**
       * Die Audit-Zeilen, wie der Leser sie sieht, und zu jeder zwei Angaben
       * der Datenbank: ihre Mikrosekunden und die Zeichenkette, die eine
       * ungekuerzte Position tragen muss. Das `to_char` ist dasselbe, das im
       * Leser steht -- es wird hier nicht nachgerechnet, sondern erfragt.
       */
      const auditRows = async () => {
        const result = await owner.query<{ id: string; micros: string; exact: string }>(
          `SELECT id, to_char(created_at, 'US') AS micros,
                  to_char(created_at AT TIME ZONE 'UTC',
                          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS exact
             FROM audit_logs
            WHERE organization_id = $1 AND project_id = $2
              AND starts_with(action, 'project_auth.')
            ORDER BY created_at, id`,
          [cursorOrganization, cursorProject]);
        return result.rows;
      };

      /** Wartet auf eine Bedingung mit Frist und Diagnose, nie blind. Wie in (2.64). */
      const until = async (
        what: string, budgetMs: number, condition: () => Promise<boolean>, diagnose: () => Promise<string>,
      ) => {
        const deadline = Date.now() + budgetMs;
        while (Date.now() < deadline) {
          if (await condition()) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        expect.fail(`${what} blieb ${budgetMs} ms aus. ${await diagnose()}`);
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
        async () => first.output().includes("log drain collector"),
        async () => `Ausgabe: ${first.output().slice(-800)}`);

      // Erst, wenn der Prozess seinen Anfangsstand festgehalten hat, liegt die
      // naechste Zeile sicher **nach** der Spitze. Ohne diese Bedingung waere
      // der Fall ein Wettlauf zwischen Testprozess und Sammler.
      await until("Der Anfangsstand des Drains", 90_000,
        async () => (await cursors()).length === 1,
        async () => `Ausgabe: ${first.output().slice(-800)}`);
      expect((await cursors())[0], "der Anfangsstand behauptet eine Weiterleitung")
        .toMatchObject({ position: "", forwarded: false });

      // Die Zeile, deren Position den Neustart ueberdauert, ist die **letzte**
      // weitergeleitete. Nur wenn deren Mikrosekunden nicht null sind, sagt
      // dieser Fall etwas ueber die Kuerzung aus. `now()` trifft eine glatte
      // Millisekunde etwa in einem von tausend Faellen; dann wird eine weitere
      // Zeile geschrieben. Das ist kein Nachgeben bei der Zusage, sondern die
      // Herstellung der Lage, in der sie ueberhaupt etwas behauptet.
      let rowsBefore: Awaited<ReturnType<typeof auditRows>> = [];
      do {
        await writeAudit();
        rowsBefore = await auditRows();
        expect(rowsBefore.length, "die Datenbank nimmt keine Audit-Zeile an").toBeGreaterThan(0);
      } while (/000$/.test(rowsBefore[rowsBefore.length - 1].micros));
      const lastBefore = rowsBefore[rowsBefore.length - 1];
      const idsBefore = rowsBefore.map((row) => row.id);

      await until("Die Ladungen aus dem laufenden Prozess", 90_000,
        async () => (await forwardedIds()).length >= idsBefore.length,
        async () => `Ausgabe: ${first.output().slice(-800)}`);
      // Jede Zeile genau einmal, und keine andere. Hier faellt eine gekuerzte
      // Position zuerst auf: Der Stand im Speicher ist dieselbe Zeichenkette,
      // die der Leser zurueckgegeben hat, und jeder weitere Lauf holte die
      // juengste Zeile noch einmal.
      expect(await forwardedIds(),
        "der laufende Prozess hat eine Zeile mehrfach oder eine fremde weitergeleitet")
        .toEqual(idsBefore);
      for (const row of await batches()) expect(row.event_type).toBe("log.auth_audit");

      // Die erste der beiden Zusagen, und zwar am Wert: Die festgehaltene
      // Position traegt die sechs Stellen der Datenbank. Gewartet wird, weil
      // der Sammler absichtlich erst einreiht und danach die Position schreibt
      // -- zwischen beiden liegt ein Fenster, und ein Fall, der sofort
      // nachsieht, prueft nicht das Produkt, sondern wer schneller war.
      const positionBefore = `${lastBefore.exact}#${lastBefore.id}`;
      await until("Die festgehaltene Position der letzten Zeile", 90_000,
        async () => (await cursors())[0]?.position === positionBefore,
        async () => `Festgehalten: ${JSON.stringify(await cursors())}, erwartet: ${positionBefore}`);
      expect((await cursors())[0], "der Prozess hat seine Position nicht festgehalten")
        .toMatchObject({ position: positionBefore, forwarded: true });

      // --- Anhalten, und eine Zeile dazu -------------------------------------
      expect(await stop(first)).toBe(0);
      expect(await forwardedIds(), "der angehaltene Prozess hat weitergearbeitet")
        .toEqual(idsBefore);

      await writeAudit();
      const rowsAfter = await auditRows();
      expect(rowsAfter.length, "die Zeile aus der Pause fehlt").toBe(rowsBefore.length + 1);
      const lastAfter = rowsAfter[rowsAfter.length - 1];
      const positionAfter = `${lastAfter.exact}#${lastAfter.id}`;

      // --- Zweiter Lauf: die dauerhafte Position, und nur die neue Zeile -----
      //
      // Hier liest der Sammler erstmals aus `project_log_drain_cursors`: Sein
      // Puffer und sein Stand im Speicher sind mit dem ersten Prozess
      // verschwunden.
      const second = start();
      await until("Die Startzeile des zweiten Prozesses", 120_000,
        async () => second.output().includes("log drain collector"),
        async () => `Ausgabe: ${second.output().slice(-800)}`);

      await until("Die Ladung aus der Pause", 90_000,
        async () => (await forwardedIds()).length > idsBefore.length,
        async () => `Ausgabe: ${second.output().slice(-800)}`);

      // Die zweite Zusage, am Verhalten: genau eine Zeile mehr, und es ist die
      // neue. Eine gekuerzte Position brachte hier die letzte Zeile des ersten
      // Laufs ein zweites Mal mit.
      expect(await forwardedIds(), `Ausgabe: ${second.output().slice(-800)}`)
        .toEqual([...idsBefore, lastAfter.id]);

      expect(await stop(second)).toBe(0);
      // Und dieselbe Liste noch einmal, nachdem der Prozess sauber geendet hat:
      // Danach kann nichts mehr eingereiht werden, eine spaete Wiederholung
      // waere also jetzt zu sehen. Ohne diese zweite Lesung haette die
      // Erwartung darueber nur festgestellt, dass die Wiederholung noch nicht
      // angekommen war.
      expect(await forwardedIds(), "eine Wiederholung kam nach dem Ende des Prozesses an")
        .toEqual([...idsBefore, lastAfter.id]);
      expect((await cursors())[0], "die Position der neuen Zeile wurde nicht festgehalten")
        .toMatchObject({ position: positionAfter, forwarded: true });

      // Was der Prozess ueber sich meldet, ist redigiert: kein Ziel, keine
      // Geheimnisreferenz, keine Adresse.
      for (const runner of [first, second]) {
        expect(runner.output()).not.toContain(actorRef);
        expect(runner.output()).not.toContain("siem.example.com");
        expect(runner.output()).not.toContain(databaseWebhookSecretRef!);
      }
    } finally {
      for (const child of children) child.kill("SIGKILL");
    }
    // 600 Sekunden, wie (2.64): zwei echte Node-Starts mit `tsx`, jeder mit
    // eigener Uebersetzung der Module. Jede einzelne Wartezeit hat trotzdem
    // ihre eigene, engere Frist.
  }, 600_000);
  it("(2.83) answers a real GraphQL query under row security and refuses depth, a table without RLS and an alias trick", async () => {
    // Integrationen -> GraphQL (2.83) gegen die echte Datenbank.
    //
    // Echt ist alles, worauf es ankommt: das Schema und die beiden Tabellen in
    // der echten Projektdatenbank, die echte Policy, die echte Leserolle des
    // Projekts mit ihren echten Rechten, die echte `GeneratedDataApiService`
    // und darueber `ProjectGraphqlService`. Gestellt ist nichts am Lesepfad:
    // Nur die Aufloesung des Ziels und die Verbindung kommen als Stub, weil
    // Katalog und Control Plane eigens zertifiziert sind und dieser Fall nicht
    // von ihnen abhaengen soll.
    //
    // Der Fall prueft sechs Zusagen an einem Stueck:
    //
    // 1. Das Schema entsteht aus dem Katalog.
    // 2. Eine echte Abfrage ueber echte Tabellen liefert genau die Zeilen des
    //    Aufrufers, und zwar dieselben wie der REST-Weg.
    // 3. Der Nachbarmandant sieht mit derselben Abfrage nichts.
    // 4. Eine zu tiefe Abfrage wird abgewiesen.
    // 5. Eine Abfrage auf eine Tabelle ohne Zeilensicherheit wird abgewiesen,
    //    obwohl die Tabelle da ist und die Leserolle sie lesen darf.
    // 6. Eine Abfrage, die ueber Aliasse mehr Felder holt als erlaubt, wird
    //    abgewiesen.
    expect(projectApiUrl, "QKERN_TEST_PROJECT_API_DATABASE_URL fehlt").toBeTruthy();
    const target = new URL(projectApiUrl!);
    const expectedDatabase = target.pathname.slice(1);
    const expectedRole = decodeURIComponent(target.username);

    const schema = `graphql_${randomUUID().replaceAll("-", "_")}`;
    const graphqlProject = randomUUID();
    const graphqlOrganization = randomUUID();
    const scope = { projectId: graphqlProject, environment: "development" as const };
    const mine = randomUUID();
    const neighbour = randomUUID();

    const projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
    try {
      // Eine Tabelle mit Zeilensicherheit, eine ohne. Die zweite ist der
      // Gegenbeweis: Sie existiert, die Leserolle darf sie lesen, und die
      // GraphQL-Flaeche kennt sie trotzdem nicht.
      await owner.query(`CREATE SCHEMA "${schema}"`);
      await owner.query(`CREATE TABLE "${schema}".notizen (
        id uuid PRIMARY KEY,
        besitzer text NOT NULL,
        inhalt text NOT NULL,
        menge integer NOT NULL,
        api_token text NOT NULL)`);
      await owner.query(`ALTER TABLE "${schema}".notizen ENABLE ROW LEVEL SECURITY`);
      await owner.query(`CREATE POLICY eigene_zeilen ON "${schema}".notizen
        FOR SELECT TO ${expectedRole}
        USING (besitzer = current_setting('request.jwt.claim.sub', true))`);
      await owner.query(`CREATE TABLE "${schema}".ohne_rls (
        id uuid PRIMARY KEY, inhalt text NOT NULL)`);
      await owner.query(`INSERT INTO "${schema}".notizen (id, besitzer, inhalt, menge, api_token) VALUES
        ($1, $2, 'meine erste', 7, 'geheim-1'),
        ($3, $2, 'meine zweite', 9, 'geheim-2'),
        ($4, $5, 'die des Nachbarn', 11, 'geheim-3')`,
      [randomUUID(), mine, randomUUID(), randomUUID(), neighbour]);
      await owner.query(`INSERT INTO "${schema}".ohne_rls (id, inhalt) VALUES ($1, 'jeder sieht das')`,
        [randomUUID()]);
      await owner.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${expectedRole}`);
      await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO ${expectedRole}`);

      const connections = { resolve: async () => ({
        pool: projectApi, expectedRole, expectedDatabase, expectedLedgerOwner: "qkern",
      }) };
      const targets = { resolveTarget: async () => ({ databaseInstanceRef: `managed:${graphqlProject}` }) };
      const generated = new GeneratedDataApiService(targets, connections);
      const graphql = new ProjectGraphqlService(generated);
      const contextFor = (subject: string) => ({
        organizationId: graphqlOrganization,
        actorRef: `project-api-key:${subject}`,
        claims: { role: "authenticated" as const, subject },
      });

      // --- Zusage 1: das Schema kommt aus dem Katalog ---------------------
      //
      // Nicht aus einer gepflegten Datei: Die Tabelle steht im Schema, weil sie
      // Zeilensicherheit fuehrt, einen Primaerschluessel hat und die Leserolle
      // sie lesen darf. Die Tabelle ohne Zeilensicherheit steht nicht darin,
      // und die Spalte mit dem Token-Namen auch nicht.
      const described = await graphql.describe(contextFor(mine), scope, schema);
      expect(described.types.map((type) => type.name)).toEqual(["notizen"]);
      expect(described.types[0]!.fields.map((field) => field.name))
        .toEqual(["id", "besitzer", "inhalt", "menge"]);
      expect(described.sdl).toContain(
        "  notizen(limit: Int, orderBy: String, direction: String, where: [String!], after: String): [notizen!]!");
      expect(described.sdl).toContain("  id: ID!");
      expect(described.sdl).toContain("  menge: Int!");
      expect(described.sdl).not.toContain("api_token");
      expect(described.sdl).not.toContain("ohne_rls");
      // Kein Schreibweg im Schema. Was nicht im Schema steht, wird nicht
      // versprochen, und es gibt dahinter auch nichts.
      expect(described.sdl).not.toContain("type Mutation");
      expect(described.sdl).not.toContain("type Subscription");

      // --- Zusage 2: die echte Abfrage unter der Zeilensicherheit ---------
      const query = `query Meine {
        aufsteigend: notizen(orderBy: "menge", direction: "asc", limit: 10) {
          inhalt
          menge
          zweimal: menge
        }
        gefiltert: notizen(where: ["menge:gte:9"]) { inhalt }
      }`;
      const answer = await graphql.execute(contextFor(mine), scope, schema, query);
      expect(answer.operationName).toBe("Meine");
      // Genau die eigenen zwei Zeilen, in der genannten Ordnung. Die Zeile des
      // Nachbarn liegt in derselben Tabelle und kommt nicht mit.
      expect(answer.data.aufsteigend).toEqual([
        { inhalt: "meine erste", menge: 7, zweimal: 7 },
        { inhalt: "meine zweite", menge: 9, zweimal: 9 },
      ]);
      expect(answer.data.gefiltert).toEqual([{ inhalt: "meine zweite" }]);
      expect(answer.fields.map((field) => ({ key: field.responseKey, rows: field.rowCount }))).toEqual([
        { key: "aufsteigend", rows: 2 },
        { key: "gefiltert", rows: 1 },
      ]);
      // Zwei Felder oben, vier Spaltenfelder: der Alias `zweimal` zaehlt mit.
      expect(answer.fieldCount).toBe(6);
      expect(answer.rowBudget).toBe(30);

      // Dieselben Zeilen wie der REST-Weg, mit denselben Anspruechen. Das ist
      // die Zusage "es gibt keinen zweiten Weg": Waere hier ein zweiter, koennte
      // er ein anderes Ergebnis liefern.
      const rest = await generated.listRows(contextFor(mine), scope, {
        schema, table: "notizen", select: ["inhalt", "menge"],
        order: { column: "menge", direction: "asc" }, limit: 10,
      });
      expect(rest.rows).toEqual([
        { inhalt: "meine erste", menge: 7 },
        { inhalt: "meine zweite", menge: 9 },
      ]);

      // --- Zusage 3: der Nachbarmandant sieht nichts ----------------------
      //
      // Dieselbe Abfrage, ein anderes Subjekt. Es gibt keine Zeile fuer dieses
      // Subjekt, also sind beide Listen leer und nicht bloss kuerzer.
      const stranger = await graphql.execute(contextFor(randomUUID()), scope, schema, query);
      expect(stranger.data.aufsteigend).toEqual([]);
      expect(stranger.data.gefiltert).toEqual([]);
      // Und der Nachbar, dem eine Zeile gehoert, sieht genau seine. Ohne diese
      // Gegenprobe koennte die leere Liste oben auch aus einer kaputten Abfrage
      // kommen, die fuer niemanden etwas findet.
      const neighbourAnswer = await graphql.execute(contextFor(neighbour), scope, schema, query);
      expect(neighbourAnswer.data.aufsteigend).toEqual([
        { inhalt: "die des Nachbarn", menge: 11, zweimal: 11 },
      ]);

      // --- Zusage 4: die zu tiefe Abfrage ---------------------------------
      //
      // Zwei Ebenen gibt es: die Tabelle und ihre Spalten. Eine dritte waere
      // eine Beziehung, und Beziehungen gibt es an dieser Flaeche nicht.
      await expect(graphql.execute(contextFor(mine), scope, schema,
        "{ notizen { inhalt { laenge } } }"))
        .rejects.toMatchObject({ name: "ProjectGraphqlError", reason: "depth_exceeded" });

      // --- Zusage 5: die Tabelle ohne Zeilensicherheit --------------------
      //
      // Zuerst der Beweis, dass sie wirklich da ist und die Leserolle sie
      // wirklich lesen darf: Sonst pruefte die Ablehnung gleich danach nur,
      // dass ein Name nicht existiert.
      const direct = await projectApi.query<{ inhalt: string }>(
        `SELECT inhalt FROM "${schema}".ohne_rls`);
      expect(direct.rows.map((row) => row.inhalt)).toEqual(["jeder sieht das"]);
      // Die Data API weist sie mit ihrem eigenen Grund ab.
      await expect(generated.listRows(contextFor(mine), scope, { schema, table: "ohne_rls" }))
        .rejects.toMatchObject({ code: "GENERATED_DATA_API_RLS_REQUIRED" });
      // Die GraphQL-Flaeche kennt den Namen gar nicht. Sie sagt bewusst nicht,
      // dass die Tabelle ohne Zeilensicherheit existiert: Der Unterschied
      // verriete eine Tabelle, die dieser Aufrufer nicht lesen darf.
      await expect(graphql.execute(contextFor(mine), scope, schema, "{ ohne_rls { inhalt } }"))
        .rejects.toMatchObject({ name: "ProjectGraphqlError", reason: "unknown_table", at: "ohne_rls" });
      // Und die sensible Spalte ist auch ueber GraphQL kein Feld.
      await expect(graphql.execute(contextFor(mine), scope, schema, "{ notizen { api_token } }"))
        .rejects.toMatchObject({ reason: "unknown_field", at: "notizen.api_token" });

      // --- Zusage 6: der Aliasstreich -------------------------------------
      //
      // Aliasse sind erlaubt, sonst waere dieselbe Tabelle nicht zweimal
      // abfragbar. Sie zaehlen aber einzeln: Ein Alias erzeugt ein Feld in der
      // Antwort, und die Grenze gilt fuer Felder und nicht fuer Namen.
      const overBudget = Array.from(
        { length: DATA_API_GRAPHQL_LIMITS.maxFields },
        (_, index) => `a${index}: menge`,
      ).join(" ");
      await expect(graphql.execute(contextFor(mine), scope, schema, `{ notizen { ${overBudget} } }`))
        .rejects.toMatchObject({ name: "ProjectGraphqlError", reason: "fields_exceeded" });
      // Einer weniger, und genau derselbe Streich geht durch: Die Grenze liegt
      // an der Zahl und nicht daran, dass Aliasse verboten waeren. Ohne diese
      // Gegenprobe koennte die Ablehnung oben auch aus einem Verbot kommen.
      const atBudget = Array.from(
        { length: DATA_API_GRAPHQL_LIMITS.maxFields - 1 },
        (_, index) => `a${index}: menge`,
      ).join(" ");
      const accepted = await graphql.execute(contextFor(mine), scope, schema, `{ notizen { ${atBudget} } }`);
      expect(accepted.fieldCount).toBe(DATA_API_GRAPHQL_LIMITS.maxFields);
      const firstRow = accepted.data.notizen?.[0];
      expect(accepted.data.notizen).toHaveLength(2);
      expect(Object.keys(firstRow ?? {})).toHaveLength(DATA_API_GRAPHQL_LIMITS.maxFields - 1);
      // Gelesen wurde die Spalte trotzdem genau einmal, und jeder Alias traegt
      // denselben Wert.
      expect(new Set(Object.values(firstRow ?? {}))).toEqual(new Set([7]));
    } finally {
      await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await projectApi.end();
    }
  }, 120_000);

  it("(2.82) issues an OAuth code with PKCE, redeems it once, reads with the token under row security and refuses replay, a wrong verifier, a foreign return target and an ungranted scope", async () => {
    // Der OAuth-Server (2.82) an einem Stueck, gegen die echte Datenbank: echter
    // Nutzer, echte Anmeldung, echter Client in project_auth_oauth_clients,
    // echter Code in project_auth_oauth_codes, echtes Token in
    // project_auth_oauth_tokens, echte Lesung durch die generierte Data API
    // unter der Zeilensicherheit.
    //
    // Echt ist alles, worauf es ankommt: die drei Tabellen aus Migration 0062,
    // das PostgreSQL-Repository von Project Auth, der Audit-Sink in der
    // Hash-Kette, das reine Modul `oauth.ts`, der Weg
    // `projectApplicationPrincipal`, den die Data-API-Routen wirklich nehmen,
    // die echte Projektdatenbank mit echter Policy und die echte
    // `GeneratedDataApiService`.
    //
    // Gestellt ist genau eines: der Key-Dienst. Welcher Public Key gueltig ist,
    // ist eigens zertifiziert, und dieser Fall soll nicht davon abhaengen; dass
    // ein Key **verlangt** wird, prueft er trotzdem.
    //
    // Eigene Organisation mit eigenem Besitzer, wie 2.80: Jede Aenderung
    // schreibt eine Audit-Zeile, und eine Organisation mit Audit-Zeilen laesst
    // sich wegen audit_logs_organization_id_fkey nicht mehr loeschen.
    expect(projectApiUrl, "QKERN_TEST_PROJECT_API_DATABASE_URL fehlt").toBeTruthy();
    const target = new URL(projectApiUrl!);
    const expectedDatabase = target.pathname.slice(1);
    const expectedRole = decodeURIComponent(target.username);

    const oauthOwner = randomUUID();
    const oauthOrganization = randomUUID();
    const oauthProject = randomUUID();
    const schema = `oauthserver_${randomUUID().replaceAll("-", "_")}`;
    const scope = {
      organizationId: oauthOrganization, projectId: oauthProject, environment: "development" as const,
    };
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [oauthOwner, `oauth-owner-${oauthOwner}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'OAuth Server 2.82', $2, $3)`,
    [oauthOrganization, `oauth-server-${oauthOrganization}`, oauthOwner]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'OAuth Server 2.82', $3, 'test', 'ready', $4)`,
    [oauthProject, oauthOrganization, `oauth-server-${oauthProject}`, oauthOwner]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [oauthOrganization, oauthProject, `managed:${oauthProject}`]);

    const signingKey = generateKeyPairSync("ed25519").privateKey;
    const service = new ProjectAuthService({
      repository: new PostgresProjectAuthRepository(auth),
      audit: new PostgresProjectAuthAuditSink(auth),
      passwords: new Argon2idPasswordHasher({}),
      rateLimiter: new InMemoryRateLimiter(),
      tokens: new ProjectAuthTokenService({ kid: "certification-2-82", privateKey: signingKey }, "https://qkern.test"),
      mfa: new ProjectAuthTotp(),
      secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 11)),
      delivery: new NoopDevelopmentProjectAuthDelivery(),
      oidcCatalog: new ProjectAuthOidcCatalog([]),
      oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
      callbackBaseUrl: "https://qkern.test",
      allowedRedirectOrigins: new Set(["https://app.test"]),
      exposeDeliveryTokens: true,
    });

    // Der Prueftext und seine Pruefsumme, von aussen gerechnet. Der Fall darf
    // die Pruefsumme nicht von QKERN rechnen lassen, sonst pruefte er die
    // Pruefung gegen ihren eigenen Aufbau; gerechnet wird darum hier, mit
    // `node:crypto` und nichts weiter, so wie eine Anwendung es tun wuerde.
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
    expect(verifier).toMatch(/^[A-Za-z0-9._~-]{43}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const strangerVerifier = randomBytes(32).toString("base64url");
    expect(strangerVerifier).not.toBe(verifier);

    const home = "https://app.test/oauth/zurueck";
    const second = "https://app.test/oauth/zweitweg";
    const projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
    try {
      // --- Zusage 1: der Nutzer, der zustimmt, ist ein echter -------------
      const email = `oauth-user-${randomUUID()}@example.test`;
      const signup = await service.signUp(scope, {
        email, password: "a sufficiently long certification password",
        redirectTo: "https://app.test/willkommen", rateLimitKey: randomUUID(),
      });
      const signedIn = await service.consumeEmailToken(scope, {
        token: signup.debugToken!, purpose: "email_verification",
      });
      if ("mfaRequired" in signedIn) throw new Error("unexpected MFA");
      const userId = (await service.verifyAccess(scope, signedIn.accessToken)).user.id;

      // --- Zusage 2: was kein Client werden darf --------------------------
      //
      // Jede Ablehnung mit eigenem Grund, weil sie verschiedene Dinge sagen.
      // Ein Stern ist der Versuch, eine Gruppe von Zielen zu erlauben; eine
      // Abfrage waere in zwei Schreibweisen zweimal derselbe Ort; `http` auf
      // einem fremden Host ist ein Code im Klartext auf der Leitung.
      const refusedClient = (client: unknown) =>
        service.createOAuthClient(scope, client, { id: oauthOwner });
      await expect(refusedClient({
        name: "stern", redirectUris: ["https://app.test/*"], scopes: ["data:read"],
      })).rejects.toMatchObject({
        name: "ProjectAuthOAuthError", reason: "redirect_uri_wildcard", field: "redirectUris",
      });
      await expect(refusedClient({
        name: "abfrage", redirectUris: ["https://app.test/zurueck?weiter=ja"], scopes: ["data:read"],
      })).rejects.toMatchObject({ reason: "redirect_uri_carries_query", field: "redirectUris" });
      await expect(refusedClient({
        name: "unsicher", redirectUris: ["http://fremd.example.com/zurueck"], scopes: ["data:read"],
      })).rejects.toMatchObject({ reason: "redirect_uri_insecure_scheme", field: "redirectUris" });
      await expect(refusedClient({
        name: "alles", redirectUris: [home], scopes: ["data:read", "alles:lesen"],
      })).rejects.toMatchObject({ reason: "scope_unknown", field: "scopes" });

      // --- Zusage 3: der Client entsteht wirklich, und ohne Geheimnis -----
      const stored = await service.createOAuthClient(scope, {
        name: "ai-bridge", redirectUris: [home, second], scopes: ["identity:read", "data:read"],
      }, { id: oauthOwner });
      expect(stored.configured).toBe(true);
      expect(stored.role).toBe("authenticated");
      expect(stored.forbiddenRole).toBe("service_role");
      expect(stored.grant).toBe("authorization_code");
      expect(stored.challengeMethod).toBe("S256");
      expect(stored.scopes).toEqual(["identity:read", "data:read", "data:write"]);
      // Die nicht gebauten Verfahren kommen aus dem Dienst und nicht aus diesem
      // Fall. Dass `implicit` und `password` darin stehen, ist die Aussage:
      // Sie sind benannt und nicht bloss vergessen.
      expect(stored.unsupportedGrants).toEqual(
        ["implicit", "password", "client_credentials", "refresh_token"],
      );
      expect(stored.clients).toHaveLength(1);
      const clientId = stored.clients[0].id;
      expect(clientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(stored.clients[0]).toMatchObject({
        name: "ai-bridge", redirectUris: [home, second], scopes: ["identity:read", "data:read"],
      });
      // Es gibt keine Spalte fuer ein Geheimnis, und das ist die Zusage dieses
      // Schnittes. Geprueft wird sie am Katalog und nicht an der Antwort: Eine
      // Antwort ohne Feld koennte ein weggelassenes Feld sein, eine Tabelle
      // ohne Spalte kann kein Geheimnis halten.
      const columns = await owner.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'project_auth_oauth_clients'`);
      const columnNames = columns.rows.map((row) => String(row.column_name));
      expect(columnNames).toContain("redirect_uris");
      expect(columnNames.filter((column) => column.includes("secret"))).toEqual([]);
      // Kein Recht zum Aendern, genau wie 0062 es sagt.
      await expect(auth.query(
        `UPDATE project_auth_oauth_clients SET scopes = ARRAY['data:write']::text[] WHERE id = $1`,
        [clientId])).rejects.toThrowError(/permission denied/i);
      // Und `plain` kommt nicht einmal an der Datenbank vorbei.
      await expect(auth.query(`INSERT INTO project_auth_oauth_codes
        (id, organization_id, project_id, environment, client_id, auth_user_id, redirect_uri,
         scopes, code_hash, code_challenge, code_challenge_method, expires_at)
        VALUES ($1,$2,$3,'development',$4,$5,$6,ARRAY['data:read']::text[],$7,$8,'plain',now() + interval '1 minute')`,
      [randomUUID(), oauthOrganization, oauthProject, clientId, userId, home,
        `direkt-${randomUUID()}`, challenge])).rejects.toMatchObject({ code: "23514" });

      // --- Zusage 4: was kein Code werden darf ----------------------------
      const refusedAuthorize = (request: unknown) =>
        service.authorizeOAuth(scope, signedIn.accessToken, request);
      // Ein fremdes Ruecksprungziel, das der Client nicht fuehrt.
      await expect(refusedAuthorize({
        clientId: "ai-bridge", redirectUri: "https://angreifer.test/zurueck",
        scopes: ["data:read"], codeChallenge: challenge,
      })).rejects.toMatchObject({ reason: "redirect_uri_unknown", field: "redirectUri" });
      // Ein Bereich, den dieser Client nicht fuehrt. Keine stille Kuerzung.
      await expect(refusedAuthorize({
        clientId: "ai-bridge", redirectUri: home,
        scopes: ["data:read", "data:write"], codeChallenge: challenge,
      })).rejects.toMatchObject({ reason: "scope_not_granted", field: "scopes" });
      // `plain` faellt mit eigenem Grund, und der implizite Ablauf auch.
      await expect(refusedAuthorize({
        clientId: "ai-bridge", redirectUri: home, scopes: ["data:read"],
        codeChallenge: challenge, codeChallengeMethod: "plain",
      })).rejects.toMatchObject({ reason: "challenge_method_unsupported" });
      await expect(refusedAuthorize({
        clientId: "ai-bridge", redirectUri: home, scopes: ["data:read"],
        codeChallenge: challenge, responseType: "token",
      })).rejects.toMatchObject({ reason: "response_type_unsupported", field: "responseType" });
      // Und ohne gueltiges Zugangstoken des Nutzers gibt es gar keinen Anlauf.
      await expect(service.authorizeOAuth(scope, "nicht.mein.token", {
        clientId: "ai-bridge", redirectUri: home, scopes: ["data:read"], codeChallenge: challenge,
      })).rejects.toMatchObject({ code: "INVALID_TOKEN" });
      // Bis hierher steht keine einzige Code-Zeile in der Datenbank.
      const codeCount = async () => (await auth.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM project_auth_oauth_codes
          WHERE organization_id = $1 AND project_id = $2`,
        [oauthOrganization, oauthProject])).rows[0].count;
      expect(await codeCount()).toBe("0");

      // --- Zusage 5: der falsche Prueftext faellt, und verbraucht den Code -
      //
      // Der wichtigere Teil ist der zweite Satz. Der Code ist danach weg,
      // obwohl die Pruefung gescheitert ist: Wer ihn erst nach erfolgreicher
      // Pruefung verbrauchte, liesse beliebig viele Versuche zu.
      const wrongVerifierAttempt = await service.authorizeOAuth(scope, signedIn.accessToken, {
        clientId: "ai-bridge", redirectUri: home, scopes: ["data:read"], codeChallenge: challenge,
      });
      expect(wrongVerifierAttempt.code).toMatch(/^qk_oauthcode_[A-Za-z0-9_-]{43}$/);
      await expect(service.exchangeOAuthCode(scope, {
        clientId: "ai-bridge", code: wrongVerifierAttempt.code, redirectUri: home,
        codeVerifier: strangerVerifier,
      })).rejects.toMatchObject({ code: "INVALID_TOKEN" });
      // Derselbe Code, jetzt mit dem richtigen Prueftext: trotzdem vorbei.
      await expect(service.exchangeOAuthCode(scope, {
        clientId: "ai-bridge", code: wrongVerifierAttempt.code, redirectUri: home,
        codeVerifier: verifier,
      })).rejects.toMatchObject({ code: "TOKEN_REPLAYED" });

      // --- Zusage 6: ein fremdes Ruecksprungziel beim Einloesen -----------
      //
      // Beide Ziele gehoeren dem Client; nur gehoert das zweite nicht zu
      // diesem Code. Ohne die Bindung waere ein Code, der an einem Ziel
      // abgefangen wurde, an jedem anderen Ziel desselben Clients einloesbar.
      const boundToHome = await service.authorizeOAuth(scope, signedIn.accessToken, {
        clientId: "ai-bridge", redirectUri: home, scopes: ["data:read"], codeChallenge: challenge,
      });
      await expect(service.exchangeOAuthCode(scope, {
        clientId: "ai-bridge", code: boundToHome.code, redirectUri: second, codeVerifier: verifier,
      })).rejects.toMatchObject({ code: "INVALID_TOKEN" });

      // --- Zusage 7: der ganze Ablauf, und er endet in einem Token --------
      const granted = await service.authorizeOAuth(scope, signedIn.accessToken, {
        clientId: "ai-bridge", redirectUri: home, scopes: ["data:read", "identity:read"],
        codeChallenge: challenge, state: "zustand-2-82",
      });
      // Der `state` kommt unveraendert zurueck, und das Ziel auch: Genau daraus
      // baut die Anwendung ihre Adresse selbst, weil QKERN keinen 302 schickt.
      expect(granted.state).toBe("zustand-2-82");
      expect(granted.redirectUri).toBe(home);
      // Die Reihenfolge der Bereiche kommt aus der Liste und nicht aus der
      // Eingabe: Dieselbe Erlaubnis soll ueberall gleich aussehen.
      expect(granted.scopes).toEqual(["identity:read", "data:read"]);
      const codeRow = await auth.query<{ consumed: boolean; method: string; challenge: string }>(
        `SELECT consumed_at IS NOT NULL AS consumed, code_challenge_method AS method,
                code_challenge AS challenge
           FROM project_auth_oauth_codes
          WHERE organization_id = $1 AND project_id = $2 AND redirect_uri = $3 AND consumed_at IS NULL`,
        [oauthOrganization, oauthProject, home]);
      expect(codeRow.rows).toHaveLength(1);
      expect(codeRow.rows[0]).toMatchObject({ consumed: false, method: "S256", challenge });

      const issued = await service.exchangeOAuthCode(scope, {
        clientId: "ai-bridge", code: granted.code, redirectUri: home, codeVerifier: verifier,
      });
      expect(issued.accessToken).toMatch(/^qk_oauth_[A-Za-z0-9_-]{43}$/);
      expect(issued).toMatchObject({
        tokenType: "Bearer", expiresIn: 3_600, clientName: "ai-bridge",
        scopes: ["identity:read", "data:read"],
      });
      // Kein Refresh Token, auch nicht als leeres Feld.
      expect(issued).not.toHaveProperty("refreshToken");
      // Das Token ist nicht das Sitzungstoken der Anmeldung, und es ist auch
      // kein JWT: kein Punkt, keine drei Teile, keine Unterschrift.
      expect(issued.accessToken).not.toBe(signedIn.accessToken);
      expect(issued.accessToken.includes(".")).toBe(false);
      // Und es steht nicht im Klartext in der Datenbank.
      const tokenRows = await auth.query<{ hash: string; scopes: string[] }>(
        `SELECT token_hash AS hash, scopes FROM project_auth_oauth_tokens
          WHERE organization_id = $1 AND project_id = $2`, [oauthOrganization, oauthProject]);
      expect(tokenRows.rows).toHaveLength(1);
      expect(tokenRows.rows[0].hash).not.toBe(issued.accessToken);
      expect(tokenRows.rows[0].hash).toBe(hashProjectAuthToken(issued.accessToken));
      expect(tokenRows.rows[0].scopes).toEqual(["identity:read", "data:read"]);

      // --- Zusage 8: das zweite Einloesen ist ein Wiedereinspielangriff ---
      await expect(service.exchangeOAuthCode(scope, {
        clientId: "ai-bridge", code: granted.code, redirectUri: home, codeVerifier: verifier,
      })).rejects.toMatchObject({ code: "TOKEN_REPLAYED" });
      // Und es ist dabei kein zweites Token entstanden.
      expect((await auth.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM project_auth_oauth_tokens
          WHERE organization_id = $1 AND project_id = $2`,
        [oauthOrganization, oauthProject])).rows[0].count).toBe("1");

      // --- Zusage 9: was das Token umfasst --------------------------------
      const verified = await service.verifyOAuthToken(scope, issued.accessToken);
      expect(verified.ok).toBe(true);
      if (!verified.ok) throw new Error("unerreichbar");
      expect(verified.identity).toMatchObject({
        clientName: "ai-bridge", userId, email, role: "authenticated",
        scopes: ["identity:read", "data:read"],
      });
      // Die Rolle kommt aus dem Dienst und nicht aus einer Zeile: Es gibt in
      // dieser Tabelle keine Spalte, die `service_role` tragen koennte.
      const tokenColumns = await owner.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'project_auth_oauth_tokens'`);
      expect(tokenColumns.rows.map((row) => String(row.column_name))).not.toContain("role");

      // --- Zusage 10: die echte Lesung durch die Data API unter RLS -------
      //
      // Die Policy nennt beides: den Anspruch `sub` und den Anspruch
      // `client_id` aus `request.jwt.claims`. Damit prueft dieser Fall nicht
      // nur, dass etwas gelesen wird, sondern dass genau die Ansprueche eines
      // OAuth-Tokens auf demselben Weg ankommen wie die eines eigenen.
      await owner.query(`CREATE SCHEMA "${schema}"`);
      await owner.query(`CREATE TABLE "${schema}".notizen (
        id uuid PRIMARY KEY, besitzer text NOT NULL, quelle text NOT NULL, inhalt text NOT NULL)`);
      await owner.query(`ALTER TABLE "${schema}".notizen ENABLE ROW LEVEL SECURITY`);
      await owner.query(`CREATE POLICY eigener_client ON "${schema}".notizen
        FOR SELECT TO ${expectedRole} USING (
          besitzer = current_setting('request.jwt.claim.sub', true) AND
          quelle = (current_setting('request.jwt.claims', true)::jsonb ->> 'client_id'))`);
      await owner.query(`INSERT INTO "${schema}".notizen (id, besitzer, quelle, inhalt) VALUES
        ($1, $2, 'ai-bridge', 'meine ueber die Bruecke'),
        ($3, $2, 'eine-andere-app', 'dasselbe Subjekt, anderer Client'),
        ($4, $5, 'ai-bridge', 'fremdes Subjekt, gleicher Client')`,
      [randomUUID(), userId, randomUUID(), randomUUID(), randomUUID()]);
      await owner.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${expectedRole}`);
      await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO ${expectedRole}`);

      const keyPrincipal = {
        id: randomUUID(), organizationId: oauthOrganization, projectId: oauthProject,
        environment: "development" as const, kind: "public" as const,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      };
      const keys = {
        authenticate: async (secret: string) => secret === "qk_public_2_82" ? keyPrincipal : null,
      } as unknown as ProjectApiKeyService;
      const dataRequest = (token: string, withKey = true) => new NextRequest(
        "https://qkern.test/api/v1/projects/x/environments/development/data",
        { headers: withKey
          ? { authorization: `Bearer ${token}`, "x-qkern-key": "qk_public_2_82" }
          : { authorization: `Bearer ${token}` } },
      );
      const principal = await projectApplicationPrincipal(
        dataRequest(issued.accessToken),
        { projectId: oauthProject, environment: "development" }, keys, service, "read",
      );
      expect(principal).not.toBeNull();
      expect(principal!.role).toBe("authenticated");
      expect(principal!.subject).toBe(userId);
      expect(principal!.actorRef).toBe(`project-auth-oauth:ai-bridge:${userId}`);
      // Kein erfundenes aal, keine erfundene Sitzung: Ein OAuth-Token haengt an
      // keiner Sitzung, und QKERN weiss nicht, wie sich dieser Mensch zuletzt
      // angemeldet hat.
      expect(principal!.claims.assurance).toBeUndefined();
      expect(principal!.claims.sessionId).toBeUndefined();
      expect(principal!.claims.external).toEqual({
        token_use: "oauth", client_id: "ai-bridge", scope: "identity:read data:read",
      });

      const connections = { resolve: async () => ({
        pool: projectApi, expectedRole, expectedDatabase, expectedLedgerOwner: "qkern",
      }) };
      const targets = { resolveTarget: async () => ({ databaseInstanceRef: `managed:${oauthProject}` }) };
      const generated = new GeneratedDataApiService(targets, connections);
      const rows = await generated.listRows(
        { organizationId: principal!.organizationId, actorRef: principal!.actorRef, claims: principal!.claims },
        { projectId: oauthProject, environment: "development" },
        { schema, table: "notizen" },
      );
      // Genau eine Zeile: die mit demselben Subjekt **und** demselben Client.
      // Die anderen zwei belegen, dass beide Ansprueche wirklich wirken und
      // nicht bloss einer davon gesetzt ist.
      expect(rows.rows.map((row) => row.inhalt)).toEqual(["meine ueber die Bruecke"]);

      // --- Zusage 11: der nicht zugestimmte Bereich --------------------
      //
      // Dasselbe Token, dieselbe Tuer, nur schreibend. `data:write` steht weder
      // am Client noch am Token, also faellt die Anfrage, bevor die Datenbank
      // sie sieht.
      await expect(projectApplicationPrincipal(
        dataRequest(issued.accessToken),
        { projectId: oauthProject, environment: "development" }, keys, service, "write",
      )).rejects.toThrowError();
      // Und an einer Tuer, die keine OAuth-Token annimmt (Queues, Functions),
      // faellt es ebenfalls. Das ist die Vorgabe und keine Einstellung.
      await expect(projectApplicationPrincipal(
        dataRequest(issued.accessToken),
        { projectId: oauthProject, environment: "development" }, keys, service,
      )).rejects.toThrowError();
      // Ohne Public Key gibt es diesen Weg nicht, auch nicht mit gueltigem Token.
      await expect(projectApplicationPrincipal(
        dataRequest(issued.accessToken, false),
        { projectId: oauthProject, environment: "development" }, keys, service, "read",
      )).rejects.toThrowError();

      // --- Zusage 12: das Entfernen nimmt das Token mit -------------------
      const after = await service.deleteOAuthClient(scope, clientId, { id: oauthOwner });
      expect(after.clients).toEqual([]);
      expect(after.configured).toBe(false);
      // Dasselbe Token, das eben noch gelesen hat, gilt nicht mehr.
      await expect(service.verifyOAuthToken(scope, issued.accessToken))
        .resolves.toMatchObject({ ok: false, reason: "unknown" });
      // Und die Zeilen sind wirklich weg, nicht bloss unerreichbar.
      expect((await auth.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM project_auth_oauth_tokens
          WHERE organization_id = $1 AND project_id = $2`,
        [oauthOrganization, oauthProject])).rows[0].count).toBe("0");
      expect(await codeCount()).toBe("0");

      // --- Zusage 13: die Spur traegt weder Code noch Token ---------------
      const auditRows = await owner.query<{ action: string; metadata: string }>(
        `SELECT action, redacted_metadata::text AS metadata FROM audit_logs
          WHERE organization_id = $1`, [oauthOrganization]);
      const actions = auditRows.rows.map((row) => String(row.action));
      expect(actions).toContain("project_auth.oauth_client.created");
      expect(actions).toContain("project_auth.oauth_code.issued");
      expect(actions).toContain("project_auth.oauth_token.issued");
      expect(actions).toContain("project_auth.oauth_token.refused");
      expect(actions).toContain("project_auth.oauth_client.removed");
      const serialised = JSON.stringify(auditRows.rows);
      expect(serialised).not.toContain(issued.accessToken);
      expect(serialised).not.toContain(granted.code);
      expect(serialised).not.toContain(verifier);
      expect(serialised).not.toContain(challenge);
      expect(serialised).not.toContain("service_role");
    } finally {
      await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await projectApi.end();
    }
  }, 120_000);

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


/**
 * Die Ansprueche eines echten Access Token, von aussen gelesen (2.77).
 *
 * Der Fall darf nicht bloss glauben, dass ein Hook gewirkt hat: Er schaut in
 * das signierte Token. Geprueft wird die Unterschrift dabei nicht hier, sondern
 * eine Zeile weiter durch `verifyAccess` desselben Dienstes.
 */
function claimsOf(accessToken: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
}

/**
 * Ein echtes Token eines fremden Ausstellers (2.80), von aussen gebaut.
 *
 * Der Fall darf das Token nicht von QKERN bauen lassen, sonst prueft er die
 * Pruefung gegen ihren eigenen Aufbau. Gebaut wird darum hier, mit
 * `node:crypto` und nichts weiter, so wie ein fremder Dienst es tun wuerde.
 *
 * `exp` und `iat` haben eine Vorgabe, weil fast jeder Fall ein gueltiges Token
 * will; wer den Ablauf prueft, gibt sie selbst an und ueberschreibt sie damit.
 */
function foreignToken(input: {
  privateKey: import("node:crypto").KeyObject;
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
}): string {
  const seconds = Math.floor(Date.now() / 1000);
  const encodedHeader = base64url(input.header);
  const encodedClaims = base64url({ iat: seconds, exp: seconds + 600, ...input.claims });
  const signature = sign("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedClaims}`, "utf8"), input.privateKey);
  return `${encodedHeader}.${encodedClaims}.${signature.toString("base64url")}`;
}

/** Ein JSON-Teil eines JWT, so wie er im Token steht. */
function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
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

/**
 * Der Authenticator und der Browser, nachgebaut (2.79).
 *
 * Diese vier Funktionen sind der einzige gestellte Teil des Falles: Ein echter
 * Authenticator laesst sich in einem Container nicht anschliessen, und ein
 * Browser auch nicht. Was sie erzeugen, ist trotzdem echt — CBOR nach der
 * Spezifikation, eine echte ECDSA-Unterschrift ueber genau die Bytes, die
 * WebAuthn vorschreibt. Sie sind bewusst hier und nicht im Produktcode: Der
 * Produktcode liest nur, und ein Erzeuger im Produkt waere ein Erzeuger, den
 * niemand braucht und der jede Pruefung von innen kennt.
 */

/** Eine CBOR-Karte mit fester Laenge, wie CTAP2 sie verlangt. */
function certificationCborMap(entries: Array<[Buffer, Buffer]>): Buffer {
  return Buffer.concat([
    certificationCborHead(5, entries.length),
    ...entries.flatMap(([key, value]) => [key, value]),
  ]);
}

/** Der Kopf eines CBOR-Wertes: Haupttyp und Laenge oder Zahl. */
function certificationCborHead(major: number, value: number): Buffer {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 256) return Buffer.from([(major << 5) | 24, value]);
  const head = Buffer.alloc(3);
  head[0] = (major << 5) | 25;
  head.writeUInt16BE(value, 1);
  return head;
}

function certificationCborUnsigned(value: number): Buffer {
  return certificationCborHead(0, value);
}

function certificationCborNegative(value: number): Buffer {
  return certificationCborHead(1, -1 - value);
}

function certificationCborBytes(value: Buffer): Buffer {
  return Buffer.concat([certificationCborHead(2, value.length), value]);
}

function certificationCborText(value: string): Buffer {
  const encoded = Buffer.from(value, "utf8");
  return Buffer.concat([certificationCborHead(3, encoded.length), encoded]);
}

/**
 * Der oeffentliche Schluessel als COSE-Karte: kty 2 (EC2), alg -7 (ES256),
 * crv 1 (P-256) und die beiden Koordinaten zu je 32 Byte.
 */
function certificationCoseKey(x: Buffer, y: Buffer): Buffer {
  return certificationCborMap([
    [certificationCborUnsigned(1), certificationCborUnsigned(2)],
    [certificationCborUnsigned(3), certificationCborNegative(-7)],
    [certificationCborNegative(-1), certificationCborUnsigned(1)],
    [certificationCborNegative(-2), certificationCborBytes(x)],
    [certificationCborNegative(-3), certificationCborBytes(y)],
  ]);
}

/**
 * `authenticatorData` nach der Spezifikation. Mit `credentialId` und `coseKey`
 * entsteht die Form der Registrierung (Bit 6 gesetzt, danach die Daten des
 * Schluessels), ohne sie die der Anmeldung.
 *
 * Die Flags sind 0x01 (Nutzer anwesend) und 0x04 (Nutzer bestaetigt); bei der
 * Registrierung kommt 0x40 dazu.
 */
function certificationAuthenticatorData(input: {
  rpIdHash: Buffer;
  signCount: number;
  credentialId?: Buffer;
  coseKey?: Buffer;
}): Buffer {
  const attested = Boolean(input.credentialId && input.coseKey);
  const header = Buffer.alloc(5);
  header[0] = 0x01 | 0x04 | (attested ? 0x40 : 0);
  header.writeUInt32BE(input.signCount, 1);
  if (!attested) return Buffer.concat([input.rpIdHash, header]);
  const credentialIdLength = Buffer.alloc(2);
  credentialIdLength.writeUInt16BE(input.credentialId!.length);
  return Buffer.concat([
    input.rpIdHash, header,
    // Die AAGUID. Null heisst "kein Kennzeichen des Modells", und genau das
    // schicken Plattform-Authenticatoren ohne Attestation.
    Buffer.alloc(16, 0),
    credentialIdLength, input.credentialId!, input.coseKey!,
  ]);
}

/** Das Attestation-Objekt mit `fmt: "none"`, wie es eine Plattform schickt. */
function certificationAttestationObject(input: {
  rpIdHash: Buffer;
  signCount: number;
  credentialId: Buffer;
  coseKey: Buffer;
}): Buffer {
  return certificationCborMap([
    [certificationCborText("fmt"), certificationCborText("none")],
    [certificationCborText("attStmt"), certificationCborMap([])],
    [certificationCborText("authData"), certificationCborBytes(
      certificationAuthenticatorData(input),
    )],
  ]);
}

/** Die `clientDataJSON`, wie der Browser sie zusammensetzt. */
function certificationClientData(input: {
  type: "webauthn.create" | "webauthn.get";
  challenge: string;
  origin: string;
}): Buffer {
  return Buffer.from(JSON.stringify({
    type: input.type, challenge: input.challenge, origin: input.origin, crossOrigin: false,
  }), "utf8");
}

/**
 * Eine echte Anmeldeantwort: `authenticatorData`, `clientDataJSON` und die
 * ECDSA-Unterschrift ueber `authenticatorData || sha256(clientDataJSON)`.
 *
 * Das ist genau die Rechnung, die die Spezifikation vorschreibt, und genau die,
 * die der Dienst nachrechnet. Steht hier ein Byte anders, faellt die Pruefung —
 * und das ist der Punkt: Der Fall belegt nicht, dass der Dienst irgendetwas
 * annimmt, sondern dass er diese Rechnung annimmt und keine andere.
 */
function certificationAssertion(input: {
  privateKey: KeyObject;
  rpIdHash: Buffer;
  signCount: number;
  challenge: string;
  origin: string;
}): { authenticatorData: string; clientDataJSON: string; signature: string } {
  const authenticatorData = certificationAuthenticatorData({
    rpIdHash: input.rpIdHash, signCount: input.signCount,
  });
  const clientDataJSON = certificationClientData({
    type: "webauthn.get", challenge: input.challenge, origin: input.origin,
  });
  const signed = Buffer.concat([
    authenticatorData, createHash("sha256").update(clientDataJSON).digest(),
  ]);
  const signature = createSign("sha256").update(signed).sign(input.privateKey);
  return {
    authenticatorData: authenticatorData.toString("base64url"),
    clientDataJSON: clientDataJSON.toString("base64url"),
    signature: signature.toString("base64url"),
  };
}
