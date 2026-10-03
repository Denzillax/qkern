import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { serverErrorText, serverErrorTexts } from "@/components/console/server-errors";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";

/**
 * Die Meldungen des Servers in der Sprache der Console (2.160).
 *
 * Die Routen antworten englisch, und die Ansichten zeigten diese Antwort vor
 * ihrem deutschen Ersatz. Der Vertrag haelt drei Dinge fest: dass bekannte
 * Meldungen uebersetzt werden, dass unbekannte stehen bleiben statt zu
 * verschwinden, und dass keine Ansicht die Antwort am Modul vorbei zeigt.
 */
const VIEWS = path.resolve(process.cwd(), "components/console");

describe("console server errors contract", () => {
  it("translates the frequent messages and the four families", () => {
    expect(serverErrorText("Resource not found")).toMatch(/^Nicht gefunden\./);
    expect(serverErrorText("Authentication required")).toMatch(/Sitzung ist abgelaufen/);
    expect(serverErrorText("Invalid queue request")).toBe("Die Anfrage wurde abgelehnt, weil ein Wert fehlt oder ungültig ist.");
    expect(serverErrorText("Project Storage unavailable")).toMatch(/antwortet gerade nicht/);
    expect(serverErrorText("Could not create project")).toMatch(/nicht geklappt/);
    expect(serverErrorText("Project Queues are disabled")).toMatch(/abgeschaltet/);
  });

  it("keeps an unknown message instead of swallowing it", () => {
    expect(serverErrorText("EGRESS_LIMIT")).toBe("EGRESS_LIMIT");
    expect(serverErrorText("Parts must be listed in ascending order")).toBe("Parts must be listed in ascending order");
    // Ohne Meldung greift wie bisher der Ersatz der Ansicht.
    expect(serverErrorText(undefined)).toBeUndefined();
    expect(serverErrorText("")).toBeUndefined();
    expect(serverErrorText({ nested: true })).toBeUndefined();
  });

  it("has every sentence in every language", () => {
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = serverErrorTexts().filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, locale).toEqual([]);
    }
  });

  it("lets no view show a server message past the translator", async () => {
    // Die drei Schreibweisen, in denen die Antwort vorher roh durchging. Die
    // erste schloss zuerst ein vorangehendes "(" aus und uebersah damit
    // `setMessage(payload.error??...)` und `new Error(payload.error??...)`:
    // Der Nachbau zeigte danach noch "Resource not found", der Vertrag war gruen.
    const raw = [
      /(?<![\w.])(?:[A-Za-z_]\w*\??\.)*[A-Za-z_]\w*\??\.error\s*\?\?/,
      /typeof ((?:[A-Za-z_]\w*\??\.)*[A-Za-z_]\w*\??)\.error === "string" (?:&& \1\.error )?\? \1\.error :/,
    ];
    const offenders: string[] = [];
    for (const name of await readdir(VIEWS)) {
      if (!name.endsWith(".tsx")) continue;
      const text = (await readFile(path.join(VIEWS, name), "utf8")).replace(/serverErrorText\([^)]*\)/g, "");
      for (const pattern of raw) if (pattern.test(text)) offenders.push(`${name}: ${pattern.source.slice(0, 30)}`);
    }
    expect(offenders).toEqual([]);
  });
});
