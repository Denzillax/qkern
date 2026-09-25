# Release 2.8.0 — Derselbe Fehler, andere Klasse

Die Console zeigte „Console-Daten nicht verfügbar" statt zum Login zu
leiten. Ein 500 ohne Logzeile; die erste Massnahme war die Logzeile.

## Der Fund

Sie zeigte `AuthError: INVALID_SESSION`, genau den Fall, den die Route in
einen 401 übersetzen soll. Die Übersetzung prüfte `instanceof AuthError`.
Die Auth-Laufzeit liegt im Dev-Modus auf `globalThis` und überlebt
Hot-Reloads; die Klasse wird bei jedem Reload neu geladen. Ein Fehler aus
der alten Laufzeit ist für die neue Route ein Fremder. Deshalb wechselten
200 und 500 im Log ab: nach jedem Edit an Serverdateien bis zum nächsten
vollen Neustart.

## Die Korrektur

`isAuthError(error, code)` prüft Name und Code statt der Klassenidentität,
an allen sechs Stellen. Ein Test wirft eine fremde Kopie der Klasse und
verlangt, dass sie erkannt wird, und dass ein blosser `Error` mit gleichem
Text nicht erkannt wird. Im Browser danach: 401 und Weiterleitung zum
Login.

## Punkt 3

Die offenen Sidebar-Gruppen werden gemerkt wie die Sidebar-Breite. Die
Register-Parole ist ein Satz. Die Übersetzungen hat weiterhin niemand
gegengelesen, der die Sprache spricht.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1113/1113, exit 0 | `docs/evidence/2026-09-25/auth-error-identity-local-run1.manifest.json` |
| Vitest lokal 1113/1113, exit 0 | `docs/evidence/2026-09-25/auth-error-identity-local-run2.manifest.json` |

Stacks unverändert; die Änderung liegt in der Fehlerabbildung, nicht im
Real-DB-Pfad.

## Ehrlich offen

- **Die Notizen zu 2.6 und 2.7** nannten die verlorene Session als Grund;
  dazwischen lag dieser Fehler. Nach dem vollen Neustart ist die Session
  tatsächlich weg.
- **Dieselbe Falle** droht bei jedem Fehlertyp aus einer Laufzeit auf
  `globalThis`; geprüft ist nur Auth.
