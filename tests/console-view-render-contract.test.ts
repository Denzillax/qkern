import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setConsoleLocale } from "@/components/console/console-i18n";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import { LOCALES } from "@/lib/i18n/locales";
import { CONSOLE_DISPLAY_DEFAULTS } from "@/lib/console/display-settings";
import { NAV } from "@/components/console/navigation";
import { BillingSettingsView } from "@/components/console/billing-settings-view";
import { DashboardSettingsView } from "@/components/console/dashboard-settings-view";
import { InfrastructureView } from "@/components/console/infrastructure-view";
import { InvoicesCard } from "@/components/console/invoices-card";
import { MigrationsView } from "@/components/console/migrations-view";
import { PitrView } from "@/components/console/pitr-view";
import { SidebarFlyout } from "@/components/console/sidebar-flyout";
import { TableDesignerView } from "@/components/console/table-designer-view";
import { UsageSeriesView } from "@/components/console/usage-series-view";

/**
 * Jede Ansicht der Console wird wenigstens einmal gerendert (2.63).
 *
 * Bis hierher hat kein Test eine Konsolenansicht je gerendert. Geprueft wurde
 * immer nur der Quelltext: ob ein Wort darin steht, ob eine Route nicht
 * schreibt, ob eine Uebersetzung existiert. Ein Tippfehler in einer
 * JSX-Verzweigung, ein Feldzugriff auf `undefined` im ersten Durchlauf oder
 * ein Import, der zur Laufzeit nicht aufloest, waere darum bis in den Browser
 * gekommen, und in den Browser hat niemand geschaut.
 *
 * WAS DIESER VERTRAG PRUEFT
 *
 * `renderToStaticMarkup` aus `react-dom/server` rendert eine Komponente bis
 * zum ersten Zustand. Das ist ohne neue Abhaengigkeit zu haben, denn `react`
 * und `react-dom` liegen ohnehin im Baum. Damit sind belegt: dass jeder Import
 * aufloest, dass der Modulkopf laeuft, dass der JSX-Baum gueltig ist und dass
 * der erste Renderdurchlauf ohne Ausnahme durchkommt. Dazu kommen drei
 * Schaerfungen, denn ein Vertrag, der nur "wirft nicht" sagt, ist wenig wert:
 *
 *   1. Der erste Durchlauf zeigt etwas. Eine Ansicht, die beim Oeffnen eine
 *      leere Seite liefert, faellt hier, auch wenn sie nicht wirft.
 *   2. Der erste Durchlauf zeigt einen Ladezustand. Wer eine Seite oeffnet,
 *      die gleich etwas holt, soll sehen, dass geholt wird, und nicht eine
 *      Seite, die fertig aussieht und leer ist. Geprueft wird das auf
 *      Deutsch, denn Deutsch ist die Vorlage; ob es die Ladesaetze auch in
 *      den drei anderen Sprachen gibt, ist Sache von `console-i18n-contract`.
 *      Vier Ansichten oeffnen bewusst im Ruhezustand statt im Ladezustand,
 *      und zwei Dateien im Ordner sind gar keine Seite; alle sechs stehen
 *      unten namentlich mit Begruendung.
 *   3. In einer fremden Sprache steht kein deutscher Text mehr da. Wird eine
 *      Ansicht auf Englisch gerendert und erscheint trotzdem ein deutscher
 *      Satz, dann ist er an `t()` vorbeigeschrieben worden, und kein
 *      Uebersetzer bekommt ihn je zu sehen.
 *
 * WAS DIESER VERTRAG AUSDRUECKLICH NICHT PRUEFT
 *
 * Ein Rendern ohne Effekte ist kein Browserbesuch. `renderToStaticMarkup`
 * fuehrt `useEffect` nicht aus. Alles, was eine Ansicht erst nach dem Laden
 * zeigt, bleibt hier ungesehen: der fertige Zustand, der Fehlerzustand, der
 * leere Zustand, jede Tabelle mit echten Zeilen. Es laufen ausserdem keine
 * Ereignisse (kein Klick, keine Eingabe), es gibt kein Layout und keine
 * Stylesheets, also faellt kein abgeschnittener Text und kein kaputtes Raster
 * auf, und `useRef` auf ein DOM-Element bleibt leer.
 *
 * Nicht gerendert wird `console-app.tsx` selbst. Die Schale haengt an
 * `useRouter` aus `next/navigation` und damit an einem Router-Kontext, den es
 * hier nicht gibt; und die vierzehn Ansichten, die in ihr stehen statt in
 * einer eigenen Datei (Overview, TableView, SqlView, AuthView, StorageView,
 * ComputeView, LiveApiView, ActivityView, ApprovalView, UsageView,
 * BackupsView, SettingsView, PlaceholderView, DatabaseView), sind nicht
 * exportiert und von hier aus nicht erreichbar. Sie in eigene Dateien zu
 * ziehen waere ein eigener Schnitt.
 *
 * Attribute werden nicht gelesen. Text, der nur in `placeholder`, `title` oder
 * `aria-label` steht, geht in die Pruefung auf deutsche Reste nicht ein.
 *
 * Jede Ansicht steht hier fuer sich, nicht in der Console. Dass ein Menuepunkt
 * zur richtigen Ansicht fuehrt und dass eine Ansicht in der Schale nicht aus
 * dem Raster faellt, sagt dieser Vertrag nicht; das erste prueft
 * `console-navigation-contract`, das zweite prueft niemand.
 *
 * Keine Fallnummer: Dieser Schnitt fasst keine Datenbank an, keine Route und
 * kein Schema. Er rendert Komponenten in einem Node-Prozess; es gibt nichts,
 * was ein Stack belegen koennte.
 */

