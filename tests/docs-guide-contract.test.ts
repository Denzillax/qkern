import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE_PAGES, guidePath, pageBySlug } from "@/lib/docs/pages";

describe("docs guide contract", () => {
  it("lists five pages whose files exist, with unique slugs", () => {
    expect(GUIDE_PAGES.map((page) => page.slug)).toEqual(["", "schnellstart", "erstes-backend", "gruender", "glossar"]);
    for (const page of GUIDE_PAGES) expect(existsSync(guidePath("de", page)), `${page.file} fehlt`).toBe(true);
    expect(pageBySlug("glossar")?.file).toBe("GLOSSAR.md");
    expect(pageBySlug("nicht-da")).toBeUndefined();
    expect(guidePath("de", GUIDE_PAGES[0])).toBe(path.resolve(process.cwd(), "docs/guide/de/WAS_IST_QKERN.md"));
  });
});
