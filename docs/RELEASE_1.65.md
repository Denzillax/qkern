# Release 1.65.0 — Neun Grenzen, nicht sechs

Release 1.64 hat den erschöpften Verbindungspool klassifizierbar gemacht und in
**einer** Grenze richtig beantwortet. Die anderen meldeten ihn weiter als 500 —
eine Aussage, die dem Aufrufer sagt, es sei etwas kaputt, obwohl nur gerade
keine Verbindung frei war.

## Die Regel

Ein erschöpfter Pool ist weder ein Fehler der Anfrage noch einer der
Datenbank: **503**, wiederholbar. `isConnectionUnavailable` ist ein Prädikat
und keine Antwort — jede Grenze hat ihr eigenes Antwortformat, und keine soll
es dabei verlieren. Geprüft wird auch die verpackte Form: Dienste hüllen den
Fehler in ihre eigene Fehlerklasse, bevor er die Grenze erreicht.

## Der Fund

Ich hätte sechs Grenzen bedient. Es sind **neun**.

Der Vertrag zählt sie selbst — und hat drei gefunden, die in Route-Dateien
statt in `lib/server` stehen: Projekt-API-Keys, Automation Policy und
Schema-Introspektion. Genau solche übersieht eine Regel, die nur die bekannten
Stellen kennt.

Dabei kam noch etwas heraus: Drei dieser Grenzen heissen schlicht `routeError`.
Die erste Fassung des Vertrags zählte nach Namen und hielt drei für eine. Er
zählt jetzt `datei:name`.

## Mutationsproben

| Mutation | Ergebnis |
| --- | --- |
| Die Regel in einer Grenze entfernt | **17 von 19** — genau deren zwei Fälle |
| Eine zehnte Grenze angelegt, die der Vertrag nicht kennt | **16 von 19** — die Abdeckungsprüfung schlägt an und nennt sie |

Die zweite Probe ist die wichtigere: Sie belegt, dass der Vertrag die
**nächste** Grenze mitbekommt, statt nur die heutigen zu prüfen.

## Belege

| Lauf | Manifest |
| --- | --- |
| Lokal 19/19, exit 0 | `docs/evidence/2026-08-16/route-unavailable-run1.manifest.json` |
| Lokal 19/19, exit 0 | `docs/evidence/2026-08-16/route-unavailable-run2.manifest.json` |
| Mutation A 17/19 | `docs/evidence/2026-08-16/route-unavailable-mutation-a.manifest.json` |
| Mutation B 16/19 | `docs/evidence/2026-08-16/route-unavailable-mutation-b.manifest.json` |
| PostgreSQL 135/135, exit 0 | `docs/evidence/2026-08-16/route-unavailable-postgres-run1.manifest.json` |
| PostgreSQL 135/135, exit 0 | `docs/evidence/2026-08-16/route-unavailable-postgres-run2.manifest.json` |

Lokal: 1042 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Der Vertrag prüft die Antwort, nicht den Weg dorthin.** Dass eine Route
  ihren Fehler überhaupt an ihre Grenze gibt, statt ihn vorher zu verschlucken,
  steht woanders und ist hier nicht belegt.
- **Er erkennt Grenzen an ihrem Namen.** Eine Fehlerbehandlung, die nicht
  `…routeError` heisst, zählt er nicht mit.
- **Nur Project Queues hat einen eigenen Code dafür.** Die übrigen acht
  antworten richtig, nennen dem Aufrufer aber keinen maschinenlesbaren Grund.
- **Wiederholt wird weiterhin nichts von selbst**, und die Poolgrösse bleibt
  unverändert. Beides steht seit `1.64.0` offen und ist es weiter.
- Beim Zurücknehmen der ersten Mutationsprobe habe ich mit `git checkout` eine
  noch nicht eingecheckte Änderung derselben Datei mitgelöscht und neu schreiben
  müssen. Der Lauf danach war grün; erwähnt, weil ein stiller Verlust die
  gefährlichere Variante gewesen wäre.
