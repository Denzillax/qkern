# Release 2.75.0 – Zwei Anordnungen derselben Oberfläche, fünf Tarife, und eine Tabelle mit Reitern

Fünf Schnitte, und diesmal fand die Fehler nicht ein Stacklauf, sondern ein
Browser. Die Konsole ist in diesem Release zum ersten Mal durchgehend gemessen
worden statt nur gerendert, und das hat drei Dinge zutage gebracht, die durch
jede Vertragsprüfung grün gelaufen wären: eine leere Sidebar, einen Reiter, der
auf einem Telefon nicht erreichbar war, und grauen Text unter dem Kontrast, den
WCAG AA für kleine Schrift verlangt.

## Was neu ist

- Die Konsole hat zwei Anordnungen derselben 99 Ansichten: **Easy** mit neun Gruppen und zugeklappten Abschnitten, **Advanced** mit der vollständigen Navigation. Umgeschaltet wird oben neben der Umgebung, gespeichert wird je Person.
- Eine öffentliche **Preisseite** unter `/pricing` mit fünf Tarifen in Franken, in vier Sprachen, und die Startseite liest dieselbe Preisliste statt einer eigenen.
- Die **Übersicht** sagt je Dienst, was gelesen wurde, und zeigt einen Schnellstart, wenn das Projekt wirklich leer ist.
- **Leere Bereiche** sagen, was dort erscheinen wird; es gibt genau einen Kopierweg mit Rückmeldung; geheime Keys stehen maskiert; die schwersten Löschungen verlangen den abgetippten Namen.
- Eine **Tabelle** trägt ihre fünf Reiter selbst: Daten, Struktur, Beziehungen, Sicherheit, API.
- Migration `0086`, lokale Suite von 2604 auf 2652, fünf neue Verträge.

## Easy und Advanced sind keine zwei Produkte

Der Unterschied ist die Anordnung, nicht der Umfang. `EASY_NAV` führt dieselben
Kennungen wie `NAV`, und `tests/console-interface-mode-contract.test.ts` hält
fest, dass jede echte Ansicht in **beiden** Modi genau einmal erreichbar ist.
Ohne diesen Vertrag wäre der nächste neue Menüpunkt im Vorgabemodus unsichtbar,
und niemandem wäre es aufgefallen.

Weil beide Modi dieselben Kennungen führen, kostet der Wechsel nichts: Die
geöffnete Ansicht bleibt, die Umgebung bleibt, nichts lädt neu. Gemessen im
Browser auf `Datenbank · Trigger`, umgestellt, danach `Datenbank · Trigger` mit
derselben aktiven Zeile in der vollständigen Navigation.

Die Vorgabe ist `easy`, und das ist die **erste Vorgabe aus 2.55, die das
Verhalten ändert**. Wer die vollständige Navigation will, stellt einmal um, und
die Zeile bleibt. Jede Gruppe endet mit "Alles anzeigen", damit niemand raten
muss, wo der Rest liegt.

## Was der Browser fand und kein Vertrag finden konnte

**Die Sidebar stand leer.** Die Einstellungsroute lieferte eine Antwort ohne das
neue Feld, also war der Modus `undefined`, und damit traf keiner der beiden
Zweige. Eine Antwort von einem älteren Server hätte dasselbe getan. Sie läuft
jetzt durch dasselbe reine Modul, mit dem die Route sie annimmt, und ein
fehlendes Feld bekommt seine Vorgabe.

**Der Reiter "API" war auf einem Telefon nicht erreichbar.** Bei 375 Pixeln war
die Karte 530 breit, der Reiter lag bei 441, und die Seite selbst scrollte
nicht. Die Ursache stand lange im Stylesheet: `grid-template-columns: 1fr` heisst
`minmax(auto, 1fr)`, und `auto` als Untergrenze ist die Mindestbreite des
Inhalts, also zieht eine breite Tabelle die ganze Spalte breiter als das Raster.
Mit `minmax(0, 1fr)` schrumpft die Spalte, und die Tabelle scrollt in ihrem
eigenen Behälter, wo sie es immer konnte.

**Grauer Nebentext lag unter AA.** Gerechnet, nicht geschätzt: `#697386` auf
`#f1f4f9` ergibt 4,33 zu 1, verlangt sind 4,5. Zwei Stufen dunkler ergeben 4,46
und reichen nicht, drei ergeben 4,52. Der dunkle Modus liegt zwischen 6,9 und
7,9 und blieb unangetastet.

## Zwei Preislisten sind eine zu viel

Die Startseite trug ihre eigenen drei Tarife im Markup, und Business stand dort
bei 99 gegen 199 auf der neuen Seite. Wer scrollte, sah beides. Die Tarife
stehen jetzt an einer Stelle in `lib/pricing/plans.ts`, die Startseite ist ein
Anriss daraus, und der Vertrag verbietet ihr jeden eigenen Betrag.

