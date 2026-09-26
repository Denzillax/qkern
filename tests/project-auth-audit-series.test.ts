import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PasswordHasher } from "@/lib/server/auth/password";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import { MemoryProjectAuthAuditSink, type ProjectAuthAuditSink } from "@/lib/server/project-auth/audit";
import {
  buildProjectAuthAuditSeries,
  projectAuthSeriesRowLimit,
  projectAuthSeriesWindow,
  type ProjectAuthAuditSeriesRecord,
} from "@/lib/server/project-auth/audit-series";
import { PROJECT_AUTH_AUDIT_ACTIONS } from "@/lib/console/auth-observability-texts";
import { ProjectAuthSecretProtector, ProjectAuthTotp } from "@/lib/server/project-auth/mfa";
import { ProjectAuthOidcCatalog, ProjectAuthOidcClient } from "@/lib/server/project-auth/oidc";
import { MemoryProjectAuthRepository } from "@/lib/server/project-auth/repository";
import {
  NoopDevelopmentProjectAuthDelivery,
  ProjectAuthService,
} from "@/lib/server/project-auth/service";
import { ProjectAuthTokenService } from "@/lib/server/project-auth/tokens";

/**
 * Die Zeitreihe des Auth-Audits (2.47), ohne Datenbank: Fenster, Eimer,
 * Auffuellen, Aufteilung nach Ausgang, Abschneiden. Die echte Aggregation
 * deckt der PostgreSQL-Fall "(2.47)" ab; hier steht, was der reine Teil
 * verspricht, und was der Dienst annimmt und ablehnt.
 */
const NOW = new Date("2026-09-26T12:34:56.000Z");
const scope = { organizationId: "org-1", projectId: "project-1", environment: "development" as const };

class FastHasher implements PasswordHasher {
  readonly dummyHash = "fast:dummy";
  async hash(password: string) { return `fast:${createHash("sha256").update(password).digest("hex")}`; }
  async verify(password: string, hash: string) { return hash === await this.hash(password); }
}

function service(audit?: ProjectAuthAuditSink, now: Date = NOW) {
  const { privateKey } = generateKeyPairSync("ed25519");
  return new ProjectAuthService({
    repository: new MemoryProjectAuthRepository(), passwords: new FastHasher(),
    rateLimiter: new InMemoryRateLimiter(), audit,
    tokens: new ProjectAuthTokenService({ kid: "series", privateKey }, "https://qkern.test"),
    mfa: new ProjectAuthTotp(), secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 9)),
    delivery: new NoopDevelopmentProjectAuthDelivery(), oidcCatalog: new ProjectAuthOidcCatalog([]),
    oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
    callbackBaseUrl: "https://qkern.test", allowedRedirectOrigins: new Set(["https://app.test"]),
    exposeDeliveryTokens: true, now: () => new Date(now),
  });
}

const record = (start: string, action: string, total: number, failed = 0): ProjectAuthAuditSeriesRecord =>
  ({ bucketStart: new Date(start), action, total, failed });

