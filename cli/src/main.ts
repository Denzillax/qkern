#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import {
  generateDatabaseTypes,
  initializeProject,
  planMigration,
  readConfig,
  resolveInside,
  validateSeed,
  type SchemaResult,
} from "./core.js";

async function main(args = process.argv.slice(2)) {
  const cwd = process.cwd();
  if (args[0] === "init") {
    const baseUrl = value(args, "--url");
    const projectId = value(args, "--project");
    const environment = value(args, "--environment") as "development" | "staging" | "production";
    if (!baseUrl || !projectId || !["development", "staging", "production"].includes(environment)) usage();
    await initializeProject(cwd, { baseUrl, projectId, environment });
    return print({ status: "initialized", secretsStored: false });
  }
  const config = await readConfig(cwd);
  if (args[0] === "status") {
    const response = await fetch(`${config.baseUrl}/api/health`, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`QKERN status failed with HTTP ${response.status}.`);
    return print({ status: "reachable", projectId: config.projectId, environment: config.environment });
  }
  if (args[0] === "schema" && args[1] === "pull") {
    const key = process.env.QKERN_PROJECT_KEY;
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
  usage();
}

function value(args: string[], name: string) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
function print(value: unknown) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
function usage(): never { throw new Error("Usage: qkern init|status|schema pull|migration plan <file>|seed check"); }

main().catch(() => { process.stderr.write("QKERN CLI command failed.\n"); process.exitCode = 1; });
