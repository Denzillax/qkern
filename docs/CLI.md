# QKERN CLI

Die CLI `@qkern/cli` läuft im Repository über `npm run qkern -- <command>`.
Nach `npm run build:cli` ist dieselbe CLI über `node cli/dist/main.js` ausführbar.

```powershell
npm run qkern -- init --url http://localhost:3000 --project <id> --environment development
$env:QKERN_PROJECT_KEY="<einmalig kopierter Key>"
npm run qkern -- status
npm run qkern -- schema pull
npm run qkern -- migration plan qkern/migrations/001_add_orders.sql
npm run qkern -- seed check
```

`qkern.config.json` enthält ausschließlich Base-Origin, Scope, Schema und relative
Dateipfade. Keys/Tokens sind dort verboten und werden nur aus der Prozessumgebung
gelesen. `init` verwendet exklusive Writes und überschreibt keine Dateien.

`schema pull` sendet den scope-gebundenen Project Key ausschließlich als
`X-QKERN-Key`, liest das live introspektierte Schema und erzeugt deterministisch
`Database`-Typen; sensitive Spalten werden ausgelassen. `migration plan` verwendet
denselben Single-Statement-SQL-Guard wie QKERN und gibt nur Risk, Environment und
SHA-256 aus; es führt nichts aus. `seed check` erlaubt höchstens 100 reine INSERT-
Statements, maximal 1 MB und keine Credential-Bezeichner; auch dieser Befehl führt
nichts aus. Alle Projektpfade müssen relativ bleiben und dürfen das Projekt nicht
verlassen.

`npm run verify:dx:full` baut SDK/CLI, prüft ihre Tarballs und führt die gebaute CLI
in einem frischen Projekt aus. Das Paket bleibt privat; Quell- und Dist-Artefakte
enthalten keine Repository-Alias-Imports.

Offen: signierter CLI-Login/Keyring, Migration Submit/Apply, kontrolliertes Seed-
Apply, Diff/Push, lokaler Container-Orchestrator, Shell-Completion, Registry-
Publishing und echte Windows/macOS/Linux-Binaries.
