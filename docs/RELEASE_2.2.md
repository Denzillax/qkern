# Release 2.2.0 — Vier Sprachen

Die Website spricht Deutsch, Englisch, Französisch und Italienisch:
Startseite, Anmeldung und Registrierung. Die Console bleibt deutsch.

## Wie die Sprache gewählt wird

Beim ersten Besuch entscheidet der Browser (Accept-Language), danach die
Wahl in der Kopfzeile. Die Wahl liegt in einem Cookie; der Server rendert
die Seite neu, ohne Reload. Keine Pfade wie `/en`, damit Anker, Links und
Routen unverändert bleiben.

## Wo die Texte liegen

In typisierten Wörterbüchern unter `lib/i18n/`. Deutsch ist die Vorlage,
die anderen drei sind Übersetzungen davon. Zahlen und Daten kommen weiter
aus den Manifesten; deren deutsche Namen übersetzt eine kleine Abbildung
je Sprache, und das Datum des Prüflaufs folgt der Sprache.

## Der Vertrag

`tests/i18n-contract.test.ts`: jede Sprache hat dieselbe Struktur wie
Deutsch, kein Text ist leer, kein Text ist nur die deutsche Vorlage, die
Platzhalter stimmen überein, die Browser-Erkennung fällt auf Deutsch
zurück.

## Geprüft

Im Browser: ohne Cookie Englisch (die Sprache des Testbrowsers), mit
Cookie die französische Anmeldeseite und die italienische Startseite, und
der Klick auf „Deutsch" schaltet ohne Reload zurück. `next build` exit 0.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1105/1105, exit 0 | `docs/evidence/2026-09-25/four-languages-local-run1.manifest.json` |
| Vitest lokal 1105/1105, exit 0 | `docs/evidence/2026-09-25/four-languages-local-run2.manifest.json` |

Stacks unverändert.

## Ehrlich offen

- **Niemand hat die Übersetzungen gegengelesen**, der Deutsch und die
  Zielsprache spricht.
- **Die Console ist nur deutsch.**
- **Keine Sprach-URLs**: Suchmaschinen sehen die Sprache des Cookies, nicht
  vier Seiten.
