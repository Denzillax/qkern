# Release 2.14.0 – Ein Server, der noch da ist

Das Repository liegt jetzt auf GitHub: `Denzillax/qkern`, privat. Der erste
Lauf der beiden Workflows ausserhalb dieser Maschine hatte zwei rote Jobs.

## Windows-Runner

`spawnSync npm.cmd EINVAL`: Node 24 startet `.cmd`-Dateien nicht mehr ohne
Shell. Der Tarball-Pruefer ruft `npm-cli.js` jetzt direkt mit dem laufenden
Node auf, ohne Shell.

## Storage-Stack

`minio/minio` ist von Docker Hub verschwunden, auch quay.io traegt es nicht.
Von drei geprueften Ersatzservern verhaelt sich nur versitygw v1.8.0 wie S3
auf dem Weg, den der Dienst braucht: POST-Policy-Upload mit Pruefsumme,
dieselbe Summe im HEAD zurueck, falsche Summe mit 400 abgewiesen. RustFS
1.0.0 gab im HEAD keine Summe zurueck, zwei Faelle fielen.

Zertifizierungsstack und Dev-Compose laufen jetzt gegen versitygw. Im
Dev-Compose bleibt Port 9000, die Web-UI faellt weg, `npm run storage:bucket`
legt den Bucket an. Das Label heisst `versitygw und ClamAV`; alte Manifeste
bleiben lesbar.

## Belege

| Lauf | Manifest |
| --- | --- |
| versitygw und ClamAV 8/8, exit 0 | `docs/evidence/2026-09-25/storage-versitygw-run1.manifest.json` |
| versitygw und ClamAV 8/8, exit 0 | `docs/evidence/2026-09-25/storage-versitygw-run2.manifest.json` |
| Vitest lokal 1118/1118, exit 0 | `docs/evidence/2026-09-25/storage-swap-local-run1.manifest.json` |
| Vitest lokal 1118/1118, exit 0 | `docs/evidence/2026-09-25/storage-swap-local-run2.manifest.json` |

`next build` gruen.

## Ehrlich offen

- **Keine Mutationsprobe.** Kein Produktcode geaendert; der Vergleich der
  Pruefsumme im Dienst ist unveraendert.
- **Der GitHub-Lauf auf diesem Stand steht noch aus.** Sprosse 7 ist
  begonnen, nicht belegt.
- **MinIO ist nur noch aus dem Cache reproduzierbar.** Wer den Dev-Stack
  vorher mit MinIO betrieb, entfernt das alte Volume, siehe Handbuch.
