import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Leere Zustaende, der eine Kopier-Weg, maskierte Geheimnisse, zerstoerende
 * Aktionen und der nachgerechnete Kontrast (2.137).
 *
 * **Der Befund.** Die Console zeigte an rund zwanzig Stellen zwei Worte, wo
 * ein Satz hingehoert: "Keine Dead Letters", "Keine Zustellungen", "Keine
 * Zeilen". Sie sagen, dass nichts da ist, und nicht, was hier erscheint oder
 * wie man es anlegt. Dazu lagen vier rohe `navigator.clipboard`-Aufrufe ohne
 * Rueckmeldung in der Console, drei `window.confirm`-Dialoge mit deutschem
 * Text im Code, und der graue Nebentext lag im Light Mode unter dem, was
 * WCAG AA fuer kleinen Text verlangt.
 *
 * **Was dieser Vertrag kann.** Er liest Text. Er sagt, dass an jeder Stelle,
 * die einen leeren Zustand zeigt, ein Satz steht; dass es genau eine Datei
 * mit `navigator.clipboard` gibt; dass die Ansichten mit Geheimnissen
 * maskieren; dass die schwersten Loeschungen den Namen abtippen lassen; und
 * dass die Kontrastwerte stimmen, die im Stylesheet behauptet werden.
 *
 * **Was er nicht kann.** Er rendert nichts und klickt nichts. Ob der
 * Kopier-Knopf im Browser wirklich "Kopiert" zeigt, sagt `CopyValue` selbst
 * und der Render-Vertrag; ob ein Browser den Nebentext mit dem gerechneten
 * Verhaeltnis zeichnet, sagt die Rechnung und nicht dieser Vertrag. Er
 * rechnet die Formel von WCAG 2.1 nach, nicht das Ergebnis eines Monitors.
 */
const VIEWS = path.resolve(process.cwd(), "components/console");
const CSS = path.resolve(process.cwd(), "app/globals.css");

/**
 * Diese Dateien gehoeren einem Nachbarslice, der zur selben Zeit an ihnen
 * arbeitet. Sie bleiben ausgenommen, damit dieser Vertrag nicht an einer
 * Aenderung faellt, die ihm nicht gehoert. Die Ausnahme ist eine Schuld und
 * kein Urteil: `table-view.tsx` zeigt heute "Keine Zeilen, die RLS dir
 * zeigt." und wuerde hier fallen.
 */
const FOREIGN: ReadonlySet<string> = new Set([
  "table-view.tsx", "table-designer-view.tsx", "policies-view.tsx", "live-api-view.tsx",
  "schema-visualizer-view.tsx", "console-app.tsx", "overview-view.tsx",
]);

async function views(): Promise<string[]> {
  return (await readdir(VIEWS)).filter((name) => name.endsWith(".tsx") && !FOREIGN.has(name));
}

/**
 * Ein leerer Zustand, wie die Console ihn schreibt: ein `<p className="muted">`
 * oder ein `<EmptyState>`/`<InlineEmptyState>` hinter `length === 0`.
 *
 * Nicht erfasst sind `<small>` und `<strong>` -- das sind Werte in einer
 * Zeile und keine leeren Zustaende -- und nicht die Zustandstexte, die aus
 * einem `lib/console/*-texts`-Modul als Variable hereinkommen; die stehen
 * nicht als Literal in der Ansicht und sind fuer einen Vertrag auf Text
 * nicht zu lesen.
 */
const EMPTY = /length\s*===\s*0[^;]{0,60}?(?:<p className="muted">|<(?:Inline)?EmptyState\b|<div className="live-module-state compact">)([^;]{0,1400}?)(?:<\/p>|\/>|<\/div>)/gs;
/**
 * Die zweite Form, in der die Console Leere schreibt: eine Platzhalterzeile in
 * einer `detail-list`, also `length === 0 ? <div><span>…</span><strong>–</strong>`.
 *
 * Sie stand beim ersten Entwurf dieses Vertrags nicht drin, und die
 * Mutationsprobe hat es gezeigt: Ein zurueckgedrehtes "Keine Dead Letters"
 * lief gruen durch. Drei Stellen haengen daran.
 */
const EMPTY_ROW = /length\s*===\s*0\s*\?\s*<div><span>([^;]{0,1400}?)<\/span>/gs;
const LITERAL = /\bt\("((?:[^"\\]|\\.)*)"\)/g;

/** Was ein leerer Zustand nicht ist, mit dem Grund je Muster. */
const NOT_EMPTY: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  // Ein Filter, der nichts trifft, ist kein leerer Zustand: Die Liste hat
  // Eintraege, nur passt keiner. Der Satz dazu waere eine Belehrung.
  { pattern: /passt zum Filter|passt zum Muster/u, why: "Filterergebnis" },
  // Ein Ladezustand endet auf drei Punkte und ist im naechsten Moment weg.
  { pattern: /…"?\s*$/u, why: "Ladezustand" },
];

