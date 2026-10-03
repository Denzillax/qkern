import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { cloneElement, createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setConsoleLocale } from "@/components/console/console-i18n";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import { LOCALES } from "@/lib/i18n/locales";
import { CONSOLE_DISPLAY_DEFAULTS } from "@/lib/console/display-settings";
import { NAV } from "@/components/console/navigation";
import type { Snapshot } from "@/lib/console/console-snapshot";
import type { AuditEvent, Project } from "@/lib/types";
import { ActivityView } from "@/components/console/activity-view";
import { ApprovalView } from "@/components/console/approval-view";
import { DatabaseView } from "@/components/console/database-view";
import { OverviewView } from "@/components/console/overview-view";
import { SettingsView } from "@/components/console/settings-view";
import { SqlView } from "@/components/console/sql-view";
import { BillingSettingsView } from "@/components/console/billing-settings-view";
import { DashboardSettingsView } from "@/components/console/dashboard-settings-view";
import { InfrastructureView } from "@/components/console/infrastructure-view";
import { InvoicesCard } from "@/components/console/invoices-card";
import { MigrationsView } from "@/components/console/migrations-view";
import { PitrView } from "@/components/console/pitr-view";
import { SidebarFlyout } from "@/components/console/sidebar-flyout";
import { TableDesignerView } from "@/components/console/table-designer-view";
import { UsageSeriesView } from "@/components/console/usage-series-view";
import { CheckIcon, EmptyState, ErrorState, InlineEmptyState } from "@/components/console/console-parts";
import { CopyValue } from "@/components/console/copy-value";
import { DangerousAction } from "@/components/console/dangerous-action";
import { Database } from "lucide-react";

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
 * DIE SPAETEREN ZUSTAENDE (2.65)
 *
 * `renderToStaticMarkup` fuehrt `useEffect` nicht aus. Bis 2.64 endete der
 * Vertrag darum beim Ladezustand, und was eine Ansicht nach dem Laden zeigt,
 * hat nie jemand gesehen: der fertige Zustand, der Fehlerzustand, der leere
 * Zustand. Genau dort steht viel Text, und ein deutscher Satz, der an `t()`
 * vorbeigeschrieben wurde, faellt niemandem auf.
 *
 * Es gab zwei Wege. Der erste: eine Testbibliothek, die einen echten
 * Renderdurchlauf mit Effekten fahren kann. Das heisst `jsdom` und ein
 * Testrenderer, also mindestens zwei neue Abhaengigkeiten fuer eine Suite,
 * die heute in einem nackten Node-Prozess laeuft, und zusaetzlich eine
 * gefaelschte `fetch`-Antwort je Ansicht, damit ueberhaupt etwas geladen
 * wird. Der zweite: die Ansicht so bauen, dass ihr erster Zustand von aussen
 * gesetzt werden kann. Gewaehlt ist der zweite. Er kostet keine
 * Abhaengigkeit, er macht die Naht im Quelltext sichtbar statt sie im Test zu
 * verstecken, und er prueft, was er behauptet: nicht "der Effekt ist
 * gelaufen", sondern "dieser Zustand sieht so aus".
 *
 * Die Naht ist eine einzige optionale Requisite `initialState`, die den
 * Anfangswert des Zustands einer Ansicht setzt. 71 der 91 Ansichten haben
 * dieselbe Bauart (`state` plus `message`) und tragen sie; die uebrigen holen
 * beim Oeffnen nichts oder halten ihren Zustand anders, und denen wurde
 * nichts angehaengt. Gefahren werden `ready` und `error` in allen vier
 * Sprachen.
 *
 * WAS DIESER VERTRAG AUSDRUECKLICH NICHT PRUEFT
 *
 * Ein Rendern ohne Effekte ist kein Browserbesuch. `ready` ohne Daten ist der
 * leere Zustand; eine Tabelle mit echten Zeilen bleibt ungesehen, denn dafuer
 * muesste jede Ansicht ausserdem ihre Daten von aussen bekommen, und das
 * waere je Ansicht eine eigene Vorgabe. Es laufen ausserdem keine
 * Ereignisse (kein Klick, keine Eingabe), es gibt kein Layout und keine
 * Stylesheets, also faellt kein abgeschnittener Text und kein kaputtes Raster
 * auf, und `useRef` auf ein DOM-Element bleibt leer.
 *
 * Nicht gerendert wird `console-app.tsx` selbst. Die Schale haengt an
 * `useRouter` aus `next/navigation` und damit an einem Router-Kontext, den es
 * hier nicht gibt. Die dreizehn Ansichten, die bis hierher in ihr standen
 * statt in einer eigenen Datei (Overview, TableView, SqlView, AuthView,
 * StorageView, ComputeView, LiveApiView, ActivityView, ApprovalView,
 * UsageView, SettingsView, PlaceholderView, DatabaseView), liegen jetzt
 * daneben und werden wie alle anderen gerendert. Der Vertrag nannte
 * urspruenglich vierzehn: `BackupsView` war da schon eine eigene Datei, und
 * die Liste war an dieser Stelle einen Schnitt zu alt. `PlaceholderView`
 * gibt es seit 2.99 nicht mehr: Mit dem letzten Platzhalter ging auch die
 * Ansicht, die ihn erklaert hat.
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
 * Die eine Datei im Ordner, die mehrere Komponenten exportiert (2.65).
 *
 * `console-parts.tsx` sammelt die kleinen Bausteine, die nach dem Ausziehen
 * der dreizehn Ansichten in mehreren Dateien gleich dastanden. Sie ist keine
 * Seite, also gilt die Regel "genau eine Komponente je Datei" fuer sie nicht;
 * gerendert wird dafuer jeder Baustein einzeln.
 */
