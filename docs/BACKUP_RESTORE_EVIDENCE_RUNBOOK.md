# Backup/Restore Evidence Runbook

## Zwei Wege, und sie dürfen nicht verwechselt werden

Seit 2.126 gibt es in QKERN **zwei** Backup-Wege, und sie sichern Verschiedenes:

| | Steuerungsdatenbank (`2.29.0`) | Projektdatenbank (`2.126`) |
| --- | --- | --- |
| Was | physisches Basisbackup des Clusters | logisches Backup genau einer Datenbank |
| Wer fährt es | ein externer Drill-Runner, nicht QKERN | der Provisioner-Prozess von QKERN, in seiner Leerlaufrunde |
| Wiederherstellung auf einen Zeitpunkt | ja, aus dem WAL-Archiv | **nein**, nur auf den Stand eines Backups |
| Katalog in QKERN | keiner | `project_database_backups` (0083), Zeitplan `project_database_backup_schedules` (0084) |
| Bestellbar über HTTP | nein | ja, seit `2.129`, hinter der Rollenmatrix der Kontrollebene |
| Nachweis | signierte Evidenz, von QKERN verifiziert | Fälle `(2.126)`, `(2.129)` im Backup-Stack und `(2.130)` im PostgreSQL-Stack |

Der Rest dieses Dokuments beschreibt den **ersten** Weg, also die Evidenz der
Steuerungsdatenbank. Der zweite steht im Abschnitt danach.

## Zweck und Grenze des Evidenz-Weges

Den Weg der Steuerungsdatenbank führt QKERN nicht selbst aus. Ein getrennt betriebener, vertrauenswürdiger Drill-Runner muss eine echte Control-Plane-Sicherung in eine isolierte Zielumgebung wiederherstellen, Schema und Daten vergleichen und danach eine kleine Evidenz mit seinem Ed25519-Private-Key signieren. Der Private Key bleibt außerhalb von QKERN.

QKERN verifiziert diese Evidenz fail-closed. Eine erfolgreiche Prüfung bedeutet nur: Der vorgelegte, frische Drill-Nachweis ist authentisch, intern konsistent und erfüllt die fest codierte Mindestpolicy. Sie ersetzt weder den realen Drill noch Provider-, Storage-, Retention-, Zugriffsschutz- oder Disaster-Recovery-Zertifizierung. Sie kann Production-Apply nicht freischalten.

## Verifier-Key-Datei

QKERN liest ausschließlich einen öffentlichen Ed25519-Key:

```json
{
  "schemaVersion": "qkern.backup-restore-verifier-key/v1",
  "keyId": "restore-verifier-2026-07",
  "publicKey": "<32-byte-ed25519-public-key-as-unpadded-base64url>"
}
```

`QKERN_BACKUP_RESTORE_VERIFIER_KEY_SHA256` ist der kleingeschriebene SHA-256 über die 32 decodierten Public-Key-Bytes. Damit ist nicht nur der Dateipfad, sondern der erwartete Schlüssel selbst gepinnt. Die Key-ID ist begrenzt und muss mit der signierten Evidenz übereinstimmen.

Der Public Key ist kein Geheimnis, aber eine Autorität. In Production muss seine Datei regulär, ohne Symlink sowie nicht group-/world-writable sein. Sie darf weder mit der Evidenzdatei noch mit Vault-, Broker-, Webhook- oder Metrics-Token-Dateien identisch sein. Rotation bedeutet: neuen externen Signierschlüssel bereitstellen, Public-Key-Datei atomar ersetzen, Pin kontrolliert aktualisieren und danach einen neuen Drill signieren. Alte Evidenz mit abweichender Key-ID wird nicht akzeptiert.

## Evidenzvertrag

Die Evidenzdatei besitzt exakt diese Felder; zusätzliche oder fehlende Felder werden abgewiesen:

