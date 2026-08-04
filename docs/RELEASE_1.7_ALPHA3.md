# QKERN 1.7 Alpha 3 — Packages & Cross-Platform Contracts

Release: `1.7.0-alpha.3` · Datum: 4. August 2026

## Geliefert

- reproduzierbarer `@qkern/sdk`-Build als ESM, Source Maps und Typdeklarationen;
- reproduzierbarer `@qkern/cli`-Build als direkt startbares Node.js-ESM;
- enge Paketmanifeste und echte `npm pack --dry-run`-Prüfung mit privatem Temp-Cache;
- ausführbarer Fresh-Project-Smoke für secretfreie Config, Typen, Migration/Seed,
  SDK-Import und gebaute CLI;
- Drei-OS-GitHub-Matrix für Ubuntu, Windows und macOS;
- Project-Key-Authentisierung der Schema-Route, damit SDK und CLI `schema pull`
  ohne Browser-Session tatsächlich verwenden können;
- portabler CLI-SQL-Policy-Kern samt Paritätstest gegen die Serverpolicy;
- Handbuch, Status, QA, Stufenplan und Agentenübergabe fortgeschrieben.

## Sicherheitsgrenzen

SDK und CLI bleiben privat und werden nicht publiziert. Konfigurationsdateien
enthalten keine Credentials; der Project Key kommt nur aus dem Prozess und wird
nur in `X-QKERN-Key` übertragen. Migration Plan und Seed Check führen weiterhin
kein SQL aus. Paketbuilds dürfen keine Repository-Alias-Imports enthalten.

## Prüfung

Strict TypeScript, **664 lokale Tests**, SDK-/CLI-Build, Fresh-Project-Smoke,
Tarball-Verträge, Next.js-Production-Build und Production-Dependency-Audit sind
grün; **26** optionale Real-Service-Tests wurden mangels Docker/PostgreSQL/MinIO/
ClamAV nicht ausgeführt. Der lokale DX-Nachweis lief auf Linux x64/Node 24.

## Ehrlich offen

Windows und macOS sind als CI-Matrix vorbereitet, in dieser Umgebung aber nicht
ausgeführt. Ebenfalls offen: bestehende Projekt-Upgrades, Registry-Publishing,
Signatur/Provenance, Browser-/Bundler-Matrix, lokale Service-Orchestrierung und
alle bereits dokumentierten Production-/Provider-Gates. Damit ist der 1.7-Alpha-
Checkpoint erreicht, nicht die stabile oder kommerzielle Go-live-Freigabe.
