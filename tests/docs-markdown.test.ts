import { describe, expect, it } from "vitest";
import { GuideSyntaxError, parseGuide, slugify } from "@/lib/docs/markdown";

describe("guide markdown parser", () => {
  it("parses headings with anchors, paragraphs and inline marks", () => {
    const doc = parseGuide("# Titel\n\nEin **fetter** und *kursiver* Satz mit `code` und [Link](GLOSSAR.md#tabelle).\n");
    expect(doc.title).toBe("Titel");
    expect(doc.blocks[0]).toEqual({ kind: "heading", level: 1, id: "titel", text: [{ kind: "text", text: "Titel" }] });
    expect(doc.blocks[1]).toEqual({ kind: "paragraph", text: [
      { kind: "text", text: "Ein " }, { kind: "strong", text: "fetter" }, { kind: "text", text: " und " },
      { kind: "em", text: "kursiver" }, { kind: "text", text: " Satz mit " }, { kind: "code", text: "code" },
      { kind: "text", text: " und " }, { kind: "link", text: "Link", href: "GLOSSAR.md#tabelle" }, { kind: "text", text: "." },
    ] });
  });

  it("parses lists, code blocks, tables and quotes", () => {
    const doc = parseGuide([
      "## Schritte", "", "1. Erstens", "2. Zweitens", "", "- eins", "- zwei", "",
      "```powershell", "npm ci", "```", "",
      "| Supabase | QKERN |", "| --- | --- |", "| Studio | Konsole |", "",
      "> Hinweis: nur lokal.", "",
    ].join("\n"));
    expect(doc.blocks.map((block) => block.kind)).toEqual(["heading", "ordered", "list", "code", "table", "quote"]);
    expect(doc.blocks[3]).toEqual({ kind: "code", language: "powershell", code: "npm ci" });
    expect(doc.blocks[4]).toMatchObject({ kind: "table", header: [[{ kind: "text", text: "Supabase" }], [{ kind: "text", text: "QKERN" }]] });
    expect(doc.headings).toEqual([{ level: 2, id: "schritte", text: "Schritte" }]);
  });

  it("rejects what the guide does not use, with a line number", () => {
    expect(() => parseGuide("#### Zu tief\n")).toThrow(GuideSyntaxError);
    expect(() => parseGuide("Absatz\n\n<div>html</div>\n")).toThrow(/Zeile 3/);
    expect(() => parseGuide("![Bild](x.png)\n")).toThrow(/Zeile 1/);
    expect(() => parseGuide("- a\n  - verschachtelt\n")).toThrow(/Zeile 2/);
    expect(() => parseGuide("```\nohne Sprache\n```\n")).toThrow(/Sprache/);
    expect(() => parseGuide("```sh\nnie geschlossen\n")).toThrow(/Zeile 1/);
  });

  it("makes stable anchors from German headings", () => {
    expect(slugify("Row Level Security (RLS)")).toBe("row-level-security-rls");
    expect(slugify("Für Gründer: Kosten")).toBe("fuer-gruender-kosten");
    expect(slugify("Grösse")).toBe("groesse");
  });

  it("gives duplicate headings distinct anchors", () => {
    const doc = parseGuide("## Ehrlich offen\n\nA\n\n## Ehrlich offen\n\nB\n");
    expect(doc.headings.map((h) => h.id)).toEqual(["ehrlich-offen", "ehrlich-offen-2"]);
  });

  it("joins a paragraph spanning two source lines with a single space", () => {
    const doc = parseGuide("# T\n\nerste Zeile\nzweite Zeile\n");
    expect(doc.blocks[1]).toEqual({ kind: "paragraph", text: [{ kind: "text", text: "erste Zeile zweite Zeile" }] });
  });

  it("rejects a table row with the wrong number of cells, naming that row", () => {
    const md = "# T\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n| nur eins |\n";
    expect(() => parseGuide(md)).toThrow(GuideSyntaxError);
    expect(() => parseGuide(md)).toThrow(/Zeile 6/);
  });

  it("keeps indented lines inside a fenced code block verbatim", () => {
    const doc = parseGuide("# T\n\n```yaml\nservices:\n  db:\n    image: postgres\n```\n");
    expect(doc.blocks[1]).toEqual({ kind: "code", language: "yaml", code: "services:\n  db:\n    image: postgres" });
  });

  it("does not treat a paragraph starting with emphasis as a list item", () => {
    const doc = parseGuide("# T\n\n*kursiv* am Anfang\n");
    expect(doc.blocks[1]).toEqual({ kind: "paragraph", text: [{ kind: "em", text: "kursiv" }, { kind: "text", text: " am Anfang" }] });
  });

  it("does not parse strong marks inside a code span", () => {
    const doc = parseGuide("# T\n\nSiehe `a**b**c` hier.\n");
    expect(doc.blocks[1]).toEqual({ kind: "paragraph", text: [
      { kind: "text", text: "Siehe " }, { kind: "code", text: "a**b**c" }, { kind: "text", text: " hier." },
    ] });
  });

  it("leaves the title empty without a level-1 heading and rejects a second one", () => {
    expect(parseGuide("## Nur Abschnitt\n").title).toBe("");
    expect(() => parseGuide("# Eins\n\n# Zwei\n")).toThrow(/Zeile 3/);
  });

  it("leaves a lone asterisk as plain text, also in a code span", () => {
    const doc = parseGuide("# T\n\nSELECT * FROM t\n\nSo: `SELECT * FROM t`\n");
    expect(doc.blocks[1]).toEqual({ kind: "paragraph", text: [{ kind: "text", text: "SELECT * FROM t" }] });
    expect(doc.blocks[2]).toEqual({ kind: "paragraph", text: [{ kind: "text", text: "So: " }, { kind: "code", text: "SELECT * FROM t" }] });
  });
});
