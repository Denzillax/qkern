# Release 1.71.0 — Der View trägt die Grenze des Aufrufers

Sprosse 4 der Paritätsleiter, erste Hälfte: **Die Generated Data API bedient
Views** — lesend, und nur solche, die die Mandantengrenze tragen können.

## Die Regel

Ein View läuft in PostgreSQL mit den Rechten seines **Eigentümers** — die RLS
der Basistabellen gilt für den Aufrufer nicht. Erst `security_invoker` dreht
das um. Deshalb bedient die API ausschliesslich Views mit dieser Option; alle
anderen werden mit demselben Code abgewiesen wie eine Tabelle ohne RLS, denn
es ist derselbe Mangel.

Dazu drei weitere Grenzen:

- **Lesend.** Schreibversuche enden mit dem neuen
  `GENERATED_DATA_API_READ_ONLY` (HTTP 405). Schreibbare Views existieren,
  aber ihre Update-Regeln liegen ausserhalb dessen, was diese API zusagen kann.
- **Ausdrückliche Ordnung, kein Cursor.** Ein View trägt keinen
  Primärschlüssel und damit keine Ordnung, auf der ein Keyset-Cursor stehen
  könnte. Verlangt wird eine Sortierspalte; Cursor werden abgewiesen, statt
  still Zeilen zu überspringen oder zu doppeln.
- Views im Besitz der aktuellen Rolle werden abgewiesen — dieselbe
  konservative Linie wie bei Tabellen.

## Zertifiziert

Gegen echtes PostgreSQL: Ein `security_invoker`-View über der RLS-Tabelle
zeigt Mandant A nur die Zeilen von A; Schreibversuch → `READ_ONLY`; Cursor und
fehlende Ordnung → abgewiesen; und der View **ohne** `security_invoker` — der
beide Mandanten zeigen würde — wird nicht bedient.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Die `security_invoker`-Bedingung wird entfernt | der Views-Fall fällt: der undichte View würde bedient |

Der Mutationslauf riss zusätzlich den Queue-Lastfall — dazu unten.

## Zwei Zertifizierungsbefunde nebenbei

- **Der Queue-Lastfall riss zum zweiten Mal** (nach 1.63) — diesmal mit dem
  seit 1.64 ehrlichen `QUEUE_UNAVAILABLE`. Der Code kennzeichnet den Fehler
  als wiederholbar, aber der Fall wiederholte nicht. Jetzt reagiert er wie
  ein Aufrufer reagieren soll: begrenzte Wiederholungen mit Wartezeit. Die
  Zusage (genau einmal je Nachricht) ist unverändert.
- **Ein Webhook-Fall riss am 5-Sekunden-Standardbudget** auf einem Host, der
  nach fünfzehn Docker-Läufen 200 Sekunden nur für Imports brauchte — die
  Lektion aus 1.38, an der nächsten Datei. Alle Fälle der Datei tragen jetzt
  ein ausdrückliches Budget. Ein roter Zwischenlauf wurde verworfen und der
  Stand zweimal frisch belegt.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 143/143, exit 0 | `docs/evidence/2026-08-16/views-run1.manifest.json` |
| PostgreSQL 143/143, exit 0 | `docs/evidence/2026-08-16/views-run2.manifest.json` |
| Mutation 141/143 | `docs/evidence/2026-08-16/views-mutation.manifest.json` |

41 Migrationen. Lokal: 1060 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **RPC fehlt** — die zweite Hälfte der Sprosse.
- **Der Mutationslauf lief vor der Härtung des Queue-Lastfalls**; sein
  Views-Fall ist unverändert, und nur der zählt für die Probe. Der zweite rote
  Fall darin war der ungehärtete Lastfall.
- **Materialisierte Views sind nicht dabei** — sie haben kein
  `security_invoker` und bräuchten eine eigene Regel.
- **OpenAPI unterscheidet Views nicht**: Das Schema führt sie wie Tabellen und
  bewirbt Schreiboperationen, die mit 405 enden.