describe("project auth audit series", () => {
  it("ends the window with the running bucket and reaches back 48 hours or 90 days", () => {
    const hourly = projectAuthSeriesWindow("hour", NOW);
    expect(hourly.end.toISOString()).toBe("2026-09-26T13:00:00.000Z");
    expect(hourly.start.toISOString()).toBe("2026-09-24T13:00:00.000Z");
    const daily = projectAuthSeriesWindow("day", NOW);
    expect(daily.end.toISOString()).toBe("2026-09-27T00:00:00.000Z");
    expect(daily.start.toISOString()).toBe("2026-06-29T00:00:00.000Z");
  });

  it("fills every empty bucket of the window with zero instead of leaving it out", () => {
    const series = buildProjectAuthAuditSeries({
      bucket: "hour", now: NOW,
      records: [record("2026-09-26T10:00:00.000Z", "project_auth.login.succeeded", 3)],
    });
    expect(series.bucketCount).toBe(48);
    expect(series.buckets).toHaveLength(48);
    expect(series.windowStart).toBe("2026-09-24T13:00:00.000Z");
    expect(series.windowEnd).toBe("2026-09-26T13:00:00.000Z");
    expect(series.buckets[0].start).toBe("2026-09-24T13:00:00.000Z");
    expect(series.buckets[47].start).toBe("2026-09-26T12:00:00.000Z");
    // Jeder Eimer ist eine Stunde breit und keiner fehlt.
    for (let index = 1; index < series.buckets.length; index += 1) {
      expect(new Date(series.buckets[index].start).getTime() - new Date(series.buckets[index - 1].start).getTime())
        .toBe(3_600_000);
    }
    const filled = series.buckets.filter((bucket) => bucket.total > 0);
    expect(filled).toHaveLength(1);
    expect(filled[0]).toMatchObject({ start: "2026-09-26T10:00:00.000Z", total: 3, succeeded: 3, failed: 0 });
    expect(series.buckets[0]).toMatchObject({ total: 0, succeeded: 0, failed: 0 });
    expect(series.totals.total).toBe(3);
    expect(series.truncated).toBe(false);
  });

  it("counts every action kind separately and splits the outcome per bucket", () => {
    const series = buildProjectAuthAuditSeries({
      bucket: "hour", now: NOW,
      records: [
        record("2026-09-26T10:00:00.000Z", "project_auth.login.succeeded", 4),
        record("2026-09-26T10:00:00.000Z", "project_auth.login.failed", 6, 6),
        record("2026-09-26T11:00:00.000Z", "project_auth.signup.succeeded", 2),
        // Eine Handlung, die diese Fassung nicht kennt, faellt nicht weg.
        record("2026-09-26T11:00:00.000Z", "project_auth.passkey.registered", 5, 1),
      ],
    });
    const at = (start: string) => series.buckets.find((bucket) => bucket.start === start)!;
    expect(at("2026-09-26T10:00:00.000Z")).toMatchObject({ total: 10, succeeded: 4, failed: 6 });
    expect(at("2026-09-26T10:00:00.000Z").actions["project_auth.login.succeeded"]).toBe(4);
    expect(at("2026-09-26T10:00:00.000Z").actions["project_auth.login.failed"]).toBe(6);
    expect(at("2026-09-26T11:00:00.000Z")).toMatchObject({ total: 7, succeeded: 6, failed: 1 });
    expect(at("2026-09-26T11:00:00.000Z").actions.other).toBe(5);
    expect(series.totals).toMatchObject({ total: 17, succeeded: 10, failed: 7 });
    expect(series.totals.actions["project_auth.signup.succeeded"]).toBe(2);
    expect(series.actions).toEqual([...PROJECT_AUTH_AUDIT_ACTIONS, "other"]);
  });

  it("drops a group outside the window instead of pressing it against the edge", () => {
    const series = buildProjectAuthAuditSeries({
      bucket: "hour", now: NOW,
      records: [
        record("2026-09-24T12:00:00.000Z", "project_auth.login.succeeded", 9),
        record("2026-09-26T13:00:00.000Z", "project_auth.login.succeeded", 8),
        record("2026-09-24T13:00:00.000Z", "project_auth.login.succeeded", 1),
      ],
    });
    expect(series.totals.total).toBe(1);
    expect(series.buckets[0]).toMatchObject({ total: 1, succeeded: 1 });
    // Die 9 vor dem Fenster und die 8 dahinter stehen in keinem Eimer.
    expect(series.buckets.filter((bucket) => bucket.total > 0)).toHaveLength(1);
    expect(series.buckets.some((bucket) => bucket.total === 9 || bucket.total === 8)).toBe(false);
  });

  it("says when the aggregation hit its row limit", () => {
    const limit = projectAuthSeriesRowLimit("hour");
    expect(limit).toBe(48 * (PROJECT_AUTH_AUDIT_ACTIONS.length + 1));
    const records = Array.from({ length: limit + 1 }, (_, index) =>
      record("2026-09-26T10:00:00.000Z", `project_auth.kind_${index}`, 1));
    const series = buildProjectAuthAuditSeries({ bucket: "hour", now: NOW, records });
    expect(series.truncated).toBe(true);
    // Abgeschnitten heisst abgeschnitten: Die Zeile ueber der Grenze zaehlt
    // nicht mit, sonst waere die Summe hoeher als das, was gelesen wurde.
    expect(series.totals.total).toBe(limit);
    expect(buildProjectAuthAuditSeries({ bucket: "hour", now: NOW, records: records.slice(0, limit) }).truncated)
      .toBe(false);
  });

  it("aggregates what the memory sink recorded, in the window and in the right buckets", async () => {
    const sink = new MemoryProjectAuthAuditSink(() => new Date("2026-09-26T10:20:00.000Z"));
    await sink.record({
      scope, action: "project_auth.login.succeeded", actorType: "app_user",
      actorRef: "project_auth_user:11111111-1111-4111-8111-111111111111",
      resourceRef: "project_auth_user:11111111-1111-4111-8111-111111111111", status: "succeeded",
    });
    await sink.record({
      scope, action: "project_auth.login.failed", actorType: "app_user", actorRef: "anonymous",
      resourceRef: "anonymous", status: "failed",
    });
    const series = await service(sink).readAuditSeries(scope, { bucket: "hour" });
    const bucket = series.buckets.find((entry) => entry.start === "2026-09-26T10:00:00.000Z")!;
    expect(bucket).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(series.totals).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(JSON.stringify(series)).not.toContain("@");
  });

  it("rejects an unknown bucket and says so when no audit sink can aggregate", async () => {
    const sink = new MemoryProjectAuthAuditSink(() => NOW);
    for (const bucket of ["minute", "week", "HOUR", "", "hour "]) {
      await expect(service(sink).readAuditSeries(scope, { bucket }), bucket)
        .rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect((await service(sink).readAuditSeries(scope)).bucket).toBe("hour");
    await expect(service(undefined).readAuditSeries(scope, { bucket: "day" }))
      .rejects.toMatchObject({ code: "AUDIT_UNAVAILABLE" });
    // Ein Sink ohne Aggregation ist derselbe Fall: keine Reihe statt einer
    // leeren, die "nichts passiert" behaupten wuerde.
    const listOnly: ProjectAuthAuditSink = {
      record: async () => {},
      list: async () => ({ events: [], nextCursor: null }),
    };
    await expect(service(listOnly).readAuditSeries(scope))
      .rejects.toMatchObject({ code: "AUDIT_UNAVAILABLE" });
  });
});
