# Release 1.7 Alpha 2 — CLI & Local Workflow

Release: `1.7.0-alpha.2` · Datum: 4. August 2026

## Ergebnis

QKERN ergänzt eine dependency-minimale CLI für secretfreie Initialisierung,
Reachability, `schema pull`, `migration plan` und `seed check`. Kein Befehl führt
Migrationen oder Seeds automatisch aus.

## Enthalten

- `@qkern/cli` und Root-Script `npm run qkern -- ...`;
- exklusive, nicht überschreibende Projektinitialisierung;
- strikt schema-validierte `qkern.config.json` ohne Secret-Felder;
- deterministischer TypeScript-Database-Generator ohne sensitive Spalten;
- Single-Statement-Migration-Plan mit Risk und SHA-256 statt SQL-Ausgabe;
- INSERT-only Seed-Check mit Größen-, Count- und Credential-Canary-Grenzen;
- Projektpfad-Traversal-Sperre und Environment-only Project Key;
- fünf CLI-Core-Tests und Handbuch.

## Verifikation und Grenzen

Strict TypeScript, **661 lokale Tests**, Build und Audit sind grün; **26**
optionale Real-Service-Tests bleiben übersprungen. Offen sind echte CLI-Binaries,
Shell-Matrix, Schema-Diff/Push, Migration Submit, Seed Apply, lokaler
Container-Orchestrator und Cross-Platform-Fresh-Install-E2E.
