# Release 2.76.0 – Sieben Gruppen, ein Claim, und sechs Stellen, an denen nichts erfunden wurde

Sechs Schnitte, alle an der Oberfläche, und das Muster dieser Welle ist nicht
das, was gebaut wurde, sondern was **nicht** gebaut wurde. Fünfmal verlangte der
Auftrag eine Fähigkeit, die es im Backend nicht gibt, und fünfmal steht jetzt da,
was wirklich ist, statt eines Knopfs, der nichts tut.

## Was neu ist

- **Einstellungen** liegen in sieben Gruppen: Allgemein, Infrastruktur, API-Keys, Sicherheit, Abrechnung, Team, Gefahrenzone.
- **Abrechnung** zeigt Verbrauch, Projektion und Rechnungen, und sagt, dass kein Tarif an diesem Projekt hängt.
- **Der Claim** steht auf dem Hero: `Simple when you want it. Powerful when you need it.`, darunter ein Abschnitt, der ihn einlöst.
- **Der Projektwechsler** wechselt wirklich.
- **Der SQL-Editor** hat Editor, Ergebnis und Verlauf.
- **Realtime** sagt je Tabelle, ob ihre Änderungen ankommen, und woran das hängt.
- Lokale Suite von 2652 auf 2684, vier neue Verträge.

## Fünfmal nicht erfunden

**Kein Tarif.** Es gibt Metriken, Preise je Metrik und Rechnungen, aber keine
Tarifzeile an einem Projekt. Die Karte sagt das und zeigt daneben den Katalog
aus `lib/pricing/plans.ts`.

**Kein Rechnungstermin.** Die Nutzungsroute liefert Periode, Zeilen und Summe,
kein Fenster und kein Datum, und der Rechnungslauf ist ein Prozess ohne Zeitplan
im Repository. Abgeleitet werden nur der letzte Tag der Periode und der erste
fakturierbare Tag, beide mit ihrer Herkunft. Die Zahlungsfrist einer
ausgestellten Rechnung kommt aus dem Dokument, nicht aus einer Konstante.

**Kein Projekt-Löschen, kein Zurücksetzen, kein Pausieren.** Sechzehn Routen im
Baum tragen `DELETE`, und keine davon trifft ein Projekt. Die Gefahrenzone sagt
genau das und verweist auf die vier Seiten, wo wirklich etwas verschwindet.

**Kein Abfrageverlauf.** Die lesende Abfrage schreibt nirgends hin, die
Audit-Kette filtert in SQL auf `project_auth.*`, und im Change Set steht der
Text als `[REDACTED]`, weil er verschlüsselt liegt. Statt eines
Browser-Verlaufs sagt der Reiter, dass QKERN gestellte Abfragen nicht
protokolliert, und warum nicht: In einem Statement kann ein Geheimnis als
Literal stehen.

**Kein Realtime-Schalter.** Ob eine Tabelle Änderungen meldet, hängt an einem
Trigger je Zeile; `/schema` und `/schema/triggers` exportieren nur `GET`.
Geändert wird über ein Change Set, und das steht dort, statt dass ein Schalter
ins Leere greift.

Dazu, als sechstes: **kein "Neues Projekt"**, weil die Projektroute nur liest.

## Was der Code über sich selbst verriet

**Die Console zeigte immer das erste Projekt.** `snapshot.projects[0]`, fest
verdrahtet, und daneben ein Pfeil ohne Menü. Wer ein zweites Projekt hat, kam
über die Oberfläche nie hin. Gefunden nicht im Browser, sondern beim Lesen, weil
ich wissen wollte, was der Pfeil verspricht.

**Die PostgreSQL-Fehlermeldung erreicht die Console nie.** `ProjectDataPlaneError`
ist ausdrücklich ohne Ursache gebaut, und jeder Datenbankfehler kommt als
`DATA_PLANE_UNAVAILABLE` an. Ein Syntaxfehler und eine fehlende Tabelle sehen von
aussen gleich aus. Erklärt sind darum die elf Codes, die wirklich ankommen; ein
unbekannter bekommt den Satz, dass QKERN dazu nichts erfindet.

