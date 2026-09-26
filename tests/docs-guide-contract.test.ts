import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE_PAGES, guidePath, pageBySlug } from "@/lib/docs/pages";
import { fillPlaceholders, guidePlaceholders } from "@/lib/docs/placeholders";
import { loadGuidePage } from "@/lib/docs/load";
import { loadCertificationSummary } from "@/lib/server/evidence/certification-summary";
import { parseGuide, plain, type Block, type Inline } from "@/lib/docs/markdown";
import { isExternal } from "@/lib/docs/links";

const BANNED = ["nahtlos", "robust", "leistungsstark", "revolutionär", "tauchen wir ein", "es ist wichtig zu beachten", "in der heutigen zeit", "spielt eine entscheidende rolle", "zusammenfassend", "\u2014", "\u2013"];

function walk(blocks: readonly Block[], visit: (text: string, inlines: readonly Inline[]) => void) {
  for (const block of blocks) {
    if (block.kind === "code") continue;
    if (block.kind === "table") { for (const cell of [...block.header, ...block.rows.flat()]) visit(plain(cell), cell); continue; }
    if (block.kind === "list" || block.kind === "ordered") { for (const item of block.items) visit(plain(item), item); continue; }
    visit(plain(block.text), block.text);
  }
}

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

  it("links only to existing pages, anchors and glossary entries", async () => {
    const docs = new Map<string, ReturnType<typeof parseGuide>>();
    for (const page of GUIDE_PAGES) docs.set(page.file, parseGuide(await readFile(guidePath("de", page), "utf8")));
    const anchors = new Map([...docs].map(([file, doc]) => [file, new Set(doc.headings.map((h) => h.id))]));
    for (const [file, doc] of docs) {
      walk(doc.blocks, (_, inlines) => {
        for (const inline of inlines) {
          if (inline.kind !== "link") continue;
          if (isExternal(inline.href)) continue;
          const [target, hash] = inline.href.replace(/^\.\//, "").split("#");
          const targetFile = target === "" ? file : target;
          expect(docs.has(targetFile), `${file}: Link auf ${inline.href} zeigt ins Leere`).toBe(true);
          if (hash) expect(anchors.get(targetFile)?.has(hash), `${file}: Anker ${inline.href} gibt es nicht`).toBe(true);
        }
      });
    }
  });

  it("gives every glossary entry exactly three lines with the three lead-ins, alphabetically", async () => {
    const doc = parseGuide(await readFile(guidePath("de", pageBySlug("glossar")!), "utf8"));
    const entries = doc.blocks.filter((b) => b.kind === "heading" && b.level === 2);
    expect(entries.length).toBeGreaterThanOrEqual(80);
    const titles = entries.map((b) => (b.kind === "heading" ? plain(b.text) : ""));
    const collator = new Intl.Collator("de", { sensitivity: "base" });
    expect(titles).toEqual([...titles].sort(collator.compare));
    for (let i = 0; i < doc.blocks.length; i += 1) {
      const block = doc.blocks[i];
      if (block.kind !== "heading" || block.level !== 2) continue;
      const list = doc.blocks[i + 1];
      expect(list?.kind, `${plain(block.text)}: nach der Ueberschrift muss die Liste kommen`).toBe("list");
      if (list?.kind !== "list") continue;
      expect(list.items.length, `${plain(block.text)}: genau drei Zeilen`).toBe(3);
      expect(list.items.map((item) => (item[0]?.kind === "strong" ? item[0].text : ""))).toEqual(["Was es ist:", "In QKERN:", "Bei Supabase:"]);
      const next = doc.blocks[i + 2];
      expect(next === undefined || (next.kind === "heading" && next.level === 2), `${plain(block.text)}: nach den drei Zeilen kommt nichts mehr`).toBe(true);
    }
  });

  it("reads like a person wrote it", async () => {
    for (const page of GUIDE_PAGES) {
      const doc = parseGuide(await readFile(guidePath("de", page), "utf8"));
      walk(doc.blocks, (text) => {
        const lower = text.toLowerCase();
        for (const word of BANNED) expect(lower, `${page.file}: "${word}" in "${text.slice(0, 60)}"`).not.toContain(word);
      });
    }
  });
});