/** Jeder Satz eines leeren Zustands, je Datei, mit der Fundstelle. */
async function emptyStates(): Promise<Array<{ file: string; text: string }>> {
  const found: Array<{ file: string; text: string }> = [];
  for (const file of await views()) {
    const source = await readFile(path.join(VIEWS, file), "utf8");
    for (const hit of [...source.matchAll(EMPTY), ...source.matchAll(EMPTY_ROW)]) {
      // Alle Literale des Zweigs zusammen: Ein leerer Zustand darf seinen
      // Satz aus zwei `t(...)` bauen, und oft tut er das, weil der kurze
      // Schluessel schon uebersetzt ist und bleiben soll.
      const texts = [...hit[1].matchAll(LITERAL)].map((literal) => literal[1]);
      if (texts.length === 0) continue;
      const text = texts.join(" ");
      if (NOT_EMPTY.some((rule) => rule.pattern.test(text))) continue;
      found.push({ file, text });
    }
  }
  return found;
}

describe("console empty state contract", () => {
  it("leaves no empty state standing without a sentence that explains it", async () => {
    const states = await emptyStates();
    // Ohne diese Zahl waere die Pruefung leer gruen, sobald sich die Form der
    // Ansichten aendert und das Muster nichts mehr findet.
    expect(states.length, "Der Vertrag findet die leeren Zustaende nicht mehr").toBeGreaterThanOrEqual(50);
    const bare = states
      // Ein Satz, nicht zwei Worte: mindestens vierzig Zeichen, und er endet
      // wie ein Satz. "Keine Dead Letters" erfuellt beides nicht, "Keine Dead
      // Letters in dieser Queue. Eine Nachricht landet hier erst, ..." beides.
      .filter(({ text }) => text.trim().length < 40 || !/[.!?]$/u.test(text.trim()))
      .map(({ file, text }) => `${file}: ${text}`);
    expect(bare, "Diese leeren Zustaende stellen nur fest, dass nichts da ist").toEqual([]);
  });

  it("gives an action to the empty states of the views that can create the thing", async () => {
    // Nur wo die Ansicht es wirklich kann. Ein Knopf in einer Ansicht, die
    // nur liest, waere eine Luege; darum steht hier eine Liste und keine
    // Regel ueber alle Dateien. Jede dieser Ansichten hat ein `POST` auf
    // ihrer Route, das im selben Modul aufgerufen wird.
    const CREATES: ReadonlyArray<[string, string]> = [
      ["api-keys-view.tsx", "Ersten Public Key anlegen"],
      ["storage-view.tsx", "Ersten Bucket anlegen"],
      ["compute-view.tsx", "Erste Function anlegen"],
      ["compute-view.tsx", "Ersten Cron-Job anlegen"],
      ["compute-view.tsx", "Ersten Webhook anlegen"],
      ["cron-view.tsx", "Ersten Cron-Job anlegen"],
      ["queues-view.tsx", "Erste Queue anlegen"],
    ];
    for (const [file, label] of CREATES) {
      const source = await readFile(path.join(VIEWS, file), "utf8");
      expect(source, `${file}: der leere Zustand fuehrt nicht zum Anlegen`).toContain(`action={<button`);
      expect(source, `${file}: ${label} fehlt`).toContain(`t("${label}")`);
    }
  });

  it("keeps exactly one way to copy a value", async () => {
    // Die eine Datei, die `navigator.clipboard` anfasst. Jede weitere waere
    // ein zweiter Weg mit eigener Rueckmeldung, eigenem Fehlerfall und
    // eigener Breite.
    //
    // Die Ausnahme ist weg, und sie hat genau einen Schnitt gehalten:
    // `live-api-view.tsx` hatte den letzten rohen Aufruf und gehoerte beim
    // Schreiben dieses Falls einem anderen Zweig. Jetzt laeuft auch das
    // einmalige Geheimnis dort durch dasselbe Bauteil, also ist die Liste
    // wieder einelementig.
    const owners: string[] = [];
    for (const root of ["components", "app", "lib"]) {
      for (const file of await walk(path.resolve(process.cwd(), root))) {
        if (!/\.tsx?$/u.test(file)) continue;
        if ((await readFile(file, "utf8")).includes("navigator.clipboard")) owners.push(path.basename(file));
      }
    }
    expect(owners.sort()).toEqual(["copy-value.tsx"]);
  });

  it("routes every copyable technical value through that one way", async () => {
    // Die Umkehrung: Nicht nur ist der rohe Aufruf weg, die Ansichten mit
    // einem kopierbaren Wert benutzen wirklich das gemeinsame Bauteil.
    for (const file of ["api-keys-view.tsx", "jwt-keys-view.tsx", "s3-access-view.tsx"]) {
      const source = await readFile(path.join(VIEWS, file), "utf8");
      expect(source, `${file} kopiert an der gemeinsamen Stelle vorbei`)
        .toContain('from "@/components/console/copy-value"');
      expect(source, `${file} benutzt CopyValue nicht`).toContain("<CopyValue");
    }
    // Auch die Docs haengen an demselben Mechanismus und ziehen ihn nicht
    // nach: `copy-button.tsx` ist seit 2.137 nur noch eine Huelle.
    const docs = await readFile(path.resolve(process.cwd(), "components/docs/copy-button.tsx"), "utf8");
    expect(docs).toContain('from "@/components/console/copy-value"');
    expect(docs).not.toContain("navigator.clipboard");
    expect(docs, "die Huelle zieht das Docs-Stylesheet wieder mit").not.toContain("docs.module.css");
  });

  it("prints a secret masked and never unmasked by default", async () => {
    // `maskSecret` laesst die Art lesbar und zeigt vier Zeichen zum
    // Wiedererkennen. Wer das Geheimnis ganz sehen will, drueckt "Anzeigen".
    const { maskSecret } = await import("@/components/console/console-format");
    expect(maskSecret("qk_service_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-x7Jk9"))
      .toBe("qk_service_••••••••7Jk9");
    expect(maskSecret("qk_public_AbCdEfGhIjKlMnOp")).toBe("qk_public_••••••••MnOp");
    // Zu kurz zum Teilen: dann gar nichts zeigen, nicht die Haelfte.
    expect(maskSecret("qk_service_abc")).toBe("qk_service_••••••••");

    // Genau der eine Ausdruck je Ansicht, und nicht bloss das Wort
    // `revealed` irgendwo in der Datei. Die Mutationsprobe hat gezeigt, warum:
    // Ein `revealed ?` steht auch am Symbol des Umschalters, also lief eine
    // Ansicht, in der das Geheimnis gar nicht mehr aufzudecken war, gruen
    // durch. Verlangt ist der Dreisatz "aufgedeckt oder maskiert" auf dem
    // Geheimnis selbst.
    const SECRETS: ReadonlyArray<[string, string]> = [
      ["api-keys-view.tsx", "revealed ? secret : maskSecret(secret)"],
      ["s3-access-view.tsx", "revealed ? issued.secret : maskSecret(issued.secret)"],
    ];
    for (const [file, expression] of SECRETS) {
      const source = await readFile(path.join(VIEWS, file), "utf8");
      expect(source, `${file}: ${expression} fehlt`).toContain(expression);
      // Und der Anfangszustand ist verdeckt, nicht offen.
      expect(source, `${file} startet nicht maskiert`).toMatch(/const \[revealed, setRevealed\] = useState\(false\)/u);
      // Der Umschalter ist da und beschriftet, sonst ist die Maske eine Falle.
      expect(source, `${file} hat keinen Umschalter`).toContain('t("Anzeigen")');
    }
    // Die JWT-Schluessel sind oeffentlich und werden darum nicht maskiert.
    // Der Vertrag haelt den Grund fest, damit die naechste Runde nicht aus
    // Gruendlichkeit etwas verdeckt, was jede App im Netz lesen kann.
    const jwt = await readFile(path.join(VIEWS, "jwt-keys-view.tsx"), "utf8");
    expect(jwt).not.toContain("maskSecret");
    expect(jwt).toContain("Diese Schlüssel sind öffentlich");
  });

  it("makes the heaviest destructive actions type the name", async () => {
    // Die schwersten: Was verschwindet, kommt nicht zurueck, und eine
    // laufende Anwendung haengt daran. Jede dieser Stellen laeuft ueber
    // `DangerousAction` mit `confirmName`.
    const HEAVY: ReadonlyArray<[string, string]> = [
      ["api-keys-view.tsx", "key.name"],
      ["s3-access-view.tsx", "key.name"],
      ["storage-view.tsx", "bucket.name"],
      ["compute-view.tsx", "fn.name"],
      ["compute-view.tsx", "job.name"],
      ["compute-view.tsx", "hook.name"],
      ["cron-view.tsx", "job.name"],
    ];
    for (const [file, name] of HEAVY) {
      const source = await readFile(path.join(VIEWS, file), "utf8");
      expect(source, `${file}: ${name} wird nicht abgetippt`).toContain(`confirmName={${name}}`);
    }
    // Und keine dieser Dateien faellt auf den Browserdialog zurueck. Er sieht
    // ueberall gleich aus, und drei seiner Texte standen auf Deutsch im Code.
    for (const [file] of HEAVY) {
      // Kommentarzeilen zaehlen nicht: Mehrere dieser Dateien nennen in ihrer
      // Begruendung genau den Dialog, den sie abgeloest haben.
      const source = code(await readFile(path.join(VIEWS, file), "utf8"));
      expect(source, `${file} fragt noch mit window.confirm`).not.toContain("window.confirm");
    }
    // Das Bauteil selbst: ohne Treffer kein Knopf.
    const part = await readFile(path.join(VIEWS, "dangerous-action.tsx"), "utf8");
    expect(part).toContain("disabled={!matches}");
    expect(part).toContain("typed === confirmName");
  });

  it("invents no destructive action that no route can carry", async () => {
    // Ein Projekt zuruecksetzen kann die Console nicht: Es gibt keine Route
    // dafuer, also steht kein Knopf da. Loeschen kann sie seit 2.173, und
    // genau an einer Stelle, hinter der die Route steht.
    for (const file of await views()) {
      const source = await readFile(path.join(VIEWS, file), "utf8");
      expect(source, `${file} verspricht ein Zuruecksetzen des Projekts`)
        .not.toMatch(/t\("Projekt zurücksetzen"\)/u);
      if (file !== "project-deletion.tsx") {
        expect(source, `${file} verspricht ein Loeschen des Projekts`).not.toMatch(/t\("Projekt löschen"\)/u);
      }
    }
    const route = await readFile(path.resolve(process.cwd(), "app/api/v1/projects/[projectId]/route.ts"), "utf8");
    expect(route).toContain("export async function DELETE(");
    expect(route).toContain('requireCapability(context, "project_delete");');
    // Und die API-Keys versprechen keine Rotation, weil keine Route sie kann.
    const keys = await readFile(path.join(VIEWS, "api-keys-view.tsx"), "utf8");
    expect(keys).not.toMatch(/t\("Rotieren"\)/u);
    expect(keys).toContain("Eine Rotation gibt es hier nicht, weil keine Route sie kann.");
  });

  it("holds the muted text at or above the AA ratio it claims", async () => {
    const css = await readFile(CSS, "utf8");
    // Die Token, die das Stylesheet wirklich fuehrt. Steht hier etwas
    // anderes, ist die Rechnung im Kommentar daneben stillschweigend falsch.
    expect(css).toContain("--qkern-text-muted: #667083;");
    expect(css).toContain("--qkern-text-muted: #9aa8bc;");
    expect(css).toContain("--qkern-surface-2: #f1f4f9;");
    expect(css).toContain("--qkern-surface-2: #121e30;");

    // Light Mode: der Nebentext auf den drei hellen Gruenden. `surface-2` ist
    // der dunkelste und damit der Fall, der entscheidet.
    expect(round(ratio("#667083", "#f1f4f9"))).toBe(4.52);
    expect(round(ratio("#667083", "#f8f9fc"))).toBe(4.74);
    expect(round(ratio("#667083", "#ffffff"))).toBe(4.99);
    // Der Befund vor diesem Fall, damit die Grenze nicht wieder unterschritten
    // wird, ohne dass jemand es merkt.
    expect(round(ratio("#697386", "#f1f4f9"))).toBe(4.33);
    expect(ratio("#697386", "#f1f4f9")).toBeLessThan(4.5);
    // Und nur so weit angehoben, wie noetig: zwei Stufen dunkler reichten nicht.
    expect(ratio("#677184", "#f1f4f9")).toBeLessThan(4.5);

    // Dark Mode blieb, wie er war, und liegt weit darueber.
    expect(round(ratio("#9aa8bc", "#121e30"))).toBe(6.94);
    expect(round(ratio("#9aa8bc", "#0e1828"))).toBe(7.37);
    expect(round(ratio("#9aa8bc", "#080f1d"))).toBe(7.94);
    for (const dark of ["#121e30", "#0e1828", "#080f1d"]) {
      expect(ratio("#9aa8bc", dark), `Dark Mode auf ${dark}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

/** Alle Dateien unter einem Pfad, `node_modules` und `.next` ausgenommen. */
async function walk(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...await walk(full));
    else found.push(full);
  }
  return found;
}

/**
 * Relative Leuchtdichte nach WCAG 2.1: je Kanal `c/255`, linearisiert mit
 * `c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`, dann gewichtet.
 */
function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255]
    .map((raw) => raw / 255)
    .map((unit) => (unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** `(heller + 0.05) / (dunkler + 0.05)`, die Formel von WCAG 2.1. */
function ratio(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Code ohne Kommentarzeilen; der Vertrag prueft Code, nicht Prosa. */
function code(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
}
