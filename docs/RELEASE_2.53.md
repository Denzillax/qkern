# Release 2.53.0 – Was das Passwort verrät

Passwörter gegen bekannte Lecks, ohne fremden Dienst. Dazu die
Datenbank-Einstellungen und die Wiederherstellung auf einen Zeitpunkt, beide
so weit sie tragen.

## Was neu ist

- Ansicht Auth, Angriffsschutz: lokale Leckliste, kein externer Abgleich.
- Ansicht Datenbank, Einstellungen: Rollen, TLS-Zustand, Grenzen.
- Ansicht Datenbank, Point-in-time Recovery.
- PostgreSQL-Zertifizierung von 193 auf 195 Fälle.

## Die unbequeme Hälfte

Die eingebaute Leckliste hat 25 Einträge, und alle sind kürzer als die zwölf
Zeichen, die QKERN ohnehin verlangt. Ohne eigene Listendatei weist der
Schalter nichts ab, was die Längenregel nicht schon abweist.

## Was nicht gebaut wurde, und warum

Die Übung aus 2.29 beweist längst eine Wiederherstellung auf einen
gewählten Zeitpunkt. Sie wurde nicht angefasst: ein zusätzliches Feld hätte
die Signatur ihres Belegs ungültig gemacht, für eine Tatsache, die sie schon
prüft.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 195/195, exit 0 | `docs/evidence/2026-09-27/welle5-run1.manifest.json` |
| PostgreSQL 17, 195/195, exit 0 | `docs/evidence/2026-09-27/welle5-run2.manifest.json` |
| Mutation Passwortprüfung, exit 1 | `docs/evidence/2026-09-27/welle5-mutation-leak.manifest.json` |
| Mutation TLS-Zustand, exit 1 | `docs/evidence/2026-09-27/welle5-mutation-tls.manifest.json` |
| Mailpit und Dex, 7/7, exit 0 | `docs/evidence/2026-09-27/welle5-auth.manifest.json` |
| Vitest lokal 1844/1844, exit 0 | `docs/evidence/2026-09-27/welle5-local-run1.manifest.json` |
| Vitest lokal 1844/1844, exit 0 | `docs/evidence/2026-09-27/welle5-local-run2.manifest.json` |

`next build` grün.

## Ehrlich offen

- **Kein Captcha, keine Bot-Abwehr** über die Grenzen aus 2.52 hinaus.
- **Bestehende Passwörter werden nie geprüft**, weil ein Argon2-Hash nicht lesbar ist.
- **Kein Pooler, keine Netzbeschränkung.** Es gibt sie nicht.
- **Für echte Installationen fehlt die Archivkonfiguration**, also auch die Wiederherstellung auf einen Zeitpunkt.
- **Im Browser nicht gesehen.**
