import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  EASY_NAV, INTERFACE_MODES, NAV_ENTRIES, REAL_VIEWS, easyGroupOf, easyLabelOf,
  easySectionOf, easySections,
} from "@/components/console/navigation";
import { CONSOLE_DISPLAY_DEFAULTS, validateConsoleDisplaySettings } from "@/lib/console/display-settings";
import { interfaceModeGroupCount } from "@/components/console/interface-menu";

/**
 * Der einfache Modus verliert nichts (2.134).
 *
 * **Die Zusage.** Easy und Advanced sind zwei Anordnungen derselben Ansichten.
 * Das ist leicht gesagt und beim naechsten neuen Menuepunkt leicht gebrochen:
 * Wer eine Ansicht in `NAV` eintraegt und `EASY_NAV` vergisst, hat eine Seite
 * gebaut, die im Vorgabemodus niemand findet. Dann waere der Modus kein
 * Aufraeumen, sondern ein stilles Wegnehmen, und genau das verbietet dieser
 * Vertrag.
 *
 * **Was er prueft.** Dass jede echte Ansicht in beiden Navigationen genau
 * einmal steht, dass vorne in jeder Gruppe wirklich etwas steht (eine Gruppe,
 * die nur aus zugeklappten Abschnitten besteht, oeffnet ins Leere), dass die
 * Vorgabe `easy` ist, dass eine fremde Betriebsart abgelehnt wird und dass der
 * Umschalter wirklich in der Kopfzeile haengt.
 *
 * **Was er nicht kann.** Er sagt nichts darueber, ob die Einteilung gut ist.
 * Ob "Replikation" unter Erweitert richtig liegt, entscheidet kein Vertrag.
 */
const APP = path.resolve(process.cwd(), "components/console/console-app.tsx");

describe("console interface mode contract", () => {
  it("reaches every real view in the easy navigation, exactly once", () => {
    const ids = EASY_NAV.flatMap((group) => group.children.map((child) => child.id));
    expect(new Set(ids).size, "eine Ansicht steht zweimal im einfachen Modus").toBe(ids.length);
    for (const id of REAL_VIEWS) {
      expect(ids, `echte Ansicht ${id} ist im einfachen Modus nicht erreichbar`).toContain(id);
    }
    // Und nichts darueber hinaus: Eine Kennung ohne Ansicht waere eine Zeile,
    // die auf eine leere Seite fuehrt.
    for (const id of ids) expect(REAL_VIEWS as readonly string[], id).toContain(id);
  });

  it("carries the same number of views in both modes", () => {
    const easy = EASY_NAV.flatMap((group) => group.children.map((child) => child.id));
    expect(easy.length).toBe(NAV_ENTRIES.length);
  });

  it("opens every easy group on a visible entry", () => {
    for (const group of EASY_NAV) {
      const front = group.children.filter((child) => !child.section);
      expect(front.length, `${group.label} hat vorne keinen Eintrag`).toBeGreaterThan(0);
      // Ein Abschnitt mit einem einzigen Eintrag waere eine Klappe fuer eine
      // Zeile; dann gehoert die Zeile nach vorne.
      for (const section of easySections(group)) {
        const entries = group.children.filter((child) => child.section === section);
        expect(entries.length, `${group.label} / ${section} hat nur einen Eintrag`).toBeGreaterThan(1);
      }
    }
  });

  it("finds the group and the section of every view, and titles it", () => {
    for (const id of REAL_VIEWS) {
      const group = easyGroupOf(id);
      expect(group.children.some((child) => child.id === id), id).toBe(true);
      const section = easySectionOf(id);
      if (section !== null) expect(easySections(group)).toContain(section);
      expect(easyLabelOf(id).length, id).toBeGreaterThan(0);
    }
    expect(easyLabelOf("table")).toBe("Datenbank · Daten");
    expect(easyLabelOf("db-triggers")).toBe("Datenbank · Trigger");
  });

  it("defaults to easy and refuses an unknown mode", () => {
    expect(CONSOLE_DISPLAY_DEFAULTS.interfaceMode).toBe("easy");
    expect(validateConsoleDisplaySettings({}).interfaceMode).toBe("easy");
    expect(validateConsoleDisplaySettings({ interfaceMode: "advanced" }).interfaceMode).toBe("advanced");
    expect(() => validateConsoleDisplaySettings({ interfaceMode: "easy-plus" })).toThrow();
    expect(INTERFACE_MODES).toEqual(["easy", "advanced"]);
  });

  it("counts the groups of each mode instead of writing the number down", () => {
    expect(interfaceModeGroupCount("easy")).toBe(EASY_NAV.length);
    expect(interfaceModeGroupCount("advanced")).toBeGreaterThan(EASY_NAV.length);
  });

  it("hangs the switch in the topbar and keeps the view across the change", async () => {
    const source = await readFile(APP, "utf8");
    expect(source).toMatch(/<InterfaceMenu value=\{mode\} onChange=\{setMode\}\/>/);
    // Der Wechsel ruehrt `view` nicht an. Stuende hier ein `setView`, waere die
    // geoeffnete Tabelle nach dem Umschalten weg.
    const setMode = source.slice(source.indexOf("const setMode"), source.indexOf("const [view, setView]"));
    expect(setMode).not.toContain("setView");
    expect(setMode).toContain("/api/v1/auth/console-settings");
    // Und er laedt die Seite nicht neu: `router.refresh` gehoert zur Sprache,
    // nicht zum Modus.
    expect(setMode).not.toContain("router.");
  });
});
