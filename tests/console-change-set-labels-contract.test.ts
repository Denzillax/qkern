import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  changeSetLabelTexts, changeSetRiskLabel, changeSetStatusLabel,
} from "@/lib/console/change-set-labels";

/**
 * Zustand und Risiko eines Change Sets heissen ueberall gleich (2.145).
 *
 * **Der Befund.** Die Migrationsliste uebersetzte den Zustand ueber eine eigene
 * Tabelle in ihrer Datei, der Verlauf des SQL-Editors zeigte denselben Wert roh
 * als `pending_approval` und `critical`. Zwei Ansichten, die dasselbe Feld
 * zeigen, benannten es verschieden, und in drei von vier Sprachen war die eine
 * davon gar nicht uebersetzt.
 *
 * **Was der Vertrag haelt.** Dass es die Tabelle nur einmal gibt, dass keine
 * Ansicht eine zweite aufmacht, und dass ein unbekannter Zustand sichtbar
 * bleibt statt zu verschwinden. Das Letzte ist wichtiger, als es aussieht: Ein
 * neuer Zustand im Backend soll in der Console auffallen.
 */
const VIEWS = path.resolve(process.cwd(), "components/console");

describe("console change set labels contract", () => {
  it("keeps the words in one module and hands them to the i18n contract", () => {
    expect(changeSetStatusLabel("pending_approval")).toBe("wartet auf Freigabe");
    expect(changeSetStatusLabel("applied")).toBe("angewendet");
    expect(changeSetRiskLabel("critical")).toBe("kritisch");
    const texts = changeSetLabelTexts();
    expect(texts).toContain("wartet auf Freigabe");
    expect(texts).toContain("kritisch");
    // Jeder Zustand aus `ChangeStatus` hat ein Wort (2.164); `ready` fehlte.
    for (const status of ["draft", "validating", "ready", "approved", "applied", "rejected", "failed", "rolled_back"]) {
      expect(changeSetStatusLabel(status), status).not.toBe(status);
    }
    expect(new Set(texts).size, "ein Wort steht zweimal in der Liste").toBe(texts.length);
  });

  it("shows an unknown value instead of swallowing it", () => {
    expect(changeSetStatusLabel("quantum_superposition")).toBe("quantum_superposition");
    expect(changeSetRiskLabel("unbekannt")).toBe("unbekannt");
  });

  it("leaves no second table in any view", async () => {
    const files = (await readdir(VIEWS)).filter((name) => name.endsWith(".tsx"));
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(path.join(VIEWS, file), "utf8");
      // Eine eigene Zuordnung erkennt man daran, dass ein Zustandsname als
      // Schluessel eines Objektliterals steht.
      if (/\b(pending_approval|rolled_back):\s*t\(/.test(source)) offenders.push(file);
    }
    expect(offenders, "diese Ansichten fuehren eine zweite Tabelle").toEqual([]);
  });

  it("is used by both views that show a change set", async () => {
    for (const file of ["migrations-view.tsx", "sql-view.tsx"]) {
      const source = await readFile(path.join(VIEWS, file), "utf8");
      expect(source, `${file} benutzt die gemeinsamen Worte nicht`)
        .toContain("changeSetStatusLabel");
    }
  });
});
