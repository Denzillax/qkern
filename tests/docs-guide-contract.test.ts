import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// Diese Datei liest zwanzig Markdown-Seiten in vier Sprachen und parst sie
// mehrfach; in der vollen Suite auf einer beschaeftigten Platte reichte die
// Vorgabe von 5 s je Fall nicht (2.35). Das Budget ist ausdruecklich, die
// Pruefungen bleiben dieselben.
vi.setConfig({ testTimeout: 60_000 });
import { GUIDE_PAGES, availableGuideLocales, guidePath, guideTitle, pageBySlug } from "@/lib/docs/pages";
import { GUIDE_LOCALE_TEXT } from "@/lib/docs/locales";
import { LOCALES, type Locale } from "@/lib/i18n/locales";
import { fillPlaceholders, guidePlaceholders } from "@/lib/docs/placeholders";
import { loadGuidePage } from "@/lib/docs/load";
import { loadCertificationSummary } from "@/lib/server/evidence/certification-summary";
import { parseGuide, plain, type Block, type GuideDocument, type Inline } from "@/lib/docs/markdown";
import { isExternal } from "@/lib/docs/links";

/** Jede Sprache, deren fuenf Dateien schon da sind. Deutsch immer; jede fertige Uebersetzung kommt von selbst dazu. */
const LOCALES_ON_DISK = availableGuideLocales();

async function readGuide(locale: Locale, file: string): Promise<GuideDocument> {
  const page = GUIDE_PAGES.find((entry) => entry.file === file)!;
  return parseGuide(await readFile(guidePath(locale, page), "utf8"));
}

function glossaryEntries(doc: GuideDocument) {
  return doc.blocks.filter((b) => b.kind === "heading" && b.level === 2);
}

function codeBlocks(doc: GuideDocument) {
  return doc.blocks.flatMap((b) => (b.kind === "code" ? [{ language: b.language, code: b.code }] : []));
}

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

  it("titles every page in every locale and knows German is on disk", async () => {
    for (const page of GUIDE_PAGES) for (const locale of LOCALES) expect(guideTitle(page, locale), `${page.file} ${locale}`).not.toBe("");
    expect(guideTitle(pageBySlug("schnellstart")!, "en")).toBe("Quickstart");
    // Der Seitentitel in der Seitenleiste ist die Ueberschrift der Seite selbst, je Sprache.
    for (const locale of availableGuideLocales()) for (const page of GUIDE_PAGES) {
      const doc = parseGuide(await readFile(guidePath(locale, page), "utf8"));
      expect(doc.title, `${locale}/${page.file}: Titel in pages.ts weicht von der Ueberschrift ab`).toBe(guideTitle(page, locale));
    }
    expect(LOCALES_ON_DISK).toContain("de");
  });

  it("counts a locale as unavailable only while a file is missing", () => {
    for (const locale of LOCALES.filter((entry) => !LOCALES_ON_DISK.includes(entry))) {
      const missing = GUIDE_PAGES.filter((page) => !existsSync(guidePath(locale, page))).map((page) => page.file);
      const folder = path.dirname(guidePath(locale, GUIDE_PAGES[0]));
      const state = existsSync(folder) ? `unvollstaendig, es fehlen: ${missing.join(", ") || "nichts"}` : "Ordner fehlt";
      expect(!existsSync(folder) || missing.length > 0, `${locale}: ${state}`).toBe(true);
    }
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
    // Liest einmal das ganze Manifestarchiv unter docs/evidence; in der vollen
    // Suite auf einer beschaeftigten Platte reichte die Vorgabe von 5 s nicht.
  }, 60_000);

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

