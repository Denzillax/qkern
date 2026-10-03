import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PROVISIONING_ORDER_STATES } from "@/lib/console/provisioning-order-texts";

/**
 * Die Bestellung einer Bereitstellung (2.153).
 *
 * **Warum erst jetzt.** Die Seite war bis hierher mit Absicht nur lesend, und
 * das war richtig: Wer die Umgebungen nicht selbst anlegen kann, braucht den
 * Knopf nicht. Seit 2.147 legt die Console Projekte an, und deren Umgebungen
 * warten danach auf eine Datenbank. Ohne diesen Knopf gaebe es in der ganzen
 * Oberflaeche keinen Weg aus dem Zustand heraus.
 *
 * **Was der Vertrag haelt.** Dass die Bestellung an die vorhandene Route geht
 * und nicht an eine erfundene, dass sie das Recht nennt, das die Route
 * verlangt, und vor allem: dass die Seite den Unterschied zwischen einreihen
 * und ausfuehren hinschreibt. Die Route antwortet ausdruecklich mit
 * `executed: false`; ohne einen laufenden Provisionierer bleibt der Auftrag
 * stehen. Eine Oberflaeche, die danach "bereitgestellt" meldet, waere eine
 * Luege mit zwei Minuten Haltbarkeit.
 *
 * **Was er nicht kann.** Er klickt nicht. Ob die Bestellung in der Datenbank
 * ankommt, belegt der Stacklauf; ob der Knopf an der richtigen Stelle steht,
 * sieht erst ein Mensch.
 */
const VIEW = path.resolve(process.cwd(), "components/console/provisioning-order-view.tsx");
const ROUTE = path.resolve(process.cwd(),
  "app/api/v1/projects/[projectId]/environments/[environment]/provisioning/route.ts");

describe("console provisioning order contract", () => {
  it("orders through the route that exists, with its own right", async () => {
    const route = await readFile(ROUTE, "utf8");
    expect(route).toContain('requireCapability(principal, "project_provisioning_request");');
    expect(route).toContain("if (!hasTrustedOrigin(request)) return csrfRejected();");

    const view = await readFile(VIEW, "utf8");
    expect(view).toMatch(/method: "POST"/);
    expect(view).toMatch(/environments\/\$\{environment\}\/provisioning/);
  });

  it("says that ordering is not executing", async () => {
    const route = await readFile(ROUTE, "utf8");
    // Der Beleg zuerst: Die Route sagt es selbst.
    expect(route).toContain("executed: false");

    // Und die Seite sagt es in Worten, vor und nach dem Druck.
    for (const key of ["orderInvite", "orderDone"] as const) {
      const sentence = PROVISIONING_ORDER_STATES[key];
      expect(sentence.length, key).toBeGreaterThan(60);
      expect(sentence, `${key} nennt den Provisionierer nicht`).toMatch(/Provisionierer/);
    }
    expect(PROVISIONING_ORDER_STATES.orderDone, "die Rueckmeldung behauptet Ausfuehrung")
      .toMatch(/nicht/);
  });

  it("tells the three answers of the route apart", async () => {
    const view = await readFile(VIEW, "utf8");
    // 202 ist neu eingereiht, 200 mit `idempotent` war schon da, alles andere
    // ist eine Ablehnung. Wer die drei zusammenwirft, meldet beim zweiten Druck
    // einen zweiten Auftrag, den es nicht gibt.
    expect(view).toContain('answer.status === 202');
    expect(view).toContain("payload.data?.idempotent");
    expect(view).toContain('setOrder("refused")');
  });

  it("offers the button only where there is no job yet", async () => {
    const view = await readFile(VIEW, "utf8");
    const block = view.slice(view.indexOf('state === "noJob"'), view.indexOf('order === "done"'));
    expect(block, "der Knopf steht nicht im leeren Zustand").toContain("requestProvisioning");
    // Und nicht daneben: Mit einem laufenden Auftrag waere ein zweiter Druck
    // nur eine Antwort, die sagt, dass schon einer da ist.
    const afterJob = view.slice(view.indexOf("{job && jobText &&"));
    expect(afterJob, "der Knopf steht auch beim laufenden Auftrag").not.toContain("requestProvisioning");
  });
});
