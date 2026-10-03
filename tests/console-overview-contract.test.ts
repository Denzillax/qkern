import { readFile } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";
import { setConsoleLocale } from "@/components/console/console-i18n";
import { REAL_VIEWS } from "@/components/console/navigation";
import { OverviewView } from "@/components/console/overview-view";
import { HEALTH_STATES, type HealthState } from "@/lib/console/health-advisor-texts";
import type { Snapshot } from "@/lib/console/console-snapshot";
import {
  OVERVIEW_SERVICES,
  isMeasured,
  needsOperatorAction,
  overviewRows,
  projectEmptiness,
  toneForState,
  type HealthSubsystemReading,
} from "@/lib/console/project-health";
import { QUICK_START_INSTALL, QUICK_START_STEPS, connectSnippet, quickStartStepsPointAtRealViews } from "@/lib/console/quick-start";
import type { AuditEvent, Project } from "@/lib/types";

/**
 * Was die Projekt-Uebersicht zusagt (2.136).
 *
 * Drei Zusagen, und jede einzeln gebrochen und wieder geheilt:
 *
 *   1. Kein Dienst steht gruen da, ohne dass er gemessen wurde. Gemessen heisst
 *      `ok`, also gefragt und geantwortet; `configured` ist nicht gemessen.
 *   2. Der Schnellstart erscheint nur in einem Projekt, dessen Leere gelesen
 *      ist. Fehlt eine der drei Zahlen, erscheint er nicht.
 *   3. Jeder Schritt des Schnellstarts fuehrt in eine Ansicht, die es gibt.
 *
 * Dazu eine vierte, die aus Punkt 3 der Aufgabe folgt: Ein grosser Kasten
 * erscheint nur fuer einen gestoerten Dienst und nicht fuer einen, den niemand
 * eingerichtet hat.
 *
 * WIE HIER GEPRUEFT WIRD
 *
 * Die Rechnung steht in `lib/console/project-health` und ist rein, also wird
 * sie direkt gefahren: jeder Zustand, den der Server kennt, einmal. Die Ansicht
 * wird dazu wirklich gerendert. `renderToStaticMarkup` fuehrt keinen Effekt
 * aus, holt also nichts; die Lesung kommt darum ueber die Naht
 * `initialReadings` herein, so wie `initialState` im Render-Vertrag. Ohne diese
 * Naht waere von der Seite nur der Fall ohne Antwort zu sehen, und gerade die
 * Faelle mit Antwort sind die, in denen ein falsches Gruen stehen koennte.
 *
 * Keine Fallnummer im Sinne der Zertifizierung: Dieser Vertrag fasst keine
 * Datenbank an, keine Route und kein Schema. Er rechnet und rendert in einem
 * Node-Prozess.
 */

const PROJECT_ID = "prj_overview_contract";

const PROJECT: Project = {
  id: PROJECT_ID, organizationId: "org_overview_contract", name: "Overview Contract", slug: "overview-contract",
  region: "eu-central-1", environment: "development", status: "ready",
  databaseSizeMb: 0, storageSizeMb: 0, apiRequests: 0, activeUsers: 0,
};

const AUDIT: AuditEvent[] = [{
  id: "evt_overview_contract", organizationId: PROJECT.organizationId, projectId: PROJECT_ID,
  environment: "development", actor: "Codex", action: "schema.read", resource: "public.orders",
  status: "success", createdAt: "2026-01-02T03:04:05.000Z",
}];

const SNAPSHOT: Snapshot = {
  user: { id: "usr_overview_contract", email: "contract@example.com" },
  organization: { id: PROJECT.organizationId, name: "Overview Contract", slug: "overview-contract" },
  projects: [PROJECT], changeSets: [], approvals: [], audit: AUDIT,
};

/** Eine Antwort der Gesundheitsroute, so knapp wie die Ansicht sie liest. */
function reading(id: string, state: HealthState, evidence: Array<{ measure: string; count: number | null }> = []): HealthSubsystemReading {
  return { id, state, evidence };
}

/** Die drei Zahlen, aus denen die Leere eines Projekts gelesen wird. */
function counted(input: { tables: number | null; buckets: number | null; providers: number | null; state?: HealthState }): HealthSubsystemReading[] {
  const state = input.state ?? "ok";
  const rows: HealthSubsystemReading[] = [];
  rows.push(reading("database", state, input.tables === null ? [] : [{ measure: "tables", count: input.tables }]));
  rows.push(reading("storage", state, input.buckets === null ? [] : [{ measure: "buckets", count: input.buckets }]));
  rows.push(reading("auth", state, input.providers === null ? [] : [{ measure: "providers", count: input.providers }]));
  return rows;
}