```json
{
  "schemaVersion": "qkern.backup-restore-evidence/v1",
  "keyId": "restore-verifier-2026-07",
  "evidence": {
    "evidenceId": "7a37f5c5-25d1-4e1b-9cb3-f5f43cc1a88a",
    "deployment": "production",
    "scope": "control_plane",
    "backupSnapshotAt": "2026-07-26T10:00:00.000Z",
    "backupCompletedAt": "2026-07-26T10:05:00.000Z",
    "restoreStartedAt": "2026-07-26T10:10:00.000Z",
    "restoreCompletedAt": "2026-07-26T10:30:00.000Z",
    "verifiedAt": "2026-07-26T10:40:00.000Z",
    "recoveryPointLagSeconds": 300,
    "restoreDurationSeconds": 1200,
    "backupArtifactSha256": "<64-lowercase-hex>",
    "sourceDataManifestSha256": "<64-lowercase-hex>",
    "restoredDataManifestSha256": "<same-64-lowercase-hex>",
    "encrypted": true,
    "checksumVerified": true,
    "schemaVerified": true,
    "rowCountsVerified": true,
    "auditChainVerified": true,
    "result": "passed"
  },
  "signature": "<64-byte-ed25519-signature-as-unpadded-base64url>"
}
```

Der Drill-Runner muss mindestens Folgendes wirklich prüfen:

- Backup-Artefakt vollständig, verschlüsselt und gegen seinen SHA-256 verifiziert
- Restore in eine neue isolierte Zielinstanz, niemals über das Quellsystem
- erwarteter Migration-Head und vollständiges Schema
- Rowcounts beziehungsweise ein gleichwertiges deterministisches Datenmanifest
- Hash-Kette des QKERN-Audit-Logs
- keine produktiven Credentials, Connection Strings, Providerantworten oder Rohdiagnosen in der Evidenz

`sourceDataManifestSha256` und `restoredDataManifestSha256` müssen identisch sein. Die Zeitpunkte müssen streng vorwärts geordnet sein; die beiden Sekundenwerte müssen exakt den Zeitdifferenzen entsprechen.

## Signaturpayload

Signiert wird nicht das frei formatierte JSON-Dokument, sondern die UTF-8-Codierung eines kompakten JSON-Arrays in exakt dieser Reihenfolge:

1. `schemaVersion`
2. `keyId`
3. `evidenceId`
4. `deployment`
5. `scope`
6. `backupSnapshotAt`
7. `backupCompletedAt`
8. `restoreStartedAt`
9. `restoreCompletedAt`
10. `verifiedAt`
11. `recoveryPointLagSeconds`
12. `restoreDurationSeconds`
13. `backupArtifactSha256`
14. `sourceDataManifestSha256`
15. `restoredDataManifestSha256`
16. `encrypted`
17. `checksumVerified`
18. `schemaVerified`
19. `rowCountsVerified`
20. `auditChainVerified`
21. `result`

Der QKERN-Referenzcode dafür ist `canonicalBackupRestoreEvidencePayload()` in `lib/server/backup/restore-evidence.ts`. Der externe Signer muss diesen Vertrag unabhängig implementieren und die resultierenden Bytes mit Ed25519 signieren.

## Feste Readiness-Policy

Eine gültige Signatur allein reicht nicht. QKERN verlangt zusätzlich:

- Evidenz höchstens sieben Tage alt
- höchstens fünf Minuten positive Clock-Skew
- verwendeter Backup-Snapshot bei Abschluss der Verifikation höchstens 24 Stunden alt
- Recovery-Point-Lag höchstens 24 Stunden
- Restore-Dauer höchstens vier Stunden
- `production` und `control_plane` als feste Scope-Bindung
- alle fünf Prüfassertionen exakt `true`
- Ergebnis exakt `passed`

Diese Werte sind Quellcode-Policy, keine vom Request oder Evidenzautor frei wählbaren Schwellen.

## Konfiguration und Ausführung

```bash
export QKERN_BACKUP_RESTORE_EVIDENCE_FILE="/run/qkern/backup-restore-evidence.json"
export QKERN_BACKUP_RESTORE_VERIFIER_KEY_FILE="/run/qkern/backup-restore-verifier-key.json"
export QKERN_BACKUP_RESTORE_VERIFIER_KEY_SHA256="<64-lowercase-hex>"
npm run verify:backup-restore
```

