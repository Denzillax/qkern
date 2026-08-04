# Zertifizierungs-Sprint 1.8 — Design

> Datum: 4. August 2026 · Ausgangsstand: `1.8.0-alpha.1` · Baseline-Commit: `6eea244`

## Problem

QKERN dokumentiert seit Stufe 1.3 durchgängig denselben Blocker: „Docker, Podman,
`postgres` und `psql` waren in dieser Arbeitsumgebung nicht verfügbar." Alle
dauerhaften Adapter für Project Auth, Storage, Project Queues und Usage Metering
sind deshalb zwar codiert und statisch geprüft, aber **nie gegen einen echten
Dienst ausgeführt** worden. 30 optionale Real-Service-Tests stehen auf
`skipped`.

Dieser Blocker ist nicht mehr gültig: In der aktuellen Arbeitsumgebung läuft
Docker 29.5.3 (linux/overlayfs). Damit sind `npm run test:postgres:docker` und
`npm run test:storage:docker` ab sofort ausführbar.

Daraus folgen drei Befunde, die dieser Sprint adressiert:

1. **Der Fortschrittswert misst Fläche statt Tiefe.** Seit Stufe 1.2 wurde keine
   Stufe geschlossen, aber fünf neue eröffnet (1.3–1.6, 1.8 stehen alle auf „in
   Arbeit als Alpha, Austrittskriterium nicht erfüllt"). Die genannten 78 %
   zählen implementierten Code, nicht verifiziertes Verhalten, und besitzen keine
   Messvorschrift.
2. **Die Evidenzkette hat kein Substrat.** Das Projekt besaß kein
   Git-Repository. `.github/` enthielt genau eine Workflow-Datei, die nie
   ausgeführt wurde. Austrittskriterien, die „archivierte Läufe" verlangen,
   konnten strukturell nicht erfüllt werden.
3. **Die Dokumentation driftet bereits.** `docs/QA.md` nennt als „aktuellen
   automatisierten Stand" 609 Tests bei 21 übersprungenen, `STATUS.md` nennt 678
   bei 30. Testzahlen stehen handgepflegt an neun Stellen.

## Ziel

Den dokumentierten Stand von *codiert* auf *verifiziert* heben, das Ergebnis
dauerhaft belegbar machen und die Stufen schließen, deren Austrittskriterien
danach real erfüllt sind.

## Nicht-Ziele

Ausdrücklich **nicht** Teil dieses Sprints:

- Usage-Emitter in Produktmodulen (der im Handoff geplante 1.8-Alpha-2-Slice)
- Realtime PostgreSQL-CDC, horizontaler Fan-out
- RPC-/Function-Endpunkte, Embedded Resource Joins, pgvector
- neue Multi-Instance-/Crash-/Soak-/Last-Harnesses
- Windows-/macOS-Läufe der DX-Matrix
- ein Push zu einem entfernten Repository
- Preise, Tarife, Rechnungen

## Ansatz

Git-Baseline vor jeder Codeänderung, danach ein reiner Messlauf, danach
priorisierte Fix-Wellen. Die Baseline zuerst, weil sonst jeder spätere Fix eine
Behauptung statt eines Diffs wäre.

Verworfene Alternativen:

- *Sequenziell nach Stack* (erst PostgreSQL komplett grün, dann Storage): Das
  Gesamtbild der Fehlschläge entsteht zu spät, um sinnvoll zu priorisieren.
- *Sofort grün ziehen*: Der Umfang ist unbekannt, solange kein einziger Lauf
  existiert. Ein echter RLS- oder Concurrency-Fehler kann tief in `lib/server/`
  reichen.

## Phasen

### Phase 0 — Baseline sichern

`git init` mit `main`, `.gitattributes` mit `* text=auto eol=lf`,
`core.autocrlf=false`. Initial-Commit des unveränderten Stands.

Die Zeilenenden-Regel ist nicht kosmetisch: `docker-compose.certification.yml`
mountet `db/docker/999-runtime-login.sh` direkt in den PostgreSQL-Container.
Eine CRLF-Konvertierung beim Checkout würde den Init-Lauf brechen und exakt die
Zertifizierung sabotieren, um die es hier geht.

### Phase 1 — Diagnose-Lauf

Referenzlauf lokal (`npm ci`, `npm run typecheck`, `npm test`, `npm run build`)
zur Bestätigung der dokumentierten 678 bestandenen und 30 übersprungenen Tests.

Dann beide Zertifizierungsstacks:

- `npm run test:postgres:docker` — portloser PostgreSQL 17 auf tmpfs mit
  getrennten Runtime-/Auth-/Worker-/Provisioner-/Project-API-Logins, führt die 28
  Real-DB-Tests aus `test:postgres` aus.
- `npm run test:storage:docker` — portloser MinIO- plus ClamAV-Stack, führt
  Clean- und EICAR-Pfad gegen echte Dienste aus.

Rohausgaben ungefiltert nach `docs/evidence/2026-08-04/`.

Jeder Fehlschlag wird in genau eine Klasse eingeordnet:

| Klasse | Bedeutung | Konsequenz |
| --- | --- | --- |
| Harness-Defekt | Compose, Healthcheck, Image, Umgebung | Fix im Stack, kein Produktrisiko |
| Falsche Test-Annahme | Test erwartet Verhalten, das nie zugesagt war | Test korrigieren, Vertrag prüfen |
| Echter Produktfehler | Zusage aus Doku/Vertrag wird verletzt | Fix in `lib/server/`, Doku im selben Change |

### Phase 2 — Fix-Wellen

Abarbeitung in der Reihenfolge Harness → Test-Annahme → Produktfehler. Jede
Welle ist ein eigener Commit mit anschließendem Wiederholungslauf des betroffenen
Stacks. Produktfehler ziehen laut `AGENTS.md` das Update der betroffenen
Dokumentation im selben Change nach.

### Phase 3 — Evidenzablage

`docs/evidence/<datum>/` je Lauf mit Manifest: Commit-Hash, Image-Digests,
Exit-Code, Testzahlen, vollständiges Log.

Bewusst **ohne** Ed25519-Signaturgate. Das Signaturverfahren aus
`PRODUCTION_APPLY_AUTHORIZATION_RUNBOOK.md` bindet externe Autoritäten; es hier
lokal selbst zu erzeugen wäre eine Signatur auf die eigene Aussage und damit
Zeremonie ohne Beweiswert.

Dazu `.github/workflows/certification.yml`, die beide Stacks auf Linux fährt.
Sie ist lauffähig, sobald ein Remote existiert.

### Phase 4 — Dokumentation auf die Wahrheit ziehen

- `STATUS.md`: Releasezustand-Tabelle mit realen Ergebnissen statt „lokal nicht
  ausgeführt, da Docker fehlt".
- `docs/QA.md`: Korrektur des veralteten Stands von 609/21; Testzahlen künftig
  aus einem Script statt handgepflegt.
- `docs/STUFENPLAN.md`: Stufen schließen, soweit die Austrittskriterien real
  erfüllt sind. Was nicht erfüllt ist, wird präzise benannt statt gerundet.
- `docs/CLAUDE_HANDOFF.md`: neuer nächster bounded Slice.
- `docs/CERTIFICATION_1.8_ALPHA1.md`: Evidenzbericht.

Die Paketversion bleibt bei `1.8.0-alpha.1`. Dieser Sprint implementiert kein
Feature; eine `RELEASE_1.8_ALPHA2.md` zu erfinden würde die Chronik verwässern.
Der Evidenzbericht ist die passende Dokumentform.

### Phase 5 — Fortschrittsmessung reparieren

Der Wert „78 %" wird durch eine Zwei-Achsen-Tabelle je Modul ersetzt:

- **implementiert**: ausführbare vertikale Funktion vorhanden, lokal getestet
- **zertifiziert**: gegen echte Dienste ausgeführt, Lauf archiviert

Mit dieser Vorschrift wird „Supabase-Reife" erstmals messbar statt behauptet.

## Risiken

- Bind-Mount `.:/workspace/qkern:ro` plus separates `node_modules`-Volume kann
  unter Windows/WSL2 abweichend auflösen.
- `tmpfs` verhält sich unter Docker Desktop anders als nativ.
- Der Storage-Stack deklariert ClamAV nur als `service_started`, nicht
  `service_healthy`. Beim ersten Lauf lädt `freshclam` die Signaturdatenbank; der
  Test kann starten, bevor der Scanner antwortet. Das ist ein wahrscheinlicher
  Harness-Defekt der Klasse 1.
- Beide Stacks führen intern `npm ci` aus und brauchen Netzzugang.

## Fertigstellungskriterien

1. Beide Stacks liefern zweimal hintereinander reproduzierbar dasselbe Ergebnis.
2. Vollständige Rohlogs liegen unter `docs/evidence/` mit Manifest.
3. Jede Aussage in `STATUS.md`, `docs/QA.md` und `docs/STUFENPLAN.md` ist durch
   ein abgelegtes Log gedeckt. Keine Aussage ohne Beleg.
4. `npm run typecheck`, `npm test` und `npm run build` sind weiterhin grün.
5. Der verbleibende offene Rest ist benannt, nicht weggerundet.
