# Ein Projekt löschen: Entscheidungen und Bauplan

Stand: 8. Oktober 2026. Diese Datei hält fest, was Denzil entschieden hat und
in welchen Schnitten das Löschen eines Projekts gebaut wird. Sie wird mit jedem
Schnitt nachgeführt.

## Entscheidungen

Am 7. und 8. Oktober 2026 von Denzil getroffen:

| Frage | Entscheidung |
| --- | --- |
| Frist | Sofort gesperrt und ausgeblendet, sieben Tage zurückholbar, danach abgeräumt. |
| Daten | Projektdatenbank, Backups und Storage-Buckets werden mit dem Projekt entfernt. |
| Recht | Nur die Owner-Rolle (`project_delete`), mit abgetipptem Projektnamen. |
| Datenbank | Der Broker baut sie auf eine signierte Anfrage hin ab. QKERN selbst führt nie `DROP DATABASE` aus; die Grenze aus 2.126 bleibt. |
| Rechnungen | Rechnungen und Abrechnungsposten bleiben erhalten, wie das Audit-Log. |

## Was bleibt, und warum

Die Zeile in `projects` verschwindet nie. Das Audit-Log hängt mit `RESTRICT` an
ihr und ist nur anhängbar (0002). Die Umgebungszeilen bleiben ebenfalls, weil
Rechnungen (0040) und Abrechnungsposten (0080) mit `RESTRICT` an ihnen hängen.
Ein abgeräumtes Projekt ist also eine Hülle: Zeile, Umgebungen, Audit-Log und
Abrechnung bleiben, alles andere ist weg. Ein Feld `purged_at` sagt, wann.

## Schnitte

- **2.173 (fertig):** Löschen mit Frist, Zurückholen, Konsole, Keys gesperrt.
- **2.174 (fertig):** Cron, Webhook-Zustellung, Backup-Zeitplan und Migrations-Abholung lassen ein gelöschtes Projekt aus.
- **2.175 (fertig, ohne Definitionen):** Der Abräumer als Pflicht in der Leerlaufrunde des Provisioners. Er nimmt ein Projekt, dessen Frist abgelaufen ist, und räumt in einer festen, wiederaufnehmbaren Reihenfolge ab: Backups (erst Objekt, dann Katalogeintrag, wie `pruneExpired`), Keys widerrufen, dann `purged_at`. Solange ein Backup läuft oder eine Wiederherstellung wartet, setzt er `purged_at` nicht. Jeder Schritt ist für sich wiederholbar; bricht der Lauf ab, macht der nächste dort weiter. Zertifiziert im PostgreSQL-17-Stack (263 von 263), mit Mutationsprobe.
- **2.176:** Storage-Objekte und Buckets. Der Provisioner bekommt dafür den Storage-Zugang; Objekte werden einzeln beim Anbieter gelöscht, dann die Buckets. Zertifiziert im Storage-Stack.
- **2.177:** Die Abbau-Anfrage an den Broker, signiert wie das Anlegen, mit eigenem Idempotenzschlüssel. Bis der Broker den Abbau bestätigt, bleibt die Datenbank gesperrt stehen, und die Konsole sagt das. Zertifiziert gegen den Empfänger-Stack.

Die Definitionen von Cron, Webhooks und Functions bleiben in 2.175 als Konfiguration in der Hülle: Sie laufen seit 2.174 nicht mehr, und ihre Verlaufstabellen haben eigene Schutzregeln. Restore-Zieldatenbanken einer Wiederherstellung liegen im selben Cluster wie die Projektdatenbank und gehören mit in die Abbau-Anfrage an den Broker (2.177).

Release erst nach 2.177, oder nach 2.175 mit einem Satz in der Release-Notiz,
der sagt, was noch nicht abgeräumt wird.
