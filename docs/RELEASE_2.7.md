# Release 2.7.0 — Drei Ansichten mehr

Die restlichen drei Platzhalter mit zertifiziertem Backend werden echte
Ansichten. Damit ist Punkt 1 von Denzils Auftrag erledigt.

## Migrationen

Drei Quellen, alle vorhanden: die Change Sets des Projekts vom Entwurf bis
angewendet, mit Risiko, Agent, Diff-Zeilen und Rollback; die Reviews, also
Läufe, deren Ausgang der Worker nicht selbst klären konnte; und die
Vorfälle mit dem Stand ihrer Zustellung. Je Umgebung gefiltert, nur lesend.

## Function-Aufrufe

Die Functions der Umgebung und je Function das Aufrufprotokoll: Zeit,
Auslöser, Dauer, Ausgang, Statuscode oder Fehlercode, neueste zuerst. Dazu
Fehlerquote und mittlere Dauer. Ohne stdout und stderr, wie die Route.

## Realtime-Inspector

Ein reiner Browser-Client für `qkern.realtime.v1`: Server-URL, Projekt-Key,
Kanal; verbinden, anmelden, abonnieren, Broadcast senden, alles Empfangene
im Protokoll. Der Key bleibt in der Browser-Sitzung und geht nur an den
Realtime-Server. Der Server ist ein eigener Prozess auf Port 8788 und läuft
im Dev-Setup nicht von allein; der Inspector sagt das, wenn die Verbindung
scheitert.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1110/1110, exit 0 | `docs/evidence/2026-09-25/three-views-local-run1.manifest.json` |
| Vitest lokal 1110/1110, exit 0 | `docs/evidence/2026-09-25/three-views-local-run2.manifest.json` |

Stacks unverändert, kein Server-Code berührt.

## Ehrlich offen

- **Sichtprüfung steht aus**, für alle drei, weil die Memory-Session mit dem
  Neustart des Dev-Servers gestorben ist.
- **Der Inspector ist gegen keinen laufenden Realtime-Server geprüft.** Das
  Protokoll stammt aus dem Code, nicht aus einem Handschlag.
