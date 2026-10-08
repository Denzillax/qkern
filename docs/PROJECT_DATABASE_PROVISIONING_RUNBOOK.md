# Project Database Provisioning Runbook

## Sicherheitsvertrag

QKERN provisioniert nicht im Webrequest. Owner oder Administratoren dürfen mit einem leeren JSON-Objekt `POST /api/v1/projects/{projectId}/environments/{environment}/provisioning` einen tenantgebundenen Auftrag anlegen. Die Antwort enthält nur Job-ID, Status, feste Fehlercodes und begrenzte Zähler; sie enthält keine Instanzreferenz, Hosts, Vault-Rollen, Lease-Daten oder Credentials. Wiederholungen sind idempotent.

Der Web-Login besitzt nach Migration `0020_project_database_provisioning.sql` keine direkten UPDATE-/DELETE-Rechte auf Projekte oder Projektumgebungen. Nur `qkern_provisioner_app`, ausschließlich Mitglied von `qkern_provisioner`, darf Provisioning-Jobs claimen, ein secret-freies Binding einfügen und eine noch `pending:*` referenzierte Umgebung atomar binden. Migration `0021_project_database_provisioning_health.sql` erlaubt dem Provisioner zusätzlich nur das tenant- und selbstgebundene Aktualisieren seines eigenen Heartbeats.

## Bootstrap-Vertrag

Der Infrastruktur-Broker muss diese Dateien genau in der angegebenen Reihenfolge anwenden:

1. `db/project/0001_qkern_migration_ledger.sql`
2. `db/project/0002_qkern_migration_fence.sql`

Der SHA-256 über `Datei 1 || NUL || Datei 2` lautet:

```text
e69a830d70f785477af0165667f56735821e25a58bf724a17b46cf33d5358d67
```

Der Broker muss außerdem die getrennten Rollen `qkern_ledger_owner` (Non-Login) und `qkern_project_migrator` (Least-Privilege-Login ohne unerwartete Mitgliedschaften), die Vault-Static-Role und den Zertifikatspin bereitstellen. Ein abweichender Bootstrap-Hash wird nicht gebunden.

**`qkern_ledger_owner` darf keine einzige Mitgliedschaft haben — in beide
Richtungen.** Die Grenzprüfung des Migrationszaunes lehnt jede Migration ab,
sobald jemand Mitglied dieser Rolle ist oder sie Mitglied von etwas ist:

```sql
EXISTS (SELECT 1 FROM pg_auth_members m
        WHERE m.roleid = owner.oid OR m.member = owner.oid)
```

Das ist im Betrieb leicht zu verletzen, weil PostgreSQL dagegen arbeitet: **Seit
Version 16 teilt `CREATE ROLE` die neue Rolle dem Erzeuger automatisch mit ADMIN
OPTION zu.** Wer die Rolle anlegt, verletzt die Bedingung im selben Atemzug.
Nach dem Anlegen gehört deshalb:

```sql
REVOKE qkern_ledger_owner FROM <erzeugende Rolle>;
```

Die Rolle ist **clusterweit**. Ein Grant, den irgendjemand irgendwo setzt, macht
Migrationen für **alle** Projektdatenbanken dieses Clusters unmöglich — nicht
nur für die eine, um die es gerade ging. Genau daran hat Release 1.49 einen
Zertifizierungslauf verloren.

## Brokervertrag

QKERN sendet per HTTPS POST ausschließlich:

```json
{
  "provisioningJobId": "<uuid>",
  "organizationId": "<uuid>",
  "projectId": "<uuid>",
  "environment": "production",
  "region": "<bounded-region>",
  "bootstrapContractSha256": "e69a830d70f785477af0165667f56735821e25a58bf724a17b46cf33d5358d67"
}
```

`Idempotency-Key` und `X-QKERN-Provisioning-Job-Id` entsprechen der Job-ID. `X-QKERN-Signature` ist HMAC-SHA-256 über `<unix-seconds>.<raw-json-body>`; `X-QKERN-Signature-Key-Id` wählt den Rotationsschlüssel. Der Broker muss Timestamp, Signatur, Job-ID, Tenant-/Provider-ACL und Idempotenz prüfen. Redirects sind nicht erlaubt.

Die einzig akzeptierte Antwortform ist:

