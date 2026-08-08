# Release 1.45.0 — Wer ruft das eigentlich? Teil zwei

## Was 1.44 offen liess

> **Der Boot-Vertrag prüft nur bis zur Konfigurationsgrenze.** Dass ein Prozess
> mit gültiger Konfiguration seine Arbeit tut, ist ausschliesslich für den
> Queue-Wirt belegt. Die anderen sechs haben weiterhin keinen Lauf, der sie
> arbeiten sieht.

Dieses Release holt den grössten davon nach: den Compute-Prozess.

## Der Nachweis

Gestartet wird nichts nachgebaut, sondern die Datei hinter
`npm run worker:compute`. Gemessen wird die Wirkung in der Datenbank: Ein
fälliges Cron-Vorkommen wird zu einer Nachricht in der Projekt-Queue, ohne dass
der Test einen Scheduler anfasst.

Der Prozess meldet dabei die Zahl seiner Scopes und sonst nichts aus der
Konfiguration — weder Passwort noch Projekt-Id.

## Zwei Umwege auf dem Weg dorthin

**Der erste Anlauf war rot, und der Fehler lag im Testaufbau.** Die Definition
trug `* * * * *`; unterstützt sind `*/N * * * *` und `M H * * *`.

Sichtbar wurde das nur, weil ich `onError: () => undefined` in der Komposition
vorübergehend gegen eine Ausgabe getauscht habe. Der Prozess meldete
„serving 1 scope(s)" und schwieg danach, während seine Schleife jede Sekunde an
derselben Stelle scheiterte. Kein Produktfehler — der Definitionsdienst prüft
den Ausdruck beim Anlegen, und nur ein direkter INSERT umgeht das —, aber ein
Befund über Beobachtbarkeit. Er steht unten.

**Der zweite betraf den Zertifizierungsstack selbst.** Ein Lauf zeigte Fehler in
Dateien unter `.claude/worktrees/…`: Der Stack kopiert das Arbeitsverzeichnis
per `tar` und schliesst `node_modules`, `.next`, `.git`, `coverage` und
`docs/evidence` aus — `.claude` nicht. Ein fremdes Verzeichnis im Baum änderte
damit, **was** zertifiziert wird, und die Zahl im Manifest hätte es nicht
verraten. Alle fünf betroffenen Compose-Stacks schliessen `.claude` jetzt aus;
der Functions-Stack ruft seine Dateien namentlich auf und ist nicht betroffen.

Dieselbe Lücke bestand ein zweites Mal: `npm test` meldete kurz darauf 304
Dateien und 2018 Fälle statt 152 und 1009 — exakt das Doppelte. Vitest globbte
den Worktree mit. `vitest.config.ts` schliesst `.claude` jetzt ebenfalls aus.

Wer nur die Zahl gelesen hätte, hätte einen Sprung nach oben gesehen und sich
gefreut.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Die Cron-Schleife wirft vor jedem `scheduler.run` | 117 von 118 — genau der Prozess-Fall; die zwölf übrigen Cron-Fälle bleiben grün |

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 118/118, exit 0 | `docs/evidence/2026-08-06/compute-process-run1.manifest.json` |
| PostgreSQL 118/118, exit 0 | `docs/evidence/2026-08-06/compute-process-run2.manifest.json` |
| Mutation Cron-Schleife 117/118 | `docs/evidence/2026-08-06/compute-process-mutation.manifest.json` |

Lokal: 1009 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Fünf der sieben Prozesse haben weiterhin keinen Lauf, der sie arbeiten
  sieht**: Realtime, Migrationen, Apply-Publisher, Incident-Publisher und
  Provisioner. Sie erreichen ihre Konfigurationsgrenze, mehr ist nicht belegt.
- **Nur der Cron-Zweig des Compute-Prozesses ist belegt.** Die Webhook-Zustellung
  läuft in diesem Fall ausgeschaltet, weil sie einen Signaturschlüssel verlangt.
- **Eine Cron-Schleife, die jede Sekunde scheitert, sagt es niemandem.** Die
  Redaktion ist richtig — eine Datenbankmeldung gehört nicht ins Log —, aber
  „diese Schleife kommt seit N Versuchen nicht durch" wäre weder ein Geheimnis
  noch eine Datenbankmeldung. Das ist eine eigene Scheibe und keine
  Nebenbei-Änderung an einem Sicherheitsvertrag.
- **Der `.claude`-Ausschluss ist eine Liste, keine Regel.** Das nächste
  Verzeichnis, das nicht dazugehört, fällt genauso wenig auf. Ein Stack, der nur
  kopiert, was er braucht, wäre die stärkere Lösung.
- **Wie viele frühere Läufe kontaminiert waren, ist nicht rekonstruiert.** Der
  Worktree entstand in dieser Sitzung; ältere Manifeste nennen Zahlen, die zu
  ihren Läufen passen, aber niemand hat geprüft, ob je ein fremdes Verzeichnis
  im Baum lag.
