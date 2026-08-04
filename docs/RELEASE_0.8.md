# Release 0.8 — Safe Operator Reconciliation Commands

## Ergebnis

QKERN 0.8 ergänzt für Migration-Jobs im Zustand `review_required` einen autorisierten und begrenzten Recovery-Pfad. Der Pfad startet ausschließlich weitere Ledger-Reconciliation und kann weder SQL erneut ausführen noch einen Job manuell als `applied` oder `failed` markieren.

## Enthalten

- `GET /api/v1/migrations/reviews` liefert Ownern und Administratoren eine redigierte Liste offener Review-Jobs.
- `POST /api/v1/migrations/{jobId}/review/reconciliation` legt eine idempotente Recovery-Anweisung mit festem Reason-Code an und antwortet ausdrücklich mit `executed: false`.
- Deployer und Support besitzen die neue `migration_review`-Capability nicht.
- Migration `0009_migration_review_commands.sql` ergänzt eine tenantgebundene, referenzbasierte Command-Tabelle sowie getrennte, datenbankseitig begrenzte Review-Zähler.
- Die Web-Runtime darf Commands einfügen, besitzt aber weiterhin kein UPDATE-Recht auf `migration_jobs`.
- Nur der dedizierte Worker sperrt, validiert und konsumiert Commands und kann einen zulässigen Job erneut in die Reconciliation-only-Queue stellen.
- Höchstens ein pendentes Command pro Job und höchstens drei zusätzliche Review-Zyklen verhindern unbegrenzte Wiederholungen.
- Request-, Annahme- und Ablehnungsereignisse werden ohne SQL, Credentials oder freie Fehlermeldungen auditiert.
- Memory- und PostgreSQL-Runtime wählen dieselbe Servicegrenze; der persistente Recovery-Workflow ist PostgreSQL-gebunden.
- OpenAPI-Vertrag, Repository-, Route-, Rollen-, Worker-, Redaction- und Runtime-Auswahltests wurden ergänzt.

## Sicherheitsgrenze

Ein Operator-Command enthält ausschließlich Tenant-/Job-/Actor-Referenzen und einen der festen Reason-Codes `dependency_recovered`, `manual_recheck` oder `incident_recovery`. Es enthält kein Statement, keine Datenbankreferenz, keine Credentials und keinen Freitext. Auch nach einem Operator-Recheck bleibt ein fehlender Ledger-Eintrag ausschließlich ein fehlender Ledger-Eintrag; der Worker ruft in diesem Pfad niemals `execute()` auf.

## Verifikation

- TypeScript Strict Typecheck: erfolgreich
- Vitest: 238 bestanden, 3 optionale Real-PostgreSQL-Tests übersprungen
- Next.js Production Build: erfolgreich
- Dependency-Audit: keine High- oder Critical-Findings; zwei bekannte moderate PostCSS-Findings bleiben offen

Die übersprungenen Tests benötigen getrennte reale Owner-, Runtime- und Auth-PostgreSQL-URLs. Der grüne Standardlauf ist daher kein Nachweis für echte Worker-/Crash-/Fence-Races.

## Weiterhin offene Production-Gates

- Vault-backed Zielverbindungskatalog und echte Projekt-Datenbank-Provisionierung
- Real-PostgreSQL-Worker-E2E einschließlich Crash-, Reclaim-, Heartbeat- und Target-Fence-Interleavings
- Incident-Runbook und Eskalation für nach drei Review-Zyklen weiterhin ungeklärte Jobs
- Überwachte Worker-/Publisher-Hosts und produktiver Broker-Sink
- Stale-Worker-Cancellation, Restore-Drills, HA, OAuth/OIDC für Remote MCP und die weiteren Gates aus `docs/QA.md`
