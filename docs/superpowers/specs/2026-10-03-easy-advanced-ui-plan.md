# Easy und Advanced, Preise, Abrechnung: der Plan

Stand 3. Oktober 2026. Dieses Papier ordnet den Auftrag in Schnitte und sagt bei
jedem, was davon heute technisch geht und was nicht. Es wird fortgeschrieben,
nicht neu geschrieben.

## Was die Oberflaeche vorher war

Die Console ist **eine** Seite (`app/console`, `components/console/console-app.tsx`)
mit einem Zustand `view` und 99 Ansichten. Es gibt keine Route je Ansicht, also
gibt es auch keine Deep Links, die ein Umbau brechen koennte. Das ist die gute
Nachricht fuer Punkt 26 des Auftrags: Erhalten werden muss genau eine Route.

Weiter vorhanden und wiederverwendet statt nachgebaut:

- Vorlieben je Person in `user_console_settings` (Migration 0055) samt Route
  `/api/v1/auth/console-settings`. Dort gehoert der Modus hin, nicht in einen
  neuen Mechanismus.
- Befehlspalette mit Strg+K, Thema-Umschalter, einklappbare Sidebar mit Flyout,
  vier Sprachen, `OptionMenu` als einziges Auswahlbauteil (2.133).
- Abrechnung: nutzungsbasiert gemessen, Preise setzt ein Operator, Rechnungen
  liegen vor. **Es gibt kein Tarifmodell im Backend.**

## Schnitte

| Nr | Schnitt | Stand |
| --- | --- | --- |
| 2.134 | Oberflaechenmodus: `EASY_NAV`, Umschalter, Vorliebe, Migration 0086 | fertig |
| 2.135 | Preisseite `/pricing` in vier Sprachen, eine Preisliste | fertig |
| 2.136 | Uebersicht klarer, Projekt-Zustand, Schnellstart | fertig |
| 2.137 | Leere Zustaende, Kopierknoepfe, gefaehrliche Aktionen, Kontrast | fertig |
| 2.138 | Tabellen-Kontext: Daten, Struktur, Beziehungen, Sicherheit, API | fertig |
| 2.139 | Einstellungen gruppieren, API-Keys maskieren, Danger Zone | fertig |
| 2.140 | Abrechnung im Dashboard: Verbrauch und Rechnung, ohne Tarifzeile | fertig |
| 2.141 | Der Claim auf dem Hero und der Abschnitt, der ihn einloest | fertig |
| 2.142 | Projektwechsler, der wirklich wechselt | fertig |
| 2.143 | SQL-Editor: Editor, Ergebnis, Verlauf | offen |
| 2.144 | Realtime einfach: Tabellen anschalten statt Replikation erklaeren | offen |
| 2.145 | Functions getrennt: Functions, Deployments, Logs, Secrets | offen |

## Drei Stellen, an denen der Auftrag und der Code auseinandergehen

Nachtrag zu 2.140: Auch ein **Rechnungstermin** existiert nicht. Die
Nutzungsroute liefert Periode, Zeilen und Summe, kein Fenster und kein Datum,
und der Rechnungslauf ist ein Prozess ohne Zeitplan im Repository. Abgeleitet
werden nur der letzte Tag der Periode und der erste fakturierbare Tag.

Nachtrag zu 2.142: Es gibt **keine Route, die ein Projekt anlegt**, nur eine, die
liest. Darum steht im Projektwechsler kein "Neues Projekt".

**Der Tarif existiert nicht.** Punkt 19 will "Current Plan: Pro, CHF 29". Im
Backend gibt es Metriken, Preise je Metrik und Rechnungen, aber keine Tarifzeile
an einem Projekt. Die Preisseite kann darum werben, die Console kann den Katalog
zeigen und sagen, dass kein Tarif gebunden ist. Einen Tarif anzuzeigen, den
niemand gesetzt hat, waere genau das, was Punkt 35 verbietet.

**"No surprise billing" ist noch kein Versprechen.** Spending Limit, Usage
Alerts und Billing Notifications gibt es nicht. Punkt 42 sagt selbst, dass der
Satz dann nicht stehen darf. Er steht darum nicht auf der Preisseite.

**Die Produktsprache ist Deutsch.** Punkt 53 sagt, die Oberflaeche solle bei der
Sprache bleiben, die sie hat, und keine Mischung sein. Die Console spricht
Deutsch und uebersetzt sich nach en, fr und it; die Vertraege erzwingen das. Die
beiden Wortmarken "Easy" und "Advanced" bleiben in allen vier Sprachen stehen,
weil sie der Auftrag so nennt und weil sie nichts ueber die Person aussagen.

## Was 2.134 einloest und was nicht

Eingeloest: Beide Modi funktionieren, der Umschalter haengt in der Kopfzeile,
die Vorliebe liegt je Person, neue Konten beginnen einfach, die geoeffnete
Ansicht und die Umgebung bleiben beim Wechsel, Hell und Dunkel gelten in beiden
Modi, die eine Route bleibt.

Nachgetragen: Jede Gruppe im einfachen Modus endet mit "Alles anzeigen". Der
Knopf wechselt den Modus und laesst die Ansicht stehen, ist also kein Sprung,
sondern eine Lupe. Gemessen: 12 Pixel, Kontrast 5,6 zu 1 gegen die Sidebar.

Offen geblieben: Graue Nebentexte kommen im hellen Modus auf etwa 4,27 zu 1 und
liegen damit unter den 4,5 zu 1, die WCAG AA fuer kleinen Text verlangt.
Gemessen an der Zustandszeile der Uebersicht, betrifft aber jeden grauen
Nebentext. Gehoert zu 2.137, weil es dort an einer Stelle fuer alle faellt.

Und eine Einschraenkung, die der Betreiber kennen muss: Migration 0086 liegt in
`db/migrations`, aber die Dev-Datenbank bekommt Migrationen nur beim Anlegen des
Containers. Eine laufende Dev-Datenbank braucht die Spalte einmal von Hand, sonst
gilt der Modus nur fuer die Sitzung.
