import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { sameUntouchedFields } from "@/components/console/storage-policies-view";

/**
 * Zwei Arten, mit einer Antwort falsch umzugehen (2.148).
 *
 * **Der verlorene Schreibvorgang.** `PATCH` auf einen Bucket ist ein
 * Vollersatz: Das Schema der Route verlangt jedes Feld, auch die vier, die die
 * Policy-Seite gar nicht bearbeitet. Geschickt wurden sie so, wie sie beim
 * Laden aussahen. Wer die Groessengrenze in den Storage-Einstellungen aendert,
 * waehrend diese Seite offen steht, verliert seine Aenderung, sobald hier
 * jemand auf Speichern drueckt, und beide Schritte melden Erfolg. Seit diesem
 * Schnitt wird vor dem Schreiben erneut gelesen und bei Abweichung nichts
 * geschrieben.
 *
 * **Die ueberholte Antwort.** Wer in einer Liste schnell weiterklickt, loest
 * zwei Anfragen aus, und es gewinnt, was zuerst zurueck ist. Jede Ansicht mit
 * einer Liste, die auf eine Wahl hin nachlaedt, braucht darum einen
 * `AbortController`. Die Aufrufliste war die letzte ohne.
 *
 * **Was der Vertrag nicht kann.** Er stellt keine zwei gleichzeitigen
 * Anfragen. Er prueft die Vergleichsfunktion mit echten Werten und am
 * Quelltext, dass der zweite Weg ueberhaupt da ist.
 */
const VIEWS = path.resolve(process.cwd(), "components/console");

const BUCKET = {
  id: "b1", name: "uploads", readPolicy: "private", writePolicy: "private",
  allowedMimeTypes: ["image/png", "image/jpeg"],
  maxObjectBytes: 5_000_000, quotaBytes: 50_000_000, retentionDays: 30,
} as never;

describe("console concurrency contract", () => {
  it("sees a changed field that this view does not edit", () => {
    expect(sameUntouchedFields(BUCKET, { ...(BUCKET as object) } as never)).toBe(true);
    // Jedes der vier Felder einzeln: Faende eines davon keine Beachtung, ginge
    // genau dort die fremde Aenderung verloren.
    expect(sameUntouchedFields(BUCKET, { ...(BUCKET as object), maxObjectBytes: 9 } as never)).toBe(false);
    expect(sameUntouchedFields(BUCKET, { ...(BUCKET as object), quotaBytes: 9 } as never)).toBe(false);
    expect(sameUntouchedFields(BUCKET, { ...(BUCKET as object), retentionDays: null } as never)).toBe(false);
    expect(sameUntouchedFields(BUCKET, { ...(BUCKET as object), allowedMimeTypes: ["image/png"] } as never)).toBe(false);
    // Auch die Reihenfolge zaehlt, denn die Route schreibt die Liste so, wie
    // sie ankommt.
    expect(sameUntouchedFields(BUCKET, { ...(BUCKET as object), allowedMimeTypes: ["image/jpeg", "image/png"] } as never)).toBe(false);
  });

  it("reads the bucket again before it writes, and writes nothing on a conflict", async () => {
    const source = await readFile(path.join(VIEWS, "storage-policies-view.tsx"), "utf8");
    const save = source.slice(source.indexOf("async function save("), source.indexOf("if (state === \"loading\")"));
    expect(save, "die Seite liest vor dem Schreiben nicht erneut").toContain("sameUntouchedFields");
    // Der Abbruch steht vor dem PATCH: Nach einem Konflikt darf keine Zeile
    // mehr geschrieben werden.
    expect(save.indexOf("sameUntouchedFields")).toBeLessThan(save.indexOf('method: "PATCH"'));
    expect(save).toMatch(/await load\(\);\s*\n\s*return;/);
  });

  it("gives every list that reloads on a choice an abort controller", async () => {
    // Die Ansichten, die auf eine Wahl hin nachladen. Steht hier eine neue
    // Ansicht ohne Abbruch, faellt dieser Fall, und das ist der Zweck: Die
    // Aufrufliste hatte den Abbruch als einzige nicht.
    const files = ["invocations-view.tsx", "function-log-view.tsx", "auth-log-view.tsx"];
    for (const file of files) {
      const source = await readFile(path.join(VIEWS, file), "utf8");
      // Drei Teile, und alle drei muessen da sein. Die erste Fassung dieses
      // Falls suchte nur das Wort `AbortController`, und die Mutationsprobe
      // ueberlebte: Ein Nachbau, der nie abbricht, traegt das Wort auch.
      expect(source, `${file} baut keinen Abbrecher`).toMatch(/new AbortController\(\)/);
      // Der Abbruch der **vorherigen** Anfrage, nicht nur der beim Verlassen
      // der Seite. Die erste Fassung suchte irgendein `.abort()` und ueberlebte
      // die Mutation, weil der Aufraeumer beim Abbau auch eines traegt. Jetzt
      // muss ein Abbruch vor dem Bau eines neuen Abbrechers stehen.
      const loader = source.indexOf("useCallback(async");
      const built = source.indexOf("new AbortController()");
      const abortedBefore = source.slice(0, built).lastIndexOf(".abort()");
      expect(loader, `${file} hat keinen Lader`).toBeGreaterThan(-1);
      // Der Abbruch muss **im Lader** stehen, zwischen seinem Beginn und dem
      // Bau des neuen Abbrechers. Die zweite Fassung dieses Falls verlangte nur
      // irgendeinen Abbruch davor, und der Aufraeumer beim Abbau steht weiter
      // oben in der Datei; die Mutationsprobe ueberlebte deshalb ein zweites
      // Mal.
      expect(abortedBefore, `${file} bricht die laufende Anfrage nicht ab, bevor es eine neue stellt`)
        .toBeGreaterThan(loader);
      // Und jede Anfrage traegt das Signal. Geprueft wird der Aufruf bis zu
      // seiner schliessenden Klammer: Ein Fenster fester Laenge nahm das
      // `signal` aus der naechsten Zeile mit, und die Mutationsprobe ueberlebte.
      for (const call of source.matchAll(/fetch\(/g)) {
        const from = call.index ?? 0;
        const end = source.indexOf(");", from);
        const statement = source.slice(from, end < 0 ? from + 240 : end);
        expect(statement, `${file}: eine Anfrage ohne Signal`).toContain("signal");
      }
    }
  });

  it("leaves no German sentence outside the translator in these views", async () => {
    // Zwei Stellen trugen deutschen Text direkt im Code, also stand er auch in
    // der englischen, franzoesischen und italienischen Console.
    for (const file of ["table-view.tsx", "live-api-view.tsx"]) {
      const source = await readFile(path.join(VIEWS, file), "utf8");
      expect(source, `${file}: Zeilenzaehler ohne Uebersetzung`).not.toMatch(/\}\s*Zeilen geladen/);
      expect(source, `${file}: Eingabeaufforderung ohne Uebersetzung`).not.toMatch(/window\.prompt\(`/);
    }
  });

  it("finds the views it means to check", async () => {
    const files = await readdir(VIEWS);
    for (const file of ["storage-policies-view.tsx", "invocations-view.tsx", "table-view.tsx", "live-api-view.tsx"]) {
      expect(files, file).toContain(file);
    }
  });
});
