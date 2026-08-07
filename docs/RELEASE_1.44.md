# Release 1.44.0 — Kein einziger Prozess startete

## Der Fund

Release 1.43 liess offen, dass der Queue-Wirt als Objekt lief und
`npm run worker:queues` selbst keinen Lauf hatte. Der Fall, der das nachholen
sollte, war rot — und nicht wegen des Tests.

**Keiner der sieben Worker konnte starten.**

```
ERROR: Top-level await is currently not supported with the "cjs" output format
```

`package.json` hat kein `"type": "module"`. tsx übersetzt jede `.ts` deshalb als
CommonJS, und jeder Worker benutzt Top-Level-await. Der Prozess brach ab, bevor
eine Zeile eigenen Codes lief.

| Prozess | Skript |
| --- | --- |
| Realtime | `npm run realtime` |
| Compute (Cron und Webhooks) | `npm run worker:compute` |
| Migrationen | `npm run worker:migrations` |
| Apply-Publisher | `npm run publisher:apply` |
| Incident-Publisher | `npm run publisher:incidents` |
| Provisioner | `npm run provisioner:projects` |
| Queue-Wirt | `npm run worker:queues` |

Sieben Prozesse, jeder in einer eigenen Scheibe gebaut, jeder dokumentiert,
mehrere davon ausdrücklich die Antwort auf ein früher gefundenes „ruft niemand" —
und kein einziger lief je.

## Warum das durchkam

Zertifiziert war jedes Mal, **was ein Prozess aufruft**, nie sein Start.

Der Erreichbarkeitsvertrag aus 1.42 prüft, ob ein Modul von einem Einstieg aus
importiert wird — und das war es. Die Kettenzertifizierung aus 1.43 baute den
Wirt als Objekt. Beide Release Notes behaupteten `npm run worker:queues`, und
beide Behauptungen waren falsch.

## Die Behebung

Die Endung entscheidet: `.mts` ist für tsx ein ES-Modul, `.ts` ohne
`"type": "module"` nicht. Alle sieben heissen jetzt `.mts`. Mitgezogen sind
`package.json`, `lib/server/operations/runtime-deployment.ts` — dort steht die
Zuordnung Komponente zu Einstiegsdatei für die Hintergrund-Deployments — und die
Vertragstests.

`"type": "module"` wäre die andere Möglichkeit gewesen. Sie hätte Next.js,
sämtliche Skripte und jede CJS-Interop-Stelle betroffen; die Endung betrifft
sieben Dateien.

## Der Vertrag

`tests/worker-boot-contract.test.ts` startet jede Datei in `workers/` wirklich
und prüft, dass sie **ihre eigene** Konfigurationsgrenze erreicht. Ob sie danach
ohne Datenbank weiterläuft, ist nicht die Frage; dass sie dorthin gelangt, war
es.

Dazu kommt im Functions-Stack ein Fall, der den ausgelieferten Prozess startet —
nicht nachgebaut, sondern die Datei hinter `npm run worker:queues` — und
nachweist, dass er eine eingereihte Nachricht durch einen echten Container
verarbeitet. Der Prozess meldet dabei die Zahl seiner Bindungen und sonst nichts
aus der Konfiguration.

## Mutationsproben

| Mutation | Ergebnis |
| --- | --- |
| Eine Worker-Datei wieder als `.ts` | Der Boot-Vertrag benennt sie namentlich |
| Der Wirt startet, ruft aber seine Schleife nicht auf | 25 von 26 — genau der Prozess-Fall; die beiden Objekt-Fälle bleiben grün |

Die zweite Probe trennt „startet" von „arbeitet". Beides ist einzeln getragen.

## Belege

| Lauf | Manifest |
| --- | --- |
| Functions 26/26, exit 0 | `docs/evidence/2026-08-06/queue-process-run1.manifest.json` |
| Functions 26/26, exit 0 | `docs/evidence/2026-08-06/queue-process-run2.manifest.json` |
| Mutation Prozessschleife 25/26 | `docs/evidence/2026-08-06/queue-process-mutation.manifest.json` |
| PostgreSQL 117/117, exit 0 | `docs/evidence/2026-08-06/worker-boot-run1.manifest.json` |
| PostgreSQL 117/117, exit 0 | `docs/evidence/2026-08-06/worker-boot-run2.manifest.json` |

Lokal: 1009 bestanden, 0 fehlgeschlagen.

## Nebenbefund, nicht behoben

`npm run verify:dx:full` bricht auf Windows mit Node 24 ab, bevor es irgendetwas
prüft: `scripts/verify-package-tarballs.mjs` ruft `npm.cmd` über `execFileSync`,
und das lehnt Node seit 20.12 auf Windows ohne `shell: true` ab
(`spawnSync npm.cmd EINVAL`).

Das reproduziert sich auf dem unveränderten Stand von `1.43.0` und hängt nicht
an dieser Änderung. STATUS.md nennt die Tarball-Prüfung deshalb ab sofort
ausdrücklich als hier **nicht** belegt, statt sie weiter als grün zu führen.

## Ehrlich offen

- **Der Boot-Vertrag prüft nur bis zur Konfigurationsgrenze.** Dass ein Prozess
  mit gültiger Konfiguration seine Arbeit tut, ist ausschliesslich für den
  Queue-Wirt belegt. Die anderen sechs haben weiterhin keinen Lauf, der sie
  arbeiten sieht.
- **Wie lange das so war, ist nicht rekonstruiert.** Der erste Worker stammt aus
  einer frühen Stufe; wann Top-Level-await hinzukam, hat niemand nachgezeichnet.
  Für die Aussage dieses Release ist es unerheblich — für die Frage, was die
  bisherigen Release Notes wert waren, nicht.
- **Der Prozess wird im Test hart beendet.** Ein geordnetes Herunterfahren über
  SIGTERM ist auf dieser Plattform nicht geprüft; was der Wirt beim Stoppen
  zurücklässt, ist unbelegt.
- **Die Tarball-Prüfung bleibt offen** und ist als eigene Aufgabe abgelegt.
