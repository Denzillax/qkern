import { readFile, writeFile } from "node:fs/promises";
import {
  generateDatabaseTypes,
  initializeProject,
  planMigration,
  readConfig,
  resolveInside,
  validateSeed,
  type SchemaResult,
} from "./core.js";

export type CliIo = {
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

export const USAGE = [
  "Usage: qkern <command>",
  "",
  "  init --url <baseUrl> --project <id> --environment development|staging|production",
  "  status",
  "  schema pull            (needs QKERN_PROJECT_KEY in the environment)",
  "  migration plan <file>",
  "  seed check",
  "  help",
  "",
  "Configuration never contains credentials; keys are read from the environment only.",
].join("\n") + "\n";

/** Ein Aufruf ohne gueltigen Befehl: die Meldung ist die Nutzung selbst. */
class UsageError extends Error {}

/**
 * Fuehrt einen CLI-Aufruf aus und liefert den Exit-Code. `help`, `--help`,
 * `-h` und der leere Aufruf zeigen die Nutzung auf stdout (0); ein unbekannter
 * oder unvollstaendiger Befehl zeigt sie auf stderr (1). Jeder andere Fehler
 * nennt seinen Grund: bis 2.16 stand da nur "QKERN CLI command failed.",
 * auch bei `qkern --help` (gefunden nach der ersten Veroeffentlichung).
 */
export async function run(args: string[], io: CliIo): Promise<number> {
  try {
    if (args.length === 0 || ["help", "--help", "-h"].includes(args[0])) {
      io.stdout(USAGE);
      return 0;
    }
    await execute(args, io);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(USAGE);
      return 1;
    }
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`QKERN CLI command failed: ${message}\n`);
    return 1;
  }
}

async function execute(args: string[], io: CliIo): Promise<void> {
  const print = (value: unknown) => io.stdout(`${JSON.stringify(value, null, 2)}\n`);
  const cwd = io.cwd;
  if (args[0] === "init") {
    const baseUrl = value(args, "--url");
    const projectId = value(args, "--project");
    const environment = value(args, "--environment") as "development" | "staging" | "production";
    if (!baseUrl || !projectId || !["development", "staging", "production"].includes(environment)) throw new UsageError();
    await initializeProject(cwd, { baseUrl, projectId, environment });
    return print({ status: "initialized", secretsStored: false });
  }
  // Erst die Form des Befehls pruefen, dann die Konfiguration lesen: ein
  // halber Befehl soll die Nutzung zeigen, nicht "qkern.config.json fehlt".
  const wellFormed = args[0] === "status"
    || (args[0] === "schema" && args[1] === "pull")
    || (args[0] === "migration" && args[1] === "plan" && Boolean(args[2]))
    || (args[0] === "seed" && (!args[1] || args[1] === "check"));
  if (!wellFormed) throw new UsageError();
  const config = await readConfig(cwd);
  if (args[0] === "status") {
    const response = await fetch(`${config.baseUrl}/api/health`, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`QKERN status failed with HTTP ${response.status}.`);
    return print({ status: "reachable", projectId: config.projectId, environment: config.environment });
  }
  if (args[0] === "schema" && args[1] === "pull") {
    const key = io.env.QKERN_PROJECT_KEY;
    if (!key) throw new Error("QKERN_PROJECT_KEY is required in the process environment.");
    const response = await fetch(`${config.baseUrl}/api/v1/projects/${encodeURIComponent(config.projectId)}/environments/${config.environment}/schema?schema=${encodeURIComponent(config.schema)}`, {
      headers: { "x-qkern-key": key }, redirect: "error", signal: AbortSignal.timeout(20_000),
    });
    const envelope = await response.json() as { data?: SchemaResult };
    if (!response.ok || !envelope.data) throw new Error(`Schema pull failed with HTTP ${response.status}.`);
    const target = resolveInside(cwd, config.typesFile);
    await writeFile(target, generateDatabaseTypes(envelope.data), { encoding: "utf8", mode: 0o600 });
    return print({ status: "generated", file: config.typesFile, secretsStored: false });
  }
  if (args[0] === "migration" && args[1] === "plan" && args[2]) {
    const file = resolveInside(cwd, args[2]);
    return print({ ...planMigration(await readFile(file, "utf8"), config.environment), file: args[2] });
  }
  if (args[0] === "seed" && (!args[1] || args[1] === "check")) {
    return print({ ...validateSeed(await readFile(resolveInside(cwd, config.seedFile), "utf8")), file: config.seedFile });
  }
  throw new UsageError();
}

function value(args: string[], name: string) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
