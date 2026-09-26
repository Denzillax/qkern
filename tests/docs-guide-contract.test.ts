import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE_PAGES, guidePath, pageBySlug } from "@/lib/docs/pages";
import { fillPlaceholders, guidePlaceholders } from "@/lib/docs/placeholders";
import { loadGuidePage } from "@/lib/docs/load";
import { loadCertificationSummary } from "@/lib/server/evidence/certification-summary";

describe("docs guide contract", () => {
  it("lists five pages whose files exist, with unique slugs", () => {
    expect(GUIDE_PAGES.map((page) => page.slug)).toEqual(["", "schnellstart", "erstes-backend", "gruender", "glossar"]);
    for (const page of GUIDE_PAGES) expect(existsSync(guidePath("de", page)), `${page.file} fehlt`).toBe(true);
    expect(pageBySlug("glossar")?.file).toBe("GLOSSAR.md");
    expect(pageBySlug("nicht-da")).toBeUndefined();
    expect(guidePath("de", GUIDE_PAGES[0])).toBe(path.resolve(process.cwd(), "docs/guide/de/WAS_IST_QKERN.md"));
  });

  it("fills every placeholder from a real source and leaves none behind", async () => {
    const values = await guidePlaceholders();
    expect(values.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(values.node).toMatch(/^\d+\.\d+/);
    expect(Number(values.postgresCases)).toBeGreaterThan(100);
    expect(Number(values.languageCount)).toBe(4);
    expect(fillPlaceholders("QKERN {{version}} auf Node {{node}}", values)).not.toContain("{{");
    expect(() => fillPlaceholders("{{unbekannt}}", values)).toThrow(/unbekannt/);
    for (const page of GUIDE_PAGES) {
      const loaded = await loadGuidePage("de", page);
      expect(JSON.stringify(loaded.document)).not.toContain("{{");
      expect(loaded.document.title, `${page.file} braucht eine Ueberschrift der Ebene 1`).not.toBe("");
    }
  });

  it("throws instead of guessing when a source is missing", async () => {
    const summary = await loadCertificationSummary();
    await expect(guidePlaceholders({
      readPackage: async () => ({ version: "9.9.9" }),
      summary: async () => summary,
    })).rejects.toThrow("package.json ohne engines.node");
    await expect(guidePlaceholders({
      readPackage: async () => ({ version: "9.9.9", engines: { node: ">=24.7.0" } }),
      summary: async () => ({ ...summary, rows: summary.rows.filter((row) => row.name !== "Control Plane und Data API") }),
    })).rejects.toThrow("Kein gruener Nachweis fuer Control Plane und Data API in docs/evidence");
  });
});
