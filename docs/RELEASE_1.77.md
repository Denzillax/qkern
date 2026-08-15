# Release 1.77.0 — Rechnungen bekommen Leser

Zwei offene Punkte aus `1.68` sind geschlossen — beides lokal voll belegbar,
und genau deshalb jetzt: **die Rechnungs-Lesefläche** und **der Wettlauf
zweier Rechnungsläufe**.

## Die Lesefläche

`GET …/usage/invoices` liefert die ausgestellten Rechnungen mit ihren Posten,
neueste Periode zuerst — hinter demselben Schalter und derselben Fehlergrenze
wie die Usage-Fläche. Geschrieben wird hier nichts: Rechnungen entstehen
ausschliesslich im Rechnungslauf-Prozess.

Der Rechnungslauf schreibt als **Worker**; gelesen wird als **Laufzeit** über
das Leserecht, das Migration 0040 dafür bereits erteilt hatte — die Grenze war
gezogen, bevor die Fläche existierte, statt umgekehrt.

## Der Wettlauf

Zwei Rechnungslauf-Prozesse starten gleichzeitig für dieselbe abgeschlossene
Periode. Beide laufen sauber durch, keiner meldet einen Fehler — und es
entsteht **genau eine** Rechnung mit genau ihren Posten. Die Idempotenz trägt
der benannte `ON CONFLICT`-Arbiter aus Migration 0040: Der Verlierer verliert
still und richtig.

## Zertifiziert

- Die Liste durch die Laufzeitrolle: eine Rechnung, zwei Posten,
  `total: "0.430000"` — und eine fremde Organisation sieht eine **leere**
  Liste, kein gefiltertes Etwas (RLS, nicht WHERE).
- Der Wettlauf: zwei ausgelieferte Prozesse, eine Rechnung, kein
  `run_failed`.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Der `ON CONFLICT`-Arbiter wird aus dem Rechnungs-INSERT entfernt | **149 von 151** — genau die zwei idempotenzgebundenen Fälle: der zweite Lauf und der Wettlauf |

Dass **beide** fallen, ist der Punkt: Wiederholung und Wettlauf sind dieselbe
Zusage, getragen von derselben Zeile.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 151/151, exit 0 | `docs/evidence/2026-08-16/invoice-read-run1.manifest.json` |
| PostgreSQL 151/151, exit 0 | `docs/evidence/2026-08-16/invoice-read-run2.manifest.json` |
| Mutation 149/151 | `docs/evidence/2026-08-16/invoice-read-mutation.manifest.json` |

42 Migrationen. Lokal: 1064 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Keine Console-Fläche für Rechnungen** — die REST-Liste ist der erste
  Leser; die Monitoring-Ansicht der Console zeigt weiterhin nur Zähler.
- **Die Rechnung bleibt ohne kaufmännische Nummer und Fälligkeit** — unverändert
  seit 1.68, und weiterhin ausdrücklich kein Zahlungsinstrument.
- **Die Invoices-Route spricht in keinem Fall HTTP** — zertifiziert ist der
  Dienst; die Route teilt Kontext und Fehlergrenze der Usage-Fläche.
