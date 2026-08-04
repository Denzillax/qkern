# Release 0.20 — Disposable PostgreSQL Certification Harness

## Ergebnis

QKERN 0.20 bewahrt die worker-verifizierte Incident-Auflösung aus 0.18 und die generation-gebundene ABA-Abwehr aus 0.19. Neu ist ein reproduzierbarer echter PostgreSQL-17-Testpfad für den kombinierten Vertrag. Er erzeugt eine isolierte Datenbank, migriert sie zuerst bis 0017, legt aktuelle und veraltete Recovery-Commands an und führt danach 0018 als separates Upgrade aus.

## Zertifizierungsumfang

Der neue Real-DB-Block umfasst sechs Tests:

- Current-/Stale-Backfill beim Upgrade 0017→0018
- explizite Abwehr von PostgreSQL-`CHECK`-NULL-Bypässen
- ABA-Replay mit identischem Fehlercode in einer späteren Retry-Generation
- erfolgreicher Retry nur für exakt passenden Fehlercode und Generation
- echtes Command-first-Blocking zwischen Worker- und Runtime-Transaktion
- Worker-only-Incident-Resolution erst nach angewendetem Job-/Change-Set-Zustand

Zusammen mit den drei bestehenden Rollen-/RLS-Tests führt `npm run test:postgres:docker` neun echte PostgreSQL-Tests aus.

## Isolationsgrenze

- eigener Compose-Projektname und PostgreSQL-17-Container
- kein veröffentlichter Host-Port
- Datenverzeichnis ausschließlich auf tmpfs
- Source-Mount read-only; Node-Abhängigkeiten in eigenem Wegwerf-Volume
- getrennte Owner-, Runtime-, Auth- und Worker-Logins
- zufällig erzeugter, streng validierter Datenbankname
- Create/Drop nur mit `QKERN_TEST_ALLOW_DATABASE_CREATE_DROP=true`
- Container- und Volume-Cleanup unabhängig vom Testergebnis

## Ausführung

```bash
npm run test:postgres:docker
```

Alternativ kann `npm run test:postgres` mit vollständig gesetzten dedizierten Test-URLs ausgeführt werden. Das erweiterte Testfile bleibt ohne Admin-/Worker-URL und ausdrückliches Create-/Drop-Gate übersprungen.

## Verifikation dieses Artefakts

- TypeScript Strict Typecheck: erfolgreich
- Lokale Vitest-Suite: 345 bestanden
- Optionale Real-PostgreSQL-Tests: 9 übersprungen, weil in der Build-Umgebung weder Docker noch PostgreSQL/`psql` vorhanden waren
- Statische Harness-Verifikation: 5 bestanden
- Next.js Production Build: erfolgreich
- Dependency-Audit: keine Critical-/High-Findings; zwei moderate PostCSS-Findings ohne verfügbaren Fix in der fest gebundenen Next.js-Auflösung

Der Harness ist damit implementiert und lokal vollständig validiert, aber dieses Artefakt behauptet ausdrücklich noch keinen grünen Real-PostgreSQL-Lauf. Für die Production-Freigabe muss die Ausgabe aus einer Docker-/PostgreSQL-fähigen CI- oder Lab-Umgebung erfolgreich ausgeführt und als Release-Evidenz archiviert werden.

## Upgrade

0.20 fügt keine neue Datenbankmigration nach 0018 hinzu. Bestehende 0.19-Installationen übernehmen Anwendungscode, Tests und Zertifizierungsstack; die produktive Control-Plane bleibt auf Schema 0018.

## Offene Production-Gates

- grüner und archivierter Lauf aller neun Real-DB-Tests
- Target-Database-Crash-, Reclaim-, Heartbeat- und Fence-Interleavings
- Live-Zertifizierung des Webhook-Providers, DNS-/Egress-Policy, Vault-Rotation und externer Delivery-SLO-Alarme
- produktiver Vault-Katalog, Projekt-Datenbank-Provisionierung und Apply-Broker-Sink

Bis diese Gates bestanden sind, bleibt Production-Apply nicht freigegeben.
