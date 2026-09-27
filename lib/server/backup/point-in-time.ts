import type { BackupRestoreReadiness } from "@/lib/server/backup/restore-evidence";

/**
 * Wiederherstellung auf einen Zeitpunkt, so weit sie traegt (2.53).
 *
 * Diese Datei rechnet und liest nichts. Sie nimmt zwei Dinge entgegen -- was
 * der Betreiber ueber sein WAL-Archiv erklaert hat und was der letzte
 * Restore-Drill belegt hat -- und macht daraus einen Zustand, den die Console
 * zeigen darf, ohne etwas zu versprechen.
 *
 * Drei Grenzen, damit die Ansicht ehrlich bleibt:
 *
 * 1. QKERN hat heute keinen Zugriff auf ein WAL-Archiv ausserhalb des
 *    Wegwerf-Stacks. Was hier `declared` heisst, ist eine Erklaerung des
 *    Betreibers, kein Befund. Ist nichts erklaert, lautet die Antwort
 *    "kein Archiv, keine Wiederherstellung auf einen Zeitpunkt" -- und zwar
 *    als erstes und ohne Umschweife.
 * 2. Der aelteste wiederherstellbare Punkt ist rechenbar, sobald die
 *    Aufbewahrung oder der Beginn der Archivierung erklaert ist; er ist dann
 *    der spaetere der beiden. Das ist eine Rechnung aus einer Erklaerung,
 *    keine Messung am Archiv, und die Antwort sagt das mit.
 * 3. Der neueste wiederherstellbare Punkt ist ohne Blick ins Archiv nicht zu
 *    wissen. Er bleibt darum `null` mit Grund, statt geschaetzt zu werden.
 *
 * Gelesen werden genau die drei Variablennamen unten. Es gibt keine Variable
 * fuer den Ort des Archivs, keine fuer einen Bucket und keine fuer ein
 * Geheimnis; so kann ueber diesen Weg auch keines hinausgehen.
 */
export const POINT_IN_TIME_ARCHIVE_ENV = Object.freeze({
  declared: "QKERN_BACKUP_WAL_ARCHIVE_DECLARED",
  retentionDays: "QKERN_BACKUP_WAL_ARCHIVE_RETENTION_DAYS",
  archivingSince: "QKERN_BACKUP_WAL_ARCHIVE_SINCE",
});

/** Hoechste Aufbewahrung, die eine Erklaerung tragen darf: zwei Jahre. */
export const MAX_RETENTION_DAYS = 730;

export type WalArchiveDeclaration = Readonly<{
  declared: boolean;
  retentionDays: number | null;
  archivingSince: string | null;
  /** Namen der Variablen, deren Wert unbrauchbar war; ihr Inhalt steht nie darin. */
  invalid: readonly string[];
}>;

export type PointInTimeWindow = Readonly<{
  earliestRestorablePoint: string | null;
  earliestSource: "retention" | "archiving_since" | null;
  latestRestorablePoint: null;
  reason: "no_archive" | "retention_unknown" | "archive_not_read";
}>;

export const POINT_IN_TIME_DRILL_ASSERTIONS = [
  "tls_only",
  "encrypted_base_backup",
  "wal_from_archive",
  "chosen_point_in_time",
  "schema_identical",
  "audit_chain_intact",
] as const;
export type PointInTimeDrillAssertion = (typeof POINT_IN_TIME_DRILL_ASSERTIONS)[number];

export const POINT_IN_TIME_RESTORE_STEPS = [
  "pick_point",
  "fetch_base_backup",
  "decrypt_base_backup",
  "set_recovery_target_time",
  "await_promotion",
  "verify_before_cutover",
] as const;
export type PointInTimeRestoreStep = (typeof POINT_IN_TIME_RESTORE_STEPS)[number];

export type PointInTimeRecoveryState = "no_archive" | "declared_without_drill" | "declared_with_drill";

export type PointInTimeDrill = Readonly<{
  verifiedAt: string;
  backupSnapshotAt: string;
  recoveryPointLagSeconds: number;
  restoreDurationSeconds: number;
  proves: readonly PointInTimeDrillAssertion[];
}>;

export type PointInTimeRecoveryOverview = Readonly<{
  state: PointInTimeRecoveryState;
  archive: WalArchiveDeclaration;
  window: PointInTimeWindow;
  lastDrill: PointInTimeDrill | null;
  steps: readonly PointInTimeRestoreStep[];
}>;

const DAY_MS = 24 * 60 * 60 * 1_000;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Liest die Erklaerung des Betreibers aus der Umgebung. Ein unbrauchbarer Wert
 * wird nicht geraten und nicht stillschweigend uebergangen: er faellt weg und
 * sein Variablenname steht in `invalid`.
 */
