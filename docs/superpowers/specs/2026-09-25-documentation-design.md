# Dokumentation für drei Zielgruppen, mit Glossar

Entwurf vom 25. September 2026, mit Denzil im Brainstorming abgestimmt.
Gewählt: Weg 1 (Markdown im Repository, die Website rendert es mit einem
kleinen eigenen Renderer) gegen Weg 2 (Seiten als React-Komponenten) und
Weg 3 (fertige Markdown-Bibliothek).

## Ziel

Wer QKERN zum ersten Mal sieht, soll ohne Vorwissen verstehen, was es ist,
und in einer Viertelstunde selbst etwas damit tun können. Drei Zielgruppen
bekommen je einen eigenen Einstieg, alle teilen sich ein Glossar, und das
bestehende Handbuch bleibt die Fassung für Fortgeschrittene.

- **A** Entwickler, die Supabase kennen: wollen schnell sehen, was gleich
  und was anders ist.
- **B** Entwickler, die ihr erstes Backend bauen: brauchen zu jedem Schritt
  das Warum.
- **C** Gründer ohne Entwicklerhintergrund: wollen wissen, was QKERN für ihr
  Produkt bedeutet, ohne eine Kommandozeile zu öffnen.

Deutsch zuerst. Englisch, Französisch und Italienisch folgen, wenn die
deutsche Fassung abgenommen ist.

## Dateien

Alles Neue liegt unter `docs/guide/de/`. Spätere Sprachen bekommen
`docs/guide/en/`, `fr/`, `it/` mit denselben Dateinamen.

| Datei | Für wen | Inhalt |
| --- | --- | --- |
| `WAS_IST_QKERN.md` | alle | Was QKERN ist, wofür man es braucht, was es nicht ist. Wie die Bausteine zusammenhängen: Konsole, Organisation, Projekt, Umgebung, Datenbank, Data API, Auth, Storage, Realtime, Queues, Cron und Webhooks, Freigabezentrale. Endet mit drei Türen: "Ich kenne Supabase", "Ich baue mein erstes Backend", "Ich bin kein Entwickler". |
| `SCHNELLSTART.md` | A | Docker starten, registrieren, Projekt anlegen, Tabelle bauen, eine Zeile per REST und per SDK lesen. Fünfzehn Minuten. Jeder Schritt mit der erwarteten Ausgabe. Am Ende die Tabelle "So heisst es bei Supabase, so bei QKERN". |
| `ERSTES_BACKEND.md` | B | Derselbe Weg wie der Schnellstart, aber jeder Schritt sagt, warum er nötig ist und was im Hintergrund passiert. Etwa doppelt so lang. |
| `FUER_GRUENDER.md` | C | Keine Kommandozeile. Was QKERN für ein Produkt bedeutet, was man damit bauen lassen kann, was es kostet, wo die Daten liegen, was "Zertifizierung" hier heisst, welche Fragen man einem Entwickler stellen sollte. |
| `GLOSSAR.md` | alle | Rund 90 Begriffe, alphabetisch, je drei Zeilen (siehe unten). |

Jede der fünf Seiten endet mit einem Abschnitt "Ehrlich offen": was noch
fehlt, was nur lokal geht, was Docker braucht.

Bestehende Dateien:

- `docs/HANDBUCH.md` bleibt die Fassung für Fortgeschrittene und bekommt
  unter der Überschrift einen Verweis: "Neu hier? Beginne mit
  `docs/guide/de/WAS_IST_QKERN.md`."
- `docs/INDEX.md` bekommt ganz oben einen Block "Einstieg" mit den fünf
  Seiten.
- `docs/DOCS_MAINTENANCE.md` bekommt einen Abschnitt "Einstiegsdoku bei
  jedem Release prüfen" (Schritt 3 unten).

## Glossar

Jeder Eintrag hat genau drei Zeilen, als Liste unter der Überschrift des
Begriffs:

1. **Was es ist**, in Alltagssprache, ohne weiteren Fachbegriff, der nicht
   selbst im Glossar steht.
2. **Wo es in QKERN vorkommt**: Konsolen-Ansicht, Kommando oder Datei.
3. **Bei Supabase heisst es**: das Gegenstück, oder "kein Gegenstück".

