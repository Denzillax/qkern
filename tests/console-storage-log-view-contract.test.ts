import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import {
  STORAGE_LOG_DELETED_NOTE,
  STORAGE_LOG_HONESTY,
  STORAGE_LOG_NOT_SHOWN,
  STORAGE_LOG_STATUS_IDS,
  STORAGE_LOG_STATUS_TEXTS,
  storageLogTexts,
} from "@/lib/console/storage-log-texts";
import { USAGE_SERIES_VIEWS } from "@/lib/console/usage-series-texts";

/**
 * Der Stand der Speicherobjekte (2.51) liest nur. Die neue Route exportiert
 * nur GET, die Ansicht kennt keine signierte Adresse und keinen
 * Provider-Schluessel, sie sagt selbst, dass es kein Zugriffsprotokoll gibt,
 * und jeder Text spricht alle vier Sprachen: Deutsch als Schluessel, dazu
 * en, fr und it.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

const VIEW = "components/console/storage-log-view.tsx";
const TEXTS = "lib/console/storage-log-texts.ts";
const ROUTE = "app/api/v1/projects/[projectId]/environments/[environment]/storage/objects/route.ts";

describe("console storage log view contract", () => {
  it("makes both pages real and takes their placeholder claims off the navigation", async () => {
    for (const id of ["logs-storage", "obs-realtime"] as const) {
      expect(REAL_VIEWS).toContain(id);
      expect(isPlaceholder(id as never)).toBe(false);
      expect(id in PLACEHOLDERS).toBe(false);
    }
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "logs-storage": return <StorageLogView');
    expect(app).toContain('case "obs-realtime": return <UsageSeriesView key="obs-realtime" view="realtime"');
    // Die alten Versprechen stehen nirgends mehr: kein Zugriffsprotokoll je
    // Objekt und keine Verbindungskurve.
    const navigation = await source("components/console/navigation.ts");
    for (const claim of [
      "Uploads, Downloads und Scanner-Urteile je Objekt",
      "Verbindungen und Nachrichten über die Zeit.",
    ]) {
      expect(navigation, claim).not.toContain(claim);
    }
  });

  it("only reads, from the one object route and nowhere else", async () => {
    const view = await source(VIEW);
    expect(view).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
    expect(view).toContain("/storage/objects");
    for (const forbidden of ["downloads", "signedurl", "providerkey", "checksum", "x-amz", "deleteobject"]) {
      expect(view.toLowerCase(), forbidden).not.toContain(forbidden);
    }
    const route = await source(ROUTE);
    expect(route).not.toMatch(/export (?:const|function|async function) (?:POST|PUT|PATCH|DELETE)\b/);
    expect(route).toContain("adminProjectStorageContext");
    expect(route).toContain("projectStorageNoStore(");
    expect(await source("lib/server/project-storage/http.ts")).toContain('"Cache-Control": "private, no-store"');
    // Vier Parameter und kein fuenfter.
    expect(route).toContain('new Set(["bucket", "status", "cursor", "limit"])');
  });

  it("never lets a provider key or a checksum leave the repository row", async () => {
    const model = await source("lib/server/project-storage/model.ts");
    const entry = model.slice(model.indexOf("export function projectStorageLogEntry"));
    expect(entry).not.toContain("providerKey");
    expect(entry).not.toContain("checksumSha256");
    // Die Zeile eines entfernten Objekts bleibt lesbar, sonst faende sich nie
    // ein befallenes.
    expect(entry).toContain("deletedAt");
    const repository = await source("lib/server/project-storage/postgres-repository.ts");
    const log = repository.slice(repository.indexOf("  listObjectLog("), repository.indexOf("  countObjectLog("));
    expect(log).not.toContain("deleted_at IS NULL");
    expect(log).toContain("ORDER BY created_at DESC, id DESC");
    // Jeder Wert ist ein Parameter; eingesetzt wird nur die feste Spaltenliste.
    expect(log.replace("${OBJECT_SELECT}", "")).not.toMatch(/\$\{/);
  });

  it("says that there is no access log, what is missing and why a removed row stays", async () => {
    const view = await source(VIEW);
    expect(view).toContain("STORAGE_LOG_HONESTY");
    expect(view).toContain("STORAGE_LOG_NOT_SHOWN");
    expect(view).toContain("STORAGE_LOG_DELETED_NOTE");
    expect(STORAGE_LOG_HONESTY).toContain("kein Zugriffsprotokoll je Objekt");
    expect(STORAGE_LOG_NOT_SHOWN).toContain("Provider-Schlüssel");
    expect(STORAGE_LOG_DELETED_NOTE).toContain("Entfernte Objekte bleiben in der Liste");
    for (const text of [STORAGE_LOG_HONESTY, STORAGE_LOG_NOT_SHOWN, STORAGE_LOG_DELETED_NOTE]) {
      expect(text.length).toBeGreaterThanOrEqual(80);
    }
    // Die Spalten der Tabelle und beide Filter.
    for (const column of ["Bucket", "Schlüssel", "Grösse", "Typ", "Urteil", "Angelegt"]) {
      expect(view, column).toContain(`t("${column}")`);
    }
    expect(view).toContain('t("Alle Buckets")');
    expect(view).toContain('t("Jedes Urteil")');
    // Leerer Ausschnitt und leere Umgebung sind zwei verschiedene Auskuenfte.
    expect(view).toContain("In dieser Umgebung gibt es noch keinen Bucket.");
    expect(view).toContain("Zu diesem Ausschnitt liegt kein Objekt vor.");
    // Der Knopf springt beim Sprach- und Zustandswechsel nicht in der Breite.
    expect(view).toContain("StableLabel");
    expect(view).toContain('tAll("Lädt…", "Neu laden")');
    for (const state of ["loading", "ready", "disabled", "unavailable", "error"]) {
      expect(view, state).toContain(`"${state}"`);
    }
    // Jedes Urteil sagt, was es bedeutet.
    for (const id of STORAGE_LOG_STATUS_IDS) {
      expect(STORAGE_LOG_STATUS_TEXTS[id].meaning.length, id).toBeGreaterThanOrEqual(60);
    }
    // Die Realtime-Seite sagt, dass sie Nachrichten zaehlt und keine Verbindungen.
    expect(USAGE_SERIES_VIEWS.realtime.metrics).toEqual(["realtime_messages"]);
    expect(USAGE_SERIES_VIEWS.realtime.cannotShow).toContain("Verbindungen");
  });

  it("keeps its texts in one module and translates every one into en, fr and it", async () => {
    const texts = await source(TEXTS);
    expect(texts).not.toContain("react");
    expect(texts).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = storageLogTexts().filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
    const keys = [...(await source(VIEW)).matchAll(/(?<![A-Za-z0-9_])t\(("(?:[^"\\]|\\.)*")\)/g)]
      .map((match) => JSON.parse(match[1]) as string);
    expect(keys.length).toBeGreaterThan(20);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = keys.filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
  });
});
