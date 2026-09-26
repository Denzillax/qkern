/**
 * Markdown-Parser der Einstiegsdoku (2.30). Absichtlich klein: er versteht
 * genau die Elemente, die die fuenf Seiten brauchen, und wirft bei allem
 * anderen mit Zeilennummer. Der Fehler faellt im Vertragstest auf, nicht beim
 * Leser. Keine Abhaengigkeit, kein HTML, keine Bilder, keine Verschachtelung.
 *
 * Aufzaehlungen beginnen nur mit "- ". "* " oder "+ " mit Leerzeichen am
 * Zeilenanfang wirft; nur "*kursiv*" ohne Leerzeichen nach dem Stern ist
 * Kursivschrift. Inline-Code wird vor fett und kursiv erkannt, damit Sternchen
 * im Code Text bleiben.
 */
export type Inline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong"; readonly text: string }
  | { readonly kind: "em"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "link"; readonly text: string; readonly href: string };

export type Inlines = readonly Inline[];

export type Block =
  | { readonly kind: "heading"; readonly level: 1 | 2 | 3; readonly id: string; readonly text: Inlines }
  | { readonly kind: "paragraph"; readonly text: Inlines }
  | { readonly kind: "list"; readonly items: readonly Inlines[] }
  | { readonly kind: "ordered"; readonly items: readonly Inlines[] }
  | { readonly kind: "code"; readonly language: string; readonly code: string }
  | { readonly kind: "table"; readonly header: readonly Inlines[]; readonly rows: readonly (readonly Inlines[])[] }
  | { readonly kind: "quote"; readonly text: Inlines };

export type GuideHeading = { readonly level: 2 | 3; readonly id: string; readonly text: string };

