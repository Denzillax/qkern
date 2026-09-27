import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDashboardEventNotice,
  DASHBOARD_EVENT_DEFINITIONS,
  DASHBOARD_EVENT_KINDS,
  dashboardEventKindOfAction,
  dashboardEventType,
  projectDashboardEvent,
  type DashboardEventKind,
} from "@/lib/console/dashboard-webhooks";

/**
 * Die Grenze des Dashboard-Webhook-Slices, als Vertrag (2.75).
 *
 * Ein Dashboard-Webhook darf genau die Felder melden, die die Console fuer
 * denselben Vorgang schon zeigt. Dieser Vertrag laeuft **jedes** gemeldete Feld
 * ab und verlangt dafuer einen Eintrag im Zeilentyp der zugehoerigen Ansicht --
 * gelesen aus deren Quelltext, nicht aus einer zweiten Liste, die jemand
 * danebenpflegen muesste.
 *
 * Das ist bewusst ein statischer Vergleich am Quelltext, wie bei den Log-Drains
 * (2.54): Wer in der Ansicht ein Feld entfernt, soll hier scheitern, und wer in
 * der Meldung eines hinzufuegt, ebenfalls. Dass die Zeilen aus der echten
 * Audit-Kette wirklich so aussehen, belegt der PostgreSQL-Fall "(2.75)"; hier
 * geht es um die Liste.
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
  // Projektion, und eine Meldung traegt ohnehin keine.
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

async function projectionOf(kind: DashboardEventKind): Promise<Set<string>> {
  const fields = new Set<string>();
  for (const source of DASHBOARD_EVENT_DEFINITIONS[kind].consoleSources) {
    for (const name of source.types) {
      for (const field of await consoleType(source.view, name)) fields.add(field);
    }
  }
  return fields;
}

describe("dashboard webhook field boundary", () => {
  it("reports no field the corresponding console view does not show", async () => {
    for (const kind of DASHBOARD_EVENT_KINDS) {
      const shown = await projectionOf(kind);
      expect(shown.size, `${kind}: leere Projektion gelesen`).toBeGreaterThan(2);
      for (const field of DASHBOARD_EVENT_DEFINITIONS[kind].fields) {
        expect([...shown], `${kind}.${field} steht in keinem Zeilentyp der Console`)
          .toContain(field);
      }
    }
  });

  it("takes every metadata key from the same positive list", () => {
    // Ein Schluessel aus `redacted_metadata` ist kein Sonderweg: Er muss auf
    // derselben Liste stehen wie jedes andere Feld, sonst waere die Liste die
    // halbe Wahrheit.
    for (const kind of DASHBOARD_EVENT_KINDS) {
      const definition = DASHBOARD_EVENT_DEFINITIONS[kind];
      for (const key of definition.metadataFields) {
        expect(definition.fields, `${kind}.${key} ist kein gemeldetes Feld`).toContain(key);
      }
    }
  });

  it("withholds fields the console does show, and says which", async () => {
    // Die Gegenprobe: Was zurueckgehalten wird, muss die Console **zeigen** --
    // sonst waere die Liste eine Beruhigung ueber etwas, das es nie gab.
    for (const kind of DASHBOARD_EVENT_KINDS) {
      const shown = await projectionOf(kind);
      const definition = DASHBOARD_EVENT_DEFINITIONS[kind];
      for (const field of definition.withheld) {
        if (!shown.has(field)) continue;
        expect(definition.fields, `${kind}.${field} wird zugleich gemeldet und zurueckgehalten`)
          .not.toContain(field);
      }
    }
    // Und die drei, auf die es ankommt, stehen wirklich in beiden Rollen:
    // sichtbar in der Console, draussen in der Meldung.
    //
    // `actor` ist die Referenz des Menschen, der gehandelt hat, und die
    // Audit-Ansicht zeigt sie in einer eigenen Spalte. Sie geht bei **keiner**
    // Ereignisart hinaus.
    for (const kind of DASHBOARD_EVENT_KINDS) {
      expect(await projectionOf(kind), `${kind}: actor`).toContain("actor");
      expect(DASHBOARD_EVENT_DEFINITIONS[kind].fields, `${kind}: actor`).not.toContain("actor");
    }
    expect(await projectionOf("approval_decided")).toContain("actionHash");
    expect(DASHBOARD_EVENT_DEFINITIONS.approval_decided.fields).not.toContain("actionHash");
    expect(await projectionOf("environment_added")).toContain("databaseInstanceRef");
    expect(DASHBOARD_EVENT_DEFINITIONS.environment_added.fields)
      .not.toContain("databaseInstanceRef");
  });

  it("maps every audit action to exactly one kind", () => {
    // Zwei Arten mit derselben Handlung hiessen: dasselbe Ereignis zweimal, mit
    // zwei Namen und zwei Positionen.
    const seen = new Map<string, DashboardEventKind>();
    for (const kind of DASHBOARD_EVENT_KINDS) {
      for (const action of DASHBOARD_EVENT_DEFINITIONS[kind].auditActions) {
        expect(seen.has(action), `${action} steht bei zwei Arten`).toBe(false);
        seen.set(action, kind);
        expect(dashboardEventKindOfAction(action)).toBe(kind);
      }
    }
    expect(dashboardEventKindOfAction("project_auth.sign_in")).toBeNull();
    // Die Zwischenstaende eines Migrationslaufs loesen ausdruecklich nichts aus.
    expect(dashboardEventKindOfAction("migration.apply.queued")).toBeNull();
    expect(dashboardEventKindOfAction("migration.apply.retry_scheduled")).toBeNull();
    expect(dashboardEventKindOfAction("migration.apply.review_required")).toBeNull();
  });

  it("keeps every event type inside the column the outbox has", () => {
    for (const kind of DASHBOARD_EVENT_KINDS) {
      const eventType = dashboardEventType(kind);
      expect(eventType.length, eventType).toBeLessThanOrEqual(64);
      expect(eventType.startsWith("project.")).toBe(true);
    }
  });

  it("drops every field of an audit entry that is not on the list", () => {
    // Die Whitelist entscheidet, nicht der Leser. Ein Eintrag mit einer Spalte
    // zu viel -- so, wie er aus einem versehentlichen `SELECT *` kaeme --
    // verliert sie hier. Der Lackmustest ist `actor`: eine E-Mail-Adresse.
    const entry = projectDashboardEvent("approval_decided", {
      id: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
      createdAt: "2026-09-27T09:00:00.000Z",
      action: "approval.approved",
      status: "success",
      environment: "production",
      projectId: "7b1c0f1e-2d3c-4b5a-8978-8796a5b4c3d2",
      resource: "3c4b5a69-788a-4796-a5b4-c3d2e1f00f1e",
      risk: "high",
      actor: "entscheiderin@example.com",
      actionHash: "b".repeat(64),
      entryHash: "c".repeat(64),
      previousHash: "d".repeat(64),
    });
    expect(Object.keys(entry).sort()).toEqual(
      ["action", "createdAt", "environment", "id", "projectId", "resource", "risk", "status"]);
    expect(JSON.stringify(entry)).not.toContain("example.com");
    expect(JSON.stringify(entry)).not.toContain("b".repeat(64));
    expect(JSON.stringify(entry)).not.toContain("c".repeat(64));
  });

  it("carries no nested object, because that is where a statement would hide", () => {
    const entry = projectDashboardEvent("migration_applied", {
      id: "1f2e3d4c-5b6a-7988-9796-a5b4c3d2e1f0",
      createdAt: "2026-09-27T09:00:00.000Z",
      action: "migration.apply.completed",
      status: "success",
      environment: "production",
      projectId: "7b1c0f1e-2d3c-4b5a-8978-8796a5b4c3d2",
      resource: "4c5b6a79-889a-4796-a5b4-c3d2e1f01f2e",
      changeSetId: "5b6a7988-9796-45b4-a3d2-e1f01f2e3d4c",
      errorCode: null,
      // Ein Leser, der sich irrt, koennte ein Objekt unter einem erlaubten
      // Namen liefern. Es faellt weg, statt mitzufahren.
      executorResult: { statement: "DROP TABLE kunden" },
    });
    expect(entry).not.toHaveProperty("executorResult");
    expect(entry.errorCode).toBeNull();
    expect(JSON.stringify(entry)).not.toContain("DROP TABLE");
  });

  it("drops a value that is neither a scalar nor short enough", () => {
    const entry = projectDashboardEvent("project_state_changed", {
      id: "2f3e4d5c-6b7a-8998-9796-a5b4c3d2e1f0",
      createdAt: "2026-09-27T09:00:00.000Z",
      action: "project.database.provisioning_failed",
      status: "failed",
      environment: "staging",
      projectId: "7b1c0f1e-2d3c-4b5a-8978-8796a5b4c3d2",
      resource: "x".repeat(321),
    });
    expect(entry).not.toHaveProperty("resource");
    expect(entry.status).toBe("failed");
    expect(entry.environment).toBe("staging");
  });

  it("wraps a notice in a hull that carries no target, reference or secret", () => {
    const notice = buildDashboardEventNotice("environment_added", {
      id: "3f4e5d6c-7b8a-9aa8-9796-a5b4c3d2e1f0",
      createdAt: "2026-09-27T09:00:00.000Z",
      action: "project.database.provisioned",
      status: "succeeded",
      environment: "development",
      projectId: "7b1c0f1e-2d3c-4b5a-8978-8796a5b4c3d2",
      resource: "6c7b8a9a-a896-4796-a5b4-c3d2e1f02f3e",
      databaseInstanceRef: "managed:7b1c0f1e-2d3c-4b5a-8978-8796a5b4c3d2",
      bootstrapContractSha256: "e".repeat(64),
    });
    expect(Object.keys(notice).sort()).toEqual(["event", "kind", "schemaVersion"]);
    expect(notice.kind).toBe("environment_added");
    expect(notice.schemaVersion).toBe(1);
    // Der gespeicherte Zustand geht hinaus, nicht der Badge der Ansicht: Die
    // Faltung auf drei Werte wuerde aus `succeeded` ein `blocked` machen.
    expect(notice.event.status).toBe("succeeded");
    const encoded = JSON.stringify(notice);
    for (const forbidden of ["https://", "vault:", "signature", "secret", "managed:", "e".repeat(64)]) {
      expect(encoded, forbidden).not.toContain(forbidden);
    }
  });
});
