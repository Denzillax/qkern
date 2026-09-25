/**
 * Markdown-Parser der Einstiegsdoku (2.30). Absichtlich klein: er versteht
 * genau die Elemente, die die fuenf Seiten brauchen, und wirft bei allem
 * anderen mit Zeilennummer. Der Fehler faellt im Vertragstest auf, nicht beim
 * Leser. Keine Abhaengigkeit, kein HTML, keine Bilder, keine Verschachtelung.
 *
 * Aufzaehlungen beginnen nur mit "- ". Ein "*" am Zeilenanfang ist Kursivschrift
 * im Absatz, kein Listenpunkt. Inline-Code wird vor fett und kursiv erkannt,
 * damit Sternchen im Code Text bleiben.
 */
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; id: string; text: Inline[] }
  | { kind: "paragraph"; text: Inline[] }
  | { kind: "list"; items: Inline[][] }
  | { kind: "ordered"; items: Inline[][] }
  | { kind: "code"; language: string; code: string }
  | { kind: "table"; header: Inline[][]; rows: Inline[][][] }
  | { kind: "quote"; text: Inline[] };

export type GuideDocument = {
  title: string;
  blocks: Block[];
  headings: Array<{ level: 2 | 3; id: string; text: string }>;
};

export class GuideSyntaxError extends Error {
  constructor(public readonly line: number, message: string) {
    super(`Zeile ${line}: ${message}`);
    this.name = "GuideSyntaxError";
  }
}