const PARTS = "console-parts.tsx";

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
 * Die Schale holt einmal `/api/v1/console` und reicht das Ergebnis an die
 * Ansichten weiter, die daraus leben. Hier steht dieselbe Antwort als feste
 * Vorgabe: ein Projekt, ein Ereignis, keine offene Freigabe. Die Zahlen sind
 * beliebig, die Form ist es nicht, denn sie kommt aus `lib/types`.
 */
const PROJECT: Project = {
  id: PROJECT_ID, organizationId: "org_render_contract", name: "Render Contract", slug: "render-contract",
  region: "eu-central-1", environment: ENVIRONMENT, status: "ready",
  databaseSizeMb: 128, storageSizeMb: 2048, apiRequests: 4096, activeUsers: 12,
};

const AUDIT: AuditEvent[] = [{
  id: "evt_render_contract", organizationId: PROJECT.organizationId, projectId: PROJECT_ID,
  environment: ENVIRONMENT, actor: "Codex", action: "schema.read", resource: "public.orders",
  status: "success", createdAt: "2026-01-02T03:04:05.000Z",
}];

const SNAPSHOT: Snapshot = {
  user: { id: "usr_render_contract", email: "contract@example.com" },
  organization: { id: PROJECT.organizationId, name: "Render Contract", slug: "render-contract" },
  projects: [PROJECT], changeSets: [], approvals: [], audit: AUDIT,
};

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
  ActivityView: [
    element(ActivityView, { audit: AUDIT, aiOnly: true }),
    element(ActivityView, { audit: AUDIT, aiOnly: false }),
  ],
  // Die gemeinsamen Bausteine aus `console-parts.tsx`. Titel und Text von
  // `EmptyState` kommen von der aufrufenden Ansicht und laufen dort durch
  // `t()`; hier stehen englische Platzhalter, damit die Pruefung auf deutsche
  // Reste den Baustein misst und nicht die Vorgabe des Tests.
  CheckIcon: [element(CheckIcon, {})],
  EmptyState: [element(EmptyState, { icon: Database, title: "Nothing", text: "Nothing has arrived yet." })],
  ErrorState: [element(ErrorState, { message: "boom", retry: () => {} })],
  // 2.137: Der leere Zustand einer Karte, einmal mit und einmal ohne Knopf.
  // Ohne Knopf ist der Fall jeder Ansicht, die nur liest.
  InlineEmptyState: [
    element(InlineEmptyState, { text: "Nothing has arrived here yet." }),
    element(InlineEmptyState, { text: "Nothing has arrived here yet.", action: "Create the first one" }),
  ],
  // 2.137: Der eine Kopier-Weg. Ohne `failed` faellt er auf die Aufforderung
  // zurueck, und genau das rendert der zweite Fall.
  CopyValue: [
    element(CopyValue, { value: "qk_public_abc", labels: { copy: "Copy", copied: "Copied", failed: "Clipboard not reachable" } }),
    element(CopyValue, { value: "qk_public_abc", labels: { copy: "Copy", copied: "Copied" } }),
  ],
  // 2.137: Geschlossen steht nur der Knopf da; das Feld fuer den Namen
  // erscheint erst nach dem Druck, und ein Vertrag auf Markup sieht es nicht.
  DangerousAction: [element(DangerousAction, {
    label: "Delete", title: "Delete the bucket", consequence: "The bucket and its name disappear.",
    confirmName: "assets", onConfirm: () => {},
  })],
  ApprovalView: [element(ApprovalView, { ...DEFAULT_PROPS, approvals: SNAPSHOT.approvals, changes: SNAPSHOT.changeSets, reload: async () => {} })],
  BillingSettingsView: [element(BillingSettingsView, { ...DEFAULT_PROPS, navigate: () => {} })],
  DatabaseView: [element(DatabaseView, { project: PROJECT, navigate: () => {} })],
  OverviewView: [element(OverviewView, { snapshot: SNAPSHOT, project: PROJECT, navigate: () => {} })],
  SettingsView: [element(SettingsView, { project: { name: PROJECT.name, id: PROJECT.id }, organizationId: PROJECT.organizationId })],
  // Zweimal: der Menuepunkt "SQL Editor" und der Menuepunkt "Vorlagen"
  // oeffnen dieselbe Ansicht, einmal mit zugeklappter und einmal mit
  // aufgeklappter Vorlagenliste.
  SqlView: [false, true].map((templatesOpen) => element(SqlView, {
    ...DEFAULT_PROPS, reload: async () => {}, navigate: () => {}, templatesOpen,
  })),
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
 * Diese zehn Ansichten oeffnen im Ruhezustand und nicht im Ladezustand, und
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
 *
 * Und diese sechs kommen aus `console-app.tsx` und holen dort nichts, weil
 * die Schale schon geholt hat oder weil es nichts zu holen gibt:
 *
 *   OverviewView           Kennzahlen, Aktivitaet und Freigaben stehen in den
 *                          Requisiten; die eine Antwort holt die Schale.
 *   ActivityView           Dieselben Ereignisse, dieselbe Antwort, nur anders
 *                          gezeigt.
 *   SettingsView           Name und IDs stehen in den Requisiten, und
 *                          Speichern gibt es hier nicht.
 *   DatabaseView           Reiner Text und ein Verweis auf den Table Editor:
 *                          die Provisionierung ist nicht verbunden.
 *   SqlView                Im Editorfeld steht eine Abfrage, und sie laeuft
 *                          erst, wenn jemand den Knopf drueckt. Ein
 *                          Ladezustand beim Oeffnen waere hier eine Luege.
 */
