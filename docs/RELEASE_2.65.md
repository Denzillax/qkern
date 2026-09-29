# Release 2.65.0 – Nach Nutzer geordnet, ohne Vektortyp, in jedem Zustand

Drei Schnitte, wieder parallel, und diesmal ohne den roten Merge aus 2.64.
Zwei davon zahlen Schulden aus dem Release davor, der dritte schliesst den
vorletzten Platzhalter der Console mit einem Befund statt einer Funktion.

## Was neu ist

- Ansicht Auth, Zustimmungen: nach Nutzer geordnet, mit den ausgegebenen Token, und ein einzelnes Token lässt sich widerrufen.
- Ansicht Storage, Vektor-Buckets: die Seite liest bei jedem Öffnen aus dem Katalog, ob der Server einen Vektortyp hat, und sagt, was fehlt.
- Der Render-Vertrag fährt jede Ansicht auch im fertigen und im Fehlerzustand, in vier Sprachen, ohne neue Abhängigkeit.
- Sieben doppelt geschriebene Helfer der Console liegen an einer Stelle.
- PostgreSQL-Zertifizierung von 222 auf 224 Fälle, lokale Suite von 2301 auf 2309. Von 26 Platzhaltern ist einer übrig.

## Die Zustimmungen, vom Menschen aus

2.64 zeigte die Zustimmungen unter dem OAuth-Server, nach Client geordnet.
Die Frage eines Betreibers geht aber vom Menschen aus: Wer hat wem was
erlaubt, und welche Token laufen gerade in seinem Namen. Nach Client geordnet
ist sie nur zu beantworten, indem man alle Clients durchgeht.

Die neue Seite liest **dieselbe** Antwort derselben Route wie der
OAuth-Server. Eine zweite Route für dieselben Zeilen wäre eine zweite Stelle,
an der eine Zustimmung anders aussehen könnte.

Der Widerruf eines Tokens ist, anders als der einer Zustimmung, **wirklich ein
Löschen**. Ein Token gilt, weil eine Zeile existiert, also braucht es keine
Spalte `revoked_at` und keine zusätzliche Bedingung im heissen Weg. Das
`DELETE`-Recht liegt seit Migration 0063 bei `qkern_auth`, eine neue Migration
gibt es nicht. Die Zustimmung bleibt gültig, die Anwendung darf sich ein neues
Token holen, und der verbrauchte Code gibt keines mehr her.

**Was die Seite nicht ist**: die Seite des Nutzers. Ein Nutzer sieht seine
eigenen Erlaubnisse weiterhin nirgends, denn das wäre eine Seite hinter seiner
eigenen Anmeldung im Browser. Der Satz steht auf der Seite.

## Vektor-Buckets: der Befund ist die Seite

`postgres:17-alpine` bringt 59 Erweiterungen mit, `vector` ist nicht darunter,
und `CREATE EXTENSION vector` endet mit `extension "vector" is not available`.
Keine Migration, keine Route und kein Dienst von QKERN kennt eine Einbettung.

Die Seite schreibt das nicht fest hin. Sie liest bei jedem Öffnen
`/schema/extensions`, dieselbe Route wie unter Datenbank, Erweiterungen, und
kennt drei Urteile: kein Vektortyp, verfügbar aber nicht angelegt, angelegt.
Auf dem Server, den es heute gibt, steht das erste. Darunter der nächste
Verwandte, `cube`, der bei 100 Dimensionen fest aufhört, und die vier
Schritte, die eine echte Umsetzung bräuchte, in der Reihenfolge, in der sie
hängen.

Zwei Sätze des ersten Entwurfs waren falsch und sind es nicht mehr. Die Grenze
von `cube` stand auf 101; die Sonde am Image zeigt, dass 100 geht und 101 mit
`array is too long` endet. Und "Alpine hat kein Paket" stimmte nicht: Alpine
3.24 hat `postgresql-pgvector` 0.8.1, aber gebaut gegen Alpines PostgreSQL 18,
und der Server im Image ist ein selbst gebautes PostgreSQL 17. Der Schluss
bleibt, die Begründung ist jetzt die richtige.

## Der Render-Vertrag sieht mehr

2.63 hat ihn gebaut, 2.64 hat ihm alle Ansichten zugänglich gemacht, und
beide Male stand in der Note, dass er nur den ersten Durchlauf sieht: Effekte
laufen nicht, also blieben der fertige Zustand, der Fehlerzustand und der leere
Zustand ungesehen.

