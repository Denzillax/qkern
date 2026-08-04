# Release 0.18 — Worker-Verified Incident Resolution

## Ergebnis

QKERN 0.18 kann einen zuvor eskalierten Migration-Incident technisch auflösen, ohne einer Operator-Aussage zu vertrauen und ohne SQL erneut auszuführen. Owner und Administratoren dürfen ausschließlich einen festen Target-Ledger-Recheck anfordern. Nur ein Worker-bestätigter, exakter Ledger-Treffer für Change-Set-ID und Statement-Hash setzt Job, Change Set und Incident atomar auf den verifizierten Abschlusszustand.

## Enthalten

- Neuer Incident-Zustand `resolved` mit ausschließlich workergebundener Evidenz `target_ledger_match`, Actor und Zeitpunkt.
- `POST /api/v1/migrations/incidents/{incidentId}/resolution/verification` mit dem einzigen zulässigen Grund `target_ledger_recheck`.
- Owner-/Administrator-Capability; Support bleibt read-only, Deployer und andere Rollen sind ausgeschlossen.
- Referenzbasierte `migration_incident_resolution_commands` ohne SQL, Datenbankreferenz, Credentials, Rohdiagnose oder Freitext.
- Höchstens drei Resolution-Verifications pro Incident; exakte pendente Wiederholungen sind idempotent.
- Worker-Verbrauch öffnet ausschließlich `reconciliation_required`, setzt den separaten Reconciliation-Zähler zurück und erhöht den normalen Review-Zähler nicht.
- Der Reconciliation-Pfad ruft niemals `execute()` auf. Leere oder unklare Ledger-Evidenz führt zurück zu `review_required`.
- Atomarer Abschluss: Erst `already_applied` setzt Job und Change Set auf `applied`; danach erlaubt der Datenbank-Guard in derselben Transaktion `resolved`.
- Fail-closed-Mapping für inkonsistente oder unbekannte Resolution-Evidenz aus der Datenbank.
- Command-first-Sperrreihenfolge für Resolution und Delivery-Recovery als Schutz gegen Lock-Zyklen zwischen idempotentem API-Request und Worker-Verbrauch.
- Erweiterte OpenAPI-, Runbook-, Security-, Architektur- und Roadmap-Verträge.

## Sicherheitsvertrag

Die HTTP-Route persistiert nur das Command und antwortet mit `executed: false`. Sie liest weder Target-Ledger noch Projekt-Datenbank und besitzt keine Update-Rechte auf Job, Change Set oder technische Incident-Auflösung. Der Worker muss den bereits existierenden, tenantgebundenen Incident und dessen `review_required`-Job erneut prüfen. Der Datenbank-Trigger akzeptiert `resolved` ausschließlich von einer Session mit `qkern_worker`-Mitgliedschaft, wenn genau dieser Job bereits `applied` und nicht mehr reconciliation-pflichtig ist.

Ein frisch ausgeführter Apply mit Executor-Ergebnis `applied` ruft den Incident-Resolver ausdrücklich nicht auf. Nur `already_applied` aus dem SQL-freien Target-Ledger-Reconciliation-Pfad ist als Resolution-Evidenz zulässig. Audit-Einträge enthalten nur Incident-, Job- und Change-Set-Referenzen sowie feste Codes.

## Upgrade

Bestehende 0.17-Installationen führen `0017_migration_incident_verified_resolution.sql` nach Migration 0016 in der normalen nummerierten Reihenfolge aus. Die Migration ergänzt den Enum-Wert `resolved` vor ihrer nachfolgenden Schema-Transaktion. Sie darf deshalb – wie Migrationen 0008 und 0012 – nicht zusätzlich als vollständige Datei in eine äußere Transaktion eingeschlossen werden.

Die Migration ersetzt außerdem den v0.17-Delivery-Recovery-Trigger durch den semantisch identischen, Command-first sperrenden Vertrag. `qkern_runtime` erhält ausschließlich SELECT und spaltenbezogenes INSERT auf die neue Command-Tabelle. Nur `qkern_worker` darf Command-Status sowie die festen Incident-Felder `status` und `resolution_code` aktualisieren; Actor und Zeit werden vom Trigger gesetzt.

## Verifikation

- TypeScript Strict Typecheck: erfolgreich
- Vitest: 337 bestanden, 3 optionale Real-PostgreSQL-Tests übersprungen
- Next.js Production Build: erfolgreich, einschließlich des neuen Resolution-Endpunkts
- Dependency-Audit: keine High- oder Critical-Findings; zwei bekannte moderate PostCSS-Findings ohne verfügbaren Fix bleiben offen

## Weiterhin offene Production-Gates

- Real-PostgreSQL-Upgrade-, RLS-, Crash-, Reclaim- und Interleavingtests für Migration 0017 und parallele Resolution-Commands
- Eigenes, idempotentes externes `migration.incident.resolved`-Notification-Event für Pager-/Ticket-Synchronisierung
- Konkrete Vault-/KMS-Implementierung, Provider-Onboarding, DNS-/Egress-Policy und synthetische Zustellchecks
- Externe Delivery-SLO-Alarme und On-call-Eskalation
- Vault-backed Zielverbindungskatalog und echte Projekt-Datenbank-Provisionierung
- Produktiver Apply-Broker-Sink und vollständige Real-Service-E2E
