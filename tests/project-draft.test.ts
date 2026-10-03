import { describe, expect, it } from "vitest";
import {
  PROJECT_DRAFT_REASONS,
  PROJECT_REGIONS,
  ProjectDraftError,
  projectSlug,
  validateProjectDraft,
} from "@/lib/console/project-draft";

/**
 * Der Entwurf eines neuen Projekts (2.147), ohne Datenbank geprueft.
 *
 * Das Modul ist rein, und genau darum laesst es sich hier pruefen: Dieselben
 * Regeln gelten in der Route und in der Form im Projektwechsler, es gibt also
 * keine zweite Stelle, die anders entscheidet.
 */
describe("project draft", () => {
  it("derives a slug from the name instead of asking for one", () => {
    expect(projectSlug("Nova Market")).toBe("nova-market");
    expect(projectSlug("  Nova   Market  ")).toBe("nova-market");
    expect(projectSlug("Nova_Market/2")).toBe("nova-market-2");
  });

  it("keeps letters that carry an accent instead of turning them into a dash", () => {
    // "m-ller-s-hne" liest sich wie ein Fehler; der Strich stuende da, wo ein
    // Buchstabe war.
    expect(projectSlug("Müller Söhne")).toBe("muller-sohne");
    expect(projectSlug("Crème Brûlée")).toBe("creme-brulee");
  });

  it("refuses a name from which no identifier can be built", () => {
    expect(() => validateProjectDraft({ name: "...", region: "ch-zrh-1" }))
      .toThrowError(new ProjectDraftError(PROJECT_DRAFT_REASONS.slug));
  });

  it("refuses a name that is too short or too long", () => {
    expect(() => validateProjectDraft({ name: "A", region: "ch-zrh-1" }))
      .toThrowError(new ProjectDraftError(PROJECT_DRAFT_REASONS.name));
    expect(() => validateProjectDraft({ name: "A".repeat(61), region: "ch-zrh-1" }))
      .toThrowError(new ProjectDraftError(PROJECT_DRAFT_REASONS.name));
  });

  it("refuses a region QKERN does not carry, and carries exactly one", () => {
    expect(PROJECT_REGIONS).toEqual(["ch-zrh-1"]);
    expect(() => validateProjectDraft({ name: "Nova Market", region: "eu-central-1" }))
      .toThrowError(new ProjectDraftError(PROJECT_DRAFT_REASONS.region));
  });

  it("refuses anything that is not a pair of two strings", () => {
    for (const input of [null, "Nova", [], { name: "Nova Market" }, { name: 7, region: "ch-zrh-1" }]) {
      expect(() => validateProjectDraft(input), JSON.stringify(input))
        .toThrowError(new ProjectDraftError(PROJECT_DRAFT_REASONS.shape));
    }
  });

  it("takes the name as typed and only shapes the identifier", () => {
    expect(validateProjectDraft({ name: "  Nova Market  ", region: "ch-zrh-1" }))
      .toEqual({ name: "Nova Market", slug: "nova-market", region: "ch-zrh-1" });
  });
});
