import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setConsoleLocale } from "@/components/console/console-i18n";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import { LOCALES } from "@/lib/i18n/locales";
import { TableWorkspaceView } from "@/components/console/table-workspace-view";
import { TableView } from "@/components/console/table-view";
import { TableDesignerView } from "@/components/console/table-designer-view";
import { SchemaVisualizerView } from "@/components/console/schema-visualizer-view";
import { PoliciesView } from "@/components/console/policies-view";
import { ColumnPrivilegesView } from "@/components/console/column-privileges-view";
import { RolesView } from "@/components/console/roles-view";
import {
  tableCurlExample,
  tableRestExample,
  tableRowsQuery,
  tableSdkExample,
} from "@/lib/console/table-api-examples";

/**
 * Die Kontextnavigation an der Tabelle (2.138).
 *
 * **Was dieser Vertrag zusichert.** Fuenf Reiter an einer Tabelle; jeder zieht
 * seine Daten aus einer Route, die es wirklich gibt; die drei API-Beispiele
 * nennen den Paketnamen und den REST-Pfad, die diese Installation wirklich
 * hat; der Arbeitsplatz rendert ohne gewaehlte Tabelle und ohne Antwort; und
 * keine der umgebauten Ansichten verliert ihre bisherige Verwendung ohne
 * Tabelle.
 *
 * **Warum die letzte Zusage die wichtigste ist.** Der Arbeitsplatz ist eine
 * duenne Huelle ueber sechs Ansichten, die es schon gab. Jede davon hat
 * ausserdem weiter ihren eigenen Menuepunkt. Eine Requisite, die aus einer
 * optionalen eine verlangte macht, wuerde den Menuepunkt still leer lassen,
 * und `tsc` wuerde es erst dort melden, wo die Schale sie aufruft.
 *
 * **Was er nicht kann.** Er rendert in einem Node-Prozess ohne Effekte: keine
 * Antwort, kein Klick, kein Reiterwechsel durch eine Person. Dass der Reiter
 * "Beziehungen" wirklich nur die Nachbarschaft **einer** Tabelle zeichnet,
 * steht hier als Zusage am Quelltext (die Lesung wird gefiltert, nicht ein
 * zweites Mal geholt) und nicht als Bild.
 *
 * Keine Fallnummer am Stack: Dieser Schnitt fasst keine Datenbank an, keine
 * Route und kein Schema. Er haengt Reiter vor bestehende Ansichten.
 */
const VIEWS = path.resolve(process.cwd(), "components/console");
const WORKSPACE = path.join(VIEWS, "table-workspace-view.tsx");
const ROUTES = path.resolve(process.cwd(), "app/api/v1/projects/[projectId]/environments/[environment]");

async function source(file: string): Promise<string> {
  return readFile(file, "utf8");
}

/**
 * Nur der Code, ohne Kommentarzeilen, wie im Darstellungsvertrag.
 *
 * Ohne diesen Schnitt haette die Mutationsprobe einen Treffer verschenkt:
 * Die Lesung `/schema/indexes` steht auch im Kopfkommentar des Arbeitsplatzes,
 * also haette eine entfernte Lesung weiter "bestanden", weil die Prosa sie
 * noch nannte. Ein Vertrag, der die Begruendung statt der Tat liest, prueft
 * nichts.
 */
function code(text: string): string {
  return text.split(/\r?\n/u).filter((line) => !/^\s*(\/\/|\*|\/\*)/u.test(line)).join("\n");
}

/** Der Code einer Datei im Ordner der Ansichten. */
async function viewCode(file: string): Promise<string> {
  return code(await source(path.join(VIEWS, file)));
}

/**
 * Die fuenf Reiter, und je Reiter die Ansicht, die ihn fuellt, mit der Route,
 * aus der sie liest. Der Reiter "Sicherheit" tragt drei Ansichten, weil
 * Row Level Security, Spaltenrechte und Rollen in drei Katalogen stehen.
 */
type TabFile = Readonly<{ file: string; component: string; route: string; reads: string; scoped: boolean }>;
type TabEntry = Readonly<{ tab: string; label: string; files: readonly TabFile[] }>;