export type GuideDocument = {
  readonly title: string;
  readonly blocks: readonly Block[];
  readonly headings: readonly GuideHeading[];
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

export function plain(inlines: Inlines): string {
  return inlines.map((inline) => inline.text).join("");
}

// Reihenfolge zaehlt: Code zuerst, dann fett vor kursiv. Gruppen: 1 Code,
// 2 fett, 3 kursiv, 4 Link mit 5 Linktext und 6 Linkziel, 7 Bild, 8 HTML.
const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[([^\]]+)\]\(([^)\s]+)\))|(!\[)|(<[a-zA-Z/])/g;

export function parseInline(text: string, line: number): Inlines {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    const token = match[0];
    if (match[7]) throw new GuideSyntaxError(line, "Bilder sind in der Einstiegsdoku nicht vorgesehen");
    if (match[8]) throw new GuideSyntaxError(line, "HTML ist in der Einstiegsdoku nicht vorgesehen");
    if (index > last) out.push({ kind: "text", text: text.slice(last, index) });
    if (match[1]) out.push({ kind: "code", text: token.slice(1, -1) });
    else if (match[2]) out.push({ kind: "strong", text: token.slice(2, -2) });
    else if (match[3]) out.push({ kind: "em", text: token.slice(1, -1) });
    else {
      const label = match[5] ?? "";
      const href = match[6] ?? "";
      if (/[`*]/.test(label)) throw new GuideSyntaxError(line, "Auszeichnung im Linktext ist nicht vorgesehen");
      if (href.includes("(")) throw new GuideSyntaxError(line, "Klammer im Linkziel ist nicht vorgesehen");
      out.push({ kind: "link", text: label, href });
    }
    last = index + token.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

type SourceLine = { readonly text: string; readonly line: number };

/**
 * Mehrzeilige Absaetze und Zitate: jede Quellzeile wird einzeln geparst, damit
 * ein Fehler die richtige Zeile nennt. Leere Zeilen fallen weg, die uebrigen
 * werden mit einem Leerzeichen verbunden und benachbarte Textknoten
 * verschmolzen. Auszeichnungen koennen darum nicht ueber einen Umbruch reichen.
 */
function parseLines(parts: readonly SourceLine[]): Inlines {
  const out: Inline[] = [];
  const push = (inline: Inline) => {
    const prev = out[out.length - 1];
    if (inline.kind === "text" && prev?.kind === "text") out[out.length - 1] = { kind: "text", text: prev.text + inline.text };
    else out.push(inline);
  };
  parts
    .filter((part) => part.text !== "")
    .forEach((part, index) => {
      if (index > 0) push({ kind: "text", text: " " });
      for (const inline of parseInline(part.text, part.line)) push(inline);
    });
  return out;
}

type Parsed = { readonly block: Block; readonly next: number };

const INDENTED = /^\s+\S/;
const HEADING = /^(#+)\s+(.+?)\s*$/;
const EMPTY_HEADING = /^#+\s*$/;
const BULLET = /^-\s+(.*)$/;
const NUMBER = /^\d+\.\s+(.*)$/;
const DIVIDER = /^\|(\s*:?-{3,}:?\s*\|)+$/;
// Was wie Markdown aussieht, die Doku aber nicht nutzt: wirft statt Absatztext.
const REJECTED: ReadonlyArray<readonly [RegExp, string]> = [
  [/^~~~/, "Codeblock nur mit Backticks"],
  [/^(-{3,}|\*{3,}|_{3,})\s*$/, "Trennlinien sind nicht vorgesehen"],
  [/^={3,}\s*$/, "Setext-Ueberschriften sind nicht vorgesehen"],
  [/^[*+]\s/, "Aufzaehlung nur mit -"],
  [/^>(?! )/, "Zitat braucht > mit Leerzeichen"],
  [/^</, "HTML ist in der Einstiegsdoku nicht vorgesehen"],
];
// Zeilen, die einen Absatz beenden, weil dort ein anderer Block beginnt. Was
// abgewiesen wird, steht nur in REJECTED und beendet den Absatz ueber
// endsParagraph, damit der Fehler genau diese Zeile nennt.
const BLOCK_START = /^(#|```|\||> |-\s|\d+\.\s|\s+\S)/;

function endsParagraph(raw: string): boolean {
  return raw.trim() === "" || BLOCK_START.test(raw) || REJECTED.some(([pattern]) => pattern.test(raw));
}

function headingLevel(hashes: string, line: number): 1 | 2 | 3 {
  switch (hashes.length) {
    case 1: return 1;
    case 2: return 2;
    case 3: return 3;
    default: throw new GuideSyntaxError(line, "Ueberschriften nur bis Ebene 3");
  }
}

function tableCells(row: string, line: number): string[] {
  const trimmed = row.trim();
  if (trimmed.length < 2 || !trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    throw new GuideSyntaxError(line, "Tabellenzeile muss mit | beginnen und enden");
  }
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
}

function parseFence(lines: readonly string[], i: number): Parsed {
  const line = i + 1;
  const language = lines[i].slice(3).trim();
  if (!language) throw new GuideSyntaxError(line, "Codeblock ohne Sprache");
  const code: string[] = [];
  let j = i + 1;
  while (j < lines.length && !lines[j].startsWith("```")) {
    code.push(lines[j]);
    j += 1;
  }
  if (j >= lines.length) throw new GuideSyntaxError(line, "Codeblock nie geschlossen");
  if (lines[j].trim() !== "```") throw new GuideSyntaxError(j + 1, "Schliessender Zaun muss allein stehen");
  return { block: { kind: "code", language, code: code.join("\n") }, next: j + 1 };
}

function parseTable(lines: readonly string[], i: number): Parsed {
  const line = i + 1;
  const header = tableCells(lines[i], line).map((cell) => parseInline(cell, line));
  const divider = (lines[i + 1] ?? "").trim();
  if (!DIVIDER.test(divider)) throw new GuideSyntaxError(line + 1, "Tabelle ohne Trennzeile");
  if (tableCells(divider, line + 1).length !== header.length) {
    throw new GuideSyntaxError(line + 1, "Trennzeile passt nicht zum Tabellenkopf");
  }
  const rows: Inlines[][] = [];
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
  return { block: { kind: "table", header, rows }, next: j };
}

function parseQuote(lines: readonly string[], i: number): Parsed {
  const parts: SourceLine[] = [];
  let j = i;
  while (j < lines.length && lines[j].startsWith("> ")) {
    parts.push({ text: lines[j].slice(2).trim(), line: j + 1 });
    j += 1;
  }
  return { block: { kind: "quote", text: parseLines(parts) }, next: j };
}

function parseList(lines: readonly string[], i: number): Parsed {
  const ordered = NUMBER.test(lines[i]);
  const pattern = ordered ? NUMBER : BULLET;
  const items: Inlines[] = [];
  let j = i;
  for (let match = pattern.exec(lines[j]); match; match = j < lines.length ? pattern.exec(lines[j]) : null) {
    items.push(parseInline(match[1], j + 1));
    j += 1;
  }
  if (j < lines.length && INDENTED.test(lines[j])) {
    throw new GuideSyntaxError(j + 1, "Verschachtelte Listen sind nicht vorgesehen");
  }
  return { block: ordered ? { kind: "ordered", items } : { kind: "list", items }, next: j };
}

function parseParagraph(lines: readonly string[], i: number): Parsed {
  // Die erste Zeile gehoert immer dazu (auch "#ohne-Leerzeichen"), damit die
  // Schleife in parseGuide nie haengen bleibt.
  const parts: SourceLine[] = [{ text: lines[i].trim(), line: i + 1 }];
  let j = i + 1;
  while (j < lines.length && !endsParagraph(lines[j])) {
    parts.push({ text: lines[j].trim(), line: j + 1 });
    j += 1;
  }
  return { block: { kind: "paragraph", text: parseLines(parts) }, next: j };
}

export function parseGuide(markdown: string): GuideDocument {
  const lines = markdown.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  const headings: GuideHeading[] = [];
  const used = new Set<string>();
  let title = "";
  let i = 0;

  // Eindeutig auch dann, wenn ein Text selbst wie "a 2" aussieht.
  const anchor = (text: string, line: number) => {
    const base = slugify(text);
    if (!base) throw new GuideSyntaxError(line, "Ueberschrift ergibt keinen Anker");
    let id = base;
    for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
    used.add(id);
    return id;
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = i + 1;
    if (raw.trim() === "") {
      i += 1;
      continue;
    }
    if (INDENTED.test(raw)) {
      throw new GuideSyntaxError(line, "Eingerueckte Zeilen (verschachtelte Listen, Codeblock ohne Zaun) sind nicht vorgesehen");
    }
    for (const [pattern, message] of REJECTED) {
      if (pattern.test(raw)) throw new GuideSyntaxError(line, message);
    }

    if (EMPTY_HEADING.test(raw)) throw new GuideSyntaxError(line, "Ueberschrift ohne Text");
    const heading = HEADING.exec(raw);
    if (heading) {
      const level = headingLevel(heading[1], line);
      if (/\s#+$/.test(heading[2])) throw new GuideSyntaxError(line, "Schliessende Rauten sind nicht vorgesehen");
      const text = parseInline(heading[2], line);
      // Die Website macht jede Ueberschrift selbst zum Ankerlink; ein Link darin waere ein Link im Link.
      if (text.some((inline) => inline.kind === "link")) throw new GuideSyntaxError(line, "Links in Ueberschriften sind nicht vorgesehen");
      if (level === 1 && title) throw new GuideSyntaxError(line, "Nur eine Ueberschrift der Ebene 1");
      const id = anchor(plain(text), line);
      if (level === 1) title = plain(text);
      else headings.push({ level, id, text: plain(text) });
      blocks.push({ kind: "heading", level, id, text });
      i += 1;
      continue;
    }

    const parse = raw.startsWith("```") ? parseFence
      : raw.startsWith("|") ? parseTable
      : raw.startsWith("> ") ? parseQuote
      : BULLET.test(raw) || NUMBER.test(raw) ? parseList
      : parseParagraph;
    const { block, next } = parse(lines, i);
    blocks.push(block);
    i = next;
  }

  // Ohne Ueberschrift der Ebene 1 bleibt title leer. Dass jede Seite eine hat,
  // prueft der Vertragstest der Seiten, nicht der Parser: so lassen sich auch
  // Ausschnitte ohne Titel parsen.
  return { title, blocks, headings };
}
