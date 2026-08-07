# Release 1.36.0 — Clusterweite Grenze

> Datum: 6. August 2026 · Vorgänger: `1.35.0`

## Wofür dieses Release steht

`maxConcurrency` stand seit Release 1.23 in der Definition und wurde seit 1.24
durchgesetzt — **prozesslokal**. Zwei Web-Instanzen zählten getrennt; die
tatsächliche Obergrenze war `maxConcurrency × Instanzen`. Das ist keine Grenze,
sondern ein Vielfaches davon, und es stand seither in jeder Release-Notiz.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| PostgreSQL-17-Zertifizierung | **106 von 106 bestanden**, exit 0, 35 Migrationen |
| Reproduzierbarkeit | zweimal grün **vor** dem Release-Commit |
| Neue Fälle | 5 gegen echtes PostgreSQL |
| Mutationsprobe 1 | Zählweg filtert nach Halter → genau 1 Fall fällt um |
| Mutationsprobe 2 | Ablauf ignoriert, Platz veränderbar → genau 2 Fälle fallen um |
| Vitest lokal | 976 bestanden, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

## Ein Platz ist eine Zeile

Migration 0035 legt `project_function_slots` an. Vor dem Start eines Containers
entsteht eine Zeile, nach seinem Ende verschwindet sie. Gezählt und eingefügt
wird unter einer transaktionsgebundenen Vorsperre — ohne sie sähen zwei
Instanzen gleichzeitig denselben freien Platz und beide nähmen ihn.

Der Halter steht in der Zeile, aber **nicht in der Zählbedingung**. Ein Adapter,
der nur eigene Plätze zählte, würde fremde übersehen und genau das Problem
wiederholen, das er lösen soll. Die erste Mutationsprobe fügt genau diesen
Filter ein, und genau der Fall fällt um, der zwei Instanzen gegeneinander
stellt.

## Warum ein Ablauf und keine Aufräumaufgabe

Ein Prozess kann zwischen Belegen und Freigeben sterben. Ohne Ablauf bliebe der
Platz für immer belegt, und die Function wäre nach ein paar Abstürzen dauerhaft
„voll" — derselbe Fehler, den Release 1.24 schon einmal prozesslokal behoben
hat. Der Ablauf macht die Freigabe zur Eigenschaft der Zeile statt zur Aufgabe
eines Aufräumers, den es noch nicht gibt.

Ein Platz ist unveränderlich: kein `UPDATE`-Recht und ein Trigger dahinter. Eine
verlängerbare Zeile wäre ein Weg, die Grenze zu umgehen, ohne sie zu verletzen.

## Zwei Grenzen mit zwei Aufgaben

Die prozesslokale Zählung bleibt. Sie schützt **diesen Host** vor einem
Aufrufer, der beliebig viele Container startet; die geteilte Grenze schützt den
**Tenant**. Beide müssen zustimmen.

Ist die Control Plane nicht erreichbar, wird der Aufruf abgewiesen. Das ist die
Gegenrichtung zur Usage-Quota aus Release 1.29 — dort wird durchgelassen — und
der Unterschied ist begründet: Eine Quota ist eine kaufmännische Grenze, diese
hier schützt vor Überlast.

## Zwei wertlose Zwischenläufe

Die zweite Mutationswelle warf in zwei Anläufen **alle fünf** Fälle um statt
zweier. Nicht, weil die Zusage breiter trägt, sondern weil meine Mutation
ungültiges SQL erzeugte: PostgreSQL kann den Typ eines Parameters nicht
bestimmen, der nur in `IS NOT NULL` oder in `$5 - interval '100 years'`
vorkommt. Der Adapter warf, und `claim` scheitert geschlossen — also fiel alles
um.

Eine Mutationsprobe, die das Werkzeug zerstört statt die Zusage aufzuweichen,
sagt nichts aus. Erst der dritte Versuch — Ablauf über einen uralten
Vergleichszeitpunkt ausgehebelt, SQL unverändert — traf die zwei vorhergesagten
Fälle.

Dabei kam ein zweiter Befund heraus: Das Aufräumen abgelaufener Plätze im
Adapter ist **nicht** das, was die Zusage trägt. Der Ablaufvergleich in der
Zählung tut es. Das Löschen hält nur die Tabelle klein; wer es entfernt, bricht
keinen Fall. Der Kommentar im Code sagt das jetzt.

## Ehrlich offen

- **Die zwei Instanzen sind zwei Dienste in einem Prozess.** Sie teilen nichts
  ausser der Datenbank, aber ein Lauf mit zwei echten Prozessen und einem echten
  Absturz zwischen Belegen und Freigeben fehlt
- Die Lease ist fest auf Timeout plus 30 Sekunden. Eine Function, die ihren
  Timeout überschreitet, weil der Host hängt, gibt ihren Platz zu früh frei
- Ein Aufräumer für Plätze abgeschalteter oder gelöschter Functions gibt es
  nicht; der Fremdschlüssel räumt beim Löschen der Definition mit auf
- Kein Deployment-Weg für Function-Images, keine authentifizierte Registry
- Weder Preise noch Tarife noch Rechnungen
- SDK und CLI sind nur auf Linux belegt
