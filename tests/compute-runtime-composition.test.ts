import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  computeScopesFromEnv,
  createComputeRuntimeFromEnv,
} from "@/lib/server/compute/runtime-composition";
import { ConfigurationError } from "@/lib/server/db/errors";

function scopes(...entries: Array<Record<string, unknown>>) {
  return JSON.stringify(entries);
}

const organizationId = randomUUID();
const projectId = randomUUID();

describe("computeScopesFromEnv", () => {
  it("reads the scopes a compute process should serve", () => {
    const parsed = computeScopesFromEnv({
      QKERN_COMPUTE_SCOPES_JSON: scopes({ organizationId, projectId, environment: "production" }),
    });
    expect(parsed).toEqual([{ organizationId, projectId, environment: "production" }]);
  });

  it("requires the list, because nothing is discovered automatically", () => {
    // Die Runtime-Rolle sieht durch RLS nur die eigene Organisation; eine
    // organisationsuebergreifende Suche nach faelliger Arbeit ginge nur mit
    // einer Rolle, die alles sieht.
    expect(() => computeScopesFromEnv({})).toThrow(ConfigurationError);
  });

  it("refuses an entry that is not a well-formed scope", () => {
    for (const entry of [
      { organizationId: "not-a-uuid", projectId, environment: "production" },
      { organizationId, projectId, environment: "sandbox" },
      { organizationId, environment: "production" },
    ]) {
      expect(() => computeScopesFromEnv({ QKERN_COMPUTE_SCOPES_JSON: scopes(entry) }))
        .toThrow(ConfigurationError);
    }
  });

  it("refuses a duplicate scope so two loops do not fight over the same work", () => {
    const entry = { organizationId, projectId, environment: "development" };
    expect(() => computeScopesFromEnv({ QKERN_COMPUTE_SCOPES_JSON: scopes(entry, entry) }))
      .toThrow(ConfigurationError);
  });

  it("refuses an empty or oversized list", () => {
    expect(() => computeScopesFromEnv({ QKERN_COMPUTE_SCOPES_JSON: "[]" })).toThrow(ConfigurationError);
    const many = Array.from({ length: 33 }, () => ({
      organizationId: randomUUID(), projectId: randomUUID(), environment: "development",
    }));
    expect(() => computeScopesFromEnv({ QKERN_COMPUTE_SCOPES_JSON: JSON.stringify(many) }))
      .toThrow(ConfigurationError);
  });
});

describe("createComputeRuntimeFromEnv", () => {
  const base = {
    QKERN_COMPUTE_RUNTIME_ENABLED: "true",
    QKERN_RUNTIME_MODE: "postgres",
    QKERN_COMPUTE_SCOPES_JSON: scopes({ organizationId, projectId, environment: "development" }),
  };

  /**
   * Die Meldung wird mitgeprueft, nicht nur die Fehlerklasse. Sonst koennte ein
   * Fall gruen sein, weil die Konfiguration schon an einer ganz anderen Stelle
   * scheitert — etwa an einer fehlenden Datenbankadresse.
   */
  it("refuses to start without the explicit opt-in", () => {
    expect(() => createComputeRuntimeFromEnv({ ...base, QKERN_COMPUTE_RUNTIME_ENABLED: undefined }))
      .toThrow(/QKERN_COMPUTE_RUNTIME_ENABLED/);
  });

  it("refuses a runtime mode without a durable store", () => {
    // Ein Zustellprozess ueber einem fluechtigen Speicher wuerde bei jedem
    // Neustart Zustellungen verlieren.
    expect(() => createComputeRuntimeFromEnv({ ...base, QKERN_RUNTIME_MODE: "memory" }))
      .toThrow(/PostgreSQL runtime mode/);
  });

  it("refuses a configuration in which both loops are off", () => {
    expect(() => createComputeRuntimeFromEnv({
      ...base, QKERN_COMPUTE_CRON_ENABLED: "false", QKERN_COMPUTE_WEBHOOKS_ENABLED: "false",
    })).toThrow(/would do nothing/);
  });

  it("refuses an implausible worker identity before opening a pool", () => {
    expect(() => createComputeRuntimeFromEnv({ ...base, QKERN_COMPUTE_WORKER_ID: "worker id!" }))
      .toThrow(/worker identity/);
  });

  /**
   * Die Webhook-Bruecke (2.53) braucht eine Verbindung zu den
   * Projektdatenbanken. Ohne sie sagt die Komposition es, statt die Bruecke
   * vorhanden aussehen zu lassen und nichts zu tun -- genau dieser Zustand war
   * der Anlass des Slices.
   */
  it("refuses the database webhook bridge without a project database connection", () => {
    expect(() => createComputeRuntimeFromEnv({
      ...base, QKERN_COMPUTE_DATABASE_WEBHOOKS_ENABLED: "true",
    })).toThrow(/project database connection/);
  });

  it("refuses the database webhook bridge without the delivery loop that empties its outbox", () => {
    expect(() => createComputeRuntimeFromEnv({
      ...base,
      QKERN_COMPUTE_DATABASE_WEBHOOKS_ENABLED: "true",
      QKERN_COMPUTE_WEBHOOKS_ENABLED: "false",
    })).toThrow(/webhook delivery loop/);
  });

  it("refuses an implausible bridge interval before opening a pool", () => {
    expect(() => createComputeRuntimeFromEnv({
      ...base, QKERN_COMPUTE_DATABASE_WEBHOOK_POLL_MS: "10",
    })).toThrow(ConfigurationError);
  });
});
