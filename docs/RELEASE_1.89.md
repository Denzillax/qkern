# Release 1.89.0 — Was gelaufen ist, steht

„Function-Logs als Produktfläche" aus der Paritätsleiter — in der Form, die
QKERN vertreten kann: ein **Aufrufprotokoll** je Function.

## Das Protokoll

Migration 0045, append-only, RLS: je Aufruf Beginn, Dauer, Ausgang,
Statuscode oder ein fester Fehlercode. Bewusst **nicht** protokolliert werden
stdout und stderr — sie stammen aus fremdem Code und könnten alles
enthalten, was die Function gesehen hat (die Haltung aus `1.22`). Ein
Protokollfehler stürzt den Aufruf nicht: Der Container ist gelaufen, seine
Wirkung ist da; der Fehler geht an `onLogFailure`.

Route `GET …/compute/functions/<id>/invocations`, Admin-Session, `limit` bis
200, neueste zuerst.

## Zertifiziert

- **Echtes PostgreSQL** (jetzt 159 Fälle, 45 Migrationen): ein gelungener
  und ein gescheiterter Aufruf, neueste zuerst, der gescheiterte nur mit
  festem Code und nur mit den Record-Schlüsseln.
- **Functions-Stack** (jetzt 27 Fälle): der Eintrag eines echten
  Container-Laufs mit Statuscode 200 und gemessener Dauer — und nichts vom
  Inhalt des Containers.
- Lokal: Erfolg, Scheitern, Protokollfehler ohne Wirkung auf den Aufruf.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Nur noch Erfolge werden protokolliert | Stack **158 von 159**, lokal **1 von 1088** — jeweils genau der Scheiter-Fall |

## Zwei eigene Fehler, ein Befund

Eine fixierte Uhr für den scheiternden Dienst machte „neueste zuerst"
unprüfbar (dieselbe Lektion wie `1.85`); eine Leck-Prüfung per Regex fand
„timeout" im festen Code `FUNCTION_TIMEOUT` selbst — ersetzt durch Schlüssel-
und Alphabetprüfung. Und: Ein Lauf 2 fiel mit `remaining connection slots
are reserved` in einem fremden, bisher stets grünen Fall. Der
Zertifizierungs-Postgres läuft mit Standard-`max_connections=100`; die
Suite deklariert 76 Pools mit 233 Verbindungen, und vitest fährt Dateien
parallel. Verworfen, archiviert, nicht abgeschwächt — der Parameter kommt
mit `1.90`.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 159/159, exit 0 | `docs/evidence/2026-09-24/invocation-log-run1.manifest.json` |
| PostgreSQL 159/159, exit 0 | `docs/evidence/2026-09-24/invocation-log-run2.manifest.json` |
| Mutation 158/159 | `docs/evidence/2026-09-24/invocation-log-mutation.manifest.json` |
| verworfen: Verbindungsgrenze | `docs/evidence/2026-09-24/invocation-log-connections-red.manifest.json` |
| Functions 27/27, exit 0 | `docs/evidence/2026-09-24/invocation-log-functions-run1.manifest.json` |
| Functions 27/27, exit 0 | `docs/evidence/2026-09-24/invocation-log-functions-run2.manifest.json` |
| Vitest lokal 1088/1088, exit 0 | `docs/evidence/2026-09-24/invocation-log-local-run1.manifest.json` |
| Mutation lokal 1087/1088 | `docs/evidence/2026-09-24/invocation-log-local-mutation.manifest.json` |

## Ehrlich offen

- **Keine Inhaltslogs** — stdout/stderr bleiben im Container, mit Absicht.
- **Keine Aufbewahrungsregel** — das Protokoll wächst, bis jemand es
  beschneidet.
- **Keine Console-Fläche** für das Protokoll.
