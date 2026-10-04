import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Menues mit der Tastatur (2.168).
 *
 * Gemessen mit echten Tastendruecken ueber das DevTools-Protokoll: In allen
 * vier Menues der Console (Auswahl, Umgebung, Sprache, Konto) lag der Fokus
 * nach Escape auf `body`, in der Auswahl auch nach einer Wahl. Pfeiltasten gab
 * es keine. Seit 2.168 laufen alle vier ueber `useMenuKeyboard`. Ob der Fokus
 * wirklich zurueckkommt, zeigt nur ein Browser; dieser Vertrag haelt fest, dass
 * keines der vier Menues wieder ein eigenes Escape baut, das den Fokus fallen
 * laesst.
 */
const MENUS = [
  "components/console/option-menu.tsx",
  "components/console/console-app.tsx",
  "components/language-switcher.tsx",
];

describe("console menu keyboard contract", () => {
  it("routes every menu through the shared keyboard hook", async () => {
    let uses = 0;
    for (const file of MENUS) {
      const source = await readFile(path.resolve(process.cwd(), file), "utf8");
      expect(source, `${file} schliesst wieder selbst mit Escape`).not.toMatch(/event\.key === "Escape"\) setOpen\(false\)/);
      uses += (source.match(/useMenuKeyboard\(open, setOpen\)/g) ?? []).length;
      // Der Knopf bekommt den Fokus zurueck, also braucht jeder eine Referenz.
      expect(source).toMatch(/ref=\{trigger\}/);
    }
    // Auswahl, Umgebung, Konto und Sprache.
    expect(uses).toBe(4);
  });

  it("returns focus on Escape and moves with the arrow keys", async () => {
    const hook = await readFile(path.resolve(process.cwd(), "components/use-menu-keyboard.ts"), "utf8");
    expect(hook).toContain('if (event.key === "Escape") close(true);');
    expect(hook).toContain("if (returnFocus) trigger.current?.focus();");
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) expect(hook).toContain(`"${key}"`);
  });
});
