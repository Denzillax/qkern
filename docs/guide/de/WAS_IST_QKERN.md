# Was ist QKERN

QKERN ist ein [Backend](GLOSSAR.md#backend), das du nicht selbst bauen musst. Eine App braucht fast immer dieselben Dinge im Hintergrund: eine [Datenbank](GLOSSAR.md#datenbank) für die Daten, ein Login für die Nutzer, einen Ort für Dateien, Live-Updates für alle, die gerade zuschauen, und Aufgaben, die im Hintergrund laufen. QKERN bringt diese Teile mit, fertig verdrahtet, und du bedienst sie über eine Web-Oberfläche, die [Konsole](GLOSSAR.md#konsole).

Es läuft dort, wo du es hinstellst: auf deinem Rechner in [Docker](GLOSSAR.md#docker), später bei einem Hoster deiner Wahl. QKERN ist [Open Source](GLOSSAR.md#open-source) unter [Apache 2.0](GLOSSAR.md#apache-2-0). Die Software kostet nichts; was kostet, sind Hosting und die Arbeit, die eine App braucht.

Was QKERN nicht ist: kein Website-Baukasten, kein fertiges Produkt für Endkunden und kein Hosting-Angebot. QKERN ist das Fundament, auf dem ein Entwickler eine App baut.

## Warum es QKERN gibt

Wer Supabase kennt, kennt die Idee: ein Postgres mit allem drum herum. QKERN geht denselben Weg mit einem Unterschied, der uns wichtig ist. Jeder Baustein wird gegen echte Dienste geprüft, nicht gegen Attrappen. Ein echtes [PostgreSQL](GLOSSAR.md#postgresql) 17, ein echter Objektspeicher, ein echter Mailserver, ein echter Identitätsanbieter. Die Prüfprotokolle liegen im Repository, mit Datum, Commit und Ergebnis, und die Zahlen auf der Startseite kommen aus genau diesen Protokollen.

Heute sind das {{postgresCases}} Fälle gegen PostgreSQL 17 und {{stackCount}} Prüfstände insgesamt. Wenn eine Zahl in dieser Doku steht, kommt sie aus einer Datei, nicht aus dem Gedächtnis.

## Die Bausteine

| Baustein | Was er tut | In der Konsole |
| --- | --- | --- |
| [Konsole](GLOSSAR.md#konsole) | Die Web-Oberfläche, in der du alles siehst und einstellst | Alles |
| [Organisation](GLOSSAR.md#organisation) | Dein Arbeitsbereich; alles gehört einer Organisation | Kopfzeile |
| [Projekt](GLOSSAR.md#projekt) | Eine App mit eigenen Daten, Nutzern und Schlüsseln | Projektwahl oben links |
| [Umgebung](GLOSSAR.md#umgebung) | development, staging, production; je eine eigene Datenbank | Umgebungswahl oben rechts |
| [Datenbank](GLOSSAR.md#datenbank) | PostgreSQL 17 mit Tabellen, Regeln und allem, was dazugehört | Datenbank, Table Editor, SQL Editor |
| [Data API](GLOSSAR.md#data-api) | Lesen und Schreiben über [REST](GLOSSAR.md#rest), mit den Rechten des Aufrufers | API |
| [Auth](GLOSSAR.md#auth) | Login für die Nutzer deiner App, mit Passwort, Anbietern und Mehrfaktor | Auth |
| [Storage](GLOSSAR.md#storage) | Dateien in [Buckets](GLOSSAR.md#bucket), privat, mit Virenprüfung | Storage |
| [Realtime](GLOSSAR.md#realtime) | Änderungen live an alle Zuschauer | Realtime |
| [Queues](GLOSSAR.md#queue) | Aufgaben, die ein [Worker](GLOSSAR.md#worker) später abarbeitet | Integrationen, Queues |
| [Cron](GLOSSAR.md#cron) und [Webhooks](GLOSSAR.md#webhook) | Aufgaben nach Zeitplan und Nachrichten an andere Dienste | Functions & Jobs |
| [Freigabezentrale](GLOSSAR.md#freigabezentrale) | Jede Änderung am Schema wird geprüft, bevor sie läuft | Freigabezentrale |
| [AI Bridge](GLOSSAR.md#ai-bridge) | Ein KI-Agent bereitet Änderungen vor, Menschen geben frei | AI Bridge |

## Wie die Teile zusammenhängen

Die Konsole spricht mit der [Control Plane](GLOSSAR.md#control-plane). Das ist der Teil von QKERN, der Organisationen, Projekte, Nutzer und Freigaben verwaltet. Jedes Projekt hat je Umgebung eine eigene Datenbank, die [Data Plane](GLOSSAR.md#data-plane). Dort liegen die Daten deiner App. Die Data API liest und schreibt in dieser Datenbank, und zwar mit den Rechten dessen, der anfragt: ein [Public Key](GLOSSAR.md#public-key) sieht nur, was die [Row Level Security](GLOSSAR.md#row-level-security) einem Anonymen erlaubt, ein angemeldeter Nutzer sieht seine Zeilen.

Eine Änderung am Aufbau der Datenbank, etwa eine neue Tabelle, geht nicht direkt durch. Sie wird ein [Change Set](GLOSSAR.md#change-set), landet in der Freigabezentrale, und erst nach der Freigabe führt QKERN sie aus. Für production braucht es dazu eine Signatur von aussen. Das ist absichtlich langsamer als ein direktes SQL, und es ist der Grund, warum eine Änderung nachvollziehbar bleibt.

## Drei Türen

- Ich kenne Supabase und will in einer Viertelstunde etwas sehen: [Schnellstart](SCHNELLSTART.md)
- Ich baue mein erstes Backend und will verstehen, was ich tue: [Erstes Backend](ERSTES_BACKEND.md)
- Ich bin kein Entwickler und will wissen, was das für mein Produkt heisst: [Für Gründer](FUER_GRUENDER.md)

Begriffe, die dir unterwegs begegnen, erklärt das [Glossar](GLOSSAR.md), je in drei Zeilen.

## Ehrlich offen

- Diese Doku gilt für QKERN {{version}}. QKERN ist ein Product MVP, kein fertiges Hosting-Angebot.
- Es gibt keinen Anbieter, bei dem du QKERN mit einem Klick bekommst. Du betreibst es selbst oder lässt es betreiben.
- Eine neue Tabelle legst du heute per SQL an, nicht über einen Assistenten in der Konsole.
- Die Bindung eines Projekts an seine Datenbank macht in Produktion ein Provisionierer. Lokal macht das ein kleines Skript, das der Schnellstart zeigt.
- Diese Seiten gibt es bisher auf Deutsch. Englisch, Französisch und Italienisch folgen.
