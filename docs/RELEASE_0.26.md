# Release 0.26 — Signed Backup/Restore Evidence Gate

## Ergebnis

QKERN 0.26 ergänzt ein fail-closed Gate für extern erzeugte Control-Plane-Backup-/Restore-Drill-Evidenz. QKERN führt selbst keinen Backup- oder Restore-Vorgang aus und besitzt keinen Signierschlüssel. Ein separater Drill-Runner signiert einen strikten, secretfreien Nachweis mit Ed25519; QKERN liest nur Evidenz und Public Key aus integritätsgeschützten No-follow-Dateien und pinnt zusätzlich den SHA-256 des rohen Public Keys.

Die Verifikation prüft Signatur, Key-ID, feste Production-/Control-Plane-Bindung, streng geordnete Zeitpunkte, exakt abgeleitete RPO-/RTO-Werte, Frische, Verschlüsselungs-/Checksum-/Schema-/Rowcount-/Audit-Assertions und identische Source-/Restore-Datenmanifeste. Zusätzliche Felder, Inline-Autorität, manipulierte Signaturen, falsche Pins, alte Evidenz und Policy-Verstösse scheitern geschlossen.

## Betriebsgrenzen

- `npm run verify:backup-restore` liefert maschinenlesbare Readiness mit Exit-Code `0` oder einen festen cause-freien Fehler mit Exit-Code `1`
- Production-Dateien müssen regulär, symlinkfrei und nicht group-/world-writable sein
- Evidenz- und Key-Datei müssen getrennt sein und dürfen keine Vault-, Broker-, Webhook- oder Monitoring-Authority-Pfade wiederverwenden
- der Ed25519-Private-Key besitzt keinen QKERN-Konfigurationsslot
- feste Policy: Evidenz maximal sieben Tage, Snapshot maximal 24 Stunden alt, Recovery-Point-Lag maximal 24 Stunden, Restore maximal vier Stunden, Clock-Skew maximal fünf Minuten
- die Ausgabe enthält keine Artefakt-/Manifest-Hashes, Signaturen, Key-IDs, Pfade oder Credentials

## Monitoring

Mit `QKERN_BACKUP_RESTORE_EVIDENCE_ENABLED=true` verifiziert der bereits separat authentisierte OpenMetrics-Endpunkt die Evidenz bei jedem Scrape. Erfolg ergänzt ausschließlich feste Readiness-, RPO-/RTO- und Timestamp-Metriken. Evidenz-ID, Digests, Key-ID, Organisation, Projekt und Provider werden nicht exportiert. Fehlerhafte oder veraltete aktivierte Evidenz macht den Scrape cause-frei `503`.

## Validierung

- Strict TypeScript Typecheck
- 448 erfolgreiche automatisierte Tests in 71 Testdateien
- 9 bewusst übersprungene Real-PostgreSQL-Tests ohne bereitgestellten Dienst
- erfolgreicher Next.js-Production-Build
- Production-Dependency-Audit: 0 Critical, 0 High, 2 Moderate in der MCP-SDK→`@hono/node-server`-Transitivkette

## Keine Production-Freigabe

0.26 kann echte, signierte Restore-Drill-Evidenz prüfen, erzeugt sie aber nicht. Ein echter Provider-/Storage-Backup, ein isolierter Restore, privates Detailprotokoll, Retention-/Encryption-/Access-Control-Nachweis, reales Prometheus-/OTel-Scraping, Alert-Routing und wiederholte archivierte Drills bleiben Live-Gates. Production-Apply bleibt bis zu deren Nachweis und den übrigen Gates aus `docs/QA.md` deaktiviert.
