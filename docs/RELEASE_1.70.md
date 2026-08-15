# Release 1.70.0 — Der Scanner rechnet nach

Sprosse 3 der Paritätsleiter ist **abgebaut**: Fortsetzbare Uploads laufen
jetzt über den ganzen Dienstweg — Reservierung, Quota, Teil-Grants, Abschluss,
Virenprüfung, REST.

## Die Architekturentscheidung

Ein Multipart-Objekt hat beim Provider keine Ganzdatei-Prüfsumme — MinIO
liefert im HEAD gar keinen Prüfsummen-Header, S3 höchstens einen
zusammengesetzten. Wer soll dann die deklarierte Summe der ganzen Datei
prüfen?

**Der Virenscanner.** Er lädt das fertige Objekt ohnehin herunter und rechnet
dabei seit jeher die SHA-256 mit. Diese Schiene wird zur Verifikation: Ein
Multipart-Objekt wird **nur** sauber, wenn der Scanner Bytes gesehen hat, die
zur deklarierten Summe passen. Ohne nachrechnenden Scanner bleibt es in
Quarantäne — nicht als Strafe, sondern weil seine Ganzdatei-Summe sonst
niemand geprüft hat.

## Was gebaut ist

- **Migration 0041**: `kind` und `provider_upload_id` an der
  Upload-Reservierung; die Kennung gehört genau zu einem Multipart-Upload.
- **Dienst**: `prepareMultipartUpload` (mit eigener, längerer Lebensdauer —
  ein 5-GiB-Upload überlebt keine 300 Sekunden), `createPartUploadGrant`
  (nur für lebende Reservierungen), `completeMultipartUpload` (Grösse und Typ
  prüft der HEAD exakt; die Prüfsumme absichtlich nicht — siehe oben),
  `abortMultipartUpload` (lässt nichts zurück, gibt die Schlüsselreservierung
  frei). Einfacher und fortsetzbarer Abschluss weisen sich gegenseitig ab.
- **REST**: drei Routen unter der bestehenden Storage-Grenze — vorbereiten,
  Teil-Grant, abschliessen/abbrechen.
- Scheitert die Reservierung nach dem Provider-Beginn, wird beim Provider
  abgebrochen: Quota und Schlüssel-Eindeutigkeit dürfen keine verwaisten
  Teile hinterlassen.

## Ein Fund

`headObject` warf für jedes Multipart-Objekt `STORAGE_PROVIDER_UNAVAILABLE`:
Es verlangte einen wohlgeformten Prüfsummen-Header, und MinIO liefert dort
keinen. Ein fehlender Wert wird jetzt leer durchgereicht — die Zusage des
einfachen Wegs trägt der Gleichheitsvergleich im Dienst, und leer ist niemals
gleich einer deklarierten Summe. Gefunden in Minuten gegen ein einzelnes
MinIO, nicht in Stunden gegen den Stack.

## Zertifiziert

Gegen echtes MinIO und echtes ClamAV, über den **Dienst**:

- 5-MiB- plus 128-KiB-Teil, Abschluss, Scanner bestätigt → **clean**;
  Download byte-identisch.
- Eine **gelogene** Ganzdatei-Prüfsumme bei korrekt geprüften Teilen: Der
  Scanner rechnet nach und verweigert das Urteil — das Objekt bleibt
  **quarantined**.

Dazu vier lokale Fälle (Zustandsgrenzen, Schlüsselfreigabe nach Abbruch) und
die PostgreSQL-Regression mit Migration 0041.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Der Scanner vergleicht die Prüfsumme nicht mehr | **5 von 6** — genau der Fall mit der gelogenen Summe |

## Belege

| Lauf | Manifest |
| --- | --- |
| MinIO/ClamAV 6/6, exit 0 | `docs/evidence/2026-08-16/multipart-service-run1.manifest.json` |
| MinIO/ClamAV 6/6, exit 0 | `docs/evidence/2026-08-16/multipart-service-run2.manifest.json` |
| Mutation 5/6 | `docs/evidence/2026-08-16/multipart-service-mutation.manifest.json` |
| PostgreSQL 142/142, exit 0 | `docs/evidence/2026-08-16/multipart-postgres-run1.manifest.json` |
| PostgreSQL 142/142, exit 0 | `docs/evidence/2026-08-16/multipart-postgres-run2.manifest.json` |

41 Migrationen. Lokal: 1060 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Kein Fall lädt 5 GiB.** Die Grössenordnung der Fälle ist Megabytes; dass
  die Kette bei ihrer Obergrenze hält, ist plausibel, nicht belegt.
- **Verwaiste Provider-Uploads altern nicht weg.** Ein Absturz zwischen
  Provider-Beginn und Reservierung hinterlässt einen leeren Multipart-Upload
  beim Provider; eine Lifecycle-Regel dafür fehlt.
- **Die Multipart-REST-Routen sind lokal getestet**, im Stack läuft der
  Dienst.
- **Der Postgres-Weg der neuen Spalten ist per Regression belegt** (142/142
  mit Migration 0041), aber kein Real-DB-Fall reserviert gezielt einen
  Multipart-Upload.