Der Weg dahin ohne Testbibliothek ist eine optionale Requisite `initialState`
am `useState` der Ansicht. jsdom plus Testrenderer wären zwei neue
Abhängigkeiten plus ein gefälschtes `fetch` je Ansicht, und die Naht prüft
genau das, was sie behauptet: So sieht dieser Zustand aus. 71 von 91 Ansichten
haben die Naht; die ohne sagen im Quelltext, warum. Der Vertrag fährt `ready`
und `error` in de, en, fr und it, verlangt lesbaren Text, meldet einen
gesetzten Zustand, der wie der Ladezustand aussieht, und sucht auf Englisch
nach deutschen Resten.

Gefunden hat er zwei Texte, die an `t()` vorbei geschrieben waren, im
Leerzustand der Functions und in der Fehlermeldung der Usage-Ansicht.

Sieben Doppelungen sind zusammengelegt: `EmptyState`, `ErrorState`,
`CheckIcon`, das Stundenformat, die Bytes, die Position und das Eimer-Moment.
Vier sind mit einem Satz im Quelltext stehen geblieben, weil sie nur gleich
aussehen: dezimale Bytes mit Nachkommastellen neben binären ohne, ein
Betrag mit Regex-Prüfung neben einem ohne, und die Beraterregeln, die
absichtlich nicht aneinander hängen.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 224/224, exit 0 | `docs/evidence/2026-09-29/welle17-run1.manifest.json` |
| PostgreSQL 17, 224/224, exit 0 | `docs/evidence/2026-09-29/welle17-run2.manifest.json` |
| Mailpit und Dex, 7/7, exit 0 | `docs/evidence/2026-09-29/welle17-auth.manifest.json` |
| Mutation der Widerruf trifft jedes andere Token, exit 1 | `docs/evidence/2026-09-29/welle17-mutation-tokenrevoke.manifest.json` |
| Mutation die Grenze von cube steht auf 99, exit 1 | `docs/evidence/2026-09-29/welle17-mutation-vectors.manifest.json` |
| Mutation deutscher Text im Fehlerzustand, exit 1 | `docs/evidence/2026-09-29/welle17-mutation-errorstate.manifest.json` |
| Vitest lokal 2309/2309, exit 0 | `docs/evidence/2026-09-29/welle17-local-run1.manifest.json` |
| Vitest lokal 2309/2309, exit 0 | `docs/evidence/2026-09-29/welle17-local-run2.manifest.json` |

## Nachtrag zum Verfahren

**Zwei Schnitte gaben ihrem Fall dieselbe Nummer.** Beide Agenten zählten von
`(2.92)` weiter und nannten ihren Fall `(2.93)`, und beide setzten die
Fallzahl der Control Plane von 59 auf 60. Jeder für sich war richtig. Der
Vektor-Fall behält die Nummer, der Token-Widerruf heisst `(2.94)`, und die
Zahl steht auf 61. Der Vertrag `status-module-counts-contract` hätte die 60
nach dem zweiten Merge fallen lassen; aufgefallen ist es schon am Konflikt.

**Drei Agenten sind am Wochenlimit gestorben und drei neue haben ihre Arbeit
zu Ende geführt.** Der ungesicherte Stand lag in den Worktrees. Jeder
Nachfolger hat ihn zuerst gelesen, und jeder hat etwas gefunden: eine
Konstante auf 101, eine falsche Begründung zu Alpine, einen Text, der eine
Liste versprach, die es dort nicht mehr gab. Der Konsolen-Stand war fehlerfrei,
nur nie gefahren.

**Die Leiter zu Supabase stand 73 Releases still.** `docs/PARITAET.md` sagt
von sich, sie werde bei jedem Release nachgeführt, und stand auf `1.91.0`.
Nachgeführt, und ein Vertrag vergleicht ihren Kopf jetzt mit der Version in
`package.json`. Die Mutationsprobe fiel mit `Expected 2.64.0, Received 1.91.0`.

## Ehrlich offen

- **Im Browser nicht gesehen**, weiterhin. Der Vertrag sieht jetzt `ready` und `error`, aber `ready` ohne Daten ist der leere Zustand; eine Tabelle mit echten Zeilen sieht er nicht.
- **Ein Nutzer sieht seine eigenen Zustimmungen nirgends.** Die neue Seite gehört dem Betreiber.
- **Die Zustände "verfügbar" und "angelegt" der Vektor-Seite gibt es auf keinem Server, den es hier gibt.** Sie sind nur über die reine Funktion geprüft.
- **Ein Platzhalter bleibt**: Analytics-Buckets.
- **Der Fall `(2.52)` hat kein eigenes Zeitbudget** und fiel einem Agenten unter Last einmal mit der 5-Sekunden-Vorgabe. Zweimal daneben nicht. Steht im Handoff, nicht angefasst.
- **`console-format.ts` hat keinen eigenen Unit-Test**; die Helfer laufen nur über die Ansichten mit.
