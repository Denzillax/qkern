import type { SqlPool, SqlPoolClient } from "@/lib/server/db/sql";
import {
  assertProjectDatabaseExecutionInput,
  assertProjectDatabaseReconciliationInput,
  ProjectDatabaseExecutionError,
  type ProjectDatabaseExecutionInput,
  type ProjectDatabaseExecutionResult,
  type ProjectDatabaseExecutor,
  type ProjectDatabaseReconciliationInput,
  type ProjectDatabaseReconciliationResult,
} from "@/lib/server/migrations/executor";

export interface ProjectDatabaseConnectionResolver {
  /** Resolve only a trusted opaque catalog reference; never accept a URL from a request or job payload. */
  resolve(databaseInstanceRef: string): Promise<ResolvedProjectDatabaseConnection> | ResolvedProjectDatabaseConnection;
}

export type ResolvedProjectDatabaseConnection = {
  pool: SqlPool;
  /** Exact least-privilege login expected for this catalog entry. */
  expectedRole: string;
  /** Exact database name expected for this immutable catalog entry. */
  expectedDatabase: string;
  /** Exact non-login owner expected for the protected ledger objects. */
  expectedLedgerOwner: string;
};

type PostgresFailure = Error & { code?: string };
const SAFE_RETRY_CODES = new Set(["40001", "40P01", "55P03", "57014"]);

/**
 * Transactional PostgreSQL executor with a target-side SHA-256 ledger. Runtime
 * wiring deliberately remains disabled until a trusted catalog resolver and a
 * least-privilege project migration role are deployed.
 */
export class PostgresProjectDatabaseExecutor implements ProjectDatabaseExecutor {
  constructor(private readonly resolver: ProjectDatabaseConnectionResolver) {}

  async execute(input: ProjectDatabaseExecutionInput): Promise<ProjectDatabaseExecutionResult> {
    assertProjectDatabaseExecutionInput(input);
    const result = await this.runVerified(input, false);
    if (result.status === "not_applied") {
      throw new ProjectDatabaseExecutionError({ code: "INVALID_EXECUTOR_RESULT", outcome: "not_started" });
    }
    return result;
  }

  async reconcile(input: ProjectDatabaseReconciliationInput): Promise<ProjectDatabaseReconciliationResult> {
    assertProjectDatabaseReconciliationInput(input);
    const result = await this.runVerified({ ...input, statement: "" }, true);
    return { status: result.status === "already_applied" ? "applied" : "not_applied" };
  }

