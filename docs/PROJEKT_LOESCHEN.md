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
- **2.176 (fertig):** Storage-Objekte und Buckets. Der Provisioner bekommt dafür den Storage-Zugang; Objekte und offene Uploads werden einzeln beim Anbieter gelöscht, verwaiste Multipart-Uploads unter dem Projektpräfix abgebrochen, dann die Buckets. Ohne Storage-Zugang wartet ein Projekt mit Dateien. Zertifiziert im PostgreSQL-17-Stack (264 von 264) und im Storage-Stack (15 von 15), je mit Mutationsprobe. Die ältere Lücke, dass ein abgelaufener oder abgebrochener einfacher Upload eine Datei beim Anbieter hinterlassen konnte, ist seit 2.178 geschlossen: Solche Uploads tragen einen Vermerk, und der Abräumer nimmt jeden ohne Vermerk mit.
- **2.177 (fertig):** Die Abbau-Anfrage an den Broker, signiert wie das Anlegen, mit eigenem Idempotenzschlüssel (Kennung der Zeile in `project_database_teardowns`, Migration 0091). Die Anfrage nennt auch die Zieldatenbanken früherer Wiederherstellungen. Lehnt der Broker ab, folgt ein neuer Versuch mit derselben Kennung, nach einer Minute und dann mit wachsendem Abstand bis höchstens einer Stunde. Bis der Broker jede Datenbank bestätigt, bleibt die Datenbank gesperrt stehen, `purged_at` leer, und die Konsole zeigt das Projekt als „wird abgeräumt“, ohne Zurückholen. Vertrag im Runbook (`docs/PROJECT_DATABASE_PROVISIONING_RUNBOOK.md`, Abschnitt „Abbau einer Projektdatenbank“).

Die Definitionen von Cron, Webhooks und Functions bleiben in 2.175 als Konfiguration in der Hülle: Sie laufen seit 2.174 nicht mehr, und ihre Verlaufstabellen haben eigene Schutzregeln. Restore-Zieldatenbanken einer Wiederherstellung liegen im selben Cluster wie die Projektdatenbank und gehören mit in die Abbau-Anfrage an den Broker (2.177).

Release erst nach 2.177, oder nach 2.175 mit einem Satz in der Release-Notiz,
der sagt, was noch nicht abgeräumt wird.
