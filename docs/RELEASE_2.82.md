# Release 2.82.0 – Ein Projekt löschen, und was danach verschwindet

Bis 2.81.0 liess sich ein Projekt nicht löschen. Denzil hat am 7. und
8. Oktober 2026 entschieden, wie es gehen soll: sofort gesperrt, sieben Tage
zurückholbar, danach mit Datenbank, Backups und Buckets entfernt. Das darf nur
die Owner-Rolle, und der Projektname muss abgetippt werden. Die Datenbank baut
der Broker auf eine signierte Anfrage hin ab, QKERN selbst nie. Audit-Log,
Rechnungen und Abrechnungsposten bleiben. Dieser Release baut das in fünf
Schnitten. Entscheidungen und Plan stehen in `docs/PROJEKT_LOESCHEN.md`.

## Was neu ist

- **Löschen mit Frist (2.173).** In den Einstellungen unter der Gefahrenzone. Das Projekt verschwindet aus der Console, jeder seiner Keys wird sofort abgelehnt, auch die S3-Schlüssel. Bis zum Ende der Frist holt der Owner es mit einem Knopf zurück. Migration `0087`.
- **Hintergrundprozesse lassen es aus (2.174).** Cron, Webhook-Zustellung, Backup-Zeitplan und Migrations-Abholung fassen ein gelöschtes Projekt nicht mehr an und machen nach dem Zurückholen weiter. Migration `0088`.
- **Der Abräumer, Backups und Keys (2.175).** Nach der Frist entfernt der Provisioner die Backups auf demselben Weg wie am Ende ihrer Aufbewahrung und widerruft die Keys. Solange ein Backup läuft oder eine Wiederherstellung wartet, wartet er. Migration `0089`.
- **Storage (2.176).** Jede Datei wird erst beim Anbieter gelöscht und dann im Katalog vermerkt. Offene und verwaiste Multipart-Uploads unter dem Projekt werden abgebrochen, danach gehen die Buckets. Migration `0090`.
- **Die Datenbank (2.177).** Für jede Datenbank geht eine signierte Anfrage an den Broker, mit eigenem Idempotenzschlüssel und den Zieldatenbanken früherer Wiederherstellungen. Lehnt er ab, folgt ein neuer Versuch mit derselben Kennung, nach einer Minute und dann seltener, höchstens stündlich. Migration `0091`, Vertrag im Runbook der Bereitstellung.
- **Die Console sagt, wo es steht.** Ein Projekt nach der Frist steht in der Liste als „wird abgeräumt“, ohne Zurückholen, und mit dem Satz, dass die Datenbank gesperrt bleibt, bis der Broker den Abbau bestätigt.
- Lokale Suite von 2735 auf 2739 bestandene Fälle; PostgreSQL 17 von 257 auf 265.

## Was als Hülle bleibt

Die Zeile in `projects` verschwindet nie, weil das Audit-Log mit `RESTRICT` an
ihr hängt und nur anhängbar ist. Die Umgebungen bleiben, weil Rechnungen und
Abrechnungsposten an ihnen hängen. `purged_at` sagt, wann das Projekt zur Hülle
wurde, und es wird erst gesetzt, wenn wirklich nichts mehr liegt: kein
lesbares Backup, keine Datei beim Anbieter, keine Datenbank ohne Bestätigung
des Brokers. Die Definitionen von Cron, Webhooks und Functions bleiben als
Konfiguration in der Hülle. Sie laufen seit 2.174 nicht mehr.

## Ohne Broker wartet das Projekt

