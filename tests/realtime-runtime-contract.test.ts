import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Realtime standalone runtime contract", () => {
  it("is explicit, loopback-only and refuses the incomplete production topology", async () => {
    const source = await readFile(new URL("../workers/realtime-runtime.ts", import.meta.url), "utf8");
    expect(source).toContain('QKERN_REALTIME_ENABLED !== "true"');
    expect(source).toContain('process.env.NODE_ENV === "production"');
    expect(source).toContain('runtimeModeFromEnv(process.env) !== "postgres"');
    expect(source).toContain('host: "127.0.0.1"');
    expect(source).toContain("QKERN_REALTIME_ALLOWED_ORIGINS");
    expect(source).toContain("QKERN_REALTIME_MAX_BUFFERED_BYTES");
    expect(source).not.toContain('host: "0.0.0.0"');
  });

  it("exposes the runtime through the package script without embedding credentials", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts.realtime).toBe("node --import tsx workers/realtime-runtime.ts");
    expect(packageJson.scripts.realtime).not.toMatch(/qk_(public|service)_/);
  });
});
