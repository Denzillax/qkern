import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseGuide } from "@/lib/docs/markdown";
import { guidePath, pageBySlug } from "@/lib/docs/pages";
import { qkernOpenAPI } from "@/lib/openapi";
import { USAGE } from "@/cli/src/commands";

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
    for (const block of await codeBlocks("schnellstart")) {
      for (const m of block.code.matchAll(/npm run ([\w:-]+)/g)) expect(pkg.scripts, `npm run ${m[1]} gibt es nicht`).toHaveProperty(m[1]);
      for (const m of block.code.matchAll(/npm run qkern -- (\w+(?: \w+)?)/g)) expect(cli.has(m[1]), `CLI-Befehl ${m[1]} gibt es nicht`).toBe(true);
      for (const m of block.code.matchAll(/(?:Copy-Item|cat|cp) ([\w./-]+)/g)) expect(existsSync(path.resolve(process.cwd(), m[1])), `${m[1]} fehlt`).toBe(true);
      for (const m of block.code.matchAll(/\/api(\/v1\/projects\/<projekt-id>\/environments\/development\/tables\/\w+\/rows)/g)) {
        const generic = m[1].replace("<projekt-id>", "{projectId}").replace("/development/", "/{environment}/").replace(/\/tables\/\w+\//, "/tables/{table}/");
        expect(openapiPaths, `${generic} steht nicht in der OpenAPI`).toContain(generic);
      }
    }
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
    const raw = await readFile(guidePath("de", pageBySlug("schnellstart")!), "utf8");
    expect(raw).toContain("{{node}}");
    expect(raw).not.toMatch(/Node\.js \d/);
    expect(raw).not.toMatch(/\b2\.\d\d\.\d\b/);
  });
});
