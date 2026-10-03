import { readFile } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsView } from "@/components/console/settings-view";
import { NAV, REAL_VIEWS, type ViewId } from "@/components/console/navigation";
import { SETTINGS_GROUPS, SETTINGS_GROUP_IDS, isRealView, navPath } from "@/lib/console/settings-groups";

/**
 * Einstellungen → Allgemein ordnet in Gruppen, und keine Gruppe verspricht
 * mehr, als es gibt (2.139).
 *
 * **Der Auftrag.** Sieben Gruppen: General, Infrastructure, API Keys,
 * Security, Billing, Team, Danger Zone. Zwei davon haben in QKERN keine
 * Faehigkeit. Eine Teamverwaltung gibt es nicht, und ein Projekt loeschen,
 * zuruecksetzen oder pausieren kann keine Route dieser Console; gezaehlt im
 * Baum `app/api` sind es sechzehn Routen mit `DELETE`, und jede davon trifft
 * ein einzelnes Ding, keinen Projektzustand.
 *
 * **Was dieser Vertrag prueft.** Er rendert die Seite wirklich, nicht ihren
 * Quelltext allein: dass jede der sieben Gruppen einen Ort auf der Seite hat,
 * dass die zwei Gruppen ohne Faehigkeit einen Satz statt eines Knopfs tragen,
 * dass jeder Verweis auf eine Ansicht zeigt, die es gibt und die in der
 * Navigation erreichbar ist, und dass in der Gefahrenzone kein Knopf steht,
 * der keine Route hinter sich hat.
 *
 * **Was er nicht kann.** Er klickt nicht. Dass `navigate` die Ansicht wirklich
 * wechselt, ist Sache der Schale; dass die Requisite ankommt, ist eine Zeile
 * in `console-app.tsx`, die diesem Schnitt nicht gehoert. Bis sie da ist,
 * bleiben die Verweise stumm, und dieser Vertrag sagt nur, dass sie auf etwas
 * Existierendes zielen.
 */
const VIEW = path.resolve(process.cwd(), "components/console/settings-view.tsx");

/** Die Seite mit denselben Werten, die die Schale heute hereinreicht. */
function markup(): string {
  return renderToStaticMarkup(createElement(SettingsView, {
    project: { name: "Atlas", id: "prj_atlas", region: "eu-central-1" },
    organizationId: "org_nordwind",
    navigate: () => {},
  }));
}

/**
 * Der Abschnitt einer Gruppe im gerenderten Markup, an seiner Ueberschrift
 * erkannt und beim naechsten `</article>` abgeschnitten.
 */
function card(html: string, title: string): string {
  const parts = html.split("<article");
  const found = parts.find((part) => part.includes(`<h3>${title}</h3>`));
  expect(found, `Der Abschnitt ${title} steht nicht im Markup`).toBeDefined();
  const body = found as string;
  return body.slice(0, body.indexOf("</article>"));
}

/** Die Beschriftung eines Verweises, so wie die Seite sie zeichnet. */
function linkName(view: ViewId): string {
  const { group, label } = navPath(view);
  return (group === label ? group : `${group} · ${label}`).replace(/&/g, "&amp;");
}

/** Der Titel jeder Gruppe auf Deutsch, in der Reihenfolge des Auftrags. */
const TITLES: ReadonlyArray<[string, string]> = [
  ["general", "Allgemein"],
  ["infrastructure", "Infrastruktur"],
  ["api-keys", "API-Keys"],
  ["security", "Sicherheit"],
  ["billing", "Abrechnung"],
  ["team", "Team"],
  ["danger", "Gefahrenzone"],
];