function markup(props: { initialState?: "loading" | "ready" | "error"; initialReadings?: HealthSubsystemReading[] | null }): string {
  return renderToStaticMarkup(createElement(OverviewView, {
    snapshot: SNAPSHOT, project: PROJECT, navigate: () => {}, ...props,
  }));
}

const SOURCE = path.resolve(process.cwd(), "components/console/overview-view.tsx");

afterAll(() => setConsoleLocale("de"));

describe("console overview contract", () => {
  it("faerbt keinen Dienst gruen, der nicht gemessen wurde", () => {
    // Jeder Zustand, den der Server ueberhaupt schicken kann, einmal. Die
    // Schleife ist der Punkt: Ein neuer Zustand in `HEALTH_STATES` ist hier
    // sofort dabei und muesste sich erst als Messung ausweisen.
    for (const state of HEALTH_STATES) {
      const green = toneForState(state) === "green";
      expect(green, `${state}: gruen ohne Messung`).toBe(isMeasured(state));
    }
    expect(toneForState("ok")).toBe("green");
    expect(toneForState("configured")).toBe("neutral");
    expect(toneForState("degraded")).toBe("red");
    expect(toneForState("unknown")).toBe("amber");
    expect(toneForState(null)).toBe("neutral");

    // Und dasselbe durch die Zeilen hindurch: eine Antwort, in der kein Dienst
    // gefragt wurde, hat keine gruene Zeile.
    const rows = overviewRows(OVERVIEW_SERVICES.map((id) => reading(id, "configured")));
    expect(rows.filter((row) => row.tone === "green")).toEqual([]);
    expect(overviewRows(OVERVIEW_SERVICES.map((id) => reading(id, "ok"))).every((row) => row.tone === "green")).toBe(true);
  });

  it("zeigt ohne Lesung fuenf graue Zeilen und kein Urteil", () => {
    setConsoleLocale("de");
    const html = markup({ initialState: "ready", initialReadings: null });
    // Fuenf Dienste, fuenf Mal dieselbe ehrliche Auskunft.
    expect(html.match(/nicht verbunden/gu)?.length).toBe(OVERVIEW_SERVICES.length);
    // Und nirgends das gruene Urteil der Gesundheitsseite.
    expect(html).not.toContain("erreichbar");
    expect(html).not.toContain("secure");
  });

  it("zeigt die gelesenen Urteile und faerbt nur das gemessene gruen", () => {
    setConsoleLocale("de");
    const html = markup({
      initialState: "ready",
      initialReadings: [
        reading("database", "ok", [{ measure: "tables", count: 3 }]),
        reading("realtime", "configured"),
        reading("storage", "unconfigured", [{ measure: "buckets", count: 0 }]),
      ],
    });
    expect(html).toContain("erreichbar");
    expect(html).toContain("eingerichtet");
    // Genau eine gruene Zeile: die Datenbank. Realtime ist eingerichtet und
    // nicht gefragt, und das ist grau.
    expect(html.match(/class="secure"/gu)?.length).toBe(1);
    // Auth und Data API fehlen in dieser Antwort und tragen darum keine Lesung.
    expect(html.match(/nicht verbunden/gu)?.length).toBe(2);
  });

  it("zieht den grossen Kasten nur fuer einen gestoerten Dienst auf", () => {
    setConsoleLocale("de");
    expect(needsOperatorAction(overviewRows(OVERVIEW_SERVICES.map((id) => reading(id, "unconfigured"))))).toBe(false);
    expect(needsOperatorAction(overviewRows(OVERVIEW_SERVICES.map((id) => reading(id, "unknown"))))).toBe(false);
    expect(needsOperatorAction(overviewRows([reading("storage", "degraded")]))).toBe(true);

    // Ein Projekt, in dem nichts eingerichtet ist, bekommt keine Warnung ueber
    // die halbe Seite. Das war der Grund fuer diesen Schnitt.
    const quiet = markup({ initialState: "ready", initialReadings: OVERVIEW_SERVICES.map((id) => reading(id, "unconfigured")) });
    expect(quiet).not.toContain("overview-alert");
    const loud = markup({ initialState: "ready", initialReadings: [reading("storage", "degraded")] });
    expect(loud).toContain("overview-alert");
  });

  it("zeigt den Schnellstart nur, wenn die Leere des Projekts gelesen ist", () => {
    setConsoleLocale("de");
    // Alle drei Zahlen gelesen und alle drei 0: leer.
    const empty = projectEmptiness(counted({ tables: 0, buckets: 0, providers: 0 }));
    expect(empty).toMatchObject({ known: true, empty: true });
    // Eine Tabelle genuegt, und das Projekt ist nicht mehr leer.
    expect(projectEmptiness(counted({ tables: 1, buckets: 0, providers: 0 }))).toMatchObject({ known: true, empty: false });
    // Eine fehlende Zahl ist keine Null: dann ist die Frage unbeantwortet.
    for (const missing of ["tables", "buckets", "providers"] as const) {
      const input = { tables: 0, buckets: 0, providers: 0, [missing]: null } as { tables: number | null; buckets: number | null; providers: number | null };
      expect(projectEmptiness(counted(input)), `${missing} fehlt`).toMatchObject({ known: false, empty: false });
    }
    // Und ohne jede Antwort erst recht nicht.
    expect(projectEmptiness(null)).toMatchObject({ known: false, empty: false });

    // Dieselben vier Faelle an der Seite selbst.
    expect(markup({ initialState: "ready", initialReadings: counted({ tables: 0, buckets: 0, providers: 0 }) })).toContain("Backend aufbauen");
    expect(markup({ initialState: "ready", initialReadings: counted({ tables: 1, buckets: 0, providers: 0 }) })).not.toContain("Backend aufbauen");
    expect(markup({ initialState: "ready", initialReadings: counted({ tables: 0, buckets: 0, providers: null }) })).not.toContain("Backend aufbauen");
    expect(markup({ initialState: "ready", initialReadings: null })).not.toContain("Backend aufbauen");
    expect(markup({ initialState: "loading", initialReadings: counted({ tables: 0, buckets: 0, providers: 0 }) })).not.toContain("Backend aufbauen");
  });

  it("fuehrt jeden Schritt des Schnellstarts in eine Ansicht, die es gibt", async () => {
    const real = new Set<string>(REAL_VIEWS);
    expect(QUICK_START_STEPS.length).toBe(3);
    for (const step of QUICK_START_STEPS) {
      expect(real.has(step.view), `${step.id} zeigt auf ${step.view}, das es nicht gibt`).toBe(true);
    }
    expect(quickStartStepsPointAtRealViews()).toBe(true);
    // Die Ansicht reicht genau diese Kennung an `navigate` weiter und nicht
    // eine eigene Liste daneben.
    const source = await readFile(SOURCE, "utf8");
    expect(source).toContain("navigate(step.view)");
  });

  it("nennt im Beispiel das Paket und die Fabrik, die es wirklich gibt", async () => {
    // Der Auftrag nannte `@qkern/js` und `createClient`. Beides heisst anders,
    // und dieser Fall haelt den nachgesehenen Namen fest: Ein Schnipsel, der
    // sich kopieren laesst und dann nicht laeuft, ist schlimmer als keiner.
    const manifest = JSON.parse(await readFile(path.resolve(process.cwd(), "sdk/typescript/package.json"), "utf8")) as { name: string };
    expect(QUICK_START_INSTALL).toContain(manifest.name);
    const sdk = await readFile(path.resolve(process.cwd(), "sdk/typescript/src/index.ts"), "utf8");
    const snippet = connectSnippet({ baseUrl: "https://console.example.com", projectId: PROJECT_ID, environment: "development" });
    expect(sdk).toContain("export function createQkernClient");
    expect(snippet).toContain("createQkernClient");
    expect(snippet).toContain(`from "${manifest.name}"`);
    // Kein Key im kopierbaren Beispiel; er kommt aus der Umgebung.
    expect(snippet).toContain("process.env.QKERN_PROJECT_KEY");
  });

  it("laesst keinen leeren Bereich mit nichts als einer Verneinung stehen", () => {
    setConsoleLocale("de");
    const html = markup({ initialState: "ready", initialReadings: null });
    // Kein Ereignis und keine Freigabe im Schnappschuss: beide Karten sagen,
    // was hier erscheinen wird, und bieten den Weg dahin an.
    const bare = renderToStaticMarkup(createElement(OverviewView, {
      snapshot: { ...SNAPSHOT, audit: [] }, project: PROJECT, navigate: () => {}, initialState: "ready" as const,
    }));
    expect(bare).toContain("Sobald ein Agent");
    expect(bare).toContain("Im Moment wartet keine");
    expect(html).toContain("Im Moment wartet keine");
  });
});