Drei Sorten Begriffe, alle im selben Alphabet:

- **QKERN-eigene**: Freigabezentrale (Approval Center), Control Plane,
  Data Plane, Umgebung (dev, staging, production), Production Apply,
  Zertifizierung, Zertifizierungsstack, Evidenz, Memory Mode, Runtime Mode,
  Projekt-Key, Anon Key, Service Key, AI Bridge, MCP, Stufenplan, Modul,
  Q-Orbit.
- **Allgemeine Backend-Begriffe**: Backend, Frontend, API, REST, Endpunkt,
  HTTP-Methode, JSON, Datenbank, PostgreSQL, Tabelle, Zeile, Spalte,
  Schema, Primärschlüssel, Fremdschlüssel, Index, Migration, SQL, Trigger,
  Funktion (Datenbank), Policy, Row Level Security, Rolle, Erweiterung,
  Publikation, Auth, Session, JWT, Token, Refresh Token, OAuth, Provider,
  Passwort-Hash, Storage, Bucket, Objekt, Signierte URL, Realtime,
  WebSocket, Queue, Job, Worker, Cron, Webhook, Rate Limit, Umgebungsvariable,
  Docker, Container, Compose, Image, Volume, Port, TLS, Zertifikat, Backup,
  WAL, Point-in-time Recovery, Audit-Log, Mandant, Mutationstest, CLI, SDK,
  npm, Node.js, Open Source, Apache 2.0.
- **Supabase-Gegenstücke**: in Zeile 3 jedes Eintrags, dazu eigene Einträge
  für Begriffe, die es nur dort gibt und die Gruppe A suchen wird: Studio,
  Edge Functions, PostgREST, GoTrue, supabase-js, Anon Key, Service Role
  Key.

In den vier anderen Seiten verlinkt jeder Fachbegriff beim ersten Auftreten
auf seinen Glossareintrag (`GLOSSAR.md#begriff`). Die Website macht daraus
einen Link auf `/docs/glossar#begriff`.

## Website

Neue Route `app/docs/[[...slug]]/page.tsx`:

| Pfad | Datei |
| --- | --- |
| `/docs` | `WAS_IST_QKERN.md` |
| `/docs/schnellstart` | `SCHNELLSTART.md` |
| `/docs/erstes-backend` | `ERSTES_BACKEND.md` |
| `/docs/gruender` | `FUER_GRUENDER.md` |
| `/docs/glossar` | `GLOSSAR.md` |

Die Zuordnung Pfad zu Datei steht in `lib/docs/pages.ts`, zusammen mit
Titel und Reihenfolge; die Route, die Seitenleiste, der INDEX-Block und die
Vertragstests lesen sie von dort. Die Seiten werden beim Bauen statisch
erzeugt (`generateStaticParams`), zur Laufzeit wird keine Datei gelesen.

Renderer `lib/docs/markdown.ts`: `parseGuide(markdown): GuideDocument`
liefert einen Baum aus genau diesen Knoten: Überschrift (Ebene 1 bis 3, mit
Anker aus dem Text), Absatz, Fett, Kursiv, Inline-Code, Link, Liste,
nummerierte Liste, Codeblock mit Sprache, Tabelle, Zitatblock (für
Hinweise). Alles andere (HTML, Bilder, verschachtelte Listen, Fussnoten,
Überschriften ab Ebene 4) wirft einen Fehler mit Zeilennummer. Der Fehler
fällt im Vertragstest auf, nicht beim Leser. Die Komponente
`components/docs/guide-document.tsx` zeichnet den Baum; Codeblöcke bekommen
einen Kopieren-Knopf, Überschriften einen Anker.

Layout `app/docs/layout.tsx`: links eine Seitenleiste mit den fünf Seiten
und darunter den Überschriften der aktuellen Seite (Ebene 2), rechts der
Text in Lesebreite (etwa 68 Zeichen). Bis 760 px wird die Seitenleiste ein
Aufklappmenü über dem Text. Schrift, Farben, Dunkelmodus und Kopfzeile wie
die Landing-Page (`components/site-header.tsx`, `components/theme-toggle.tsx`,
`components/language-switcher.tsx`). Solange eine Sprache fehlt, zeigt die
Seite den deutschen Text mit einem Hinweis oben: "Übersetzung folgt."