Erfolg liefert genau eine begrenzte JSON-Projektion auf stdout und Exit-Code `0`. Fehler liefern nur `BACKUP_RESTORE_EVIDENCE_NOT_READY` auf stderr und Exit-Code `1`; Signatur, Hashes, Pfade und interne Ursachen werden nicht ausgegeben. Inline-Evidenz und Inline-Public-Keys sind verboten.

## Monitoring

Für die optionale Einbindung in den vorhandenen, separat authentisierten OpenMetrics-Endpunkt:

```bash
export QKERN_BACKUP_RESTORE_EVIDENCE_ENABLED=true
```

Nach erfolgreicher Verifikation werden ausschließlich feste Metriken ausgegeben:

- `qkern_backup_restore_readiness`
- `qkern_backup_restore_recovery_point_lag_seconds`
- `qkern_backup_restore_duration_seconds`
- `qkern_backup_restore_snapshot_timestamp_seconds`
- `qkern_backup_restore_verified_timestamp_seconds`

Evidenz-ID, Key-ID, Digests, Dateipfade, Provider, Organisation, Projekte und Credentials sind weder Labels noch Werte. Ist die explizit aktivierte Evidenz ungültig, veraltet, unlesbar oder falsch signiert, liefert der gesamte authentisierte Scrape `503`; ein Collector muss Scrape-Ausfall und veralteten Verified-Timestamp als Critical alarmieren.

## Drill- und Archivierungsablauf

1. Neuen produktionsnahen Control-Plane-Backup-Snapshot erzeugen und verschlüsselte Ablage prüfen.
2. In eine neue isolierte Datenbankinstanz restoren.
3. Migration-Head, Schema, Rowcounts/Datenmanifest und Audit-Hash-Kette vergleichen.
4. Messwerte aus dem realen Lauf in den strikten Vertrag übernehmen.
5. Kanonisches Payload mit dem extern verwahrten Ed25519-Key signieren.
6. Evidenzdatei atomar und nicht group-/world-writable bereitstellen.
7. `npm run verify:backup-restore` ausführen und den grünen, cause-freien Nachweis zusammen mit den privaten Drill-Protokollen in der Release-Evidenz archivieren.
8. Metrics-Scrape und Alert-Routing prüfen.
9. Isolierte Restore-Instanz und temporäre Credentials kontrolliert entfernen.

Production bleibt gesperrt, bis dieser Ablauf gegen die echte Infrastruktur wiederholt erfolgreich, überwacht und archiviert wurde.

## Das Backup einer Projektdatenbank (2.126)

Dies ist der zweite Weg aus der Tabelle am Anfang. Er läuft **in** QKERN, und
jede Entscheidung darin ist im Quelltext begründet
(`lib/server/backup/project-database.ts`). Was hier steht, ist dieselbe Aussage
für einen Betreiber.

### Wer es fährt

Der vorhandene **Provisioner-Prozess**, als Pflicht in seiner Leerlaufrunde.
Kein neunter Prozess: Der Provisioner ist der einzige, der schon einen
privilegierten, Vault-gestützten Weg zu einer Projektdatenbank hat, und das Ziel
einer Wiederherstellung ist eine neue Datenbank — ein zweiter Prozess mit
`CREATEDB` wäre eine zweite Stelle mit dem schärfsten Recht im Cluster. Ein
wartender Projektauftrag geht immer vor; ein Backup lässt niemanden warten.

Ein Auftrag ist eine Zeile in `project_database_backups` im Zustand `pending`,
mit Lease, Versuchszähler und festem Fehlercode. Die Katalogtabelle **ist** die
Queue.

### Mit welcher Rolle

| Rolle | Rechte | Wozu |
| --- | --- | --- |
| `qkern_project_backup` | `LOGIN`, `BYPASSRLS`, Mitglied von `pg_read_all_data`, `NOCREATEDB`, kein Schreibrecht | liest die Datenbank für `pg_dump` und das Manifest |
| `qkern_project_restore_admin` | `LOGIN`, `CREATEDB`, Mitglied von `qkern_ledger_owner`, **kein** Superuser | legt die Zieldatenbank an und spielt den Dump hinein |

