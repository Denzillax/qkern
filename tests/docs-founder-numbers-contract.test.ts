import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { availableGuideLocales, guidePath, pageBySlug } from "@/lib/docs/pages";

const COUNT = /\b\d{2,}\s+[\p{L}-]*(Fäll|Test|Prüfständ|Modul)/iu;
/** Fuer en, fr, it: Zahl vor Faellen, Tests, Prueffeldern oder Modulen. */
const COUNT_OTHER = /\b\d{2,}\s+[\p{L}-]*(cases|tests|stacks|modules|cas|piles|casi|test|modul)/iu;

/** Entfernt Codebloecke und Inline-Code, bevor nach Zahlen gesucht wird. */
function stripCode(raw: string): string {
  return raw.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

/** Die Gruenderseite nennt keine Zahl, die nicht aus einem Platzhalter kommt. */
describe("docs founder numbers contract", () => {
  it.each(availableGuideLocales().map((locale) => [locale]))("%s: has no literal count in the founder page", async (locale) => {
    const raw = await readFile(guidePath(locale, pageBySlug("gruender")!), "utf8");
    const withoutCode = stripCode(raw);
    expect(withoutCode, locale).toContain("{{postgresCases}}");
    expect(withoutCode, locale).toContain("{{stackCount}}");
    expect(withoutCode, locale).not.toMatch(locale === "de" ? COUNT : COUNT_OTHER);
  });

  it("catches inflected forms, compounds and non-breaking spaces", () => {
    for (const sample of ["22 Fälle", "134 Testfälle", "12 Prüfständen", "40 Module", "15 Tests", "30 postgres-Tests"]) {
      expect(sample, sample).toMatch(COUNT);
    }
    for (const sample of ["22 cases", "134 test cases", "12 stacks", "40 modules", "22 cas", "12 piles", "22 casi", "15 test", "40 moduli"]) {
      expect(sample, sample).toMatch(COUNT_OTHER);
    }
    expect(stripCode("`134 Tests` und\n```\n22 Fälle\n```\n")).not.toMatch(COUNT);
  });
});
