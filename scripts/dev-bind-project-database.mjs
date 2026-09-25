import { pathToFileURL } from "node:url";
import pg from "pg";

/**
 * Bindet lokal eine Projektumgebung an `managed:database-1` (2.30).
 *
 * In Produktion tut das der Provisionierer nach einem echten Bootstrap. Hier
 * gibt es keinen; das Skript macht dieselbe eine UPDATE-Anweisung wie
 * `bindProvisioned` in lib/server/db/repositories.ts, als Provisionierer-Login,
 * nur aus `pending:` heraus (der Trigger in Migration 0005 verbietet alles
 * andere) und nie fuer production. Danach ist die Bindung unveraenderlich,
 * darum laeuft das Skript nur gegen einen lokalen Host, ausser
 * --allow-remote-host erzwingt es.
 *
 * Es macht nur dieses UPDATE: kein Provisionierungsauftrag, keine Zeile in
 * `project_database_bindings`, keine Aenderung an `projects.status`. Es liest
 * keine `.env.local`; QKERN_PROVISIONER_ORGANIZATION_ID muss in der Shell
 * exportiert sein oder als drittes Argument kommen.
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
const ALLOW_REMOTE = "--allow-remote-host";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const DEFAULT_URL = "postgresql://qkern_provisioner_app:qkern_provisioner_local_only@localhost:5432/qkern_control";
const USAGE = `Aufruf: npm run dev:bind-project-database -- <project-uuid> <development|staging> [organization-uuid] [${ALLOW_REMOTE}]`;

/** Erwarteter Fehler: nur die Meldung ausgeben, keinen Stacktrace. */
class ExpectedError extends Error {}

export function parseArgs(argv) {
  const allowRemote = argv.includes(ALLOW_REMOTE);
  const positional = argv.filter((arg) => arg !== ALLOW_REMOTE).map((arg) => arg.trim());
  if (positional.length > 3) throw new ExpectedError(USAGE);
  const [projectId, environment, organizationId] = positional;
  if (!projectId || !environment) throw new ExpectedError(USAGE);
  if (!UUID.test(projectId)) throw new ExpectedError(`Die Projekt-ID ist keine gueltige uuid: ${projectId}`);
  if (environment === "production") throw new ExpectedError("production wird lokal nie gebunden");
  if (environment !== "development" && environment !== "staging") {
    throw new ExpectedError(`Die Umgebung muss development oder staging sein, nicht ${environment}`);
  }
  if (organizationId !== undefined && !UUID.test(organizationId)) {
    throw new ExpectedError(`Die Organisations-ID ist keine gueltige uuid: ${organizationId}`);
  }
  return { projectId, environment, organizationId, allowRemote };
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

export function resolveOrganizationId(args, env) {
  const organizationId = args.organizationId ?? env.QKERN_PROVISIONER_ORGANIZATION_ID?.trim();
  if (!organizationId || !UUID.test(organizationId)) {
    throw new ExpectedError(`Die Organisation fehlt oder ist keine gueltige uuid. Setze QKERN_PROVISIONER_ORGANIZATION_ID oder gib sie als drittes Argument an.\n${USAGE}`);
  }
  return organizationId;
}

export function assertLocalUrl(url, { allowRemote }) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new ExpectedError("QKERN_PROVISIONER_DATABASE_URL ist keine gueltige URL.");
  }
  const host = parsed.hostname;
  if (!LOCAL_HOSTS.has(host) && !allowRemote) {
    throw new ExpectedError(`Der Host ${host} ist nicht lokal. Dieses Skript ist nur fuer den lokalen Dev-Compose gedacht; ${ALLOW_REMOTE} erzwingt es.`);
  }
  return { host, port: parsed.port || "5432", database: parsed.pathname.replace(/^\//, "") };
}

function errorCode(error) {
  return error?.code ?? error?.errors?.find((inner) => inner?.code)?.code;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const organizationId = resolveOrganizationId(args, process.env);
  const url = process.env.QKERN_PROVISIONER_DATABASE_URL ?? DEFAULT_URL;
  const target = assertLocalUrl(url, { allowRemote: args.allowRemote });
  const where = `${target.host}:${target.port}/${target.database}`;
  console.log(`Ziel: ${where}`);

  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
  } catch (error) {
    throw new ExpectedError(`Keine Verbindung zu ${where} (${errorCode(error) ?? "unbekannt"}). Laeuft Postgres?`);
  }

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
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const code = errorCode(error);
    if (error instanceof ExpectedError) console.error(error.message);
    else if (code) console.error(`${error.message} (${code})`);
    else console.error(error);
    process.exitCode = 1;
  });
}
