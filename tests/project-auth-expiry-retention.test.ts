import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ProjectAuthScope } from "@/lib/server/project-auth/model";
import {
  ProjectAuthExpiryRetentionRuntime,
  type ProjectAuthExpiryStore,
} from "@/lib/server/project-auth/expiry-retention";
import { SAML_CLOCK_SKEW_MS } from "@/lib/server/project-auth/saml";

/**
 * Der Aufraeumer abgelaufener Einmal-Artefakte (2.89) ohne Datenbank.
 *
 * Hier stehen die Entscheidungen, die keine Datenbank braucht: der Stichtag aus
 * Uhr und Frist, die Haeppchen mit Obergrenze, die Reihenfolge Token vor Code,
 * und dass eine klemmende Umgebung die uebrigen nicht aufhaelt. Was nur die
 * echte Datenbank zeigen kann -- welche Zeilen wirklich fallen und welche
 * Rolle das darf -- steht in `postgres.integration.test.ts`.
 */

const scope = (): ProjectAuthScope => ({
  organizationId: randomUUID(), projectId: randomUUID(), environment: "development",
});

type Call = { table: string; expiredBefore: Date; limit: number };

/** Ein Vorrat je Tabelle, der sich haeppchenweise leeren laesst. */
function recordingStore(
  stock: { oneTime?: number; tokens?: number; codes?: number; assertions?: number },
) {
  const calls: Call[] = [];
  const left = {
    oneTime: stock.oneTime ?? 0, tokens: stock.tokens ?? 0,
    codes: stock.codes ?? 0, assertions: stock.assertions ?? 0,
  };
  const take = (table: keyof typeof left, name: string) =>
    async (_scope: ProjectAuthScope, expiredBefore: Date, limit: number) => {
      calls.push({ table: name, expiredBefore, limit });
      const removed = Math.min(left[table], limit);
      left[table] -= removed;
      return removed;
    };
  const store: ProjectAuthExpiryStore = {
    deleteExpiredOneTimeTokens: take("oneTime", "one_time_tokens"),
    deleteExpiredOAuthTokens: take("tokens", "oauth_tokens"),
    deleteExpiredOAuthCodes: take("codes", "oauth_codes"),
    deleteExpiredSamlAssertions: take("assertions", "saml_assertions"),
  };
  return { store, calls, left };
}