type Environment = "development" | "staging" | "production";

const CONSOLE_DIR = path.resolve(process.cwd(), "components/console");

/**
 * Die Schale rendert hier nicht mit; sie steht oben unter dem, was der
 * Vertrag nicht prueft.
 */
const NOT_A_VIEW = new Set(["console-app.tsx"]);

/**
 * Requisiten kommen aus den Typen, nicht aus der Fantasie: `element` ruft die
 * Komponente mit ihrem echten Props-Typ auf, also meldet `tsc` jede Requisite,
 * die nicht passt oder fehlt. Der Rueckgabewert ist absichtlich nur ein
 * Element, damit alle Eintraege in derselben Tabelle stehen koennen.
 */
function element<P extends object>(component: (props: P) => unknown, props: P): ReactElement {
  return createElement(component as never, props as never);
}

const PROJECT_ID = "prj_render_contract";
const ENVIRONMENT: Environment = "development";

/**
 * Die weitaus meisten Ansichten nehmen dieselben zwei Requisiten. `PitrView`
 * steht hier als Zeuge des Typs: `satisfies` bindet die Vorgabe an den echten
 * Props-Typ einer echten Ansicht, damit sie nicht als beliebiges Objekt
 * durchrutscht.
 */
const DEFAULT_PROPS = {
  projectId: PROJECT_ID,
  environment: ENVIRONMENT,
} satisfies Parameters<typeof PitrView>[0];

/**
 * Alles, was mehr oder anderes braucht, steht an dieser einen Stelle. Der
 * Schluessel ist der Name der exportierten Komponente; der Vertrag verlangt
 * weiter unten, dass die Tabelle jede gefundene Komponente deckt, also faellt
 * er, sobald eine neue Ansicht mit neuen Requisiten dazukommt.
 *
 * Eine Ansicht darf mehrfach vorkommen: `UsageSeriesView` bedient vier
 * Menuepunkte mit vier Reihen, und alle vier werden gerendert.
 */
