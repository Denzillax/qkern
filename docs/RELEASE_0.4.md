# QKERN 0.4 – Apply Queue und Worker-Sicherheitsdomäne

Version 0.4 ergänzt den genehmigten Change-Set-Fluss um eine separate, idempotente Apply-Queue. Die HTTP- und MCP-Anfragen führen weiterhin kein SQL aus. PostgreSQL persistiert ausschließlich tenantgebundene Aufträge und referenzbasierte Outbox-Ereignisse; eine Worker-Domäne definiert und prüft den Sicherheitsvertrag unmittelbar vor einer künftigen Projekt-Datenbankausführung.

## Geliefert

- `POST /api/v1/changesets/{changeSetId}/apply` als explizite Aktion nach der Approval. Der Handler verlangt eine authentifizierte `apply`-Capability, Trusted Origin, einen leeren JSON-Body und eine tenantgebundene Change-Set-ID.
- Idempotente Antworten: Der erste erfolgreiche Auftrag liefert `202 queued`, Wiederholungen liefern `200 already_queued` beziehungsweise `already_applied`. Der Request selbst führt niemals SQL aus.
- PostgreSQL-Tabellen `migration_jobs` und `migration_outbox` mit `organization_id`, erzwungener RLS, zusammengesetzten Tenant-FKs und spaltenbezogenen Least-Privilege-Grants.
- Genau ein Job pro Organisation/Change Set und genau ein `migration.apply.requested`-Outbox-Ereignis pro Job. Ein Transaktions-Lock schließt die konkurrierende Enqueue-Sichtbarkeitslücke; Job, Outbox und Audit entstehen in derselben Tenant-Transaktion.
- Referenzbasierte Outbox: Sie speichert nur Job- und Tenant-Referenzen, niemals SQL-Ciphertext oder Projekt-Datenbank-Credentials.
- Geleaste Job- und Outbox-Claims mit `FOR UPDATE SKIP LOCKED`, Worker-/Publisher-ID, zufälligem Lease-Token, Ablaufzeit, kontrollierter Wiederübernahme und gefencten Abschluss-/Fehler-/Publish-Updates.
- Worker-Domäne, die unmittelbar vor dem Executor-Aufruf opaque Datenbankreferenz, Tenant, Projekt, Umgebung, Change-Set- und Approval-Status, Ablauf, Action Hash, Attempt-Grenzen, Lease, entschlüsselten Statement-Hash und genau ein zulässiges SQL-Statement erneut prüft.
- `PostgresProjectDatabaseExecutor` mit injiziertem Resolver-Port, exakter kataloggebundener Least-Privilege-Rolle, lokalen Statement-/Lock-/Idle-Timeouts, Change-Set-Advisory-Lock und atomarem `qkern_internal.migration_ledger` in derselben Ziel-Datenbanktransaktion.
- Vorprovisionierungsvertrag für ein von einer separaten Non-Login-Rolle besessenes Ledger; der Projekt-Migrationslogin erhält dort nur `SELECT` und `INSERT`, nie Schema-Create, DDL, Update, Delete oder Trigger.
- Retry-Policy mit exponentiellem Backoff ausschließlich für ausdrücklich retrybare Fehler mit sicherem `rolled_back`-Ergebnis. Unbekannte Ausführungsergebnisse bleiben `completion_deferred` und werden erst nach Lease-Reclaim read-only gegen das Ziel-Ledger reconciled.
- Schutz für die Commit-Grenze: Ist der Projekt-Datenbank-Commit bekannt oder sein Ergebnis unklar, aber das Control-Plane-Abschlussupdate nicht verfügbar, meldet der Worker `completion_deferred` und markiert den Job nicht fälschlich als fehlgeschlagen. Jeder reclaimed Job konsultiert zuerst ausschließlich das Ledger; eine abgelaufene Approval kann so einen vorhandenen Commit bestätigen, aber niemals neue SQL-Ausführung auslösen.
- Lokales MCP-Tool `qkern_migration_apply_queue` mit `readOnlyHint: false`, `destructiveHint: true` und `idempotentHint: true`. Der MCP-Client muss vor dem Aufruf eine ausdrückliche Nutzerbestätigung einholen; das Ergebnis enthält `executed: false`.

## Ablauf und Sicherheitsgrenze