  private async runVerified(
    input: ProjectDatabaseExecutionInput,
    reconcileOnly: boolean,
  ): Promise<ProjectDatabaseExecutionResult | { status: "not_applied" }> {
    let resolved: ResolvedProjectDatabaseConnection;
    try {
      resolved = await this.resolver.resolve(input.databaseInstanceRef);
      if (!/^[a-z_][a-z0-9_]{0,62}$/.test(resolved.expectedRole) ||
          !/^[a-z_][a-z0-9_]{0,62}$/.test(resolved.expectedLedgerOwner) ||
          !resolved.expectedDatabase || resolved.expectedDatabase.length > 63 || /[\u0000-\u001f\u007f]/.test(resolved.expectedDatabase)) {
        throw new Error("Invalid expected database boundary");
      }
    } catch (cause) {
      throw new ProjectDatabaseExecutionError({
        code: "PROJECT_DATABASE_RESOLUTION_FAILED", outcome: "not_started", retryable: true, cause,
      });
    }

    let client: SqlPoolClient;
    try {
      client = await resolved.pool.connect();
    } catch (cause) {
      throw new ProjectDatabaseExecutionError({
        code: "PROJECT_DATABASE_CONNECT_FAILED", outcome: "not_started", retryable: true, cause,
      });
    }

    let transactionStarted = false;
    let commitStarted = false;
    let discardConnection = false;
    let fenceConfirmed = false;
    try {
      const boundary = await client.query<{
        rolname: string; session_user: string; database_name: string;
        rolsuper: boolean; rolbypassrls: boolean; rolcreatedb: boolean; rolcreaterole: boolean;
        rolreplication: boolean; privileged_member: boolean; unexpected_member: boolean;
      }>(
        `SELECT role.rolname, session_user::text AS session_user, current_database() AS database_name,
                role.rolsuper, role.rolbypassrls, role.rolcreatedb, role.rolcreaterole, role.rolreplication,
                EXISTS (
                  SELECT 1 FROM pg_roles AS privileged
                  WHERE (privileged.rolsuper OR privileged.rolbypassrls OR privileged.rolcreatedb OR
                         privileged.rolcreaterole OR privileged.rolreplication OR
                         privileged.rolname IN (
                           'pg_execute_server_program','pg_read_server_files','pg_write_server_files',
                           'pg_read_all_data','pg_write_all_data','pg_maintain','pg_signal_backend',
                           'pg_checkpoint','pg_create_subscription','pg_database_owner',
                           'pg_use_reserved_connections','pg_signal_autovacuum_worker','pg_monitor',
                           'pg_read_all_settings','pg_read_all_stats','pg_stat_scan_tables'
                         ))
                    AND privileged.rolname <> current_user
                    AND pg_has_role(current_user, privileged.oid, 'MEMBER')
                ) AS privileged_member,
                EXISTS (
                  SELECT 1 FROM pg_roles AS inherited
                  WHERE inherited.oid <> role.oid AND pg_has_role(current_user, inherited.oid, 'MEMBER')
                ) AS unexpected_member
         FROM pg_roles AS role
         WHERE role.rolname = current_user`,
      );
      const role = boundary.rows[0];
      if (!role || role.rolname !== resolved.expectedRole || role.session_user !== resolved.expectedRole ||
          role.database_name !== resolved.expectedDatabase || role.rolsuper || role.rolbypassrls ||
          role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.privileged_member || role.unexpected_member) {
        throw new ProjectDatabaseExecutionError({ code: "INVALID_PROJECT_DATABASE_ROLE", outcome: "not_started" });
      }

      if (!reconcileOnly) {
        try {
          await this.installFence(client, input, resolved.expectedLedgerOwner);
        } catch (error) {
          if (error instanceof ProjectDatabaseExecutionError && error.outcome === "unknown") discardConnection = true;
          throw error;
        }
        fenceConfirmed = true;
      }

      await client.query("BEGIN");
      transactionStarted = true;
      await client.query("SET LOCAL statement_timeout = '15s'");
      await client.query("SET LOCAL lock_timeout = '3s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
      const ledgerBoundary = await client.query<{
        relkind: string; relpersistence: string; owned_by_current_user: boolean; member_of_relation_owner: boolean;
        member_of_schema_owner: boolean; has_user_triggers: boolean; has_user_rules: boolean; row_security: boolean;
        can_select: boolean; can_insert: boolean; has_dangerous_table_privileges: boolean; can_create_in_schema: boolean;
        has_change_set_uuid: boolean; has_statement_hash_text: boolean; has_applied_at_timestamp: boolean;
        has_exact_columns: boolean; has_change_set_primary_key: boolean; has_hash_check: boolean;
        has_unexpected_table_acl: boolean; has_unexpected_schema_acl: boolean; owner_name: string;
        owner_can_login: boolean; owner_is_privileged: boolean; owner_has_memberships: boolean; owner_matches_schema: boolean;
      }>(
        `SELECT relation.relkind, relation.relpersistence,
                relation.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) AS owned_by_current_user,
                pg_has_role(current_user, relation.relowner, 'MEMBER') AS member_of_relation_owner,
                pg_has_role(current_user, namespace.nspowner, 'MEMBER') AS member_of_schema_owner,
                relation.relrowsecurity AS row_security,
                has_table_privilege(current_user, relation.oid, 'SELECT') AS can_select,
                has_table_privilege(current_user, relation.oid, 'INSERT') AS can_insert,
                (has_table_privilege(current_user, relation.oid, 'UPDATE') OR
                 has_table_privilege(current_user, relation.oid, 'DELETE') OR
                 has_table_privilege(current_user, relation.oid, 'TRUNCATE') OR
                 has_table_privilege(current_user, relation.oid, 'REFERENCES') OR
                 has_table_privilege(current_user, relation.oid, 'TRIGGER')) AS has_dangerous_table_privileges,
                has_schema_privilege(current_user, namespace.oid, 'CREATE') AS can_create_in_schema,
                EXISTS (
                  SELECT 1
                  FROM aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) AS acl
                  WHERE NOT (
                    acl.grantee = relation.relowner OR
                    (acl.grantee = migration_role.oid AND acl.privilege_type IN ('SELECT','INSERT') AND NOT acl.is_grantable)
                  )
                ) AS has_unexpected_table_acl,
                EXISTS (
                  SELECT 1
                  FROM aclexplode(coalesce(namespace.nspacl, acldefault('n', namespace.nspowner))) AS acl
                  WHERE NOT (
                    acl.grantee = namespace.nspowner OR
                    (acl.grantee = migration_role.oid AND acl.privilege_type = 'USAGE' AND NOT acl.is_grantable)
                  )
                ) AS has_unexpected_schema_acl,
                ledger_owner.rolname AS owner_name,
                ledger_owner.rolcanlogin AS owner_can_login,
                (ledger_owner.rolsuper OR ledger_owner.rolbypassrls OR ledger_owner.rolcreatedb OR
                 ledger_owner.rolcreaterole OR ledger_owner.rolreplication) AS owner_is_privileged,
                EXISTS (
                  SELECT 1 FROM pg_auth_members AS membership
                  WHERE membership.roleid = ledger_owner.oid OR membership.member = ledger_owner.oid
                ) AS owner_has_memberships,
                relation.relowner = namespace.nspowner AS owner_matches_schema,
                EXISTS (
                  SELECT 1 FROM pg_attribute AS attribute
                  WHERE attribute.attrelid = relation.oid AND attribute.attname = 'change_set_id'
                    AND attribute.atttypid = 'uuid'::regtype AND attribute.attnotnull AND NOT attribute.attisdropped
                ) AS has_change_set_uuid,
                EXISTS (
                  SELECT 1 FROM pg_attribute AS attribute
                  WHERE attribute.attrelid = relation.oid AND attribute.attname = 'statement_sha256'
                    AND attribute.atttypid = 'text'::regtype AND attribute.attnotnull AND NOT attribute.attisdropped
                ) AS has_statement_hash_text,
                EXISTS (
                  SELECT 1 FROM pg_attribute AS attribute
                  WHERE attribute.attrelid = relation.oid AND attribute.attname = 'applied_at'
                    AND attribute.atttypid = 'timestamptz'::regtype AND attribute.attnotnull AND NOT attribute.attisdropped
                ) AS has_applied_at_timestamp,
                (
                  SELECT array_agg(attribute.attname ORDER BY attribute.attnum)
                  FROM pg_attribute AS attribute
                  WHERE attribute.attrelid = relation.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped
                ) = ARRAY['change_set_id','statement_sha256','applied_at']::name[] AS has_exact_columns,
                EXISTS (
                  SELECT 1
                  FROM pg_index AS ledger_index
                  JOIN pg_attribute AS attribute
                    ON attribute.attrelid = relation.oid AND attribute.attnum = ANY(ledger_index.indkey)
                  WHERE ledger_index.indrelid = relation.oid AND ledger_index.indisprimary
                    AND ledger_index.indnkeyatts = 1 AND attribute.attname = 'change_set_id'
                ) AS has_change_set_primary_key,
                EXISTS (
                  SELECT 1
                  FROM pg_constraint AS ledger_constraint
                  WHERE ledger_constraint.conrelid = relation.oid AND ledger_constraint.contype = 'c'
                    AND pg_get_constraintdef(ledger_constraint.oid) LIKE '%statement_sha256%64%'
                ) AS has_hash_check,
                EXISTS (
                  SELECT 1 FROM pg_trigger AS trigger
                  WHERE trigger.tgrelid = relation.oid AND NOT trigger.tgisinternal
                ) AS has_user_triggers,
                EXISTS (
                  SELECT 1 FROM pg_rewrite AS rewrite
                  WHERE rewrite.ev_class = relation.oid AND rewrite.rulename <> '_RETURN'
                ) AS has_user_rules
         FROM pg_class AS relation
         JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
         JOIN pg_roles AS ledger_owner ON ledger_owner.oid = relation.relowner
         JOIN pg_roles AS migration_role ON migration_role.rolname = current_user
         WHERE namespace.nspname = 'qkern_internal' AND relation.relname = 'migration_ledger'`,
      );
      const ledger = ledgerBoundary.rows[0];
      if (!ledger || ledger.relkind !== "r" || ledger.relpersistence !== "p" || ledger.owned_by_current_user ||
          ledger.member_of_relation_owner || ledger.member_of_schema_owner || ledger.has_user_triggers || ledger.has_user_rules ||
          ledger.row_security || !ledger.can_select || !ledger.can_insert || ledger.has_dangerous_table_privileges ||
          ledger.can_create_in_schema || !ledger.has_change_set_uuid || !ledger.has_statement_hash_text ||
          !ledger.has_applied_at_timestamp || !ledger.has_exact_columns || !ledger.has_change_set_primary_key ||
          !ledger.has_hash_check || ledger.has_unexpected_table_acl || ledger.has_unexpected_schema_acl ||
          ledger.owner_name !== resolved.expectedLedgerOwner || ledger.owner_can_login || ledger.owner_is_privileged ||
          ledger.owner_has_memberships || !ledger.owner_matches_schema) {
        throw new ProjectDatabaseExecutionError({
          code: "INVALID_MIGRATION_LEDGER", outcome: "rolled_back",
          failedChecks: failedBoundaryChecks(
            ledger as unknown as Record<string, unknown> | undefined,
            LEDGER_BOUNDARY_EXPECTATIONS, resolved.expectedLedgerOwner,
          ),
        });
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [input.changeSetId]);
      if (!reconcileOnly) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 684321))", [input.jobId]);
        const activeFence = await client.query<{ fence_epoch: string; lease_token: string; statement_sha256: string }>(
          `SELECT fence_epoch::text AS fence_epoch, lease_token::text AS lease_token, statement_sha256
           FROM qkern_internal.migration_fences WHERE job_id = $1`,
          [input.jobId],
        );
        const active = activeFence.rows[0];
        if (!active || active.fence_epoch !== input.fenceEpoch || active.lease_token !== input.leaseToken ||
            active.statement_sha256 !== input.statementSha256.toLowerCase()) {
          throw new ProjectDatabaseExecutionError({
            code: "MIGRATION_FENCE_SUPERSEDED", outcome: "rolled_back", fenceStatus: "superseded",
          });
        }
      }
      const existing = await client.query<{ statement_sha256: string }>(
        "SELECT statement_sha256 FROM qkern_internal.migration_ledger WHERE change_set_id = $1",
        [input.changeSetId],
      );
      if (existing.rows[0] && existing.rows[0].statement_sha256 !== input.statementSha256) {
        throw new ProjectDatabaseExecutionError({ code: "MIGRATION_LEDGER_CONFLICT", outcome: "rolled_back" });
      }
      if (existing.rows[0]) {
        commitStarted = true;
        await client.query("COMMIT");
        transactionStarted = false;
        return { status: "already_applied" };
      }