const SPECIAL_PROPS: Record<string, ReactElement[]> = {
  BillingSettingsView: [element(BillingSettingsView, { ...DEFAULT_PROPS, navigate: () => {} })],
  // Zweimal: einmal mit den Vorgaben und einmal mit einer Einstellung, die
  // wirklich etwas verschiebt. Die Vorschau dieser Seite rechnet Datum,
  // Uhrzeit, Zahl und Betrag schon im ersten Durchlauf, also ist eine fremde
  // Zeitzone und ein fremdes Gebietsschema hier keine Zierde.
  DashboardSettingsView: [
    element(DashboardSettingsView, { settings: CONSOLE_DISPLAY_DEFAULTS, onSaved: () => {} }),
    element(DashboardSettingsView, {
      settings: { ...CONSOLE_DISPLAY_DEFAULTS, language: "en", formatLocale: "en-US", timeZone: "America/New_York", theme: "dark" },
      onSaved: () => {},
    }),
  ],
  InfrastructureView: [element(InfrastructureView, { ...DEFAULT_PROPS, region: "eu-central-1", status: "ready" })],
  InvoicesCard: [element(InvoicesCard, { ...DEFAULT_PROPS, onOpenUsage: () => {} })],
  MigrationsView: [element(MigrationsView, { ...DEFAULT_PROPS, changeSets: [] })],
  // Jede Menuegruppe mit Kindern, aus der echten Navigation: der Flyout
  // bekommt seine Eintraege aus derselben Quelle wie die Console, und eine
  // neue Gruppe wird hier ohne Zutun mitgerendert.
  SidebarFlyout: NAV
    .filter((group): group is typeof group & { children: NonNullable<typeof group.children> } => group.children !== undefined)
    .map((group) => element(SidebarFlyout, { group, view: group.children[0].id, badge: 0, onNavigate: () => {} })),
  TableDesignerView: [element(TableDesignerView, { ...DEFAULT_PROPS, navigate: () => {}, reload: async () => {} })],
  UsageSeriesView: (["api", "storage", "functions", "realtime"] as const)
    .map((view) => element(UsageSeriesView, { ...DEFAULT_PROPS, view })),
};

/**
 * Diese vier Ansichten oeffnen im Ruhezustand und nicht im Ladezustand, und
 * das ist jedes Mal richtig so:
 *
 *   DashboardSettingsView  Das Formular steht vollstaendig in den Requisiten;
 *                          es wird nichts geholt, es wird nur gespeichert.
 *   QueryInsightsView      Der Plan einer Abfrage entsteht erst, wenn jemand
 *                          eine Abfrage eingibt. Vorher gibt es nichts zu laden.
 *   RealtimeInspectorView  Die Verbindung zum Realtime-Server macht ein Klick
 *                          auf "Verbinden", nicht das Oeffnen der Seite.
 *   RealtimePoliciesView   Reiner Text: die Kanalrechte stehen als feste Regel
 *                          im Code, es gibt keine Quelle, die man fragen koennte.
 */
const OPENS_IDLE = new Set([
  "DashboardSettingsView", "QueryInsightsView", "RealtimeInspectorView", "RealtimePoliciesView",
]);

/**
 * Die Ladezustaende der Console sprechen dieselbe kleine Sprache: entweder das
 * kurze "Lädt…" neben einem Knopf oder ein Satz, der sagt, was gerade geholt,
 * geprueft, gefragt oder gezeichnet wird. Geprueft wird der ganze Textknoten,
 * nicht ein Stueck davon.
 */
const LOADING_SENTENCE = /^.{3,140}(geladen|gelesen|geprüft|gefragt|gezeichnet|läuft)…$/u;
const LOADING_LABEL = "Lädt…";

