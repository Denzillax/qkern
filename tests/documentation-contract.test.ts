import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFile(path.resolve(process.cwd(), file), "utf8");

describe("living documentation contract", () => {
  it("binds status and handbook to the packaged version", async () => {
    const packageJson = JSON.parse(await read("package.json")) as { version: string };
    const [status, handbook, release] = await Promise.all([
      read("STATUS.md"), read("docs/HANDBUCH.md"), read("docs/RELEASE_1.8_ALPHA1.md"),
    ]);
    expect(status).toContain(`Release: \`${packageJson.version}\``);
    expect(handbook).toContain(packageJson.version);
    expect(release).toContain("Usage Metering & Quotas");
    expect(release).toContain("Idempotenz");
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
    expect(handoff).toContain("1.8.0-alpha.1");
    expect(index).toContain("RELEASE_1.8_ALPHA1.md");
    expect(index).toContain("USAGE_METERING.md");
    expect(handoff).toContain("0028_usage_metering.sql");
    expect(handoff).toContain("USAGE_METERING.md");
    expect(compute).toContain("DNS-Pinning");
    expect(agents).toMatch(/Always\s+keep `STATUS\.md` honest/);
  });
});
