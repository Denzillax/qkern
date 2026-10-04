import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { serverErrorText, serverErrorTexts } from "@/components/console/server-errors";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import { projectStorageRouteError } from "@/lib/server/project-storage/http";
import { ProjectStorageError, type ProjectStorageErrorCode } from "@/lib/server/project-storage/service";
import { computeRouteError } from "@/lib/server/compute/definitions-http";
import { ComputeDefinitionError } from "@/lib/server/compute/definitions";

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
    // Die Schreibweisen, in denen die Antwort vorher roh durchging. Die vierte,
    // `(await response.json()).error??`, kam beim Nachbau der Tabellenansicht
    // dazu. Die
    // erste schloss zuerst ein vorangehendes "(" aus und uebersah damit
    // `setMessage(payload.error??...)` und `new Error(payload.error??...)`:
    // Der Nachbau zeigte danach noch "Resource not found", der Vertrag war gruen.
    const raw = [
      /(?<![\w.])(?:[A-Za-z_]\w*\??\.)*[A-Za-z_]\w*\??\.error\s*\?\?/,
      /typeof ((?:[A-Za-z_]\w*\??\.)*[A-Za-z_]\w*\??)\.error === "string" (?:&& \1\.error )?\? \1\.error :/,
      /\.json\(\)\)\.error\s*\?\?/,
      /\.payload\.error\)\.find\([\s\S]{0,200}?typeof error === "string" \? error :/,
    ];
    const offenders: string[] = [];
    for (const name of await readdir(VIEWS)) {
      // Auch `.ts` (2.164): Die gemeinsame Quelle der Datenbankberichte ist
      // eine `.ts`-Datei, und vier Seiten zeigten darum weiter
      // "Resource not found". Das Modul selbst ist ausgenommen.
      if (!/\.tsx?$/.test(name) || name === "server-errors.ts") continue;
      const text = (await readFile(path.join(VIEWS, name), "utf8")).replace(/serverErrorText\([^)]*\)/g, "");
      for (const pattern of raw) if (pattern.test(text)) offenders.push(`${name}: ${pattern.source.slice(0, 30)}`);
    }
    expect(offenders).toEqual([]);
  });

  it("translates every rejection the storage and compute routes really send", async () => {
    // 2.171: Statt Annahmen ueber die Texte laeuft jeder Fehlercode durch die
    // echte Abbildung der Route. So fiel auf, dass gerade die Ablehnungen
    // englisch blieben, die ein Formular am ehesten bekommt: ein Bucket oder
    // Cron-Job mit vergebenem Namen ("... conflict").
    const storage: ProjectStorageErrorCode[] = [
      "PROJECT_STORAGE_DISABLED", "STORAGE_INVALID_INPUT", "STORAGE_RESOURCE_NOT_FOUND", "STORAGE_ACCESS_DENIED",
      "STORAGE_CONFLICT", "STORAGE_QUOTA_EXCEEDED", "STORAGE_INVALID_TOKEN", "STORAGE_OBJECT_NOT_READY",
      "STORAGE_OBJECT_INFECTED", "STORAGE_PROVIDER_UNAVAILABLE",
      // Nicht dabei: STORAGE_UPLOAD_NOT_FOUND, STORAGE_PART_ORDER und
      // STORAGE_PART_UNKNOWN. Sie gehoeren zum Multipart-Protokoll, das ein
      // Client fuehrt und nicht die Console; ihre Texte bleiben, wie sie sind.
    ];
    const untranslated: string[] = [];
    for (const code of storage) {
      const error = (await projectStorageRouteError(new ProjectStorageError(code)).json()).error as string;
      if (serverErrorText(error) === error) untranslated.push(`${code}: ${error}`);
    }
    for (const code of ["COMPUTE_INVALID_INPUT", "COMPUTE_NOT_FOUND", "COMPUTE_CONFLICT", "COMPUTE_PRECONDITION_FAILED", "COMPUTE_AT_CAPACITY", "COMPUTE_QUOTA_EXCEEDED"] as const) {
      const error = (await computeRouteError(new ComputeDefinitionError(code)).json()).error as string;
      if (serverErrorText(error) === error) untranslated.push(`${code}: ${error}`);
    }
    expect(untranslated).toEqual([]);
  });
});