/**
 * Eine Ansicht ist eine Seite: eine Datei auf `-view.tsx`. Die beiden anderen
 * Dateien im Ordner sind Bruchstuecke einer Seite, keine Seite. `InvoicesCard`
 * ist eine Karte in der Abrechnung, `SidebarFlyout` ein Knopf im Menue mit
 * einem Panel, das erst bei Beruehrung aufgeht. Beide werden gerendert wie
 * alle anderen, aber ein Ladezustand und eine volle Seite Text sind von ihnen
 * nicht zu verlangen.
 */
const isView = (file: string) => file.endsWith("-view.tsx");

/**
 * Sichtbarer Text aus der erzeugten Markup.
 *
 * Die unsichtbaren Varianten von `StableLabel` fliegen vorher raus: sie
 * stehen absichtlich in allen vier Sprachen da, damit ein Knopf die Breite der
 * laengsten reserviert (`aria-hidden`, fuer das Auge nicht sichtbar). Sie als
 * deutschen Rest zu zaehlen waere falsch.
 *
 * Getrennt wird zusaetzlich an " · ", weil die Console an vielen Stellen zwei
 * Angaben mit diesem Zeichen in denselben Textknoten schreibt.
 */
function visibleTexts(markup: string): string[] {
  return markup
    .replace(/<span class="stable-label-ghost" aria-hidden="true">.*?<\/span>/gu, "")
    .replace(/<[^>]*>/gu, "\u0000")
    .split("\u0000")
    .flatMap((part) => part.split(" · "))
    .map((part) => part
      .replace(/&amp;/gu, "&").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">")
      .replace(/&quot;/gu, "\"").replace(/&#x27;/gu, "'").trim())
    .filter((part) => part.length > 0);
}

/**
 * Woran man einen deutschen Satz erkennt, der nie durch `t()` gelaufen ist:
 * an einem Umlaut oder an einem der kleinen Woerter, die es im Englischen so
 * nicht gibt. Geprueft wird als ganzes Wort, damit "die" nicht in "died" und
 * "der" nicht in "order" anschlaegt.
 */
const GERMAN_MARKER = /[äöüÄÖÜß]|(?<![A-Za-zÀ-ÿ])(und|oder|nicht|wird|werden|kein|keine|einen|dieser|diese|dieses|mit|von|dem|den|der|die|das)(?![A-Za-zÀ-ÿ])/u;

type Case = { component: string; file: string; index: number; element: ReactElement };

async function discovered(): Promise<string[]> {
  return (await readdir(CONSOLE_DIR))
    .filter((name) => name.endsWith(".tsx") && !NOT_A_VIEW.has(name))
    .sort();
}

/**
 * Jedes Modul, sein Name im Dateisystem und seine eine exportierte Komponente.
 *
 * Geladen wird ueber den Namen aus `readdir`, nicht ueber eine Liste im Test.
 * Eine neue Ansicht ist damit sofort dabei, und eine, die niemand mehr rendert,
 * faellt beim naechsten Lauf auf.
 */
async function components(): Promise<Array<{ file: string; name: string; component: (props: never) => unknown }>> {
  const found: Array<{ file: string; name: string; component: (props: never) => unknown }> = [];
  for (const file of await discovered()) {
    // Die Endung steht im festen Teil des Pfads, damit Vite den Import
    // statisch aufloesen kann und nicht bloss zur Laufzeit rät.
    const stem = file.replace(/\.tsx$/u, "");
    const module = (await import(`../components/console/${stem}.tsx`)) as Record<string, unknown>;
    const names = Object.keys(module).filter((name) => typeof module[name] === "function" && /^[A-Z]/u.test(name));
    expect(names, `${file} exportiert nicht genau eine Komponente`).toHaveLength(1);
    found.push({ file, name: names[0], component: module[names[0]] as (props: never) => unknown });
  }
  return found.sort((a, b) => a.file.localeCompare(b.file));
}

async function cases(): Promise<Case[]> {
  const built: Case[] = [];
  for (const entry of await components()) {
    const elements = SPECIAL_PROPS[entry.name] ?? [element(entry.component as (props: typeof DEFAULT_PROPS) => unknown, DEFAULT_PROPS)];
    elements.forEach((made, index) => built.push({ component: entry.name, file: entry.file, index, element: made }));
  }
  return built;
}

/**
 * Rendert einen Fall und gibt Markup samt allem zurueck, was React dabei
 * bemaengelt hat. React meldet einen falschen Requisitentyp oder ein
 * ungueltiges Element ueber `console.error`, ohne zu werfen; unbeachtet waere
 * das ein stiller Befund.
 */
function render(made: ReactElement): { markup: string; complaints: string[]; thrown: string | null } {
  const complaints: string[] = [];
  const realError = console.error;
  const realWarn = console.warn;
  console.error = (...args: unknown[]) => { complaints.push(args.map(String).join(" ")); };
  console.warn = (...args: unknown[]) => { complaints.push(args.map(String).join(" ")); };
  try {
    return { markup: renderToStaticMarkup(made), complaints, thrown: null };
  } catch (cause) {
    // Eine Ausnahme wird hier nicht weitergereicht, sondern zurueckgegeben:
    // so meldet jede der folgenden Pruefungen die Ansicht beim Namen, statt
    // dass ein roher Stapelabzug den Bericht uebernimmt.
    return { markup: "", complaints, thrown: cause instanceof Error ? `${cause.message}\n${cause.stack ?? ""}` : String(cause) };
  } finally {
    console.error = realError;
    console.warn = realWarn;
  }
}

describe("console view render contract", () => {
  const realFetch = globalThis.fetch;

  beforeAll(() => {
    // Der erste Renderdurchlauf sieht von einer Ladung ohnehin nichts, weil
    // Effekte hier nicht laufen. Der Ersatz steht trotzdem da, damit kein
    // Modulkopf an einem fehlenden `fetch` scheitert und damit ein Aufruf,
    // den es wider Erwarten doch gibt, nicht ins Netz geht.
    globalThis.fetch = (async () => {
      throw new Error("Im Render-Vertrag wird nichts geholt.");
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    setConsoleLocale("de");
  });

  it("findet jede Ansicht im Dateisystem und kennt fuer jede ihre Requisiten", async () => {
    const files = await discovered();
    const found = await components();

    // Jede Datei des Verzeichnisses ist geladen und hat genau eine Komponente
    // hergegeben. Sonst faellt eine neue Ansicht durch, ohne dass es jemand
    // merkt. Die Untergrenze haelt den Stand fest, den es beim Bau dieses
    // Vertrags gab: sie faellt, wenn jemand Ansichten entfernt, ohne sie hier
    // zu nennen.
    expect(found.map((entry) => entry.file)).toEqual(files);
    expect(files.length).toBeGreaterThanOrEqual(79);

    // Jede Ansicht haengt an der Console. Eine Datei, die niemand einbindet,
    // ist entweder tot oder vergessen; beides soll auffallen.
    const app = await readFile(path.join(CONSOLE_DIR, "console-app.tsx"), "utf8");
    for (const entry of found) {
      expect(app, `${entry.file}: ${entry.name} wird in console-app.tsx nicht verwendet`)
        .toContain(`<${entry.name}`);
    }

    // Und jede Requisitentabelle deckt eine Komponente, die es wirklich gibt.
    const names = new Set(found.map((entry) => entry.name));
    for (const name of Object.keys(SPECIAL_PROPS)) expect(names, `${name} steht in SPECIAL_PROPS, aber nicht im Verzeichnis`).toContain(name);
    for (const name of OPENS_IDLE) expect(names, `${name} steht in OPENS_IDLE, aber nicht im Verzeichnis`).toContain(name);
  });

  it("rendert jede Ansicht in jeder Sprache ohne Ausnahme und ohne Beschwerde von React", async () => {
    const built = await cases();
    // Mindestens ein Fall je Komponente; mehrere dort, wo eine Ansicht
    // mehrere Menuepunkte bedient.
    expect(built.length).toBeGreaterThanOrEqual((await components()).length);
    const broken: string[] = [];
    for (const made of built) {
      for (const locale of LOCALES) {
        setConsoleLocale(locale);
        const { markup, complaints, thrown } = render(made.element);
        if (thrown !== null) {
          broken.push(`${made.component} [${locale}#${made.index}] wirft: ${thrown}`);
          continue;
        }
        if (complaints.length > 0) broken.push(`${made.component} [${locale}#${made.index}]: ${complaints.join(" / ")}`);
        if (markup.length === 0) broken.push(`${made.component} [${locale}#${made.index}] rendert nichts`);
      }
    }
    expect(broken.join("\n")).toBe("");
  });

  it("zeigt im ersten Durchlauf etwas und nicht eine leere Seite", async () => {
    setConsoleLocale("de");
    const thin: string[] = [];
    for (const made of await cases()) {
      const { markup, thrown } = render(made.element);
      if (thrown !== null) { thin.push(`${made.component}#${made.index} wirft beim Rendern: ${thrown}`); continue; }
      const texts = visibleTexts(markup);
      // Kein Mass, keine Schwelle: verlangt ist ein Wort, das ein Mensch lesen
      // kann. Eine Ansicht, die beim Oeffnen nur ein Icon, eine Ziffer oder
      // einen Bindestrich zeigt, faellt hier; die meisten stehen mit ihrer
      // einen Zeile Ladezustand da, und das ist genau richtig so.
      if (!texts.some((text) => /\p{L}/u.test(text))) {
        thin.push(`${made.component}#${made.index} zeigt kein lesbares Wort: ${JSON.stringify(texts)}`);
      }
    }
    expect(thin.join("\n")).toBe("");
  });

  it("zeigt im ersten Durchlauf einen Ladezustand, wo eine Ansicht beim Oeffnen etwas holt", async () => {
    setConsoleLocale("de");
    const silent: string[] = [];
    for (const made of await cases()) {
      if (!isView(made.file) || OPENS_IDLE.has(made.component)) continue;
      const { markup, thrown } = render(made.element);
      if (thrown !== null) { silent.push(`${made.component}#${made.index} wirft beim Rendern: ${thrown}`); continue; }
      const texts = visibleTexts(markup);
      const loading = texts.some((text) => text === LOADING_LABEL || LOADING_SENTENCE.test(text));
      if (!loading) silent.push(`${made.component}#${made.index} zeigt beim Oeffnen keinen Ladezustand: ${texts.slice(0, 6).join(" | ")}`);
    }
    expect(silent.join("\n")).toBe("");
  });

  it("zeigt in einer fremden Sprache keinen deutschen Text, den der Uebersetzer nie gesehen hat", async () => {
    const english = CONSOLE_TRANSLATIONS.en;
    const translated = new Set(Object.values(english));
    setConsoleLocale("en");
    const leftovers: string[] = [];
    for (const made of await cases()) {
      const { markup, thrown } = render(made.element);
      if (thrown !== null) { leftovers.push(`${made.component}#${made.index} wirft beim Rendern: ${thrown}`); continue; }
      for (const text of visibleTexts(markup)) {
        // Erster Fall: der Text ist genau ein Schluessel, dessen englische
        // Fassung anders lautet. Dann kann er nicht durch `t()` gelaufen sein.
        const knownKey = english[text] !== undefined && english[text] !== text;
        // Zweiter Fall: der Text sieht deutsch aus und ist keine der
        // englischen Fassungen. Das faengt einen Satz, den niemand je in die
        // Tabelle eingetragen hat.
        const looksGerman = GERMAN_MARKER.test(text) && !translated.has(text);
        if (knownKey || looksGerman) leftovers.push(`${made.component}#${made.index}: ${text}`);
      }
    }
    setConsoleLocale("de");
    expect(leftovers.join("\n")).toBe("");
  });
});
