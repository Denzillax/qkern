# Release 2.78.0 – Drei Neins sind jetzt Wege, und eine Zusage ist genauer als vorher

Drei Schnitte, und alle drei folgen demselben Muster: Eine Stelle, an der die
Oberfläche bisher ehrlich sagte, dass QKERN etwas nicht kann, ist zu einem Weg
geworden. Keiner davon hat eine neue Route erfunden; alle drei benutzen, was
schon da war.

## Was neu ist

- **Der Weg aus `provisioning`:** Eine Umgebung ohne Datenbank lässt sich jetzt aus der Oberfläche bestellen.
- **Realtime einschalten:** Die Tabellenliste bereitet eine Schemaänderung vor, die den Trigger setzt.
- **Der Audit-Eintrag für ein angelegtes Projekt** erscheint in der Aktivitätsliste.
- **Die Ablehnung der Provider-Evidenz nennt ihren Grund**, ohne etwas preiszugeben.
- Lokale Suite von 2700 auf 2706.

## Dreimal kein neuer Weg, sondern der vorhandene

**Bestellen.** Die Route zum Anfordern einer Projektdatenbank ist älter als die
Seite, die sie jetzt benutzt, und trägt ein eigenes Recht. Es fehlte nur der
Knopf. Was er **nicht** tut, steht daneben: Er reiht einen Auftrag ein. Die
Route antwortet ausdrücklich mit `executed: false`, und ohne einen laufenden
Provisionierer bleibt der Auftrag stehen.

**Realtime.** Hier war die ehrliche Antwort schon im Code: "Dafür gibt es keine
Route, sondern eine Migration über ein Change Set." Genau das macht der Knopf.
Die Anweisung stammt wörtlich aus dem Fall, der den Change Feed gegen echtes
PostgreSQL belegt; eine selbst erfundene Variante könnte abweichen und liefe
dann durch, ohne zu erfassen. Angewendet wird sie erst nach einer Freigabe, wie
jede andere Schemaänderung.

**Der Audit-Eintrag.** `auditEventFromRecord` liess jeden Eintrag ohne Umgebung
weg. Das war richtig, solange jedes protokollierte Ereignis in einer der drei
Umgebungen passierte. Ein Projekt anzulegen ist das erste, das es nicht tut.

## Zwei Zusagen, genauer statt weg

Beide Male stand eine ältere Zusage im Weg, und beide Male wäre Löschen der
bequeme Weg gewesen.

**"Nur lesend"** galt für drei Einstellungsseiten. Für zwei gilt es weiter und
wird weiter geprüft. Für Compute und Disk gilt es nicht mehr, und daneben steht,
warum und wohin die Zusage umgezogen ist. Dazu neu: Auf dieser Seite gibt es
genau **einen** Schreibweg, ein zweiter müsste sich rechtfertigen.

**"Ursachenfrei"** hiess bei der Provider-Prüfung "genau zwei Felder". Das ist
dieselbe Absicht mit einer schärferen Grenze als nötig, und sie kostete die
Diagnose: Der Lauf fiel auf dem Ubuntu-Runner zweimal aus, und im Protokoll
stand beide Male nur "nicht bereit". Jetzt heisst ursachenfrei: höchstens vier
Felder, beide Zusatzfelder aus geschlossenen Mengen, ein unbekannter
Klassenname wird zu `UnknownError`, und eine Fehlermeldung wird nie
durchgereicht.

## Was die Proben gefunden haben

Dreimal hat eine Mutationsprobe oder ein Vertrag einen Fehler in meiner eigenen
Arbeit gefunden, bevor er irgendwo ankam:

- Der erste Entwurf der Diagnose schrieb die Fehlermeldung statt des Klassennamens und überlebte die Probe, weil ausgerechnet diese eine Meldung keinen Pfad enthält.
- Der Prüfer verpackte die Meldung des Lesers in eine neue und warf den gerade gemerkten Schritt sofort wieder weg. Gefunden hat das der Fall auf dem Runner, der `open` verlangte und `unknown` bekam.
- Eine Dublette in den Übersetzungen, gefangen vom Duplikatvertrag.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 257/257, exit 0 | `docs/evidence/2026-10-03/welle30-postgres-run1.manifest.json` |
| PostgreSQL 17, 257/257, exit 0, Reproduktion | `docs/evidence/2026-10-03/welle30-postgres-run2.manifest.json` |
| Vitest lokal 2706/2706, exit 0 | `docs/evidence/2026-10-03/welle30-local-run1.manifest.json` |
| Vitest lokal 2706/2706, exit 0 | `docs/evidence/2026-10-03/welle30-local-run2.manifest.json` |

Der PostgreSQL-Lauf ist hier ein Rückfallgitter: Geändert sind Console-Seiten,
ein Textmodul, ein Prüfskript und die Fehlerklasse dahinter. Die Route, die der
neue Knopf benutzt, ist seit `1.60` da und wurde zu `2.77.0` zuletzt zertifiziert.

## Ehrlich offen

- **Drei Neins bleiben Neins**, und das ist bei allen dreien richtig: Ein Tarif lässt sich nicht binden, weil es kein Tarifmodell gibt. Ein Projekt lässt sich nicht löschen, weil es dafür weder Route noch Dienstmethode gibt und die Frage, was mit Daten, Keys und Umgebungen passiert, nicht beantwortet ist. Einen Abfrageverlauf gibt es bewusst nicht, weil in einem Statement ein Geheimnis stehen kann.
- **Der bestellte Auftrag wird von nichts ausgeführt**, solange kein Provisionierer läuft. Die Seite sagt das, aber sie kann nicht sagen, ob gerade einer läuft.
- **Der vorbereitete Change Set für Realtime ist nicht angewendet.** Ob die Anweisung durchgeht, zeigt erst die Freigabe.
- **Keine der drei Seiten ist im Browser gesehen.** Sie liegen hinter der Anmeldung.
- **Das Flattern auf dem Ubuntu-Runner ist nicht erklärt.** Es ist nur noch untersuchbar: Beim nächsten Mal steht der Schritt im Protokoll.
