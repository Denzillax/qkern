import type { PointInTimeRecoveryOverview } from "@/lib/server/backup/point-in-time";

/**
 * Die Texte und die eine Ableitung der Seite „Datenbank → Backups“ (2.90).
 *
 * Gleiche Bauart wie `point-in-time-texts` (2.53) und
 * `restore-to-new-project-texts` (2.87): Der Schluessel ist der deutsche
 * Text, die Console uebersetzt ihn ueber ihren Katalog, und der Vertrag
 * `console-i18n-contract` liest diese Tabellen mit und verlangt fuer jeden
 * Text en, fr und it. Ein eigenes Modul braucht es, weil die Ansicht
 * `t(variable)` aufruft: Ein Text hinter einer Variablen faellt durch die
 * Suche nach `t("...")`.
 *
 * Das Modul ist rein: keine Datenbank, kein React, kein `fetch`.
 *
 * Warum die Seite ihren Knopf verloren hat: Die Seite trug einen
 * abgeschalteten Knopf „Backup erstellen“. Nachgesehen gibt es nichts, was er
 * haette aufrufen koennen, und zwar an keiner Stelle. Im Produktquelltext
 * ruft niemand `pg_basebackup` oder `pg_dump` auf; die einzige Stelle im
 * ganzen Baum, die ein Basisbackup zieht, ist ein Pruefweg unter `tests/`.
 * Unter den Backup-Routen einer Umgebung steht genau ein Pfad, und der kennt
 * nur GET. Ein Knopf haette also nicht auf ein fehlendes Stueck Oberflaeche
 * gewartet, sondern auf einen Weg, den es nicht gibt. Darum ist er weg, und
 * an seiner Stelle steht, warum, und was ein Betreiber stattdessen tut.
 *
 * **Was sich mit 2.126 geaendert hat.** Fuer die **Projektdatenbank** gibt es
 * den Produktweg jetzt: `lib/server/backup/project-database.ts` sichert sie
 * logisch, verschluesselt, in den Objektspeicher, und Migration 0083 fuehrt
 * darueber einen Katalog. Zwei der Saetze dieser Seite sind damit umgedreht
 * worden (`product_path` von "gibt es nicht" auf "Grenze", `no_catalogue` von
 * "gibt es nicht" auf "gibt es wirklich"), und zwei weitere umgeschrieben. Was
 * **nicht** dazugekommen ist: ein Knopf, eine Route mit Schreibverb und ein
 * Produktweg zum Basisbackup der Steuerungsdatenbank. Die Seite liest darum
 * weiterhin nur die Route unter `point-in-time` und nicht den neuen Katalog;
 * sie zu verdrahten ist eine eigene Arbeit und keine Nebenwirkung von 2.126.
 *
 * Warum die Seite nichts Eigenes liest: Die einzigen Angaben, die diese Route
 * tragen kann, sind die Erklaerung des Betreibers ueber sein WAL-Archiv und die
 * signierte Evidenz des letzten Restore-Drills. Die Seite fragt dieselbe Route
 * und stellt eine andere Frage an dieselbe Antwort.
 */

/** Die eine Frage, die diese Seite beantwortet. */
export const BACKUPS_QUESTION = "Wer sichert diese Projektdatenbank, und wann zuletzt?";

export const BACKUPS_ANSWER =
  "Seit 2.126 sichert QKERN diese Projektdatenbank selbst: ein logisches Backup genau dieser Datenbank, verschlüsselt, im Objektspeicher, mit einem Katalog in der Kontrollebene. Gefahren wird es vom Provisioner-Prozess in seiner Leerlaufrunde. Was es weiterhin nicht gibt, ist ein Knopf auf dieser Seite und eine Route, die ein Backup bestellt; und das Basisbackup der Steuerungsdatenbank zieht nach wie vor nur der Drill unter tests/.";

export const BACKUPS_HONESTY =
  "Der Katalog in der Kontrollebene hält die Backups dieser Projektdatenbank, und zwar unter Zeilensicherheit je Organisation. Diese Seite liest ihn noch nicht: sie liest dieselbe Route wie Point-in-time Recovery, und die kennt den Katalog nicht. Ein Zeitpunkt des letzten Backups steht deshalb in der Datenbank und nicht auf dieser Seite.";

export const BACKUPS_SAME_EVIDENCE =
  "Gelesen wird dieselbe Route wie unter Point-in-time Recovery und unter „In neues Projekt wiederherstellen“, und nur sie. Eine eigene Route hätte dieselbe Erklärung und dieselbe Evidenzdatei ein zweites Mal gelesen und nichts hinzugefügt.";

/** Der Stand, den die Seite aus der Antwort der Route ableitet. */
export const BACKUPS_STANDPOINTS = ["nothing", "declared", "declared_and_drilled"] as const;
export type BackupsStandpoint = (typeof BACKUPS_STANDPOINTS)[number];

