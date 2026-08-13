import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Keine Testdatei erteilt dauerhaft eine clusterweite Rolle.
 *
 * Release 1.49 hat einen ganzen Zertifizierungslauf verloren, weil drei
 * Realtime-Testdateien `GRANT qkern_ledger_owner TO CURRENT_USER` ausfuehrten,
 * damit ihr eigenes DDL im Namen des Eigentuemers durchgeht. Rollen sind
 * **clusterweit**, und die Grenzpruefung des Migrationszaunes verlangt einen
 * Ledger-Eigentuemer ohne jede Mitgliedschaft.
 *
 * Damit war in jedem Lauf, in dem eine dieser Dateien mitlief, jede Migration
 * unmoeglich — nicht nur im Migrationstest. Aufgefallen ist es erst, als zum
 * ersten Mal jemand migrieren wollte, also nach vielen gruenen Laeufen.
 *
 * Dieser Test prueft den **Quelltext**, nicht den Cluster. Das ist die
 * schwaechere Aussage und die, die frueh genug kommt: beim Schreiben statt nach
 * dem Lauf. Ein Grant, den eine Datei sofort wieder zuruecknimmt, ist erlaubt —
 * er steht dann samt `REVOKE` in derselben Datei.
 */

const ROOT = process.cwd();
const TESTS = path.join(ROOT, "tests");

/**
 * Rollen, die im Cluster geteilt werden und deren Mitgliedschaften das Produkt
 * pruet. Wer hier eine ergaenzt, schuetzt eine weitere Grenze.
 */
const SHARED_ROLES = ["qkern_ledger_owner", "qkern_project_migrator"] as const;

/**
 * Kommentare zaehlen nicht.
 *
 * Ohne diesen Schritt meldet der Vertrag jede Datei, die den Fund von 1.49
 * **beschreibt** — und die Beschreibung ist genau das, was bleiben soll.
 */
function code(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/** `GRANT <rolle> TO …` — die Rollenzuteilung, nicht ein Objektrecht. */
function grantsRole(source: string, role: string) {
  return new RegExp(`GRANT\\s+${role}\\s+TO\\s`, "i").test(source);
}

function revokesRole(source: string, role: string) {
  return new RegExp(`REVOKE\\s+(${role}|%I)\\s+FROM\\s`, "i").test(source)
    || new RegExp(`REVOKE\\s+${role}\\s+FROM\\s`, "i").test(source);
}

function testFiles(): string[] {
  return readdirSync(TESTS).filter((entry) => entry.endsWith(".ts"));
}

describe("shared cluster role contract", () => {
  it("has test files to check", () => {
    expect(testFiles().length).toBeGreaterThan(100);
  });

  it.each(SHARED_ROLES)("never grants %s without taking it back", (role) => {
    const offenders = testFiles()
      .filter((file) => {
        const source = code(readFileSync(path.join(TESTS, file), "utf8"));
        return grantsRole(source, role) && !revokesRole(source, role);
      })
      .sort();

    expect(offenders, [
      `Diese Dateien erteilen ${role} dauerhaft. Die Rolle ist clusterweit:`,
      "Was hier gesetzt wird, gilt fuer jede parallel laufende Datei — und der",
      "Migrationszaun verlangt einen Ledger-Eigentuemer ohne jede Mitgliedschaft.",
    ].join(" ")).toEqual([]);
  });
});
