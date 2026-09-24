import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV } from "@/components/console/navigation";
import { FLYOUT_GRACE_MS, FLYOUT_HOVER_DELAY_MS, FLYOUT_WIDTH } from "@/components/console/sidebar-flyout";

/**
 * Flyout der eingeklappten Sidebar (2.5): Jede Gruppe mit Unterpunkten hat
 * im eingeklappten Zustand ein Flyout mit allen Unterpunkten, keine Gruppe
 * ohne Unterpunkte hat eines. Die Zeiten aus dem Entwurf sind benannte
 * Konstanten, nicht Zahlen im Code.
 */
describe("console flyout contract", () => {
  it("gives every group with children a flyout and none to the others", async () => {
    const source = await readFile(path.resolve(process.cwd(), "components/console/console-app.tsx"), "utf8");
    expect(source).toContain("collapsed && !isPhone && group.children");
    expect(source).toContain("<SidebarFlyout");
    const withChildren = NAV.filter((group) => group.children);
    const without = NAV.filter((group) => !group.children);
    expect(withChildren.length).toBeGreaterThan(0);
    expect(without.length).toBeGreaterThan(0);
    for (const group of withChildren) expect(group.children!.length, group.label).toBeGreaterThan(0);
  });

  it("uses the timings and width from the design", () => {
    expect(FLYOUT_HOVER_DELAY_MS).toBe(150);
    expect(FLYOUT_GRACE_MS).toBe(250);
    expect(FLYOUT_WIDTH).toBe(220);
  });
});
