import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  FunctionSecretInspectionError,
  type FunctionSecretInspector,
} from "@/lib/server/compute/function-secret-inspector";
import {
  collectVaultSecretOverview,
  countVaultReferences,
  groupSecretReferences,
  type VaultSecretSources,
} from "@/lib/server/compute/vault-secret-overview";

/**
 * Die Sammlung der Vault-Uebersicht (2.58): gruppieren, je Referenz genau
 * einmal fragen, und nichts halten, was ein Geheimnis sein koennte.
 */

const EMPTY: VaultSecretSources = { functions: [], webhooks: [], databaseWebhooks: [] };

function sources(overrides: Partial<VaultSecretSources>): VaultSecretSources {
  return { ...EMPTY, ...overrides };
}

function inspector(statuses: Record<string, "present" | "missing" | "forbidden">) {
  const hasSecret = vi.fn(async (ref: string) => statuses[ref] ?? "missing");
  return { hasSecret, inspector: { hasSecret } as FunctionSecretInspector };
}

describe("vault secret overview", () => {
  it("names both users of a reference that two places share, and asks once", async () => {
    const shared = "vault:webhooks/orders";
    const { hasSecret, inspector: vault } = inspector({ [shared]: "present" });
    const rows = await collectVaultSecretOverview(sources({
      functions: [{ id: "f1", name: "billing", secretRefs: [shared] }],
      webhooks: [{ id: "w1", name: "orders", signingSecretRef: shared }],
    }), vault);

    expect(rows).toHaveLength(1);
    expect(rows[0].ref).toBe(shared);
    expect(rows[0].status).toBe("present");
    expect(rows[0].users).toEqual([
      { kind: "function", id: "f1", name: "billing" },
      { kind: "webhook", id: "w1", name: "orders" },
    ]);
    // Ein Geheimnis, zwei Benutzer, eine Frage an den Vault.
    expect(hasSecret).toHaveBeenCalledTimes(1);
  });

  it("collects all three sources and counts per distinct reference", async () => {
    const { inspector: vault } = inspector({
      "vault:functions/stripe": "present",
      "vault:webhooks/orders": "missing",
      "vault:webhooks/rows": "present",
    });
    const rows = await collectVaultSecretOverview(sources({
      functions: [{ id: "f1", name: "billing", secretRefs: ["vault:functions/stripe"] }],
      webhooks: [{ id: "w1", name: "orders", signingSecretRef: "vault:webhooks/orders" }],
      databaseWebhooks: [{ id: "d1", webhookId: "w9", name: "zeilen", signingSecretRef: "vault:webhooks/rows" }],
    }), vault);

    expect(rows.map((row) => [row.ref, row.users[0].kind, row.status])).toEqual([
      ["vault:functions/stripe", "function", "present"],
      ["vault:webhooks/orders", "webhook", "missing"],
      ["vault:webhooks/rows", "database-webhook", "present"],
    ]);
    expect(countVaultReferences(rows)).toEqual({ total: 3, present: 2, missing: 1, forbidden: 0 });
  });

  it("does not name the outgoing definition of a database webhook a second time", () => {
    // Seit 2.50 besitzt ein Datenbank-Webhook auch eine Zeile aus 0032.
    // Dieselbe Referenz unter zwei Namen saehe nach zwei Geheimnissen aus.
    const groups = groupSecretReferences(sources({
      webhooks: [{ id: "w1", name: "zeilen-intern", signingSecretRef: "vault:webhooks/rows" }],
      databaseWebhooks: [{ id: "d1", webhookId: "w1", name: "zeilen", signingSecretRef: "vault:webhooks/rows" }],
    }));
    expect(groups).toEqual([{
      ref: "vault:webhooks/rows",
      users: [{ kind: "database-webhook", id: "d1", name: "zeilen" }],
    }]);
  });

  it("collapses a reference that one definition declares twice", () => {
    const groups = groupSecretReferences(sources({
      functions: [{ id: "f1", name: "billing", secretRefs: ["vault:functions/stripe", "vault:functions/stripe"] }],
    }));
    expect(groups).toHaveLength(1);
    expect(groups[0].users).toHaveLength(1);
  });

  it("reports a reference outside the path grammar as forbidden without asking the vault", async () => {
    // Die Pfadregel wohnt im Inspektor aus 2.38; diese Naht erfindet keine
    // zweite. Geprueft wird hier, dass sie durchgereicht wird.
    const asked: string[] = [];
    const vault: FunctionSecretInspector = {
      hasSecret: async (ref) => {
        asked.push(ref);
        return /^vault:[A-Za-z0-9/_-]+$/.test(ref) ? "present" : "forbidden";
      },
    };
    const rows = await collectVaultSecretOverview(sources({
      functions: [{ id: "f1", name: "billing", secretRefs: ["STRIPE_KEY", "vault:../sys/policies/acl/root"] }],
    }), vault);
    expect(rows.map((row) => [row.ref, row.status])).toEqual([
      ["STRIPE_KEY", "forbidden"],
      ["vault:../sys/policies/acl/root", "forbidden"],
    ]);
    expect(countVaultReferences(rows)).toEqual({ total: 2, present: 0, missing: 0, forbidden: 2 });
    expect(asked).toHaveLength(2);
  });

  it("lets an unreachable vault fail instead of guessing a status", async () => {
    const vault: FunctionSecretInspector = {
      hasSecret: async () => { throw new FunctionSecretInspectionError(); },
    };
    await expect(collectVaultSecretOverview(sources({
      functions: [{ id: "f1", name: "billing", secretRefs: ["vault:functions/stripe"] }],
    }), vault)).rejects.toBeInstanceOf(FunctionSecretInspectionError);
  });

  it("returns nothing at all for an environment without a single reference", async () => {
    const { hasSecret, inspector: vault } = inspector({});
    const rows = await collectVaultSecretOverview(EMPTY, vault);
    expect(rows).toEqual([]);
    expect(countVaultReferences(rows)).toEqual({ total: 0, present: 0, missing: 0, forbidden: 0 });
    expect(hasSecret).not.toHaveBeenCalled();
  });

  it("carries no field that could hold a value and never lists the vault", async () => {
    const source = await readFile(
      path.resolve(process.cwd(), "lib/server/compute/vault-secret-overview.ts"), "utf8");
    // Kein Feld, das einen Wert tragen koennte, und kein zweiter Vault-Client.
    expect(source).not.toMatch(/\b(?:value|secret|secretValue|plaintext|material|version|versions)\b\s*[:?]/i);
    expect(source).not.toMatch(/\bfetch\b|\/data\/|\/metadata\/|x-vault-token/);
    // Auflisten gibt es nicht: kein LIST, keine Rekursion ueber Vault-Pfade.
    expect(source).not.toMatch(/method:\s*["']LIST["']|listSecrets|\?list=true/i);
    // Der Status kommt ausschliesslich vom Inspektor aus 2.38.
    expect(source).toContain("inspector.hasSecret(group.ref)");
  });
});
