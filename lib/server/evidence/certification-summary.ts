import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Die Zahlen der Landingpage — aus den archivierten Manifesten, nicht aus
 * Konstanten.
 *
 * Bis 1.90 trug `app/page.tsx` hartkodierte Zaehlwerte vom 6. August 2026,
 * waehrend `STATUS.md` laengst durch einen Vertrag an die Manifeste gebunden
 * war. Dieselbe Regel gilt jetzt fuer die Seite, die Kunden sehen: Je Stack
 * zaehlt der **beste gruene Lauf** (dieselbe Messvorschrift wie im
 * Zahlen-Vertrag), das Datum ist das des juengsten gruenen Laufs, und die
 * Gegenproben sind die archivierten Mutationslaeufe — rot mit Absicht.
 */
export type ArchivedManifest = {
  stack: string;
  passed: number;
  failed: number;
  exitCode: number;
  /** Aus dem Verzeichnisnamen `docs/evidence/YYYY-MM-DD/`. */
  date: string;
  file: string;
};

export type CertificationRow = {
  name: string;
  stack: string;
  passed: number;
  date: string;
};

export type CertificationSummary = {
  rows: CertificationRow[];
  /** Archivierte Mutationslaeufe: absichtlich rot, jeder genau dort, wo er soll. */
  mutationRuns: number;
  /** Alle archivierten Manifeste — gruen wie rot. Das ist die Zahl der Laeufe, nicht der Faelle. */
  archivedRuns: number;
  latestDate: string | null;
};

/** Dieselbe Zuordnung wie `tests/status-numbers-contract.test.ts`. */
export const CERTIFICATION_CLAIMS: ReadonlyArray<{ name: string; stacks: readonly string[]; label: string }> = [
  { name: "Control Plane und Data API", label: "PostgreSQL 17", stacks: ["PostgreSQL 17", "postgres-17"] },
  { name: "Object Storage", label: "versitygw und ClamAV", stacks: ["versitygw und ClamAV", "MinIO und ClamAV", "minio-clamav"] },
  { name: "Project Auth", label: "Mailpit und Dex über TLS", stacks: ["Mailpit und Dex", "project-auth-provider"] },
  { name: "Functions", label: "Docker, Registry und PostgreSQL 17",
    stacks: ["Docker 29.5, registry:2 und PostgreSQL 17", "docker-function-egress-guard"] },
  { name: "Webhook-Signatur", label: "HashiCorp Vault 1.18", stacks: ["HashiCorp Vault 1.18", "vault-1.18-webhook-signing"] },
  { name: "Ausgehender Weg", label: "Echter HTTPS-Empfänger", stacks: ["Node 24 HTTPS-Empfaenger und PostgreSQL 17"] },
];

export function summarizeCertification(manifests: readonly ArchivedManifest[]): CertificationSummary {
  const rows: CertificationRow[] = [];
  for (const claim of CERTIFICATION_CLAIMS) {
    const green = manifests.filter((entry) =>
      claim.stacks.includes(entry.stack) && entry.failed === 0 && entry.exitCode === 0);
    if (green.length === 0) continue;
    const best = Math.max(...green.map((entry) => entry.passed));
    const date = green.map((entry) => entry.date).sort().at(-1)!;
    rows.push({ name: claim.name, stack: claim.label, passed: best, date });
  }
  const mutationRuns = manifests.filter((entry) =>
    /mutation/.test(entry.file) && entry.failed > 0 && entry.exitCode !== 0).length;
  const latestDate = rows.map((row) => row.date).sort().at(-1) ?? null;
  return { rows, mutationRuns, archivedRuns: manifests.length, latestDate };
}

export async function readArchivedManifests(root = path.resolve(process.cwd(), "docs/evidence")): Promise<ArchivedManifest[]> {
  const found: ArchivedManifest[] = [];
  for (const day of await readdir(root, { withFileTypes: true })) {
    if (!day.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(day.name)) continue;
    const directory = path.join(root, day.name);
    for (const entry of await readdir(directory)) {
      if (!entry.endsWith(".manifest.json")) continue;
      const parsed = JSON.parse(await readFile(path.join(directory, entry), "utf8")) as Partial<ArchivedManifest>;
      if (typeof parsed.stack !== "string" || typeof parsed.passed !== "number" ||
          typeof parsed.failed !== "number" || typeof parsed.exitCode !== "number") continue;
      found.push({ stack: parsed.stack, passed: parsed.passed, failed: parsed.failed,
        exitCode: parsed.exitCode, date: day.name, file: entry });
    }
  }
  return found;
}

export async function loadCertificationSummary(): Promise<CertificationSummary> {
  return summarizeCertification(await readArchivedManifests());
}

/** `2026-09-24` → `24. September 2026` — die Schreibweise, die die Seite schon hatte. */
export function formatEvidenceDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const months = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August",
    "September", "Oktober", "November", "Dezember"];
  return `${day}. ${months[(month ?? 1) - 1]} ${year}`;
}
