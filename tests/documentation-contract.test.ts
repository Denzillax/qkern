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
    expect(handbook).toContain(packageJson.version);
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
});