```json
{
  "status": "ready",
  "provisioningJobId": "<same-uuid>",
  "binding": {
    "databaseInstanceRef": "managed:<opaque-reference>",
    "vaultStaticRole": "<role>",
    "host": "<database-host>",
    "port": 5432,
    "expectedRole": "qkern_project_migrator",
    "expectedDatabase": "<database-name>",
    "expectedLedgerOwner": "qkern_ledger_owner",
    "serverCertificateSha256": "<64-lowercase-hex>",
    "bootstrapContractSha256": "e69a830d70f785477af0165667f56735821e25a58bf724a17b46cf33d5358d67"
  }
}
```

Passwörter, Provider-Tokens und Connection Strings besitzen keinen Vertrags- oder Persistenzslot.

### Abbau einer Projektdatenbank (2.177)

Ist ein gelöschtes Projekt nach Ablauf seiner Frist abgeräumt, bittet der Provisioner den Broker, jede seiner Datenbanken abzubauen. QKERN selbst führt nie `DROP DATABASE` aus. Die Anfrage geht per HTTPS POST an `QKERN_PROVISIONING_BROKER_TEARDOWN_URL`, signiert wie oben, mit demselben Schlüssel und derselben Host-Liste:

```json
{
  "teardownRequestId": "<uuid>",
  "organizationId": "<uuid>",
  "projectId": "<uuid>",
  "environment": "production",
  "databaseInstanceRef": "managed:<opaque-reference>",
  "restoreDatabases": ["<restore-target-database>"]
}
```

`Idempotency-Key` und `X-QKERN-Teardown-Request-Id` entsprechen der `teardownRequestId`. Eine Wiederholung nach Ablehnung oder Zeitüberschreitung trägt dieselbe Kennung; der Broker bestätigt einen schon erledigten Abbau noch einmal. `restoreDatabases` nennt die Zieldatenbanken früherer Wiederherstellungen im selben Cluster.

Bestätigt ist nur genau diese Antwort:

```json
{ "status": "torn_down", "teardownRequestId": "<same-uuid>" }
```

Alles andere zählt als Fehlschlag (`PROVIDER_UNAVAILABLE`, `PROVIDER_REJECTED`, `INVALID_RESPONSE`, `TEARDOWN_TIMEOUT`). Der nächste Versuch folgt nach einer Minute, danach mit doppeltem Abstand bis höchstens einer Stunde. Bis der Broker jede Datenbank bestätigt hat, bleibt `purged_at` leer, die Datenbank gesperrt (die Keys sind seit der Löschung abgelehnt), und die Console zeigt das Projekt als „wird abgeräumt“. Ohne `QKERN_PROVISIONING_BROKER_TEARDOWN_URL` geht keine Anfrage hinaus, und das Projekt wartet.

## Startreihenfolge

1. Migrationen `0020_project_database_provisioning.sql` und `0021_project_database_provisioning_health.sql` kontrolliert in dieser Reihenfolge anwenden.
2. Getrennten Login `qkern_provisioner_app` nur an `qkern_provisioner` binden und die Pool-Startprüfung erfolgreich ausführen.
3. Private Broker-Schlüsseldatei mit exakt `{"keyId":"<version>","secret":"<mindestens-32-Bytes>"}` bereitstellen; in Production sind Group-/World-Bits verboten.
4. Exakte Broker-URL, Host-Allowlist, Tenant, Provisioner-ID, Lease und Timeout konfigurieren. Das Timeout muss mindestens 1000 ms unter der Lease liegen.
5. `npm run provisioner:projects` starten und redigierte JSON-Events überwachen.
6. Migration Worker mit `QKERN_PROJECT_DATABASE_CATALOG_SOURCE=control-plane`, demselben Tenant, privatem Vault-Agent-Token-Sink und `npm run worker:migrations` starten.

## Health und Alarmgrenzen

`GET /api/v1/projects/provisioning/health` ist für Rollen mit `project_provisioning_read` verfügbar und liefert ausschließlich Tenant-Aggregate. `qkern_runtime` besitzt weder `SELECT` auf Jobs/Heartbeats noch einen Ausgabeslot für Projekt-, Job-, Provisioner-, Lease-, Host-, Vault- oder Credential-Felder. Antworten sind `private, no-store`.

- `critical`: Recovery ausgeschöpft, Lease abgelaufen, aktive Arbeit ohne Heartbeat innerhalb von zwei Minuten oder aktiver `INVALID_BINDING`-/`BOOTSTRAP_UNVERIFIED`-Fehler
- `degraded`: terminaler, noch recoverbarer Fehler, über fünf Minuten pendenter Auftrag, anderer aktiver fester Fehler oder innerhalb des 24-Stunden-Fensters stale gewordener Provisioner
- `healthy`: keine dieser Bedingungen

