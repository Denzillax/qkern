import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV, NAV_ENTRIES, PLACEHOLDERS, REAL_VIEWS, groupOf, isPlaceholder, labelOf, type Placeholder } from "@/components/console/navigation";

/**
 * Die Console-Navigation (2.0) bildet das Routen-Verzeichnis von Supabase
 * Studio ab: `apps/studio/pages/project/[ref]` im Repo supabase/supabase,
 * gelesen am 24. September 2026. Jede dortige Gruppe hat hier einen Ort;
 * jeder Platzhalter sagt, wie die Seite bei Supabase heisst und was QKERN
 * im Backend schon hat. Der Vertrag haelt beides zusammen.
 */
const STUDIO_GROUPS: Record<string, string> = {
  // Verzeichnis in Studio -> Gruppe in QKERN (Label)
  advisors: "Advisors",
  api: "API",
  auth: "Auth",
  branches: "Branches",
  compute: "Functions & Jobs",
  database: "Datenbank",
  editor: "Table Editor",
  explorer: "AI Bridge",
  functions: "Functions & Jobs",
  integrations: "Integrationen",
  logs: "Logs",
  merge: "Branches",
  observability: "Berichte",
  realtime: "Realtime",
  settings: "Einstellungen",
  sql: "SQL Editor",
  storage: "Storage",
};

describe("console navigation contract", () => {
  it("has a QKERN group for every Supabase Studio route directory", () => {
    const labels = new Set(NAV.map((group) => group.label));
    for (const [directory, label] of Object.entries(STUDIO_GROUPS)) {
      expect(labels.has(label), `Studio-Verzeichnis ${directory} zeigt auf ${label}, das es nicht gibt`).toBe(true);
    }
  });

  it("places every real view and every placeholder exactly once", () => {
    const ids = NAV_ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of REAL_VIEWS) expect(ids, `echte Ansicht ${id} fehlt in der Navigation`).toContain(id);
    for (const id of Object.keys(PLACEHOLDERS)) expect(ids, `Platzhalter ${id} fehlt in der Navigation`).toContain(id);
  });

  it("gives every placeholder a Supabase name, a backend verdict and a real explanation", () => {
    // Seit 2.99 ist die Tabelle leer; die Pruefung bleibt fuer den naechsten Menuepunkt ohne Seite.
    for (const [id, entry] of Object.entries(PLACEHOLDERS as Record<string, Placeholder>)) {
      expect(entry.supabase, id).toMatch(/\S/);
      expect(["vorhanden", "teilweise", "fehlt"]).toContain(entry.backend);
      expect(entry.note.length, `${id}: Erklaerung zu kurz`).toBeGreaterThanOrEqual(40);
      expect(isPlaceholder(id as keyof typeof PLACEHOLDERS)).toBe(true);
    }
    expect(isPlaceholder("table")).toBe(false);
  });

  it("opens each group on its first child and labels views by group", () => {
    for (const group of NAV) {
      if (!group.children) continue;
      expect(group.children.length).toBeGreaterThan(0);
      expect(groupOf(group.children[0].id).id).toBe(group.id);
    }
    expect(labelOf("db-triggers")).toBe("Datenbank · Trigger");
    expect(labelOf("overview")).toBe("Übersicht");
    expect(labelOf("table")).toBe("Table Editor");
  });

  it("sends the documentation link to /docs, not to a landing anchor", async () => {
    const source = await readFile(path.resolve(process.cwd(), "components/console/console-app.tsx"), "utf8");
    expect(source).toContain('<Link href="/docs">');
    expect(source).not.toContain('href="/#developers"');
  });
});
