import { describe, expect, it } from "vitest";

import {
  CERTIFICATION_CLAIMS,
  readArchivedManifests,
} from "@/lib/server/evidence/certification-summary";

/**
 * Eine erfundene Stack-Beschriftung faellt laut, statt die Seite zu verfehlen.
 *
 * **Der Befund, der dahinter steht.** Die Beschriftung eines Laufs kommt vom
 * Aufrufer von `scripts/certification-manifest.mjs` und nicht vom Laeufer. Wer
 * eine Kette schreibt, tippt sie also frei hin. `CERTIFICATION_CLAIMS` sucht
 * dagegen **exakte** Zeichenketten, und eine, die nicht in der Liste steht,
 * faellt still durch: Das Manifest liegt im Archiv, der Lauf war gruen, und die
 * Startseite zeigt weiter die Zahl eines aelteren Laufs mit der kanonischen
 * Beschriftung. Nichts wird rot.
 *
 * Genau das ist in der Kette zu `2.73.0` passiert, gleich viermal: Functions,
 * Vault, der HTTPS-Empfaenger und Backup liefen unter neuen Beschriftungen, und
 * keiner der vier fuetterte die Seite. Dabei fiel auch auf, dass
 * **Realtime unter Production in `CERTIFICATION_CLAIMS` ueberhaupt fehlte**,
 * obwohl der Stack seit Releases laeuft und in `STATUS.md` steht. Die Seite
 * nannte sieben Pruefstaende, es sind acht.
 *
 * **Was dieser Vertrag haelt.** Jede Beschriftung im **neuesten** Evidenzordner
 * muss einem Anspruch zugeordnet sein, oder eine der beiden erklaerten
 * Ausnahmen: eine Mutationsprobe (die soll rot sein und gehoert in keine Zeile)
 * und der lokale Vitest-Lauf (kein echter Dienst).
 *
 * **Warum nur der neueste Ordner.** Das Archiv reicht bis August zurueck und
 * traegt Beschriftungen aus der Zeit, als es die Liste noch nicht gab. Die
 * aufzuraeumen hiesse, archivierte Evidenz zu aendern, und die wird nicht
 * geaendert. Geprueft wird darum, was zuletzt geschrieben wurde; da sitzt der
 * Fehler, den dieser Vertrag fangen soll.
 */
const KNOWN = new Set(CERTIFICATION_CLAIMS.flatMap((claim) => claim.stacks));
const EXEMPT = [
  { test: (stack: string) => /^Mutation /.test(stack), why: "Mutationsprobe, absichtlich rot" },
  { test: (stack: string) => stack === "Vitest lokal (Windows)", why: "lokale Suite, kein echter Dienst" },
];

describe("evidence stack label contract", () => {
  it("keeps every label of the newest evidence day attached to a claim", async () => {
    const manifests = await readArchivedManifests();
    expect(manifests.length).toBeGreaterThan(700);

    const newest = manifests.map((entry) => entry.date).sort().at(-1)!;
    const ofDay = manifests.filter((entry) => entry.date === newest);
    expect(ofDay.length).toBeGreaterThan(0);

    const unknown = [...new Set(ofDay
      .filter((entry) => !KNOWN.has(entry.stack) && !EXEMPT.some((rule) => rule.test(entry.stack)))
      .map((entry) => entry.stack))].sort();

    expect(unknown, `Beschriftungen aus ${newest}, die keine Zeile der Startseite fuettern`).toEqual([]);
  }, 20_000);

  it("names a stack for every claim and lets no two claims share one", () => {
    const all = CERTIFICATION_CLAIMS.flatMap((claim) => claim.stacks);
    expect(all.length).toBe(new Set(all).size);
    for (const claim of CERTIFICATION_CLAIMS) {
      expect(claim.stacks.length, `${claim.name} ohne Beschriftung`).toBeGreaterThan(0);
    }
  });

  it("covers the realtime production stack", () => {
    // Namentlich, weil er bis 2.73.0 fehlte und der Fehler von allein
    // zurueckkommt: Wer eine Zeile loescht, soll hier stolpern.
    expect(KNOWN.has("Realtime unter Production gegen TLS-PostgreSQL")).toBe(true);
  });
});
