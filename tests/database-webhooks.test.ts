import { describe, expect, it } from "vitest";
import {
  DATABASE_WEBHOOK_EVENTS,
  DATABASE_WEBHOOK_REASONS,
  DATABASE_WEBHOOK_SCHEMA,
  DatabaseWebhookError,
  databaseWebhookEventType,
  databaseWebhookTexts,
  validateDatabaseWebhook,
} from "@/lib/console/database-webhooks";
import { isDeliverableWebhookTarget } from "@/lib/server/compute/webhooks";

/**
 * Die Pruefung eines Datenbank-Webhooks (2.50), rein und ohne Datenbank.
 *
 * Der Weg von einem Eingabefeld zu einem Ziel im Internet ist die
 * gefaehrlichste Stelle dieses Slices: Was hier durchkommt, bekommt spaeter
 * signierte Nachrichten von QKERN. Er liegt darum an einer Stelle, ohne React,
 * ohne fetch, ohne Datenbank, und ist einzeln pruefbar.
 */
const valid = {
  name: "bestellungen-an-erp",
  table: "bestellungen",
  events: ["insert", "update"],
  url: "https://empfaenger.example.com/hooks/qkern",
  signingSecretRef: "vault:webhooks/bestellungen",
};

function reason(input: Parameters<typeof validateDatabaseWebhook>[0]): string {
  try {
    validateDatabaseWebhook(input);
  } catch (error) {
    if (error instanceof DatabaseWebhookError) return error.code;
    throw error;
  }
  return "ACCEPTED";
}