      if (reconcileOnly) {
        commitStarted = true;
        await client.query("COMMIT");
        transactionStarted = false;
        return { status: "not_applied" };
      }

      // This is the only caller-supplied query. It was decrypted, hash-checked
      // and parsed as exactly one statement immediately before this executor.
      await client.query(input.statement);
      await client.query(
        "INSERT INTO qkern_internal.migration_ledger (change_set_id, statement_sha256) VALUES ($1, $2)",
        [input.changeSetId, input.statementSha256],
      );
      commitStarted = true;
      await client.query("COMMIT");
      transactionStarted = false;
      return { status: "applied" };
    } catch (error) {
      if (error instanceof ProjectDatabaseExecutionError && !transactionStarted) throw error;
      if (commitStarted) {
        discardConnection = true;
        throw new ProjectDatabaseExecutionError({
          code: "MIGRATION_COMMIT_OUTCOME_UNKNOWN",
          outcome: "unknown",
          cause: error,
        });
      }
      if (transactionStarted) {
        try {
          await client.query("ROLLBACK");
          transactionStarted = false;
          const code = error instanceof ProjectDatabaseExecutionError ? error.code : safePostgresCode(error);
          throw new ProjectDatabaseExecutionError({
            code,
            outcome: "rolled_back",
            retryable: !(error instanceof ProjectDatabaseExecutionError) && SAFE_RETRY_CODES.has(code),
            cause: error,
            fenceStatus: error instanceof ProjectDatabaseExecutionError
              ? error.fenceStatus
              : fenceConfirmed ? "confirmed" : "unknown",
          });
        } catch (rollbackError) {
          if (rollbackError instanceof ProjectDatabaseExecutionError) throw rollbackError;
          discardConnection = true;
          throw new ProjectDatabaseExecutionError({
            code: "MIGRATION_ROLLBACK_OUTCOME_UNKNOWN",
            outcome: "unknown",
            cause: rollbackError,
          });
        }
      }
      throw new ProjectDatabaseExecutionError({
        code: safePostgresCode(error),
        outcome: "not_started",
        cause: error,
        fenceStatus: fenceConfirmed ? "confirmed" : "unknown",
      });
    } finally {
      client.release(discardConnection);
    }
  }

  /**
   * Installs the claim fence in its own transaction. It must survive a later
   * statement rollback, otherwise an older worker could become executable again.
   */
  private async installFence(
    client: SqlPoolClient,
    input: ProjectDatabaseExecutionInput,
    expectedLedgerOwner: string,
  ): Promise<void> {
    let started = false;
    let commitStarted = false;
    try {
      await client.query("BEGIN");
      started = true;
      await client.query("SET LOCAL statement_timeout = '15s'");
      await client.query("SET LOCAL lock_timeout = '3s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
      const boundary = await client.query<{
        relkind: string; relpersistence: string; owned_by_current_user: boolean; member_of_relation_owner: boolean;
        member_of_schema_owner: boolean; has_user_triggers: boolean; has_user_rules: boolean; row_security: boolean;
        can_select: boolean; can_insert: boolean; can_update_allowed_columns: boolean; has_dangerous_table_privileges: boolean;
        can_create_in_schema: boolean; has_exact_columns: boolean; has_exact_column_types: boolean; has_job_primary_key: boolean;
        has_epoch_check: boolean; has_hash_check: boolean; has_unexpected_table_acl: boolean;
        has_unexpected_column_acl: boolean; has_unexpected_schema_acl: boolean; owner_name: string; owner_can_login: boolean;
        owner_is_privileged: boolean; owner_has_memberships: boolean; owner_matches_schema: boolean;
      }>(FENCE_BOUNDARY_SQL);
      const fence = boundary.rows[0];
      if (!fence || fence.relkind !== "r" || fence.relpersistence !== "p" || fence.owned_by_current_user ||
          fence.member_of_relation_owner || fence.member_of_schema_owner || fence.has_user_triggers || fence.has_user_rules ||
          fence.row_security || !fence.can_select || !fence.can_insert || !fence.can_update_allowed_columns ||
          fence.has_dangerous_table_privileges || fence.can_create_in_schema || !fence.has_exact_columns ||
          !fence.has_exact_column_types ||
          !fence.has_job_primary_key || !fence.has_epoch_check || !fence.has_hash_check ||
          fence.has_unexpected_table_acl || fence.has_unexpected_column_acl || fence.has_unexpected_schema_acl ||
          fence.owner_name !== expectedLedgerOwner || fence.owner_can_login || fence.owner_is_privileged ||
          fence.owner_has_memberships || !fence.owner_matches_schema) {
        throw new ProjectDatabaseExecutionError({
          code: "INVALID_MIGRATION_FENCE", outcome: "rolled_back",
          failedChecks: failedBoundaryChecks(
            fence as unknown as Record<string, unknown> | undefined,
            FENCE_BOUNDARY_EXPECTATIONS, expectedLedgerOwner,
          ),
        });
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 684321))", [input.jobId]);
      const written = await client.query<{ fence_epoch: string; lease_token: string; statement_sha256: string }>(
        `INSERT INTO qkern_internal.migration_fences
           (job_id, fence_epoch, lease_token, statement_sha256)
         VALUES ($1, $2::bigint, $3, $4)
         ON CONFLICT (job_id) DO UPDATE
           SET fence_epoch = EXCLUDED.fence_epoch, lease_token = EXCLUDED.lease_token,
               statement_sha256 = EXCLUDED.statement_sha256, fenced_at = clock_timestamp()
         WHERE qkern_internal.migration_fences.fence_epoch < EXCLUDED.fence_epoch
         RETURNING fence_epoch::text AS fence_epoch, lease_token::text AS lease_token, statement_sha256`,
        [input.jobId, input.fenceEpoch, input.leaseToken, input.statementSha256.toLowerCase()],
      );
      let current = written.rows[0];
      if (!current) {
        const selected = await client.query<{ fence_epoch: string; lease_token: string; statement_sha256: string }>(
          `SELECT fence_epoch::text AS fence_epoch, lease_token::text AS lease_token, statement_sha256
           FROM qkern_internal.migration_fences WHERE job_id = $1`, [input.jobId],
        );
        current = selected.rows[0];
      }
      if (!current || current.fence_epoch !== input.fenceEpoch || current.lease_token !== input.leaseToken ||
          current.statement_sha256 !== input.statementSha256.toLowerCase()) {
        throw new ProjectDatabaseExecutionError({
          code: "MIGRATION_FENCE_SUPERSEDED", outcome: "rolled_back", fenceStatus: "superseded",
        });
      }
      commitStarted = true;
      await client.query("COMMIT");
      started = false;
    } catch (error) {
      if (commitStarted) {
        throw new ProjectDatabaseExecutionError({
          code: "MIGRATION_FENCE_COMMIT_OUTCOME_UNKNOWN", outcome: "unknown", fenceStatus: "unknown", cause: error,
        });
      }
      if (started) {
        try { await client.query("ROLLBACK"); } catch (cause) {
          throw new ProjectDatabaseExecutionError({
            code: "MIGRATION_FENCE_ROLLBACK_OUTCOME_UNKNOWN", outcome: "unknown", fenceStatus: "unknown", cause,
          });
        }
      }
      if (error instanceof ProjectDatabaseExecutionError) throw error;
      throw new ProjectDatabaseExecutionError({
        code: safePostgresCode(error), outcome: "rolled_back", fenceStatus: "unknown", cause: error,
      });
    }
  }

}

