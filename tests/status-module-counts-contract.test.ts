import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Die „Real-DB-Fälle" je Modul müssen den Testdateien entsprechen.
 *
 * Release 1.39 hat die Zertifizierungszahlen an die archivierten Manifeste
 * gebunden und dabei ausdrücklich offen gelassen, dass die Zahlen der
 * Fortschrittstabelle weiter ungeprüft bleiben. Beim Nachzählen war genau eine
 * davon falsch — und zwar die einzige, die niemand rekonstruieren konnte.
 *
 * Gezählt wird der Quelltext, nicht ein Lauf. Das ist die schwächere Aussage
 * und die richtige an dieser Stelle: Behauptet wird ja die **Anzahl der Fälle**,
 * nicht ihr Ergebnis. Ob sie bestehen, sagt der Zertifizierungsvertrag aus
 * Release 1.39.
 */

const MODULES: ReadonlyArray<{ label: string; files: readonly string[] }> = [
  {
    label: "Control Plane, Approval/Audit, Migration Runtime",
    files: ["postgres", "postgres-incident-recovery", "migration-process-postgres"],
  },
  { label: "Generated Data API", files: ["generated-data-postgres"] },
  { label: "Object Storage", files: ["project-storage-postgres"] },
  { label: "Project Queues", files: ["project-queues-postgres"] },
  {
    label: "Usage Metering",
    files: ["usage-metering-postgres", "usage-emitters-postgres"],
  },
  {
    label: "Compute Contracts",
    files: [
      "compute-cron-postgres", "compute-webhook-postgres", "compute-webhook-chain",
      "compute-definitions-postgres", "compute-functions-postgres",
    ],
  },
];

async function cases(name: string): Promise<number> {
  const source = await readFile(
    path.resolve(process.cwd(), `tests/${name}.integration.test.ts`), "utf8",
  );
  // Nur ausgeführte Fälle. `it.skip` zählt nicht mit; ein übersprungener Fall
  // ist keine Zusage.
  return source.split(/\r?\n/).filter((line) => /^\s*it\(/.test(line)).length;
}

describe("status module counts contract", () => {
  it("counts as many real-database cases as the files contain", async () => {
    const status = await readFile(path.resolve(process.cwd(), "STATUS.md"), "utf8");

    for (const module of MODULES) {
      const line = status.split(/\r?\n/).find((entry) => entry.startsWith(`| ${module.label} |`));
      expect(line, `STATUS.md hat keine Zeile fuer ${module.label}`).toBeDefined();
      const claimed = /(\d+) Real-DB-Fälle/.exec(line ?? "");
      expect(claimed, `${module.label} nennt keine Zahl an Real-DB-Faellen`).not.toBeNull();

      const counted = (await Promise.all(module.files.map(cases)))
        .reduce((sum, value) => sum + value, 0);
      expect(`${module.label}: ${claimed![1]}`).toBe(`${module.label}: ${counted}`);
    }
  });
});
