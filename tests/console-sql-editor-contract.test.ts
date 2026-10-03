import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setConsoleLocale } from "@/components/console/console-i18n";
import { SqlView } from "@/components/console/sql-view";
import { classifySqlRisk } from "@/lib/security";
import { changeSetFailureCode, readSqlRun, sqlRunFailureCode } from "@/lib/console/sql-run-report";

/**
 * Der SQL-Editor und seine drei Bereiche (2.143).
 *
 * **Was dieser Vertrag haelt.** Vier Zusagen, und jede einzeln:
 *
 *   1. Der Editor hat drei Bereiche, und zwar Editor, Ergebnis und Verlauf.
 *      Sie stehen in einer Reiterleiste, und es ist dieselbe Leiste wie im
 *      Arbeitsplatz der Tabelle (`.table-workspace-tabs`, 2.138). Eine zweite
 *      Sorte Reiter in derselben Console waere eine Oberflaeche, die an zwei
 *      Stellen anders aussieht, ohne dass es einen Grund gibt.
 *   2. Der Verlauf behauptet keine Quelle, die es nicht gibt. QKERN
 *      protokolliert gestellte Abfragen nicht, und der Reiter sagt das; er
 *      liest ausschliesslich die Change Sets aus `GET /api/v1/console` und
 *      legt nichts im Browser ab. Ein `localStorage`-Verlauf waere genau der
 *      erfundene Verlauf, den dieser Vertrag verhindert.
 *   3. Die Kennzeichnung einer gefaehrlichen Abfrage kommt aus der
 *      vorhandenen Risikoerkennung. `readSqlRun` ruft `classifySqlRisk` aus
 *      `lib/security.ts`, dieselbe Funktion, an der `requiresApproval` und
 *      damit das Risiko eines Change Sets haengt. Weder die Ansicht noch das
 *      Modul fuehren eine eigene Liste von Schluesselwoertern.
 *   4. Die Ansicht rendert ohne jede Antwort. Beim Oeffnen wird nichts geholt,
 *      und der erste Durchlauf zeigt den Editor.
 *
 * **Was er nicht kann.** Er klickt keinen Reiter: `renderToStaticMarkup`
 * fuehrt keine Effekte und keine Ereignisse aus. Dass ein Klick auf Ergebnis
 * die Tabelle zeigt, sagt der Quelltext und nicht ein Renderdurchlauf. Darum
 * prueft Zusage 1 die Markup des ersten Durchlaufs und zusaetzlich den
 * Quelltext der drei Bereiche.
 */
const VIEW = path.resolve(process.cwd(), "components/console/sql-view.tsx");
const MODULE = path.resolve(process.cwd(), "lib/console/sql-run-report.ts");