Der Endpunkt ist eine interne, persistente Evidenzquelle. Production benötigt weiterhin einen externen Scraper/OTel-Collector, Alarmrouting, Prozess-/Pod-Readiness und einen geübten Recovery-Drill.

## OpenMetrics-Scraping

v0.25 ergänzt den standardmäßig deaktivierten Endpunkt `GET /api/internal/v1/projects/provisioning/metrics`. Er verwendet dieselbe fail-closed geprüfte Health-Projektion und exportiert nur feste Zustands-, SLO-, Fehlerursachen- und Provisioner-Counts im OpenMetrics-1.0-Format. Organisation, Projekte, Environments, Jobs, Provisioner-IDs, Lease-Owner/-Token, Hosts, Ports, Vault-Rollen, Bindings und Credentials sind weder Labels noch Werte.

```bash
export QKERN_RUNTIME_MODE=postgres
export QKERN_PROVISIONING_METRICS_ENABLED=true
export QKERN_PROVISIONING_METRICS_ORGANIZATION_ID="00000000-0000-4000-8000-000000000001"
export QKERN_PROVISIONING_METRICS_TOKEN_FILE="/run/qkern/provisioning-metrics-token"
```

Die Token-Datei enthält 32–256 Zeichen aus einer engen ASCII-Allowlist. Production verlangt eine reguläre Datei ohne Symlink sowie Mode `0600`; sie wird bei jedem Scrape neu gelesen, damit Rotation ohne Neustart wirkt. Der Pfad muss von Vault-, Broker- und Webhook-Schlüsseldateien getrennt sein. Ein Inline-Token wird nicht akzeptiert.

Der Scraper sendet ausschließlich `Authorization: Bearer <token>`. Browser-Session-Cookies, `X-QKERN-Organization` und andere Requestwerte können weder Tenant noch Actor bestimmen. Der Tenant kommt ausschließlich aus der serverseitigen UUID-Konfiguration, der Actor ist fest `monitor:project-provisioning-metrics`. Fehlende Authentisierung liefert 401, deaktivierter Export 404 und fehlerhafte Konfiguration, Token-Datei oder Projektion 503; alle Antworten sind `no-store`.

Empfohlene externe Alarmregeln:

- `critical`, sobald `qkern_project_provisioning_health_status{status="critical"} == 1`
- `degraded`, wenn der entsprechende Status über ein festgelegtes Betriebsfenster bestehen bleibt
- Scrape-Ausfall oder 503 als eigener Critical-Alarm
- abgelaufene Lease, ausgeschöpfte Recovery und fehlender aktiver Provisioner ohne zusätzliche Kundendatenlabels alarmieren

## Backup-/Restore-Evidenz

Mit v0.26 kann derselbe authentisierte Scrape optional einen extern erzeugten, Ed25519-signierten Control-Plane-Restore-Drill nach der festen QKERN-Policy verifizieren. `QKERN_BACKUP_RESTORE_EVIDENCE_ENABLED=true` ergänzt ausschließlich feste Readiness-, Recovery-Point-Lag-, Restore-Dauer- und Timestamp-Metriken. Evidenz-ID, Key-ID, Digests, Organisationen, Projekte, Provider und Pfade werden nicht exportiert. Ungültige, manipulierte oder veraltete aktivierte Evidenz macht den Scrape `503`.

Der vollständige Signatur-, Datei-, Rotations-, Drill- und Archivierungsvertrag steht in `docs/BACKUP_RESTORE_EVIDENCE_RUNBOOK.md`. Der Verifier führt selbst keinen Backup-/Restore-Vorgang aus und gibt Production-Apply nicht frei.

## Live-Deployment-Evidenz

Mit v0.29 kann derselbe authentisierte Scrape zusätzlich die extern erzeugte und Ed25519-signierte Zertifizierung der vier Background-Runtimes prüfen. `QKERN_RUNTIME_DEPLOYMENT_EVIDENCE_ENABLED=true` ergänzt ausschließlich feste Readiness-, Komponentenanzahl-, Beobachtungsdauer- und Timestamp-Metriken. Evidenz-ID, Namespace, Cluster-, Bundle-, Image-, NetworkPolicy- und Provenance-Digests, Key-ID, Registry und Dateipfade werden nicht exportiert. Ungültige, manipulierte, falsch gepinnte oder ältere als 24 Stunden aktivierte Evidenz macht den Scrape `503`.

## Provider-/Pager-E2E-Evidenz

