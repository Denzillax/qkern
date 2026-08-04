# QKERN 0.3 – Persistenter Control-Plane-Pfad

Version 0.3 verdrahtet die bereits angelegte PostgreSQL-Architektur mit den laufenden Auth-, Membership-, Console- und MCP-Flows. Der Memory-Modus bleibt für die lokale Demonstration und schnelle Tests verfügbar; Production akzeptiert ausschließlich den PostgreSQL-Modus.

## Geliefert

- Einheitliche Laufzeitwahl über `QKERN_RUNTIME_MODE=memory|postgres`; widersprüchliche Einzeladapter werden abgewiesen.
- Persistente Nutzer, Argon2id-Anmeldedaten und nur als SHA-256-Hash gespeicherte Session-Tokens; Registrierung von Nutzer und erster Session ist atomar.
- Persistente Membership-Ermittlung und konkurrenzsichere Erstellung genau eines persönlichen Workspaces mit erstem Projekt und Development-Environment.
- Console-, Change-Set-/Approval-Routen und MCP-Projekt-/Log-/Migration-Preview über eine gemeinsame asynchrone Control-Plane-Servicegrenze.
- Getrennte Login-Rollen und Verbindungs-URLs: `qkern_auth_app` erhält nur Auth-/Session- und Membership-Discovery-Rechte, `qkern_app` nur RLS-gebundene Runtime-Rechte. Die Anwendung lehnt Superuser, `BYPASSRLS` und überlappende Rollen ab.
- Erzwungene Row-Level Security, zusammengesetzte Tenant-FKs und unveränderliche Change-Set-Artefakte auf Datenbankebene.
- AES-256-GCM-verschlüsselte SQL-Statements. Change-Set-ID und Statement-Hash sind als Additional Authenticated Data gebunden; vor einer Approval-Entscheidung wird der Klartext erneut gehasht.
- Approval-Aktionshash mit Actor, Risiko, Ablauf und erforderlichem Scope, `FOR UPDATE`-Sperren sowie genau einer endgültigen Entscheidung.
- Öffentliche Change-Set-Antworten und Diffs maskieren Statements beziehungsweise sensible Werte.
- OpenAPI 3.1 dokumentiert Registrierung, Login, Logout und Session einschließlich Credential-Schemas und Fehlerstatus.
- Optionale Integrationstests gegen reale PostgreSQL-Rollen prüfen Auth-/Runtime-Trennung, RLS-Isolation zwischen zwei Tenants und Membership-Discovery.

## Betrieb

Für PostgreSQL sind mindestens folgende Secrets erforderlich:

```bash
QKERN_RUNTIME_MODE=postgres
QKERN_RUNTIME_DATABASE_URL=postgresql://qkern_app:...@db/qkern_control
QKERN_AUTH_DATABASE_URL=postgresql://qkern_auth_app:...@db/qkern_control
QKERN_STATEMENT_ENCRYPTION_KEY=<32 bytes as hex or base64>
DATABASE_SSL=require
```

`DATABASE_URL` ist nur für Migrationen vorgesehen und darf nicht an den Web- oder MCP-Prozess weitergereicht werden. Production verlangt TLS mit Zertifikatsprüfung. Schlüsselrotation braucht vorab eine Strategie zur Neuverschlüsselung bestehender Change Sets.

## Verifikation

Die normale Suite prüft beide Adapterverträge, Runtime-Auswahl, Auth, RLS-/Migrationsinvarianten, Approval-Integrität, SQL-Grenzen, MCP und OpenAPI. Echte PostgreSQL-Integrationstests sind opt-in und benötigen getrennte Owner-, Runtime- und Auth-URLs:

```bash
QKERN_TEST_OWNER_DATABASE_URL=... \
QKERN_TEST_RUNTIME_DATABASE_URL=... \
QKERN_TEST_AUTH_DATABASE_URL=... \
npm test -- tests/postgres.integration.test.ts
```

Ohne diese drei Variablen wird die reale Datenbank-Suite übersprungen; ein grüner Unit-Testlauf allein ist daher kein Nachweis eines produktiven Deployments.

## Bewusst offen

- Migration Preview endet weiterhin vor dem tatsächlichen Apply; Apply, Rollback und idempotente Worker fehlen.
- Nutzer plus erste Session sind innerhalb der Auth-Datenbank atomar; die anschließende persönliche Workspace-Provisionierung über die getrennte Runtime-Grenze benötigt für Production noch eine explizite Saga/Outbox und Recovery-Telemetrie.
- Das aktuelle öffentliche Projekt-DTO bildet genau eine Umgebung ab. Der Katalog schützt Change Sets bereits gegen nicht vorhandene Umgebungen, aber eine vollständige Multi-Environment-Console benötigt ein eigenes Environment-DTO statt einer einzelnen Projekt-Eigenschaft.
- Schema-Introspection, Read-only-Query, Logs und Produktmodule sind noch nicht vollständig mit realen Projekt-Datenbanken verbunden.
- Redis ist im lokalen Stack vorhanden, aber Auth-Rate-Limiting ist noch prozesslokal.
- S3-Storage, Backup/Restore, Realtime und Function Runtime sind Produktflächen, keine produktiven Services.
- MCP bleibt lokal begrenzt: STDIO vertraut der Prozessgrenze, HTTP nutzt ein statisches Bearer-Token und startet in Production absichtlich nicht. OAuth/OIDC, Scopes, Rotation und Revocation bleiben Release-Gates für Remote MCP.
- Die lokale Docker-Initialisierung führt Migrationen nur bei einem leeren PostgreSQL-Volume aus; ein separater Upgrade-Migrationsrunner fehlt.
- High Availability, Observability, Restore-Drills, Penetrationstests und bestätigte Schweizer Datenresidenz sind nicht geliefert.
