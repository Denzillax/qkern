# QKERN 1.8 Alpha 1 — Usage Metering & Quotas

Release: `1.8.0-alpha.1` · Datum: 4. August 2026

## Ergebnis

QKERN besitzt erstmals eine ausführbare Product-Operations-Grundlage: sechs feste
Usage-Metriken, UTC-Monatscounter, idempotente append-only Entscheidungen und
atomare Quota-Modi `observe` und `enforce`. Die Console zeigt die echte read-only
Projektion statt Monitoring-Demodaten.

Dieser Checkpoint liefert belastbares Metering, aber noch keine Tarife, Preise,
Rechnungen oder kommerzielle Billing-Freigabe.

## Implementiert

- `UsageService` mit striktem Scope-, Rollen-, Metrik-/Quellen-, Mengen- und
  Zeitfenstervertrag;
- verifier-only Idempotenz: Rohschlüssel werden gehasht und niemals persistiert;
- stabile Retry-Entscheidungen, einschließlich bereits abgelehnter Hard-Limit-
  Events;
- parallele Counter-Sperre, sodass `enforce`-Limits nicht überbucht werden;
- `observe`-Modus mit weiterlaufendem Counter und sichtbarer Überschreitung;
- optimistisch versionierte interne Quota-Policies mit Audit-Ereignis;
- Memory-Port für Tests/Entwicklung und Production-verbotene Ephemeral-Grenze;
- PostgreSQL-Adapter in tenantgebundenen Transaktionen;
- Migration `0028_usage_metering.sql` mit zusammengesetzten Tenant-FKs, RLS,
  engen Grants, Append-only-/Monotonie-/Revisionstriggern;
- read-only `GET .../usage` für aktuellen oder 23 vorherige UTC-Monate;
- OpenAPI-Schema mit Dezimalstrings gegen Präzisionsverlust;
- echte Console-Fläche `Usage & Quotas`, ohne Browser-Mutation und ohne
  erfundene Billingwerte;
- vier optionale PostgreSQL-Zertifizierungsszenarien für Concurrent-Limit,
  Restart-Replay, dauerhafte Projektion und RLS-Isolation.

## Sicherheitsentscheidungen

- Browser-Sessions dürfen ausschließlich Projektionen lesen.
- Event-Ingestion und Policy-Mutation bleiben interne Ports; kein MCP- oder
  öffentlicher REST-Write wurde ergänzt.
- `meter` darf nur erlaubte Quelle/Metrik-Paare im eigenen Tenant schreiben.
- Counter, Policy und Entscheidung werden atomar verarbeitet.
- Event Keys, einzelne Ledger-Events, Payloads, Preise und Providerdaten werden
  nicht in der Console-Projektion ausgegeben.
- Production benötigt die dauerhafte PostgreSQL-Persistenz; Memory bleibt
  fail-closed verboten.

## Verifikation

- Strict TypeScript: grün
- Vitest: **678 bestanden**, **30 optionale Real-Service-Tests übersprungen**
- Next.js Production Build: grün
- SDK-/CLI-Build, Tarball-Verträge und Linux-Fresh-Project-Smoke: grün
- Production Dependency Audit: **0 bekannte Schwachstellen**
- neue Usage-Suite: Idempotenz, Hard-/Observe-Quota, Parallelrennen, Tenant-
  Grenze, Policy-Revision, Runtime, HTTP, OpenAPI und Migration

Docker, Podman, `postgres` und `psql` sind in der verwendeten Umgebung nicht
verfügbar. Die vier neuen echten PostgreSQL-Tests wurden deshalb nicht ausgeführt
und dürfen nicht als bestanden gelten.

## Upgrade

1. Source sichern und `npm ci` ausführen.
2. Migration `0028_usage_metering.sql` kontrolliert als Owner anwenden.
3. Die Runtime-Rolle und RLS-Verträge prüfen.
4. Usage Metering zunächst mit `QKERN_USAGE_METERING_ENABLED=false` deployen.
5. Vor Aktivierung einen vertrauenswürdigen Emitter-/Quota-Plan definieren.
6. Typecheck, Tests, Build und externe PostgreSQL-Zertifizierung ausführen.

## Bewusst offen

- automatische transaktionale Emitter aus Data, Auth, Storage, Realtime, Queues
  und Compute;
- Operator-API/Provisioning für Pläne sowie Usage-Reconciliation;
- echte Multi-Instance-, Crash-, Soak-, Retention- und Last-Evidenz;
- Tarife, Währungen, Credits, Rechnungen, Steuern und Payments;
- Usage-Export, Kostenalarme, Monitoring/Tracing und Provider-Abgleich;
- Teams/Rollen, PITR/Restore, Status Page und Support-Consent aus Stufe 1.8.

Details: [USAGE_METERING.md](USAGE_METERING.md).
