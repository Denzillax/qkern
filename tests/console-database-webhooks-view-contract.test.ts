import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";

/**
 * Die Ansicht der Datenbank-Webhooks (2.50) am Quelltext geprueft.
 *
 * Drei Zusicherungen traegt dieser Vertrag, und alle drei sind welche, die
 * frueh kommen sollen -- beim Schreiben statt nach dem Zertifizierungslauf:
 *
 * 1. Nirgends im Quelltext steht ein Geheimniswert oder ein Weg, an einen zu
 *    kommen. Es gibt nur die Referenz.
 * 2. Es gibt keinen loeschenden Aufruf.
 * 3. Die Ansicht sagt woertlich, was eine Zustellung nicht traegt.
 */
const VIEW = path.resolve(process.cwd(), "components/console/database-webhooks-view.tsx");
const MODULE = path.resolve(process.cwd(), "lib/console/database-webhooks.ts");
const BRIDGE = path.resolve(process.cwd(), "lib/server/compute/database-webhook-bridge.ts");

async function view(): Promise<string> {
  return readFile(VIEW, "utf8");
}

describe("database webhooks view contract", () => {
  it("knows the reference and never a secret value", async () => {
    const source = await view();
    for (const forbidden of [/\bsigningSecret\b(?!Ref)/, /secretValue/i, /\bsecret:/,
      /reveal/i, /\bplaintext\b/i]) {
      expect(source, `Geheimnisweg im Quelltext: ${forbidden}`).not.toMatch(forbidden);
    }
    expect(source).toContain("signingSecretRef");
    // Das Eingabefeld heisst Referenz, und der Platzhalter zeigt eine Referenz.
    expect(source).toContain("vault:webhooks/bestellungen");
    expect(source).toContain("QKERN zeigt den Wert eines Signaturgeheimnisses nie");
  });

  it("has no deleting call and no delete control", async () => {
    const source = await view();
    const methods = [...source.matchAll(/method:\s*"([A-Z]+)"/g)].map((match) => match[1]);
    expect(methods.sort()).toEqual(["PATCH", "POST"]);
    expect(source).not.toMatch(/\bDELETE\b/);
    expect(source).not.toMatch(/Trash2/);
    expect(source).toContain("Löschen gibt es hier nicht.");
  });

  it("touches only its own routes and the existing delivery log", async () => {
    const source = await view();
    const targets = [...source.matchAll(/fetch\(`([^`]+)`/g)].map((match) => match[1]);
    expect(targets).toEqual([
      "${base}/database-webhooks",
      "${base}/webhooks/${hook.webhookId}/deliveries?limit=5",
      "${base}/database-webhooks",
      "${base}/database-webhooks/${hook.id}",
    ]);
    // Keine Route, die selbst lesen oder schreiben koennte.
    for (const forbidden of ["/query", "/rows", "/sql", "/apply", "/changesets"]) {
      expect(source, `fremde Route: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("writes no SQL of its own and builds no definition of its own", async () => {
    const source = await view();
    for (const forbidden of [/CREATE\s+TRIGGER/i, /CREATE\s+FUNCTION/i, /ALTER\s+TABLE/i,
      /\bINSERT\s+INTO\b/i, /\bDROP\b/i]) {
      expect(source, `SQL im Quelltext der Ansicht: ${forbidden}`).not.toMatch(forbidden);
    }
    // Geprueft wird mit demselben reinen Modul, das die Route anwendet.
    expect(source).toContain('from "@/lib/console/database-webhooks"');
    expect(source).toContain("validateDatabaseWebhook");
    // Was gesendet wird, ist genau der angezeigte Entwurf.
    expect(source).toContain("const draft = preview.draft;");
    expect(source).toContain("name: draft.name, table: draft.table, events: draft.events");
  });

  it("says plainly what a delivery does not carry and where the trigger is not", async () => {
    const source = await view();
    expect(source).toContain(
      "Sie trägt keinen weiteren Spaltenwert, kein Bild der Zeile vor der Änderung");
    expect(source).toContain(
      "QKERN legt dafür keinen zusätzlichen Trigger in Ihrer Datenbank an.");
    expect(source).toContain(
      "Eine Zustellung trägt genau sechs Angaben: Schema, Tabelle, Operation, die Werte des Primärschlüssels");
    // Und die eine bewusste Offenlegung steht daneben, statt verschwiegen zu werden.
    expect(source).toContain("Das ist die eine bewusste Offenlegung");
  });

  it("declares no field anywhere that a row value could live in", async () => {
    // Die Nutzlast hat genau sechs Felder, und der Typ sagt das. Ein
    // `record`, ein `old` oder ein `columns` waere der Weg, auf dem ein
    // Spaltenwert spaeter unbemerkt mitfuehre; es gibt ihn nicht.
    const payload = (await readFile(BRIDGE, "utf8"))
      .match(/export type DatabaseWebhookPayload = Readonly<\{([\s\S]*?)\n\}>;/);
    expect(payload, "DatabaseWebhookPayload nicht gefunden").not.toBeNull();
    const fields = [...payload![1].matchAll(/^\s{2}([a-zA-Z]+)[?]?:/gm)].map((match) => match[1]);
    expect(fields).toEqual(["schema", "table", "operation", "key", "position", "committedAt"]);

    const record = (await readFile(MODULE, "utf8"))
      .match(/export type DatabaseWebhookRecord = Readonly<\{([\s\S]*?)\n\}>;/);
    expect(record, "DatabaseWebhookRecord nicht gefunden").not.toBeNull();
    const stored = [...record![1].matchAll(/^\s{2}([a-zA-Z]+)[?]?:/gm)].map((match) => match[1]);
    expect(stored).not.toContain("signingSecret");
    for (const forbidden of ["record", "old", "columns", "row"]) {
      expect(stored, forbidden).not.toContain(forbidden);
    }
  });

  it("replaces the placeholder and routes the view", async () => {
    expect(Object.keys(PLACEHOLDERS)).not.toContain("int-webhooks");
    expect(REAL_VIEWS as readonly string[]).toContain("int-database-webhooks");
    const children = NAV.flatMap((group) => group.children ?? []);
    expect(children.some((child) => child.id === "int-database-webhooks")).toBe(true);
    const app = await readFile(
      path.resolve(process.cwd(), "components/console/console-app.tsx"), "utf8");
    expect(app).toContain('case "int-database-webhooks": return <DatabaseWebhooksView');
  });
});
