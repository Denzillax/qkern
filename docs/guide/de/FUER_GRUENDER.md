# Für Gründer

> Für Menschen, die ein Produkt bauen lassen und wissen wollen, was QKERN dabei ist. Keine Kommandozeile, kein Code. Wo ein Fachwort nötig ist, führt es ins [Glossar](GLOSSAR.md).

## Was QKERN für dein Produkt bedeutet

Jede App hat einen sichtbaren Teil und einen unsichtbaren. Der sichtbare ist die Oberfläche, die deine Kunden bedienen. Der unsichtbare ist das [Backend](GLOSSAR.md#backend): dort liegen die Daten, dort werden Konten angelegt, Dateien abgelegt, Rechte geprüft. Diesen unsichtbaren Teil bauen Entwickler sonst für jedes Produkt neu, und er kostet in der Regel die Hälfte der Zeit.

QKERN ist dieser unsichtbare Teil, fertig. [Datenbank](GLOSSAR.md#datenbank), Login, Dateien, Live-Updates, Hintergrundaufgaben, mit einer Oberfläche, der [Konsole](GLOSSAR.md#konsole), in der man sieht, was passiert. Dein Entwickler baut die Oberfläche deines Produkts und verbindet sie mit QKERN, statt das Fundament selbst zu giessen.

Der Vergleich, den Entwickler kennen: QKERN tut, was Supabase tut. Der Unterschied liegt darin, wie es geprüft wird, dazu unten mehr.

## Was man damit bauen lassen kann

Drei Beispiele, alle mit denselben Bausteinen:

- **Eine Buchungs-App.** Kunden legen ein Konto an (Login), sehen freie Termine (Datenbank), buchen (Datenbank plus Regeln, wer welche Buchung sehen darf), bekommen eine Bestätigung (Hintergrundaufgabe), und ein Kalender im Büro zeigt neue Buchungen sofort (Live-Updates).
- **Ein Mitgliederbereich.** Zahlende Mitglieder melden sich an, laden Dokumente hoch (Dateien mit Virenprüfung) und sehen nur ihre eigenen; ein Admin sieht alle. Die Regel "nur die eigenen" steht in der Datenbank selbst, nicht irgendwo im Code, wo man sie vergessen kann.
- **Eine interne Verwaltung.** Mitarbeiter pflegen Kunden und Aufträge in Tabellen, die die Konsole direkt zeigt. Für den Anfang reicht der eingebaute Tabelleneditor; die eigene Oberfläche kommt, wenn klar ist, was gebraucht wird.

Was QKERN nicht ist: kein Baukasten, mit dem du selbst ohne Entwickler eine App zusammenklickst. Es ist das Werkzeug des Entwicklers.

## Was es kostet

Die Software kostet nichts. QKERN ist [Open Source](GLOSSAR.md#open-source) unter der [Apache-2.0-Lizenz](GLOSSAR.md#apache-2-0): frei nutzbar, auch für Geschäftliches, ohne Lizenzgebühr und ohne Pflicht, eigenen Code offenzulegen.

Was kostet, sind zwei Dinge:

- **Betrieb.** QKERN muss irgendwo laufen. Auf einem gemieteten Server oder in einer Cloud; die Kosten hängen von Grösse und Anbieter ab und beginnen im Bereich von wenigen Dutzend Franken im Monat. Heute gibt es kein Angebot, bei dem du QKERN gehostet mietest. Das steht auf dem Plan, ist aber nicht da.
- **Entwicklerzeit.** Die Oberfläche deines Produkts und die Verbindung zu QKERN. Diese Zeit ist kleiner als ohne QKERN, aber nicht null.

## Wo die Daten liegen

Dort, wo QKERN läuft. QKERN schickt keine Daten an uns oder an Dritte; es gibt keinen zentralen Dienst, durch den etwas fliesst. Läuft QKERN auf einem Server in Zürich, liegen die Daten in Zürich.

QKERN wird in der Schweiz entwickelt. Einen geprüften Nachweis über Datenstandort oder Hosting gibt es heute nicht, weil es kein Hosting-Angebot gibt. Wer eine Aussage zu Datenschutz oder Standort braucht, bekommt sie vom Betreiber des Servers, nicht von QKERN.

## Was "zertifiziert" hier heisst

Auf der Startseite und in dieser Doku stehen Zahlen wie "{{postgresCases}} Fälle bestanden". Das bedeutet:

- Jeder Baustein wird gegen echte Dienste geprüft, nicht gegen Attrappen. Ein echtes [PostgreSQL](GLOSSAR.md#postgresql), ein echter Dateispeicher, ein echter Mailserver. Heute sind das {{stackCount}} solche Prüfstände.
- Die Prüfung läuft automatisch bei jeder Änderung, und die Protokolle liegen mit Datum und Ergebnis im Repository, dem Ort, an dem der Quellcode verwaltet wird.
- Die Zahlen auf der Startseite werden aus diesen Protokollen gelesen. Steht dort {{postgresCases}}, gibt es eine Datei, die {{postgresCases}} sagt. Ein Test verhindert, dass jemand eine Zahl von Hand hineinschreibt.
- Dazu gehört ein Gegentest: Man baut absichtlich einen Fehler ein und prüft, dass die Prüfung ihn findet. Eine Prüfung, die bei einem eingebauten Fehler grün bleibt, taugt nichts.

Was es nicht heisst: keine Zertifizierung durch eine Behörde oder eine Prüfstelle, kein Gütesiegel, keine Haftung. "Zertifiziert" ist hier ein Wort für "gegen echte Dienste belegt, und der Beleg ist einsehbar".

## Was heute fehlt

QKERN nennt sich Product MVP: das Fundament steht, viele Ansichten in der Konsole sind noch Platzhalter, die ehrlich sagen, was sie noch nicht können. Es gibt kein Hosting-Angebot, keine Abrechnung, keine Teamverwaltung in der Konsole. Wer heute mit QKERN baut, baut mit einem Werkzeug, das sich noch bewegt.

## Fragen an deinen Entwickler

Sieben Fragen, mit denen du ein Gespräch über das Backend führen kannst, ohne selbst eines zu bauen:

1. Ist auf jeder Tabelle [Row Level Security](GLOSSAR.md#row-level-security) eingeschaltet, und was sagt die Regel für einen Kunden, der nicht angemeldet ist?
2. Welche Schlüssel liegen in der App, die Kunden herunterladen, und was dürfen sie?
3. Wer darf eine Änderung an der Datenbank für production freigeben, und wo sehe ich nachher, wer es war?
4. Wo laufen [Backups](GLOSSAR.md#backup), wie weit zurück kann man wiederherstellen, und wann wurde das zuletzt ausprobiert?
5. Welche Dienste braucht QKERN im Betrieb, und was passiert, wenn einer davon ausfällt?
6. Wie kommen die Daten wieder heraus, falls wir das Werkzeug wechseln?
7. Was von dem, was wir brauchen, ist bei QKERN heute ein Platzhalter?


## Ehrlich offen

- Diese Seite beschreibt QKERN {{version}}, ein Product MVP. Vieles bewegt sich noch.
- Es gibt kein Hosting-Angebot und keinen Nachweis über Datenstandort. Beides steht auf dem Plan.
- Kostenangaben zum Betrieb sind Grössenordnungen, keine Offerte.
- "Zertifiziert" ist ein Wort für belegte Prüfungen, keine Prüfung durch Dritte.
