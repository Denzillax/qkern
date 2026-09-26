import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import {
  CRON_MESSAGE_STATES, CRON_MESSAGE_STATE_TEXTS,
  CRON_OCCURRENCE_STATUSES, CRON_OCCURRENCE_STATUS_TEXTS,
} from "@/lib/console/cron-log-texts";

/**
 * Das Cron-Log (2.42) liest nur. Die Ansicht schreibt nicht, die neue Route
 * exportiert nur GET, die Nutzlast erscheint nirgends, und jeder Text spricht
 * alle vier Sprachen: Deutsch als Schluessel, dazu en, fr und it.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

const VIEW = "components/console/cron-log-view.tsx";
const ROUTE =
  "app/api/v1/projects/[projectId]/environments/[environment]/compute/cron/[cronId]/occurrences/route.ts";

describe("console cron log view contract", () => {
  it("is a real view and no longer a placeholder", async () => {
    expect(REAL_VIEWS).toContain("logs-cron");
    expect(isPlaceholder("logs-cron" as never)).toBe(false);
    expect("logs-cron" in PLACEHOLDERS).toBe(false);
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "logs-cron": return <CronLogView');
  });

  it("only reads, from the two cron routes and nowhere else", async () => {
    const view = await source(VIEW);
    expect(view).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
    // Kein Ausloesen von Hand, kein Wiederholen, kein Pausieren.
    for (const word of ["dispatch(", "replay", "enqueue("]) {
      expect(view.toLowerCase(), word).not.toContain(word);
    }
    expect(view).toContain("/occurrences`");
    const route = await source(ROUTE);
    expect(route).not.toMatch(/export (?:const|function|async function) (?:POST|PUT|PATCH|DELETE)\b/);
    // Der Header kommt aus derselben Naht wie bei jeder Definitionsroute.
    expect(route).toContain("computeNoStore(");
    expect(await source("lib/server/compute/definitions-http.ts"))
      .toContain('"Cache-Control": "private, no-store"');
    // Jeder Query-Parameter ist ein 400: Das Fenster steht im Dienst.
    expect(route).toContain("searchParams.keys()");
  });

  it("carries no payload, no dedupe key and no message id, in view, route or service", async () => {
    // Im Datenmodell der Ansicht gibt es kein Nutzlastfeld. `payload` als Name
    // des JSON-Rumpfs einer Antwort ist etwas anderes und bleibt erlaubt.
    const view = await source(VIEW);
    expect(view).not.toMatch(/(?:occurrence|message|log|current)\.payload/);
    expect(view).not.toMatch(/payload\s*[:?]\s*(?:ProjectQueueJson|unknown\[\]|Cron)/);
    for (const file of [VIEW, ROUTE]) {
      expect(await source(file), file).not.toMatch(/dedupeKey|dedupe_key/);
    }
    expect(await source(ROUTE)).not.toMatch(/\bpayload\b/);
    // Der Dienst bildet den Verifikator, gibt ihn aber nicht heraus.
    const occurrences = await source("lib/server/compute/cron-occurrences.ts");
    const record = occurrences.slice(
      occurrences.indexOf("export type CronOccurrenceMessage ="),
      occurrences.indexOf("export type CronOccurrenceLog ="),
    );
    for (const field of ["payload", "dedupeKey", "messageId", "ownerSubject", "leaseToken"]) {
      expect(record, field).not.toContain(field);
    }
  });

  it("says how the log is made, what window it shows and what it leaves out", async () => {
    const view = await source(VIEW);
    expect(view).toContain("Das Log wird aus den erwarteten Vorkommen und den Nachrichten der Queue zusammengesetzt. Was der Container ausgegeben hat, steht nicht hier.");
    expect(view).toContain("Gezeigt werden die letzten 24 Stunden und die nächste Stunde, höchstens 50 Vorkommen, neueste zuerst.");
    expect(view).toContain("Kein Vorkommen im Fenster");
    expect(view).toContain("Keine Cron-Definitionen in dieser Umgebung.");
    expect(view).toContain("Was die Zustände bedeuten");
    expect(view).toContain("StableLabel");
    // Zustaende der Ansicht: laden, fertig, Fläche aus, Fehler.
    for (const state of ["loading", "ready", "unavailable", "error"]) {
      expect(view, state).toContain(`"${state}"`);
    }
    // Zeit, Zustand, Versuche und Einreihung stehen in der Tabelle.
    for (const column of ["Zeit", "Zustand", "Versuche", "Eingereiht"]) {
      expect(view, column).toContain(`t("${column}")`);
    }
  });

  it("translates every status, every message state and every text into en, fr and it", async () => {
    for (const status of CRON_OCCURRENCE_STATUSES) {
      const text = CRON_OCCURRENCE_STATUS_TEXTS[status];
      for (const german of [text.label, text.explains]) {
        expect(german, status).toMatch(/\S/);
        for (const locale of ["en", "fr", "it"] as const) {
          expect(CONSOLE_TRANSLATIONS[locale][german], `${locale}: ${status}`).toMatch(/\S/);
        }
      }
    }
    for (const state of CRON_MESSAGE_STATES) {
      for (const locale of ["en", "fr", "it"] as const) {
        expect(CONSOLE_TRANSLATIONS[locale][CRON_MESSAGE_STATE_TEXTS[state]], `${locale}: ${state}`)
          .toMatch(/\S/);
      }
    }
    const view = await source(VIEW);
    const keys = [...view.matchAll(/(?<![A-Za-z0-9_])t\(("(?:[^"\\]|\\.)*")\)/g)]
      .map((match) => JSON.parse(match[1]) as string);
    expect(keys.length).toBeGreaterThan(20);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = keys.filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
  });
});