**Das SDK hat keinen Realtime-Client.** Es kann `createQkernClient` und CRUD.
Das Beispiel zeigt deshalb rohes WebSocket mit dem echten Protokollnamen.

## Was im Browser gemessen wurde

Der Hero, weil er ohne Anmeldung erreichbar ist. Drei Befunde:

- Das Markenblau als Schriftfarbe auf dem dunklen Hero ergibt 2,76 zu 1; selbst grosse Schrift verlangt 3 zu 1. Es gibt jetzt einen eigenen Token für Akzentschrift, hell 6,60 und dunkel 6,91.
- Mit 88 Pixeln brach jeder der beiden Sätze in zwei Zeilen und der Gegensatz ging im Umbruch unter. Die Textspalte des Heros ist 578 Pixel breit; bei 44 Pixeln steht jeder Satz auf einer Zeile, auf dem Telefon bei 28 Pixeln ebenso.
- Der Hero schrieb "neun Gruppen" aus. Die Zahl steht jetzt nur dort, wo sie aus der Navigation gelesen wird.

Die Console selbst ist in dieser Welle **nicht** im Browser gesehen worden: Sie
liegt hinter der Anmeldung, und die liegt beim Betreiber.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 256/256, exit 0 | `docs/evidence/2026-10-03/uiwelle-postgres-run1.manifest.json` |
| PostgreSQL 17, 256/256, exit 0, Reproduktion | `docs/evidence/2026-10-03/uiwelle-postgres-run2.manifest.json` |
| Vitest lokal 2684/2684, exit 0 | `docs/evidence/2026-10-03/uiwelle-local-run1.manifest.json` |
| Vitest lokal 2684/2684, exit 0 | `docs/evidence/2026-10-03/uiwelle-local-run2.manifest.json` |

Der PostgreSQL-Lauf ist hier ein Rückfallgitter und kein Beleg dieser Schnitte:
Geändert sind Console-Komponenten, Texte, CSS und die Startseite, also keine
Datei, die ein Stack fährt. Die achtundvierzig Mutationsfälle dieser Welle
liegen als lokale Proben je Schnitt.

## Ehrlich offen

- **Die Console ist in dieser Welle ungesehen.** Sechs Schnitte sind durch Markup, Verträge und Rendern belegt, nicht durch einen Blick. Das Raster der neuen Realtime-Liste, das Bestätigungsfeld beim Abtippen und ein maskierter Key haben kein Auge gesehen.
- **Zwei Mutationsproben liefen zuerst grün durch** und haben Lücken in den eigenen Verträgen aufgedeckt: Der Betragsvertrag prüfte Namen statt Fundstellen, und die Prüfung gegen ausgeschriebene Zahlen trug eine Wortgrenze, die beim Schreiben zum Steuerzeichen wurde. Beide sind nachgeschärft, danach fielen die Proben.
- **Die Trennung im Functions-Bereich ist zurückgestellt.** Drei der vier Teile stehen in der Navigation längst; was fehlt, ist nur, dass die Einsätze in der Logseite stecken statt einen eigenen Namen zu haben.
- **Der Verlauf im SQL-Editor zeigt alle Change Sets der Umgebung**, auch die aus dem Tabellen-Designer. Das ist alles, was wirklich bleibt, aber es ist kein Verlauf dieses Editors.
- **Realtime zeigt nur das Schema `public`**, wie der Rest der Console auch.
- **Die fünf fest verdrahteten Zeilennummern im Editorfeld** sind weiterhin falsch, sobald eine Abfrage länger ist. Älter als diese Welle und nicht angefasst.
- **Zwei Stellen zählen denselben Trigger aus zwei Quellen**, die Realtime-Logseite über die Projektdatenbank und der Inspector über `/schema/triggers`.