describe("database webhook definition", () => {
  it("accepts a definition and normalises it", () => {
    const draft = validateDatabaseWebhook(valid);
    expect(draft.name).toBe("bestellungen-an-erp");
    expect(draft.schema).toBe(DATABASE_WEBHOOK_SCHEMA);
    expect(draft.table).toBe("bestellungen");
    expect(draft.events).toEqual(["insert", "update"]);
    expect(draft.eventTypes).toEqual(["db.insert", "db.update"]);
    expect(draft.enabled).toBe(true);
  });

  it("orders the events like the fixed list, not like the input", () => {
    // Zwei gleichbedeutende Definitionen sollen gleich aussehen. Der CHECK in
    // 0048 schreibt dieselbe Reihenfolge fest; faellt sie hier, faellt sie dort.
    const draft = validateDatabaseWebhook({ ...valid, events: ["delete", "insert"] });
    expect(draft.events).toEqual(["insert", "delete"]);
    expect(draft.eventTypes).toEqual(["db.insert", "db.delete"]);
  });

  it("trims the surroundings but not the inside", () => {
    const draft = validateDatabaseWebhook({
      ...valid, name: "  bestellungen-an-erp  ", table: " bestellungen ",
      url: " https://empfaenger.example.com/hooks/qkern ",
      signingSecretRef: " vault:webhooks/bestellungen ",
    });
    expect(draft.name).toBe("bestellungen-an-erp");
    expect(draft.table).toBe("bestellungen");
    expect(reason({ ...valid, table: "bestel lungen" })).toBe("INVALID_TABLE");
  });

  it("keeps the event list closed", () => {
    expect(DATABASE_WEBHOOK_EVENTS).toEqual(["insert", "update", "delete"]);
    expect(reason({ ...valid, events: [] })).toBe("NO_EVENTS");
    expect(reason({ ...valid, events: ["truncate"] })).toBe("UNKNOWN_EVENT");
    expect(reason({ ...valid, events: ["INSERT"] })).toBe("UNKNOWN_EVENT");
    expect(reason({ ...valid, events: ["insert", "insert"] })).toBe("DUPLICATE_EVENT");
    expect(reason({ ...valid, events: [null as unknown as string] })).toBe("UNKNOWN_EVENT");
    expect(reason({ ...valid, events: "insert" as unknown as string[] })).toBe("NO_EVENTS");
  });

  it("names the event type without the table, so a long name cannot break it", () => {
    // `project_webhook_deliveries.event_type` laesst 64 Zeichen zu, ein
    // Tabellenname bis 63. Stuende er im Typ, waere ein langer Name genau der
    // Fall, der erst im Betrieb auffiele.
    const table = "t".repeat(63);
    const draft = validateDatabaseWebhook({ ...valid, table, events: ["delete"] });
    expect(draft.eventTypes).toEqual(["db.delete"]);
    for (const event of DATABASE_WEBHOOK_EVENTS) {
      expect(databaseWebhookEventType(event)).toMatch(/^[a-z][a-z0-9._-]{0,63}$/);
    }
  });

  it("refuses a table name that could leave its quotes", () => {
    for (const table of [
      'bestellungen"; DROP SCHEMA public CASCADE; --',
      "bestellungen; DELETE FROM x",
      "bestellungen--",
      "bestellungen'",
      "бestellungen",
      "ｂestellungen",
      "b".repeat(64),
      "",
      "1bestellungen",
      "public.bestellungen",
    ]) {
      expect(reason({ ...valid, table }), table).toBe("INVALID_TABLE");
    }
  });

  it("applies exactly the deliverer's rule to the target", () => {
    for (const url of [
      "http://empfaenger.example.com/hooks",
      "https://localhost/hooks",
      "https://127.0.0.1/hooks",
      "https://[::1]/hooks",
      "https://10.0.0.5/hooks",
      "https://empfaenger.example.com:8443/hooks",
      "https://user:pass@empfaenger.example.com/hooks",
      "https://empfaenger.example.com/hooks?a=1",
      "https://empfaenger.example.com/hooks#teil",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "",
      "not a url",
    ]) {
      expect(reason({ ...valid, url }), url).toBe("INVALID_URL");
      // Dieselbe Antwort wie beim Zusteller. Fielen beide auseinander,
      // entstuende ein Webhook, den der Betrieb stumm bei jedem Versuch
      // abweist -- das saehe aus wie ein defekter Empfaenger.
      expect(isDeliverableWebhookTarget(url), url).toBe(false);
    }
    expect(reason({ ...valid, url: "https://empfaenger.example.com:443/hooks" })).toBe("ACCEPTED");
  });

  it("takes a reference for the signing secret and has no field for a value", () => {
    expect(reason({ ...valid, signingSecretRef: "" })).toBe("INVALID_SECRET_REF");
    expect(reason({ ...valid, signingSecretRef: "ab" })).toBe("INVALID_SECRET_REF");
    expect(reason({ ...valid, signingSecretRef: "vault:webhooks/bestellungen mit leer" }))
      .toBe("INVALID_SECRET_REF");
    expect(reason({ ...valid, signingSecretRef: "a".repeat(129) })).toBe("INVALID_SECRET_REF");
    // Der Entwurf traegt keinen Schluessel, der einen Wert aufnehmen koennte.
    expect(Object.keys(validateDatabaseWebhook(valid))).toEqual([
      "name", "schema", "table", "events", "eventTypes", "url", "signingSecretRef", "enabled",
    ]);
  });

  it("refuses a name outside the grammar of the neighbouring definitions", () => {
    for (const name of ["", "ab", "Bestellungen", "bestellungen.erp", "1bestellungen",
      "b".repeat(64), "bestellungen erp"]) {
      expect(reason({ ...valid, name }), name).toBe("INVALID_NAME");
    }
  });

  it("survives a hostile shape without a prototype", () => {
    const hostile = Object.assign(Object.create(null), valid) as typeof valid;
    expect(validateDatabaseWebhook(hostile).table).toBe("bestellungen");
    expect(reason({} as unknown as typeof valid)).toBe("INVALID_NAME");
    expect(reason({ ...valid, name: 42 as unknown as string })).toBe("INVALID_NAME");
    expect(reason({ ...valid, table: { toString: () => "bestellungen" } as unknown as string }))
      .toBe("INVALID_TABLE");
  });

  it("carries the reason but never the rejected value", () => {
    try {
      validateDatabaseWebhook({ ...valid, table: 'x"; DROP TABLE y; --' });
      expect.unreachable("der feindliche Name haette abgewiesen werden muessen");
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseWebhookError);
      const rejected = error as DatabaseWebhookError;
      expect(rejected.reason).toBe(DATABASE_WEBHOOK_REASONS.INVALID_TABLE);
      expect(`${rejected.message} ${rejected.reason}`).not.toContain("DROP TABLE");
    }
  });

  it("offers every reason to the translation contract", () => {
    expect(databaseWebhookTexts()).toEqual(Object.values(DATABASE_WEBHOOK_REASONS));
    for (const text of databaseWebhookTexts()) expect(text.length).toBeGreaterThan(20);
  });
});
