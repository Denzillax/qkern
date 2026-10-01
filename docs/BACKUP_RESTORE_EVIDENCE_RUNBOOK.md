# Backup/Restore Evidence Runbook

## Zwei Wege, und sie dürfen nicht verwechselt werden

Seit 2.126 gibt es in QKERN **zwei** Backup-Wege, und sie sichern Verschiedenes:

| | Steuerungsdatenbank (`2.29.0`) | Projektdatenbank (`2.126`) |
| --- | --- | --- |
| Was | physisches Basisbackup des Clusters | logisches Backup genau einer Datenbank |
| Wer fährt es | ein externer Drill-Runner, nicht QKERN | der Provisioner-Prozess von QKERN, in seiner Leerlaufrunde |
| Wiederherstellung auf einen Zeitpunkt | ja, aus dem WAL-Archiv | **nein**, nur auf den Stand eines Backups |
| Katalog in QKERN | keiner | `project_database_backups` (Migration 0083) |
| Nachweis | signierte Evidenz, von QKERN verifiziert | Fall `(2.126)` im Backup-Stack |

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

### Wohin die Bytes gehen

In den Objektspeicher, den QKERN für Project Storage schon betreibt, über
denselben SigV4-Signierer. Nicht auf die Platte des Dienstes: ein Prozess, der
Backups neben sich ablegt, verliert sie mit sich. Der Objektschlüssel wird aus
der Zeile abgeleitet und nie aus einer Anfrage:
`project-database-backups/<organisation>/<projekt>/<umgebung>/<id>.qkbak`.
Migration 0083 prüft die Form noch einmal in der Datenbank.

Der Port kennt `put`, `get` und `delete` und **kein `list`**: wer auflisten kann,
kann über das Präfix eines fremden Mandanten auflisten. Die Liste der Backups
steht in der Control Plane unter Zeilensicherheit.

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

### Aufbewahrung

30 Tage (Supabase gibt auf den bezahlten Stufen sieben bis 28 Tage; kürzer wäre
eine Zusage unter dem Vergleichsprodukt). Obergrenze 730 Tage, dieselbe wie bei
der Erklärung zum WAL-Archiv. Der Aufräumer arbeitet portionsweise, mit
Obergrenze und mit einspeisbarer Uhr, und in dieser Reihenfolge: **erst das
Objekt, dann die Zeile.** Umgekehrt wäre eine Zeile weg, deren Objekt noch liegt,
und dann kennt niemand mehr den Schlüssel, unter dem es liegt.

Eine abgelaufene Zeile bleibt stehen und verliert nur das, was lesen lässt
(Objektverweis, eingewickelter Schlüssel, Prüfsumme, Grösse). Die Zeile ist dann
die Antwort auf "hat es am 3. Mai ein Backup gegeben"; ohne sie wäre die
Aufbewahrung auch eine Löschung der Tatsache.

### Was es nicht gibt

- Keine Route mit Schreibverb, die ein Backup bestellt, und keinen Knopf in der
  Console. Ein Auftrag entsteht heute über den Dienst, nicht über HTTP.
- Die Console liest den Katalog nicht; die Seite "Datenbank → Backups" liest
  weiter nur die Route unter `point-in-time`.
- Keine Wiederherstellung auf einen Zeitpunkt für Projektdaten.
- Keine kundengehaltenen Schlüssel.
