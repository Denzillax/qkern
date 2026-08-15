# Release 1.68.0 — Der achte Prozess schliesst den Monat

Sprosse 2 der Paritätsleiter: **Der Rechnungslauf existiert, läuft als eigener
Prozess und ist bei der Arbeit belegt** — der achte Prozess mit
Arbeitsnachweis.

## Was eine Rechnung von der Projektion unterscheidet

Genau ein Punkt: Sie friert ein. Das Fenster muss abgeschlossen sein, die
Rechnung ist append-only (FORCE RLS ohne UPDATE-/DELETE-Policy, wie das
Preisblatt), und je (Projekt, Umgebung, Periode) entsteht höchstens eine — die
eindeutige Beschränkung aus Migration 0040 trägt die Idempotenz, nicht der
Code.

## Der Prozess

`npm run worker:billing-invoices` — `workers/billing-invoice-runtime.mts`, mit
der Worker-Rolle, deren Leserechte auf Umgebungen, Zähler und Preisblatt
Migration 0040 erst erteilt (sie hatte **keines** davon). Alle drei
Worker-Verträge nehmen ihn automatisch an: Startfähigkeit, Probe, Logger. Die
Ereignisse tragen feste Codes und seit 1.66 gelernte Felder — niemals
Datenbankmeldungen.

Eine Rechnung und ihre Posten entstehen in **einer** Tenant-Transaktion: Ein
Absturz dazwischen kann keine Rechnung ohne Posten hinterlassen.

## Zertifiziert

Drei Prozessfälle gegen echtes PostgreSQL:

- Aus echten Juli-Zählern und dem echten Preisblatt entsteht die Rechnung mit
  zwei Posten und Summe `430000` Mikro-CHF — und der Preis vom 1. August gilt
  für den Juli **nicht**.
- Ein zweiter Lauf meldet `exists` und lässt die Rechnung unangetastet: genau
  eine Rechnung, egal wie oft der Prozess läuft.
- Ein Lauf über die **offene** Periode scheitert an seiner
  Konfigurationsgrenze — er kommt nie an eine Runde.

Dazu fünf lokale Fälle für Periodenabschluss und Arithmetik.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Der Periodenabschluss wird entfernt — offene Perioden fakturierbar | **141 von 142** — genau der Abschlussfall |

Der erste Mutationslauf endete mit exit 1, **ohne dass die Probe lief**: Docker
Desktop war ausgefallen, und der Fehlschlag kam vom Stack, nicht vom Test. Nur
der Blick in den Log hat das unterschieden. Der Lauf wurde verworfen und
wiederholt — ein Exit-Code allein beglaubigt keine Mutationsprobe.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 142/142, exit 0 | `docs/evidence/2026-08-16/invoice-run1.manifest.json` |
| PostgreSQL 142/142, exit 0 | `docs/evidence/2026-08-16/invoice-run2.manifest.json` |
| Mutation 141/142 | `docs/evidence/2026-08-16/invoice-mutation.manifest.json` |

40 Migrationen. Lokal: 1056 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Die Rechnung hat keine kaufmännische Nummer und keine Fälligkeit.** Sie ist
  das eingefrorene Dokument einer Periode, kein Zahlungsinstrument. Nummernkreis
  und Zahlungsanbindung stehen auf der Leiter.
- **Keine Lesefläche.** Das Leserecht für die Laufzeitrolle ist erteilt, REST
  und Console zeigen Rechnungen noch nicht an.
- **Die Juli-Zähler des Prozessfalls sind als Eigentümer eingelegt**, weil der
  Usage-Dienst in das laufende Fenster schreibt und der Juli abgeschlossen ist.
  Der Schreibweg der Zähler ist seit 1.29 eigens zertifiziert; hier war der
  Rechnungslauf der Gegenstand.
- **Der Rechnungslauf hat kein Deployment-Rendering.** Die vier Komponenten in
  `runtime-deployment.ts` kennen ihn nicht; wer ihn betreiben will, startet ihn
  von Hand.
- **Zwei Instanzen desselben Laufs sind nicht geprüft.** Die eindeutige
  Beschränkung trägt das auf Datenbankseite; ein Rennen zweier Prozesse hat
  kein Fall gesehen.