const TABS: readonly TabEntry[] = [
  { tab: "data", label: "Daten", files: [{ file: "table-view.tsx", component: "TableView", route: "tables/[table]/rows", reads: "/rows", scoped: true }] },
  { tab: "structure", label: "Struktur", files: [{ file: "table-designer-view.tsx", component: "TableDesignerView", route: "schema", reads: "/schema?schema=", scoped: true }] },
  { tab: "relations", label: "Beziehungen", files: [{ file: "schema-visualizer-view.tsx", component: "SchemaVisualizerView", route: "schema/foreign-keys", reads: "/schema/foreign-keys?schema=", scoped: true }] },
  { tab: "security", label: "Sicherheit", files: [
    { file: "policies-view.tsx", component: "PoliciesView", route: "schema/policies", reads: "/schema/policies?schema=", scoped: true },
    { file: "column-privileges-view.tsx", component: "ColumnPrivilegesView", route: "schema/column-privileges", reads: "/schema/column-privileges?schema=", scoped: true },
    // Eine Rolle gehoert nicht zu einer Tabelle, und `/schema/roles` kennt
    // keine. Darum bekommt diese Ansicht keine Tabelle mitgegeben.
    { file: "roles-view.tsx", component: "RolesView", route: "schema/roles", reads: "/schema/roles", scoped: false },
  ] },
  // Der Reiter "API" holt nichts: Er zeigt den Pfad, unter dem die Zeilen
  // dieser Tabelle liegen. Dass dieser Pfad existiert, prueft der Fall weiter
  // unten an der Route selbst.
  { tab: "api", label: "API", files: [] },
];

/** Die Ansichten, die eine Tabelle als optionalen Eingang bekommen haben. */
const SCOPED = TABS.flatMap((entry) => entry.files).filter((entry) => entry.scoped);

const PROJECT_ID = "prj_table_context";
const ENVIRONMENT = "development" as const;
const TABLE = "kunden";

const TARGET = {
  baseUrl: "https://console.example",
  projectId: PROJECT_ID,
  environment: ENVIRONMENT,
  table: TABLE,
  schema: "public",
};

function element<P extends object>(component: (props: P) => unknown, props: P): ReactElement {
  return createElement(component as never, props as never);
}

