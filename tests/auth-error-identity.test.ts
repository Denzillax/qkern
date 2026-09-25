import { describe, expect, it } from "vitest";
import { AuthError, isAuthError } from "@/lib/server/auth/service";

/**
 * Ein AuthError muss auch dann erkannt werden, wenn er aus einem anderen
 * Modulgraphen stammt (2.8): Die Auth-Laufzeit liegt im Dev-Modus auf
 * `globalThis` und ueberlebt Hot-Reloads, die Klasse nicht. Ein Fehler mit
 * gleichem Namen und Code, aber fremder Klasse, ist derselbe Fehler.
 */
describe("auth error identity", () => {
  it("recognises its own class", () => {
    expect(isAuthError(new AuthError("INVALID_SESSION"))).toBe(true);
    expect(isAuthError(new AuthError("INVALID_SESSION"), "INVALID_SESSION")).toBe(true);
    expect(isAuthError(new AuthError("INVALID_SESSION"), "RATE_LIMITED")).toBe(false);
  });

  it("recognises the same error thrown by a foreign copy of the class", () => {
    class ForeignAuthError extends Error {
      constructor(readonly code: string) { super(code); this.name = "AuthError"; }
    }
    expect(isAuthError(new ForeignAuthError("INVALID_SESSION"), "INVALID_SESSION")).toBe(true);
    expect(isAuthError(new ForeignAuthError("ACCOUNT_EXISTS"), "INVALID_SESSION")).toBe(false);
  });

  it("rejects errors that only look similar", () => {
    expect(isAuthError(new Error("INVALID_SESSION"))).toBe(false);
    expect(isAuthError(Object.assign(new Error("x"), { name: "AuthError" }))).toBe(false);
    expect(isAuthError({ name: "AuthError", code: "INVALID_SESSION" })).toBe(false);
    expect(isAuthError(null)).toBe(false);
  });
});
