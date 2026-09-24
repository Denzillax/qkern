import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readArchivedManifests, summarizeCertification } from "@/lib/server/evidence/certification-summary";

/**
 * Die Landingpage darf keine Zahl behaupten, die kein Manifest belegt.
 *
 * Bis 1.90 trug `app/page.tsx` Konstanten vom 6. August 2026 — 85 von 85, wo
 * laengst 160 standen. `STATUS.md` war seit 1.39 an die Manifeste gebunden,
 * die Seite fuer Kunden nicht. Zwei Pruefungen: Die Quelle enthaelt keinen
 * literalen Zaehlwert und kein literales Datum, und die Zusammenfassung, die
 * die Seite rendert, nennt fuer jeden Stack dieselbe Zahl wie `STATUS.md`.
 */
describe("landing numbers contract", () => {
  it("keeps every count and date out of the page source", async () => {
    const source = await readFile(path.resolve(process.cwd(), "app/page.tsx"), "utf8");
    expect(source).not.toMatch(/"\d+ von \d+"/);
    expect(source).not.toMatch(/\d{1,2}\. (Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember) 20\d\d<\//);
    expect(source).toContain("loadCertificationSummary");
  });

  it("renders the same certification numbers STATUS.md claims", async () => {
    const summary = summarizeCertification(await readArchivedManifests());
    const status = await readFile(path.resolve(process.cwd(), "STATUS.md"), "utf8");
    const claims: Record<string, string> = {
      "Control Plane und Data API": "PostgreSQL-17-Zertifizierung",
      "Object Storage": "MinIO-/ClamAV-Zertifizierung",
      "Project Auth": "Project-Auth-Provider-Zertifizierung",
      "Functions": "Functions gegen Docker plus PostgreSQL",
      "Webhook-Signatur": "Webhook-Signatur gegen echten Vault",
      "Ausgehender Weg": "Ausgehender Weg gegen echten HTTPS-Empfänger",
    };
    expect(summary.rows.map((row) => row.name)).toEqual(Object.keys(claims));
    for (const row of summary.rows) {
      const line = status.split(/\r?\n/).find((entry) => entry.includes(`| **${claims[row.name]}** |`));
      const match = /\*\*(\d+) von (\d+) bestanden/.exec(line ?? "");
      expect(match, `STATUS.md nennt keine Zahl fuer ${claims[row.name]}`).not.toBeNull();
      expect(`${row.name}: ${row.passed}`).toBe(`${row.name}: ${match![1]}`);
    }
    expect(summary.mutationRuns).toBeGreaterThan(0);
    // Explizites Budget wie bei den anderen Quellscan-Vertraegen (1.84): Der
    // Vertrag liest jedes archivierte Manifest, und unter der I/O-Last eines
    // vollen Suitenlaufs riss die 5-Sekunden-Voreinstellung.
  }, 30_000);
});
