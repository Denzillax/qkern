import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EnvWebhookSecretProvider,
  HmacWebhookSigner,
  WebhookSigningError,
  verifyWebhookSignature,
  type WebhookSecretProvider,
} from "@/lib/server/compute/webhook-signer";
import { FetchWebhookTransport } from "@/lib/server/compute/webhook-transport";

const secret = randomBytes(32);

function provider(key = { keyId: "key-1", secret }): WebhookSecretProvider {
  return { async resolve() { return key; } };
}

function request(url = "https://receiver.example.com/hooks") {
  return Object.freeze({
    url,
    method: "POST" as const,
    headers: Object.freeze({ "x-qkern-delivery-id": "delivery-1" }),
    body: "{}",
    redirect: "error" as const,
  });
}

function response(init: {
  status?: number; headers?: Record<string, string>; body?: string;
} = {}) {
  return new Response(init.body ?? "ok", {
    status: init.status ?? 200,
    headers: init.headers ?? { "x-qkern-delivery-id": "delivery-1" },
  });
}

describe("HmacWebhookSigner", () => {
  it("produces a signature the receiver can verify with the shared secret", async () => {
    const signed = await new HmacWebhookSigner(provider()).sign("vault:webhook/orders", "1754388000.{}");
    expect(signed.keyId).toBe("key-1");
    expect(verifyWebhookSignature({
      secret, canonicalPayload: "1754388000.{}", signature: signed.signature,
    })).toBe(true);
  });

  it("binds the signature to the timestamp so a captured message cannot be replayed", async () => {
    const signer = new HmacWebhookSigner(provider());
    const first = await signer.sign("vault:webhook/orders", "1754388000.{}");
    const later = await signer.sign("vault:webhook/orders", "1754388600.{}");
    expect(first.signature).not.toBe(later.signature);
    expect(verifyWebhookSignature({
      secret, canonicalPayload: "1754388600.{}", signature: first.signature,
    })).toBe(false);
  });

  it("refuses a key that is too short to be a signing secret", async () => {
    const weak = new HmacWebhookSigner(provider({ keyId: "key-1", secret: randomBytes(16) }));
    await expect(weak.sign("vault:webhook/orders", "1.{}")).rejects.toBeInstanceOf(WebhookSigningError);
  });

  it("refuses an unknown reference instead of signing with nothing", async () => {
    const missing = new HmacWebhookSigner({ async resolve() { return null; } });
    await expect(missing.sign("vault:webhook/orders", "1.{}")).rejects.toBeInstanceOf(WebhookSigningError);
  });

  it("keeps the reference and the provider error out of the raised error", async () => {
    const failing = new HmacWebhookSigner({
      async resolve() { throw new Error("vault token for webhook/orders expired"); },
    });
    const error = await failing.sign("vault:webhook/orders", "1.{}").catch((value: unknown) => value);
    expect(error).toBeInstanceOf(WebhookSigningError);
    expect(JSON.stringify({ message: (error as Error).message, cause: (error as Error).cause }))
      .not.toContain("webhook/orders");
  });
});

describe("EnvWebhookSecretProvider", () => {
  const env = {
    NODE_ENV: "development",
    QKERN_ALLOW_LOCAL_WEBHOOK_SIGNING_SECRETS: "true",
    QKERN_LOCAL_WEBHOOK_SIGNING_SECRETS_JSON: JSON.stringify({
      "vault:webhook/orders": { keyId: "local-1", secret: secret.toString("base64url") },
    }),
  };

  it("resolves a configured reference and nothing else", async () => {
    const local = new EnvWebhookSecretProvider(env);
    expect((await local.resolve("vault:webhook/orders"))?.keyId).toBe("local-1");
    expect(await local.resolve("vault:webhook/other")).toBeNull();
  });

  it("refuses to exist in production", () => {
    // Ein Signaturgeheimnis in einer Umgebungsvariable steht in jedem
    // Prozessabbild und in jeder Container-Definition.
    expect(() => new EnvWebhookSecretProvider({ ...env, NODE_ENV: "production" }))
      .toThrow(WebhookSigningError);
  });

  it("requires the explicit opt-in even outside production", () => {
    expect(() => new EnvWebhookSecretProvider({
      ...env, QKERN_ALLOW_LOCAL_WEBHOOK_SIGNING_SECRETS: undefined,
    })).toThrow(WebhookSigningError);
  });

  it("refuses a secret that is too short", () => {
    expect(() => new EnvWebhookSecretProvider({
      ...env,
      QKERN_LOCAL_WEBHOOK_SIGNING_SECRETS_JSON: JSON.stringify({
        "vault:webhook/orders": { keyId: "local-1", secret: randomBytes(8).toString("base64url") },
      }),
    })).toThrow(WebhookSigningError);
  });
});

describe("FetchWebhookTransport", () => {
  it("returns the acknowledgement the receiver echoed back", async () => {
    const transport = new FetchWebhookTransport({ fetchFn: async () => response() });
    const result = await transport.send(request(), { signal: new AbortController().signal });
    expect(result).toEqual({ status: 200, acknowledgementId: "delivery-1" });
  });

  it("reports no acknowledgement when the receiver did not echo one", async () => {
    // Sonst gaelte eine Zustellung als erfolgreich, weil irgendein Proxy mit 200
    // geantwortet hat.
    const transport = new FetchWebhookTransport({
      fetchFn: async () => response({ headers: {} }),
    });
    const result = await transport.send(request(), { signal: new AbortController().signal });
    expect(result.acknowledgementId).toBeNull();
  });

  it("never follows a redirect", async () => {
    let seen: RequestInit | undefined;
    const transport = new FetchWebhookTransport({
      fetchFn: async (_url, init) => { seen = init as RequestInit; return response(); },
    });
    await transport.send(request(), { signal: new AbortController().signal });
    // Eine Umleitung truege die signierte Nachricht an ein Ziel, das der
    // Betreiber nie eingetragen hat.
    expect(seen?.redirect).toBe("error");
    expect(seen?.cache).toBe("no-store");
  });

  it("does not read the response body of a foreign receiver", async () => {
    let cancelled = false;
    const transport = new FetchWebhookTransport({
      fetchFn: async () => {
        const body = new ReadableStream<Uint8Array>({
          cancel() { cancelled = true; },
        });
        return new Response(body, {
          status: 200, headers: { "x-qkern-delivery-id": "delivery-1" },
        });
      },
    });
    await transport.send(request(), { signal: new AbortController().signal });
    expect(cancelled).toBe(true);
  });

  it("refuses a plaintext target unless loopback was explicitly allowed", async () => {
    const strict = new FetchWebhookTransport({ fetchFn: async () => response() });
    await expect(strict.send(request("http://127.0.0.1:9000/hooks"), {
      signal: new AbortController().signal,
    })).rejects.toThrow(/HTTPS/);

    const loopback = new FetchWebhookTransport({
      fetchFn: async () => response(), allowInsecureLoopback: true,
    });
    await expect(loopback.send(request("http://127.0.0.1:9000/hooks"), {
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ status: 200 });
  });

  it("refuses credentials embedded in the target", async () => {
    const transport = new FetchWebhookTransport({ fetchFn: async () => response() });
    await expect(transport.send(request("https://user:pass@receiver.example.com/hooks"), {
      signal: new AbortController().signal,
    })).rejects.toThrow(/HTTPS/);
  });
});
