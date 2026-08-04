# QKERN 1.4.0 Alpha 3 — Object Storage Concurrency

Datum: 4. August 2026

## Ergebnis

Dieser Release härtet die atomaren Storage-Übergänge gegen parallele Requests.
Quota kann nicht überbucht werden, Completion-Replays committen genau ein Object,
und Delete/Lifecycle geben Usage nur einmal frei. Ein neu geschlossener
Expiry-/Scanner-Randfall verhindert verwaiste Provider-Objects.

## Enthalten

- Serialisierte Quota-Reservation unter dem Bucket-Row-Lock
- Idempotente parallele Completion-Replays mit demselben gebundenen Object und
  genau einem `reserved → used`-Übergang
- Cleanup, wenn ein Upload während Provider-Verifikation oder Malware-Scan abläuft:
  der gefencte Commit scheitert und das nicht referenzierte Provider-Object wird
  best-effort gelöscht; eine noch pendente Reservation wird storniert
- Monotones Object-Delete-Accounting für manuelles Delete gegen Lifecycle
- Drei neue ausführbare Memory-Races für Completion, Expiry-/Scan-Orphan-Cleanup
  und Delete/Lifecycle
- Vier neue optionale PostgreSQL-17-Races für Quota-Overbooking, Completion-
  Idempotenz, Expiry-Cleanup und einmalige Usage-Freigabe
- Erweiteter statischer PostgreSQL-Zertifizierungsvertrag; der portlose Dockerlauf
  führt nun 19 optionale Real-DB-Tests aus
- Aktualisierte Architektur, Security, QA, Handbuch, Stufenplan, STATUS und
  chatunabhängiger Claude-Handoff

## Sicherheitsgrenzen

Provider-Delete bleibt idempotent vorausgesetzt. Der Cleanup greift nur nach einem
expliziten Repository-Conflict; ein erfolgreicher paralleler Completion-Replay
kehrt über den Existing-Object-Pfad zurück und löscht nichts. PostgreSQL verwendet
Upload→Bucket beziehungsweise Object→Bucket als feste Sperrordnung. Datenbank-
Constraints erzwingen weiterhin `used + reserved <= quota`.

## Verifikation

- Strict TypeScript: grün
- Vitest: 590 bestanden, 21 optionale Real-Service-Tests übersprungen
- Next.js Production Build: grün
- Production Dependency Audit: 0 bekannte Schwachstellen
- PostgreSQL-17-Concurrency-Dockerlauf: Matrix implementiert, in dieser
  Arbeitsumgebung nicht ausgeführt, da kein Docker-Programm vorhanden ist
- MinIO-/ClamAV-Docker-Zertifizierung: ebenfalls nicht ausgeführt, da Docker fehlt

## Bewusst offen

- Tatsächliche grüne und archivierte Läufe beider Storage-Docker-Harnesses
- Multipart-/Resumable-Uploads mit Part-Fencing und Abort-Cleanup
- Production-S3-/TLS-/Credential-Rotation und ClamAV-Signaturupdate-/Ausfallmatrix
- CDN und optionale Media-Transformationen
- Storage-Backup/Restore, Lasttest, Browser-/Accessibility-Smokes und unabhängiger
  Security-Test
- Die offenen Project-Auth-Live-Gates aus 1.3, Realtime, Functions, SDK/CLI,
  Billing und Managed Swiss Operations

Der Release ist ein Alpha-Quellstand und keine Managed-Production-Freigabe. Der
nächste Agent beginnt mit `docs/CLAUDE_HANDOFF.md`; historische Release Notes
bleiben unverändert.