Mit v0.31 kann derselbe Scrape den unabhängig signierten Real-Service-Lauf prüfen.
`QKERN_PROVIDER_E2E_EVIDENCE_ENABLED=true` ergänzt nur Readiness, die feste Anzahl
von 15 Szenarien, Laufdauer, Lauf-/Signaturzeit und PostgreSQL-Major-Version.
Provideridentität, Provider-/Vault-/Broker-/Pager-Konfiguration, Restore-/Runtime-
Digests, Key-ID und Dateipfade werden nicht exportiert. Fehler oder Evidenz älter als
24 Stunden machen den Scrape `503`.

Der vollständige Vertrag steht in `docs/PROVIDER_E2E_EVIDENCE_RUNBOOK.md`. Der
Verifier führt keine Provider-, Vault-, Pager- oder Datenbankaktion aus und ersetzt
weder das private Testprotokoll noch die unabhängige Release-Autorisierung.

## Security-Assessment-Evidenz

Mit v0.32 kann derselbe Scrape die unabhängig signierte Release-Security-
Zertifizierung prüfen. `QKERN_SECURITY_ASSESSMENT_EVIDENCE_ENABLED=true` ergänzt
nur Readiness, 14 Kontrollen, null offene Critical-/High-Findings, Dauer und
Zeitpunkte. Report-/Release-Digests, Key-ID, Evidence-ID und Dateipfade werden nicht
exportiert. Fehler oder Evidence älter als sieben Tage machen den Scrape `503`.

Der vollständige Vertrag steht in
`docs/SECURITY_ASSESSMENT_EVIDENCE_RUNBOOK.md`. Der Verifier führt keine Scans oder
Pentests aus. Der gemeinsame letzte Dateipreflight steht in
`docs/RELEASE_EVIDENCE_READINESS_RUNBOOK.md`.

Der vollständige Runner-, Signatur-, Pin-, Assertion- und Archivierungsvertrag steht in `docs/RUNTIME_DEPLOYMENT_EVIDENCE_RUNBOOK.md`. Der Verifier besitzt keine Kubeconfig, führt keinen Rollout aus und gibt Production-Apply nicht frei.

## Fehler und Recovery

Persistiert werden nur `PROVIDER_UNAVAILABLE`, `PROVIDER_REJECTED`, `INVALID_BINDING`, `BOOTSTRAP_UNVERIFIED` oder `PROVISIONING_TIMEOUT`. Ein Zyklus besitzt genau fünf bestätigte Versuche. Prozessabbruch gibt den Claim frei und zählt nicht als Providerfehler; ein abgelaufener fünfter Claim wird fail-closed quarantiniert. Nach einem terminalen Fehler dürfen Owner oder Administratoren höchstens drei neue Zyklen über dieselbe API anfordern. Es gibt keinen manuellen „succeeded“- oder Retargeting-Pfad.

Vor einem Recovery müssen Broker-/Provider-Ursache, Idempotenzzustand und mögliche bereits angelegte Infrastruktur geprüft werden. Derselbe Job muss beim Broker immer dasselbe Ergebnis referenzieren. Ein bereits gebundenes Environment ist unveränderlich; ein Zertifikatwechsel oder geplanter Rebuild benötigt einen ausdrücklich entworfenen späteren Lifecycle-Workflow und darf nicht durch direkte Tabellenmutation erfolgen.

## Noch offene Production-Gates

- Live-Provider-Onboarding, Tenant-/Projekt-ACLs und Egress-Policy
- Real-PostgreSQL-Interleavings für Claim, Timeout, Crash nach Provider-Erfolg und atomare Bindung
- Vault-Policy, Agent-Sink-, Password- und Signing-Key-Rotation
- Kontrollierter Zertifikat-Rollover und Bootstrap-Attestierung gegen echte Zielcluster
- Echter verschlüsselter Control-Plane-Backup, isolierter Restore, Daten-/Auditvergleich und archivierte signierte v0.26-Evidenz
- Reales Prometheus-/OTel-Scraping, Alarmrouting/Eskalation, Deployment-/Pod-Readiness und archivierte signierte v0.29-Live-Evidenz
- Archivierter v0.31-Real-Service-Lauf mit Provider/Vault/Brokern/Pager, allen 15 Szenarien und unabhängig signierter Evidence
- Archiviertes unabhängiges v0.32-Security-Assessment mit allen 14 Kontrollen, SBOM/Scan-/Pentest-Berichten, null Critical/High und signierter Evidence

Bis diese Gates grün und archiviert sind, ist Production-Apply nicht freigegeben.
