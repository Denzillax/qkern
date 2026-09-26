# Release 2.50.0 – Zweiter Faktor und Datenbank-Webhooks

Der Schalter, der den zweiten Faktor wirklich erzwingt, und Webhooks, die
eine Tabellenänderung signiert nach aussen tragen.

## Was neu ist

- Ansicht Auth, Mehrfaktor: der Schalter wirkt an drei Stellen im Dienst.
- Ein Einrichtungsschein, damit das Einschalten niemanden aussperrt.
- Ansicht Integrationen, Datenbank-Webhooks über den vorhandenen Change Feed.
- Der Zertifizierungsstack hat jetzt einen Vault, weil die Kette beides braucht.
- PostgreSQL-Zertifizierung von 186 auf 188 Fälle.

## Ein alter Fehler, den erst der neue Fall zeigte

Die Wiederherstellungscodes gingen als JavaScript-Feld in eine jsonb-Spalte.
Die Einrichtung des zweiten Faktors hat gegen eine echte Datenbank nie
funktioniert, in zwei Pfaden, obwohl TOTP als zertifiziert galt.

## Was die Mutationsprobe lehrte

Der Versuch, die geänderte Zeile in eine Zustellung zu schmuggeln, schrieb
nichts: der Feed führt keine Zeilenwerte. Der Versuch, die Kopplung jede
Tabelle nehmen zu lassen, blieb grün, bis der Fall eine zweite, nicht
gekoppelte Tabelle bekam.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17 mit Vault, 188/188 | `docs/evidence/2026-09-26/welle2-run1.manifest.json` |
| PostgreSQL 17 mit Vault, 188/188 | `docs/evidence/2026-09-26/welle2-run2.manifest.json` |
| Mutation zweiter Faktor, exit 1 | `docs/evidence/2026-09-26/welle2-mutation-mfa.manifest.json` |
| Mutation Webhooks, exit 1 | `docs/evidence/2026-09-26/welle2-mutation-webhook.manifest.json` |
| Vitest lokal 1648/1648, exit 0 | `docs/evidence/2026-09-26/welle2-local-run1.manifest.json` |
| Vitest lokal 1648/1648, exit 0 | `docs/evidence/2026-09-26/welle2-local-run2.manifest.json` |

`next build` grün.

## Ehrlich offen

- **Die Webhook-Brücke hat keinen dauerhaften Aufrufer.** Gebaut, zertifiziert, untätig.
- **Der Primärschlüssel erreicht den Empfänger**, auch beim Löschen, und lässt sich nicht unterdrücken.
- **Eine Tabelle ohne Erfassung erzeugt keine Zustellung.**
- **Ein fremder Token-Prüfer** sieht ein vor dem Umschalten ausgegebenes Token bis zum Ablauf als gültig.
- **Im Browser nicht gesehen.**
