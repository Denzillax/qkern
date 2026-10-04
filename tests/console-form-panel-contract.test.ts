import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { cronBody, functionBody, webhookBody } from "@/components/console/compute-form-fields";

/**
 * Keine Browser-Dialoge in der Console (2.166).
 *
 * Bis hierher fragten acht Ansichten ueber `window.prompt` und `window.confirm`:
 * ein Cron-Job mit vier Fenstern nacheinander, ein Webhook mit vier, eine
 * Function mit drei, eine Zeile als JSON in einem Fenster. Das Fenster gehoert
 * dem Browser: eigene Knoepfe in dessen Sprache, kein Hinweis am Feld, nie
 * alle Felder zugleich, und ein Tippfehler im dritten bricht alles ab.
 * Gefunden, als der Nachbau die Ablaeufe bedienen sollte und ein kopfloser
 * Browser an genau diesen Fenstern haengen bliebe.
 *
 * Ersetzt durch `FormPanel` und durch Bestaetigungen in der Seite. Dieser
 * Vertrag haelt zwei Dinge: dass keiner zurueckkommt, und dass die Formulare
 * dieselben Anfragen schicken wie vorher die Prompts.
 */
async function sources(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(path.resolve(process.cwd(), directory), { withFileTypes: true })) {
    const next = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...await sources(next));
    else if (/\.(ts|tsx)$/.test(entry.name)) found.push(next);
  }
  return found;
}

describe("console form panel contract", () => {
  it("asks nothing through a browser dialog", async () => {
    const offenders: string[] = [];
    for (const file of [...await sources("components"), ...await sources("app")]) {
      const text = (await readFile(path.resolve(process.cwd(), file), "utf8"))
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      if (/\bwindow\.(prompt|confirm|alert)\s*\(/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("sends the same bodies the prompts sent", () => {
    // Leere Zeitzone heisst UTC, wie bei jedem Plan seit 2.66.
    expect(JSON.parse(cronBody({ name: " nightly ", expression: " 0 3 * * * ", queue: " jobs ", timeZone: " " })))
      .toEqual({ name: "nightly", expression: "0 3 * * *", queue: "jobs", timeZone: "UTC" });
    expect(JSON.parse(webhookBody({ name: "orders", url: "https://r.example.com/h", events: "order.created, order.paid,", signingSecretRef: "vault:w/o" })))
      .toEqual({ name: "orders", url: "https://r.example.com/h", eventTypes: ["order.created", "order.paid"], signingSecretRef: "vault:w/o" });
    expect(JSON.parse(functionBody({ name: "fn", image: "r.example.com/a@sha256:ab", entrypoint: "h.mjs" })))
      .toEqual({ name: "fn", image: "r.example.com/a@sha256:ab", entrypoint: "h.mjs" });
  });

  it("keeps an example a placeholder and only a real default a value", async () => {
    // Die Prompts waren mit Beispielen vorbelegt; in einem Formular waeren das
    // Werte, und ein schneller Druck legte "nightly-report" an.
    const fields = await readFile(path.resolve(process.cwd(), "components/console/compute-form-fields.ts"), "utf8");
    expect(fields).toContain('placeholder: "nightly-report"');
    expect([...fields.matchAll(/initial: "([^"]*)"/g)].map((match) => match[1])).toEqual(["UTC"]);
  });
});
