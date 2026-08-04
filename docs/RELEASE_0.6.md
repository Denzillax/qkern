# QKERN 0.6 – Durable Migration Fencing

Version 0.6 schließt die wichtigste lokal implementierbare Reclaim-Lücke der Apply-Runtime: Jeder Control-Plane-Claim besitzt jetzt eine monotone Generation, der Worker hält sein Lease während längerer Zieloperationen per Heartbeat aktiv und der Executor bindet die aktuelle Generation an ein dauerhaftes Target-Fence in der Projekt-Datenbank. Production-Apply bleibt dennoch gesperrt, bis Vault-Katalog, Provisioner, Broker-Sink und echte PostgreSQL-Worker-E2E nachgewiesen sind.

## Neu in 0.6

- Control-Plane-Migration `0007_migration_claim_sequence.sql` ergänzt die monotone `claim_sequence`, getrennt von begrenzten Retry-Attempts.
- Jeder Zielaufruf bindet Job-ID, Fence-Epoche, Lease-Token und Statement-Hash.
- `db/project/0002_qkern_migration_fence.sql` provisioniert ein persistentes, separat besessenes Fence mit minimalen SELECT-/INSERT-/spaltenbezogenen UPDATE-Rechten für den Migrator.
- Der PostgreSQL-Executor prüft Struktur, Owner, ACLs und Constraints des Fence fail-closed, persistiert die aktuelle Epoche vor der Statement-Transaktion und bestätigt sie darin erneut.
- Eine niedrigere Fence-Epoche kann eine höhere nicht überschreiben; abweichendes Lease-Token oder Statement-Hash wird abgewiesen.
- Der Worker erneuert sein Control-Plane-Lease während Ausführung und zurückeroberter Ledger-Reconciliation per Heartbeat.
- Ein zurückeroberter Rollback-/Not-started-Versuch darf nur nach dauerhaft bestätigtem aktuellem Target-Fence erneut laufen; unbekannte Fence-Ergebnisse bleiben deferred.
- Der Outbox-Publisher ist unabhängig vom Migration Worker konfigurierbar und verlangt nur sein eigenes Enable-Flag, PostgreSQL-Modus, Organisation und Publisher-ID.

## Sicherheitssemantik

Lease-Erneuerung reduziert unbeabsichtigte parallele Reclaims, ersetzt das Target-Fence aber nicht. Die `claim_sequence` wird bei jedem Claim erhöht und bildet eine monotone Generation. Der Executor schreibt diese Generation in einer eigenen Transaktion dauerhaft auf das Ziel und prüft innerhalb der nachfolgenden Statement-Transaktion, dass sie weiterhin aktiv ist. Damit kann ein bereits überholter Worker keine ältere Epoche wieder einsetzen.

Dieses Fence ist nicht präemptiv. Eine bereits gestartete Zieltransaktion darf trotz eines späteren Control-Plane-Reclaims fertig werden. Der neue Worker blockiert am Target-Advisory-Lock und reconciliiert nach dessen Freigabe zuerst das Ledger. 0.6 bietet daher keine vollständige Stale-Worker-Cancellation; eine widerrufbare Ausführungsberechtigung beziehungsweise kontrollierte Query-Cancellation und der zugehörige Real-PostgreSQL-Interleavingstest bleiben Production-Gates.

Nach einem Reclaim bleibt Ledger-Reconciliation der erste Schritt. Ein vorhandener passender Ledger-Eintrag wird idempotent in die Control Plane übernommen. Fehlt er, ist ein weiterer Versuch nur zulässig, wenn neben den bisherigen Approval-, Artefakt-, Lease- und Rollback-Prüfungen auch das aktuelle Fence bestätigt ist. Commit- oder Fence-Ergebnisse mit unbekanntem Ausgang werden nicht blind wiederholt.

## Datenbankupgrade

`db/migrations/0007_migration_claim_sequence.sql` gehört in die Control-Plane-Migrationskette. `db/project/0002_qkern_migration_fence.sql` gehört dagegen gemeinsam mit `0001_qkern_migration_ledger.sql` in den vertrauenswürdigen Provisionierungsablauf jeder Projekt-Datenbank. Beide Data-Plane-Verträge setzen die getrennten Rollen `qkern_ledger_owner` und `qkern_project_migrator` voraus. Bestehende Projekt-Datenbanken müssen vor Nutzung der 0.6-Apply-Runtime kontrolliert um das Fence erweitert werden.

## Verifikation und offene Gates

Der automatisierte Stand umfasst 205 erfolgreiche Tests in 38 Testdateien; 3 Real-PostgreSQL-Tests in einer weiteren Datei sind ohne explizite Test-URLs übersprungen. Strict Typecheck und Next.js Production Build sind erfolgreich. Die neuen Claim-, Heartbeat- und Fence-Invarianten sind unitär und über SQL-Vertragstests abgesichert, aber noch nicht in echten PostgreSQL-Worker-, Crash- und Reclaim-Races zertifiziert.

Nicht enthalten bleiben ein Vault-backed Katalog mit Rotation und Server-/Cluster-Fingerprint-Bindung, echte Projekt-Datenbank-Provisionierung, ein produktiver Broker-Sink/Publisher-Host, Dead-Letter-/Operator-Automation, revocable execution authority/Query-Cancellation und Real-PostgreSQL-Worker-E2E einschließlich Target-Lock-Interleaving. Auch Storage/Backups, verteiltes Rate Limiting, Remote-MCP-OAuth, HA- und Schweizer Datenresidenz-Nachweise bleiben Release-Gates.
