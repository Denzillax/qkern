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
 * ist wie jedes andere Auswahlfeld der Console, und dass der Weg zum Anlegen
 * eines Projekts dasteht, weil es die Route dazu gibt.
 *
 * **Die umgedrehte Zusage (2.147).** Bis 2.146 hiess der dritte Fall hier
 * "offers no way to create a project, because there is no route for it", und er
 * hatte recht: Die Projektroute kannte nur `GET`, und ein Knopf waere ein
 * Versprechen ohne Deckung gewesen. Mit 2.147 gibt es `POST /api/v1/projects`,
 * also faellt die Begruendung weg und mit ihr die Zusage. Geloescht wird sie
 * nicht, sie wird gedreht: Der Fall verlangt jetzt beides, die Route **und**
 * den Weg in der Oberflaeche. Eine Route ohne Knopf waere eine Faehigkeit, die
 * niemand findet; ein Knopf ohne Route waere der alte Fehler.
 *
 * **Was er nicht kann.** Ob das Umschalten im Browser wirklich die Daten des
 * anderen Projekts holt, sagt er nicht. Das haengt daran, dass jede Ansicht
 * ihre `projectId` als Requisite bekommt, und das prueft der Render-Vertrag.
 * Ob das Anlegen in der Datenbank ankommt und die Mandantengrenze haelt, sagt
 * er auch nicht: Das belegt der Fall in `tests/postgres.integration.test.ts`
 * gegen echtes PostgreSQL.
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

  it("creates a project through the route and offers it in the interface", async () => {
    const routes = await readFile(ROUTES, "utf8");
    // Erst der Beleg: Die Projektroute kann anlegen, mit Herkunftspruefung und
    // dem eigenen Recht, so wie jede andere schreibende Route.
    expect(routes).toContain("export async function GET");
    expect(routes).toContain("export async function POST");
    expect(routes).toContain("if (!hasTrustedOrigin(request)) return csrfRejected();");
    expect(routes).toContain('requireCapability(context, "project_create");');
    // Geprueft wird im reinen Modul und nicht in der Route.
    expect(routes).toContain('from "@/lib/console/project-draft"');
    expect(routes).toContain("validateProjectDraft(await safeJson(request))");
    // Und die Ablehnungen haben einen Grund und einen eigenen Code.
    expect(routes).toContain('code === "PROJECT_SLUG_TAKEN"');
    expect(routes).toContain("{ status: 409 }");
    expect(routes).toContain("{ status: 400 }");

    // Dann die Folge: der Weg in der Oberflaeche, im Projektwechsler.
    const source = await readFile(APP, "utf8");
    const block = source.slice(source.indexOf('<div className="project-switch">'),
      source.indexOf('<nav className={`console-nav'));
    expect(block).toMatch(/Neues Projekt anlegen/);
    expect(block).toContain('<form id="project-create-form"');
    // Klein halten heisst: Name und Region, sonst nichts.
    expect(block).toContain('id="project-create-name"');
    expect(block).toContain("PROJECT_REGIONS.map");
    // Die Region kommt aus der echten Liste und nicht aus einer erfundenen.
    expect(source).toContain('from "@/lib/console/project-draft"');
    expect(block).not.toMatch(/eu-central-1|us-east-1/);
    // Nach dem Anlegen ist das neue Projekt gewaehlt.
    expect(source).toContain("setProjectId(created.id);");
    // Und die Oberflaeche sagt, dass hier keine Datenbank entsteht.
    expect(block).toMatch(/Umgebungen entstehen mit der Bereitstellung/);
  });
});
