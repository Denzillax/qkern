import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildLogDrainBatch,
  LOG_DRAIN_SOURCE_DEFINITIONS,
  LOG_DRAIN_SOURCES,
  projectLogDrainEntry,
  type LogDrainSourceId,
} from "@/lib/console/log-drains";

/**
 * Die Grenze des Slices, als Vertrag (2.54).
 *
 * Ein Log-Drain darf genau die Felder weiterleiten, die die Console fuer
 * dieselbe Quelle schon zeigt. Dieser Vertrag laeuft **jedes** weitergeleitete
 * Feld ab und verlangt dafuer einen Eintrag in der Projektion der zugehoerigen
 * Ansicht -- gelesen aus deren Quelltext, nicht aus einer zweiten Liste, die
 * jemand danebenpflegen muesste.
 *
 * Das ist bewusst ein statischer Vergleich am Quelltext: Wer in der Ansicht ein
 * Feld entfernt, soll hier scheitern, und wer im Drain eines hinzufuegt,
 * ebenfalls. Dass die Zeilen aus der Datenbank wirklich so aussehen, belegt der
 * PostgreSQL-Fall "(2.63)"; hier geht es um die Liste.
 */
async function consoleType(file: string, name: string): Promise<string[]> {
  const source = await readFile(path.resolve(process.cwd(), file), "utf8");
  const head = source.indexOf(`type ${name} = {`);
  expect(head, `${file}: Typ ${name} nicht gefunden`).toBeGreaterThanOrEqual(0);
  const start = source.indexOf("{", head);
  let depth = 0;
  let end = start;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) { end = index; break; }
    }
  }
  // Nur die aeusserste Ebene: Ein verschachteltes Objekt ist eine eigene
  // Projektion, und ein Drain traegt ohnehin keine.
  const body = source.slice(start + 1, end);
  const fields: string[] = [];
  let level = 0;
  let token = "";
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === "{" || character === "<" || character === "(") level += 1;
    else if (character === "}" || character === ">" || character === ")") level -= 1;
    else if (level === 0 && character === ":" && /^[A-Za-z_][A-Za-z0-9_]*\??$/.test(token.trim())) {
      fields.push(token.trim().replace("?", ""));
      token = "";
      continue;
    }
    if (level === 0 && (character === ";" || character === "," || character === "\n")) token = "";
    else if (level === 0) token += character;
  }
  return fields;
}

async function projectionOf(source: LogDrainSourceId): Promise<Set<string>> {
  const definition = LOG_DRAIN_SOURCE_DEFINITIONS[source];
  const fields = new Set<string>();
  for (const name of definition.consoleTypes) {
    for (const field of await consoleType(definition.consoleView, name)) fields.add(field);
  }
  return fields;
}

describe("log drain field boundary", () => {
  it("forwards no field the corresponding console view does not show", async () => {
    for (const source of LOG_DRAIN_SOURCES) {
      const shown = await projectionOf(source);
      expect(shown.size, `${source}: leere Projektion gelesen`).toBeGreaterThan(2);
      for (const field of LOG_DRAIN_SOURCE_DEFINITIONS[source].fields) {
        expect([...shown], `${source}.${field} steht in keiner Console-Ansicht`)
          .toContain(field);
      }
    }
  });

  it("withholds fields the console does show, and says which", async () => {
    // Die Gegenprobe: Was zurueckgehalten wird, muss die Console **zeigen** --
    // sonst waere die Liste eine Beruhigung ueber etwas, das es nie gab.
    for (const source of LOG_DRAIN_SOURCES) {
      const shown = await projectionOf(source);
      const definition = LOG_DRAIN_SOURCE_DEFINITIONS[source];
      for (const field of definition.withheld) {
        if (!shown.has(field)) continue;
        expect(definition.fields, `${source}.${field} wird zugleich getragen und zurueckgehalten`)
          .not.toContain(field);
      }
    }
    // Und die drei, auf die es ankommt, stehen wirklich in beiden Rollen:
    // sichtbar in der Console, draussen im Drain.
    expect(await projectionOf("function_invocations")).toContain("invokedBy");
    expect(LOG_DRAIN_SOURCE_DEFINITIONS.function_invocations.fields).not.toContain("invokedBy");
    expect(await projectionOf("storage_objects")).toContain("ownerSubject");
    expect(LOG_DRAIN_SOURCE_DEFINITIONS.storage_objects.fields).not.toContain("ownerSubject");
    expect(LOG_DRAIN_SOURCE_DEFINITIONS.storage_objects.fields).not.toContain("bucketId");
  });

  it("drops every field of a row that is not on the list", async () => {
    // Die Whitelist entscheidet, nicht der Leser. Eine Zeile mit einer Spalte
    // zu viel -- so, wie sie aus einem versehentlichen `SELECT *` kaeme --
    // verliert sie hier.
    const entry = projectLogDrainEntry("auth_audit", {
      id: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
      createdAt: "2026-09-27T09:00:00.000Z",
      action: "project_auth.sign_in",
      actorType: "app_user",
      resourceRef: "project_auth_user:7b1c",
      status: "succeeded",
      actorRef: "kundin@example.com",
      metadata: { ip: "198.51.100.7" },
      password: "hunter2",
    });
    expect(Object.keys(entry).sort()).toEqual(
      ["action", "actorType", "createdAt", "id", "resourceRef", "status"]);
    expect(JSON.stringify(entry)).not.toContain("example.com");
    expect(JSON.stringify(entry)).not.toContain("hunter2");
    expect(JSON.stringify(entry)).not.toContain("198.51.100.7");
  });

  it("carries no nested object, because that is where a payload would hide", () => {
    const entry = projectLogDrainEntry("webhook_deliveries", {
      id: "1", eventType: "db.insert", status: "delivered", attemptCount: 1,
      lastFailureCode: null, occurredAt: "2026-09-27T09:00:00.000Z",
      settledAt: "2026-09-27T09:00:01.000Z",
      // Ein Leser, der sich irrt, koennte ein Objekt unter einem erlaubten
      // Namen liefern. Es faellt weg, statt mitzufahren.
      payload: { iban: "CH93-0076-2011-6238-5295-7" },
    });
    expect(entry).not.toHaveProperty("payload");
    expect(JSON.stringify(entry)).not.toContain("CH93");
  });

  it("drops a value that is neither a scalar nor short enough", () => {
    const entry = projectLogDrainEntry("storage_objects", {
      id: "obj", bucketName: "rechnungen", key: "x".repeat(1_025),
      sizeBytes: 12, contentType: "application/pdf", status: "clean",
      createdAt: "2026-09-27T09:00:00.000Z", deleteAfter: null, deletedAt: null,
    });
    expect(entry).not.toHaveProperty("key");
    expect(entry.bucketName).toBe("rechnungen");
    expect(entry.sizeBytes).toBe(12);
    expect(entry.deletedAt).toBeNull();
  });

  it("wraps a batch in a hull that carries no target, reference or secret", () => {
    const batch = buildLogDrainBatch("usage_series", [
      { metric: "api_requests", bucket: "hour", start: "2026-09-27T08:00:00.000Z",
        accepted: "1200", rejected: "0", events: 12 },
    ]);
    expect(Object.keys(batch).sort()).toEqual(["count", "entries", "schemaVersion", "source"]);
    expect(batch.count).toBe(1);
    expect(batch.schemaVersion).toBe(1);
    const encoded = JSON.stringify(batch);
    for (const forbidden of ["https://", "vault:", "signature", "secret"]) {
      expect(encoded, forbidden).not.toContain(forbidden);
    }
  });
});