1. Ein Change Set wird als unveränderliches, verschlüsseltes Artefakt erstellt.
2. Eine separate Approval bindet den Action Hash an Change Set, Statement-Hash, Actor, Projekt, Umgebung, unveränderliche Datenbank-Instanzreferenz, Risiko, Scope und Ablauf. Alte, targetlose Approval-Hashes werden nicht akzeptiert.
3. Ein berechtigter Nutzer oder lokal bestätigter MCP-Aufruf fordert Apply ausdrücklich an.
4. Die Enqueue-Transaktion prüft das genehmigte Artefakt und eine nicht-pendente Projektumgebung und legt Job, Outbox-Referenz und Audit idempotent an.
5. Ein künftiger Worker claimt den Job per Lease und verifiziert das gesamte Artefakt erneut.
6. Erst danach kann der implementierte PostgreSQL-Executor über einen vertrauenswürdigen Resolver eine lokale Ziel-Datenbanktransaktion ausführen und Change-Set-ID plus Statement-Hash atomar in einem vorprovisionierten Migration-Ledger festhalten.

Alle Komponenten dieses Ablaufs sind als Code vorhanden und gegen ihre Ports getestet. Die End-to-End-Runtime-Kette ist jedoch nicht aktiviert: Projekt-Datenbank-Provisionierung, ein vertrauenswürdiger Resolver und ein gestarteter Worker-Dienst fehlen.

## Fail-closed: kein realer SQL-Apply

QKERN 0.4 enthält einen `PostgresProjectDatabaseExecutor`. Er prüft die Eingabe erneut, löst nur eine opaque Instanzreferenz zusammen mit dem exakten erwarteten Login über den injizierten `ProjectDatabaseConnectionResolver` auf, weist privilegierte Rollenattribute und gefährliche Mitgliedschaften ab, prüft die Least-Privilege-Grenze des vorprovisionierten Ledgers und führt Statement plus Change-Set-/SHA-256-Ledger-Schreibvorgang in einer Transaktion aus. Derselbe Change-Set-Schlüssel und Hash liefert `already_applied`; ein abweichender Hash einen Konflikt. Ein unklarer Commit wird ohne Retry als unbekannt klassifiziert und die Verbindung verworfen.

Es gibt aber keine vertrauenswürdige Resolver-Implementierung, keine Credential-Vault-Auflösung und keine echte Projekt-Datenbank-Provisionierung. Kein Executor ist in die Runtime-Komposition verdrahtet; `DisabledProjectDatabaseExecutor` ist die vorgesehene sichere Port-Implementierung und verweigert jeden Aufruf mit `PROJECT_DATABASE_EXECUTION_DISABLED`. `InMemoryProjectDatabaseExecutor` modelliert ausschließlich in Tests zusätzliche Worker-Szenarien.

Der Ledger-Provisionierungsvertrag liegt unter `db/project/0001_qkern_migration_ledger.sql`. Ein vertrauenswürdiger Provisioner muss zuvor `qkern_ledger_owner` als unprivilegierte Non-Login-Rolle und `qkern_project_migrator` als unprivilegierten Login ohne weitere Mitgliedschaften anlegen, das Skript einmal pro Projekt-Datenbank ausführen und den Resolver anschließend exakt an Datenbankname, Migration-Login und Ledger-Owner binden. Das ist dokumentierter Vertrag, noch keine ausgelieferte Provisioner-Runtime.

Zudem wird kein Worker- oder Outbox-Publisher-Prozess als ausgelieferter Runtime-Dienst gestartet. Frisch angelegte Projektumgebungen tragen eine pendente Instanzreferenz und können bis zu einer echten Provisionierung nicht zur PostgreSQL-Apply-Queue angemeldet werden. Deshalb führt der ausgelieferte Runtime-Prozess trotz vorhandener Queue-, Lease- und Worker-Domäne kein reales SQL gegen eine Projekt-Datenbank aus.

## Offene Production-Gates

- Datenbank-pro-Projektumgebung-Provisionierung, vertrauenswürdige opaque Credential-Auflösung und Rotation über einen Vault sowie Aktivierung des vorhandenen PostgreSQL-Executors erst nach diesen Gates.
- Überwachte Worker-/Outbox-Publisher-Runtime mit Lease-Erneuerung, Shutdown-Fencing, Dead-Letter-/Operator-Recovery und Observability.
- Real-PostgreSQL-/Worker-E2E für Cross-Tenant-Isolation, Enqueue-Races, Lease-Verlust, Crash vor/nach Commit, sicheren Rollback-Retry, unbekanntes Ergebnis und idempotente Wiederaufnahme.
- Produktiver Remote-MCP-Resource-Server mit OAuth/OIDC; der lokale statische HTTP-Bearer-Transport bleibt in Production deaktiviert.
- Externer Security Review, Lasttests, HA, Restore-Drills und bestätigte Schweizer Datenresidenz.

Ein grüner Unit-/Typecheck-Lauf belegt die Domainverträge, ersetzt aber weder Real-PostgreSQL-/Worker-E2E noch den Nachweis einer tatsächlichen Projekt-Datenbankausführung.
