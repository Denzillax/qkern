# Release 2.79.0 – Die Console einmal ganz angesehen, und das Flattern ist erklärt

Bis hierher war jeder Schnitt an der Console nur durch Verträge belegt, weil
sie hinter der Anmeldung liegt und ich mich dort nicht anmelde. Für diesen
Release lief sie in einem Nachbau: dieselben Komponenten und dasselbe
Stylesheet, als Daten der Speicher-Store mit seinem Demo-Projekt und ein paar
Beispielzeilen, fotografiert mit einem kopflosen Chrome in Breiten von 390 bis
1440 Pixeln. Ein Prüfskript ging über jede Ansicht, hell und dunkel, und
meldete jeden sichtbaren Text unter 11 Pixeln, jeden unter dem AA-Kontrast und
alles, was über den Rand läuft. Am Ende meldet es nichts mehr.

## Was neu ist

- **Lesbar (2.157):** Akzent-, Erfolgs- und Warnfarbe haben als Schrift eigene Token je Modus. Links auf dunklen Karten kamen auf 2,56 zu 1, die Warnfarbe im hellen Modus auf 1,71. Fliesstext mit 8 oder 9 Pixeln steht jetzt bei 11 bis 13.
- **Kopfzeile in jeder Breite (2.158):** Unter 1280 Pixeln liefen Suche, Hell/Dunkel und Glocke rechts aus dem Bild.
- **Easy-Seitenleiste:** Offen ist genau die Gruppe, in der man steht.
- **Gleiche Dinge gleich (2.159):** Kartentext in einer Grösse, Kopierzeilen in einem Raster, Verweise mit den Namen der sichtbaren Navigation.
- **Meldungen des Servers auf Deutsch (2.160):** 155 Stellen in 74 Ansichten laufen durch `serverErrorText`, dazu zwei gemeinsame Datenquellen (2.164).
- **Datenansichten mit Beispieldaten gesehen (2.161):** Bucket-Regeln in Worten, ein Knopf, der aus seiner Karte lief, zwei Knöpfe mit demselben Namen, ein Designer, der ein leeres Feld rügte.
- **Bedeutung auf dem Knopf, Unterlängen sichtbar (2.163):** Jedes Auswahlmenü schnitt g, j, p, q und y ab.
- **Das Flattern auf dem Ubuntu-Runner ist erklärt (2.162),** und dabei fiel ein Fehler im Prüfer auf.
- Die Suche in der Aktivitätsliste filtert jetzt; das Feld tat vorher nichts.
- Lokale Suite von 2706 auf 2724.

## Warum die Kopfzeile nie gepasst hat

Die Absicht stand schon im Stylesheet: Bei 1050 und 760 Pixeln sollte die Suche
zum Symbol schrumpfen und die Breadcrumb verschwinden. Weiter unten setzten
spätere Korrekturen dieselben Selektoren ohne Media-Query nach
(`.command-button { min-width: 220px }`), und die gewinnen. Die Regeln stehen
jetzt am Ende der Datei, und ein Vertrag prüft genau diese Reihenfolge.

## Das Flattern

Seit 2.23 fiel der CLI-Fall der Provider-Evidenz gelegentlich auf dem
Ubuntu-Runner aus. Die Diagnose aus 2.152 nannte beim nächsten Ausfall zum
ersten Mal den Schritt: `readiness`. Der Test baute die Zeitpunkte aus drei
getrennten Aufrufen von `Date.now()`, und der Prüfer verlangt eine Laufdauer in
ganzen Sekunden. Lag eine Millisekunde zwischen den Aufrufen, war die Dauer
3'600'001 ms. Das trifft nur einen ausgelasteten Rechner, und der Fall läuft
nur auf POSIX, darum nie lokal. Jetzt ein Anker, auf Sekunden gerundet, und ein
Fall für den Mechanismus, der auf jeder Plattform läuft.

**Beim Lesen gefunden, im Produkt:** Die Grenze für den Abstand zwischen Lauf
und Zertifizierung ging über dieselbe Hilfsfunktion. Mit Millisekundenrest kam
`NaN` heraus, und `NaN > 1800` ist falsch. Ein Abstand von 30 Minuten und einer
halben Sekunde ging als `ready` durch. Der Fall dafür fiel auf dem alten Stand
und steht jetzt; verglichen wird in Millisekunden.

## Was die Proben gefunden haben

Viermal war ein Vertrag grün, und der Nachbau zeigte trotzdem den Fehler:

- Die Regel gegen rohe Servermeldungen schloss ein vorangehendes `(` aus und sah `setMessage(payload.error??…)` nicht.
- Zwei weitere Schreibweisen (`(await r.json()).error??` und eine Variable `error`) kannte sie gar nicht.
- Umstellung und Vertrag lasen nur `.tsx`; die Berichte holen ihre Daten aus einer `.ts`-Datei.
- Der Zustand `ready` fehlte in der Zuordnung aus 2.145.

Jeder dieser Fälle steht jetzt im Vertrag, und jede Ergänzung ist mit einer
Mutation belegt, die genau sie fallen lässt.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 257/257, exit 0 | `docs/evidence/2026-10-04/welle31-postgres-run1.manifest.json` |
| PostgreSQL 17, 257/257, exit 0, Reproduktion | `docs/evidence/2026-10-04/welle31-postgres-run2.manifest.json` |
| Vitest lokal 2724/2724, exit 0 | `docs/evidence/2026-10-04/welle31-local-run1.manifest.json` |
| Vitest lokal 2724/2724, exit 0 | `docs/evidence/2026-10-04/welle31-local-run2.manifest.json` |

Der PostgreSQL-Lauf ist ein Rückfallgitter: Geändert sind Console-Seiten, CSS,
Texte, Verträge und eine Vergleichszeile im Prüfer der Provider-Evidenz, die
kein Stack fährt. Der Prüfer ist in der lokalen Suite belegt, der CLI-Fall auf
den drei GitHub-Runnern.

## Ehrlich offen

- **Der Nachbau ist nicht die echte Console.** Er rendert dieselben Komponenten, aber gegen den Speicher-Store und Beispieldaten; Routen, die er nicht kennt, antworten 404. Was eine echte Projektdatenbank zeigt, etwa sehr breite Tabellen oder lange Namen, hat er nicht gesehen.
- **Die Ansichten sind fotografiert, nicht bedient.** Geklickt wurde die Navigation, die Suche der Aktivitätsliste und die Auswahl der Zugriffsseite.
- **Der Log-Explorer zeigt seine Filterwerte weiter englisch,** mit Absicht: Es sind die Werte, die die Route annimmt.
- **Von 180 englischen Servermeldungen** sind die häufigen und vier Familien übersetzt; der Rest bleibt, wie der Server ihn schickt, damit nichts verschwindet.
- Die drei Neins aus 2.78.0 bleiben: Tarif binden, Projekt löschen, Abfrageverlauf.