const UMLAUTS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss", é: "e", è: "e", à: "a" };

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[äöüßéèà]/g, (ch) => UMLAUTS[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function plain(inlines: Inline[]): string {
  return inlines.map((inline) => inline.text).join("");
}

// Reihenfolge zaehlt: Code zuerst, dann fett vor kursiv.
const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))|(!\[)|(<[a-zA-Z/])/g;
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;

export function parseInline(text: string, line: number): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    const token = match[0];
    if (match[5]) throw new GuideSyntaxError(line, "Bilder sind in der Einstiegsdoku nicht vorgesehen");
    if (match[6]) throw new GuideSyntaxError(line, "HTML ist in der Einstiegsdoku nicht vorgesehen");
    if (index > last) out.push({ kind: "text", text: text.slice(last, index) });
    if (match[1]) out.push({ kind: "code", text: token.slice(1, -1) });
    else if (match[2]) out.push({ kind: "strong", text: token.slice(2, -2) });
    else if (match[3]) out.push({ kind: "em", text: token.slice(1, -1) });
    else {
      const link = LINK.exec(token);
      if (!link) throw new GuideSyntaxError(line, "Link nicht lesbar");
      out.push({ kind: "link", text: link[1], href: link[2] });
    }
    last = index + token.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

function tableCells(row: string, line: number): string[] {
  const trimmed = row.trim();
  if (trimmed.length < 2 || !trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    throw new GuideSyntaxError(line, "Tabellenzeile muss mit | beginnen und enden");
  }
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
}

const INDENTED = /^\s+\S/;
const HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const BULLET = /^-\s+(.*)$/;
const NUMBER = /^\d+\.\s+(.*)$/;
const DIVIDER = /^\|(\s*:?-{3,}:?\s*\|)+$/;
// Zeilen, die einen Absatz beenden, weil dort ein anderer Block beginnt.
const BLOCK_START = /^(#|```|\||> |-\s|\d+\.\s|<|\s+\S)/;

export function parseGuide(markdown: string): GuideDocument {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  const headings: GuideDocument["headings"] = [];
  const seen = new Map<string, number>();
  let title = "";
  let i = 0;

  const anchor = (text: string) => {
    const base = slugify(text);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = i + 1;
    if (raw.trim() === "") {
      i += 1;
      continue;
    }
    if (INDENTED.test(raw)) {
      throw new GuideSyntaxError(line, "eingerueckte Zeilen (verschachtelte Listen, Codeblock ohne Zaun) sind nicht vorgesehen");
    }

    const heading = HEADING.exec(raw);
    if (heading) {
      const level = heading[1].length;
      if (level > 3) throw new GuideSyntaxError(line, "Ueberschriften nur bis Ebene 3");
      const text = parseInline(heading[2], line);
      if (level === 1 && title) throw new GuideSyntaxError(line, "nur eine Ueberschrift der Ebene 1");
      const id = anchor(plain(text));
      if (level === 1) title = plain(text);
      else headings.push({ level: level as 2 | 3, id, text: plain(text) });
      blocks.push({ kind: "heading", level: level as 1 | 2 | 3, id, text });
      i += 1;
      continue;
    }

    if (raw.startsWith("```")) {
      const language = raw.slice(3).trim();
      if (!language) throw new GuideSyntaxError(line, "Codeblock ohne Sprache");
      const code: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].startsWith("```")) {
        code.push(lines[j]);
        j += 1;
      }
      if (j >= lines.length) throw new GuideSyntaxError(line, "Codeblock nie geschlossen");
      if (lines[j].trim() !== "```") throw new GuideSyntaxError(j + 1, "schliessender Zaun muss allein stehen");
      blocks.push({ kind: "code", language, code: code.join("\n") });
      i = j + 1;
      continue;
    }

    if (raw.startsWith("|")) {
      const header = tableCells(raw, line).map((cell) => parseInline(cell, line));
      const divider = (lines[i + 1] ?? "").trim();
      if (!DIVIDER.test(divider)) throw new GuideSyntaxError(line + 1, "Tabelle ohne Trennzeile");
      if (tableCells(divider, line + 1).length !== header.length) {
        throw new GuideSyntaxError(line + 1, "Trennzeile passt nicht zum Tabellenkopf");
      }
      const rows: Inline[][][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].startsWith("|")) {
        const rowLine = j + 1;
        const cells = tableCells(lines[j], rowLine);
        if (cells.length !== header.length) {
          throw new GuideSyntaxError(rowLine, `Tabellenzeile hat ${cells.length} Zellen, Kopf hat ${header.length}`);
        }
        rows.push(cells.map((cell) => parseInline(cell, rowLine)));
        j += 1;
      }
      blocks.push({ kind: "table", header, rows });
      i = j;
      continue;
    }

    if (raw.startsWith("> ")) {
      const parts: string[] = [];
      let j = i;
      while (j < lines.length && lines[j].startsWith("> ")) {
        parts.push(lines[j].slice(2).trim());
        j += 1;
      }
      blocks.push({ kind: "quote", text: parseInline(parts.join(" "), line) });
      i = j;
      continue;
    }

    if (BULLET.test(raw) || NUMBER.test(raw)) {
      const ordered = NUMBER.test(raw);
      const pattern = ordered ? NUMBER : BULLET;
      const items: Inline[][] = [];
      let j = i;
      while (j < lines.length && pattern.test(lines[j])) {
        items.push(parseInline(pattern.exec(lines[j])![1], j + 1));
        j += 1;
      }
      if (j < lines.length && INDENTED.test(lines[j])) {
        throw new GuideSyntaxError(j + 1, "verschachtelte Listen sind nicht vorgesehen");
      }
      blocks.push(ordered ? { kind: "ordered", items } : { kind: "list", items });
      i = j;
      continue;
    }

    if (raw.startsWith("<")) throw new GuideSyntaxError(line, "HTML ist in der Einstiegsdoku nicht vorgesehen");

    // Absatz: die erste Zeile gehoert immer dazu (auch "#ohne-Leerzeichen"),
    // damit die Schleife nie haengen bleibt.
    const parts: string[] = [raw.trim()];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== "" && !BLOCK_START.test(lines[j])) {
      parts.push(lines[j].trim());
      j += 1;
    }
    blocks.push({ kind: "paragraph", text: parseInline(parts.join(" "), line) });
    i = j;
  }

  // Ohne Ueberschrift der Ebene 1 bleibt title leer. Dass jede Seite eine hat,
  // prueft der Vertragstest der Seiten, nicht der Parser: so lassen sich auch
  // Ausschnitte ohne Titel parsen.
  return { title, blocks, headings };
}
