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

  it.each([
    ["heading level 4", "#### Zu tief\n", /Zeile 1: Ueberschriften nur bis Ebene 3/],
    ["html block", "Absatz\n\n<div>html</div>\n", /Zeile 3/],
    ["image", "![Bild](x.png)\n", /Zeile 1/],
    ["nested list", "- a\n  - verschachtelt\n", /Zeile 2/],
    ["fence without language", "```\nohne Sprache\n```\n", /Sprache/],
    ["unclosed fence", "```sh\nnie geschlossen\n", /Zeile 1/],
    ["closing fence with trailing text", "```sh\nls\n``` weiter\n", /Zeile 3: Schliessender Zaun/],
    ["table without divider", "| a | b |\n| 1 | 2 |\n", /Zeile 2: Tabelle ohne Trennzeile/],
    ["divider not matching header", "| a | b |\n| --- |\n", /Zeile 2: Trennzeile passt nicht/],
    ["star bullet", "Text\n* eins\n", /Zeile 2: Aufzaehlung nur mit -/],
    ["plus bullet", "+ eins\n", /Zeile 1: Aufzaehlung nur mit -/],
    ["dash rule", "Text\n\n---\n", /Zeile 3: Trennlinien sind nicht vorgesehen/],
    ["star rule", "***\n", /Zeile 1: Trennlinien/],
    ["underscore rule", "___\n", /Zeile 1: Trennlinien/],
    ["setext dash heading", "Titel\n---\n", /Zeile 2: Trennlinien/],
    ["setext equals heading", "Titel\n===\n", /Zeile 2: Setext-Ueberschriften sind nicht vorgesehen/],
    ["tilde fence", "~~~sh\nls\n~~~\n", /Zeile 1: Codeblock nur mit Backticks/],
    ["quote without space", "Text\n>eng\n", /Zeile 2: Zitat braucht > mit Leerzeichen/],
    ["quote line without space inside a quote", "> a\n>\n> b\n", /Zeile 2: Zitat braucht/],
    ["heading without anchor", "## ???\n", /Zeile 1: Ueberschrift ergibt keinen Anker/],
    ["closing hashes", "## Foo ##\n", /Zeile 1: Schliessende Rauten sind nicht vorgesehen/],
    ["code in link text", "[`x`](y.md)\n", /Zeile 1: Auszeichnung im Linktext/],
    ["emphasis in link text", "Siehe [*x*](y.md)\n", /Zeile 1: Auszeichnung im Linktext/],
    ["parenthesis in href", "[x](a(b))\n", /Zeile 1: Klammer im Linkziel/],
  ])("rejects %s with its line number", (_name, markdown, message) => {
    expect(() => parseGuide(markdown)).toThrow(GuideSyntaxError);
    expect(() => parseGuide(markdown)).toThrow(message);
  });

  it("starts every error message with a capital letter", () => {
    const cases = ["- a\n  - b\n", "  eingerueckt\n", "# A\n\n# B\n", "```sh\nls\n``` x\n"];
    for (const markdown of cases) {
      try {
        parseGuide(markdown);
        throw new Error("no error");
      } catch (error) {
        expect(error).toBeInstanceOf(GuideSyntaxError);
        expect((error as Error).message).toMatch(/^Zeile \d+: [A-ZÄÖÜ]/);
      }
    }
  });

  it("strips a leading byte order mark", () => {
    const doc = parseGuide("﻿# Titel\n");
    expect(doc.title).toBe("Titel");
    expect(doc.blocks[0]).toMatchObject({ kind: "heading", level: 1, id: "titel" });
  });

  it("skips whitespace-only quote lines without a double space", () => {
    const doc = parseGuide("> a\n>   \n> b\n");
    expect(doc.blocks[0]).toEqual({ kind: "quote", text: [{ kind: "text", text: "a b" }] });
  });

  it("keeps a heading with a hash inside its text", () => {
    const doc = parseGuide("## C# und F#\n");
    expect(doc.headings).toEqual([{ level: 2, id: "c-und-f", text: "C# und F#" }]);
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

  it("reports the offending line inside multi-line paragraphs and quotes", () => {
    expect(() => parseGuide("a\n![x](y)\n")).toThrow(/Zeile 2/);
    expect(() => parseGuide("> a\n> <b>\n")).toThrow(/Zeile 2/);
  });

  it("joins multi-line paragraphs and quotes into the same inlines as one line", () => {
    const doc = parseGuide("# T\n\nEin **fetter**\nSatz mit `code`\n\n> Hinweis:\n> *nur* lokal.\n");
    expect(doc.blocks[1]).toEqual({ kind: "paragraph", text: [
      { kind: "text", text: "Ein " }, { kind: "strong", text: "fetter" }, { kind: "text", text: " Satz mit " }, { kind: "code", text: "code" },
    ] });
    expect(doc.blocks[2]).toEqual({ kind: "quote", text: [
      { kind: "text", text: "Hinweis: " }, { kind: "em", text: "nur" }, { kind: "text", text: " lokal." },
    ] });
  });

  it("rejects headings deeper than level 3, also with seven or more #", () => {
    expect(() => parseGuide("# T\n\n####### x\n")).toThrow(/Zeile 3: Ueberschriften nur bis Ebene 3/);
  });

  it("rejects a heading marker without text", () => {
    expect(() => parseGuide("# T\n\n## \n")).toThrow(/Zeile 3: Ueberschrift ohne Text/);
    expect(() => parseGuide("# T\n\n##\n")).toThrow(/Zeile 3: Ueberschrift ohne Text/);
  });

  it("keeps anchors unique when a heading text looks like a numbered duplicate", () => {
    const ids = (md: string) => parseGuide(md).headings.map((h) => h.id);
    expect(ids("## a\n\n## a 2\n\n## a\n")).toEqual(["a", "a-2", "a-3"]);
    const other = ids("## a\n\n## a\n\n## a 2\n");
    expect(new Set(other).size).toBe(3);
    expect(other.slice(0, 2)).toEqual(["a", "a-2"]);
  });

  it("leaves a lone asterisk as plain text, also in a code span", () => {
    const doc = parseGuide("# T\n\nSELECT * FROM t\n\nSo: `SELECT * FROM t`\n");
    expect(doc.blocks[1]).toEqual({ kind: "paragraph", text: [{ kind: "text", text: "SELECT * FROM t" }] });
    expect(doc.blocks[2]).toEqual({ kind: "paragraph", text: [{ kind: "text", text: "So: " }, { kind: "code", text: "SELECT * FROM t" }] });
  });
});
