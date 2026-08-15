import { describe, expect, it, vi } from "vitest";
import { loadConsoleAuthProviders } from "@/components/console/auth-providers";

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