describe.each(LOCALES_ON_DISK.map((locale) => [locale]))("docs guide contract (%s)", (locale) => {
  const text = GUIDE_LOCALE_TEXT[locale];

  it(`${locale}: links only to existing pages, anchors and glossary entries`, async () => {
    const docs = new Map<string, GuideDocument>();
    for (const page of GUIDE_PAGES) docs.set(page.file, await readGuide(locale, page.file));
    const anchors = new Map([...docs].map(([file, doc]) => [file, new Set(doc.headings.map((h) => h.id))]));
    for (const [file, doc] of docs) {
      walk(doc.blocks, (_, inlines) => {
        for (const inline of inlines) {
          if (inline.kind !== "link") continue;
          if (isExternal(inline.href)) continue;
          const [target, hash] = inline.href.replace(/^\.\//, "").split("#");
          const targetFile = target === "" ? file : target;
          expect(docs.has(targetFile), `${locale}/${file}: Link auf ${inline.href} zeigt ins Leere`).toBe(true);
          if (hash) expect(anchors.get(targetFile)?.has(hash), `${locale}/${file}: Anker ${inline.href} gibt es nicht`).toBe(true);
        }
      });
    }
  });

  it(`${locale}: gives every glossary entry exactly three lines with the three lead-ins, alphabetically`, async () => {
    const doc = await readGuide(locale, "GLOSSAR.md");
    const entries = glossaryEntries(doc);
    expect(entries.length).toBeGreaterThanOrEqual(80);
    const titles = entries.map((b) => (b.kind === "heading" ? plain(b.text) : ""));
    const collator = new Intl.Collator(locale, { sensitivity: "base" });
    expect(titles).toEqual([...titles].sort(collator.compare));
    for (let i = 0; i < doc.blocks.length; i += 1) {
      const block = doc.blocks[i];
      if (block.kind !== "heading" || block.level !== 2) continue;
      const list = doc.blocks[i + 1];
      expect(list?.kind, `${locale} ${plain(block.text)}: nach der Ueberschrift muss die Liste kommen`).toBe("list");
      if (list?.kind !== "list") continue;
      expect(list.items.length, `${locale} ${plain(block.text)}: genau drei Zeilen`).toBe(3);
      expect(list.items.map((item) => (item[0]?.kind === "strong" ? item[0].text : "")), `${locale} ${plain(block.text)}`).toEqual([...text.leadIns]);
      const next = doc.blocks[i + 2];
      expect(next === undefined || (next.kind === "heading" && next.level === 2), `${locale} ${plain(block.text)}: nach den drei Zeilen kommt nichts mehr`).toBe(true);
    }
  });

  it(`${locale}: has an honest section on every page except the glossary`, async () => {
    for (const page of GUIDE_PAGES) {
      if (page.file === "GLOSSAR.md") continue; // Im Glossar sind die Abschnitte der Ebene 2 die Eintraege.
      const doc = await readGuide(locale, page.file);
      const level2 = doc.blocks.flatMap((b) => (b.kind === "heading" && b.level === 2 ? [plain(b.text)] : []));
      expect(level2, `${locale}/${page.file}: Abschnitt "${text.honest}" fehlt`).toContain(text.honest);
    }
  });

  it(`${locale}: reads like a person wrote it`, async () => {
    for (const page of GUIDE_PAGES) {
      const doc = await readGuide(locale, page.file);
      walk(doc.blocks, (value) => {
        const lower = value.toLowerCase();
        for (const word of text.banned) expect(lower, `${locale}/${page.file}: "${word}" in "${value.slice(0, 60)}"`).not.toContain(word);
      });
    }
  });
});

/** Eine Uebersetzung hat denselben Bau wie das Deutsche: gleich viele Abschnitte, Eintraege und dieselben Codebloecke. */
describe("docs guide cross-locale contract", () => {
  const translations = LOCALES_ON_DISK.filter((locale) => locale !== "de");

  it("has German as the reference", () => {
    expect(LOCALES_ON_DISK[0]).toBe("de");
  });

  it.each(translations.map((locale) => [locale]))("%s: same sections, glossary entries and code blocks as German", async (locale) => {
    for (const page of GUIDE_PAGES) {
      const de = await readGuide("de", page.file);
      const other = await readGuide(locale, page.file);
      const level2 = (doc: GuideDocument) => doc.blocks.filter((b) => b.kind === "heading" && b.level === 2).length;
      expect(level2(other), `${locale}/${page.file}: Zahl der Abschnitte (im Glossar: Eintraege)`).toBe(level2(de));
      expect(codeBlocks(other), `${locale}/${page.file}: Codebloecke`).toEqual(codeBlocks(de));
    }
  });
});
