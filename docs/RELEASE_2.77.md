# Release 2.77.0 – Ein Projekt anlegen, und vier Befunde, die ein Vertrag fand

Der erste Schnitt seit vielen, der eine Fähigkeit **hinzufügt**, statt eine
fehlende sauber zu benennen. Daneben vier Fehler, die alle nicht beim
Draufschauen aufgefallen sind, sondern weil eine Prüfung sie gefangen hat.

## Was neu ist

- **Ein Projekt lässt sich anlegen**, über `POST /api/v1/projects` und über den Projektwechsler oben links.
- Der **verlorene Schreibvorgang** bei den Storage-Policies ist zu einem sichtbaren Konflikt geworden.
- Die **Aufrufliste** bricht ihre laufenden Anfragen ab.
- **Zeiten stehen mit ihrer Zone**, über einen gemeinsamen Baustein.
- Die **Anleitungen** kennen die zwei Anordnungen, und fünf veraltete Platzhalter-Aussagen sind korrigiert.
- Lokale Suite von 2684 auf 2700, PostgreSQL von 256 auf 257 Fälle.

## Das Anlegen, und die Frage, an der es hing

Eine Umgebung braucht zwingend eine Datenbankreferenz, und ein frisches Projekt
hat keine. Erfunden wurde dafür nichts: Die Marke `pending:` führt QKERN an
genau dieser Stelle schon. Das Einrichten einer Organisation schreibt sie, der
Provisionierer verlangt sie und wirft sonst `ProjectProvisioningNotReadyError`,
ein Trigger erlaubt genau den einen Tausch gegen eine echte Referenz, und die
Katalogprüfung liest sie als "nicht gebunden". Die neue Funktion weigert sich
gegen jede Referenz ohne dieses Vorzeichen.

Was dabei **nicht** entsteht, sagen Antwort und Oberfläche: Status
`provisioning`, `databaseProvisioned: false`, und die drei Umgebungen warten auf
die Bereitstellung. Eine Projektdatenbank legt dieser Weg nicht an.

Der Slug ist je Organisation eindeutig, nicht global, und die Bedingung trägt
`deleted_at` nicht: Ein gelöschtes Projekt hält seinen Slug weiter, und der 409er
sagt das in Worten. Geprüft wird zuerst gegen die vorhandenen Slugs, der Fang um
das INSERT holt das Rennen.

Regionen gibt es keinen Katalog. Die Liste trägt genau den einen Eintrag, den
bestehende Projekte tragen, und die Form sagt, dass es nur den gibt.

## Die umgedrehte Zusage

`tests/console-project-switch-contract.test.ts` verlangte bis `2.76.0`, dass die
Oberfläche **keinen** Weg zum Anlegen zeigt, mit Begründung: Die Projektroute
kannte nur `GET`, ein Knopf wäre ein Versprechen ohne Deckung gewesen. Mit der
neuen Route fällt die Begründung weg, also ist die Zusage gedreht und nicht
gelöscht. Sie verlangt jetzt beides: die Route **und** den Weg in der
Oberfläche. Eine Route ohne Knopf wäre eine Fähigkeit, die niemand findet.

## Vier Befunde, und keiner kam vom Hinsehen

**Der verlorene Schreibvorgang.** `PATCH` auf einen Bucket ist ein Vollersatz,
das Schema verlangt jedes Feld. Die Policy-Seite schickte darum vier Felder mit,
die sie nicht bearbeitet, so wie sie beim Laden aussahen. Wer die Grössengrenze
woanders änderte, während diese Seite offen stand, verlor seine Änderung, und
beide Schritte meldeten Erfolg. Jetzt wird vor dem Schreiben erneut gelesen.

**Dreimal eine zu schwache Regel.** Der Vertrag für die abgebrochenen Anfragen
suchte zuerst nur das Wort `AbortController`, dann nahm sein Suchfenster das
`signal` aus der nächsten Zeile mit, dann liess er den Aufräumer beim Verlassen
der Seite als Abbruch durchgehen. Jedes Mal überlebte die Mutationsprobe. Die
geschärfte Regel fand danach sofort eine Lücke, die niemand gesucht hatte: Das
erste Laden der Function-Liste trug gar kein Signal.

**Ein erfundenes Release.** In zwei Einsteigertexten stand `2.99.0`. Das ist eine
Fallnummer aus der Hausordnung und kein Release; der Versionsvertrag hat beide
Stellen gefangen.

**Fünf veraltete Aussagen im Glossar.** Es erzählte Einsteigern von
Platzhaltern, die es nicht mehr gibt: Schema-Visualizer, Backups, Point-in-time
Recovery, Rate Limits je Projekt und die Console als Ganzes. Jede Stelle am Code
geprüft und auf das korrigiert, was die Seite kann und was nicht.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 257/257, exit 0 | `docs/evidence/2026-10-03/createproject-postgres-run1.manifest.json` |
| PostgreSQL 17, 257/257, exit 0, auf dem gemergten Stand | `docs/evidence/2026-10-03/createproject-postgres-run2.manifest.json` |
| PostgreSQL 17, 257/257, exit 0, Reproduktion | `docs/evidence/2026-10-03/createproject-postgres-run3.manifest.json` |
| Mutation: die Mandantenbedingung fällt, 254/257, exit 1 | `docs/evidence/2026-10-03/createproject-mutation-tenant.manifest.json` |
| Vitest lokal 2700/2700, exit 0 | `docs/evidence/2026-10-03/createproject-local-run1.manifest.json` |
| Vitest lokal 2700/2700, exit 0 | `docs/evidence/2026-10-03/createproject-local-run2.manifest.json` |

Die Mutationsprobe traf bewusst nicht die erste Stelle, die sich anbot. Die
expliziten `organization_id`-Filter im Dienst sind unter `FORCE ROW LEVEL
SECURITY` redundant, ihr Entfernen hätte nichts bewiesen. Gebrochen wurde die
Bedingung, die wirklich trägt, und es fielen der neue Fall und der aus 2.68.

## Ehrlich offen

- **Der Audit-Eintrag erscheint nicht in der Aktivitätsliste.** `project.created` trägt keine Umgebung, weil ein Projekt anzulegen in keiner der drei passiert, und die Liste lässt Einträge ohne Umgebung weg. Er steht in der Kette, in der Datenbank und in der API. Eine erfundene Umgebung wäre der schlechtere Tausch; das richtig zu lösen heisst, projektweite Ereignisse einzuführen.
- **Die expliziten Mandantenfilter im Dienst sind unter RLS nur noch Gürtel zum Hosenträger.** Ein Befund, den dieser Schnitt sichtbar gemacht und nicht angefasst hat.
- **Kein Weg zurück aus `provisioning`.** Das neue Projekt bleibt in der Einrichtung, bis jemand eine Bereitstellung bestellt; den Knopf dafür gibt es nicht.
- **Die Ablehnungsgründe des Prüfmoduls sind nur deutsch**, wie beim Nachbarmodul. In einer Console mit vier Sprachen ist das eine Lücke.
- **Der Speicheradapter legt nur eine Umgebung an**, wie bisher. Erfunden ist dort nichts, aber er bildet den PostgreSQL-Weg nicht vollständig ab.
- **Die Form ist nicht im Browser gesehen.** Sie liegt hinter der Anmeldung. Belegt ist sie durch Quelltextvertrag und Stacklauf, nicht durch einen Klick.
- **Ein Lastflattern im Realtime-Soak** trat im Mutationslauf auf, 119 von 120 Änderungen nach 75 Sekunden, und war im sauberen Lauf grün. Das riecht nach Last und nicht nach Logik, belegt ist es nicht.