export const BACKUPS_STANDPOINT_TEXTS: Record<BackupsStandpoint, { label: string; explains: string }> = {
  nothing: {
    label: "Kein erklärtes Archiv und kein belegter Lauf",
    explains: "Für diese Umgebung ist kein WAL-Archiv erklärt, und es liegt keine gültige Evidenz eines Restore-Drills vor. QKERN weiss über die Sicherung dieser Datenbank damit genau nichts, und diese Seite behauptet auch nichts.",
  },
  declared: {
    label: "Archiv erklärt, Verfahren nicht belegt",
    explains: "Der Betreiber hat ein WAL-Archiv erklärt. Die Erklärung ist eine Angabe und kein Befund: QKERN hat das Archiv nicht gesehen. Eine gültige Evidenz eines Restore-Drills liegt ausserdem nicht vor, also ist auch das Verfahren gerade nicht belegt.",
  },
  declared_and_drilled: {
    label: "Archiv erklärt, Verfahren belegt, diese Datenbank ungesichert",
    explains: "Der Betreiber hat ein WAL-Archiv erklärt, und es liegt eine signierte Evidenz innerhalb der festen Policy vor. Belegt ist damit das Verfahren an der Kontrollebene. Über ein Backup dieser Projektdatenbank sagt beides nichts.",
  },
};

/** Was es gibt und was nicht, jedes mit seinem Urteil. */
export const BACKUPS_FINDING_ITEMS = [
  "product_path",
  "test_path",
  "scope_is_control_plane",
  "no_catalogue",
  "no_order_route",
] as const;
export type BackupsFindingItem = (typeof BACKUPS_FINDING_ITEMS)[number];

export type BackupsFindingVerdict = "missing" | "exists" | "limit";

export const BACKUPS_FINDING_VERDICT_TEXTS: Record<BackupsFindingVerdict, { label: string; tone: "secure" | "risk medium" | "risk high" }> = {
  missing: { label: "gibt es nicht", tone: "risk high" },
  exists: { label: "gibt es wirklich", tone: "secure" },
  limit: { label: "Grenze", tone: "risk medium" },
};

export const BACKUPS_FINDING_TEXTS: Record<BackupsFindingItem, { verdict: BackupsFindingVerdict; label: string; explains: string }> = {
  product_path: {
    // Seit 2.126 keine Abwesenheit mehr, sondern eine Grenze: fuer die
    // Projektdatenbank gibt es den Weg, fuer das Basisbackup der
    // Steuerungsdatenbank nicht.
    verdict: "limit",
    label: "Ein Produktweg zu einem Basisbackup",
    explains: "Für die Projektdatenbank gibt es ihn seit 2.126: lib/server/backup/project-database-dump.ts ruft pg_dump als Kindprozess, mit einer eigenen Leserolle und einem Zugangsdatum aus dem Vault. Für ein Basisbackup gibt es ihn nicht: pg_basebackup, pg_dumpall und pg_receivewal ruft im Produkt keine Stelle auf. Ein Basisbackup zieht nur der Drill unter tests/, und zwar vom Wegwerf-Server seines Stacks.",
  },
  test_path: {
    verdict: "exists",
    label: "Ein Prüfweg, der ein Basisbackup wirklich zieht",
    explains: "npm run test:backup:docker fährt scripts/backup-certification.mjs. Das Skript hebt den Stack docker-compose.backup-certification.yml, lässt darin tests/backup-restore-drill.integration.test.ts laufen, liest die signierte Evidenz aus dem Protokoll und legt sie unter docs/evidence/backup-restore ab. Es spricht selbst mit keiner Datenbank: Es startet Container und liest ihre Ausgabe.",
  },
  scope_is_control_plane: {
    verdict: "limit",
    label: "Gesichert wird die Kontrollebene, nicht diese Datenbank",
    explains: "Der Quellserver des Drills trägt die Datenbank qkern_control, und der Drill schreibt darin in users, organizations und audit_logs. Die Evidenz trägt den Bereich control_plane, der Verifier kennt keinen zweiten und weist jede Evidenz mit einem anderen Bereich ab. Der Drill belegt darum das Verfahren und die Software, nicht ein Backup dieses Projekts.",
  },
  no_catalogue: {
    // Migration 0083 ist der Katalog. Was fehlt, ist eine Zeile fuer das
    // Basisbackup der Steuerungsdatenbank, und das steht im Text.
    verdict: "exists",
    label: "Ein Katalog vergangener Läufe",
    explains: "Migration 0083 legt project_database_backups an: je Backup eine Zeile mit Zustand, Objektschlüssel, Prüfsumme, Grösse, eingewickeltem Datenschlüssel, Manifest und Ablauf, mit Zeilensicherheit je Organisation. Für das Basisbackup der Steuerungsdatenbank gibt es weiterhin keine Zeile; die einzigen Zeitpunkte dort bringt die Evidenz des Drills mit.",
  },
  no_order_route: {
    verdict: "missing",
    label: "Eine Route, die ein Backup bestellt",
    explains: "Unter den Backup-Routen einer Umgebung steht genau ein Pfad, point-in-time, und er kennt nur GET. Es gibt kein Schreibverb, an das ein Knopf sich hätte hängen können, und diese Seite legt auch keines an.",
  },
};

