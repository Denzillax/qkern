import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { USAGE, run } from "@/cli/src/commands";

/**
 * Gefunden nach der ersten Veroeffentlichung von @qkern/cli (2.16): `npx qkern
 * --help` antwortete nur "QKERN CLI command failed." und verschluckte die
 * Nutzung. Seit 2.17 zeigt der leere Aufruf und `help` die Nutzung auf stdout
 * mit Exit 0; ein unbekannter oder unvollstaendiger Befehl zeigt sie auf
 * stderr mit Exit 1; jeder andere Fehler nennt seinen Grund.
 */
async function invoke(args: string[], env: Record<string, string> = {}) {
  const cwd = await mkdtemp(path.join(tmpdir(), "qkern-cli-usage-"));
  let stdout = ""; let stderr = "";
  const code = await run(args, { cwd, env, stdout: (t) => { stdout += t; }, stderr: (t) => { stderr += t; } });
  return { code, stdout, stderr };
}

describe("qkern CLI usage", () => {
  it("prints usage on stdout with exit 0 for help, --help, -h and no arguments", async () => {
    for (const args of [[], ["help"], ["--help"], ["-h"]]) {
      const result = await invoke(args);
      expect(result.code).toBe(0);
      expect(result.stdout).toBe(USAGE);
      expect(result.stderr).toBe("");
    }
    expect(USAGE).toContain("migration plan <file>");
    expect(USAGE).toContain("seed check");
  });

  it("prints usage on stderr with exit 1 for an unknown or incomplete command", async () => {
    for (const args of [["bogus"], ["init"], ["init", "--url", "http://x", "--project", "p", "--environment", "nope"], ["schema"]]) {
      const result = await invoke(args);
      expect(result.code, args.join(" ")).toBe(1);
      expect(result.stderr, args.join(" ")).toBe(USAGE);
      expect(result.stdout).toBe("");
    }
  });

  it("names the reason of any other failure instead of a bare 'command failed'", async () => {
    // Ohne qkern.json im Verzeichnis kann `status` keine Konfiguration lesen.
    const result = await invoke(["status"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^QKERN CLI command failed: .+/);
    expect(result.stderr).not.toBe("QKERN CLI command failed.\n");
  });
});
