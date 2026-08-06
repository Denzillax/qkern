# Release 1.24.0 — Functions Ende zu Ende

> Datum: 5. August 2026 · Vorgänger: `1.23.0`

## Wofür dieses Release steht

Release 1.23 hat Functions hinterlegbar und aufrufbar gemacht — und dabei zwei
Dinge offen ausgewiesen: `maxConcurrency` wurde gespeichert, aber nicht
durchgesetzt, und die Kette Datenbank → Dienst → Container war nie in **einem**
Lauf geprüft. Beide Hälften waren belegt, die Naht dazwischen nicht.

Genau an solchen Nähten hat dieser Sprint mehrfach Fehler gefunden: der Poller,
den niemand rief; das Event-Log, das niemand benutzte; der Container, der seinen
Timeout überlebte. Dieses Release schliesst die letzte davon.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| Functions-Zertifizierung (Docker 29.5 **plus** PostgreSQL 17) | **18 von 18 bestanden**, exit 0 |
| Reproduzierbarkeit | **dreimal** grün hintereinander vor dem Release-Commit |
| davon Kette Ende zu Ende | 5 Fälle |
| PostgreSQL-17-Zertifizierung | 85 von 85 bestanden, exit 0 |
| Mutationsprobe | Grenze abgeschaltet und Definition zwischengespeichert → 2 Fälle fallen um, 1 als Folge |
| Vitest lokal | 889 bestanden, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

`npm run test:functions:docker` startet jetzt zusätzlich ein echtes PostgreSQL
mit allen 33 Migrationen. Evidenz: `docs/evidence/2026-08-05/function-chain-*`.

## Die Kette

Fünf Fälle laufen über die ganze Strecke: Eine Definition entsteht über die
Verwaltung, landet in einer echten Datenbank, wird beim Aufruf von dort gelesen
und in einem echten Container ausgeführt.

Geprüft wird dabei, was nur die Naht zeigen kann: dass die Secret-**Referenzen**
aus der Datenbank als Referenzen im Container ankommen; dass der Egress auch
dann verweigert bleibt, wenn die Definition aus der Datenbank stammt; dass eine
abgeschaltete Function **sofort** aufhört zu existieren; dass die in der
Datenbank hinterlegte Nebenläufigkeitsgrenze wirklich greift; und dass eine
fremde Organisation auch über diesen Weg nichts sieht.

## Eine Stelle bleibt ersetzt — und nur eine

Ein lokal gebautes Test-Image hat keinen Registry-Digest. Statt die
Produktregeln aufzuweichen, trägt die Definition eine echte, formgültige
Registry-Referenz, und erst beim Start des Containers wird genau dieser eine
Argumentwert gegen die lokale Image-Id getauscht.

Validator, Spalten-Check und Sandbox-Prüfung sehen also exakt die Referenz, die
ein Betreiber hinterlegen würde. Was kein lokaler Lauf zeigen kann, ist die
Auflösung dieser Referenz durch eine echte Registry — das bleibt offen und steht
unten.

Der erste Versuch nahm die bequeme Abkürzung und schrieb die lokale Id direkt in
die Tabelle. Der Unveränderlichkeits-Trigger aus Release 1.23 hat das abgewiesen
— *auch gegen den Owner-Zugang*. Die Garantie hat also zuerst meinen eigenen
Test gefangen.

## Nebenläufigkeit

`maxConcurrency` wird jetzt beim Aufruf durchgesetzt; darüber hinaus antwortet
die Route mit **429**.

Die Grenze ist **prozesslokal**. Zwei Web-Instanzen zählen getrennt, die
tatsächliche Obergrenze ist also `maxConcurrency × Instanzen`. Eine clusterweite
Grenze bräuchte einen gemeinsamen Zähler mit eigener Ausfallsemantik; das wäre
eine grössere Entscheidung als dieser Schnitt trägt. Was sie schon hier
verhindert, ist der Fall, der ohne sie unvermeidlich ist: ein Aufrufer, der
beliebig viele Container gleichzeitig startet, bis der Host steht.

Der Zähler fällt auch nach einem Timeout oder einem Absturz der Sandbox. Ohne
das wäre eine Function nach ein paar Fehlschlägen dauerhaft „voll" — ein Fehler,
der erst im Betrieb auffiele. Ein eigener Fall hält das fest.

## Zwei Flakes, beide im Harness

Der Fall „nach einem Timeout läuft kein Sandbox-Container mehr" misst über
**alle** Container mit dem Präfix. Zwei parallel laufende Testdateien teilen sich
einen Docker-Daemon, und ein Rest aus dem Nachbarlauf machte den Fall rot, ohne
dass am Produkt etwas falsch war.

Behoben ohne die Aussage abzuschwächen: Die Dateien laufen seriell, und der Lauf
räumt Sandbox-Container aus früheren Läufen ab, bevor er misst. Danach dreimal
grün hintereinander.

## Die Mutationsprobe

Nebenläufigkeitsgrenze abgeschaltet und die Definition zwischengespeichert statt
neu gelesen: „stoppt sofort beim Abschalten" und „setzt die Grenze durch" fallen
um. Der dritte rote Fall ist eine **Folge** — ohne Grenze startete der Test einen
zweiten schlafenden Container, der den Lauf überlebte. Zwei Fälle beissen
direkt, einer über die Wirkung.

## Ehrlich offen

- **Kein Egress-Proxy.** Eine Definition mit erlaubten Origins lässt sich
  anlegen, ihr Aufruf wird abgewiesen. Functions können nichts nach aussen rufen
- Kein Deployment-Weg für Function-Images und keine Auflösung einer echten
  Registry-Referenz in einem Zertifizierungslauf
- Die Nebenläufigkeitsgrenze ist prozesslokal, nicht clusterweit
- Das harte Entfernen eines Containers nach einem Fehlschlag läuft abgekoppelt.
  In einem langlebigen Serverprozess ist das richtig; endet der Prozess im selben
  Moment, kann die Entfernung ausbleiben
- Kein Vault-gestützter Signaturschlüssel-Provider für Webhooks
- SDK und CLI kennen weder Definitionen noch Aufruf
