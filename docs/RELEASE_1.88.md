# Release 1.88.0 — Zeitreihen, bevor sie sich bewegen

Der letzte Punkt der Queue-Zeile der Paritätsleiter: ein Metrics-Export.
`GET …/queues/metrics` liefert Prometheus-Textformat über **alle** Queues
eines Scopes — für jeden Scraper, der QKERN-Queues beobachten will.

## Der Export

Zwei Metriken: `qkern_queue_messages` je Queue und Zustand (available,
scheduled, in_flight, completed, dead_lettered) und
`qkern_queue_oldest_available_age_seconds`. **Jede Queue erscheint mit allen
fünf Zuständen — auch eine leere, mit 0 statt Abwesenheit.** Ein Scraper
braucht die Zeitreihe, bevor sie sich bewegt; genau diese Vollständigkeit ist
das Mutationsziel des Releases.

Die Zähler entstehen aus derselben Wahrheit wie `status` — inklusive
Lease-Erholung und Aufräumen je Queue. Die Formatierung ist eine reine
Funktion mit maskierten Label-Werten; die Route hält dieselbe Admin-Grenze
wie `status`, antwortet mit Text (`text/plain; version=0.0.4`) und
`no-store`, und weist Query-Parameter ab.

## Zertifiziert

Gegen echtes PostgreSQL (jetzt 158 Fälle): zwei Queues, eine mit einer
wartenden und einer geleasten Nachricht, eine leer — der Export nennt beide,
die leere mit allen Zählern auf null; ein Worker darf nicht exportieren.
Lokal: das Textformat Zeile für Zeile, inklusive Maskierung von Backslash,
Anführungszeichen und Zeilenumbruch in Label-Werten.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Leere Queues fallen aus dem Export | Stack **157 von 158** — genau der Export-Fall; lokal bleibt die Suite grün, weil die Zusage im Dienst lebt und nur der Real-DB-Fall sie prüft |

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 158/158, exit 0 | `docs/evidence/2026-09-24/queue-metrics-run1.manifest.json` |
| PostgreSQL 158/158, exit 0 | `docs/evidence/2026-09-24/queue-metrics-run2.manifest.json` |
| Mutation 157/158 | `docs/evidence/2026-09-24/queue-metrics-mutation.manifest.json` |
| Vitest lokal 1083/1083, exit 0 | `docs/evidence/2026-09-24/queue-metrics-local-run1.manifest.json` |

44 Migrationen.

## Ehrlich offen

- **Kein Tracing** — die Queue-Zeile der Leiter nennt es als einzigen Rest.
- **Nur Queue-Zustände** — die redigierten Prozesszähler des Wirts stehen
  nicht im Export.
- **Eine Queue namens `metrics`** verliert den Pfad `/queues/metrics` an den
  Export; ihre Unterrouten (`/metrics/status`, …) bleiben erreichbar.
