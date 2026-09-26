import { describe, expect, it } from "vitest";
import {
  createVaultFunctionSecretInspectorFromEnv,
  FunctionSecretInspectionError,
  VaultFunctionSecretInspector,
} from "@/lib/server/compute/function-secret-inspector";

const mount = new URL("https://vault.example.net/v1/secret");

function metadata(current: number, version: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    data: {
      current_version: current,
      created_time: "2026-09-01T00:00:00Z",
      custom_metadata: { owner: "billing" },
      versions: current > 0 ? { [String(current)]: { deletion_time: "", destroyed: false, ...version } } : {},
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function inspector(fetchFn: typeof fetch) {
  return new VaultFunctionSecretInspector({
    vaultKvUrl: mount,
    tokenProvider: { getToken: () => "s.root-token-for-tests" },
    fetchFn,
  });
}

describe("VaultFunctionSecretInspector", () => {
  it("reads the metadata endpoint and never the data endpoint", async () => {
    const seen: string[] = [];
    const status = await inspector(async (input) => {
      seen.push(String(input));
      return metadata(3);
    }).hasSecret("vault:functions/stripe");
    expect(status).toBe("present");
    expect(seen).toEqual(["https://vault.example.net/v1/secret/metadata/functions/stripe"]);
    expect(seen.some((url) => url.includes("/data/"))).toBe(false);
  });

  it("maps 404 to missing and 403 to forbidden", async () => {
    expect(await inspector(async () => new Response("{}", { status: 404 })).hasSecret("vault:functions/gone"))
      .toBe("missing");
    expect(await inspector(async () => new Response("{}", { status: 403 })).hasSecret("vault:functions/other"))
      .toBe("forbidden");
  });

  it("treats a deleted or destroyed current version as missing", async () => {
    expect(await inspector(async () => metadata(2, { deletion_time: "2026-09-02T00:00:00Z" }))
      .hasSecret("vault:functions/rotated")).toBe("missing");
    expect(await inspector(async () => metadata(2, { destroyed: true }))
      .hasSecret("vault:functions/rotated")).toBe("missing");
  });

  it("answers a reference outside the vault path rule with forbidden and no request", async () => {
    let calls = 0;
    const service = inspector(async () => { calls += 1; return metadata(1); });
    for (const reference of ["file:/etc/passwd", "vault:../escape", "vault:", "STRIPE_KEY", "vault:a//b", "vault:/sys/policy"]) {
      expect(await service.hasSecret(reference), reference).toBe("forbidden");
    }
    expect(calls).toBe(0);
  });

  it("raises a typed error without path or vault message on network failure", async () => {
    const error = await inspector(async () => {
      throw new Error("connect ECONNREFUSED vault.example.net:8200");
    }).hasSecret("vault:functions/stripe").catch((value: unknown) => value);
    expect(error).toBeInstanceOf(FunctionSecretInspectionError);
    const serialized = JSON.stringify({ message: (error as Error).message, cause: (error as Error).cause });
    expect(serialized).not.toContain("functions/stripe");
    expect(serialized).not.toContain("ECONNREFUSED");
  });

  it("raises a typed error on a server error or a response that is not metadata", async () => {
    for (const response of [
      () => new Response("{}", { status: 500, headers: { "content-type": "application/json" } }),
      () => new Response("<html/>", { status: 200, headers: { "content-type": "text/html" } }),
      () => new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "content-type": "application/json" } }),
    ]) {
      await expect(inspector(async () => response()).hasSecret("vault:functions/stripe"))
        .rejects.toBeInstanceOf(FunctionSecretInspectionError);
    }
  });

  it("returns exactly one word and nothing of the metadata", async () => {
    const status = await inspector(async () => metadata(7)).hasSecret("vault:functions/stripe");
    expect(status).toBe("present");
    expect(typeof status).toBe("string");
  });

  it("sends the token only as a header and forbids redirects", async () => {
    let init: RequestInit | undefined;
    let url = "";
    await inspector(async (input, options) => {
      url = String(input);
      init = options as RequestInit;
      return metadata(1);
    }).hasSecret("vault:functions/stripe");
    expect(url).not.toContain("root-token");
    expect((init?.headers as Record<string, string>)["x-vault-token"]).toBe("s.root-token-for-tests");
    expect(init?.redirect).toBe("error");
    expect(init?.method).toBe("GET");
  });

  it("is absent without vault configuration and refuses half a configuration", () => {
    expect(createVaultFunctionSecretInspectorFromEnv({})).toBeNull();
    expect(() => createVaultFunctionSecretInspectorFromEnv({ QKERN_WEBHOOK_VAULT_KV_URL: mount.toString() }))
      .toThrow(FunctionSecretInspectionError);
    expect(createVaultFunctionSecretInspectorFromEnv({
      QKERN_FUNCTIONS_VAULT_KV_URL: mount.toString(), QKERN_VAULT_TOKEN_FILE: "/run/qkern/vault-token",
    })).toBeInstanceOf(VaultFunctionSecretInspector);
  });

  it("refuses plaintext HTTP in production", () => {
    expect(() => new VaultFunctionSecretInspector({
      vaultKvUrl: new URL("http://vault.example.net/v1/secret"),
      tokenProvider: { getToken: () => "s.token" },
      production: true,
    })).toThrow(FunctionSecretInspectionError);
  });
});
