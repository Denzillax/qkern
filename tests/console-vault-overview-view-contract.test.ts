import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, REAL_VIEWS } from "@/components/console/navigation";
import { VAULT_OPERATOR_STEPS, VAULT_OVERVIEW_SCOPE } from "@/lib/console/vault-overview-texts";

/**
 * Die harte Grenze der Vault-Seite (2.58) als Vertrag am Quelltext:
 * **QKERN zeigt nie einen Geheimniswert und nimmt nie einen entgegen.**
 *
 * Eine Ansicht, die einen Wert entgegennehmen wollte, braeuchte ein
 * Eingabefeld; eine, die einen zeigen wollte, braeuchte den Datenendpunkt. Der
 * Vertrag verlangt, dass beides im Quelltext fehlt -- nicht, dass es zur
 * Laufzeit ungenutzt bleibt.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

const VIEW = "components/console/vault-overview-view.tsx";
const ROUTE = "app/api/v1/projects/[projectId]/environments/[environment]/compute/secrets/route.ts";

describe("console vault overview view contract", () => {
  it("is a real view and no longer a placeholder", async () => {
    expect(REAL_VIEWS).toContain("int-vault");
    expect(isPlaceholder("int-vault" as never)).toBe(false);
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "int-vault": return <VaultOverviewView');
    const navigation = await source("components/console/navigation.ts");
    expect(navigation).toContain('{ id: "int-vault", label: "Vault" }');
    // Das Versprechen des Platzhalters ist weg, nicht bloss umformuliert.
    expect(navigation).not.toContain("Geheimnisse verwalten.");
  });

  it("has no field that could take a secret and no write verb", async () => {
    const view = await source(VIEW);
    // Kein Eingabefeld: kein <input>, kein <textarea>, kein contentEditable.
    expect(view).not.toMatch(/<input\b|<textarea\b|contentEditable/i);
    expect(view).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
    expect(view).not.toMatch(/\bonSubmit\b|<form\b/i);
    // Der Datenendpunkt eines KV-v2-Mounts kommt in der Ansicht nicht vor.
    expect(view).not.toMatch(/\/v1\/secret|["'`][^"'`]*\/data\/|x-vault-token/);
    // Und kein Muster, das einen Schluessel als Hexkette zeigen koennte.
    expect(view).not.toMatch(/[0-9a-f]{64}/i);
    expect(view).not.toMatch(/\b(?:value|secretValue|plaintext|material|version|versions)\b\s*[:?]/);
    // Gelesen wird genau eine Route, und nur lesend.
    expect(view).toContain("/compute/secrets`");
    expect(view).toContain("cache: \"no-store\"");
    expect(view).toContain("StableLabel");
  });

  it("shows every state and says out loud what it cannot list", async () => {
    const view = await source(VIEW);
    for (const state of ["loading", "ready", "unavailable", "error"]) {
      expect(view, state).toContain(`"${state}"`);
    }
    // Leerzustand, Zaehler je Zustand und der Pruefzeitpunkt.
    expect(view).toContain("rows.length === 0");
    expect(view).toContain("counts[id]");
    expect(view).toContain("checkedAt");
    // Die Ehrlichkeitssaetze stehen in der Ansicht, nicht nur im Kommentar.
    for (const sentence of VAULT_OVERVIEW_SCOPE) {
      expect(view.includes("VAULT_OVERVIEW_SCOPE"), sentence).toBe(true);
    }
    expect(VAULT_OVERVIEW_SCOPE.some((sentence) => sentence.includes("listet den Vault nicht auf"))).toBe(true);
    expect(VAULT_OPERATOR_STEPS.some((step) => step.body.includes("<mount>/metadata/<pfad>"))).toBe(true);
    expect(VAULT_OPERATOR_STEPS[0].body).toContain("QKERN zeigt keinen Wert an und nimmt keinen entgegen.");
    expect(view).toContain("VAULT_OPERATOR_STEPS");
  });

  it("keeps the route read-only and off the data endpoint", async () => {
    const route = await source(ROUTE);
    expect(route).not.toMatch(/export const (?:POST|PUT|PATCH|DELETE)/);
    expect(route).not.toMatch(/["'`][^"'`]*\/data\/|x-vault-token|[0-9a-f]{64}/i);
    expect(route).toContain('computeNoStore({ error: "Invalid compute request" }, 400)');
    expect(route).toContain("VAULT_NOT_CONFIGURED");
    // Der einzige Vault-Client bleibt der Inspektor aus 2.38.
    expect(route).toContain("getFunctionSecretInspector");
    const inspector = await source("lib/server/compute/function-secret-inspector.ts");
    expect(inspector).toContain("/metadata/");
    expect(inspector).not.toMatch(/pathname\s*=\s*`[^`]*\/data\//);
  });

  it("keeps the texts free of anything that looks like a value", async () => {
    const texts = await source("lib/console/vault-overview-texts.ts");
    expect(texts).not.toMatch(/[0-9a-f]{64}/i);
    expect(texts).not.toMatch(/fetch\(|import .* from/);
  });
});
