import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("production dependency security policy", () => {
  it("pins the audited framework and patched transitive security boundaries", async () => {
    const packageJson = JSON.parse(
      await readFile(path.resolve(process.cwd(), "package.json"), "utf8"),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      overrides: Record<string, string>;
    };
    expect(packageJson.dependencies.next).toBe("16.2.12");
    expect(packageJson.dependencies.tsx).toBe("^4.21.0");
    expect(packageJson.devDependencies.tsx).toBeUndefined();
    expect(packageJson.overrides).toEqual({
      "fast-uri": "4.1.2",
      "hono": "4.12.34",
      "ip-address": "10.4.0",
      postcss: "8.5.25",
      sharp: "0.35.3",
    });
  });
});
