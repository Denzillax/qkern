# Release 1.7 Alpha 1 — TypeScript SDK & Typed Clients

Release: `1.7.0-alpha.1` · Datum: 4. August 2026

## Ergebnis

QKERN enthält erstmals ein frameworkfreies, generisches TypeScript-SDK. Ein
anwendungsspezifischer `Database`-Typ macht Table CRUD compile-time-typisiert;
Queues, Schema, Project Auth und Storage verwenden denselben gehärteten Transport.

## Enthalten

- `sdk/typescript` mit Paketidentität `@qkern/sdk`;
- typed Select, Filter, Order, Cursor, Insert, Update und Delete;
- Clients für Schema, Queue-Enqueue/Status/DLQ, Project Auth und Storage-Listen;
- Header-only Project-Key/App-Token, exakte Base-Origin und localhost-only HTTP;
- Redirect-Deny, Timeout, Response-Limit und bounded `QkernError`;
- keine automatischen Write-Retries und keine reflektierten Serverfehler;
- sechs Transport-/Typing-/Negativtests und SDK-Handbuch.

## Verifikation und Grenzen

Strict TypeScript, **656 lokale Tests**, Next.js-Build und Audit sind grün; **26**
optionale Real-Service-Tests bleiben übersprungen. Noch offen sind generierter
Database-Typ, reproduzierbares ESM-/DTS-Paket, npm-Publishing, Bundler-/Browser-
Matrix, Realtime und Streaming Uploads. Nächster Slice: `1.7.0-alpha.2` CLI und
lokale Workflows für init/status/schema pull/migration plan/seed.
