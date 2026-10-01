# Release 2.70.0 – Was der Katalog weiss, und was niemand nachgesehen hat

Drei Schnitte, und der wertvollste hat nichts gebaut. Er hat nachgesehen,
und dabei eine Annahme widerlegt, die an fünf Stellen im Baum stand.

## Was neu ist

- Upsert an REST und GraphQL, über einen Konfliktschlüssel, den der Katalog wirklich führt.
- Der Compute-Prozess findet seine Bereiche selbst, statt auf eine Umgebungsvariable zu warten.
- Inhaltslogs gehen an die Log-Drains, als sechste Quelle.
- Die Seite zum Postgres-Zustand sagt jetzt, was ein Serverlog wäre und warum QKERN keinen hat.
- PostgreSQL-Zertifizierung von 236 auf 241 Fälle, Functions von 32 auf 33, lokale Suite von 2434 auf 2468.

## Upsert, und die Stelle, an der er kippt

`INSERT ... ON CONFLICT (…) DO UPDATE` an beiden Flächen. Der Konfliktschlüssel
kommt **nicht** vom Aufrufer: `pg_index` liefert die eindeutigen Schlüssel, und
durchgelassen wird nur, worauf PostgreSQL sich wirklich berufen kann, also
`indisunique`, `indisvalid`, `indislive`, `indimmediate`, ohne Bedingung und
ohne Ausdruck, geschnitten bei `indnkeyatts`, damit `INCLUDE`-Spalten nicht
mitzählen. Verglichen wird als Menge, weil PostgreSQL den Index auch als Menge
ableitet, und die Spaltennamen im erzeugten SQL stammen aus dem Katalog. Kein
Treffer heisst Ablehnung, bevor eine Zeile geschrieben ist.

Die Zusage, auf die es ankommt: **Ein Upsert darf keine Zeile anfassen, die der
Aufrufer per `UPDATE` nicht hätte ändern dürfen.** Genau hier gehen solche
Umsetzungen schief, weil `ON CONFLICT DO UPDATE` die `USING`-Bedingung der
Policy anders trifft als ein gewöhnliches Ändern. Der Fall stellt beides
nebeneinander: Der Upsert auf die Zeile eines Nachbarn wird abgewiesen, die
fremde Zeile kommt unverändert zurück, und die Mutation davor im selben Stapel
wirkt nicht; derselbe Wunsch als gewöhnliches Ändern trifft dagegen null Zeilen
und schweigt.

**Nicht gebaut**: Beziehungen in GraphQL-Mutationen und Joins über zwei Ebenen.
Jeder dieser Schritte braucht eigene Läufe mit eigenen Proben, und halb gebaut
wäre schlechter als nicht gebaut.

## Bereiche finden statt nachtragen

Der Compute-Prozess bekam seine Bereichsmenge aus einer Umgebungsvariablen, die
ein Betreiber von Hand setzt. Wer sie nach einem neuen Projekt vergisst, merkt
nichts: Das Projekt wird einfach nicht bearbeitet. Jetzt liest der Prozess die
Umgebungen seiner Organisation aus der Control Plane, ohne neues Recht, und
wer beides angibt, wird abgewiesen.

**Die Grenze liegt anders, als der Auftrag annahm, und der Fall hat sie
gemessen.** Der erste Entwurf wollte zeigen, dass die Laufzeitrolle eine fremde
Organisation nicht lesen kann. Der Lauf hat das widerlegt: Die Policy hängt an
einer Einstellung, die der Prozess selbst setzt, also liest er, wessen Kennung
er nennt. Was wirklich fehlt, ist die **Aufzählung**. Es gibt keine Abfrage,
mit der dieser Prozess erfährt, welche Organisationen überhaupt existieren,
und darum ist eine übergreifende Entdeckung unmöglich, ohne eine Rolle zu
bauen, die die Zeilensicherheit umgeht. Es ist keine gebaut worden; der Befund
steht im Modulkopf, im Fall, im Handbuch und im Handoff, und der falsche Satz
ist auch in den alten Texten berichtigt.

Findet die Entdeckung mehr als 32 Umgebungen, startet der Prozess nicht. Die
ersten 32 zu nehmen wäre ein Prozess, der einen Teil bedient und von aussen
vollständig aussieht. Eine Umgebung ohne Bereich bekommt keine Schleife, und
eine Zählung im Takt meldet, wie viele unbedient sind.

## Was ein Serverlog wäre

Die Ansicht Postgres-Zustand sagte seit `2.57.0`, sie zeige keinen Serverlog.
Der Schnitt sollte prüfen, ob sich das ändern lässt, und hat zuerst einen
Fehler gefunden statt einer Lücke.

**An fünf Stellen im Baum stand derselbe Satz**: Das Serverlog liege in Dateien
neben dem Datenverzeichnis, und QKERN habe darauf keinen Zugriff. Der zweite
Teil stimmt. Der erste war eine Annahme, die nie jemand am Server nachgesehen
hat, und in jedem Stack von QKERN ist sie falsch: Der Sammler ist aus, die
Datei entsteht gar nicht, das Log geht auf stderr.

Gemessen statt vermutet:

- `pg_current_logfile()` ist NULL **auch für den Superuser**, `pg_ls_logdir()` scheitert.
- `pg_read_server_files` öffnet `pg_read_file` gar nicht. Es öffnet die Pfadgrenze von `COPY FROM`.
- `adminpack` hat PostgreSQL 17 entfernt, und der Stack fährt 17.
- Supabase löst es mit einem Sammler daneben, nicht mit SQL-Zugriff.
- Der Weg über `csvlog` plus `file_fdw` ginge im eigenen Stack, aber der Dateiname wechselt mit jeder Rotation, die Datei gilt für den ganzen Cluster, und eine mandantensaubere Sicht liesse gerade die Postmaster-Zeilen weg, um die es geht. Bei einem Anbieter geht er gar nicht.

Also kein Recht ausgeweitet. Die Seite sagt jetzt, was ein Serverlog enthielte,
warum QKERN ihn nicht hat und welche vier Schritte fehlen.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 241/241, exit 0 | `docs/evidence/2026-10-01/welle22-run1.manifest.json` |
| PostgreSQL 17, 241/241, exit 0 | `docs/evidence/2026-10-01/welle22-run2.manifest.json` |
| Functions gegen Docker plus PostgreSQL, 33/33, exit 0 | `docs/evidence/2026-10-01/welle22-functions.manifest.json` |
| Mailpit und Dex, 11/11, exit 0 | `docs/evidence/2026-10-01/welle22-auth.manifest.json` |
| Realtime unter Production gegen TLS-PostgreSQL, 17/17, exit 0 | `docs/evidence/2026-10-01/welle22-realtime.manifest.json` |
| versitygw und ClamAV, 11/11, exit 0 | `docs/evidence/2026-10-01/welle22-storage.manifest.json` |
| Mutation der Konfliktschlüssel kommt vom Aufrufer, exit 1 | `docs/evidence/2026-10-01/welle22-mutation-conflictkey.manifest.json` |
| Mutation gelöschte Projekte bekommen wieder Bereiche, exit 1 | `docs/evidence/2026-10-01/welle22-mutation-scopejoin.manifest.json` |
| Mutation das Urteil über den Serverlog steht fest, exit 1 | `docs/evidence/2026-10-01/welle22-mutation-serverlog.manifest.json` |
| Vitest lokal 2468/2468, exit 0 | `docs/evidence/2026-10-01/welle22-local-run1.manifest.json` |
| Vitest lokal 2468/2468, exit 0 | `docs/evidence/2026-10-01/welle22-local-run2.manifest.json` |

Jede der drei Proben liess genau ihren Fall fallen und sonst keinen. Die Läufe
der drei Agenten auf ihren Zweigen liegen daneben.

## Nachtrag zum Verfahren

**Ein Vertrag, den ich in `2.67.0` geschrieben habe, hatte eine Lücke, und ein
Agent hat sie gefunden.** Der Versionsvertrag ging Verzeichnisse ab und las
ausgerechnet `STATUS.md` nicht, also die Datei, die sich selbst „Teil der
Definition of Done" nennt. Dort standen zwei Verweise auf eine Ausgabe
`2.98.0`, die es nie gab. Der Vertrag liest jetzt auch `STATUS.md`, `AGENTS.md`
und `README.md`, und die Lücke ist mit einer eingesetzten Fehlzahl nachgemessen.

**Zwei Zusagen der Console waren falsch.** Ein Log-Drain trage nie die Ausgabe
eines Containers, und QKERN speichere sie gar nicht. Der zweite Satz stimmte
seit `2.67.0` nicht mehr.

**Und wieder prüfte ein Vertrag die Datei statt die Aussage.** Er stand auf
`toContain("nie die Ausgabe eines Containers")` und blieb grün, obwohl der Satz
nur noch in einem Kommentar über seine eigene Geschichte stand. Dieselbe Klasse
wie die Erwartung in `(2.101)` und wie mein eigener erster Versuch beim
404-Vertrag.

**Der Produktionsbuild ist einmal an einer halb geschriebenen Datei gefallen.**
`.next/dev/types/routes.d.ts` endete mitten im Wort, weil der Dev-Server beim
Schreiben starb. Das ist erzeugtes Bauwerk; weggeräumt, neu gebaut, grün.

## Ehrlich offen

- **Die Entdeckung läuft beim Start.** Eine später entstandene Umgebung wird gemeldet und erst nach einem Neustart bedient. Über 32 Umgebungen startet der Prozess nicht.
- **Übergreifende Entdeckung bleibt unmöglich**, ohne eine Rolle, die die Zeilensicherheit umgeht.
- **Wer `function_output` an einen Drain hängt, schickt die Ausgabe seiner Container ungestrichen hinaus.** QKERN kennt keinen Geheimniswert und kann keinen halten. Kein echter Empfänger hat eine solche Ladung gesehen; der Fall endet an der Outbox.
- **MCP und das SDK können nicht upserten.** Beziehungen in GraphQL-Mutationen und Joins über zwei Ebenen fehlen.
- **Der Sammler für ein Serverlog ist nicht gebaut**, und niemand hat entschieden, wem eine Postmaster-Zeile gehört.
- **Die Console ist weiterhin ungesehen**, weil sie hinter der Anmeldung liegt.