Der Abbau braucht `QKERN_PROVISIONING_BROKER_TEARDOWN_URL`, und der Broker muss
den neuen Vertrag kennen. Fehlt die Adresse, geht keine Anfrage hinaus, und ein
abgelaufenes Projekt mit Datenbank bleibt als „wird abgeräumt“ stehen. Das ist
Absicht: Eine Hülle, die behauptet, abgeräumt zu sein, während die Datenbank
noch läuft, wäre schlimmer. Ebenso wartet ein Projekt mit Dateien, wenn der
Provisioner keinen Storage-Zugang hat.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 265/265, exit 0, zwei Worker | `docs/evidence/2026-10-08/teardown-postgres-run1.manifest.json` |
| PostgreSQL 17, 265/265, exit 0, zwei Worker, Reproduktion | `docs/evidence/2026-10-08/teardown-postgres-run2.manifest.json` |
| PostgreSQL 17, Mutation ohne Bestätigung des Brokers, 264/265 | `docs/evidence/2026-10-08/teardown-mutation-unconfirmed.manifest.json` |
| Empfänger-Stack über TLS, 18/18, exit 0 | `docs/evidence/2026-10-08/teardown-receiver-run1.manifest.json` |
| Empfänger-Stack, 18/18, exit 0, Reproduktion | `docs/evidence/2026-10-08/teardown-receiver-run2.manifest.json` |
| Empfänger-Stack, Mutation mit falschem Idempotenzschlüssel, 17/18 | `docs/evidence/2026-10-08/teardown-receiver-mutation-idempotency.manifest.json` |
| versitygw und ClamAV, 15/15, exit 0 | `docs/evidence/2026-10-08/storage-purge-s3-run1.manifest.json` |
| versitygw und ClamAV, 15/15, exit 0, Reproduktion | `docs/evidence/2026-10-08/storage-purge-s3-run2.manifest.json` |
| Vitest lokal 2739/2739, exit 0 | `docs/evidence/2026-10-08/welle34-local-run1.manifest.json` |
| Vitest lokal 2739/2739, exit 0 | `docs/evidence/2026-10-08/welle34-local-run2.manifest.json` |

Jeder Schnitt hat seine eigene Mutationsprobe, und jede traf genau den
gemeinten Fall. Die Liste steht in `docs/evidence/README.md`.

Die PostgreSQL-Läufe von 2.177 fuhren mit `QKERN_CERT_MAX_WORKERS=2`, einer
neuen Einstellung des Stacks: Der Rechner hatte nur gut 1 GB frei, und zwei
Läufe mit voller Parallelität fielen davor mit 21 und 16 Zeitüberschreitungen
in fremden Dateien, während alle Fälle zum Löschen grün waren. Dieselben
Dateien, dieselben Erwartungen; der Lauf ist als
`teardown-postgres-memory-pressure.log` archiviert.

Zwei Verträge, die jede Quelldatei lesen (Versionsnamen und Backups), rissen
lokal zweimal die Voreinstellung von 5000 ms. Allein gemessen brauchten sie
4,3 bis 5 Sekunden. Sie haben jetzt ein ausdrückliches Zeitbudget von 30
Sekunden; geprüft wird dasselbe. Der Lauf mit den Zeitüberschreitungen liegt
als `welle34-local-timeouts.log` bei.

Nach den Stack-Läufen kam eine Zeile dazu: Die neue Fehlerklasse der
Abbau-Anfrage ist in der Fehlerregistrierung eingetragen. Das ändert den Weg
der Anfrage nicht; die lokale Suite lief danach zweimal grün.

## Ehrlich offen

- **Der Broker kennt den Abbau-Vertrag noch nicht.** QKERN sendet die Anfrage und belegt sie gegen den Empfänger des Stacks. Ein echter Broker, der eine Datenbank abbaut, ist nicht gefahren.
- **Abgelaufene einfache Uploads.** Ein Upload, der nie abgeschlossen wurde, kann eine Datei beim Anbieter hinterlassen, die der Katalog nicht mehr als offen führt. Die Lücke ist älter als dieser Release, und der Abräumer schliesst sie nicht.
- **Ein Screenreader hat die Console nicht gelesen**, und die Console ist nicht mit einem echten Projekt angesehen.
- Tarif binden und Abfrageverlauf bleiben Neins, wie in 2.78.0 begründet.