/**
 * Was eine Zieldatenbank erfuellen muss, damit der Ledger benutzbar ist.
 *
 * Die Liste stand bis Release 1.51 nur als eine lange `if`-Bedingung da. Wer
 * `INVALID_MIGRATION_LEDGER` las, wusste, **dass** etwas nicht stimmt, und
 * musste die Bedingung von Hand nachbauen, um zu erfahren, **was**. Genau daran
 * hat Release 1.48 zwei Zertifizierungslaeufe verloren.
 */
export const LEDGER_BOUNDARY_EXPECTATIONS: Readonly<Record<string, unknown>> = {
  relkind: "r", relpersistence: "p", owned_by_current_user: false,
  member_of_relation_owner: false, member_of_schema_owner: false,
  has_user_triggers: false, has_user_rules: false, row_security: false,
  can_select: true, can_insert: true, has_dangerous_table_privileges: false,
  can_create_in_schema: false, has_change_set_uuid: true, has_statement_hash_text: true,
  has_applied_at_timestamp: true, has_exact_columns: true, has_change_set_primary_key: true,
  has_hash_check: true, has_unexpected_table_acl: false, has_unexpected_schema_acl: false,
  owner_can_login: false, owner_is_privileged: false, owner_has_memberships: false,
  owner_matches_schema: true,
};

