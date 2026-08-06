import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { VaultWebhookSecretProvider } from "@/lib/server/compute/webhook-secret-vault";
import { WebhookSigningError } from "@/lib/server/compute/webhook-signer";

const secret = randomBytes(32);
const mount = new URL("https://vault.example.net/v1/secret");

function kvResponse(body: unknown, init: { status?: number; contentType?: string } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": init.contentType ?? "application/json" },
  });
}

function provider(options: {
  fetchFn?: typeof fetch;
  token?: string;
  cacheTtlMs?: number;
  production?: boolean;
  now?: () => number;
} = {}) {
  return new VaultWebhookSecretProvider({
    vaultKvUrl: mount,
    tokenProvider: { getToken: () => options.token ?? "s.root-token-for-tests" },
    fetchFn: options.fetchFn ?? (async () => kvResponse({
      data: { data: { keyId: "orders-2026-08", secret: secret.toString("base64url") } },
    })),
    cacheTtlMs: options.cacheTtlMs ?? 0,
    production: options.production ?? false,
    ...(options.now ? { now: options.now } : {}),
  });
}

describe("VaultWebhookSecretProvider", () => {
  it("maps a reference onto the KV v2 data path", async () => {
    const seen: string[] = [];
    const key = await provider({
      fetchFn: async (input) => {
        seen.push(String(input));
        return kvResponse({
          data: { data: { keyId: "orders-2026-08", secret: secret.toString("base64url") } },
        });
      },
    }).resolve("vault:webhooks/orders");

    expect(seen).toEqual(["https://vault.example.net/v1/secret/data/webhooks/orders"]);
    expect(key?.keyId).toBe("orders-2026-08");
    expect(key?.secret.equals(secret)).toBe(true);
  });

  it("sends the token as a header and never in the URL", async () => {
    let request: RequestInit | undefined;
    let url = "";
    await provider({
      token: "s.a-very-secret-token",
      fetchFn: async (input, init) => {
        url = String(input);
        request = init as RequestInit;
        return kvResponse({
          data: { data: { keyId: "k", secret: secret.toString("base64url") } },
        });
      },
    }).resolve("vault:webhooks/orders");

    expect(url).not.toContain("a-very-secret-token");
    expect((request?.headers as Record<string, string>)["x-vault-token"])
      .toBe("s.a-very-secret-token");
    // Eine Umleitung koennte den Token an ein fremdes Ziel tragen.
    expect(request?.redirect).toBe("error");
    expect(request?.cache).toBe("no-store");
  });

  it("answers an unknown reference with null instead of an error", async () => {
    const missing = provider({ fetchFn: async () => kvResponse({ errors: [] }, { status: 404 }) });
    expect(await missing.resolve("vault:webhooks/gone")).toBeNull();
  });

  it("refuses a reference that is not a vault path", async () => {
    const service = provider();
    for (const reference of ["file:/etc/passwd", "vault:../escape", "vault:", "orders"]) {
      expect(await service.resolve(reference)).toBeNull();
    }
  });

  it("refuses a secret that is too short to sign with", async () => {
    // Sonst waere der Vault-Weg ein stiller Rueckschritt gegenueber dem
    // Umgebungs-Provider, der dieselbe Grenze zieht.
    const weak = provider({
      fetchFn: async () => kvResponse({
        data: { data: { keyId: "k", secret: randomBytes(8).toString("base64url") } },
      }),
    });
    await expect(weak.resolve("vault:webhooks/orders")).rejects.toBeInstanceOf(WebhookSigningError);
  });

  it("refuses a response that is not the expected shape", async () => {
    for (const body of [{ data: {} }, { data: { data: { keyId: "k" } } }, { secret: "x" }]) {
      const wrong = provider({ fetchFn: async () => kvResponse(body) });
      await expect(wrong.resolve("vault:webhooks/orders"))
        .rejects.toBeInstanceOf(WebhookSigningError);
    }
  });

  it("refuses a response that is not JSON", async () => {
    const html = provider({
      fetchFn: async () => new Response("<html>login</html>", {
        headers: { "content-type": "text/html" },
      }),
    });
    await expect(html.resolve("vault:webhooks/orders")).rejects.toBeInstanceOf(WebhookSigningError);
  });

  it("keeps the path and the vault message out of the error", async () => {
    const failing = provider({
      fetchFn: async () => { throw new Error("connect ECONNREFUSED vault.example.net:8200"); },
    });
    const error = await failing.resolve("vault:webhooks/orders").catch((value: unknown) => value);
    expect(error).toBeInstanceOf(WebhookSigningError);
    const serialized = JSON.stringify({
      message: (error as Error).message, cause: (error as Error).cause,
    });
    expect(serialized).not.toContain("webhooks/orders");
    expect(serialized).not.toContain("ECONNREFUSED");
  });

  it("reuses a cached key and lets a rotation through after the ttl", async () => {
    let calls = 0;
    let clock = 1_000;
    const rotating = provider({
      cacheTtlMs: 60_000,
      now: () => clock,
      fetchFn: async () => {
        calls += 1;
        return kvResponse({
          data: { data: { keyId: `key-${calls}`, secret: secret.toString("base64url") } },
        });
      },
    });

    expect((await rotating.resolve("vault:webhooks/orders"))?.keyId).toBe("key-1");
    expect((await rotating.resolve("vault:webhooks/orders"))?.keyId).toBe("key-1");
    expect(calls).toBe(1);

    clock += 60_001;
    expect((await rotating.resolve("vault:webhooks/orders"))?.keyId).toBe("key-2");
  });

  it("drops a cached key once the reference is gone", async () => {
    // Ein zurueckgezogener Schluessel darf nicht aus dem Cache weiterleben.
    let present = true;
    let clock = 1_000;
    const service = provider({
      cacheTtlMs: 60_000,
      now: () => clock,
      fetchFn: async () => present
        ? kvResponse({ data: { data: { keyId: "k", secret: secret.toString("base64url") } } })
        : kvResponse({ errors: [] }, { status: 404 }),
    });

    expect(await service.resolve("vault:webhooks/orders")).not.toBeNull();
    present = false;
    clock += 60_001;
    expect(await service.resolve("vault:webhooks/orders")).toBeNull();
    clock += 1;
    expect(await service.resolve("vault:webhooks/orders")).toBeNull();
  });

  it("refuses plaintext HTTP in production", () => {
    expect(() => new VaultWebhookSecretProvider({
      vaultKvUrl: new URL("http://vault.example.net/v1/secret"),
      tokenProvider: { getToken: () => "s.token" },
      production: true,
    })).toThrow(WebhookSigningError);
  });

  it("refuses a mount that is not a vault path", () => {
    for (const raw of [
      "https://vault.example.net/",
      "https://vault.example.net/v1/secret?token=x",
      "https://user:pass@vault.example.net/v1/secret",
    ]) {
      expect(() => new VaultWebhookSecretProvider({
        vaultKvUrl: new URL(raw),
        tokenProvider: { getToken: () => "s.token" },
      })).toThrow(WebhookSigningError);
    }
  });
});