/** Was ein Betreiber stattdessen tut, in der Reihenfolge, in der es der Drill tut. */
export const BACKUPS_OPERATOR_STEPS = [
  "enable_archiving",
  "pull_base_backup",
  "encrypt_and_keep",
  "declare_to_qkern",
  "run_the_drill",
] as const;
export type BackupsOperatorStep = (typeof BACKUPS_OPERATOR_STEPS)[number];

export const BACKUPS_OPERATOR_STEP_TEXTS: Record<BackupsOperatorStep, { title: string; explains: string }> = {
  enable_archiving: {
    title: "Das WAL-Archiv einschalten, am Server selbst",
    explains: "wal_level auf replica, archive_mode auf on und ein archive_command, das jedes Segment aus dem Datenverzeichnis herausträgt. Genau diese drei Angaben setzt der Zertifizierungsstack an seinem Quellserver. Ohne sie gibt es kein Point-in-time Recovery, sondern nur das jeweils jüngste Basisbackup.",
  },
  pull_base_backup: {
    title: "Das Basisbackup über die Replikationsverbindung ziehen",
    explains: "pg_basebackup als Tar und ohne WAL, über eine Verbindung mit TLS. Ohne WAL ist Absicht: Jedes Segment soll aus dem Archiv kommen, sonst ist es eine gewöhnliche Rücksicherung und keine auf einen Zeitpunkt.",
  },
  encrypt_and_keep: {
    title: "Verschlüsseln, den Klartext löschen, ausser Haus legen",
    explains: "Der Drill verschlüsselt das Artefakt mit AES-256 und löscht danach die unverschlüsselte Datei. Der Verifier nimmt später nur Evidenz an, in der die Verschlüsselung bestätigt ist. Ein Archiv auf derselben Maschine wie die Datenbank überlebt deren Ausfall nicht.",
  },
  declare_to_qkern: {
    title: "Der Console sagen, dass es das Archiv gibt",
    explains: "Drei Umgebungsvariablen, und mehr liest QKERN nicht: ob ein Archiv erklärt ist, wie viele Tage aufbewahrt werden und seit wann archiviert wird. Es gibt keine Variable für den Ort des Archivs, keine für einen Bucket und keine für ein Geheimnis, also kann über diesen Weg auch keines hinausgehen. Aus der Erklärung rechnet QKERN den ältesten Punkt; den neuesten nennt es nicht, weil dafür jemand ins Archiv sehen müsste.",
  },
  run_the_drill: {
    title: "Den Drill fahren und die Evidenz aufheben",
    explains: "npm run test:backup:docker stellt aus einem verschlüsselten Basisbackup und dem WAL-Archiv einen zweiten Server auf einen gewählten Zeitpunkt her und belegt Schema, Zeilen, Audit-Kette und Datenmanifest. Ein Backup, das nie zurückgespielt wurde, ist eine Vermutung. Die Evidenz ist sieben Tage gültig; danach zeigt die Console wieder keinen belegten Lauf.",
  },
};

export const BACKUPS_ARCHIVE_UNKNOWN =
  "Was hier steht, ist die Erklärung des Betreibers und keine Messung am Archiv. QKERN hat auf ein WAL-Archiv keinen Zugriff und sieht darum weder, ob es wirklich Segmente enthält, noch bis wann.";

/**
 * Der Stand der Seite, aus der Antwort der vorhandenen Route. Die Erklaerung
 * des Archivs und der Drill sind zwei unabhaengige Dinge; nur wenn beides da
 * ist, darf die Seite vom belegten Verfahren sprechen.
 */
export function backupsStandpoint(
  overview: Pick<PointInTimeRecoveryOverview, "archive" | "lastDrill">,
): BackupsStandpoint {
  if (!overview.archive.declared) return "nothing";
  return overview.lastDrill ? "declared_and_drilled" : "declared";
}

/** Alle Texte, die über `t(variable)` laufen, für den Übersetzungsvertrag. */
export function backupsTexts(): string[] {
  return [
    BACKUPS_QUESTION,
    BACKUPS_ANSWER,
    BACKUPS_HONESTY,
    BACKUPS_SAME_EVIDENCE,
    BACKUPS_ARCHIVE_UNKNOWN,
    ...BACKUPS_STANDPOINTS.flatMap((key) => [
      BACKUPS_STANDPOINT_TEXTS[key].label,
      BACKUPS_STANDPOINT_TEXTS[key].explains,
    ]),
    ...Object.values(BACKUPS_FINDING_VERDICT_TEXTS).map((entry) => entry.label),
    ...BACKUPS_FINDING_ITEMS.flatMap((key) => [
      BACKUPS_FINDING_TEXTS[key].label,
      BACKUPS_FINDING_TEXTS[key].explains,
    ]),
    ...BACKUPS_OPERATOR_STEPS.flatMap((key) => [
      BACKUPS_OPERATOR_STEP_TEXTS[key].title,
      BACKUPS_OPERATOR_STEP_TEXTS[key].explains,
    ]),
  ];
}