Die Rolle der Data API (`qkern_project_api_app`) ist für ein Backup **falsch**:
sie steht unter Zeilensicherheit und sichert damit die Schnittmenge der
Sichtbarkeiten. `BYPASSRLS` ist deshalb keine Bequemlichkeit, sondern die
Bedingung dafür, dass ein Backup vollständig ist.

Beide Zugangsdaten kommen aus **statischen Vault-Rollen**, abgeleitet aus dem
Rollenstamm der Bindung: `<stamm>-backup` und `<stamm>-restore-admin`. Wer eine
Projektdatenbank bereitstellt, legt diese zwei Vault-Rollen mit an. Kein Passwort
steht im Quelltext, keines in einer Umgebungsvariablen, keines in einem Log.
`pg_dump` und `psql` sind Kindprozesse und bekommen es über `PGPASSWORD` in einer
neu gebauten Umgebung — nie in `argv`, denn `argv` zeigt `ps` jedem Benutzer der
Maschine.

### Was ein Backup umfasst

Enthalten: Schema, Zeilen, Policies (samt `ENABLE`/`FORCE ROW LEVEL SECURITY`),
Erweiterungen, Sequenzen **mit ihrem Stand**, Eigentümer und Rechte, und das
`qkern_internal`-Schema mit Ledger, Zaun und Änderungs-Feed.

Nicht enthalten, mit Grund:

- **Cluster-Rollen.** `CREATE ROLE` ist clusterweit und nicht Teil einer
  Datenbank. Eine Wiederherstellung setzt voraus, dass die Rollen der
  Projektdatenbank im Zielcluster schon existieren; sie entstehen beim
  Bereitstellen.
- **Jeder Zeitpunkt zwischen zwei Backups.** Ein logischer Dump ist ein
  Zeitpunkt, kein Fenster. Es gibt kein WAL-Archiv je Projektdatenbank und damit
  keine Wiederherstellung auf eine beliebige Sekunde. Das bleibt die Zusage des
  Control-Plane-Weges und wird für Projektdaten nicht behauptet.

Warum logisch und nicht physisch: Ein `pg_basebackup` zieht den **Cluster**. In
einem Cluster mit mehreren Projektdatenbanken wäre das Artefakt eines Mandanten
ein Backup fremder Mandanten mit, und keine Verschlüsselung repariert das — wer
sein eigenes Backup entschlüsseln darf, entschlüsselt es ganz.

### Wohin die Bytes gehen, und in welcher Form

In den Objektspeicher, den QKERN für Project Storage schon betreibt, über
denselben SigV4-Signierer. Nicht auf die Platte des Dienstes: ein Prozess, der
Backups neben sich ablegt, verliert sie mit sich. Der Objektschlüssel wird aus
der Zeile abgeleitet und nie aus einer Anfrage:
`project-database-backups/<organisation>/<projekt>/<umgebung>/<id>.qkbak`.
Migration 0083 prüft die Form noch einmal in der Datenbank.

Der Port kennt **kein `list`**: wer auflisten kann, kann über das Präfix eines
fremden Mandanten auflisten. Die Liste der Backups steht in der Control Plane
unter Zeilensicherheit.

#### Stückweise, als Strom (2.129)

`2.73.0` trug den Dump in **einem** Stück durch den Speicher und hatte darum eine
Obergrenze von 256 MiB. Für eine echte Mandantendatenbank ist das zu klein, und
die Grenze selbst war durch keinen Lauf geprüft. Seit `2.129` gilt:

- **Die Ausgabe von `pg_dump` geht als Strom** durch die Verschlüsselung in die
  Teile eines Multipart-Uploads. Strom und nicht Datei, und der Grund ist nicht
  Platzersparnis: eine Datei auf der Platte wäre ein **entschlüsselter** Dump
  einer Mandantendatenbank auf einem Wirt des Betreibers. Dieselbe Zusage stand
  für die Wiederherstellung schon da; sie beim Sichern zu brechen wäre eine
  Zusage, die nur in eine Richtung gilt.
- **Ein Siegel je Teil**, nicht eines über das Ganze. Das ist der Preis des
  Stroms, und er ist bezahlt: Die zusätzlichen Daten (AAD) eines Teils binden
  seine **Nummer**, ein **`final`-Zeichen** und das **Tag des Vorgängers**. Damit
  hält der Umschlag gegen Vertauschen (die Nummer), Weglassen in der Mitte (die
  Kette), Abschneiden am Ende (nur der letzte Teil trägt `final`) und Einfügen
  (beides).
