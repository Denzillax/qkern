import { pathToFileURL } from "node:url";
import pg from "pg";

/**
 * Bindet lokal eine Projektumgebung an `managed:database-1` (2.30).
 *
 * In Produktion tut das der Provisionierer nach einem echten Bootstrap. Hier
 * gibt es keinen; das Skript macht dieselbe eine UPDATE-Anweisung wie
 * `bindProvisioned` in lib/server/db/repositories.ts, als Provisionierer-Login,
 * nur aus `pending:` heraus (der Trigger in Migration 0005 verbietet alles
 * andere) und nie fuer production.
 *
 * `project_environments` steht unter FORCE ROW LEVEL SECURITY (Migration
 * 0002). Der Provisionierer sieht nur Zeilen der Organisation, die in
 * `qkern.organization_id` steht; ohne sie findet das UPDATE nichts. Deshalb
 * oeffnet das Skript dieselbe Transaktion wie `withTenantTransaction` in
 * lib/server/db/transaction.ts: BEGIN, set_config fuer Organisation, Akteur
 * und statement_timeout (20 s wie der Provisionierer-Port), UPDATE, COMMIT.
 * Die Organisation kommt wie beim Worker aus QKERN_PROVISIONER_ORGANIZATION_ID
 * oder als drittes Argument. Nachschlagen laesst sie sich als Provisionierer
 * nicht, weil RLS auch das SELECT auf `projects` sperrt.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = "managed:database-1";
const ACTOR = "dev-bind-project-database";
const STATEMENT_TIMEOUT_MS = "20000";
const USAGE = "Usage: npm run dev:bind-project-database -- <project-uuid> <development|staging> [organization-uuid]";

export function parseArgs(argv) {
  const [projectId, environment, organizationId] = argv;
  if (!projectId) throw new Error(USAGE);
  if (!UUID.test(projectId)) throw new Error(`project id is not a uuid: ${projectId}`);
  if (environment === "production") throw new Error("production is never bound locally");
  if (environment !== "development" && environment !== "staging") {
    throw new Error(`environment must be development or staging, got ${environment}`);
  }
  if (organizationId !== undefined && !UUID.test(organizationId)) {
    throw new Error(`organization id is not a uuid: ${organizationId}`);
  }
  return { projectId, environment, organizationId };
}

export function bindStatement({ projectId, environment }) {
  return {
    text: `UPDATE project_environments
       SET database_instance_ref = $3
       WHERE organization_id = qkern_current_organization_id()
         AND project_id = $1 AND environment = $2
         AND database_instance_ref ~* '^pending:'
       RETURNING organization_id, database_instance_ref`,
    values: [projectId, environment, REF],
  };
}

function resolveOrganizationId(args) {
  const organizationId = args.organizationId ?? process.env.QKERN_PROVISIONER_ORGANIZATION_ID?.trim();
  if (!organizationId || !UUID.test(organizationId)) {
    throw new Error(`Die Organisation fehlt oder ist keine UUID. Setze QKERN_PROVISIONER_ORGANIZATION_ID oder gib sie als drittes Argument an.\n${USAGE}`);
  }
  return organizationId;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const organizationId = resolveOrganizationId(args);
  const url = process.env.QKERN_PROVISIONER_DATABASE_URL
    ?? "postgresql://qkern_provisioner_app:qkern_provisioner_local_only@localhost:5432/qkern_control";
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await client.query(
      "SELECT set_config('qkern.organization_id', $1, true), set_config('qkern.actor_ref', $2, true), set_config('statement_timeout', $3, true)",
      [organizationId, ACTOR, STATEMENT_TIMEOUT_MS],
    );
    const result = await client.query(bindStatement(args));
    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      open = false;
      console.error("Keine wartende Umgebung gefunden. Stimmen Projekt-ID und Organisation, und ist die Umgebung noch `pending:`?");
      process.exitCode = 1;
      return;
    }
    await client.query("COMMIT");
    open = false;
    console.log(`Gebunden: ${args.environment} von ${args.projectId} an ${result.rows[0].database_instance_ref}`);
  } finally {
    if (open) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
