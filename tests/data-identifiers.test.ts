import { describe, expect, it } from "vitest";
import { DATA_IDENTIFIER, isDataIdentifier } from "@/lib/server/data-plane/identifiers";

/**
 * Die Namensgrammatik der Data API (2.26): Gross- und Kleinbuchstaben, Ziffern,
 * Unterstrich, hoechstens 63 Zeichen. Alles, was aus einem `"..."` in SQL
 * ausbrechen koennte, bleibt draussen.
 */
describe("data identifiers", () => {
  it("accepts the names Prisma, TypeORM and Drizzle create", () => {
    for (const name of ["Order", "UserProfile", "createdAt", "_prisma_migrations", "items", "a", "A_1", "x".repeat(63)]) {
      expect(isDataIdentifier(name), name).toBe(true);
    }
  });

  it("rejects everything that could leave a quoted identifier or is not a name", () => {
    for (const name of ["", "1abc", "items; DROP SCHEMA public", 'Order"', "Enable read access", "user-profile", "a.b", "x".repeat(64), "café", "\u0000", " Order", "Order\n"]) {
      expect(isDataIdentifier(name), JSON.stringify(name)).toBe(false);
    }
    expect(isDataIdentifier(null)).toBe(false);
    expect(isDataIdentifier(42)).toBe(false);
    expect(DATA_IDENTIFIER.source).toBe("^[A-Za-z_][A-Za-z0-9_]{0,62}$");
  });
});
