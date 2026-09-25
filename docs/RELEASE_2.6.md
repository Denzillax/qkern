# Release 2.6.0 — Queues in der Console

Der erste der vier Platzhalter mit zertifiziertem Backend wird eine echte
Ansicht. Queues zuerst, weil Backend und Metrics-Export dort am
vollständigsten sind.

## Was die Ansicht zeigt

Die Queues der Umgebung mit ihren Regeln: Einreihrecht, Versuche, Lease,
Retry-Fenster, Dedupe. Je Queue den Status: wartend, in Bearbeitung,
erledigt, Dead Letters, und seit wann die älteste Nachricht wartet. Die
Dead Letters mit Versuch, Fehlercode und Zeitpunkt, jede lässt sich wieder
einreihen. Eine Queue anlegen per Prompt. Den Metrics-Export als Endpunkt,
weil ein Scraper Text will. Payloads erscheinen nie.

## Der Vertrag liest jetzt alles

Der i18n-Vertrag las nur `console-app.tsx`. Seit 2.6 liest er jede `.tsx`
in `components/console`, damit ausgelagerte Ansichten nicht stumm auf
Deutsch zurückfallen. Er fand die verwaiste Erklärung des Platzhalters und
einen fehlenden Schlüssel.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1110/1110, exit 0 | `docs/evidence/2026-09-25/queues-view-local-run1.manifest.json` |
| Vitest lokal 1110/1110, exit 0 | `docs/evidence/2026-09-25/queues-view-local-run2.manifest.json` |

Stacks unverändert, kein Server-Code berührt.

## Ehrlich offen

- **Sichtprüfung steht aus.** Die App hat den Dev-Server während des
  Slices neu gestartet; die Memory-Session starb mit dem alten Prozess. Die Ansicht ist per
  Typecheck und Vertrag geprüft, nicht mit echten Queues im Browser.
- **Kein Einreihen aus der Console**; das bleibt der Anwendung mit ihrem
  Key.
