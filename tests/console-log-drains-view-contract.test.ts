import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { LOG_DRAIN_SOURCE_DEFINITIONS, LOG_DRAIN_SOURCES } from "@/lib/console/log-drains";

/**
 * Die Ansicht der Log-Drains (2.54) am Quelltext geprueft.
 *
 * Vier Zusicherungen, alle so frueh wie moeglich -- beim Schreiben statt nach
 * dem Zertifizierungslauf:
 *
 * 1. Nirgends im Quelltext steht ein Geheimniswert oder ein Weg, an einen zu
 *    kommen. Es gibt nur die Referenz.
 * 2. Es gibt keinen loeschenden Aufruf.
 * 3. Die Seite sagt woertlich, was ein Drain traegt, was er nie traegt und dass
 *    er keine Lueckenlosigkeit verspricht.
 * 4. Sie zeigt die Feldliste je Quelle, statt sie zu behaupten.
 */
const VIEW = path.resolve(process.cwd(), "components/console/log-drains-view.tsx");
const MODULE = path.resolve(process.cwd(), "lib/console/log-drains.ts");

async function view(): Promise<string> {
  return readFile(VIEW, "utf8");
}

describe("log drains view contract", () => {
  it("knows the reference and never a secret value", async () => {
    const source = await view();
    for (const forbidden of [/\bsigningSecret\b(?!Ref)/, /secretValue/i, /\bsecret:/,
      /reveal/i, /\bplaintext\b/i]) {
      expect(source, `Geheimnisweg im Quelltext: ${forbidden}`).not.toMatch(forbidden);
    }
    expect(source).toContain("signingSecretRef");
    expect(source).toContain("vault:log-drains/siem");
    expect(source).toContain("LOG_DRAIN_SECRET");
  });

  it("has no deleting call and no delete control", async () => {
    const source = await view();
    const methods = [...source.matchAll(/method:\s*"([A-Z]+)"/g)].map((match) => match[1]);
    expect(methods.sort()).toEqual(["PATCH", "POST"]);
    expect(source).not.toMatch(/\bDELETE\b/);
    expect(source).not.toMatch(/Trash2/);
    expect(source).toContain("LOG_DRAIN_NO_DELETE");
  });

  it("touches only its own routes and the existing delivery log", async () => {
    const source = await view();
    const targets = [...source.matchAll(/fetch\(`([^`]+)`/g)].map((match) => match[1]);
    expect(targets).toEqual([
      "${base}/log-drains",
      "${base}/webhooks/${drain.webhookId}/deliveries?limit=5",
      "${base}/log-drains",
      "${base}/log-drains/${drain.id}",
    ]);
    for (const forbidden of ["/query", "/rows", "/sql", "/apply", "/changesets", "/audit"]) {
      expect(source, `fremde Route: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("reads no log itself and builds no definition of its own", async () => {
    const source = await view();
    for (const forbidden of [/CREATE\s+TRIGGER/i, /ALTER\s+TABLE/i, /\bINSERT\s+INTO\b/i,
      /\bSELECT\b/, /\bDROP\b/i]) {
      expect(source, `SQL im Quelltext der Ansicht: ${forbidden}`).not.toMatch(forbidden);
    }
    // Geprueft wird mit demselben reinen Modul, das die Route anwendet.
    expect(source).toContain('from "@/lib/console/log-drains"');
    expect(source).toContain("validateLogDrain");
    // Was gesendet wird, ist genau der angezeigte Entwurf.
    expect(source).toContain("const draft = preview.draft;");
    expect(source).toContain("name: draft.name, url: draft.url, sources: draft.sources,");
  });

  it("shows the field list of every source instead of claiming one", async () => {
    const source = await view();
    expect(source).toContain("LOG_DRAIN_SOURCE_DEFINITIONS[source].fields.join(\", \")");
    expect(source).toContain("LOG_DRAIN_SOURCE_DEFINITIONS[source].withheld");
    // Und jede Quelle der festen Liste hat einen Text, sonst stuende in der
    // Tabelle eine leere Zeile.
    for (const id of LOG_DRAIN_SOURCES) {
      expect(LOG_DRAIN_SOURCE_DEFINITIONS[id].fields.length, id).toBeGreaterThan(3);
      expect(LOG_DRAIN_SOURCE_DEFINITIONS[id].consoleView, id).toMatch(/^components\/console\//);
    }
  });

  it("says plainly what a drain never carries and what it does not promise", async () => {
    const module = await readFile(MODULE, "utf8");
    expect(module).toContain("nie die Ausgabe eines Containers");
    expect(module).toContain("nie eine E-Mail-Adresse, nie ein Token und nie ein Geheimnis");
    expect(module).toContain("Ein Drain verspricht keine Lückenlosigkeit.");
    expect(module).toContain("Das Cron-Log steht nicht auf der Liste der Quellen.");
    const source = await view();
    for (const key of ["LOG_DRAIN_WHAT", "LOG_DRAIN_NEVER", "LOG_DRAIN_SAME_PATH",
      "LOG_DRAIN_NO_CRON", "LOG_DRAIN_GAPS"]) {
      expect(source, key).toContain(`t(${key})`);
    }
  });

  it("declares no field anywhere that a payload or a secret could live in", async () => {
    const module = await readFile(MODULE, "utf8");
    const record = module.match(/export type LogDrainRecord = Readonly<\{([\s\S]*?)\n\}>;/);
    expect(record, "LogDrainRecord nicht gefunden").not.toBeNull();
    const stored = [...record![1].matchAll(/^\s{2}([a-zA-Z]+)[?]?:/gm)].map((match) => match[1]);
    expect(stored).toContain("signingSecretRef");
    for (const forbidden of ["signingSecret", "payload", "fields", "filter", "record", "body"]) {
      expect(stored, forbidden).not.toContain(forbidden);
    }
  });

  it("replaces the placeholder and routes the view", async () => {
    expect(Object.keys(PLACEHOLDERS)).not.toContain("set-log-drains");
    expect(REAL_VIEWS as readonly string[]).toContain("set-log-drains");
    const children = NAV.flatMap((group) => group.children ?? []);
    expect(children.some((child) => child.id === "set-log-drains")).toBe(true);
    const app = await readFile(
      path.resolve(process.cwd(), "components/console/console-app.tsx"), "utf8");
    expect(app).toContain('case "set-log-drains": return <LogDrainsView');
  });
});
