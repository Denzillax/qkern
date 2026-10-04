# Release 2.80.0 – Die Console bedient, nicht nur angesehen

2.79.0 hatte die Console in einem Nachbau fotografiert und vermessen und
dabei zwei Dinge offen gelassen: Sie hatte nur kurze, freundliche Daten
gesehen, und die Ansichten waren fotografiert, kaum bedient. Dieser Release
schliesst beide Punkte. Der Nachbau bekam lange Namen und breite Tabellen, und
die Abläufe wurden mit echten Klicks und echten Tastendrücken über das
DevTools-Protokoll gefahren.

## Was neu ist

- **Lange Namen kürzen, statt aus dem Kasten zu laufen (2.165).** Ein Auswahlfeld mit zentriertem Label zeigte "neshop Produl", die Kontozeile wuchs auf 292 Pixel in einer 232 Pixel breiten Seitenleiste, die Werkzeugleiste der Zeilen brach bei 1024 Pixeln nicht um.
- **Formulare statt Browser-Dialogen (2.166).** Neun Ansichten fragten über `window.prompt` und `window.confirm`. Ein Cron-Job brauchte vier Fenster nacheinander, eine Zeile wurde als JSON in einem Fenster bearbeitet.
- **Ein Fokusrahmen, den man sieht (2.167).** Er war da, aber mit 1,36 zu 1 Kontrast; jetzt mindestens 6,24 zu 1.
- **Menüs mit der Tastatur (2.168).** In allen vier Menüs fiel der Fokus nach Escape auf `body`; Pfeiltasten gab es nicht.
- **Die Befehlspalette als Dialog (2.169).** Enter tat nichts, Escape gab es nur als Knopf in 7 Pixeln, und unter Windows stand "⌘ K" auf dem Suchknopf.
- **Formular und Bestätigung halten den Fokus (2.170).**
- Lokale Suite von 2724 auf 2733.

## Formulare statt Browser-Dialogen

Das Fenster von `window.prompt` gehört dem Browser: eigene Knöpfe in dessen
Sprache, kein Hinweis am Feld, nie alle Felder zugleich, und ein Tippfehler im
dritten Fenster bricht alles ab. `FormPanel` klappt stattdessen in der Seite
auf, in derselben Form wie die Löschbestätigung. Pflichtfelder sperren den
Knopf, eine Ablehnung des Servers bleibt im Formular stehen, und die Eingaben
bleiben mit ihr. Vorher kippte eine Ablehnung bei Buckets und Tabellenzeilen
die ganze Ansicht in den Fehlerzustand, und die Liste verschwand.

Die Prompts waren mit Beispielen vorbelegt, etwa "nightly-report". In einem
Formular wäre das ein echter Wert, und ein schneller Druck legte das Beispiel
an. Beispiele stehen darum als Platzhalter; vorbelegt ist nur eine echte
Vorgabe (`UTC`) und beim Bearbeiten einer Zeile ihre aktuellen Werte. Die
Anfragen an den Server sind dieselben wie vorher, und ein Vertrag hält ihre
Form fest.

## Die Tastatur

Gemessen wurde mit echten Tastendrücken, weil programmatischer Fokus
`:focus-visible` nicht auslöst. Die erste Messung des Fokusrahmens zeigte
deshalb fälschlich 25 von 28 Elementen ohne Rahmen; erst Tab-Drücke über das
DevTools-Protokoll gaben das richtige Bild, und das war ein anderes: Der Rahmen
war überall da, nur kaum zu sehen.

Für die Menüs gibt es jetzt einen Hook statt vier Kopien desselben Effekts:
Beim Öffnen steht der Fokus auf dem gewählten Eintrag, Pfeile, Pos1 und Ende
bewegen ihn, Escape und eine Wahl per Tastatur geben ihn an den Knopf zurück.
Formular, Bestätigung und Befehlspalette merken sich, wo der Fokus beim Öffnen
stand, und geben ihn beim Schliessen dorthin zurück.

## Was die Proben gefunden haben

- Ein Vertrag verlangt, dass jede `.tsx`-Datei der Console genau eine Komponente exportiert. Die Felddefinitionen der Formulare stehen darum in einer `.ts`-Datei, mit ihren Texten als Konstante für den i18n-Vertrag.
- Der Vertrag für leere Zustände lehnte "Kein Treffer." ab, zu Recht: Ein leerer Zustand soll erklären. Jetzt steht dort, worin gesucht wird.
- Zweimal lag der Fehler in meinem eigenen Testskript: Ein Probe-Code in einem Template-String verlor seine Backslashes, und ein Vorlauf mit `await` ohne async-Hülle brach still ab.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 257/257, exit 0 | `docs/evidence/2026-10-04/welle32-postgres-run1.manifest.json` |
| PostgreSQL 17, 257/257, exit 0, Reproduktion | `docs/evidence/2026-10-04/welle32-postgres-run2.manifest.json` |
| Vitest lokal 2733/2733, exit 0 | `docs/evidence/2026-10-04/welle32-local-run1.manifest.json` |
| Vitest lokal 2733/2733, exit 0 | `docs/evidence/2026-10-04/welle32-local-run2.manifest.json` |

Der PostgreSQL-Lauf ist ein Rückfallgitter: Geändert sind Console-Komponenten,
CSS, Texte und Verträge, keine Route und keine Datei, die ein Stack fährt.

## Ehrlich offen

- **Der Nachbau ist weiter nicht die echte Console.** Er antwortet auf Schreibanfragen mit einer festen Zusage und auf alles Unbekannte mit 404. Ob eine echte Ablehnung so im Formular steht, wie der Nachbau es zeigt, belegt die Form der Antwort, nicht ein Lauf gegen den Server.
- **Ein Screenreader hat die Console nicht gelesen.** Rollen und Fokus sind gesetzt und gemessen; wie sie vorgelesen werden, ist nicht geprüft.
- **Der Log-Explorer zeigt seine Filterwerte weiter englisch,** mit Absicht.
- Die drei Neins bleiben: Tarif binden, Projekt löschen, Abfrageverlauf.
