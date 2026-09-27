import {
  POINT_IN_TIME_DRILL_ASSERTIONS,
  POINT_IN_TIME_RESTORE_STEPS,
  type PointInTimeDrillAssertion,
  type PointInTimeRecoveryState,
  type PointInTimeRestoreStep,
  type PointInTimeWindow,
} from "@/lib/server/backup/point-in-time";

/**
 * Die Texte der Seite "Point-in-time Recovery" (2.53). Der Server schickt
 * Kuerzel, die Ansicht setzt sie hier in Saetze; so steht in der Antwort kein
 * uebersetzter Text und in der Ansicht kein erfundener Befund.
 *
 * Jeder Satz ist eine Aussage, die QKERN halten kann. Wo QKERN nichts weiss,
 * sagt der Satz das, statt die Luecke zu fuellen.
 */
export const POINT_IN_TIME_STATE_TEXTS: Record<PointInTimeRecoveryState, { label: string; explains: string }> = {
  no_archive: {
    label: "Kein Archiv, keine Wiederherstellung auf einen Zeitpunkt",
    explains: "Für diese Umgebung ist kein WAL-Archiv erklärt. Ohne Archiv gibt es keinen Zeitpunkt, auf den wiederhergestellt werden könnte. Es gibt nur das jeweils jüngste Basisbackup. QKERN zeigt darum hier keine Wiederherstellungspunkte an.",
  },
  declared_without_drill: {
    label: "Archiv erklärt, in dieser Umgebung nicht belegt",
    explains: "Der Betreiber hat ein WAL-Archiv erklärt. QKERN hat es nicht gesehen und keinen gültigen Restore-Drill dazu. Die Erklärung ist eine Angabe, kein Befund.",
  },
  declared_with_drill: {
    label: "Archiv erklärt, letzter Drill belegt",
    explains: "Der Betreiber hat ein WAL-Archiv erklärt, und es liegt ein signierter Restore-Drill vor, der innerhalb der festen Policy liegt. Der Drill belegt das Verfahren, nicht das Archiv dieser Umgebung.",
  },
};

export const POINT_IN_TIME_ASSERTION_TEXTS: Record<PointInTimeDrillAssertion, string> = {
  tls_only: "Eine unverschlüsselte Verbindung zur Quelldatenbank wird abgewiesen, die verschlüsselte weist sich aus.",
  encrypted_base_backup: "Das Basisbackup wird über die Replikationsverbindung gezogen und mit AES-256 verschlüsselt abgelegt; der Klartext wird gelöscht.",
  wal_from_archive: "Das Basisbackup enthält kein WAL. Jedes Segment kommt aus dem Archiv, sonst wäre es eine gewöhnliche Rücksicherung.",
  chosen_point_in_time: "Zwischen zwei Markierungen wird ein Zeitpunkt gewählt. Nach der Wiederherstellung ist die erste Markierung da und die zweite fehlt. Genau das unterscheidet einen Zeitpunkt von „bis zum Ende des Archivs“.",
  schema_identical: "Das Schema der wiederhergestellten Datenbank stimmt Zeile für Zeile mit dem der Quelle überein, und beide Datenmanifeste sind gleich.",
  audit_chain_intact: "Die Audit-Kette wird nachgerechnet: jeder Eintragshash stimmt, und jeder Eintrag zeigt auf seinen Vorgänger.",
};

export const POINT_IN_TIME_STEP_TEXTS: Record<PointInTimeRestoreStep, string> = {
  pick_point: "Den Zeitpunkt festlegen, auf den wiederhergestellt werden soll, und ihn in UTC notieren. Er muss im Fenster liegen, das oben steht.",
  fetch_base_backup: "Das jüngste Basisbackup holen, das vor diesem Zeitpunkt liegt. Ein jüngeres nützt nichts: aus ihm führt kein Weg zurück.",
  decrypt_base_backup: "Das Basisbackup entschlüsseln und in ein leeres Datenverzeichnis auspacken. Niemals über das laufende Verzeichnis.",
  set_recovery_target_time: "In der Konfiguration des neuen Servers `restore_command` auf das Archiv setzen, `recovery_target_time` auf den Zeitpunkt, `recovery_target_action` auf `promote`, und die Datei `recovery.signal` anlegen.",
  await_promotion: "Den Server auf einem anderen Port starten und warten, bis er aus der Wiederherstellung heraus ist. Bis dahin ist nichts bewiesen.",
  verify_before_cutover: "Vor jeder Umstellung prüfen: ein Datensatz von vor dem Zeitpunkt ist da, einer von danach fehlt. Erst dann umschalten.",
};

export const POINT_IN_TIME_WINDOW_TEXTS: Record<PointInTimeWindow["reason"], string> = {
  no_archive: "Ohne Archiv gibt es kein Fenster.",
  retention_unknown: "Zum Archiv ist weder eine Aufbewahrung noch ein Beginn erklärt. Damit ist der älteste wiederherstellbare Punkt nicht bekannt.",
  archive_not_read: "Der älteste Punkt ist aus der Erklärung gerechnet, nicht am Archiv gemessen. Der neueste Punkt hängt davon ab, wie aktuell das Archiv ist; QKERN liest das Archiv nicht und nennt ihn darum nicht.",
};

export const POINT_IN_TIME_HONESTY =
  "QKERN verwaltet kein WAL-Archiv. Was hier steht, sind die Angaben des Betreibers und das, was der letzte Restore-Drill belegt hat.";

/** Alle Texte, die über `t(variable)` laufen, für den Übersetzungsvertrag. */
export function pointInTimeTexts(): string[] {
  return [
    ...Object.values(POINT_IN_TIME_STATE_TEXTS).flatMap((entry) => [entry.label, entry.explains]),
    ...POINT_IN_TIME_DRILL_ASSERTIONS.map((key) => POINT_IN_TIME_ASSERTION_TEXTS[key]),
    ...POINT_IN_TIME_RESTORE_STEPS.map((key) => POINT_IN_TIME_STEP_TEXTS[key]),
    ...Object.values(POINT_IN_TIME_WINDOW_TEXTS),
    POINT_IN_TIME_HONESTY,
  ];
}
