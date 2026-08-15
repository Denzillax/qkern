# Release 1.82.0 — Rechnungen erreichen den Browser

Zwei offene Punkte aus `1.77`: Die Invoices-Route sprach in keinem Fall HTTP,
und die Console kannte keine Rechnungen. Beides ist geschlossen — mit einem
Zuschnitt, den die Lektion aus `1.75` bestimmt.

## Die Route spricht

`GET …/usage/invoices` antwortet jetzt belegt durch dieselbe authentifizierte
Grenze wie die Usage-Fläche: 200 mit `private, no-store` und dem
eingefrorenen Dokument samt Nummer und Fälligkeit; doppelte, unbekannte oder
missgeformte `limit`-Parameter enden mit 400 **vor** dem Dienstzugriff. Der
Dienst dahinter ist seit `1.77`/`1.81` gegen echtes PostgreSQL zertifiziert —
Gegenstand hier ist die HTTP-Grenze, die bislang niemand gerufen hatte.

## Die Console liest

Die Monitoring-Ansicht trägt eine Rechnungs-Karte: Nummer, Periode,
Fälligkeit, Posten-Zahl, Betrag. Der `1.75`-Fehler — ein Editor, der nie eine
Route rief — bestimmt die Architektur: Der Ladeweg ist als **reine Funktion**
extrahiert (`components/console/invoices.ts`) und vertraglich geprüft (exakte
URL, `no-store`, eigene Zustände für deaktiviertes Metering, Fehler und
missgeformte Antworten); die React-Karte hängt ihn nur ein.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Die URL des Ladewegs wird auf die Usage-Route verbogen | **1 von 1069 fällt** — genau der Ladeweg-Vertrag: die Console spräche mit der falschen Fläche |

## Belege

Dieser Slice ändert keinen Server-Code; es gibt bewusst keinen neuen
Stack-Lauf. Die lokale Suite ist die tragende Evidenz:

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1069/1069, exit 0 | `docs/evidence/2026-08-16/console-invoices-run1.manifest.json` |
| Vitest lokal 1069/1069, exit 0 | `docs/evidence/2026-08-16/console-invoices-run2.manifest.json` |
| Mutation 1068/1069, exit 1 | `docs/evidence/2026-08-16/console-invoices-mutation.manifest.json` |

PostgreSQL bleibt auf dem Stand von `1.81`: 155 von 155, 44 Migrationen.

## Ehrlich offen

- **Die React-Karte selbst rendert ungeprüft** — geprüft ist der Ladeweg als
  Funktion, nicht das Einhängen in React; das Repo hat keine
  Browser-Testumgebung, und dieser Slice führt bewusst keine ein.
- **Keine Detailansicht der Posten** — die Karte zeigt die Summe je Rechnung.
- **Weiterhin keine Zahlungsanbindung.**
