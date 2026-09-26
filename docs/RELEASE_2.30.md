# Release 2.30.0 – Drei Türen

Die Einstiegsdoku: eine Seite, die sagt, was QKERN ist, und drei Türen
dahinter, je eine für Entwickler mit Supabase-Erfahrung, Entwickler beim
ersten Backend und Gründer ohne Code. Dazu ein Glossar mit 99 Begriffen,
je in drei Zeilen. Auf der Website unter `/docs`, im Repository unter
`docs/guide/de/`.

## Was neu ist

- Fünf deutsche Seiten, aus der Konsole, dem Kopfmenü und der Fusszeile
  verlinkt. Englisch, Französisch und Italienisch zeigen bis zur
  Übersetzung den deutschen Text mit Hinweis.
- Ein eigener kleiner Markdown-Renderer, der nur kennt, was die Doku braucht,
  und alles andere mit Zeilennummer ablehnt.
- Drei Vertragstests: Links und Glossarform, Kommandos und Pfade des
  Schnellstarts, Zahlen der Gründerseite nur aus Platzhaltern.
- Der Schnellstart, einmal komplett gemessen: 31 Minuten mit zwei
  Textbefunden, die behoben sind; rund sieben Minuten reine Kommandos.
- Der Dev-Compose legt eine Projektdatenbank an, ein Skript bindet eine
  Umgebung daran, die Einstellungen zeigen die Organisations-ID.
- Kopfmenü ohne den Anker "Entwickler"; das Menü übernimmt unter 1260 px.

## Belege

| Lauf | Manifest |
| --- | --- |
| Schnellstart-Durchlauf 10/10, 31 min | `docs/evidence/2026-09-26/quickstart-walkthrough.manifest.json` |
| Vitest lokal 1236/1236, exit 0 | `docs/evidence/2026-09-26/docs-local-run1.manifest.json` |
| Vitest lokal 1236/1236, exit 0 | `docs/evidence/2026-09-26/docs-local-run2.manifest.json` |
| Mutation 1/1236 fällt, exit 1 | `docs/evidence/2026-09-26/docs-mutation.manifest.json` |

`next build` grün.

## Ehrlich offen

- **Nur Deutsch.** Die Übersetzungen sind Schritt 2 des Plans.
- **Die Tabelle entsteht per SQL**, nicht über die Freigabezentrale; der
  Weg über Change Sets ist für Projektdatenbanken lokal nicht verdrahtet.
- **Das Bindungsskript ersetzt keinen Provisionierer.** Es macht das eine
  UPDATE und legt weder Auftrag noch Bindungszeile an.
- **Der Durchlauf brauchte 31 statt 15 Minuten**, weil zwei Textfehler
  unterwegs gefunden und behoben wurden und ein Schritt über ein zweites
  Konto lief. Die Kommandos selbst liefen in sieben Minuten.
- **Das Repository ist noch privat.** Der Scan der Historie fand keine
  Geheimnisse; die Entscheidung liegt bei Denzil.

## Nachtrag

Das Repository ist seit dem 26. September 2026 öffentlich. Der Schnellstart
beginnt jetzt mit `git clone`, die Wurzel trägt eine `LICENSE` (Apache 2.0),
und der Publish-Workflow signiert die Herkunft standardmässig.
