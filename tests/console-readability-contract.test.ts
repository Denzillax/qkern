import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { approvalStatusLabel, changeSetRiskLabel } from "@/lib/console/change-set-labels";
import { auditStatusLabel, matchesAuditQuery } from "@/components/console/activity-view";
import type { AuditEvent } from "@/lib/types";

/**
 * Was ein Nachbau der Console gezeigt hat (2.157, 2.158).
 *
 * **Woher die Befunde kommen.** Die Console liegt hinter der Anmeldung, und
 * dort melde ich mich nicht an. Darum lief sie in einem Nachbau: dieselben
 * Komponenten, dasselbe Stylesheet, als Daten der Speicher-Store mit seinem
 * Demo-Projekt. Ein Pruefskript ging ueber die Hauptansichten in beiden Modi
 * und meldete jeden sichtbaren Text unter 11 Pixeln und jeden unter dem
 * AA-Kontrast. Die Zahlen in den Kommentaren unten stammen von dort.
 *
 * **Was dieser Vertrag kann.** Er rendert nichts und misst keinen Kontrast. Er
 * haelt die Regeln fest, die die gemessenen Fehler behoben haben, damit eine
 * spaetere Aenderung sie nicht still zuruecknimmt.
 */
const CSS = path.resolve(process.cwd(), "app/globals.css");
const APP = path.resolve(process.cwd(), "components/console/console-app.tsx");

/** Der Rumpf einer Regel, an ihrem Selektor gesucht. */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `Regel ${selector} fehlt`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

function fontSize(body: string): number {
  const match = body.match(/font(?:-size)?:[^;]*?(\d+(?:\.\d+)?)px/);
  expect(match, `keine Schriftgroesse in ${body.slice(0, 60)}`).not.toBeNull();
  return Number(match![1]);
}

describe("console readability contract", () => {
  it("writes accent, success and warning text with the text tokens", async () => {
    const css = await readFile(CSS, "utf8");
    // `--qkern-primary` ist eine Flaechenfarbe; als Schrift auf der dunklen
    // Karte ergab sie 2,56 zu 1.
    for (const selector of [".plain-button", ".code-head span", ".log-row code"]) {
      expect(ruleBody(css, selector), selector).toContain("color: var(--qkern-accent-text)");
    }
    // Erfolg und Warnung als Schrift gehen nur noch ueber die Text-Token. Das
    // feste #f3ab5f in `.risk.medium` ergab im hellen Modus 1,71 zu 1.
    expect(css).not.toMatch(/(^|[^-\w])color: var\(--qkern-(success|warning)\)/m);
    expect(ruleBody(css, ".risk.medium")).toContain("color: var(--qkern-warning-text)");
    for (const token of ["--qkern-warning-text", "--qkern-success-text", "--qkern-accent-text"]) {
      expect(css.split(`${token}:`).length - 1, `${token} je Modus`).toBeGreaterThanOrEqual(2);
    }
    // Der Fehlertext bekommt im dunklen Modus einen helleren Ton (3,88 -> 5,97).
    expect(css).toMatch(/:root\[data-theme="dark"\] \{[^}]*--qkern-danger: #f0616e;/);
  });

  it("keeps running text out of the eight and nine pixel range", async () => {
    const css = await readFile(CSS, "utf8");
    for (const selector of [
      ".user-chip strong", ".user-chip small", ".user-chip > span",
      ".editor-tabs > span", ".editor-footer", ".automation-footer",
      ".plain-button", ".code-head span", ".toolbar-search input",
      ".metric-tile > small", ".metric small",
    ]) {
      expect(fontSize(ruleBody(css, selector)), selector).toBeGreaterThanOrEqual(11);
    }
  });

  it("lets the narrow topbar rules win over the later fixes", async () => {
    const css = await readFile(CSS, "utf8");
    // Die alten Media-Queries waren richtig gemeint und wurden von spaeteren
    // Regeln ohne Media-Query ueberschrieben. Die neuen stehen dahinter.
    const override = css.lastIndexOf("min-width: 220px");
    const compact = css.indexOf("@media (max-width: 1365px)");
    expect(override).toBeGreaterThan(-1);
    expect(compact, "die schmale Kopfzeile steht vor der Regel, die sie aufhebt").toBeGreaterThan(override);
    expect(css.slice(compact)).toMatch(/\.console-root \.command-button \{[^}]*width: 40px/);
    expect(css).toMatch(/\.console-crumb > strong \{[^}]*text-overflow: ellipsis/);
    expect(css).toMatch(/\.interface-menu \.stable-label \{ display: none; \}/);
  });

  it("keeps only the active group open in the easy sidebar", async () => {
    const app = await readFile(APP, "utf8");
    // Nach Uebersicht, Datenbank und API standen drei Gruppen offen und
    // schoben die unteren Eintraege aus dem Bild.
    expect(app).toContain("const focusEasyGroup = useCallback(");
    expect(app).toMatch(/!entry\.startsWith\("easy:"\) \|\| entry === key/);
    expect(app).toContain("focusEasyGroup(activeEasyGroup.id);");
  });

  it("names risk and status in words instead of raw values", () => {
    expect(changeSetRiskLabel("medium")).toBe("mittel");
    expect(approvalStatusLabel("pending")).toBe("offen");
    expect(approvalStatusLabel("expired")).toBe("abgelaufen");
    expect(auditStatusLabel("success")).toBe("erfolgreich");
    expect(auditStatusLabel("blocked")).toBe("blockiert");
    // Unbekanntes bleibt sichtbar, statt zu verschwinden.
    expect(auditStatusLabel("archived")).toBe("archived");
  });

  it("searches the events that are already loaded", () => {
    const event: AuditEvent = {
      id: "aud_1", organizationId: "org", projectId: "prj", environment: "development",
      actor: "Codex", action: "qkern_migration_preview", resource: "chg_8F2A",
      status: "pending", createdAt: "2026-10-03T10:00:00.000Z",
    };
    expect(matchesAuditQuery(event, "")).toBe(true);
    expect(matchesAuditQuery(event, "PREVIEW")).toBe(true);
    expect(matchesAuditQuery(event, "chg_8f2a")).toBe(true);
    // Der Zustand ist in beiden Worten auffindbar, roh und uebersetzt.
    expect(matchesAuditQuery(event, "offen")).toBe(true);
    expect(matchesAuditQuery(event, "pending")).toBe(true);
    expect(matchesAuditQuery(event, "schema_list")).toBe(false);
  });
});