/** Dasselbe fuer den Zaun. */
export const FENCE_BOUNDARY_EXPECTATIONS: Readonly<Record<string, unknown>> = {
  relkind: "r", relpersistence: "p", owned_by_current_user: false,
  member_of_relation_owner: false, member_of_schema_owner: false,
  has_user_triggers: false, has_user_rules: false, row_security: false,
  can_select: true, can_insert: true, can_update_allowed_columns: true,
  has_dangerous_table_privileges: false, can_create_in_schema: false,
  has_exact_columns: true, has_exact_column_types: true, has_job_primary_key: true,
  has_epoch_check: true, has_hash_check: true, has_unexpected_table_acl: false,
  has_unexpected_column_acl: false, has_unexpected_schema_acl: false,
  owner_can_login: false, owner_is_privileged: false, owner_has_memberships: false,
  owner_matches_schema: true,
};

/**
 * Die Namen der verletzten Bedingungen — und sonst nichts.
 *
 * Ein Name wie `owner_has_memberships` ist eine Struktureigenschaft der
 * Zieldatenbank und im Runbook nachlesbar. Kein Rollenname, kein Schema, kein
 * Wert: Was die Datenbank **ist**, sagt diese Liste nicht, nur was ihr fehlt.
 */
export function failedBoundaryChecks(
  row: Record<string, unknown> | undefined,
  expectations: Readonly<Record<string, unknown>>,
  expectedOwner?: string,
): readonly string[] {
  if (!row) return ["boundary_row_missing"];
  const failed = Object.entries(expectations)
    .filter(([key, value]) => row[key] !== value)
    .map(([key]) => key);
  if (expectedOwner !== undefined && row.owner_name !== expectedOwner) failed.push("owner_name");
  return failed;
}