/** Sichtbarer Text aus der Markup, wie im Render-Vertrag. */
function visibleTexts(markup: string): string[] {
  return markup
    .replace(/<span class="stable-label-ghost" aria-hidden="true">.*?<\/span>/gu, "")
    .replace(/<[^>]*>/gu, "\u0000")
    .split("\u0000")
    .map((part) => part
      .replace(/&amp;/gu, "&").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">")
      .replace(/&quot;/gu, "\"").replace(/&#x27;/gu, "'").trim())
    .filter((part) => part.length > 0);
}

describe("console table context contract", () => {
  const realFetch = globalThis.fetch;

  beforeAll(() => {
    globalThis.fetch = (async () => {
      throw new Error("In diesem Vertrag wird nichts geholt.");
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    setConsoleLocale("de");
  });

  it("gibt einer Tabelle genau diese fuenf Reiter, in allen vier Sprachen", async () => {
    const view = code(await source(WORKSPACE));
    // Die Liste im Quelltext und die Liste in diesem Vertrag sind dieselbe.
    const declared = /const TABS: ReadonlyArray<Tab> = \[([^\]]*)\]/u.exec(view);
    expect(declared, "die Reiterliste steht nicht als eine Liste im Quelltext").not.toBeNull();
    const ids = [...(declared?.[1] ?? "").matchAll(/"([a-z]+)"/gu)].map((match) => match[1]);
    expect(ids).toEqual(TABS.map((entry) => entry.tab));

    for (const entry of TABS) {
      expect(view, `der Reiter ${entry.tab} hat keine Beschriftung`).toContain(`t("${entry.label}")`);
      for (const locale of ["en", "fr", "it"] as const) {
        expect((CONSOLE_TRANSLATIONS[locale][entry.label] ?? "").trim(), `${locale}: ${entry.label}`).not.toBe("");
      }
    }
  });

  it("fuellt jeden Reiter aus einer Route, die es wirklich gibt", async () => {
    const view = code(await source(WORKSPACE));
    // Der Arbeitsplatz selbst liest zwei Kataloge: das Schema fuer Tabellen und
    // Spalten, die Indexliste fuer den Primaerschluessel. Der Primaerschluessel
    // steht nicht in der Schema-Route, darum die zweite Lesung.
    for (const own of ["/schema?schema=", "/schema/indexes?schema="]) {
      expect(view, `der Arbeitsplatz liest ${own} nicht`).toContain(own);
    }
    for (const own of ["schema", "schema/indexes"]) {
      expect(existsSync(path.join(ROUTES, own, "route.ts")), `Route ${own} fehlt`).toBe(true);
    }

    for (const entry of TABS.flatMap((tab) => tab.files)) {
      const child = await viewCode(entry.file);
      expect(child, `${entry.file} liest ${entry.reads} nicht`).toContain(entry.reads);
      expect(existsSync(path.join(ROUTES, entry.route, "route.ts")), `Route ${entry.route} fehlt`).toBe(true);
      expect(view, `der Arbeitsplatz zeigt ${entry.component} nicht`).toContain(`<${entry.component}`);
      if (entry.scoped) {
        expect(view, `${entry.component} bekommt die gewaehlte Tabelle nicht mit`)
          .toMatch(new RegExp(`<${entry.component}[^>]*table=\\{selected\\}`, "u"));
      }
    }

    // Der Arbeitsplatz liest und schreibt nicht. Geschrieben wird allein im
    // Designer, und der schickt an die Freigabe.
    expect(view).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/iu);
  });

  it("nennt in den Beispielen den echten Paketnamen und den echten REST-Pfad", async () => {
    const manifest = JSON.parse(await source(path.resolve(process.cwd(), "sdk/typescript/package.json"))) as { name: string };
    const sdk = await source(path.resolve(process.cwd(), "sdk/typescript/src/index.ts"));
    expect(sdk).toContain("export function createQkernClient");

    const typescript = tableSdkExample(TARGET);
    expect(typescript, "das Beispiel nennt ein anderes Paket als das veroeffentlichte").toContain(`"${manifest.name}"`);
    expect(typescript).toContain("createQkernClient");
    expect(typescript).toContain(`.from("${TABLE}", "public")`);

    // Der Pfad ist der Pfad dieser Installation. Es gibt kein /rest/v1.
    const expected = `/api/v1/projects/${PROJECT_ID}/environments/${ENVIRONMENT}/tables/${TABLE}/rows`;
    expect(tableRowsQuery(TARGET).startsWith(`${expected}?`)).toBe(true);
    expect(existsSync(path.join(ROUTES, "tables/[table]/rows/route.ts"))).toBe(true);
    for (const example of [tableRestExample(TARGET), tableCurlExample(TARGET), typescript]) {
      expect(example, "ein Beispiel nennt einen Pfad, den QKERN nicht hat").not.toContain("/rest/v1");
    }
    expect(tableRestExample(TARGET)).toContain(`GET ${expected}?`);
    expect(tableCurlExample(TARGET)).toContain(`'https://console.example${expected}?`);
    // Der Kopfzeilenname ist derselbe, den der Transport des SDK setzt.
    expect(sdk).toContain('headers["x-qkern-key"]');
    for (const example of [tableRestExample(TARGET), tableCurlExample(TARGET)]) {
      expect(example).toContain("x-qkern-key");
    }
    // Kein Geheimnis im kopierbaren Block, nur der Name der Umgebungsvariable.
    for (const example of [tableRestExample(TARGET), tableCurlExample(TARGET), typescript]) {
      expect(example).toContain("QKERN_PROJECT_KEY");
    }
  });

  it("rendert ohne gewaehlte Tabelle und ohne Antwort, in allen vier Sprachen", () => {
    const broken: string[] = [];
    for (const phase of ["loading", "ready", "error"] as const) {
      for (const locale of LOCALES) {
        setConsoleLocale(locale);
        const made = element(TableWorkspaceView, {
          projectId: PROJECT_ID, environment: ENVIRONMENT,
          navigate: () => {}, reload: async () => {}, initialState: phase,
        });
        let markup = "";
        try {
          markup = renderToStaticMarkup(made);
        } catch (cause) {
          broken.push(`${phase}/${locale} wirft: ${cause instanceof Error ? cause.message : String(cause)}`);
          continue;
        }
        const texts = visibleTexts(markup);
        if (!texts.some((text) => /\p{L}/u.test(text))) broken.push(`${phase}/${locale} zeigt kein lesbares Wort`);
      }
    }
    setConsoleLocale("de");
    expect(broken.join("\n")).toBe("");

    // Ohne Tabelle steht da, was eine Wahl bringen wuerde, und nicht nichts.
    setConsoleLocale("de");
    const ready = renderToStaticMarkup(element(TableWorkspaceView, {
      projectId: PROJECT_ID, environment: ENVIRONMENT,
      navigate: () => {}, reload: async () => {}, initialState: "ready",
    }));
    const texts = visibleTexts(ready);
    expect(texts, "ohne gewaehlte Tabelle fehlt der Hinweis, was eine Wahl bringt")
      .toContain("Wähle oben eine Tabelle. Danach stehen hier ihre Datensätze, ihre Spalten, ihre Beziehungen, ihre Sicherheit und die Beispiele für ihre API.");
    // Und der Ladezustand ist wirklich ein Ladezustand.
    const loading = visibleTexts(renderToStaticMarkup(element(TableWorkspaceView, {
      projectId: PROJECT_ID, environment: ENVIRONMENT, navigate: () => {}, reload: async () => {},
    })));
    expect(loading).toContain("Tabellen werden geladen…");
  });

  it("laesst jeder umgebauten Ansicht ihre bisherige Verwendung ohne Tabelle", async () => {
    const app = await viewCode("console-app.tsx");
    for (const entry of SCOPED) {
      const child = await viewCode(entry.file);
      // Die Requisite ist optional. Waere sie verlangt, stuende der eigene
      // Menuepunkt dieser Ansicht ohne Tabelle da.
      expect(child, `${entry.file}: table ist keine optionale Requisite`).toMatch(/\btable\?: string\b/u);
      // Und die Ansicht wird weiter aufgerufen. Fuenf der sechs ruft die Schale
      // auf, ohne ihnen eine Tabelle zu geben; `TableView` ist die Ausnahme,
      // seit der Menuepunkt "Table Editor" den Arbeitsplatz oeffnet und der die
      // Datenansicht mit Tabelle einsetzt. Die Datenansicht ist damit nicht
      // verloren, sie hat nur keinen zweiten Einstieg mehr ohne Kontext. Dass
      // sie ohne Tabelle rendert, prueft die Schleife darunter trotzdem weiter:
      // Die Requisite bleibt optional, und genau daran haengt, dass der
      // Arbeitsplatz sie vor der ersten Wahl zeigen kann.
      const host = entry.component === "TableView" ? await viewCode("table-workspace-view.tsx") : app;
      expect(host, `${entry.file}: ${entry.component} wird nirgends mehr verwendet`)
        .toContain(`<${entry.component}`);
    }

    // Jede der sechs rendert ohne Tabelle und zeigt dabei ihren Ladezustand.
    const base = { projectId: PROJECT_ID, environment: ENVIRONMENT };
    const cases: Array<{ name: string; made: ReactElement }> = [
      { name: "TableView", made: element(TableView, { ...base }) },
      { name: "TableDesignerView", made: element(TableDesignerView, { ...base, navigate: () => {}, reload: async () => {} }) },
      { name: "SchemaVisualizerView", made: element(SchemaVisualizerView, { ...base }) },
      { name: "PoliciesView", made: element(PoliciesView, { ...base }) },
      { name: "ColumnPrivilegesView", made: element(ColumnPrivilegesView, { ...base }) },
      { name: "RolesView", made: element(RolesView, { ...base }) },
    ];
    expect(cases.map((entry) => entry.name).sort())
      .toEqual(TABS.flatMap((tab) => tab.files).map((entry) => entry.component).sort());

    setConsoleLocale("de");
    const broken: string[] = [];
    for (const entry of cases) {
      const texts = visibleTexts(renderToStaticMarkup(entry.made));
      if (!texts.some((text) => /(geladen|gezeichnet)…$/u.test(text))) {
        broken.push(`${entry.name} ohne Tabelle zeigt keinen Ladezustand: ${texts.slice(0, 4).join(" | ")}`);
      }
    }
    expect(broken.join("\n")).toBe("");
  });
});
