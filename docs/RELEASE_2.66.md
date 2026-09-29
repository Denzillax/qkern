# Release 2.66.0 – Die Schlüssel öffnen, die Nachbarn kommen mit

Drei Schnitte parallel, alle drei an Sprossen der Leiter zu Supabase, die
seit 1.91 dort standen. Zwei davon sind echte Funktionen gegen echte Dienste,
der dritte macht den Cron-Prozess so vollständig wie pg_cron.

## Was neu ist

- Der S3-Endpunkt `/s3` nimmt die Schlüsselpaare aus 2.59 an, prüft SigV4 und ruft denselben Storage-Dienst wie die REST-Routen.
- Die Data API bettet Nachbarzeilen über Fremdschlüssel ein, eine Ebene tief, unter der RLS beider Tabellen.
- CRON_PLATZHALTER
- Der Migrationsprozess-Fall wartet auf seine Logzeile innerhalb derselben Frist, statt einen Zeitpunkt zu messen.
- PostgreSQL-Zertifizierung von 224 auf STACK_PLATZHALTER Fälle, Storage-Stack von 8 auf 9, lokale Suite von 2309 auf LOKAL.

## Der S3-Endpunkt

Seit 2.59 gab QKERN Schlüsselpaare aus, und die Seite sagte selbst, dass sie
nichts öffnen. Jetzt prüft `/s3` die SigV4-Signatur im Header gegen das Paar
und arbeitet als Service-Rolle der Umgebung, beschränkt auf den Bucket-Satz
des Paars. Es gibt keinen zweiten Weg an den Regeln vorbei: Der Endpunkt
ruft denselben `ProjectStorageService`, also gelten Policies, Quota, MIME-Liste,
Scan und Quarantäne wie über REST. EICAR durch den Endpunkt landet in
Quarantäne, das prüft der Storage-Stack.

Gebaut sind ListBuckets, HeadBucket, ListObjectsV2, HeadObject, GetObject,
PutObject in einem Stück bis 64 MiB und DeleteObject. **Nicht gebaut und mit
501 benannt**: Presigned URLs, aws-chunked (und damit die AWS CLI über HTTP),
Multipart, CopyObject, Range, ListObjects v1, Buckets anlegen und löschen.
Die Seite zählt beides auf.

Migration 0065 legt das Geheimnis verschlüsselt in die Zeile (AES-256-GCM,
der öffentliche Teil ist die AAD) und gibt `qkern_runtime` eine
SECURITY-DEFINER-Funktion zum Prüfen. **Paare aus 2.59 bis 2.65 haben kein
Chiffrat und öffnen weiterhin nichts**; die Liste sagt es je Paar.

## Eingebettete Beziehungen

`select=id,titel,autor:autoren(name),kommentare(text)` holt die Zeilen der
Nachbartabelle über genau einen Fremdschlüssel mit: eine Zeile oder null,
wenn der Schlüssel von der Basistabelle weg zeigt, eine Liste, wenn er auf
sie zeigt. Die Nachbartabelle geht durch dieselbe Tür wie die Basistabelle,
und jede eingebettete Zeile wird in derselben Transaktion mit denselben Claims
gelesen. Eine Nachbartabelle ohne RLS wird abgewiesen, genau wie eine
Basistabelle ohne RLS.

Die Grenzen stehen in `lib/data-api-limits.ts`: drei Einbettungen je Anfrage,
zwanzig Zeilen je Elternzeile, mit `truncated` in der Antwort. Console,
Handbuch und OpenAPI nennen dieselben Zahlen. Eingebettete Zeilen zählen bei
`database_row_reads` mit.

Nicht unterstützt und so dokumentiert: Schlüsselhinweise wie `users!fk`,
Selbstbezug, Schlüssel über Schemagrenzen, Einbettung an Views, mehr als eine
Ebene. MCP und GraphQL kennen keine Einbettung.

## Cron

CRON_ABSCHNITT

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, STACK_PLATZHALTER/STACK_PLATZHALTER, exit 0 | `docs/evidence/2026-09-29/welle18-run1.manifest.json` |
| PostgreSQL 17, STACK_PLATZHALTER/STACK_PLATZHALTER, exit 0 | `docs/evidence/2026-09-29/welle18-run2.manifest.json` |
| versitygw und ClamAV, 9/9, exit 0 | `docs/evidence/2026-09-29/welle18-storage.manifest.json` |
| Mutation der Signaturvergleich nimmt jede Signatur, exit 1 | `docs/evidence/2026-09-29/welle18-mutation-sigv4.manifest.json` |
| Mutation die Nachbartabelle geht an der Tür vorbei, exit 1 | `docs/evidence/2026-09-29/welle18-mutation-embedboundary.manifest.json` |
| CRON_PROBE |
| Vitest lokal LOKAL/LOKAL, exit 0 | `docs/evidence/2026-09-29/welle18-local-run1.manifest.json` |
| Vitest lokal LOKAL/LOKAL, exit 0 | `docs/evidence/2026-09-29/welle18-local-run2.manifest.json` |

Die Läufe der drei Agenten auf ihren Zweigen liegen daneben unter
`slice-s3-*`, `data-api-joins-*` und CRON_EVIDENZ.

## Nachtrag zum Verfahren

**Drei Stacks gleichzeitig sind einer zu viel, zum vierten Mal.** Mit 1,1 von
15,7 GiB frei wurde ein Testcontainer nach 18 Minuten ohne eine einzige
Testzeile abgebaut, ein `npm ci` hing 14 Minuten, ClamAV wurde nicht healthy,
Vault drehte ohne Log. Die Agenten haben daraufhin eine Reihenfolge bekommen
und jeden Lauf wiederholt, in dem ein fremder Zeitfall am 5000-ms-Timeout
gefallen war. Kein Budget wurde erhöht. Der einzige Fall, der dabei einen
echten Wettlauf zeigte, ist der Migrationsprozess: `finishFailure` schreibt
die Logzeile, nachdem `markFailed` festgeschrieben hat, und wer im selben
Moment liest, sieht den Puffer leer. Der Fall wartet jetzt innerhalb
derselben Frist auf die Zeile.

**Ein Agent hat "erledigt in 2.96" geschrieben, wo 2.66.0 gemeint war.**
Fallnummer und Releasenummer sehen sich zu ähnlich; beim Merge berichtigt.

## Ehrlich offen

- **Kein echter S3-Client hat den Endpunkt gesehen.** Die Signatur ist im direkten Handler-Aufruf belegt, nicht über einen laufenden Next-Server mit aws cli oder rclone. Die Pfadkodierung des Canonical Request stützt sich auf `request.url`.
- **Überschreiben per PutObject ist Löschen plus Anlegen**, nicht atomar. Scheitert der Upload beim Anbieter, bleibt die Reservierung bis zum Ablauf des Grants stehen.
- **Alte S3-Paare öffnen nichts.** Wer sie braucht, gibt neue aus.
- **Einbettung nur eine Ebene, nur über genau einen Fremdschlüssel**, und nicht über MCP oder GraphQL.
- CRON_OFFEN
- **Im Browser nicht gesehen**, weiterhin.
- **Ein Platzhalter bleibt**: Analytics-Buckets.