Links:

- Konsole: der Eintrag "Dokumentation" unten in der Sidebar
  (`components/console/console-app.tsx`) zeigt auf `/docs` statt auf
  `/#developers`.
- Landing-Page: Kopfmenü und Fusszeile bekommen den Eintrag "Dokumentation"
  auf `/docs`, in allen vier Sprachen.

## Prüfung

Drei Vertragstests unter `tests/`:

- `docs-guide-contract.test.ts`: jede Datei aus `lib/docs/pages.ts`
  existiert und parst ohne Fehler. Jeder Link zeigt auf eine existierende
  Datei, einen existierenden Anker oder einen Glossareintrag. Jeder
  Glossareintrag hat genau drei Zeilen mit den drei Vorspännen. Jeder
  Glossar-Link aus den vier Seiten trifft einen Eintrag. Die
  Humanizer-Regel gilt auch hier: kein Gedankenstrich, keine Wörter aus
  einer festen Sperrliste ("nahtlos", "robust", "leistungsstark",
  "revolutionär", "tauchen wir ein", "es ist wichtig zu beachten",
  "in der heutigen Zeit"), kein Dreiklang aus Adjektiven in einer Zeile.
- `docs-quickstart-contract.test.ts`: zieht die Codeblöcke aus
  `SCHNELLSTART.md` und `ERSTES_BACKEND.md`. Jedes `npm run <name>` steht in
  `package.json`. Jede genannte Datei oder Compose-Datei liegt auf der
  Platte. Jedes `qkern <kommando>` ist in `cli/src/commands.ts`
  registriert. Jeder genannte Pfad der Data API existiert in
  `lib/openapi.ts`. Versionsnummern (Node, Paket) stehen nicht im Text,
  sondern als Platzhalter `{{node}}` und `{{version}}`, die der Renderer
  aus `package.json` füllt.
- `docs-founder-numbers-contract.test.ts`: die Zahlen, die
  `FUER_GRUENDER.md` nennt (Module, Zertifizierungsfälle, Sprachen), sind
  Platzhalter, die aus denselben Quellen kommen wie `STATUS.md` und die
  Landing-Page (`tests/status-numbers-contract.test.ts`,
  `tests/landing-numbers-contract.test.ts`).

Der Schnellstart wird vor dem Release einmal komplett durchlaufen: frischer
Ordner, Docker, Stoppuhr. Das Ergebnis kommt als Log
`docs/evidence/2026-09-25/quickstart-walkthrough.log` mit Manifest. Wo etwas
nicht klappt, wird der Text geändert, nicht die Erwartung. Dauert es länger
als fünfzehn Minuten, steht die gemessene Zeit im Text.

## Reihenfolge

Drei Schritte, jeder für sich ein Release:

1. **Texte und Website, Deutsch.** Fünf Markdown-Dateien, `lib/docs/`,
   Route `/docs`, drei Vertragstests, Links in Konsole und Landing-Page,
   HANDBUCH-Verweis, INDEX-Block, Schnellstart-Durchlauf mit Log.
2. **Übersetzungen.** Englisch, Französisch, Italienisch in
   `docs/guide/<sprache>/`. Der Vertragstest prüft, dass jede Sprache
   dieselben Dateien, dieselben Überschriften-Anker und dieselben
   Glossareinträge hat. Der Hinweis "Übersetzung folgt" verschwindet.
3. **Pflege.** Abschnitt in `docs/DOCS_MAINTENANCE.md`: bei jedem Release
   Schnellstart-Kommandos, Glossar-Neuzugänge, Zahlen der Gründerseite
   prüfen. Die fünf Dateien kommen in den Release-Doc-Sweep.

## Nicht dabei

Absichtlich weggelassen; wenn eines davon gebraucht wird, ist es ein eigener
Slice: Suche über die Doku, Kommentare, Versionsauswahl, PDF-Export, eigene
Inhalte pro Sprache, Bilder oder Bildschirmfotos im Text.
