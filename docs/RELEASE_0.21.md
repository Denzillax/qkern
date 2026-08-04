# Release 0.21 — Rotierender Vault-Projektkatalog

## Ergebnis

QKERN 0.21 liefert den zuvor fehlenden Production-Resolver für Projekt-Datenbanken. Der Migration Worker kann HashiCorp-Vault-Database-Static-Credentials abrufen, ihre TTL vorzeitig erneuern und bei einem Passwortwechsel atomar auf eine neue PostgreSQL-Pool-Generation wechseln. Der erwartete stabile Vault-Benutzer entspricht weiterhin exakt der vom Executor verifizierten Least-Privilege-Rolle.

## Sicherheitsvertrag

- Exact-Match-Allowlist für opaque `managed:*`-Referenzen ohne URL-Fallback
- secretfreie Environment-Bindungen; weder Vault-Token noch PostgreSQL-Passwort sind Konfigurationsfelder
- Vault-Agent-Token-Sink wird bei jedem Refresh neu gelesen und muss in Production eine private reguläre Datei sein
- exakte HTTPS-Mount-URL, `redirect: error`, gemeinsames Token-/Transport-Timeout und maximal 32 KiB Antwort
- validierter Status, JSON-Content-Type, stabiler Benutzername, Passwortgrenze und TTL
- normale TLS-CA-/Hostnamenprüfung plus provisionierter SHA-256-Leaf-Zertifikatspin pro Projektziel
- cause-freie, redigierte Fehler ohne Endpoint, Token, Passwort, Provider-Body oder PostgreSQL-Verbindungsstring

## Rotations- und Nebenläufigkeitsvertrag

Gleichzeitige erste Verbindungen beziehungsweise fällige Refreshes teilen sich genau eine Token- und Vault-Auflösung. Liefert Vault dasselbe Passwort, wird nur die Refresh-Deadline verlängert. Bei einem neuen Passwort wird der neue Pool zuerst vollständig erzeugt und dann atomar aktiv. Bereits erworbene Clients halten die alte Generation bis `release`; erst danach wird ihr Pool geschlossen und die Credential-Kopie entfernt. Ist ein Refresh fällig und Vault nicht verfügbar, wird keine neue Verbindung über den alten Pool geöffnet.

## Ausführung

Der gemeinsame Host wählt anhand der Laufzeitgrenze:

- `npm run worker:migrations:local`: Development/E2E mit explizitem Raw-URL-Opt-in
- `npm run worker:migrations`: Production ausschließlich mit Vault-Bindungen und Token-File-Provider

SIGINT und SIGTERM stoppen neue Claims und schließen anschließend Control-Plane-Pools sowie aktuelle und auslaufende Projekt-Pool-Generationen.

## Verifikation dieses Artefakts

- 12 neue isolierte Vault-Katalogtests für Exact Match, Header/Endpoint, TLS-Pin, Rotation, TTL, Refresh-Koaleszierung, fail-closed Providerausfall, Timeout, Response-Limit, Redaction, Shutdown und Token-File-Rotation
- TypeScript Strict Typecheck: erfolgreich
- lokale Vitest-Suite: 357 bestanden; 9 optionale Real-PostgreSQL-Tests in 2 Dateien mangels Datenbankvoraussetzungen übersprungen
- Next.js Production Build: erfolgreich
- Dependency-Audit: keine Critical-/High-Findings; zwei moderate PostCSS-Findings ohne verfügbaren Fix in der fest gebundenen Next.js-Auflösung

## Upgrade

0.21 fügt keine Control-Plane-Datenbankmigration nach 0018 hinzu. Bestehende 0.20-Installationen übernehmen Anwendungscode und Deployment-Konfiguration. Production muss vor dem Worker-Start Vault-Mount, Static Roles, Policies, Agent-Sink, secretfreie Projektbindungen und Zertifikatpins provisionieren.

## Offene Production-Gates

- echter Projekt-Datenbank-Provisioner und kontrollierter Zertifikat-Rollover
- archivierter Live-Test von Vault-Policy, Agent-Token- und Static-Credential-Rotation
- Target-Database-Crash-, Reclaim-, Heartbeat- und Fence-Interleavings
- produktiver Apply-Broker-Sink und Provider-/Delivery-Live-Zertifizierung

Bis diese Gates bestanden sind, bleibt Production-Apply nicht freigegeben.
