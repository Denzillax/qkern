import { describe, expect, it } from "vitest";
import {
  authFailureRanking,
  authFailureShare,
  type AuthPerformanceBucket,
  type AuthPerformanceCounts,
  type AuthPerformanceSeries,
} from "@/lib/console/auth-performance";
import {
  PROJECT_AUTH_AUDIT_ACTION_IDS,
  type ProjectAuthAuditActionId,
} from "@/lib/console/auth-observability-texts";

/**
 * Auth-Leistung (2.71), ohne Datenbank: Anteil, Rangfolge, "seit wann".
 *
 * Die Eingabe steht hier woertlich da und laeuft bewusst **nicht** durch
 * `buildProjectAuthAuditSeries`: Dass die gescheiterten je Handlungsart aus
 * der Aggregation der Datenbank bis in die Rangfolge durchkommen, ist die
 * Zusage, die nur eine echte Datenbank belegen kann, und dafuer steht der
 * Fall "(2.71)" in `postgres.integration.test.ts`. Hier steht, was die reine
 * Rechnung verspricht.
 */
const zero = () => {
  const actions = {} as Record<ProjectAuthAuditActionId, number>;
  const failedActions = {} as Record<ProjectAuthAuditActionId, number>;
  for (const id of PROJECT_AUTH_AUDIT_ACTION_IDS) { actions[id] = 0; failedActions[id] = 0; }
  return { actions, failedActions };
};

function counts(entries: Array<[ProjectAuthAuditActionId, number, number]>): AuthPerformanceCounts {
  const { actions, failedActions } = zero();
  let total = 0;
  let failed = 0;
  for (const [id, seen, missed] of entries) {
    actions[id] += seen;
    failedActions[id] += missed;
    total += seen;
    failed += missed;
  }
  return { total, failed, actions, failedActions };
}

const bucket = (start: string, entries: Array<[ProjectAuthAuditActionId, number, number]>): AuthPerformanceBucket =>
  ({ start, ...counts(entries) });

function series(buckets: AuthPerformanceBucket[]): AuthPerformanceSeries {
  const all: Array<[ProjectAuthAuditActionId, number, number]> = [];
  for (const entry of buckets) {
    for (const id of PROJECT_AUTH_AUDIT_ACTION_IDS) all.push([id, entry.actions[id], entry.failedActions[id]]);
  }
  return { buckets, totals: counts(all) };
}

describe("auth performance", () => {
  it("reports no share at all when nothing was recorded", () => {
    expect(authFailureShare({ total: 0, failed: 0 })).toBe(0);
    // Auch ein unmoeglicher Wert bleibt im Rahmen: mehr Fehlschlaege als
    // Handlungen gibt es nicht, und ein Anteil ueber eins waere Unsinn.
    expect(authFailureShare({ total: 4, failed: 9 })).toBe(1);
    expect(authFailureShare({ total: 4, failed: -2 })).toBe(0);
    expect(authFailureShare({ total: 8, failed: 2 })).toBe(0.25);
  });

  it("ranks by the number of failures and not by the share", () => {
    const ranking = authFailureRanking(series([
      bucket("2026-09-26T10:00:00.000Z", [
        ["project_auth.login.succeeded", 1000, 400],
        ["project_auth.mfa.verified", 1, 1],
      ]),
    ]));
    expect(ranking.map((row) => row.id)).toEqual([
      "project_auth.login.succeeded", "project_auth.mfa.verified",
    ]);
    expect(ranking[0]).toMatchObject({ total: 1000, failed: 400, share: 0.4 });
    expect(ranking[1]).toMatchObject({ total: 1, failed: 1, share: 1 });
  });

  it("names the earliest bucket of the window in which a kind failed", () => {
    const ranking = authFailureRanking(series([
      bucket("2026-09-26T08:00:00.000Z", [["project_auth.login.succeeded", 5, 1]]),
      bucket("2026-09-26T09:00:00.000Z", [["project_auth.login.succeeded", 5, 0]]),
      bucket("2026-09-26T10:00:00.000Z", [
        ["project_auth.login.succeeded", 5, 1],
        ["project_auth.mfa.verified", 9, 9],
      ]),
    ]));
    expect(ranking.map((row) => [row.id, row.firstFailureStart])).toEqual([
      ["project_auth.mfa.verified", "2026-09-26T10:00:00.000Z"],
      ["project_auth.login.succeeded", "2026-09-26T08:00:00.000Z"],
    ]);
  });

  it("leaves out every kind that did not fail, including the ones that never occurred", () => {
    const ranking = authFailureRanking(series([
      bucket("2026-09-26T10:00:00.000Z", [
        ["project_auth.signup.succeeded", 12, 0],
        ["project_auth.logout", 30, 0],
        ["project_auth.login.failed", 2, 2],
      ]),
    ]));
    expect(ranking.map((row) => row.id)).toEqual(["project_auth.login.failed"]);
  });

  it("keeps a stable order when two kinds failed equally often", () => {
    const ranking = authFailureRanking(series([
      bucket("2026-09-26T10:00:00.000Z", [
        ["project_auth.session.revoked", 4, 2],
        ["project_auth.mfa.enrolled", 4, 2],
        ["project_auth.user.updated", 2, 2],
      ]),
    ]));
    // Gleiche Zahl: der hoehere Anteil zuerst, danach die feste Reihenfolge
    // der Handlungen aus `PROJECT_AUTH_AUDIT_ACTION_IDS`.
    expect(ranking.map((row) => row.id)).toEqual([
      "project_auth.user.updated", "project_auth.mfa.enrolled", "project_auth.session.revoked",
    ]);
  });

  it("says nothing about a window without a single failure", () => {
    expect(authFailureRanking(series([
      bucket("2026-09-26T10:00:00.000Z", [["project_auth.login.succeeded", 40, 0]]),
    ]))).toEqual([]);
  });
});