- **Die Gesamtzahl steht nicht in der AAD**, und das ist eine Entscheidung: Beim
  Siegeln des ersten Teils ist sie unbekannt, und sie zu kennen hieße, den ganzen
  Dump vorher zu haben. Sie steht in der Katalogzeile (`part_count`), weil ein
  Leser daraus die Bytebereiche rechnet; weicht sie von Kette und `final`-Zeichen
  ab, gewinnt der Umschlag und nicht die Zeile.
- **Die Obergrenze ist gerechnet und nicht gesetzt:** Nutzbytes je Teil mal
  Teilegrenze des S3-Protokolls. Mit den Voreinstellungen `64 MiB × 10 000 =
  **625 GiB**`. Beide Zahlen lassen sich im Betrieb verschieben
  (`QKERN_PROJECT_BACKUP_PART_BYTES`, `QKERN_PROJECT_BACKUP_MAX_PARTS`); der Weg
  ist derselbe Code. Nach unten begrenzt die Teilegröße das S3-Protokoll (5 MiB
  für jeden Teil außer dem letzten), nach oben der Speicher des Wirts (ein Teil
  liegt beim Siegeln einmal als Klartext und einmal als Geheimtext im Heap, also
  kostet 64 MiB etwa 130 MiB Spitze — der Weg aus `2.73.0` kostete dort 512 MiB).
- **Die Wiederherstellung liest in Bytebereichen**, Teil für Teil, und schiebt
  jeden entschlüsselten Teil in `stdin` von `psql`. Nichts liegt als Ganzes im
  Speicher, und nichts liegt entschlüsselt auf einer Platte.
- **Artefakte aus `2.73.0` bleiben lesbar.** Ihre Zeile trägt `artifact_format =
  'single'`, und dafür gibt es weiter den alten Leseweg mit der alten Grenze. Ein
  Weg, der sein eigenes altes Format nicht mehr liest, ist eine Aufbewahrung, die
  mit dem Release endet. Neu entsteht kein `single`-Artefakt mehr.

**Was die Prüfung dabei kostet, ausgeschrieben:** Der SHA-256 des ganzen
Artefakts ist beim stückweisen Lesen nicht mehr der Riegel **vor** dem Lesen, der
er in `2.73.0` war — wer streamt, kennt die Summe des Ganzen erst am Ende. An
seine Stelle tritt das GCM-Tag je Teil, und das ist eine **geschlüsselte** Prüfung
und damit schärfer; geprüft wird es, bevor der Klartext eines Teils hinausgeht.
Der SHA-256 bleibt als Aussage "dieses Objekt ist das, das die Zeile vermerkt
hat" und fällt am Ende. Ein Fehlschlag dort trifft eine Wiederherstellung, in die
`psql` schon Teile gespielt hat — tragbar, **weil** sie in eine neue Datenbank
geht: zurück bleibt eine halbe neue Datenbank und ein Fehler, nicht eine
beschädigte lebende Datenbank. Ein Objekt, das kürzer ist als seine Zeile, fällt
am Bytebereich auf, mit dem Code des Objektspeichers.

### Verschlüsselung, Schlüssel, und wer ein Backup lesen kann

Zwei Ebenen, beide AES-256-GCM:

1. Ein **Datenschlüssel je Backup**, 32 Byte aus `randomBytes`, verschlüsselt die
   Bytes des Dumps. Er wird nie gespeichert und nie übertragen.
2. Ein **Mandanten-Schlüssel** aus dem Vault wickelt den Datenschlüssel ein. Was
   in der Control Plane liegt, ist genau dieses Päckchen.

Beide Ebenen binden Organisation, Projekt, Umgebung und Backup-Id als
zusätzliche Daten (AAD) ein. Fremde Bytes gehen unter eigener Kennung nicht auf,
und ein Päckchen aus der Zeile eines Mandanten lässt sich nicht in die Zeile
eines anderen schreiben.

