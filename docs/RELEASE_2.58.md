# Release 2.58.0 – Die Beschreibung hinkt nicht mehr

Zwei Platzhalter weniger, eine API-Beschreibung, die nicht wieder hinter den
Routen herhinken kann, und ein Fehler, der seit `2.54.0` ausgeliefert war.

## Was neu ist

- Ansicht Datenbank, Replikation: Publikationen, Abonnements und Slots mit ihrem Rückstand, lesend und ohne eine Verbindungsangabe.
- Ansicht Einstellungen, Dashboard-Webhooks: Ereignisse des Projekts selbst gehen hinaus, über dieselbe Zustellkette wie die Datenbank-Webhooks.
- 27 Routen sind in der OpenAPI-Beschreibung ergänzt, und ein Vertrag hält sie dort.
- PostgreSQL-Zertifizierung von 207 auf 209 Fälle, lokale Suite von 2141 auf 2174.

## Der Fehler, der ausgeliefert war

Der Treiber gibt `timestamptz` als JavaScript-`Date` heraus, und ein `Date`
kennt nur Millisekunden. Der Drain-Sammler merkt sich die Position einer Zeile
als deren Zeitpunkt und Kennung, und diese Position war damit **kleiner** als
die Zeile, aus der sie stammt. Der Zeilenvergleich liess dieselbe Zeile bei
jedem Lauf wieder durch, Ladung für Ladung dieselbe Zeile, ohne dass es der
Position anzusehen wäre.

Beim Aufrufprotokoll fiel es nicht auf, weil dort ein JavaScript-Zeitpunkt
geschrieben wird und die Mikrosekunden ohnehin null sind. In `audit_logs` setzt
die Datenbank `now()`, und dort trifft es zu. Vier von fünf Lesungen des Drains
waren betroffen; die fünfte nicht, weil ein Nutzungs-Eimer auf die Stunde
abgeschnitten ist.

Gefunden hat den Fehler der Schnitt zu den Dashboard-Webhooks, an seinem
eigenen Code. Behoben ist er an beiden Stellen.

## Zwei Grenzen, die man wissen sollte

- **Die Beschreibung prüft Pfade, nicht Methoden.** Eine Route, die still ein `DELETE` dazubekommt, fällt dem neuen Vertrag nicht auf, solange ihr Pfad beschrieben ist. Das ist der nächste Schnitt.
- **Ein Abonnement kommt ohne `subconninfo`, und die Spalte wird nicht einmal ausgewählt.** Dort steht das Passwort des Herausgebers. PostgreSQL entzieht `public` das Recht auf genau diese Spalte; QKERN verlässt sich darauf nicht, sondern fragt sie nicht.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 209/209, exit 0 | `docs/evidence/2026-09-27/welle10-run1.manifest.json` |
| PostgreSQL 17, 209/209, exit 0 | `docs/evidence/2026-09-27/welle10-run2.manifest.json` |
| Mutation Position auf Millisekunden gekürzt, exit 1 | `docs/evidence/2026-09-27/welle10-mutation-drainposition.manifest.json` |
| Mutation Rückstand misst gegen sich selbst, exit 1 | `docs/evidence/2026-09-27/welle10-mutation-replication.manifest.json` |
| Mutation Akteursreferenz fährt als Ressource mit, exit 1 | `docs/evidence/2026-09-27/welle10-mutation-dashhooks.manifest.json` |
| Mutation ein Pfad fehlt und einer hat keine Route, exit 1 | `docs/evidence/2026-09-27/welle10-mutation-openapi.manifest.json` |
| Vitest lokal 2174/2174, exit 0 | `docs/evidence/2026-09-27/welle10-local-run1.manifest.json` |
| Vitest lokal 2174/2174, exit 0 | `docs/evidence/2026-09-27/welle10-local-run2.manifest.json` |

## Nachtrag zum Verfahren

Die erste Mutationsprobe zum behobenen Fehler ist **nicht** gefallen, und das
war der Befund. Der Fall prüfte den Sammler: ein zweiter Lauf ohne neue Zeile
soll nichts schicken. Eine wieder hereingelesene Zeile legt sich aber in den
Puffer und wartet dort auf ihr Zeitfenster, der Lauf meldet null, und der
Fehler bleibt unsichtbar. Geprüft wird jetzt die Zusage selbst, am Leser: Die
Position einer Zeile schliesst diese Zeile aus. Damit fällt die Mutation.

Eine Probe, die nicht fällt, ist deshalb kein Formfehler im Ablauf, sondern die
einzige Stelle, an der ein zu schwacher Fall überhaupt auffällt.

Ein zweiter Punkt zum Verfahren, weil er die Belege betrifft. Der erste
lokale Lauf dieser Welle war rot, und zwar an den beiden Verträgen, die die
Zahlen in der Statusdatei gegen die archivierten Belege prüfen: Die Datei stand
noch auf 207, der Beleg schon auf 209. Das ist genau die Arbeit dieser
Verträge. Der Lauf ist darum nicht als Beleg abgelegt, sondern durch zwei grüne
ersetzt, und die Zahl in dieser Notiz ist die gemessene.

## Ehrlich offen

- **Die Zustellung ist mindestens einmal, nicht genau einmal.** Das gilt für die Dashboard-Webhooks wie für die Drains, und beide Seiten sagen es.
- **Die Audit-Ansicht der Console faltet den Zustand falsch**: ein `succeeded` des Provisioners erscheint als blockiert. Die Meldung eines Dashboard-Webhooks trägt darum das gespeicherte Wort, der Badge selbst bleibt falsch.
- **Ein logischer Slot ist im Stack nicht prüfbar.** Der Zertifizierungscluster fährt `wal_level = replica`, darunter lässt PostgreSQL keinen anlegen. Geprüft ist ein physischer Slot und dass die Lesung genau dieses `wal_level` meldet.
- **Im Browser nicht gesehen.** Die zwei neuen Ansichten sind angemeldet nie betrachtet worden.
