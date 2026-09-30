import { describe, expect, it, vi } from "vitest";
import { loadConsoleAuthProviders, loadConsoleAuthSamlProviders } from "@/components/console/auth-providers";

/**
 * Der Ladeweg der Provider-Auswahl — die eine Stelle, die die Admin-Route
 * aus 1.83 wirklich ruft (dasselbe Muster wie die Rechnungen in 1.82).
 */
describe("console auth providers loader", () => {
  it("calls the admin providers route with no-store and maps the projection", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "certification", issuer: "https://dex.qkern.test/dex" }],
    }), { status: 200 }));
    const result = await loadConsoleAuthProviders("prj-1", "development", fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/projects/prj-1/environments/development/auth/admin/providers",
      { cache: "no-store" },
    );
    expect(result).toEqual({
      state: "ready",
      providers: [{ id: "certification", issuer: "https://dex.qkern.test/dex" }],
    });
  });

  it("reports disabled auth and failures as their own states", async () => {
    const disabled = vi.fn().mockResolvedValue(new Response("{}", { status: 503 }));
    expect(await loadConsoleAuthProviders("prj-1", "development", disabled as unknown as typeof fetch))
      .toEqual({ state: "unavailable" });
    const failing = vi.fn().mockResolvedValue(new Response("{}", { status: 500 }));
    expect(await loadConsoleAuthProviders("prj-1", "development", failing as unknown as typeof fetch))
      .toEqual({ state: "error" });
    const malformed = vi.fn().mockResolvedValue(new Response("{\"data\":42}", { status: 200 }));
    expect(await loadConsoleAuthProviders("prj-1", "development", malformed as unknown as typeof fetch))
      .toEqual({ state: "error" });
    const throwing = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await loadConsoleAuthProviders("prj-1", "development", throwing as unknown as typeof fetch))
      .toEqual({ state: "error" });
  });
});

/**
 * Der SAML-Ladeweg (2.99) ist ein eigener: eigene Tuer, eigener Zustand.
 * Faellt die eine Liste aus, sagt die Seite das fuer diese Liste und nicht
 * fuer die andere.
 */
describe("console auth SAML providers loader", () => {
  it("calls its own admin route with no-store and maps the three-field projection", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "federation", entityId: "https://idp.qkern.test/metadata", requiresVerifiedEmail: true }],
    }), { status: 200 }));
    const result = await loadConsoleAuthSamlProviders("prj-1", "development", fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/projects/prj-1/environments/development/auth/admin/saml",
      { cache: "no-store" },
    );
    expect(result).toEqual({
      state: "ready",
      providers: [{ id: "federation", entityId: "https://idp.qkern.test/metadata", requiresVerifiedEmail: true }],
    });
  });

  it("reads a missing flag as a provider that vouches, and reports every failure as its own state", async () => {
    const vouching = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "federation", entityId: "https://idp.qkern.test/metadata" }],
    }), { status: 200 }));
    expect(await loadConsoleAuthSamlProviders("prj-1", "development", vouching as unknown as typeof fetch))
      .toEqual({ state: "ready", providers: [{ id: "federation", entityId: "https://idp.qkern.test/metadata", requiresVerifiedEmail: false }] });
    const disabled = vi.fn().mockResolvedValue(new Response("{}", { status: 503 }));
    expect(await loadConsoleAuthSamlProviders("prj-1", "development", disabled as unknown as typeof fetch))
      .toEqual({ state: "unavailable" });
    const failing = vi.fn().mockResolvedValue(new Response("{}", { status: 500 }));
    expect(await loadConsoleAuthSamlProviders("prj-1", "development", failing as unknown as typeof fetch))
      .toEqual({ state: "error" });
    const malformed = vi.fn().mockResolvedValue(new Response("{\"data\":42}", { status: 200 }));
    expect(await loadConsoleAuthSamlProviders("prj-1", "development", malformed as unknown as typeof fetch))
      .toEqual({ state: "error" });
    const throwing = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await loadConsoleAuthSamlProviders("prj-1", "development", throwing as unknown as typeof fetch))
      .toEqual({ state: "error" });
  });
});