**Die Aussage, die ein Kunde kennen muss: der Betreiber kann ein Backup lesen.**
Wer den Vault-Schlüssel des Mandanten bekommt, bekommt den Datenschlüssel und
damit den Dump. QKERN hat heute keine kundengehaltenen Schlüssel. Ein Backup ist
gegen den Verlust des Objektspeichers geschützt, nicht gegen den Betreiber.

Der Mandanten-Schlüssel liegt als Datei, die ein Vault Agent schreibt (64
Hexzeichen, in Production `0600`), und wird **je Gebrauch** gelesen und danach
im Speicher mit Null überschrieben. Eine Rotation wirkt ohne Neustart. Nimmt man
einen alten Schlüssel weg, sind die Backups, die er eingewickelt hat, unlesbar —
das ist das Löschen eines Backups durch Wegnehmen des Schlüssels.

### Wohin wiederhergestellt wird

Immer in eine **neue** Datenbank, angelegt von `qkern_project_restore_admin`,
benannt nach der Backup-Id. Niemals über die lebende Datenbank. Es gibt in
diesem Weg kein `DROP DATABASE` und kein `TRUNCATE`; der Umschwung bleibt beim
Betreiber.

Vor dem Umschwung prüft QKERN selbst: Das Manifest der wiederhergestellten
Datenbank muss dem Manifest entsprechen, das beim Backup gemessen wurde.
Stimmt es nicht, ist das Ergebnis ein Fehler und keine Datenbank, die jemand für
wiederhergestellt hält. Das Manifest trägt sechs Teile (Schema, Zeilen, Policies,
Erweiterungen, Sequenzen, Rechte), damit ein Fehlschlag sagt, **was** abweicht.

### Mandantengrenze

Drei Riegel, keiner davon ein Filter in einer Anfrage:

1. **Zeilensicherheit** in 0083, mit `FORCE`, also auch für den Eigentümer. Der
   Dienst läuft je Organisation; ein `SELECT` ohne `WHERE` gibt nur die eigenen
   Backups.
2. **Der Objektschlüssel** beginnt mit der Organisation und wird aus der Zeile
   abgeleitet.
3. **Die AAD des Umschlags**, siehe oben.

### Die Route, und wer sie benutzen darf (2.129)

| Verb und Pfad | Was es tut | Recht |
| --- | --- | --- |
| `GET .../database/backups` | Katalog dieser Umgebung **und** ihr Zeitplan | `project_backup_read` |
| `POST .../database/backups` | bestellt ein Backup (202, oder 200 wenn eines wartet) | `project_backup_request` |
| `GET .../database/backups/{backupId}` | Zustand eines Backups, samt bestellter Wiederherstellung | `project_backup_read` |
| `POST .../database/backups/{backupId}/restore` | stößt eine Wiederherstellung an (202) | `project_backup_restore` |

| Recht | Rollen |
| --- | --- |
| `project_backup_read` | Eigentümer, Administrator, Deployer, Support |
| `project_backup_request` | Eigentümer, Administrator |
| `project_backup_restore` | **nur** Eigentümer |

**Kein Projekt-Key.** Die Route unter `point-in-time` nimmt einen; diese nicht,
und das ist der wichtigste Satz dieses Abschnitts. Ein Projekt-Key liegt in einer
Anwendung — in einer Funktion, in einem Worker, in einem CI-Lauf. Wer irgendwo
einen findet, könnte damit den Dump jeder Zeile der Datenbank anstoßen; dass er
ihn nicht lesen kann, ändert daran nichts, denn er kann Last erzeugen und über
die Wiederherstellung eine zweite Datenbank im Cluster anlegen lassen. Darum geht
diese Route durch die Rollenmatrix der Kontrollebene, wie `provisioning` und
`api-keys`. Eine Rolle ohne Recht bekommt **404** und nicht 403: sie soll nicht
erfahren, dass es dieses Projekt gibt.

