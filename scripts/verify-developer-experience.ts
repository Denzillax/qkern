import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { generateDatabaseTypes, initializeProject, planMigration, validateSeed } from "../cli/src/core.js";

const run = promisify(execFile);

async function verify() {
  const repository = process.cwd();
  const directory = await mkdtemp(path.join(tmpdir(), "qkern-dx-"));
  try {
    await initializeProject(directory, {
      baseUrl: "http://localhost:3000",
      projectId: "project-fresh-install",
      environment: "development",
    });
    const config = await readFile(path.join(directory, "qkern.config.json"), "utf8");
    if (/password|access.?token|api.?key|secret/i.test(config)) throw new Error("Generated configuration contains a credential field.");

    const types = generateDatabaseTypes({
      source: "postgres",
      schema: "public",
      tables: [{
        name: "notes", kind: "table", rowSecurityEnabled: true,
        columns: [{ name: "id", dataType: "uuid", nullable: false, identity: true, generated: false, sensitive: false }],
      }],
    });
    await writeFile(path.join(directory, "qkern", "types", "database.ts"), types, { encoding: "utf8", mode: 0o600 });
    if (!types.includes("notes") || !types.includes("id: string")) throw new Error("Type generation contract failed.");
    if (!planMigration("CREATE TABLE public.notes (id uuid PRIMARY KEY)", "development").valid) {
      throw new Error("Migration plan contract failed.");
    }
    if (!validateSeed("INSERT INTO public.notes (id) VALUES ('00000000-0000-0000-0000-000000000001');").valid) {
      throw new Error("Seed contract failed.");
    }

    const sdkPackage = JSON.parse(await readFile(path.join(repository, "sdk", "typescript", "package.json"), "utf8")) as {
      exports?: { "."?: { import?: string; types?: string } };
    };
    const sdkEntry = path.join(repository, "sdk", "typescript", sdkPackage.exports?.["."]?.import ?? "");
    const sdkTypes = path.join(repository, "sdk", "typescript", sdkPackage.exports?.["."]?.types ?? "");
    const sdkSource = await readFile(sdkEntry, "utf8");
    await readFile(sdkTypes, "utf8");
    if (sdkSource.includes('from "@/')) throw new Error("SDK distribution contains a repository alias.");
    const sdk = await import(pathToFileURL(sdkEntry).href) as { createQkernClient?: (input: unknown) => unknown };
    if (typeof sdk.createQkernClient !== "function") throw new Error("SDK distribution entry is not importable.");

    const cliEntry = path.join(repository, "cli", "dist", "main.js");
    const cliSource = await readFile(cliEntry, "utf8");
    if (!cliSource.startsWith("#!/usr/bin/env node") || cliSource.includes('from "@/')) {
      throw new Error("CLI distribution contract failed.");
    }
    const result = await run(process.execPath, [cliEntry, "seed", "check"], {
      cwd: directory,
      env: { ...process.env, QKERN_PROJECT_KEY: "" },
      timeout: 20_000,
      windowsHide: true,
    });
    const output = JSON.parse(result.stdout) as { valid?: boolean; executes?: boolean };
    if (!output.valid || output.executes !== false) throw new Error("CLI fresh-project smoke contract failed.");

    process.stdout.write(`${JSON.stringify({
      status: "verified",
      platform: process.platform,
      architecture: process.arch,
      node: process.versions.node,
      secretFreeConfig: true,
      sdkEsmAndTypes: true,
      cliFreshProject: true,
      executesSql: false,
    }, null, 2)}\n`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

verify().catch((error: unknown) => {
  const reason = error instanceof Error
    ? ` ${error.message.replace(/[^A-Za-z0-9 .,:'()/_-]/g, "?").slice(0, 240)}` : "";
  process.stderr.write(`QKERN developer-experience verification failed.${reason}\n`);
  process.exitCode = 1;
});
