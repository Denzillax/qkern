import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Keine Ansicht formatiert mehr selbst (2.55).
 *
 * Vor diesem Slice lagen rund vierzig Formatierer in den Ansichten, jeder
 * mit `de-CH` fest verdrahtet und jeder stillschweigend in der Zeitzone des
 * Browsers. Sie wurden auf `lib/console/display-settings` zusammengezogen und
 * ueber `components/console/console-display` gebunden. Dieser Vertrag haelt
 * das Ergebnis: Er liest jede Datei in `components/console` und verbietet
 * dort jede direkte Formatierung.
 *
 * Er ist der Grund, warum die naechste Ansicht nicht wieder abdriften kann.
 * Wer `new Intl.DateTimeFormat(...)` in eine Console-Datei schreibt, faellt
 * hier auf, bevor die erste Zeile davon jemandem angezeigt wird.
 *
 * Ausgenommen ist genau eine Datei: `console-display.ts` selbst. Sie
 * formatiert nicht, sie bindet -- die Formatierung steht in `lib/console`.
 */
const DIRECTORY = path.resolve(process.cwd(), "components/console");
const BOUND = "console-display.ts";

/**
 * Genau eine benannte Ausnahme, mit ihrem Grund.
 *
 * `invoices.ts` rechnet in `inclusivePeriodEnd` einen Tag zurueck, weil
 * `period_end` in Migration 0040 exklusiv ist. Das ist Rechnen mit einem
 * Kalendertag und keine Darstellung: Das Ergebnis ist ein Wert, den die
 * Ansicht danach durch `formatDay` schickt. Eine Einstellung der Person darf
 * daran nichts aendern -- der letzte eingeschlossene Tag einer
 * Rechnungsperiode ist in jeder Zeitzone derselbe.
 */
const EXEMPT: ReadonlyMap<string, RegExp> = new Map([
  ["invoices.ts", /\.slice\(0,\s*10\)/],
]);

/** Was eine Ansicht nicht mehr tun darf, und warum es auffaellt. */
const FORBIDDEN: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /new\s+Intl\.DateTimeFormat/, why: "formatiert ein Datum direkt statt ueber formatMoment" },
  { pattern: /new\s+Intl\.NumberFormat/, why: "formatiert eine Zahl direkt statt ueber formatNumber" },
  { pattern: /\.toLocaleDateString\(/, why: "formatiert ein Datum direkt" },
  { pattern: /\.toLocaleTimeString\(/, why: "formatiert eine Uhrzeit direkt" },
  { pattern: /\.toLocaleString\(/, why: "formatiert eine Zahl oder ein Datum direkt" },
  { pattern: /\.toFixed\(/, why: "rundet eine Zahl direkt statt ueber formatDecimal" },
  { pattern: /\.slice\(0,\s*10\)/, why: "schneidet einen Datumsstring direkt statt ueber formatDay" },
];

async function consoleFiles(): Promise<string[]> {
  return (await readdir(DIRECTORY)).filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"));
}

/** Kommentarzeilen zaehlen nicht; der Vertrag prueft Code, nicht Prosa. */
function code(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

describe("console display contract", () => {
  it("leaves no view formatting a date or a number on its own", async () => {
    const offenders: string[] = [];
    for (const name of await consoleFiles()) {
      if (name === BOUND) continue;
      const source = code(await readFile(path.join(DIRECTORY, name), "utf8"));
      const exempt = EXEMPT.get(name);
      for (const rule of FORBIDDEN) {
        if (exempt && exempt.source === rule.pattern.source) continue;
        if (rule.pattern.test(source)) offenders.push(`${name}: ${rule.why}`);
      }
    }
    expect(offenders, "Diese Dateien formatieren an der gemeinsamen Stelle vorbei").toEqual([]);
  });

  it("routes every formatting view through the one bound helper", async () => {
    // Wer formatiert, tut es ueber `console-display`. Der Fall haelt die
    // Umkehrung des ersten fest: Nicht nur ist die direkte Formatierung weg,
    // die Ansichten benutzen wirklich die gemeinsame Stelle.
    const users: string[] = [];
    for (const name of await consoleFiles()) {
      if (name === BOUND) continue;
      const source = await readFile(path.join(DIRECTORY, name), "utf8");
      const uses = /\b(formatMoment|formatDay|formatNumber|formatCount|formatDecimal|formatPercent|activeTimeZoneName)\(/
        .test(code(source));
      if (!uses) continue;
      users.push(name);
      expect(source, `${name} benutzt die Helfer ohne sie zu importieren`)
        .toContain('from "@/components/console/console-display"');
    }
    // Die Zahl ist keine Zusage ueber eine bestimmte Datei, sondern die
    // Aussage, dass die Umstellung die ganze Console erfasst hat und nicht
    // eine Handvoll Ansichten.
    expect(users.length).toBeGreaterThanOrEqual(30);
  });

  it("keeps the bound helper free of its own formatting rules", async () => {
    // `console-display` haelt die geltenden Einstellungen und reicht weiter.
    // Stuende hier ein zweites `Intl`, gaebe es wieder zwei Wahrheiten.
    const source = code(await readFile(path.join(DIRECTORY, BOUND), "utf8"));
    expect(/new\s+Intl\./.test(source)).toBe(false);
    expect(source).toContain('from "@/lib/console/display-settings"');
  });
});
