# Release 2.61.0 – Ein Ablauf, eine Sprache, drei ehrliche Antworten

Fünf Platzhalter weniger. Drei davon werden zu Seiten, die sagen, dass es das
Versprochene nicht gibt, und dann zeigen, was es stattdessen gibt.

## Was neu ist

- Ansicht Authentication, OAuth-Server: QKERN gibt eigene Token aus, über genau einen Ablauf.
- Ansicht Integrationen, GraphQL: lesend über dem Schema, mit harten Grenzen und ohne fremde Bibliothek.
- Ansichten Function-Logs, API-Gateway und Pooler: drei Fragen, drei Antworten, keine erfundene Zahl.
- PostgreSQL-Zertifizierung von 214 auf 217 Fälle, lokale Suite von 2213 auf 2247.

## Die Entscheidungen

- **Genau ein OAuth-Ablauf: Authorization Code mit PKCE.** Kein impliziter, kein Passwort-, kein Client-Credentials-Ablauf. Der Code ist einmalig, 60 Sekunden gültig, an Client, Ziel, Prüfsumme und Nutzer gebunden, und wird in einer Anweisung gefunden und verbraucht, bevor irgendetwas anderes geprüft wird. Eine zweite Tür hält dagegen: Die Kennung des Codes ist in der Token-Tabelle eindeutig.
- **Ein OAuth-Token bekommt immer die Rolle `authenticated`, und die Grenze steht als Abwesenheit.** Es gibt weder am Client noch am Token eine Spalte für eine Rolle. Sie wird beim Prüfen gesetzt statt gelesen.
- **QKERN schickt selbst keinen 302.** Die Zustimmung ist ein POST und antwortet mit JSON; die Anwendung baut ihre Adresse selbst. Dieselbe Grenze wie bei den Rücksprungzielen aus `2.54.0`.
- **GraphQL lässt mehr weg als es kann**, und jede Auslassung hat ihren eigenen Ablehnungsgrund: Mutationen, Subscriptions, Fragmente, Variablen, Direktiven, Introspektion, Beziehungen, Views, Aggregate. Ohne Fragmente gibt es auch keine Fragment-Rekursion zu begrenzen.
- **Die GraphQL-Grenzen greifen, bevor eine Verbindung aufgeht**: Tiefe zwei, 60 Felder mit jedem Alias einzeln gezählt, fünf Tabellen, 200 Zeilen. Die Lesungen laufen nacheinander, damit eine Anfrage nicht fünf Verbindungen aus dem Projektpool nimmt.

## Was die Prüfung der drei Log-Seiten ergeben hat

- **Die Ausgabe einer Function fehlt nicht "noch".** In der Sandbox ist der Standardkanal gar kein Ausgabekanal, sondern die JSON-Leitung zwischen Host und Container. Der Fehlerkanal wird nur gezählt und bei 8 KiB gekappt, und der Container läuft mit `--rm`. Es gibt also auch kein späteres Nachlesen. Gefunden hat der Schnitt dafür die Einsatzhistorie aus Migration `0042`, die bisher keine Ansicht gelesen hat.
- **Beim API-Gateway fehlt nicht das Log, sondern der Rand.** Es gibt keine Middleware.
- **Beim Pooler gibt es keinen Pooler.** Die vermutete Auslastung ist nicht erreichbar: Die Zähler des Treibers liegen hinter der Poolschnittstelle, und eine Warteschlange wäre geschätzt.

**Ein Fehler in bestehendem Text ist dabei aufgefallen.** Die Data-API-Seite
nannte sechs Module, die unter den API-Anfragen mitzählen. Nachgezählt an den
Aufrufstellen sind es drei. Der Satz war in die beruhigende Richtung falsch und
ist berichtigt. Der Vertrag prüft seither nicht, dass die Sätze dastehen,
sondern dass sie stimmen: Er liest die Migration, die Sandbox, die
Compose-Dateien und alle Aufrufstellen der Zählung.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 217/217, exit 0 | `docs/evidence/2026-09-27/welle13-run1.manifest.json` |
| PostgreSQL 17, 217/217, exit 0 | `docs/evidence/2026-09-27/welle13-run2.manifest.json` |
| Mailpit und Dex, 7/7, exit 0 | `docs/evidence/2026-09-27/welle13-auth.manifest.json` |
| Mutation verbrauchter Code kommt durch, exit 1 | `docs/evidence/2026-09-27/welle13-mutation-oauth.manifest.json` |
| Mutation Aliasse zählen nicht mit, exit 1 | `docs/evidence/2026-09-27/welle13-mutation-graphql.manifest.json` |
| Mutation ein viertes zählendes Modul, exit 1 | `docs/evidence/2026-09-27/welle13-mutation-honestlogs.manifest.json` |
| Vitest lokal 2247/2247, exit 0 | `docs/evidence/2026-09-27/welle13-local-run1.manifest.json` |
| Vitest lokal 2247/2247, exit 0 | `docs/evidence/2026-09-27/welle13-local-run2.manifest.json` |

## Zwei Nachträge zum Verfahren

**Eine Mutationsprobe hat einen zweiten Fall mitgerissen, und der zweite lag
falsch.** Der GraphQL-Fall verglich die Werte der ersten Zeile mit einer festen
Zahl und behauptete damit eine Ordnung, die die Abfrage nicht verlangt. In
diesem Lauf kam die andere Zeile zuerst. Die Aussage des Falls ist ohnehin eine
andere: Alle Aliasse einer Zeile tragen denselben Wert, und über beide Zeilen
kommen genau die zwei angelegten Mengen heraus. Genau das steht jetzt da, ohne
Annahme über die Reihenfolge, und die Probe ist danach wiederholt worden, bis
nur noch der gemeinte Fall fiel.

**Ein Fall lag unfertig in einem Arbeitsbaum und ist übernommen worden.** Er
schliesst die Lücke, die die Ergänzung an `(2.63)` offen lässt: Er hält den
Sammler mit einem Signal an, schreibt eine weitere Zeile und startet ihn neu.
Er heisst jetzt `(2.85)`, weil der Entwurf die Nummer eines bestehenden Falls
trug. Die Eingriffe des Entwurfs in die Abschnitte früherer Releases sind nicht
übernommen: Was später entstand, gehört in die Notiz des laufenden Releases.

## Ehrlich offen

- **Keine Zustimmungsseite von QKERN.** Die Anwendung zeigt dem Nutzer, was er erlaubt; QKERN kann nicht beweisen, dass er eine Liste gesehen hat. Das ist die grösste bewusste Verlagerung dieses Schnitts.
- **Kein Aufräumer für abgelaufene Codes und Token.** Sie gelten nicht mehr, die Zeilen bleiben stehen.
- **Widerruf nur je Client**, nicht je Zustimmung eines Nutzers.
- **Views bleiben in GraphQL aussen vor.** Ein View hat keinen Primärschlüssel, also bräuchte sein Feld ein erzwungenes `orderBy` und dürfte keinen Cursor führen.
- **Eine Tabelle ohne Zeilensicherheit wird in GraphQL als unbekannt abgewiesen**, nicht mit eigenem Grund. Der Unterschied verriete ihre Existenz.
- **Im Browser nicht gesehen.** Die fünf neuen Ansichten sind angemeldet nie betrachtet worden.