export function readWalArchiveDeclaration(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WalArchiveDeclaration {
  const invalid: string[] = [];
  const declaredRaw = env[POINT_IN_TIME_ARCHIVE_ENV.declared]?.trim() ?? "";
  if (declaredRaw && declaredRaw !== "true" && declaredRaw !== "false") {
    invalid.push(POINT_IN_TIME_ARCHIVE_ENV.declared);
  }
  const declared = declaredRaw === "true";

  const retentionRaw = env[POINT_IN_TIME_ARCHIVE_ENV.retentionDays]?.trim() ?? "";
  let retentionDays: number | null = null;
  if (retentionRaw) {
    const parsed = Number(retentionRaw);
    if (/^\d{1,4}$/.test(retentionRaw) && Number.isSafeInteger(parsed) &&
        parsed >= 1 && parsed <= MAX_RETENTION_DAYS) {
      retentionDays = parsed;
    } else {
      invalid.push(POINT_IN_TIME_ARCHIVE_ENV.retentionDays);
    }
  }

  const sinceRaw = env[POINT_IN_TIME_ARCHIVE_ENV.archivingSince]?.trim() ?? "";
  let archivingSince: string | null = null;
  if (sinceRaw) {
    if (ISO_UTC.test(sinceRaw) && new Date(sinceRaw).toISOString() === sinceRaw) {
      archivingSince = sinceRaw;
    } else {
      invalid.push(POINT_IN_TIME_ARCHIVE_ENV.archivingSince);
    }
  }

  // Ohne erklaertes Archiv gilt keine Aufbewahrung und kein Beginn: sonst
  // stuende in der Antwort ein Fenster zu einem Archiv, das es nicht gibt.
  if (!declared) return { declared: false, retentionDays: null, archivingSince: null, invalid };
  return { declared: true, retentionDays, archivingSince, invalid };
}

/**
 * Das Fenster, so weit es bekannt ist. Der aelteste Punkt ist der spaetere von
 * "jetzt minus Aufbewahrung" und "Beginn der Archivierung": beides begrenzt
 * nach unten, und die strengere Grenze gewinnt. Liegt der erklaerte Beginn in
 * der Zukunft, ist er die Grenze und das Fenster damit leer -- auch das ist
 * eine ehrliche Antwort und keine, die stillschweigend nach vorn korrigiert.
 */
export function pointInTimeWindow(
  declaration: WalArchiveDeclaration,
  now: Date = new Date(),
): PointInTimeWindow {
  const nothing = {
    earliestRestorablePoint: null,
    earliestSource: null,
    latestRestorablePoint: null,
  } as const;
  if (!declaration.declared) return { ...nothing, reason: "no_archive" };

  const fromRetention = declaration.retentionDays === null
    ? null
    : new Date(now.getTime() - declaration.retentionDays * DAY_MS);
  const fromSince = declaration.archivingSince === null
    ? null
    : new Date(declaration.archivingSince);

  if (fromRetention === null && fromSince === null) {
    return { ...nothing, reason: "retention_unknown" };
  }
  const retentionWins = fromSince === null ||
    (fromRetention !== null && fromRetention.getTime() >= fromSince.getTime());
  const earliest = retentionWins ? fromRetention! : fromSince;
  return {
    earliestRestorablePoint: earliest.toISOString(),
    earliestSource: retentionWins ? "retention" : "archiving_since",
    latestRestorablePoint: null,
    reason: "archive_not_read",
  };
}

/**
 * Was der Drill belegt. Die Liste ist fest, weil sie eine Aussage ueber
 * `tests/backup-restore-drill.integration.test.ts` ist und nicht ueber die
 * Evidenzdatei: die Evidenz sagt "bestanden", die Liste sagt, wofuer.
 */
export function drillFrom(readiness: BackupRestoreReadiness | null): PointInTimeDrill | null {
  if (!readiness) return null;
  return {
    verifiedAt: readiness.verifiedAt,
    backupSnapshotAt: readiness.backupSnapshotAt,
    recoveryPointLagSeconds: readiness.recoveryPointLagSeconds,
    restoreDurationSeconds: readiness.restoreDurationSeconds,
    proves: POINT_IN_TIME_DRILL_ASSERTIONS,
  };
}

export function pointInTimeRecoveryOverview(input: {
  declaration: WalArchiveDeclaration;
  readiness: BackupRestoreReadiness | null;
  now?: Date;
}): PointInTimeRecoveryOverview {
  const lastDrill = drillFrom(input.readiness);
  const state: PointInTimeRecoveryState = !input.declaration.declared
    ? "no_archive"
    : lastDrill
      ? "declared_with_drill"
      : "declared_without_drill";
  return {
    state,
    archive: input.declaration,
    window: pointInTimeWindow(input.declaration, input.now ?? new Date()),
    lastDrill,
    steps: POINT_IN_TIME_RESTORE_STEPS,
  };
}
