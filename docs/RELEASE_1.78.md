# Release 1.78.0 — Waisen altern weg

Der offene Punkt aus `1.70`: Ein Absturz zwischen Provider-Start und
Reservierung, eine still verfallene Reservierung, ein fehlgeschlagener
Abbruch — jedes davon liess einen begonnenen Multipart-Upload beim Provider
**für immer** liegen. Jetzt räumt der Lifecycle beides ab: verfallene
Reservierungen und Provider-Waisen. Und der erste Real-DB-Fall für
Multipart-Reservierungen fand dabei, dass es sie gegen echtes PostgreSQL
**nie geben konnte**.

## Der Aufräumer

`expireLifecycle` — derselbe Weg, der abgelaufene Objekte löscht — tut jetzt
zwei Dinge mehr:

1. **Verfallene Reservierungen** werden `expired`, ihre Quota wird frei, und
   der Provider-Upload wird abgebrochen. Bis 1.78 verfielen sie nur lazy beim
   nächsten `reserveUpload` desselben Buckets — und niemand sagte dem Provider
   Bescheid.
2. **Provider-Waisen**: begonnene Multipart-Uploads, die alt genug sind
   (Standard: die Reservierungsdauer) und zu keiner lebenden Reservierung
   gehören, werden abgebrochen. Das neue Provider-Verb `listMultipartUploads`
   holt eine Seite von höchstens 1000 Einträgen — der Aufräumer läuft
   wiederholt, nicht erschöpfend.

Was er ausdrücklich **nicht** tut: einen Upload anfassen, den eine lebende
Reservierung besitzt. Diese Schutzprüfung ist das Mutationsziel des Releases.

## Zwei Produktfunde

- **MinIO beantwortet `ListMultipartUploads` mit Verzeichnis-Präfixen leer** —
  nur ohne Präfix oder mit vollem Objektschlüssel kommen Einträge. Der erste
  Zertifizierungslauf fiel genau daran; im Wegwerf-Container in Minuten
  eingegrenzt. Der Präfix wird jetzt bewusst nicht an den Server gegeben,
  gefiltert wird clientseitig über der einen Seite.
- **Der CHECK auf `provider_upload_id` aus Migration 0041 war nie erfüllbar.**
  PostgreSQL erlaubt in POSIX-Regexen höchstens 255 Wiederholungen je Quantor;
  `{1,1024}` wirft zur **Laufzeit** `invalid regular expression` — beim ersten
  INSERT mit einem Wert, nicht beim Anlegen. Seit `1.70` konnte damit keine
  Multipart-Reservierung in eine echte Datenbank geschrieben werden;
  Single-Uploads blieben unberührt, weil `NULL` die Bedingung nie auswertet.
  Gefunden vom ersten Real-DB-Fall, der gezielt einen Multipart-Upload
  reserviert — exakt die Lücke, die `1.70` als „Ehrlich offen" auswies.
  Migration 0043 ersetzt die Bedingung: Länge prüft `length()`, das Alphabet
  die Regex ohne Zählgrenze.

## Zertifiziert

Gegen echtes MinIO/ClamAV (jetzt 8 Fälle):

- Eine verfallene Reservierung wird beim Provider abgebrochen, eine spätere
  Teil-URL endet mit `STORAGE_INVALID_TOKEN`.
- Eine Waise ohne Reservierung fällt; der Upload einer **lebenden**
  Reservierung bleibt stehen und läuft danach unverändert bis `clean` durch.

Gegen echtes PostgreSQL (jetzt 152 Fälle): Reservieren, verfallen lassen,
aufräumen — Status `expired`, `reserved_bytes` 0, Provider-Upload weg. Der
Fall, der 0041 zu Fall brachte.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Die Schutzprüfung für lebende Reservierungen wird aus dem Waisen-Aufräumer entfernt | **7 von 8** — genau der Verschonungsfall: der lebende Upload wird wie eine Waise abgebrochen (`expected [] to have a length of 1`) |

## Belege

| Lauf | Manifest |
| --- | --- |
| MinIO/ClamAV 8/8, exit 0 | `docs/evidence/2026-08-16/storage-lifecycle-run1.manifest.json` |
| MinIO/ClamAV 8/8, exit 0 | `docs/evidence/2026-08-16/storage-lifecycle-run2.manifest.json` |
| Mutation 7/8 | `docs/evidence/2026-08-16/storage-lifecycle-mutation.manifest.json` |
| PostgreSQL 152/152, exit 0 | `docs/evidence/2026-08-16/storage-lifecycle-postgres-run1.manifest.json` |
| PostgreSQL 152/152, exit 0 | `docs/evidence/2026-08-16/storage-lifecycle-postgres-run2.manifest.json` |

43 Migrationen. Lokal: 1065 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Die eine Seite ist die Grenze**: Mehr als 1000 offene Multipart-Uploads je
  Bucket räumt ein Lauf nicht vollständig; der nächste Lauf setzt fort, aber
  niemand misst den Rückstand.
- **Kein Prozess ruft den Lifecycle von selbst** — der Aufräumer läuft, wenn
  die Lifecycle-Route gerufen wird; einen eigenen Zeitplan hat er nicht.
- **Die Waisen-Schwelle vertraut der Provider-Uhr**: `Initiated` kommt vom
  Provider; bei MinIO stimmt sie (verifiziert), aber niemand prüft Schiefstand
  gegen einen dritten Anker.