Zwei Sätze stehen **nicht** auf der Seite. "No surprise billing" nicht, weil es
weder Spending Limit noch Usage Alerts gibt. Und "Hosted in Switzerland" nur als
"Entwickelt in der Schweiz; die Hosting-Aussage ist noch nicht verifiziert", weil
die Startseite dasselbe seit Längerem selbst sagt. Technische Grenzen nennt kein
Tarif, weil keine festgelegt sind; ein Vertrag prüft, dass nirgends eine Zahl
mit GB, Anfragen oder Nutzern steht.

## Was nicht erfunden wurde

Drei Stellen, an denen der Auftrag mehr verlangte als das Backend hergibt, und
dreimal steht jetzt da, was ist:

- **Kein Tarifmodell.** Es gibt Metriken, Preise je Metrik und Rechnungen, aber keine Tarifzeile an einem Projekt. Die Abrechnung zeigt darum keinen Tarif.
- **Keine Rotations-Route für API-Keys.** Also kein Rotieren-Knopf, sondern der Weg in Worten: neu anlegen, umstellen, widerrufen.
- **Kein Projekt-Löschen und kein Zurücksetzen.** Also keine Danger Zone dafür. Die sieben Löschungen, die es wirklich gibt, verlangen jetzt den abgetippten Namen.

Dazu zwei Korrekturen am Auftrag selbst: Das SDK heisst `@qkern/sdk` und die
Fabrik `createQkernClient`, nicht `@qkern/js` und `createClient`. Und eine
Nutzerzahl ist nicht lesbar, darum entscheidet über den Schnellstart, ob
überhaupt ein Anmeldeverfahren eingerichtet ist.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 256/256, exit 0 | `docs/evidence/2026-10-03/easyui-postgres-run1.manifest.json` |
| PostgreSQL 17, 256/256, exit 0, Reproduktion | `docs/evidence/2026-10-03/easyui-postgres-run2.manifest.json` |
| Vitest lokal 2652/2652, exit 0 | `docs/evidence/2026-10-03/easyui-local-run1.manifest.json` |
| Vitest lokal 2652/2652, exit 0 | `docs/evidence/2026-10-03/easyui-local-run2.manifest.json` |

Nur ein Stack, und das mit Begruendung: Die fuenf Schnitte fassen
Console-Komponenten, Texte, CSS, `lib/pricing` und eine Spalte in
`user_console_settings` an. Migration `0086` laeuft im PostgreSQL-Stack mit, und
dort prueft ein Fall auch ihren CHECK auf `easy` oder `advanced`. Die
siebenunddreissig Mutationsfaelle liegen als lokale Proben je Schnitt, nicht als
Stacklauf.

## Ehrlich offen

- **Die Konsole ist nicht mehr ungesehen, aber nicht vollständig gesehen.** Gemessen sind Übersicht, Easy und Advanced, die fünf Reiter, die Preisseite und die Zustandszeilen. Nicht gesehen: das Bestätigungsfeld beim Abtippen und ein maskierter Key, weil das Beispielprojekt keine Keys hat und Storage dort abgeschaltet ist. In deiner Datenbank wird nichts angelegt, nur um ein Bauteil anzuschauen.
- **Die Dev-Datenbank braucht die Spalte aus `0086` von Hand.** Migrationen laufen nur beim Anlegen des Containers; bis dahin gilt der Modus nur für die Sitzung.
- **Vier `window.confirm` bleiben stehen**, bei Sitzungen und Zustimmungen. Eine beendete Sitzung kommt durch erneute Anmeldung zurück, eine widerrufene Zustimmung durch erneute Zustimmung. Das ist eine Ermessensentscheidung und keine Vollständigkeit.
- **Der Vorgabewert einer Spalte ist nicht lesbar.** Weder die Schema-Lesung noch die Zeilenroute liefern `column_default`; der Reiter Struktur sagt das. Der Primärschlüssel kommt aus der Indexliste, weil er im Schema fehlt.
- **Einstellungen sind noch nicht gruppiert** und die Abrechnung im Dashboard hat ihren Umbau nicht bekommen. Beide stehen als `2.139` und `2.140` im Plan.
- **Zwei Mutationsproben liefen zuerst grün durch** und haben echte Lücken in den eigenen Verträgen aufgedeckt: Eine Platzhalterzeile galt nicht als leerer Zustand, und die Prüfung auf den Masken-Umschalter traf auch dessen Icon. Beide Verträge sind nachgeschärft, danach fielen die Proben.
- **Und ein Fehler an mir selbst:** Eine erste Probe am Render-Vertrag war wirkungslos, weil `<TableViewXX` die Teilzeichenkette `<TableView` enthält. Erst die echte Entfernung liess den Fall fallen. Dazu ein `t()` ohne Übersetzung, gefangen vom i18n-Vertrag.
