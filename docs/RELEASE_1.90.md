# Release 1.90.0 — Platz für jeden Pool

Der Befund aus `1.89`, behoben — und mit ihm das Ende der lokal belegbaren
Liste der Paritätsleiter.

## Der Befund

Der Zertifizierungs-Postgres lief mit der Voreinstellung
`max_connections=100`, während die Suite 76 Pools mit 233 deklarierten
Verbindungen öffnet und vitest Dateien parallel fährt. Einmal riss das:
`remaining connection slots are reserved for roles with the SUPERUSER
attribute` — in einem fremden, sonst stets grünen Fall. Eine Suite, die
wächst, läuft irgendwann gegen jede stille Grenze.

## Der Fix

Der Cluster startet jetzt mit `max_connections=300` (Compose-Parameter), und
ein Real-DB-Fall prüft `SHOW max_connections` im Lauf. Ein Parameter, den
niemand prüft, ist genau die Art Behauptung, gegen die dieses Projekt seine
Mutationsproben fährt.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Der `max_connections`-Parameter fällt aus dem Compose | **159 von 160** — genau der Verbindungs-Fall: der Cluster läuft wieder mit 100 |

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 160/160, exit 0 | `docs/evidence/2026-09-24/connection-room-run1.manifest.json` |
| PostgreSQL 160/160, exit 0 | `docs/evidence/2026-09-24/connection-room-run2.manifest.json` |
| Mutation 159/160 | `docs/evidence/2026-09-24/connection-room-mutation.manifest.json` |
| Vitest lokal 1088/1088, exit 0 | `docs/evidence/2026-09-24/connection-room-local-run1.manifest.json` |

45 Migrationen.

## Wo die Leiter jetzt steht

Von `1.78` bis `1.90` sind dreizehn Releases entstanden, elf davon mit
Real-Service-Zertifizierung und Mutationsprobe. Die Zeilen Billing, Storage,
Data API (bis auf eingebettete Joins), Cron, Queues und Auth sind lokal
so weit belegt, wie sie ohne fremde Infrastruktur belegbar sind. Offen
bleiben **Sprosse 7** (SDK/CLI-Publishing mit Multi-OS-Evidenz über CI) und
**Sprosse 10** (PITR-/Restore-Drill gegen ein echtes WAL-Archiv,
SSL-PostgreSQL, belegter Realtime-Production-Start) — beide brauchen
Infrastruktur ausserhalb dieser Maschine.

## Ehrlich offen

- **300 ist eine gemessene Reserve, keine abgeleitete Grenze** — wächst die
  Suite weiter, muss der Wert mitwachsen, und der Fall wird es sagen.
- **Eingebettete Joins** bleiben die letzte Data-API-Lücke der Leiter.
