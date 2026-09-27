import { describe, expect, it } from "vitest";
import {
  LOG_DRAIN_SCHEMA_VERSION,
  LOG_DRAIN_SOURCES,
  LogDrainError,
  logDrainEventType,
  logDrainTexts,
  validateLogDrain,
} from "@/lib/console/log-drains";

/**
 * Die Pruefung eines Log-Drains (2.54), rein und ohne Datenbank.
 *
 * Die Zielregel ist nicht neu geschrieben, sondern dieselbe, die der Zusteller
 * anwendet; geprueft wird hier, dass sie wirklich greift, und dass die
 * Quellenliste geschlossen ist. Eine offene Liste waere der Weg, auf dem
 * spaeter eine Quelle ohne Feldgrenze hereinkaeme.
 */
const valid = {
  name: "logs-an-siem",
  url: "https://siem.example.com/qkern/logs",
  sources: ["auth_audit"],
  signingSecretRef: "vault:log-drains/siem",
};

function reason(input: Record<string, unknown>): string {
  try {
    validateLogDrain(input as never);
  } catch (error) {
    if (error instanceof LogDrainError) return error.code;
    throw error;
  }
  return "ACCEPTED";
}

describe("log drain validation", () => {
  it("accepts a drain and orders the sources like the fixed list", () => {
    const draft = validateLogDrain({
      ...valid, sources: ["usage_series", "auth_audit", "storage_objects"],
    });
    expect(draft.sources).toEqual(["auth_audit", "storage_objects", "usage_series"]);
    expect(draft.eventTypes).toEqual([
      "log.auth_audit", "log.storage_objects", "log.usage_series",
    ]);
    expect(draft.enabled).toBe(true);
    expect(Object.isFrozen(draft)).toBe(true);
  });

  it("keeps every event type inside the 64 characters the delivery table allows", () => {
    for (const source of LOG_DRAIN_SOURCES) {
      const eventType = logDrainEventType(source);
      expect(eventType.length).toBeLessThanOrEqual(64);
      expect(eventType).toMatch(/^[a-z][a-z0-9._-]{0,63}$/);
    }
  });

  it("applies exactly the target rule the deliverer applies", () => {
    for (const url of [
      "http://siem.example.com/logs",
      "https://siem.example.com:8443/logs",
      "https://localhost/logs",
      "https://127.0.0.1/logs",
      "https://[::1]/logs",
      "https://user:pass@siem.example.com/logs",
      "https://siem.example.com/logs?token=abc",
      "https://siem.example.com/logs#fragment",
      "siem.example.com/logs",
      "",
    ]) {
      expect(reason({ ...valid, url }), url).toBe("INVALID_URL");
    }
    expect(reason({ ...valid, url: "https://siem.example.com/qkern/logs" })).toBe("ACCEPTED");
  });

  it("closes the source list against anything that is not on it", () => {
    expect(reason({ ...valid, sources: [] })).toBe("NO_SOURCES");
    expect(reason({ ...valid, sources: undefined })).toBe("NO_SOURCES");
    expect(reason({ ...valid, sources: "auth_audit" })).toBe("NO_SOURCES");
    expect(reason({ ...valid, sources: ["cron_occurrences"] })).toBe("UNKNOWN_SOURCE");
    expect(reason({ ...valid, sources: ["queue_messages"] })).toBe("UNKNOWN_SOURCE");
    expect(reason({ ...valid, sources: ["function_logs"] })).toBe("UNKNOWN_SOURCE");
    expect(reason({ ...valid, sources: [{ toString: () => "auth_audit" }] }))
      .toBe("UNKNOWN_SOURCE");
    expect(reason({ ...valid, sources: ["auth_audit", "auth_audit"] })).toBe("DUPLICATE_SOURCE");
  });

  it("refuses a hostile name and a reference that is not one", () => {
    for (const name of ["", " ", "AB", "a", "-drain", "Ä-drain", "a".repeat(64),
      "drain; DROP TABLE", "drain\nzweite"]) {
      expect(reason({ ...valid, name }), JSON.stringify(name)).toBe("INVALID_NAME");
    }
    for (const signingSecretRef of ["", "ab", "1vault", "vault:secret space",
      "vault:sec\nret", "a".repeat(129)]) {
      expect(reason({ ...valid, signingSecretRef }), signingSecretRef).toBe("INVALID_SECRET_REF");
    }
  });

  it("has no input and no output in which a secret value could travel", () => {
    // Der Entwurf hat kein Feld fuer einen Wert, und ein mitgeschicktes Feld
    // kommt nicht durch: Der Entwurf wird gebaut, nicht durchgereicht.
    const draft = validateLogDrain({
      ...valid,
      // @ts-expect-error -- genau das ist der Punkt: Es gibt das Feld nicht.
      signingSecret: "s3cret-value-that-must-not-travel",
    });
    expect(JSON.stringify(draft)).not.toContain("s3cret-value");
    expect(Object.keys(draft).sort()).toEqual(
      ["enabled", "eventTypes", "name", "signingSecretRef", "sources", "url"]);
  });

  it("names a reason for every rejection, and the reason never carries the value", () => {
    for (const code of ["INVALID_NAME", "INVALID_URL", "INVALID_SECRET_REF", "NO_SOURCES",
      "UNKNOWN_SOURCE", "DUPLICATE_SOURCE"] as const) {
      const error = new LogDrainError(code);
      expect(error.reason.length).toBeGreaterThan(30);
      expect(error.message).toBe(`LOG_DRAIN_REJECTED:${code}`);
    }
    // Jeder Text der Flaeche steht in der Liste fuer den Uebersetzungsvertrag.
    expect(logDrainTexts().length).toBeGreaterThan(15);
    for (const text of logDrainTexts()) expect(text.trim()).not.toBe("");
  });

  it("carries a schema version, so a receiver is not surprised by a change", () => {
    expect(LOG_DRAIN_SCHEMA_VERSION).toBe(1);
  });
});