const OPENS_IDLE = new Set([
  "DashboardSettingsView", "QueryInsightsView", "RealtimeInspectorView", "RealtimePoliciesView",
  "OverviewView", "ActivityView", "SettingsView", "DatabaseView", "SqlView",
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

/**
 * Die Texte einer englisch gerenderten Ansicht, die kein Uebersetzer je
 * gesehen hat. Zwei Faelle, beide aus derselben Ursache: der Text ist nicht
 * durch `t()` gelaufen.
 */
function germanLeftovers(markup: string): string[] {
  const english = CONSOLE_TRANSLATIONS.en;
  const translated = new Set(Object.values(english));
  return visibleTexts(markup).filter((text) => {
    // Erster Fall: der Text ist genau ein Schluessel, dessen englische Fassung
    // anders lautet. Dann kann er nicht durch `t()` gelaufen sein.
    if (english[text] !== undefined && english[text] !== text) return true;
    // Zweiter Fall: der Text sieht deutsch aus und ist keine der englischen
    // Fassungen. Das faengt einen Satz, den niemand je in die Tabelle
    // eingetragen hat.
    return GERMAN_MARKER.test(text) && !translated.has(text);
  });
}

/**
 * Die beiden Zustaende, die jede Ansicht mit Naht kennt. `ready` ohne Daten
 * ist zugleich der leere Zustand; ein dritter Name dafuer waere eine Luege.
 */
const PHASES = ["ready", "error"] as const;

/**
 * Eine Ansicht, deren fertiger Zustand nicht am Zustand allein haengt.
 *
 * `QueryInsightsView` zeigt den Plan einer Abfrage erst, wenn einer da ist
 * (`state === "ready" && plan !== null`). Ein gesetztes `ready` ohne Plan
 * sieht dort genauso aus wie der Ruhezustand, und ein Fall, der nichts
 * Neues zeigt, prueft auch nichts. Ihr Fehlerzustand steht fuer sich und
 * wird gefahren.
 */
const NO_READY_WITHOUT_DATA = new Set(["QueryInsightsView"]);

/** Die Dateien, deren Ansicht ihren ersten Zustand von aussen nimmt. */
async function seamed(): Promise<Set<string>> {
  const found = new Set<string>();
  for (const file of await discovered()) {
    const source = await readFile(path.join(CONSOLE_DIR, file), "utf8");
    if (/initialState\s*\?\?/u.test(source)) found.add(file);
  }
  return found;
}

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
    if (file === PARTS) expect(names.length, `${PARTS} traegt keine gemeinsamen Bausteine mehr`).toBeGreaterThan(1);
    else expect(names, `${file} exportiert nicht genau eine Komponente`).toHaveLength(1);
    for (const name of names) found.push({ file, name, component: module[name] as (props: never) => unknown });
  }
  return found.sort((a, b) => (a.file === b.file ? a.name.localeCompare(b.name) : a.file.localeCompare(b.file)));
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

/**
 * Jeder Fall rendert Dutzende Ansichten in vier Sprachen. Fuenf Sekunden, die
 * Vorgabe von vitest, reichen dafuer auf keiner Maschine, auf der noch etwas
 * anderes laeuft.
 */
const BUDGET = 60_000;

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
    expect([...new Set(found.map((entry) => entry.file))]).toEqual(files);
    expect(files.length).toBeGreaterThanOrEqual(79);

    // Jede Ansicht haengt an der Console. Eine Datei, die niemand einbindet,
    // ist entweder tot oder vergessen; beides soll auffallen.
    //
    // Eine Seite (`-view.tsx`) haengt an der Schale selbst, denn sie ist ein
    // Menuepunkt. Die beiden Bruchstuecke haengen an der Seite, in die sie
    // gehoeren: `SidebarFlyout` an der Schale, `InvoicesCard` an
    // `usage-view.tsx`, seit die Nutzung eine eigene Datei ist. Geprueft wird
    // darum in der Schale und, nur fuer ein Bruchstueck, im ganzen Ordner.
    const app = await readFile(path.join(CONSOLE_DIR, "console-app.tsx"), "utf8");
    const sources = new Map<string, string>();
    for (const file of files) sources.set(file, await readFile(path.join(CONSOLE_DIR, file), "utf8"));
    for (const entry of found) {
      if (isView(entry.file)) {
        expect(app, `${entry.file}: ${entry.name} wird in console-app.tsx nicht verwendet`)
          .toContain(`<${entry.name}`);
        continue;
      }
      const users = [...sources.entries()]
        .filter(([file, source]) => file !== entry.file && source.includes(`<${entry.name}`))
        .map(([file]) => file);
      expect(app.includes(`<${entry.name}`) ? [...users, "console-app.tsx"] : users,
        `${entry.file}: ${entry.name} wird nirgends in components/console verwendet`).not.toEqual([]);
    }

    // Und jede Requisitentabelle deckt eine Komponente, die es wirklich gibt.
    const names = new Set(found.map((entry) => entry.name));
    for (const name of Object.keys(SPECIAL_PROPS)) expect(names, `${name} steht in SPECIAL_PROPS, aber nicht im Verzeichnis`).toContain(name);
    for (const name of OPENS_IDLE) expect(names, `${name} steht in OPENS_IDLE, aber nicht im Verzeichnis`).toContain(name);
  }, BUDGET);

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
  }, BUDGET);

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
      // `CheckIcon` ist ein einzelnes Haekchen und sonst nichts; von einem
      // Glyphen eine Seite Text zu verlangen waere sinnlos.
      if (made.component === "CheckIcon") continue;
      // `OptionMenu` zeigt die Beschriftung des gewaehlten Eintrags. Ohne
      // Eintraege, und ohne Eintraege rendert dieser Vertrag es, gibt es keine
      // Beschriftung, die es zeigen koennte; der Knopf steht dann abgeschaltet
      // da. Ein erfundenes Wort an dieser Stelle waere schlechter als keines.
      if (made.component === "OptionMenu") continue;
      if (!texts.some((text) => /\p{L}/u.test(text))) {
        thin.push(`${made.component}#${made.index} zeigt kein lesbares Wort: ${JSON.stringify(texts)}`);
      }
    }
    expect(thin.join("\n")).toBe("");
  }, BUDGET);

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
  }, BUDGET);

  it("zeigt in einer fremden Sprache keinen deutschen Text, den der Uebersetzer nie gesehen hat", async () => {
    setConsoleLocale("en");
    const leftovers: string[] = [];
    for (const made of await cases()) {
      const { markup, thrown } = render(made.element);
      if (thrown !== null) { leftovers.push(`${made.component}#${made.index} wirft beim Rendern: ${thrown}`); continue; }
      for (const text of germanLeftovers(markup)) leftovers.push(`${made.component}#${made.index}: ${text}`);
    }
    setConsoleLocale("de");
    expect(leftovers.join("\n")).toBe("");
  }, BUDGET);

  it("zeigt den fertigen, den leeren und den Fehlerzustand in jeder Sprache", async () => {
    const seams = await seamed();
    const built = await cases();
    const broken: string[] = [];
    let checked = 0;

    for (const made of built) {
      if (!seams.has(made.file)) continue;
      setConsoleLocale("de");
      const first = render(made.element);
      for (const phase of PHASES) {
        if (phase === "ready" && NO_READY_WITHOUT_DATA.has(made.component)) continue;
        // Dieselben Requisiten wie im Ladefall, nur mit gesetztem Zustand.
        // Der eine Zwang ist hier noetig, weil `cases()` alle Ansichten in
        // einer Tabelle haelt und ihre Props-Typen darum nicht mehr
        // auseinanderhaelt; `tsc` sieht die Requisite trotzdem in der Ansicht.
        const made2 = cloneElement(made.element, { initialState: phase } as never);
        for (const locale of LOCALES) {
          setConsoleLocale(locale);
          const { markup, complaints, thrown } = render(made2);
          if (thrown !== null) { broken.push(`${made.component} [${phase}/${locale}#${made.index}] wirft: ${thrown}`); continue; }
          if (complaints.length > 0) broken.push(`${made.component} [${phase}/${locale}#${made.index}]: ${complaints.join(" / ")}`);
          const texts = visibleTexts(markup);
          if (!texts.some((text) => /\p{L}/u.test(text))) {
            broken.push(`${made.component} [${phase}/${locale}#${made.index}] zeigt kein lesbares Wort`);
          }
          if (locale === "de" && markup === first.markup) {
            // Die Naht wirkt nicht: die Ansicht zeigt mit gesetztem Zustand
            // dasselbe wie beim Laden. Dann prueft dieser Fall nichts, und
            // das soll nicht unbemerkt bleiben.
            broken.push(`${made.component} [${phase}#${made.index}] sieht aus wie der Ladezustand`);
          }
          if (locale === "en") {
            for (const text of germanLeftovers(markup)) broken.push(`${made.component} [${phase}#${made.index}]: ${text}`);
          }
        }
        checked += 1;
      }
    }
    setConsoleLocale("de");
    expect(broken.join("\n")).toBe("");
    // Zwei Untergrenzen, damit die Pruefung nicht stillschweigend weniger
    // sieht. Die erste zaehlt die Ansichten mit Naht: Wer sie aus einer
    // einzigen Ansicht entfernt, faellt hier auf. Die zweite zaehlt die
    // wirklich gefahrenen Faelle.
    expect(seams.size, "Ansichten mit gesetztem ersten Zustand").toBeGreaterThanOrEqual(71);
    expect(checked).toBeGreaterThanOrEqual(136);
  }, BUDGET);
});
