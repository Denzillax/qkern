# Release 2.81.0 – Echte Ablehnungen auf Deutsch, und jeder Knopf hat einen Namen

2.80.0 hatte offen gelassen, dass der Nachbau der Console Schreibanfragen
pauschal annimmt: Wie eine echte Ablehnung des Servers im Formular aussieht,
war nie zu sehen. Dieser Release schliesst das von der anderen Seite. Statt
eines Laufs gegen den Server geht jeder Fehlercode durch die echte Abbildung
seiner Route, und das, was dabei herauskommt, durch dieselbe Funktion, die das
Formular benutzt.

## Was neu ist

- **Storage und Compute (2.171).** Gerade die Ablehnungen, die ein Formular am ehesten bekommt, kamen englisch an: Ein Bucket oder Cron-Job mit vergebenem Namen meldete "Storage conflict" oder "Compute definition conflict".
- **Auth, Queues und Usage (2.172).** Dreizehn Meldungen kamen roh an, darunter ein Konto, das es schon gibt, ein Passwort aus einer bekannten Sammlung geleakter Zugangsdaten, ein Auth-Hook, der ablehnt, und eine volle Queue.
- **Jede Fehlerabbildung der Routen läuft durch einen Vertrag**, alle fünf.
- Lokale Suite von 2733 auf 2735.

## Warum die Übersetzungen so lang sind

Ein Konflikt heisst im Code nicht immer dasselbe. Bei Storage und Compute hat
er drei Ursachen: Der Name ist vergeben, die Höchstzahl ist erreicht, oder
jemand hat dasselbe gleichzeitig geändert. Bei einer Queue gibt es keine
Höchstzahl, also nennt ihr Satz nur die beiden anderen. Der Konflikt im
Preisblatt hat zwei eigene Ursachen: einen Eintrag für denselben Zeitpunkt
oder eine Währung, die nicht zu den bisherigen passt. Jeder Satz ist an der
Stelle geprüft, die den Code wirft, und nennt die Ursachen, die es dort gibt,
statt eine zu raten.

Drei Codes bleiben roh: die des Multipart-Protokolls. Sie sieht ein Client,
der eine Datei in Teilen hochlädt, nicht die Console, und der Vertrag sagt das.

## Was ohne Code-Änderung belegt ist

Der Barrierefreiheits-Baum, also das, was Chrome einem Screenreader übergibt,
ist für alle 99 Ansichten ausgelesen, dazu für die offenen Zustände: Formular,
Löschbestätigung, beide Menüs, Befehlspalette, Kontomenü. Kein Knopf, kein
Link, kein Feld und kein Menüeintrag ist ohne Namen. Dass die Prüfung sieht,
was sie sehen soll, ist belegt: Ein absichtlich eingeschleuster Knopf ohne
Namen wurde gefunden. Für diesen Befund gibt es keinen Commit, weil es nichts
zu ändern gab.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 257/257, exit 0 | `docs/evidence/2026-10-07/welle33-postgres-run1.manifest.json` |
| PostgreSQL 17, 257/257, exit 0, Reproduktion | `docs/evidence/2026-10-07/welle33-postgres-run2.manifest.json` |
| Vitest lokal 2735/2735, exit 0 | `docs/evidence/2026-10-07/welle33-local-run1.manifest.json` |
| Vitest lokal 2735/2735, exit 0 | `docs/evidence/2026-10-07/welle33-local-run2.manifest.json` |

Der PostgreSQL-Lauf ist ein Rückfallgitter: Geändert sind ein Textmodul der
Console, Übersetzungen und ein Vertrag.

## Ehrlich offen

- **Ein Screenreader hat die Console nicht gelesen.** Rollen und Namen stimmen; wie sie klingen, beurteilt nur ein Mensch mit NVDA oder VoiceOver.
- **Die Console ist nicht mit einem echten Projekt angesehen.** Alle Messungen stammen aus dem Nachbau.
- **Projekt löschen** wartet auf eine Entscheidung: was mit Daten, Keys und Umgebungen geschieht, und ob sofort oder nach einer Frist.
- Tarif binden und Abfrageverlauf bleiben Neins, wie in 2.78.0 begründet.
