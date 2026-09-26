import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { guidePath, pageBySlug } from "@/lib/docs/pages";

/** Die Gruenderseite nennt keine Zahl, die nicht aus einem Platzhalter kommt. */
describe("docs founder numbers contract", () => {
  it("has no literal count in the founder page", async () => {
    const raw = await readFile(guidePath("de", pageBySlug("gruender")!), "utf8");
    const withoutCode = raw.replace(/```[\s\S]*?```/g, "");
    expect(withoutCode).toContain("{{postgresCases}}");
    expect(withoutCode).toContain("{{stackCount}}");
    expect(withoutCode).not.toMatch(/\b\d{2,} (Fälle|Tests|Prüfstände|Module)\b/);
  });
});
