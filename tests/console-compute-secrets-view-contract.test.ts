import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, REAL_VIEWS } from "@/components/console/navigation";

/**
 * Die Secrets-Ansicht (2.38) liest nur. Sie schreibt nicht, ruft keinen
 * Datenendpunkt eines Vaults und kennt kein Feld, das einen Wert tragen koennte.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

describe("console compute secrets view contract", () => {
  it("is a real view and no longer a placeholder", async () => {
    expect(REAL_VIEWS).toContain("compute-secrets");
    expect(isPlaceholder("compute-secrets" as never)).toBe(false);
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "compute-secrets": return <ComputeSecretsView');
  });

  it("only reads and never asks for a value", async () => {
    const view = await source("components/console/compute-secrets-view.tsx");
    expect(view).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
    expect(view).not.toMatch(/\/v1\/secret|\/data\/|\/metadata\//);
    expect(view).not.toMatch(/\b(?:value|secretValue|plaintext|version|versions)\b\s*[:?]/);
    expect(view).toContain("/secrets`");
    expect(view).toContain("Werte zeigt QKERN nie. Anlegen und Ändern von Secrets geschieht im Vault; die Konsole prüft nur, ob eine Referenz aufgelöst wird.");
    expect(view).toContain("StableLabel");
  });

  it("keeps the route free of value-bearing fields", async () => {
    const route = await source("app/api/v1/projects/[projectId]/environments/[environment]/compute/functions/[functionId]/secrets/route.ts");
    expect(route).not.toMatch(/export const (?:POST|PUT|PATCH|DELETE)/);
    // Je Referenz genau zwei Felder, und die Antwort traegt nur Liste und Zeitpunkt.
    expect(route).toContain("ref, status: await vault.hasSecret(ref),");
    expect(route).toContain("data: { secrets, checkedAt: new Date().toISOString() }");
    const inspector = await source("lib/server/compute/function-secret-inspector.ts");
    expect(inspector).toContain("/metadata/");
    expect(inspector).not.toMatch(/pathname\s*=\s*`[^`]*\/data\//);
  });
});
