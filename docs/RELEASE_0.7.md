# QKERN 0.7 – Persistent Reconciliation Quarantine

Version 0.7 schließt die Control-Plane-Lücke zwischen einem unbekannten Ziel-Datenbankergebnis und dessen späterer Klärung. Ein solcher Job bleibt nicht mehr nur implizit bis zum Lease-Ablauf `completion_deferred`, sondern wechselt per gefenctem Update in einen persistenten Reconciliation-only-Zustand. Dieser Zustand kann niemals SQL ausführen und endet nach begrenzten Ledger-Prüfungen fail-closed in einer auditierten Review-Quarantäne.

## Neu in 0.7

- Control-Plane-Migration `0008_migration_reconciliation_quarantine.sql` ergänzt `reconciliation_required`, einen vom SQL-Retry getrennten Reconciliation-Zähler, dessen feste Grenze von drei Versuchen und den terminalen Jobzustand `review_required`.
- Unbekannte Executor-Ergebnisse, fehlgeschlagene Completion-Updates nach bekanntem Zielerfolg, Lease-Heartbeat-Unsicherheit und unbestätigte Reclaim-Fences versuchen jetzt zuerst einen gefencten Übergang in diese Spur.
- Reconciliation-only-Claims rufen ausschließlich `executor.reconcile()` auf. Ein fehlender Ledger-Eintrag führt zu Backoff und einem weiteren Reconciliation-Claim, niemals zu `executor.execute()` oder zur Entschlüsselung des SQL-Artefakts.
- Ein passender Ledger-Eintrag schließt Job und Change Set idempotent als applied.
- Nach dem dritten erfolglosen Reconciliation-Claim wird der Job `review_required`; das Change Set bleibt approved und wird nicht fälschlich als failed markiert.
- Vor jedem neuen Claim werden auf der Versuchsschranke abgelaufene Reconciliation-Leases per `FOR UPDATE SKIP LOCKED` ebenfalls in `review_required` verschoben. Damit kann eine Worker-Crash-Schleife die persistierte Grenze nicht umgehen.
- Reconciliation-Planung und Review-Quarantäne erzeugen redigierte Audit-Einträge. Das Status-DTO zeigt Zustand, begrenzte Zähler und feste Fehlercodes, aber keine Rohfehler oder Projekt-Datenbankdetails.
- Die Web-/API-Runtime bleibt read-only für diese Zustände; nur die dedizierte `qkern_worker`-Rolle erhält UPDATE-Rechte auf die neuen Reconciliation-Spalten.

## Zustands- und Sicherheitssemantik

Der normale SQL-Attempt-Zähler und der Reconciliation-Zähler erfüllen unterschiedliche Aufgaben. Ein nach sicher bestätigtem Rollback geplanter SQL-Retry erhöht weiterhin nur `attempt_count`. Ein unklarer Zielausgang setzt dagegen `reconciliation_required = true`; spätere Claims lassen `attempt_count` unverändert und erhöhen ausschließlich `reconciliation_attempt_count`.

Der Worker prüft bei einem Reconciliation-only-Claim Tenant, Projekt, Umgebung, opaque Zielreferenz, Lease, Fence-Epoche, Change-Set-/Approval-Bindung und Statement-Hash-Form. Er prüft bewusst nicht erneut die Approval-TTL als Voraussetzung für die Ledger-Lektüre: Auch eine inzwischen abgelaufene Approval darf einen bereits erfolgten Commit bestätigen. Sie darf aber kein fehlendes Statement nachträglich ausführen, weil der Reconciliation-only-Zweig vor jedem Artefakt-Decrypt und vor `execute()` endet.

`completion_deferred` bleibt als letzter Fallback erhalten, wenn gerade das gefencte Control-Plane-Update nicht persistiert werden kann. Nach Lease-Ablauf gilt dann weiterhin die v0.6-Reclaim-Semantik: Der neue Worker liest unter der Zielserialisierung zuerst das Ledger; nur ein normaler, vollständig erneut verifizierter Claim kann bei nachweislich fehlendem Commit in den gefencten Ausführungspfad zurückkehren.

## Datenbankupgrade

`db/migrations/0008_migration_reconciliation_quarantine.sql` gehört nach `0007_migration_claim_sequence.sql` in die Control-Plane-Migrationskette. PostgreSQL erlaubt die Nutzung eines neu hinzugefügten Enum-Werts erst nach Commit der Enum-Änderung. Die Datei führt `ALTER TYPE ... ADD VALUE IF NOT EXISTS 'review_required'` deshalb absichtlich vor der nachfolgenden expliziten Schema-Transaktion aus. Ein Upgrade-Runner darf die gesamte Datei nicht zusätzlich in eine äußere Transaktion einschließen.

Die Migration installiert datenbankseitige Bounds und Shape-Constraints. Bestehende Jobs erhalten ausschließlich sichere Defaults (`reconciliation_required = false`, Zähler `0`, Grenze `3`). Projekt-Datenbanken benötigen für 0.7 keine weitere Data-Plane-Migration; Ledger und Target-Fence aus 0.6 bleiben unverändert.

## Verifikation und offene Gates

Der automatisierte Stand umfasst 219 erfolgreiche Tests in 39 Testdateien; 3 Real-PostgreSQL-Tests in einer weiteren Datei sind ohne explizite Test-URLs übersprungen. Strict Typecheck und Next.js Production Build sind erfolgreich. Worker-, Repository-, Queue-, Audit-, Rollen- und SQL-Vertragsprüfungen decken den neuen Zustandsautomaten einschließlich Crash-Exhaustion und des No-execute-Invariants ab.

Die Migration wurde in dieser Umgebung mangels `psql`, Docker und bereitgestellter Testdatenbank nicht gegen einen echten PostgreSQL-Server ausgeführt. Vor Production bleiben daher Real-PostgreSQL-Worker-E2E, Target-Lock-/Crash-Interleavings, ein autorisierter manueller Auflösungsworkflow für `review_required`, Vault-backed Katalog und Provisioner, produktiver Broker-Sink/Publisher-Host sowie widerrufbare Ausführungsberechtigung oder kontrollierte Query-Cancellation verpflichtende Gates. Auch Storage/Backups, verteiltes Rate Limiting, Remote-MCP-OAuth, HA- und Schweizer Datenresidenz-Nachweise bleiben offen.
