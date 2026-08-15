import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Jede behauptete Zertifizierungszahl muss durch ein archiviertes Manifest
 * gedeckt sein.
 *
 * `STATUS.md` nennt sich selbst „Teil der Definition of Done", und der
 * bestehende Doku-Vertrag prüft dort Zeichenketten und abgeleitete Dateinamen —
 * aber **keine Zahl**. Die Zeile mit den lokalen Vitest-Zahlen stand deshalb
 * über ein Dutzend Releases hinweg auf einem überholten Stand, ohne dass etwas
 * anschlug. Ein Statusdokument, dessen Zahlen niemand prüft, ist genau die Art
 * Behauptung, gegen die dieses Projekt seine Mutationsproben fährt.
 *
 * Geprüft wird gegen das **Maximum der grünen Läufe** eines Stacks. Die Suiten
 * wachsen; das Maximum ist damit der jüngste Stand. Schrumpft eine Suite
 * einmal wirklich, verlangt der Vertrag eine bewusste Bearbeitung — und das ist
 * richtig so.
 */

type Manifest = { stack: string; passed: number; failed: number; exitCode: number };

/** Die frühen Manifeste tragen Slugs, die späteren freien Text. Beides zählt. */
const CLAIMS: ReadonlyArray<{ label: string; stacks: readonly string[] }> = [
  { label: "PostgreSQL-17-Zertifizierung", stacks: ["PostgreSQL 17", "postgres-17"] },
  { label: "MinIO-/ClamAV-Zertifizierung", stacks: ["MinIO und ClamAV", "minio-clamav"] },
  { label: "Project-Auth-Provider-Zertifizierung", stacks: ["Mailpit und Dex", "project-auth-provider"] },
  {
    label: "Functions gegen Docker plus PostgreSQL",
    stacks: ["Docker 29.5, registry:2 und PostgreSQL 17", "docker-function-egress-guard"],
  },
  {
    label: "Webhook-Signatur gegen echten Vault",
    stacks: ["HashiCorp Vault 1.18", "vault-1.18-webhook-signing"],
  },
  {
    label: "Ausgehender Weg gegen echten HTTPS-Empfänger",
    stacks: ["Node 24 HTTPS-Empfaenger und PostgreSQL 17"],
  },
];

async function manifests(): Promise<Manifest[]> {
  const root = path.resolve(process.cwd(), "docs/evidence");
  const found: Manifest[] = [];
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.name.endsWith(".manifest.json")) {
        found.push(JSON.parse(await readFile(target, "utf8")) as Manifest);
      }
    }
  };
  await walk(root);
  return found;
}

describe("status numbers contract", () => {
  it("backs every certification claim with a green archived run", async () => {
    const status = await readFile(path.resolve(process.cwd(), "STATUS.md"), "utf8");
    const archived = await manifests();

    for (const claim of CLAIMS) {
      // Zeilenweise statt mit einem zusammengebauten Ausdruck: Ein Regex, den
      // erst eine Vorlage erzeugt, ist selbst eine Fehlerquelle — genau daran
      // ist der erste Entwurf dieses Tests gescheitert.
      const line = status.split(/\r?\n/).find((entry) => entry.includes(claim.label));
      expect(line, `STATUS.md nennt keine Zeile fuer ${claim.label}`).toBeDefined();
      const row = /(\d+) von (\d+) bestanden/.exec(line ?? "");
      expect(row, `STATUS.md nennt keine Zahl fuer ${claim.label}`).not.toBeNull();
      const [, passed, total] = row!;
      // "X von Y" mit X ungleich Y waere ein roter Lauf, als gruen ausgegeben.
      expect(`${claim.label}: ${passed}/${total}`).toBe(`${claim.label}: ${passed}/${passed}`);

      const green = archived.filter((entry) =>
        claim.stacks.includes(entry.stack) && entry.failed === 0 && entry.exitCode === 0);
      expect(green.length, `kein gruenes Manifest fuer ${claim.label}`).toBeGreaterThan(0);
      const best = Math.max(...green.map((entry) => entry.passed));
      expect(`${claim.label}: ${passed}`).toBe(`${claim.label}: ${best}`);
    }
    // Explizites Budget statt der 5-Sekunden-Voreinstellung: Der Vertrag
    // liest inzwischen jedes archivierte Manifest, und unter I/O-Last eines
    // vollen Suitenlaufs riss die Voreinstellung — als transienter Einzelfall
    // in 1.83 zuerst unerklaert, in 1.84 mit diesem Timeout als Ursache
    // identifiziert. Dieselbe Regel wie bei den Webhook-Faellen aus 1.63:
    // Budgets werden ausgesprochen, Aussagen nicht abgeschwaecht.
  }, 30_000);

  it("makes no numeric claim that no manifest could back", async () => {
    // Die lokale Vitest-Zeile trug bis Release 1.38 absolute Zahlen, die kein
    // Lauf belegt. Eine Zahl, die niemand prueft, ist schlechter als keine.
    const status = await readFile(path.resolve(process.cwd(), "STATUS.md"), "utf8");
    const vitest = /\| Vitest \(Windows\) \|([^|]*)\|/.exec(status);
    expect(vitest).not.toBeNull();
    expect(vitest![1]).not.toMatch(/\d+ bestanden/);
  });
});
