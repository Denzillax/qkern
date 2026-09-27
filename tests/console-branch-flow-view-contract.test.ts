import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import { FIXED_ENVIRONMENTS } from "@/lib/server/control-plane/model";
import {
  APPROVALS_SOURCE_NOTE,
  APPROVAL_STATUS_TEXTS,
  CHANGE_SETS_SOURCE_NOTE,
  CHANGE_STATUS_TEXTS,
  ENVIRONMENT_SET_NOTE,
  MIGRATIONS_SOURCE_NOTE,
  MIGRATION_STATUS_TEXTS,
  MISSING_BRANCHING,
  NO_FREE_BRANCHES,
  NO_QUEUE_NOTE,
  REVIEW_EXISTS_NOTE,
  REVIEW_STEPS,
  SCOPE_NOTE,
  branchFlowTexts,
  environmentText,
  openChangeCount,
  presence,
} from "@/lib/console/branch-flow-texts";

/**
 * Branches (2.81) ersetzt zwei Platzhalter mit einer lesenden Seite, und die
 * Seite sagt, was QKERN nicht hat. Der Vertrag prueft das an der Quelle: kein
 * Schreibverb, alle drei Umgebungen immer, die fehlenden Faehigkeiten mit
 * Grund, die Zustandslisten deckungsgleich mit den Enums der Datenbank, und
 * jeder Text in allen vier Sprachen.
 *
 * Ohne Datenbank: Gelesen werden nur Dateien und exportierte Werte.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

const VIEW = "components/console/branch-flow-view.tsx";
const TEXTS = "lib/console/branch-flow-texts.ts";
const ROUTE = "app/api/v1/projects/[projectId]/change-flow/route.ts";
const CONTROL_PLANE = "lib/server/control-plane/postgres.ts";

describe("console branch flow view contract", () => {
  it("makes one page out of two placeholders and takes both claims off the navigation", async () => {
    expect(REAL_VIEWS).toContain("branches");
    expect(isPlaceholder("branches")).toBe(false);
    expect("branches" in PLACEHOLDERS).toBe(false);
    // Der zweite Platzhalter ist ganz weg und nicht bloss umbenannt.
    expect("branches-merge" in PLACEHOLDERS).toBe(false);
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "branches": return <BranchFlowView');
    const navigation = await source("components/console/navigation.ts");
    for (const promise of [
      "Ein Zweig je Feature mit eigener Datenbank.",
      "Änderungen eines Zweigs prüfen und übernehmen.",
      "Merge-Anfragen",
      "branches-merge",
    ]) {
      expect(navigation, promise).not.toContain(promise);
    }
    // Der Menuepunkt bleibt an seinem Platz und behaelt seinen Namen.
    expect(navigation).toContain('{ id: "branches", label: "Branches", icon: GitBranch }');
  });

  it("says in its first paragraph that there are no free branches", async () => {
    const view = await source(VIEW);
    expect(NO_FREE_BRANCHES).toContain("keine frei benannten Zweige");
    expect(NO_FREE_BRANCHES).toContain("Eine Umgebung ist kein Zweig");
    // Der Satz steht vor jeder Zahl und vor jeder Ladeanzeige.
    const lead = view.indexOf("NO_FREE_BRANCHES");
    expect(lead).toBeGreaterThan(-1);
    expect(lead).toBeLessThan(view.indexOf("formatNumber(open)"));
    expect(lead).toBeLessThan(view.indexOf("Die Kontrollebene wird gefragt…"));
    // Und die Seite sagt daneben, dass den Pruefschritt es wirklich gibt.
    expect(REVIEW_EXISTS_NOTE).toContain("Prüfschritt");
    expect(view).toContain("REVIEW_EXISTS_NOTE");
    // Sie wiederholt die Infrastruktur nicht, sondern verweist darauf.
    expect(SCOPE_NOTE).toContain("Einstellungen → Infrastruktur");
    expect(view).toContain("SCOPE_NOTE");
  });

  it("writes nothing anywhere on this path", async () => {
    const files = await Promise.all([source(VIEW), source(TEXTS), source(ROUTE)]);
    for (const file of files) {
      expect(file).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
    }
    const route = files[2];
    expect(route).not.toMatch(/export (?:const|function|async function) (?:POST|PUT|PATCH|DELETE)\b/);
    expect(route).toContain('"Cache-Control": "private, no-store"');
    // Die Ansicht hat kein Eingabefeld und keinen Speicherknopf.
    expect(files[0]).not.toContain("<input");
    expect(files[0]).not.toContain("<form");
    // Das Textmodul ist rein: kein Abruf, kein React.
    expect(files[1]).not.toContain("fetch(");
    expect(files[1]).not.toContain("use client");
  });

  it("carries no connection string, no password, no host and no port", async () => {
    const everywhere = (await Promise.all([source(VIEW), source(TEXTS), source(ROUTE)])).join("\n");
    for (const word of ["postgres://", "postgresql://", "connectionString", "sslmode", "5432", "localhost", "127.0.0.1"]) {
      expect(everywhere, word).not.toContain(word);
    }
    // Die Antwort traegt auch keine Datenbankreferenz; dafuer gibt es die
    // Route /environments, und auch dort ist sie keine Adresse.
    expect(await source(ROUTE)).not.toContain("databaseInstanceRef");
  });

  it("always answers with all three fixed environments", async () => {
    expect([...FIXED_ENVIRONMENTS]).toEqual(["development", "staging", "production"]);
    const controlPlane = await source(CONTROL_PLANE);
    // Die Liste kommt aus der Konstante und nicht aus der Abfrage: Eine
    // fehlende Zeile darf keine fehlende Umgebung werden.
    expect(controlPlane).toContain("FIXED_ENVIRONMENTS.map((environment)");
    // Gezaehlt wird in der Datenbank, nicht an einer Liste mit Obergrenze.
    for (const table of ["change_sets", "approval_requests", "migration_jobs"]) {
      expect(controlPlane, table).toContain(`FROM ${table}\n`);
    }
    expect(controlPlane).toContain("count(*)::text AS total");
    // Und die Seite sagt, warum immer drei da stehen.
    expect(ENVIRONMENT_SET_NOTE).toContain("wächst und schrumpft");
    expect(await source(VIEW)).toContain("ENVIRONMENT_SET_NOTE");
  });

  it("keeps null apart from zero for the apply queue", async () => {
    expect(NO_QUEUE_NOTE).toContain("keine Warteschlange");
    expect(NO_QUEUE_NOTE).toContain("nicht dasselbe wie eine leere Warteschlange");
    const view = await source(VIEW);
    expect(view).toContain("flow.migrations === null");
    expect(view).toContain("NO_QUEUE_NOTE");
    const memory = await source("lib/server/control-plane/memory.ts");
    expect(memory).toContain("migrations: null");
  });

  it("lists every state the database can hold, and no invented one", () => {
    // Deckungsgleich mit qkern_change_status aus 0001_control_plane.sql.
    expect(Object.keys(CHANGE_STATUS_TEXTS)).toEqual([
      "draft", "validating", "ready", "approved", "applied", "rejected", "failed", "rolled_back",
    ]);
    // Deckungsgleich mit der Check-Bedingung von approval_requests.status.
    expect(Object.keys(APPROVAL_STATUS_TEXTS)).toEqual(["pending", "approved", "rejected", "expired"]);
    // Deckungsgleich mit qkern_migration_job_status samt 0008.
    expect(Object.keys(MIGRATION_STATUS_TEXTS)).toEqual([
      "queued", "running", "applied", "failed", "review_required",
    ]);
    for (const entry of [
      ...Object.values(CHANGE_STATUS_TEXTS),
      ...Object.values(APPROVAL_STATUS_TEXTS),
      ...Object.values(MIGRATION_STATUS_TEXTS),
    ]) {
      expect(entry.explains.length, entry.label).toBeGreaterThanOrEqual(30);
    }
  });

  it("reads the same states out of the migrations in the database as the texts name", async () => {
    const changeStatus = await source("db/migrations/0001_control_plane.sql");
    for (const status of Object.keys(CHANGE_STATUS_TEXTS)) {
      expect(changeStatus, status).toContain(`'${status}'`);
    }
    for (const status of Object.keys(APPROVAL_STATUS_TEXTS)) {
      expect(changeStatus, status).toContain(`'${status}'`);
    }
    const queue = await source("db/migrations/0005_migration_apply_queue.sql");
    const quarantine = await source("db/migrations/0008_migration_reconciliation_quarantine.sql");
    for (const status of Object.keys(MIGRATION_STATUS_TEXTS)) {
      expect(`${queue}\n${quarantine}`, status).toContain(`'${status}'`);
    }
  });

  it("says what is missing, each with a reason", async () => {
    expect(MISSING_BRANCHING.map((entry) => entry.title)).toEqual([
      "Keine Datenbank je Zweig auf Zuruf",
      "Keine Abstammung zwischen Umgebungen",
      "Kein automatisches Zusammenführen von Schemaänderungen",
      "Kein Vergleich zweier Umgebungen",
      "Keine Merge-Anfrage als eigenes Ding",
    ]);
    for (const entry of MISSING_BRANCHING) {
      expect(entry.body.length, entry.title).toBeGreaterThanOrEqual(120);
    }
    expect(MISSING_BRANCHING[1].body).toContain("keine Herkunft");
    expect(await source(VIEW)).toContain("MISSING_BRANCHING");
  });

  it("names the three steps that replace the review of a merge request", async () => {
    expect(REVIEW_STEPS.map((entry) => entry.title)).toEqual([
      "Ein Change Set trägt die Änderung",
      "Eine Freigabe prüft sie",
      "Ein Worker wendet sie an",
    ]);
    expect(REVIEW_STEPS[1].body).toContain("Prüfwert");
    expect(REVIEW_STEPS[2].body).toContain("Warteschlange");
    expect(await source(VIEW)).toContain("REVIEW_STEPS");
  });

  it("says where every number comes from", async () => {
    expect(CHANGE_SETS_SOURCE_NOTE).toContain("change_sets");
    expect(APPROVALS_SOURCE_NOTE).toContain("approval_requests");
    expect(MIGRATIONS_SOURCE_NOTE).toContain("migration_jobs");
    const view = await source(VIEW);
    for (const note of ["CHANGE_SETS_SOURCE_NOTE", "APPROVALS_SOURCE_NOTE", "MIGRATIONS_SOURCE_NOTE"]) {
      expect(view, note).toContain(note);
    }
    // Vier Zustaende der Ansicht, nicht einer.
    for (const state of ["loading", "ready", "unavailable", "error"]) {
      expect(view, state).toContain(`"${state}"`);
    }
    // Neu laden springt nicht in der Breite.
    expect(view).toContain("StableLabel");
    expect(view).toContain('tAll("Lädt…", "Neu laden")');
  });

  it("maps every environment name and every presence to a word", () => {
    expect(environmentText("staging")).toBe("staging");
    expect(environmentText("production")).toBe("production");
    // Ein unbekannter Name wird nicht zu Production geraten.
    expect(environmentText("etwas anderes")).toBe("development");
    expect(presence(true)).toBe("present");
    expect(presence(false)).toBe("absent");
    // Offen heisst eingereicht und noch nicht entschieden oder angewandt;
    // gescheiterte warten nicht und zaehlen darum nicht mit.
    expect(openChangeCount({
      draft: 1, validating: 2, ready: 3, approved: 4,
      applied: 100, rejected: 100, failed: 100, rolled_back: 100,
    })).toBe(10);
  });

  it("formats every number and every moment through console-display", async () => {
    const view = await source(VIEW);
    expect(view).toContain('from "@/components/console/console-display"');
    for (const forbidden of ["Intl.", "toLocaleString", "toLocaleDateString", "toFixed", ".slice(0, 10)"]) {
      expect(view, forbidden).not.toContain(forbidden);
    }
  });

  it("translates every derived text and every literal of the view into en, fr and it", async () => {
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = branchFlowTexts().filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
    const view = await source(VIEW);
    const keys = [...view.matchAll(/(?<![A-Za-z0-9_])t\(("(?:[^"\\]|\\.)*")\)/g)].map((match) => JSON.parse(match[1]) as string);
    expect(keys.length).toBeGreaterThan(20);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = keys.filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
    // Die Versprechen beider Platzhalter sind auch aus den Katalogen weg.
    for (const locale of ["en", "fr", "it"] as const) {
      expect(CONSOLE_TRANSLATIONS[locale]["Merge-Anfragen"]).toBeUndefined();
      expect(CONSOLE_TRANSLATIONS[locale]["Ein Zweig je Feature mit eigener Datenbank. QKERN hat Development, Staging und Production je Projekt; freie Zweige fehlen."]).toBeUndefined();
      expect(CONSOLE_TRANSLATIONS[locale]["Änderungen eines Zweigs prüfen und übernehmen. Change Sets und Freigaben decken den Prüfschritt schon ab."]).toBeUndefined();
    }
  });
});
