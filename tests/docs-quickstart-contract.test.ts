import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseGuide } from "@/lib/docs/markdown";
import { guidePath, pageBySlug } from "@/lib/docs/pages";
import { qkernOpenAPI } from "@/lib/openapi";
import { USAGE } from "@/cli/src/commands";

/** API-Pfade aus einem Codeblock, auf die Schreibweise der OpenAPI gebracht. */
function apiPaths(code: string): string[] {
  return [...code.matchAll(/\/api(\/v1\/[^\s"'?)]+)/g)].map((m) =>
    m[1]
      .replace("<projekt-id>", "{projectId}")
      .replace("/development/", "/{environment}/")
      .replace(/\/tables\/[^/]+\//, "/tables/{table}/"),
  );
}

/**
 * Jedes Kommando im Schnellstart existiert wirklich. Ein Leser, der einen
 * Befehl abtippt, den es nicht gibt, verliert das Vertrauen an Schritt 3.
 */
describe("docs quickstart contract", () => {
  async function codeBlocks(slug: string) {
    const doc = parseGuide(await readFile(guidePath("de", pageBySlug(slug)!), "utf8"));
    return doc.blocks.flatMap((b) => (b.kind === "code" ? [b] : []));
  }

  it("uses the same commands in Schnellstart and Erstes Backend", async () => {
    const a = (await codeBlocks("schnellstart")).map((b) => b.code);
    const b = (await codeBlocks("erstes-backend")).map((b) => b.code);
    expect(b).toEqual(a);
  });

  it("names only npm scripts, files, CLI commands and API paths that exist", async () => {
    const pkg = JSON.parse(await readFile(path.resolve(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
    const cli = new Set([...USAGE.matchAll(/^\s{2}(\w+(?: \w+)?)/gm)].map((m) => m[1]));
    const openapiPaths = Object.keys(qkernOpenAPI.paths);
    let apiCount = 0;
    for (const block of await codeBlocks("schnellstart")) {
      for (const m of block.code.matchAll(/npm run ([\w:-]+)/g)) expect(pkg.scripts, `npm run ${m[1]} gibt es nicht`).toHaveProperty(m[1]);
      for (const m of block.code.matchAll(/npm run qkern -- (\w+(?: \w+)?)/g)) expect(cli.has(m[1]), `CLI-Befehl ${m[1]} gibt es nicht`).toBe(true);
      for (const m of block.code.matchAll(/\b(?:Copy-Item|cat|cp) ([\w./-]+)/g)) expect(existsSync(path.resolve(process.cwd(), m[1])), `${m[1]} fehlt`).toBe(true);
      for (const generic of apiPaths(block.code)) {
        apiCount += 1;
        expect(openapiPaths, `${generic} steht nicht in der OpenAPI`).toContain(generic);
      }
    }
    expect(apiCount, "Der Schnellstart ruft keinen API-Pfad auf").toBeGreaterThan(0);
  });

  it("maps API paths generically, so a typo in the path fails", () => {
    const openapiPaths = Object.keys(qkernOpenAPI.paths);
    const good = apiPaths('"http://localhost:3000/api/v1/projects/<projekt-id>/environments/development/tables/notes/rows?limit=10"');
    const typo = apiPaths('"http://localhost:3000/api/v1/projects/<projekt-id>/environments/development/tables/notes/row?limit=10"');
    expect(good).toEqual(["/v1/projects/{projectId}/environments/{environment}/tables/{table}/rows"]);
    expect(openapiPaths).toContain(good[0]);
    expect(typo).toHaveLength(1);
    expect(openapiPaths).not.toContain(typo[0]);
  });

  it("names a postgres service and an SDK package that exist", async () => {
    const code = (await codeBlocks("schnellstart")).map((b) => b.code).join("\n");
    expect(code).toContain("docker compose exec postgres");
    const compose = await readFile(path.resolve(process.cwd(), "docker-compose.yml"), "utf8");
    expect(compose, "docker-compose.yml hat keinen Dienst postgres").toMatch(/^ {2}postgres:\s*$/m);
    const installs = [...code.matchAll(/npm install (@[\w-]+\/[\w-]+)/g)].map((m) => m[1]);
    expect(installs).toContain("@qkern/sdk");
    const sdk = JSON.parse(await readFile(path.resolve(process.cwd(), "sdk/typescript/package.json"), "utf8")) as { name: string };
    for (const name of installs) expect(sdk.name, `${name} ist nicht das SDK-Paket`).toBe(name);
  });

  it("keeps versions as placeholders", async () => {
    for (const slug of ["schnellstart", "erstes-backend"]) {
      const raw = await readFile(guidePath("de", pageBySlug(slug)!), "utf8");
      expect(raw, `${slug}: {{node}} fehlt`).toContain("{{node}}");
      expect(raw, `${slug}: Node-Version als Zahl`).not.toMatch(/Node\.js \d/);
      expect(raw, `${slug}: Version als Zahl`).not.toMatch(/\bv\d+\.\d+\.\d+\b/);
      expect(raw, `${slug}: QKERN-Version als Zahl`).not.toMatch(/\b2\.\d\d\.\d\b/);
      expect(raw, `${slug}: QKERN-Version als Zahl`).not.toMatch(/\b2\.\d\d\b/);
    }
  });
});