**Warum nur der Eigentümer zurückholen darf.** Eine Wiederherstellung ist kein
Lesen, und zwar aus drei Gründen: Sie legt eine **neue Datenbank** an, die Geld
kostet, bis jemand sie wegnimmt. Sie bringt **gelöschte Daten zurück** — hat ein
Mandant Daten auf Verlangen einer Person gelöscht, steht sie danach in einer
zweiten Datenbank, die niemand in einem Löschauftrag genannt hat. Und sie ist
**nicht wiederholbar**: ein Fehlschlag lässt eine halb gebaute Datenbank liegen,
die ein Mensch ansehen muss. Ein Administrator darf ein Backup bestellen und den
Katalog lesen; die Datenbank zurückholen darf der, der für die Organisation
haftet.

**Die Route führt die Wiederherstellung nicht aus.** `CREATEDB` hat in QKERN
genau einen Prozess, und der Next-Prozess ist es nicht; er hat auch kein `psql`,
kein `pg_dump` und keinen Vault-Weg in eine Projektdatenbank. Die Route schreibt
einen Auftrag in die Katalogzeile, antwortet 202 und ist fertig. Der Provisioner
nimmt ihn in derselben Runde, in der er Backups fährt, und **vor** einem Backup:
dort wartet ein Mensch. Das Ergebnis liest man über `GET` auf das Backup, unter
`restore.status` und bei einem Fehlschlag `restore.errorCode`.

Dafür bekommt die Laufzeitrolle `qkern_runtime` ein `UPDATE` auf **vier Spalten**
und nicht auf die Tabelle. Die Zusage aus 0083 — "ein Weg, der einen Zustand von
Hand auf `available` setzen kann, wäre ein Weg, ein Backup zu behaupten" — bleibt
damit wortwörtlich stehen. Fall `(2.130)` prüft das an der Rolle selbst.

**Was die Antwort nicht trägt:** keinen Objektschlüssel, keinen eingewickelten
Datenschlüssel, keinen Schlüsselnamen, keine Prüfsumme des Artefakts und keinen
Verweis auf die Datenbankinstanz. Das Manifest-Digest geht hinaus: es ist eine
Zahl über den **eigenen** Stand und die Angabe, mit der ein Betreiber zwei
Backups unterscheidet.

### Der Zeitplan (2.129)

Bis `2.129` stellte niemand von sich aus einen Auftrag ein, und `pruneExpired`
rief niemand.

**Geprüft wurde zuerst, ob der vorhandene Cron-Weg das trägt.** Er trägt es
nicht, und zwar aus vier Gründen: Eine Cron-Definition zeigt auf eine
**Compute-Funktion des Mandanten** und schiebt eine Nachricht in eine
Projekt-Queue; sie läuft im **Compute-Prozess** und nicht im Provisioner; sie ist
**mandantenbearbeitbar**, also könnte ihr Besitzer sie abschalten oder umbiegen;
und ein Backup braucht keinen Cron-Ausdruck, sondern einen Takt — ein Ausdruck
brächte Zeitzone und Sommerzeit in einen Weg, der sie nicht braucht.

**Und doch ist kein zweiter Scheduler entstanden.** Es gibt keinen Timer, keine
neunte Schleife und kein `setInterval`: Der Takt ist eine Pflicht in der Runde,
die es schon gibt. `ProjectDatabaseBackupService.runRound` ruft ihn, und diese
Runde ruft der Provisioner in seiner Leerlaufrunde. Wer den Zeitplan laufen sehen
will, startet den Provisioner.

