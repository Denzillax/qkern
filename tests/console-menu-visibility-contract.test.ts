import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ein Auswahlmenue darf nicht von seinem eigenen Rahmen abgeschnitten werden
 * (2.156).
 *
 * **Der Befund.** Der Projektwechsler oben links liess sich oeffnen und man sah
 * nichts. `.project-switch` trug `overflow: hidden`, und die Liste ist ein
 * absolut positioniertes Kind: Sie oeffnete acht Pixel unter einem Rahmen, der
 * 56 Pixel hoch ist, lag also vollstaendig ausserhalb und wurde weggeschnitten.
 * Gemeldet hat das ein Mensch, nicht ein Test; gemessen habe ich es danach in
 * einem Nachbau mit echtem Stylesheet, wo `elementFromPoint` in der Mitte der
 * Liste ein anderes Element traf.
 *
 * **Warum die Regel so schmal ist.** Ob ein Menue sichtbar ist, haengt an drei
 * Dingen: dem Zuschnitt des Rahmens, seiner Hoehe und der Richtung, in die das
 * Menue aufgeht. Nur das erste steht im Stylesheet. Der Table Editor traegt
 * denselben Zuschnitt und ist trotzdem in Ordnung, weil seine Karte hoch genug
 * ist und das Menue innerhalb aufgeht; das habe ich nachgemessen, statt es
 * vorsorglich mitzuaendern.
 *
 * **Was er nicht kann.** Er rendert nichts. Er haelt die eine Stelle fest, an
 * der es wirklich schiefging, und nennt die beiden anderen Bedingungen, damit
 * der naechste sie mitdenkt.
 */
const CSS = path.resolve(process.cwd(), "app/globals.css");

/** Der Rumpf einer Regel, an ihrem Selektor gesucht. */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `Regel ${selector} fehlt`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

describe("console menu visibility contract", () => {
  it("does not clip the project switcher that hosts a menu", async () => {
    const css = await readFile(CSS, "utf8");
    const body = ruleBody(css, ".project-switch");
    expect(body, "der Rahmen des Projektwechslers schneidet wieder zu")
      .not.toMatch(/overflow:\s*hidden/);
    // Der lange Name wird weiter gekuerzt, nur eine Ebene tiefer: in der Zeile,
    // in der er steht, und nicht im Rahmen um das Menue herum.
    expect(css).toMatch(/\.project-switch \.option-field > span \{[^}]*text-overflow: ellipsis/);
    expect(css).toMatch(/\.project-switch > div \{[^}]*min-width: 0/);
  });

  it("keeps the menu panel anchored to the left inside the sidebar", async () => {
    const css = await readFile(CSS, "utf8");
    // Ohne diese Regel haengt die Liste am rechten Rand eines schmalen
    // Elements und laeuft nach links aus dem Fenster.
    expect(css).toMatch(/\.project-switch \.option-list \{[^}]*left: 0/);
    expect(css).toMatch(/\.project-switch \.option-list \{[^}]*right: auto/);
  });
});
