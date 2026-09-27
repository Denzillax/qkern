import { describe, expect, it } from "vitest";
import type { BackupRestoreReadiness } from "@/lib/server/backup/restore-evidence";
import { BACKUP_RESTORE_EVIDENCE_POLICY } from "@/lib/server/backup/restore-evidence";
import {
  MAX_RETENTION_DAYS,
  POINT_IN_TIME_ARCHIVE_ENV,
  POINT_IN_TIME_DRILL_ASSERTIONS,
  pointInTimeRecoveryOverview,
  pointInTimeWindow,
  readWalArchiveDeclaration,
} from "@/lib/server/backup/point-in-time";

/**
 * Die Rechnung hinter Datenbank -> Point-in-time Recovery (2.53). Geprueft
 * wird vor allem, was die Ansicht *nicht* sagen darf: kein Fenster ohne
 * Archiv, kein aeltester Punkt ohne Aufbewahrung, nie ein neuester Punkt.
 */
const NOW = new Date("2026-09-26T12:00:00.000Z");

function readiness(): BackupRestoreReadiness {
  return {
    status: "ready",
    evidenceId: "6d5c14cb-4e76-434e-9503-97034e48544d",
    deployment: "production",
    scope: "control_plane",
    backupSnapshotAt: "2026-09-25T21:22:34.000Z",
    verifiedAt: "2026-09-25T21:22:54.000Z",
    recoveryPointLagSeconds: 5,
    restoreDurationSeconds: 15,
    policy: BACKUP_RESTORE_EVIDENCE_POLICY,
  };
}

describe("point-in-time recovery state", () => {
  it("reads only the three declaration variables and names the unusable ones without their value", () => {
    const declaration = readWalArchiveDeclaration({
      [POINT_IN_TIME_ARCHIVE_ENV.declared]: "true",
      [POINT_IN_TIME_ARCHIVE_ENV.retentionDays]: "14",
      [POINT_IN_TIME_ARCHIVE_ENV.archivingSince]: "2026-09-01T00:00:00.000Z",
      QKERN_BACKUP_WAL_ARCHIVE_URL: "s3://bucket/wal",
    });
    expect(declaration).toEqual({
      declared: true, retentionDays: 14, archivingSince: "2026-09-01T00:00:00.000Z", invalid: [],
    });
    expect(Object.values(POINT_IN_TIME_ARCHIVE_ENV)).toHaveLength(3);
    expect(JSON.stringify(declaration)).not.toContain("s3://");

    const broken = readWalArchiveDeclaration({
      [POINT_IN_TIME_ARCHIVE_ENV.declared]: "yes please",
      [POINT_IN_TIME_ARCHIVE_ENV.retentionDays]: String(MAX_RETENTION_DAYS + 1),
      [POINT_IN_TIME_ARCHIVE_ENV.archivingSince]: "2026-09-01",
    });
    expect(broken.declared).toBe(false);
    expect(broken.invalid).toEqual(Object.values(POINT_IN_TIME_ARCHIVE_ENV));
  });

  it("drops retention and start when no archive is declared", () => {
    const declaration = readWalArchiveDeclaration({
      [POINT_IN_TIME_ARCHIVE_ENV.retentionDays]: "14",
      [POINT_IN_TIME_ARCHIVE_ENV.archivingSince]: "2026-09-01T00:00:00.000Z",
    });
    expect(declaration).toEqual({ declared: false, retentionDays: null, archivingSince: null, invalid: [] });
    expect(pointInTimeWindow(declaration, NOW)).toEqual({
      earliestRestorablePoint: null, earliestSource: null, latestRestorablePoint: null, reason: "no_archive",
    });
  });

  it("takes the later of retention and start as the oldest point and never names a newest one", () => {
    const retentionWins = pointInTimeWindow(
      { declared: true, retentionDays: 7, archivingSince: "2026-09-01T00:00:00.000Z", invalid: [] }, NOW,
    );
    expect(retentionWins).toEqual({
      earliestRestorablePoint: "2026-09-19T12:00:00.000Z",
      earliestSource: "retention",
      latestRestorablePoint: null,
      reason: "archive_not_read",
    });

    const startWins = pointInTimeWindow(
      { declared: true, retentionDays: 90, archivingSince: "2026-09-01T00:00:00.000Z", invalid: [] }, NOW,
    );
    expect(startWins.earliestRestorablePoint).toBe("2026-09-01T00:00:00.000Z");
    expect(startWins.earliestSource).toBe("archiving_since");

    // Nur eine der beiden Angaben genuegt, und zwar jede fuer sich.
    expect(pointInTimeWindow({ declared: true, retentionDays: 1, archivingSince: null, invalid: [] }, NOW))
      .toMatchObject({ earliestRestorablePoint: "2026-09-25T12:00:00.000Z", earliestSource: "retention" });
    expect(pointInTimeWindow({ declared: true, retentionDays: null, archivingSince: "2026-08-01T00:00:00.000Z", invalid: [] }, NOW))
      .toMatchObject({ earliestRestorablePoint: "2026-08-01T00:00:00.000Z", earliestSource: "archiving_since" });
  });

  it("says the oldest point is unknown when neither retention nor start is declared", () => {
    expect(pointInTimeWindow({ declared: true, retentionDays: null, archivingSince: null, invalid: [] }, NOW))
      .toEqual({
        earliestRestorablePoint: null, earliestSource: null, latestRestorablePoint: null,
        reason: "retention_unknown",
      });
  });

  it("derives the three states and carries only timestamps and durations out of the evidence", () => {
    const none = pointInTimeRecoveryOverview({
      declaration: readWalArchiveDeclaration({}), readiness: readiness(), now: NOW,
    });
    expect(none.state).toBe("no_archive");
    expect(none.window.reason).toBe("no_archive");

    const declared = { declared: true, retentionDays: 7, archivingSince: null, invalid: [] } as const;
    expect(pointInTimeRecoveryOverview({ declaration: declared, readiness: null, now: NOW }).state)
      .toBe("declared_without_drill");

    const proven = pointInTimeRecoveryOverview({ declaration: declared, readiness: readiness(), now: NOW });
    expect(proven.state).toBe("declared_with_drill");
    expect(proven.lastDrill).toEqual({
      verifiedAt: "2026-09-25T21:22:54.000Z",
      backupSnapshotAt: "2026-09-25T21:22:34.000Z",
      recoveryPointLagSeconds: 5,
      restoreDurationSeconds: 15,
      proves: POINT_IN_TIME_DRILL_ASSERTIONS,
    });
    // Weder Evidenz-ID noch Digests noch Key-ID gehen hinaus.
    const serialised = JSON.stringify(proven);
    expect(serialised).not.toContain("6d5c14cb");
    expect(serialised).not.toContain("evidenceId");
    expect(proven.steps.length).toBeGreaterThanOrEqual(6);
  });

  it("names the chosen point in time as the assertion that separates it from an ordinary restore", () => {
    expect(POINT_IN_TIME_DRILL_ASSERTIONS).toContain("chosen_point_in_time");
    expect(POINT_IN_TIME_DRILL_ASSERTIONS).toContain("wal_from_archive");
  });
});