describe("console settings groups contract", () => {
  it("gives every group of the brief a place on the page", async () => {
    // Die Reihenfolge ist die des Auftrags, und sie steht an einer Stelle.
    expect(SETTINGS_GROUPS.map((group) => group.id)).toEqual([...SETTINGS_GROUP_IDS]);
    expect(TITLES.map(([id]) => id)).toEqual([...SETTINGS_GROUP_IDS]);

    const html = markup();
    for (const [id, title] of TITLES) {
      expect(html, `Die Gruppe ${id} hat keinen Titel auf der Seite`).toContain(`<h3>${title}</h3>`);
    }
    // Und jede Gruppe sagt in einem Satz, was sie enthaelt. Ein Titel allein
    // waere eine Ueberschrift ueber nichts.
    const leads = [...html.matchAll(/<\/h3><\/div><p>([^<]{40,})<\/p>/g)];
    expect(leads.length, "Nicht jede Gruppe traegt einen erklaerenden Satz").toBe(SETTINGS_GROUPS.length);
    for (const lead of leads) expect(lead[1].trim()).toMatch(/[.!?]$/u);
  });

  it("names no capability that does not exist", async () => {
    // Genau zwei Gruppen haben keine Faehigkeit, und es sind diese zwei.
    expect(SETTINGS_GROUPS.filter((group) => group.missing).map((group) => group.id))
      .toEqual(["team", "danger"]);

    const html = markup();
    // Team: der Satz steht da, und in dem Abschnitt steht kein Knopf.
    const team = card(html, "Team");
    expect(html).toContain("Eine Teamverwaltung gibt es in QKERN nicht.");
    expect(html).toContain("Ein Projekt löschen, zurücksetzen oder pausieren kann diese Console nicht");

    const source = await readFile(VIEW, "utf8");
    // Kein Speicherknopf, kein Eingabefeld, keine zerstoerende Aktion: Die
    // Seite liest, und zwar alles aus ihren Requisiten.
    expect(source, "die Seite verspricht wieder ein Speichern").not.toMatch(/t\("Änderungen speichern"\)/u);
    expect(source, "die Seite baut wieder ein Formular").not.toContain("<input");
    expect(source, "die Seite erfindet eine zerstoerende Aktion").not.toContain("DangerousAction");
    expect(html, "ein abgeschalteter Knopf steht wieder auf der Seite").not.toContain("disabled");
    for (const word of ["Projekt löschen", "Projekt zurücksetzen", "Projekt pausieren"]) {
      expect(source, `${word} gibt es nicht`).not.toContain(`t("${word}")`);
    }
    // Der Abschnitt Team traegt keinen Knopf, auch keinen, der woanders hin
    // fuehrt. Er hat nichts, und dann ist ein Knopf eine Einladung ins Leere.
    expect(team, "der Abschnitt Team traegt einen Knopf").not.toContain("<button");
  });

  it("points every link at a view that exists and is reachable", async () => {
    for (const group of SETTINGS_GROUPS) {
      for (const view of group.views) {
        expect(isRealView(view), `${group.id}: ${view} ist keine echte Ansicht`).toBe(true);
        expect(REAL_VIEWS as readonly string[], `${group.id}: ${view}`).toContain(view);
        // Erreichbar heisst: Die Navigation fuehrt sie, also kann die Schale
        // sie oeffnen und die Seitenleiste zeigt danach, wo man ist.
        const reachable = NAV.some((entry) => entry.id === view
          || (entry.children ?? []).some((child) => child.id === view));
        expect(reachable, `${group.id}: ${view} steht in keiner Menuegruppe`).toBe(true);
        // Und der Name kommt aus der Navigation, nicht aus einer Erfindung
        // dieser Seite: `navPath` findet beide Teile.
        const found = navPath(view as ViewId);
        expect(found.label, `${group.id}: ${view} hat keinen Namen in der Navigation`).not.toBe(view);
      }
      // Kein Verweis auf diese Seite selbst; das waere ein Knopf, der nichts tut.
      expect(group.views, `${group.id} verweist auf sich selbst`).not.toContain("settings");
    }
    // Und die Seite zeigt wirklich so viele Verweise, wie die Zuordnung nennt.
    const html = markup();
    const links = [...html.matchAll(/<button type="button" class="secondary-button">/g)];
    const expected = SETTINGS_GROUPS.reduce((sum, group) => sum + group.views.length, 0);
    expect(links.length, "Die Seite zeigt andere Verweise als die Zuordnung").toBe(expected);
  });

  it("leaves no button in the danger zone without a route behind it", async () => {
    const danger = SETTINGS_GROUPS.find((group) => group.id === "danger");
    expect(danger).toBeDefined();
    const html = markup();
    const body = card(html, "Gefahrenzone");
    // Jeder Knopf dort ist ein Verweis, und zwar genau einer je Ansicht der
    // Gruppe. Ein Knopf mehr waere einer ohne Route.
    const buttons = [...body.matchAll(/<button/g)];
    expect(buttons.length, "Die Gefahrenzone traegt einen Knopf ohne Verweis")
      .toBe(danger!.views.length);
    for (const view of danger!.views) {
      expect(body, `Die Gefahrenzone nennt ${view} nicht`).toContain(linkName(view));
    }
    // Und sie nennt die Stelle, an der das Einzelne wirklich zerstoerbar ist:
    // Zeile, Bucket, Key, Function. Jede davon hat eine Route mit `DELETE`.
    for (const word of ["Zeilen einer Tabelle", "Bucket", "API-Key", "Function"]) {
      expect(body, `Die Gefahrenzone sagt nicht, wo ${word} verschwindet`).toContain(word);
    }
  });

  it("copies every technical value through the one copy part", async () => {
    const source = await readFile(VIEW, "utf8");
    expect(source).toContain('from "@/components/console/copy-value"');
    expect(source, "die Seite kopiert an der gemeinsamen Stelle vorbei").not.toContain("navigator.clipboard");
    const html = markup();
    // Projekt-ID, Organisations-ID und Region: drei Werte, drei Knoepfe.
    for (const value of ["prj_atlas", "org_nordwind", "eu-central-1"]) {
      expect(html, `${value} steht nicht kopierbar auf der Seite`).toContain(`<code>${value}</code>`);
    }
    expect([...html.matchAll(/class="secondary-button settings-value-copy"/g)].length).toBe(3);
  });
});
