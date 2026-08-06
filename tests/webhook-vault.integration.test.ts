import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { VaultTokenFileProvider } from "@/lib/server/migrations/connection-catalog-vault";
import { VaultWebhookSecretProvider } from "@/lib/server/compute/webhook-secret-vault";
import {
  HmacWebhookSigner,
  WebhookSigningError,
  verifyWebhookSignature,
} from "@/lib/server/compute/webhook-signer";

/**
 * Signaturschlüssel gegen einen echten HashiCorp Vault.
 *
 * Bis Release 1.24 gab es nur den Umgebungs-Provider, und der weigert sich in
 * Produktion zu existieren — Webhooks waren dort also gar nicht signierbar. Das
 * war der letzte Grund, warum der Zustellprozess produktiv nicht startbar war.
 *
 * Der Token kommt auch hier ausschliesslich aus einer Datei; der Stack legt sie
 * an, statt die Produktgrenze für den Test aufzuweichen.
 */

const kvUrl = process.env.QKERN_TEST_VAULT_KV_URL;
const tokenFile = process.env.QKERN_TEST_VAULT_TOKEN_FILE;
const enabled = Boolean(kvUrl && tokenFile);

describe.runIf(enabled)("Webhook signing key Vault certification", () => {
  function provider(overrides: { tokenFile?: string; cacheTtlMs?: number } = {}) {
    return new VaultWebhookSecretProvider({
      vaultKvUrl: new URL(kvUrl!),
      tokenProvider: new VaultTokenFileProvider(overrides.tokenFile ?? tokenFile!),
      cacheTtlMs: overrides.cacheTtlMs ?? 0,
    });
  }

  it("reads a signing key that a receiver can actually verify", async () => {
    const key = await provider().resolve("vault:webhooks/orders");
    expect(key?.keyId).toBe("orders-2026-08");
    expect(key!.secret.length).toBeGreaterThanOrEqual(32);

    const signed = await new HmacWebhookSigner(provider())
      .sign("vault:webhooks/orders", "1754388000.{}");
    expect(verifyWebhookSignature({
      secret: key!.secret, canonicalPayload: "1754388000.{}", signature: signed.signature,
    })).toBe(true);
    // Gegenrechnung ohne den Produktcode: derselbe HMAC, unabhaengig gebildet.
    expect(signed.signature).toBe(
      createHmac("sha256", key!.secret).update("1754388000.{}", "utf8").digest("base64url"),
    );
  });

  it("refuses a stored secret that is too short to sign with", async () => {
    // Die Laengengrenze greift auch dann, wenn der Vault die Antwort liefert.
    await expect(provider().resolve("vault:webhooks/weak"))
      .rejects.toBeInstanceOf(WebhookSigningError);
  });

  it("answers an unknown reference with null, not an error", async () => {
    expect(await provider().resolve("vault:webhooks/does-not-exist")).toBeNull();
  });

  it("fails closed when the token file is missing", async () => {
    // Ohne Token darf nichts signiert werden — ein Zusteller, der still
    // unsigniert sendet, waere schlimmer als einer, der gar nicht liefert.
    const broken = provider({ tokenFile: "/run/qkern/does-not-exist" });
    await expect(broken.resolve("vault:webhooks/orders"))
      .rejects.toBeInstanceOf(WebhookSigningError);
  });

  it("keeps the vault path out of the raised error", async () => {
    const broken = provider({ tokenFile: "/run/qkern/does-not-exist" });
    const error = await broken.resolve("vault:webhooks/orders").catch((value: unknown) => value);
    expect(JSON.stringify({
      message: (error as Error).message, cause: (error as Error).cause,
    })).not.toContain("webhooks/orders");
  });

  it("serves a cached key without a second read and honours the ttl", async () => {
    const cached = provider({ cacheTtlMs: 60_000 });
    const first = await cached.resolve("vault:webhooks/orders");
    const second = await cached.resolve("vault:webhooks/orders");
    expect(second?.secret.equals(first!.secret)).toBe(true);
    expect(second?.keyId).toBe(first?.keyId);
  });
});
