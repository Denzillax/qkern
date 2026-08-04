# Release 0.19 — Generation-Bound Delivery Recovery

## Ergebnis

QKERN 0.19 bewahrt die worker-verifizierte Incident-Auflösung aus 0.18 und schließt zusätzlich einen ABA-Replay im Dead-Letter-Recovery-Pfad. Ein Delivery-Recovery-Command ist jetzt nicht mehr nur an den festen Fehlercode, sondern auch an die konkrete `retry_cycle_count`-Generation gebunden. Tritt derselbe Fehlercode nach einem zwischenzeitlichen Recovery-Zyklus erneut auf, kann ein altes Command die neue Generation nicht öffnen.

## Sicherheitsgrenze

- `POST /api/v1/migrations/incidents/{incidentId}/delivery/retry` verlangt `reasonCode`, `expectedFailureCode` und `expectedRetryCycle`.
- Der Datenbank-Trigger sperrt weiterhin zuerst das pendente Command und danach die Outbox; damit bleibt die in 0.18 vereinheitlichte Command-first-Reihenfolge erhalten.
- Trigger und Publisher-Worker vergleichen Fehlercode und Retry-Generation unmittelbar vor der Zustandsänderung.
- Idempotenz gilt nur für denselben Grund, Fehlercode und dieselbe Generation.
- Neue und pendente Commands müssen Code und Generation explizit enthalten; SQL-`CHECK`-NULL-Bypässe sind ausgeschlossen.
- Der Pfad publiziert nicht im API-Request, löst keinen Incident und verändert weder Migration-Job, Change Set, Target-Ledger noch SQL.

## Upgrade

Bestehende 0.18-Installationen führen `0018_migration_incident_delivery_recovery_generation.sql` nach Migration 0017 in der normalen nummerierten Reihenfolge aus. Migration 0018 läuft in einer normalen Transaktion. Sie übernimmt ausschließlich pendente Commands, deren Fehlercode und Retry-Generation noch exakt dem aktuellen dead-lettered Outbox-Snapshot entsprechen; veraltete pendente Commands werden beim Upgrade auf `rejected` gesetzt.

Die Migration ersetzt den Delivery-Recovery-Trigger unter Beibehaltung der Command-first-Sperrreihenfolge und gewährt `qkern_runtime` nur das spaltenbezogene INSERT auf `expected_retry_cycle`. Direkte Outbox-Mutationsrechte bleiben ausgeschlossen.

## Verifikation

- TypeScript Strict Typecheck: erfolgreich
- Vitest: 340 bestanden, 3 optionale Real-PostgreSQL-Tests übersprungen
- Gezielte Resolution-/Recovery-/Worker-/API-/OpenAPI-Regression: 141 bestanden
- Next.js Production Build: erfolgreich
- Dependency-Audit: keine Critical-/High-Findings; zwei moderate PostCSS-Findings ohne verfügbaren Fix in der fest gebundenen Next.js-Auflösung

## Offene Production-Gates

- Real-PostgreSQL-Upgrade-, RLS- und Interleavingtests für Migration 0018 und parallele Recovery-Commands
- Crash-/Reclaim-Races für den kombinierten Resolution- und Delivery-Recovery-Pfad
- Live-Zertifizierung des Webhook-Providers, DNS-/Egress-Policy, Vault-Rotation und externer Delivery-SLO-Alarme

Bis diese Gates bestanden sind, bleibt Production-Apply nicht freigegeben.
