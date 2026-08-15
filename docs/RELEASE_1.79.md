# Release 1.79.0 — Deployments stehen im Audit

Der offene Punkt aus `1.74`: Die Tür aus Migration 0042 schreibt Historie,
aber der zentrale Audit-Weg kannte Deployments nicht. Jetzt entsteht der
Audit-Eintrag in **derselben** Transaktion wie der Tür-Aufruf — ein
Deployment ohne Audit ist vom Dienstweg aus nicht ausdrückbar.

## Der Eintrag

`deployFunction` ruft die Tür und hängt im selben Atemzug an die Hash-Kette
an: Aktion `project.compute.function.deployed`, Ressource ist die Function,
die Metadaten tragen Image-Digest und Revision, der Akteur kommt aus
demselben Principal wie die `deployed_by`-Spalte der Historie.

Bewusst **kein** SQL-seitiger Audit-Insert in der DEFINER-Tür: Die Hash-Kette
wird app-seitig über denselben Appender geführt wie jeder andere Eintrag —
den `previous_hash`/`entry_hash` füllt der Trigger aus Migration 0002 unter
dem Advisory-Lock der Organisation. Eine zweite Hash-Implementierung in
plpgsql wäre eine zweite Wahrheit gewesen.

## Zertifiziert

Gegen echtes PostgreSQL (jetzt 153 Fälle): Zwei Deployments erzeugen zwei
verkettete Einträge mit Revision 1 und 2 — echte 64-Zeichen-Hashes, keine
Platzhalter, und der zweite Eintrag zeigt auf einen Vorgänger.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Der Audit-Append wird aus der Deployment-Transaktion entfernt | **152 von 153** — genau der Audit-Fall, und nur er: Tür und Historie bestehen weiter, aber der zentrale Audit-Weg sieht nichts |

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 153/153, exit 0 | `docs/evidence/2026-08-16/deploy-audit-run1.manifest.json` |
| PostgreSQL 153/153, exit 0 | `docs/evidence/2026-08-16/deploy-audit-run2.manifest.json` |
| Mutation 152/153 | `docs/evidence/2026-08-16/deploy-audit-mutation.manifest.json` |

43 Migrationen. Lokal: 1065 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Die Zusage gilt für den Dienstweg, nicht für die Datenbank selbst** — wer
  die Tür per Hand-SQL mit der Laufzeitrolle ruft, schreibt Historie ohne
  Audit-Eintrag.
- **Keine Console-Ansicht des Deployment-Audits** — die Console zeigt die
  Deployment-Historie, der Audit-Eintrag ist nur über die Audit-Fläche
  sichtbar.
- **Nur das Deployment wird auditiert** — Anlegen, Aktivieren und Löschen von
  Functions, Crons und Webhooks laufen weiterhin ohne Audit-Eintrag.
