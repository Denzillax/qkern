import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFile(path.resolve(process.cwd(), file), "utf8");

/** Highest-numbered file in db/migrations, so the contract never names a fixed one. */
async function latestMigration(): Promise<string> {
  const files = await readdir(path.resolve(process.cwd(), "db/migrations"));
  return files.filter((file) => file.endsWith(".sql")).sort().at(-1)!;
}

describe("living documentation contract", () => {
  it("binds status and handbook to the packaged version", async () => {
    const packageJson = JSON.parse(await read("package.json")) as { version: string };
    const [status, handbook] = await Promise.all([read("STATUS.md"), read("docs/HANDBUCH.md")]);
    expect(status).toContain(`Release: \`${packageJson.version}\``);
    // Die Kopfzeile, nicht irgendeine Stelle im Text. `toContain` auf der ganzen
    // Datei liess die Kopfzeile von `2.64.0` bis `2.72.0` auf 2.64.0 stehen: Es
    // genuegte, dass die laufende Version irgendwo im Handbuch vorkam, und das
    // tat sie, weil ein korrigierter Absatz sie nannte. Neun Releases lang war
    // die Zusage damit leer.
    const gilt = /^Dieses Handbuch gilt für `([0-9]+\.[0-9]+\.[0-9]+)`/m.exec(handbook);
    expect(gilt?.[1]).toBe(packageJson.version);
  });

  it("keeps the current release note discoverable from the packaged version", async () => {
    // Earlier revisions named one release file and one migration literally, so
    // the contract had to be hand-edited on every cut and silently described a
    // superseded state until someone remembered. Both are derived now.
    const packageJson = JSON.parse(await read("package.json")) as { version: string };
    const index = await read("docs/INDEX.md");
    const [major, minor] = packageJson.version.split(".");
    expect(index).toMatch(new RegExp(`RELEASE_${major}\\.${minor}(_[A-Z0-9]+)?\\.md`));
  });

  it("keeps stages, module boundaries and maintenance rules discoverable", async () => {
    const [index, stages, modules, maintenance, handoff, agents, compute] = await Promise.all([
      read("docs/INDEX.md"), read("docs/STUFENPLAN.md"), read("docs/MODULES.md"),
      read("docs/DOCS_MAINTENANCE.md"), read("docs/CLAUDE_HANDOFF.md"), read("AGENTS.md"),
      read("docs/COMPUTE_CONTRACTS.md"),
    ]);
    expect(index).toMatch(/STATUS\.md[\s\S]*HANDBUCH\.md[\s\S]*STUFENPLAN\.md/);
    expect(stages).toMatch(/Stufe 1\.1[\s\S]*Stufe 1\.2[\s\S]*Stufe 2\.0/);
    expect(modules).toContain("modularer Monolith");
    expect(maintenance).toContain("tests/documentation-contract.test.ts");
    const packageJson = JSON.parse(await read("package.json")) as { version: string };
    expect(handoff).toContain(packageJson.version);
    expect(index).toContain("USAGE_METERING.md");
    // The handoff must name the newest migration, otherwise the next agent
    // starts from a state that no longer exists.
    expect(handoff).toContain(await latestMigration());
    expect(compute).toContain("DNS-Pinning");
    expect(agents).toMatch(/Always\s+keep `STATUS\.md` honest/);
  });

  it("keeps the parity ladder on the released version", async () => {
    // PARITAET.md promises to move with every release that changes a row. It
    // stood still from 1.91.0 to 2.64.0, 73 releases, because nothing read its
    // header. The header now has to name the version package.json ships.
    const [ladder, packageJson] = await Promise.all([
      read("docs/PARITAET.md"),
      read("package.json").then((text) => JSON.parse(text) as { version: string }),
    ]);
    const stand = /^> Stand: `([0-9]+\.[0-9]+\.[0-9]+)`/m.exec(ladder);
    expect(stand?.[1]).toBe(packageJson.version);
  });
});