describe("project auth expiry retention", () => {
  it("cuts at the clock minus the grace, never at the expiry itself", async () => {
    const now = new Date("2026-09-28T12:00:00.000Z");
    const { store, calls } = recordingStore({ oneTime: 1 });
    const runtime = new ProjectAuthExpiryRetentionRuntime({
      store, scopes: [scope()], graceMs: 86_400_000, batchSize: 100, maxBatches: 3, now: () => now,
    });

    const removed = await runtime.runOnce();

    expect(removed).toEqual({
      oneTimeTokens: 1, oauthTokens: 0, oauthCodes: 0, samlAssertions: 0,
    });
    // 24 Stunden vor der Uhr. Eine Zeile, die vor einer Sekunde ablief, ist der
    // Gegenstand der Fehlersuche, die gerade anfaengt.
    for (const call of calls) {
      expect(call.expiredBefore.toISOString()).toBe("2026-09-27T12:00:00.000Z");
    }
  });

  it("never cuts the saml replay bar earlier than the assertion behind it can still be accepted", async () => {
    // Der Riegel gegen Wiedereinreichung ist die Zeile selbst, und sein
    // Ablauf ist das `NotOnOrAfter` der Assertion. Annehmbar ist dieselbe
    // Assertion aber noch `SAML_CLOCK_SKEW_MS` darueber hinaus: Abgewiesen
    // wird erst bei `NotOnOrAfter <= now - SAML_CLOCK_SKEW_MS`. Faellt die
    // Zeile in diesem Fenster, bekommt eine zweite Einreichung eine Sitzung.
    const now = new Date("2026-09-28T12:00:00.000Z");
    const { store, calls } = recordingStore({ assertions: 1 });
    // Die kuerzeste Frist, die diese Klasse ueberhaupt zulaesst. Wenn die
    // Rechnung hier aufgeht, geht sie fuer jede erlaubte Frist auf.
    const runtime = new ProjectAuthExpiryRetentionRuntime({
      store, scopes: [scope()], graceMs: 60_000, batchSize: 100, maxBatches: 1, now: () => now,
    });

    const removed = await runtime.runOnce();

    expect(removed.samlAssertions).toBe(1);
    const bar = calls.find((call) => call.table === "saml_assertions");
    expect(bar, "Der Aufraeumer nimmt die Assertionstabelle nicht mit").toBeTruthy();
    // Geloescht wird bei `expires_at < expiredBefore`. Der Stichtag muss
    // spaetestens auf der Grenze liegen, an der die Pruefung ohnehin abweist.
    expect(bar!.expiredBefore.getTime())
      .toBeLessThanOrEqual(now.getTime() - SAML_CLOCK_SKEW_MS);
    // Und die Untergrenze der Frist ist genau diese Grenze. Ein Betreiber
    // kann sie darum nicht unterlaufen, auch nicht mit Absicht.
    expect(() => new ProjectAuthExpiryRetentionRuntime({
      store, scopes: [scope()], graceMs: SAML_CLOCK_SKEW_MS - 1, batchSize: 100, maxBatches: 1,
    })).toThrow(RangeError);
  });

  it("removes the expired oauth tokens before the codes they hang on", async () => {
    const { store, calls } = recordingStore({ tokens: 1, codes: 1 });
    const runtime = new ProjectAuthExpiryRetentionRuntime({
      store, scopes: [scope()], graceMs: 86_400_000, batchSize: 100, maxBatches: 1,
    });

    await runtime.runOnce();

    // Die Reihenfolge ist keine Geschmacksfrage: `code_id` haengt mit
    // ON DELETE CASCADE am Code, und ein Code lebt Minuten, das Token daraus
    // bis zu zwoelf Stunden.
    expect(calls.map((call) => call.table))
      .toEqual(["one_time_tokens", "oauth_tokens", "oauth_codes", "saml_assertions"]);
  });

  it("works in batches and stops at the cap instead of taking a table in one statement", async () => {
    const { store, calls, left } = recordingStore({ oneTime: 1_000 });
    const runtime = new ProjectAuthExpiryRetentionRuntime({
      store, scopes: [scope()], graceMs: 86_400_000, batchSize: 10, maxBatches: 3,
    });

    const removed = await runtime.runOnce();

    expect(removed.oneTimeTokens).toBe(30);
    // Der Rest bleibt fuer die naechste Runde liegen; genau dafuer ist die
    // Obergrenze da.
    expect(left.oneTime).toBe(970);
    const oneTimeCalls = calls.filter((call) => call.table === "one_time_tokens");
    expect(oneTimeCalls).toHaveLength(3);
    expect(oneTimeCalls.every((call) => call.limit === 10)).toBe(true);
  });

  it("stops asking a table as soon as a batch comes back short", async () => {
    const { store, calls } = recordingStore({ oneTime: 4 });
    const runtime = new ProjectAuthExpiryRetentionRuntime({
      store, scopes: [scope()], graceMs: 86_400_000, batchSize: 10, maxBatches: 5,
    });

    await runtime.runOnce();

    expect(calls.filter((call) => call.table === "one_time_tokens")).toHaveLength(1);
  });

  it("keeps the other environments running when one of them fails, and says so without the cause", async () => {
    const good = scope();
    const bad = scope();
    const failures: number[] = [];
    const pruned: Array<{ scopeIndex: number; oneTimeTokens: number }> = [];
    const store: ProjectAuthExpiryStore = {
      async deleteExpiredOneTimeTokens(target) {
        if (target.organizationId === bad.organizationId) {
          throw new Error("relation project_auth_one_time_tokens does not exist");
        }
        return 2;
      },
      async deleteExpiredOAuthTokens() { return 0; },
      async deleteExpiredOAuthCodes() { return 0; },
      async deleteExpiredSamlAssertions() { return 0; },
    };
    const runtime = new ProjectAuthExpiryRetentionRuntime({
      store, scopes: [bad, good], graceMs: 86_400_000, batchSize: 10, maxBatches: 1,
      onFailure: (scopeIndex) => failures.push(scopeIndex),
      onPruned: (scopeIndex, removed) =>
        pruned.push({ scopeIndex, oneTimeTokens: removed.oneTimeTokens }),
    });

    const removed = await runtime.runOnce();

    expect(failures).toEqual([0]);
    expect(pruned).toEqual([{ scopeIndex: 1, oneTimeTokens: 2 }]);
    expect(removed).toEqual({
      oneTimeTokens: 2, oauthTokens: 0, oauthCodes: 0, samlAssertions: 0,
    });
  });

  it("says nothing about a round in which nothing was due", async () => {
    const { store } = recordingStore({});
    const reports: unknown[] = [];
    const runtime = new ProjectAuthExpiryRetentionRuntime({
      store, scopes: [scope()], graceMs: 86_400_000, batchSize: 10, maxBatches: 1,
      onPruned: (scopeIndex, removed) => reports.push({ scopeIndex, removed }),
    });

    await runtime.runOnce();

    expect(reports).toEqual([]);
  });

  it("refuses a grace, a batch or an interval that is out of range", () => {
    const { store } = recordingStore({});
    const base = { store, scopes: [scope()], graceMs: 86_400_000, batchSize: 10, maxBatches: 1 };
    // Null Sekunden Frist waere die Loeschung, gegen die dieser Aufraeumer
    // ausdruecklich argumentiert.
    expect(() => new ProjectAuthExpiryRetentionRuntime({ ...base, graceMs: 0 })).toThrow(RangeError);
    expect(() => new ProjectAuthExpiryRetentionRuntime({ ...base, batchSize: 0 })).toThrow(RangeError);
    expect(() => new ProjectAuthExpiryRetentionRuntime({ ...base, maxBatches: 0 })).toThrow(RangeError);
    expect(() => new ProjectAuthExpiryRetentionRuntime({ ...base, intervalMs: 10 })).toThrow(RangeError);
  });
});
