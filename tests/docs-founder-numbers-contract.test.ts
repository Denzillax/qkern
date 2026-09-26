import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { guidePath, pageBySlug } from "@/lib/docs/pages";

const COUNT = /\b\d{2,}[\s ]+[\w-]*(Fäll|Test|Prüfständ|Modul)/iu;

/** Entfernt Codebloecke und Inline-Code, bevor nach Zahlen gesucht wird. */
function stripCode(raw: string): string {
  return raw.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

/** Die Gruenderseite nennt keine Zahl, die nicht aus einem Platzhalter kommt. */
describe("docs founder numbers contract", () => {
  it("has no literal count in the founder page", async () => {
    const raw = await readFile(guidePath("de", pageBySlug("gruender")!), "utf8");
    const withoutCode = stripCode(raw);
    expect(withoutCode).toContain("{{postgresCases}}");
    expect(withoutCode).toContain("{{stackCount}}");
    expect(withoutCode).not.toMatch(COUNT);
  });

  it("catches inflected forms, compounds and non-breaking spaces", () => {
    for (const sample of ["22 Fälle", "134 Testfälle", "12 Prüfständen", "40 Module", "15 Tests", "30 postgres-Tests"]) {
      expect(sample, sample).toMatch(COUNT);
    }
    expect(stripCode("`134 Tests` und\n```\n22 Fälle\n```\n")).not.toMatch(COUNT);
  });
});