| Frage | Antwort |
| --- | --- |
| Wo steht der Takt | `project_database_backup_schedules.interval_hours`, Voreinstellung 24 (Supabase sichert auf den bezahlten Stufen täglich) |
| **Wo steht die Frist je Umgebung** | `retention_days` in derselben Zeile. Vorher stand sie in `QKERN_PROJECT_BACKUP_RETENTION_DAYS`, also für alle Projekte und Umgebungen eines Prozesses gleich; die Variable bleibt als **Vorgabe** für eine Umgebung ohne Zeile |
| Wer legt eine Zeile an | ein **Trigger** auf `project_database_bindings`. "Jede bereitgestellte Projektdatenbank hat einen Zeitplan" ist eine Aussage über den Zustand und nicht über einen Aufrufer; als Aufrufer wäre sie an genau einem Pfad wahr |
| `development` | Zeile vorhanden, aber **abgeschaltet**. Eine Entwicklungsdatenbank ist eine, die ein Entwickler wegwirft; ein täglicher Dump davon ist Kosten ohne Zusage |
| Ein Lauf findet den vorigen noch laufend | Es entsteht **kein** zweiter Auftrag (`enqueue` gibt den vorhandenen zurück). Der Takt wird trotzdem fortgeschrieben, sonst wäre jede Runde des Provisioners ein weiterer fälliger Takt. Gezählt wird es in `busy_count` — in der Zeile und nicht nur im Log, weil ein Log nach vier Wochen weg ist |
| Nachholen nach einem Ausfall | **nichts.** Fortgeschrieben wird auf `now() + interval` und nicht auf `next_due_at + interval`: Ein nachgeholtes Backup von vorletzter Woche sichert den Stand von heute und ist damit nicht, was es vorgibt |
| Zwei Wirte, ein fälliger Takt | Holen und Fortschreiben sind **eine** Anweisung (`UPDATE … RETURNING` über `FOR UPDATE SKIP LOCKED`). Zwei Anweisungen würden beide dieselbe fällige Zeile sehen |
| Wer ruft `pruneExpired` | derselbe Takt, höchstens einmal je `pruneIntervalMs` (Voreinstellung eine Stunde). Der Zeitpunkt steht **im Prozess** und nicht in einer Spalte: Aufräumen ist idempotent, und ein Neustart kostet höchstens eine zusätzliche leere Abfrage |

**Der Preis, ausgeschrieben:** Fortgeschrieben wird in derselben Anweisung, die
die fälligen Zeilen holt, also **vor** dem Einstellen des Auftrags. Scheitert das
Einstellen danach, fällt dieser Takt aus und der nächste kommt nach
`interval_hours`. Die andere Reihenfolge wäre ein Takt, der nach einem Fehlschlag
jede Runde wieder feuert, und das ist bei einem dauerhaft kaputten Weg eine
Schleife.

### Aufbewahrung

30 Tage (Supabase gibt auf den bezahlten Stufen sieben bis 28 Tage; kürzer wäre
eine Zusage unter dem Vergleichsprodukt). Obergrenze 730 Tage, dieselbe wie bei
der Erklärung zum WAL-Archiv. Seit `2.129` steht die Frist **je Umgebung** in der
Zeitplanzeile; die Prozessvariable ist nur noch die Vorgabe für eine Umgebung
ohne Zeile. Der Aufräumer arbeitet portionsweise, mit
Obergrenze und mit einspeisbarer Uhr, und in dieser Reihenfolge: **erst das
Objekt, dann die Zeile.** Umgekehrt wäre eine Zeile weg, deren Objekt noch liegt,
und dann kennt niemand mehr den Schlüssel, unter dem es liegt.

Eine abgelaufene Zeile bleibt stehen und verliert nur das, was lesen lässt
(Objektverweis, eingewickelter Schlüssel, Prüfsumme, Grösse). Die Zeile ist dann
die Antwort auf "hat es am 3. Mai ein Backup gegeben"; ohne sie wäre die
Aufbewahrung auch eine Löschung der Tatsache.

### Was es nicht gibt

- **Keinen Knopf in der Console.** Die Route gibt es seit `2.129`; die Seite
  "Datenbank → Backups" ruft sie nicht und liest weiter nur die Route unter
  `point-in-time`. Was dort fehlt, ist seither die **Verdrahtung** und nicht mehr
  der Weg, und die Texte der Seite sagen genau das.
- **Keinen Beleg, dass 625 GiB wirklich durchgehen.** Geprüft ist die Rechnung,
  mit `5 MiB × 2` gegen einen Dump von 12 MB. Der größte Dump, der je durch
  diesen Weg lief, ist 12 MB groß.
- Keine Wiederherstellung auf einen Zeitpunkt für Projektdaten.
- Keine kundengehaltenen Schlüssel, und die Rotation eines Mandanten-Schlüssels
  ist durch keinen Fall belegt.
- Keine Route, die den Zeitplan ändert. Takt, Frist und `enabled` ändert heute
  nur, wer in die Tabelle schreiben darf, also der Provisioner.
