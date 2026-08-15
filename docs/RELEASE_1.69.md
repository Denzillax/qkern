# Release 1.69.0 — Teile, die ankommen

Sprosse 3 der Paritätsleiter, erste Hälfte: **Fortsetzbare Uploads in Teilen,
auf der Provider-Schicht gegen echtes MinIO zertifiziert.**

## Was gebaut ist

Der Storage-Provider-Port kann Multipart: beginnen, je Teil eine signierte
Upload-URL ausstellen, abschliessen, abbrechen — im S3-Adapter und im
Memory-Adapter mit denselben Zusagen.

Die Integrität trägt der Provider je Teil: Die SHA-256-Prüfsumme jedes Teils
ist ein **signierter** Header seiner URL. Der Abschluss liest den Rumpf der
S3-Antwort, nicht nur den Status — S3 kann 200 antworten und den Fehler in den
Rumpf legen.

## Zwei Funde

**`canonicalQueryString` sortierte mit `localeCompare`.** AWS verlangt
Byte-Ordnung. Bei rein grossgeschriebenen `X-Amz-`-Schlüsseln fiel das nie auf;
mit gemischten Schlüsseln (`partNumber`, `uploadId`) platzt die Signatur am
Provider — `SignatureDoesNotMatch`, gefunden am ersten echten MinIO-Lauf. Der
Fehler war latent auch im Bestand: Ein signierter Download **mit Dateinamen**
(`response-content-disposition`) hätte dieselbe falsche Ordnung erzeugt; kein
Zertifizierungsfall hatte je einen Dateinamen gesetzt.

**Die erste Mutationsprobe traf nicht — und das war die Antwort.** Die Probe
nahm die Prüfsumme aus der Signatur, und der manipulierte Teil wurde trotzdem
abgewiesen: Diese Abweisung trägt der **mitgesendete** Header, nicht die
Signatur. Was die Signatur wirklich trägt: Sie macht den Header
**verpflichtend**. Der Fall nagelt jetzt beides fest — manipulierte Bytes
werden abgewiesen, und ein Teil **ohne** Prüfsummen-Header wird abgewiesen.
Erst damit trifft die Probe.

## Zertifiziert

Gegen echtes MinIO: 5-MiB-Teil plus 64-KiB-Teil über signierte URLs,
manipulierte Bytes abgewiesen, Teil ohne Prüfsumme abgewiesen, Abschluss,
Download byte-identisch zum Original. Und: Abbruch lässt nichts zurück — kein
Objekt, und der Abschluss eines abgebrochenen Uploads scheitert.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Die Prüfsumme wird nicht mehr signiert | **3 von 4** — genau der Resumable-Fall: ohne Signaturzwang nimmt der Provider Teile ohne Prüfsumme an |

## Belege

| Lauf | Manifest |
| --- | --- |
| MinIO/ClamAV 4/4, exit 0 | `docs/evidence/2026-08-16/multipart-run1.manifest.json` |
| MinIO/ClamAV 4/4, exit 0 | `docs/evidence/2026-08-16/multipart-run2.manifest.json` |
| Mutation 3/4 | `docs/evidence/2026-08-16/multipart-mutation.manifest.json` |

Lokal: 1056 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Nur die Provider-Schicht.** Der Dienstweg — Upload-Zeilen, Quota,
  Virenprüfung, REST — kennt Multipart noch nicht; ein Kunde kann es noch nicht
  benutzen. Das ist die zweite Hälfte der Sprosse.
- **`headObject` auf einem Multipart-Objekt liefert eine zusammengesetzte
  Prüfsumme** (`…-2`), die die bestehende Formprüfung abweisen würde. Der
  Dienstweg muss das behandeln; der Provider-Fall liest deshalb den Download,
  nicht den HEAD.
- **Zum zweiten Mal hat ein `git checkout` unkommittierte Arbeit gelöscht** —
  diesmal die ganze Multipart-Implementierung, wiederhergestellt aus den
  Patch-Skripten. Wiederherstellung nach Mutationen läuft jetzt über eine
  Sicherungskopie, nicht über git.
- **Ein als Mutationslauf beschrifteter Lauf war zwischenzeitlich ein grüner
  Lauf**: Das Mutationsskript scheiterte an seinem Anker, bevor es schrieb, und
  der Stack lief unmutiert. Aufgefallen an 4/4 im vermeintlichen
  Mutationslog; der Lauf wurde verworfen und die Mutation zeilengenau
  wiederholt.
