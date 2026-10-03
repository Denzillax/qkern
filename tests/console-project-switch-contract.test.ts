import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Der Projektwechsler wechselt wirklich (2.142).
 *
 * **Der Befund.** Oben links stand der Projektname mit einem Pfeil daneben, und
 * hinter dem Pfeil lag nichts. Schlimmer als die tote Geste war die Zeile
 * darunter im Quelltext: `snapshot.projects[0]`. Die Console zeigte damit immer
 * das erste Projekt der Antwort, und wer ein zweites hatte, kam ueber die
 * Oberflaeche nie hin. Gefunden habe ich das nicht im Browser, sondern beim
 * Lesen, weil ich wissen wollte, was der Pfeil verspricht.
 *
 * **Was der Vertrag haelt.** Dass die Liste gelesen wird und nicht ihr erstes
 * Element, dass die Wahl in den Zustand geht, dass das Menue dasselbe Bauteil
 * ist wie jedes andere Auswahlfeld der Console, und dass kein Knopf zum Anlegen
 * eines Projekts dasteht, solange es dafuer keine Route gibt. Das Letzte ist
 * der Punkt: Die Vorlage nennt "+ New Project", und ein Knopf, der nichts tut,
 * waere schlimmer als keiner.
 *
 * **Was er nicht kann.** Ob das Umschalten im Browser wirklich die Daten des
 * anderen Projekts holt, sagt er nicht. Das haengt daran, dass jede Ansicht
 * ihre `projectId` als Requisite bekommt, und das prueft der Render-Vertrag.
 */
const APP = path.resolve(process.cwd(), "components/console/console-app.tsx");
const ROUTES = path.resolve(process.cwd(), "app/api/v1/projects/route.ts");

describe("console project switch contract", () => {
  it("reads the whole list instead of pinning the first project", async () => {
    const source = await readFile(APP, "utf8");
    expect(source).toMatch(/snapshot\?\.projects\.find\(\(entry\) => entry\.id === projectId\)/);
    expect(source).toContain("const [projectId, setProjectId] = useState<string | null>(null);");
    // Der Griff auf das erste Element bleibt als Rueckfall erlaubt, aber nur
    // dort, wo auch gesucht wurde.
    for (const hit of source.matchAll(/projects\[0\]/g)) {
      const line = source.slice(0, hit.index ?? 0).split("\n").pop() ?? "";
      // Kommentarzeilen zaehlen nicht: Der Kommentar ueber dieser Stelle nennt
      // den alten Griff, um zu sagen, warum er weg ist, und daran soll die
      // Regel nicht haengen bleiben.
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;
      expect(line, "projects[0] ohne vorherige Suche").toContain("find(");
    }
  });

  it("offers every project through the one menu component", async () => {
    const source = await readFile(APP, "utf8");
    const block = source.slice(source.indexOf('<div className="project-switch">'),
      source.indexOf('<nav className={`console-nav'));
    expect(block).toContain("<OptionMenu");
    expect(block).toMatch(/options=\{\(snapshot\?\.projects \?\? \[\]\)\.map/);
    expect(block).toContain("onChange={(next) => { setProjectId(next);");
    // Und der tote Pfeil ist weg: Er war ein `ChevronDown` ohne Menue.
    expect(block).not.toMatch(/<ChevronDown size=\{14\}\/>/);
  });

  it("offers no way to create a project, because there is no route for it", async () => {
    const routes = await readFile(ROUTES, "utf8");
    // Erst der Beleg: Die Projektroute liest nur.
    expect(routes).toContain("export async function GET");
    expect(routes).not.toContain("export async function POST");
    // Dann die Folge: kein Knopf, der es verspricht.
    const source = await readFile(APP, "utf8");
    const block = source.slice(source.indexOf('<div className="project-switch">'),
      source.indexOf('<nav className={`console-nav'));
    expect(block).not.toMatch(/Neues Projekt|New Project|Projekt anlegen/);
  });
});
