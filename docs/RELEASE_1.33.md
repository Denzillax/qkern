# Release 1.33.0 — Realtime bündelt

> Datum: 6. August 2026 · Vorgänger: `1.32.0`

## Wofür dieses Release steht

Die letzte der sechs Metriken meldet. Und sie meldet anders als die fünf davor.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| PostgreSQL-17-Zertifizierung | **101 von 101 bestanden**, exit 0 |
| Reproduzierbarkeit | zweimal grün **vor** dem Release-Commit |
| Neue Fälle | 2 gegen echtes PostgreSQL, 10 lokal |
| Mutationsprobe | Bündelung aus, `realtime_messages` erzwingbar → genau 3 Fälle fallen um |
| Vitest lokal | 973 bestanden, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

## Ein Emitter, der sammelt

Eine Control-Plane-Transaktion je Broadcast wäre auf dem Realtime-Pfad ein
absehbarer Fehler — der Soak-Lauf misst dort p95 in Millisekunden.
`BufferedUsageEmitter` sammelt deshalb je Scope und Metrik und schreibt
gebündelt: beim Erreichen einer Menge, in einem Intervall und beim
Herunterfahren.

Der Preis ist doppelt, und beide Hälften gehören ausgesprochen.

**Er kann nicht gaten.** Man kann keine Nachricht ablehnen, die bereits in einem
offenen Stapel gezählt ist. `admit` lässt immer durch.

**Ein Absturz verliert den Puffer.** Das ist die gewählte Richtung, nicht ein
übersehener Fall: lieber zu wenig zählen als zu viel. Wer zu viel zählt, stellt
in Rechnung, was nie stattgefunden hat; wer zu wenig zählt, verschenkt. Nur eine
dieser beiden Fehlerarten kann man einem Kunden zumuten.

Ein Fall im Zertifizierungslauf zeigt genau das: Ein weggeworfener Emitter —
also ein abgestürzter Prozess — verliert seine fünf ungeschriebenen Nachrichten,
während eine geschriebene zählt.

## Ein Stapel, der es nicht geschafft hat

Hier zahlt sich eine Entscheidung aus Release 1.29 aus: `UsageAdmission` trägt
seit damals einen **Grund**, nicht nur ein Ja/Nein.

- `unavailable` heisst: Das Ledger hat nichts verbucht. Der Stapel wird
  **unverändert** und mit demselben Schlüssel erneut gesendet; kommt er doch
  zweimal an, zählt er trotzdem einmal.
- `quota_exceeded` oder `conflict` heissen: Das Ledger hat entschieden. Ein
  erneuter Versuch bekäme dieselbe Antwort, und der Stapel wird verworfen.

Ein wiederholter Stapel darf dabei **nicht** mit neuen Nachrichten
zusammengelegt werden: Derselbe Schlüssel mit anderer Menge ist ein
Idempotenzkonflikt und machte den Stapel dauerhaft unschreibbar. Auch dafür gibt
es einen Fall.

## Ein zweiter Grund für dieselbe Liste

`realtime_messages` kommt zu `database_row_reads` und `storage_egress_bytes` in
die Liste der Metriken, für die `enforce` nicht setzbar ist — aber aus einem
anderen Grund. Bei den beiden anderen fehlt die **Menge**, hier fehlt der
**Zeitpunkt**.

Die Liste hiess `POST_HOC_USAGE_METRICS` und heisst jetzt
`UNENFORCEABLE_USAGE_METRICS`. Der alte Name beschrieb einen der beiden Gründe
und hätte den zweiten für immer verdeckt.

## Die Lücke aus 1.32, anders geschlossen als angekündigt

Release 1.32 hat offen ausgewiesen: zertifiziert ist der Helfer, nicht seine
Platzierung. Ein Verhaltenstest dafür bräuchte eine echte HTTP-Anfrage mit
Sitzung oder Projektschlüssel.

Statt dessen liest jetzt ein Vertragstest die drei Modulquellen und verlangt,
dass **jeder** exportierte Kontext-Resolver `admitApiRequest` ruft. Das prüft
den Quelltext, nicht das Verhalten — es fängt aber genau den Fehlerfall, der
gemeint war: Jemand fügt einen Resolver hinzu und denkt nicht daran.

Der Test zählt bewusst nicht Aufrufe gegen Resolver: `generatedDataContext`
misst in zwei sich ausschliessenden Zweigen. Der erste Entwurf tat es doch und
war deshalb sofort rot — ein nützlicher Fehlschlag.

## Ehrlich offen

- **Der Realtime-Pfad ist mit eingeschaltetem Emitter nicht neu vermessen.** Der
  Soak-Lauf aus Release 1.15 lief ohne ihn. Die Bündelung ist genau deshalb da,
  aber belegt ist die Latenz damit nicht
- Ein Lauf, der den Pufferverlust unter echtem Prozessabbruch zeigt, fehlt —
  belegt ist er über einen weggeworfenen Emitter
- `control_plane`, `project_auth` und `mcp` dürfen `api_requests` schreiben, tun
  es aber nicht
- Kein Abgleich mit Providerwerten, keine Last-Läufe des Messpfads
- **Weder Preise noch Tarife noch Rechnungen.** Alle sechs Metriken zu messen
  macht daraus kein Billing-System, und keine dieser Zahlen ist ein
  Abrechnungsbeleg
- Kein Deployment-Weg für Function-Images
- SDK und CLI sind nur auf Linux belegt