/** Kommentarzeilen zaehlen nicht: dieser Vertrag prueft Code, nicht Prosa. */
function code(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

function render(): string {
  return renderToStaticMarkup(createElement(SqlView, {
    projectId: "proj_1", environment: "development",
    reload: async () => {}, navigate: () => {}, templatesOpen: false,
  }));
}

describe("console sql editor contract", () => {
  const realFetch = globalThis.fetch;

  beforeAll(() => {
    setConsoleLocale("de");
    // Nichts wird geholt. Ein Aufruf, den es wider Erwarten doch gibt, soll
    // laut scheitern und nicht ins Netz gehen.
    globalThis.fetch = (async () => {
      throw new Error("Im SQL-Editor-Vertrag wird nichts geholt.");
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    setConsoleLocale("de");
  });

  it("teilt den Editor in genau drei Bereiche und zeigt sie als Reiter", async () => {
    const source = code(await readFile(VIEW, "utf8"));

    // Die drei Bereiche, und genau diese drei.
    const areas = /type Area = ([^;]+);/.exec(source);
    expect(areas, "sql-view.tsx fuehrt keinen Typ Area mehr").not.toBeNull();
    const named = [...(areas as RegExpExecArray)[1].matchAll(/"([a-z]+)"/g)].map((hit) => hit[1]);
    expect(named.sort()).toEqual(["editor", "history", "result"]);

    // Jeder Bereich hat einen Zweig, der ihn zeigt.
    for (const area of named) {
      expect(source, `der Bereich ${area} hat keinen Zweig in der Ansicht`)
        .toContain(`area === "${area}"`);
    }

    // Und die Leiste steht in der Markup des ersten Durchlaufs, mit drei
    // Reitern und ausgewaehltem Editor.
    const markup = render();
    expect(markup).toContain('role="tablist"');
    expect((markup.match(/role="tab"/g) ?? []).length).toBe(3);
    expect(markup).toContain("Editor");
    expect(markup).toContain("Ergebnis");
    expect(markup).toContain("Verlauf");
  });

  it("benutzt die Reiterleiste des Tabellen-Arbeitsplatzes und baut keine zweite", async () => {
    const source = code(await readFile(VIEW, "utf8"));
    const workspace = await readFile(path.resolve(process.cwd(), "components/console/table-workspace-view.tsx"), "utf8");
    const css = await readFile(path.resolve(process.cwd(), "app/globals.css"), "utf8");

    // Dieselbe Klasse in beiden Ansichten, und sie ist im Stylesheet gebaut.
    expect(workspace, "der Arbeitsplatz der Tabelle fuehrt die Leiste nicht mehr")
      .toContain('className="table-workspace-tabs"');
    expect(source, "der SQL-Editor baut seine Reiter nicht mit der vorhandenen Leiste")
      .toContain('className="table-workspace-tabs"');
    expect(css).toContain(".table-workspace-tabs > button.active");

    // Und keine zweite Reiterregel fuer den SQL-Editor. `.editor-tabs` bleibt:
    // das ist die Kopfzeile des Editorfelds mit Namen und Risiko, kein
    // Bereichswechsler.
    const own = [...css.matchAll(/^\.([a-z0-9-]*tabs)\b/gmu)].map((hit) => hit[1]);
    expect([...new Set(own)].sort()).toEqual(["editor-tabs", "table-workspace-tabs"]);
  });

  it("behauptet keinen Verlauf, den QKERN nicht fuehrt", async () => {
    const source = code(await readFile(VIEW, "utf8"));

    // Kein Verlauf im Browser. Das ist der Kern dieser Zusage: ein
    // `localStorage`-Verlauf saehe aus wie ein Protokoll und waere keines.
    expect(/localStorage|sessionStorage|indexedDB/u.test(source),
      "der SQL-Editor legt einen Verlauf im Browser ab").toBe(false);

    // Der Verlauf liest genau eine Quelle, und die gibt es: die Change Sets
    // aus der Konsolenantwort. Keine erfundene Route, kein Audit-Endpunkt,
    // den es fuer Abfragen nicht gibt.
    const fetched = [...source.matchAll(/fetch\(\s*[`"]([^`"]+)/g)].map((hit) => hit[1]);
    expect(fetched).toContain("/api/v1/console");
    for (const url of fetched) {
      expect(/audit|histor|verlauf|queries/iu.test(url),
        `${url}: der Verlauf liest eine Quelle, die QKERN fuer Abfragen nicht fuehrt`).toBe(false);
    }

    // Und der Reiter sagt beides: dass es kein Protokoll gibt, und was es
    // stattdessen gibt. Beides als ganzer Satz, nicht als zwei Worte.
    const admission = /QKERN protokolliert gestellte Abfragen nicht\.[^"]*Audit-Kette[^"]*/u.exec(source);
    expect(admission, "der Verlauf sagt nicht, dass QKERN keine Abfrage protokolliert").not.toBeNull();
    expect(source, "der Verlauf nennt nicht, was es stattdessen gibt").toMatch(/Change Sets für schreibende Änderungen/u);
  });

  it("nimmt die Kennzeichnung einer gefaehrlichen Abfrage aus der vorhandenen Erkennung", async () => {
    const view = code(await readFile(VIEW, "utf8"));
    const module = code(await readFile(MODULE, "utf8"));

    // Das Modul ruft die vorhandene Erkennung, statt eine zweite zu bauen.
    expect(module).toMatch(/import \{[^}]*classifySqlRisk[^}]*\} from "@\/lib\/security"/u);

    // Und weder die Ansicht noch das Modul fuehren eigene Schluesselwoerter.
    // Geprueft wird auf die vier Formen aus dem Auftrag: Steht eines dieser
    // Woerter im Code und nicht in einem uebersetzten Satz, ist eine zweite
    // Liste entstanden.
    for (const [name, source] of [["sql-view.tsx", view], ["sql-run-report.ts", module]] as const) {
      // Die Texte fuer den Betreiber duerfen DROP nennen; sie erklaeren ja,
      // was erkannt wurde. Also werden sie vorher entfernt.
      const withoutTexts = source.replace(/t\("(?:[^"\\]|\\.)*"\)/g, "").replace(/"(?:[^"\\]|\\.)*"/g, "\"\"");
      for (const keyword of ["DROP", "TRUNCATE", "ALTER", "DELETE", "WHERE"]) {
        expect(withoutTexts.includes(keyword),
          `${name}: fuehrt mit ${keyword} eine zweite Liste von Schluesselwoertern`).toBe(false);
      }
    }

    // Das Urteil ist genau das der vorhandenen Erkennung, Stufe fuer Stufe.
    for (const statement of [
      "DROP TABLE kunden",
      "TRUNCATE kunden",
      "DELETE FROM kunden",
      "ALTER TABLE kunden ADD COLUMN notiz text",
      "SELECT 1",
    ]) {
      const reading = readSqlRun(statement, "development");
      expect(reading.level, statement).toBe(classifySqlRisk(statement, "development"));
    }

    // Und die vier Formen aus dem Auftrag sind gekennzeichnet, die lesende
    // Abfrage nicht.
    for (const statement of [
      "DROP TABLE kunden",
      "TRUNCATE kunden",
      "DELETE FROM kunden",
      "ALTER TABLE kunden ADD COLUMN notiz text",
    ]) {
      expect(readSqlRun(statement, "development").dangerous, statement).toBe(true);
    }
    const harmless = readSqlRun("SELECT id FROM kunden LIMIT 1", "development");
    expect(harmless.dangerous).toBe(false);
    expect(harmless.readOnly).toBe(true);

    // Ein `DELETE` mit `WHERE` ueber mehrere Zeilen ist nicht dasselbe wie
    // eines ohne: das Modul glaettet die Umbrueche, bevor es fragt.
    expect(readSqlRun("DELETE FROM kunden\nWHERE id = 1", "development").level)
      .toBe(classifySqlRisk("DELETE FROM kunden WHERE id = 1", "development"));

    // Und die Ansicht zeigt die Kennzeichnung an diesem Urteil, nicht an einer
    // eigenen Bedingung.
    expect(view).toContain("reading.dangerous &&");
  });

  it("rendert ohne jede Antwort und zeigt beim Oeffnen den Editor", () => {
    const markup = render();
    // Das Editorfeld steht da, und der Knopf, den ein Mensch druecken muss.
    expect(markup).toContain("<textarea");
    expect(markup).toContain("information_schema.tables");
    expect(markup).toContain("Abfrage ausführen");
    // Kein Ergebnis und kein Verlauf im ersten Durchlauf: nichts wurde geholt.
    expect(markup).not.toContain("sql-result-table");
    expect(markup).not.toContain("sql-history-list");
  });

  it("ordnet jede Antwort der Route einem Code zu und erfindet keinen", () => {
    // Genau die Codes, die die Query-Route herausgibt.
    expect(sqlRunFailureCode(400, "READ_ONLY_QUERY_REQUIRED")).toBe("READ_ONLY_QUERY_REQUIRED");
    expect(sqlRunFailureCode(409, "DATA_PLANE_NOT_READY")).toBe("DATA_PLANE_NOT_READY");
    expect(sqlRunFailureCode(503, "DATA_PLANE_UNAVAILABLE")).toBe("DATA_PLANE_UNAVAILABLE");
    expect(sqlRunFailureCode(400, undefined)).toBe("INVALID_REQUEST");
    expect(sqlRunFailureCode(401, undefined)).toBe("AUTHENTICATION_REQUIRED");
    expect(sqlRunFailureCode(404, undefined)).toBe("NOT_FOUND");
    // Ein Code, den die Route nicht fuehrt, wird nicht durchgereicht: sonst
    // stuende in der Ansicht ein Code ohne Erklaerung, oder schlimmer, eine
    // erfundene.
    expect(sqlRunFailureCode(503, "PG_42P01")).toBe("UNKNOWN");
    expect(sqlRunFailureCode(500, undefined)).toBe("UNKNOWN");
    // Der schreibende Weg antwortet grober, und das Modul tut nicht so, als
    // waere er feiner.
    expect(changeSetFailureCode(400)).toBe("CHANGE_SET_REJECTED");
    expect(changeSetFailureCode(409)).toBe("DATA_PLANE_NOT_READY");
    expect(changeSetFailureCode(500)).toBe("UNKNOWN");
  });

  it("zeigt zu jedem Fehlercode einen Satz und zu keinem einen erfundenen", async () => {
    const source = await readFile(VIEW, "utf8");
    const module = await readFile(MODULE, "utf8");
    // Jeder Code des Moduls hat in der Ansicht einen Zweig. Ohne diese Zusage
    // koennte ein neuer Code still im Satz fuer `UNKNOWN` landen.
    const union = /export type SqlRunFailureCode =([\s\S]*?);/.exec(module);
    expect(union).not.toBeNull();
    const codes = [...(union as RegExpExecArray)[1].matchAll(/"([A-Z_]+)"/g)].map((hit) => hit[1]);
    expect(codes.length).toBeGreaterThanOrEqual(10);
    for (const entry of codes) {
      if (entry === "UNKNOWN") continue;
      expect(source, `${entry}: kein Satz in der Ansicht`).toContain(`code === "${entry}"`);
    }
    // Und die Ansicht gibt die Meldung von PostgreSQL nicht aus, denn sie
    // bekommt sie nicht: `ProjectDataPlaneError` ist ohne `cause` gebaut.
    const service = await readFile(path.resolve(process.cwd(), "lib/server/data-plane/service.ts"), "utf8");
    expect(service, "der Dienst gibt inzwischen Details heraus; dann darf die Ansicht sie zeigen")
      .toContain("Cause-free by design");
  });
});