/**
 * Die Grenzpruefung des Zaunes.
 *
 * Exportiert, damit eine Zertifizierung dieselbe Abfrage stellen kann statt
 * einer Kopie. Release 1.48 hat einen Lauf verloren, weil eine nachgebaute
 * Diagnose `owner_has_memberships` nur in eine Richtung prueft — die echte
 * Abfrage prueft beide.
 */
export const FENCE_BOUNDARY_SQL = `SELECT relation.relkind, relation.relpersistence,
  relation.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) AS owned_by_current_user,
  pg_has_role(current_user, relation.relowner, 'MEMBER') AS member_of_relation_owner,
  pg_has_role(current_user, namespace.nspowner, 'MEMBER') AS member_of_schema_owner,
  relation.relrowsecurity AS row_security,
  has_table_privilege(current_user, relation.oid, 'SELECT') AS can_select,
  has_table_privilege(current_user, relation.oid, 'INSERT') AS can_insert,
  (has_column_privilege(current_user, relation.oid, 'fence_epoch', 'UPDATE') AND
   has_column_privilege(current_user, relation.oid, 'lease_token', 'UPDATE') AND
   has_column_privilege(current_user, relation.oid, 'statement_sha256', 'UPDATE') AND
   has_column_privilege(current_user, relation.oid, 'fenced_at', 'UPDATE')) AS can_update_allowed_columns,
  (has_table_privilege(current_user, relation.oid, 'DELETE') OR has_table_privilege(current_user, relation.oid, 'TRUNCATE') OR
   has_table_privilege(current_user, relation.oid, 'REFERENCES') OR has_table_privilege(current_user, relation.oid, 'TRIGGER') OR
   has_column_privilege(current_user, relation.oid, 'job_id', 'UPDATE')) AS has_dangerous_table_privileges,
  has_schema_privilege(current_user, namespace.oid, 'CREATE') AS can_create_in_schema,
  (SELECT array_agg(a.attname ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=relation.oid AND a.attnum>0 AND NOT a.attisdropped)
    = ARRAY['job_id','fence_epoch','lease_token','statement_sha256','fenced_at']::name[] AS has_exact_columns,
  ((SELECT count(*) FROM pg_attribute a WHERE a.attrelid=relation.oid AND NOT a.attisdropped AND a.attnotnull AND
      ((a.attname='job_id' AND a.atttypid='uuid'::regtype) OR
       (a.attname='fence_epoch' AND a.atttypid='bigint'::regtype) OR
       (a.attname='lease_token' AND a.atttypid='uuid'::regtype) OR
       (a.attname='statement_sha256' AND a.atttypid='text'::regtype) OR
       (a.attname='fenced_at' AND a.atttypid='timestamptz'::regtype))) = 5) AS has_exact_column_types,
  EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=relation.oid AND a.attnum=ANY(i.indkey)
          WHERE i.indrelid=relation.oid AND i.indisprimary AND i.indnkeyatts=1 AND a.attname='job_id') AS has_job_primary_key,
  EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=relation.oid AND c.contype='c' AND pg_get_constraintdef(c.oid) LIKE '%fence_epoch%0%') AS has_epoch_check,
  EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=relation.oid AND c.contype='c' AND pg_get_constraintdef(c.oid) LIKE '%statement_sha256%64%') AS has_hash_check,
  EXISTS (SELECT 1 FROM aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) acl
          WHERE NOT (acl.grantee=relation.relowner OR (acl.grantee=migration_role.oid AND acl.privilege_type IN ('SELECT','INSERT','UPDATE') AND NOT acl.is_grantable))) AS has_unexpected_table_acl,
  -- aclexplode(a.attacl) ohne coalesce: '{}'::aclitem[] ist nulldimensional,
  -- und aclexplode verlangt genau eine Dimension. PostgreSQL wies die ganze
  -- Abfrage mit "ACL arrays must be one-dimensional" ab. Die Funktion ist
  -- strikt; ein NULL liefert im LATERAL schlicht keine Zeile, und genau das
  -- ist gemeint: Eine Spalte ohne eigene ACL hat keine unerwartete ACL. Die
  -- Nachbarpruefungen benutzen acldefault(...) und waren nie betroffen.
  EXISTS (SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
          WHERE a.attrelid=relation.oid AND NOT a.attisdropped AND
            NOT (a.attname IN ('fence_epoch','lease_token','statement_sha256','fenced_at') AND
                 acl.grantee=migration_role.oid AND acl.privilege_type='UPDATE' AND NOT acl.is_grantable)) AS has_unexpected_column_acl,
  EXISTS (SELECT 1 FROM aclexplode(coalesce(namespace.nspacl, acldefault('n', namespace.nspowner))) acl
          WHERE NOT (acl.grantee=namespace.nspowner OR (acl.grantee=migration_role.oid AND acl.privilege_type='USAGE' AND NOT acl.is_grantable))) AS has_unexpected_schema_acl,
  owner.rolname AS owner_name, owner.rolcanlogin AS owner_can_login,
  (owner.rolsuper OR owner.rolbypassrls OR owner.rolcreatedb OR owner.rolcreaterole OR owner.rolreplication) AS owner_is_privileged,
  EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid=owner.oid OR m.member=owner.oid) AS owner_has_memberships,
  relation.relowner=namespace.nspowner AS owner_matches_schema,
  EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=relation.oid AND NOT t.tgisinternal) AS has_user_triggers,
  EXISTS (SELECT 1 FROM pg_rewrite r WHERE r.ev_class=relation.oid AND r.rulename<>'_RETURN') AS has_user_rules
FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
JOIN pg_roles owner ON owner.oid=relation.relowner JOIN pg_roles migration_role ON migration_role.rolname=current_user
WHERE namespace.nspname='qkern_internal' AND relation.relname='migration_fences'`;

function safePostgresCode(error: unknown): string {
  const raw = (error as PostgresFailure)?.code;
  return raw && /^[A-Z0-9_]{2,40}$/i.test(raw) ? raw.toUpperCase() : "PROJECT_DATABASE_ERROR";
}
