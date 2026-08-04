# QKERN 1.4.0 Alpha 2 — Object Storage Scanner und Zertifizierung

Datum: 4. August 2026

## Ergebnis

Dieser Release ergänzt den Object-Storage-Alpha-Durchstich um einen ausführbaren,
fail-closed ClamAV-Adapter und einen reproduzierbaren MinIO-/ClamAV-
Zertifizierungsstack. Scannerfehler können ein Object nicht freigeben: Ohne exaktes
Urteil und erneuten Integritätsnachweis bleibt es in Quarantäne.

## Enthalten

- Begrenztes clamd-`INSTREAM`-Protokoll über privaten TCP-Transport mit festen
  Connect-/Scan-Timeouts, Chunkgrenzen und maximaler Object-Größe
- Interner kurzlebiger Provider-GET ohne Redirect und ohne Content-Encoding
- Sicherheitsmarge über der 30-Sekunden-Provider-Untergrenze, damit getrennte
  Clock-Reads den internen Scan-Grant nicht auf abgewiesene 29 Sekunden abrunden
- Erneute Prüfung von Content-Length, normalisiertem MIME, tatsächlich gelesener
  Bytezahl und Base64-SHA-256 während des Scannerstreams
- Exakte Antwortgrenze: nur `stream: OK` wird `clean`, nur ein begrenztes
  `stream: … FOUND` wird `infected`; alle Fehler und unbekannten Antworten bleiben
  `pending`
- Development-/CI-Runtimekonfiguration mit vollständiger Paarprüfung; Production
  verlangt weiterhin injizierten Provider- und Scanner-Port
- Portloser Docker-Wegwerfstack mit gepinntem MinIO, ClamAV 1.4.5 und Node 24.7.0
- Echter Clean-Pfad über Signed POST, Provider-HEAD, ClamAV, Signed GET und
  SHA-256-Vergleich sowie EICAR-Pfad mit Infected-Fehler und Provider-Delete
- Garantiertes Container-/Volume-Cleanup und statischer Harness-Vertrag
- Gepinntes lokales MinIO-Image auch im allgemeinen Development-Compose
- Aktualisierte Konfiguration, Architektur, Security, QA, Handbuch, Stufenplan,
  STATUS und chatunabhängiger Claude-Handoff

## Sicherheitsgrenzen

clamd-TCP bietet keine eigene Authentisierung und darf nicht öffentlich exponiert
werden. Der Zertifizierungsstack publiziert keine Ports; der lokale Development-
Stack bindet 3310 ausschließlich an Loopback. Production benötigt einen
injizierten Scanner sowie kontrolliertes privates Netzwerk/Egress.

Das Scannerlimit beträgt ohne explizite Konfiguration 25 MiB. Übergröße, Timeout,
Netzwerkfehler, Content-Encoding, MIME-/Bytezahl-/Checksum-Drift und malformed
Responses liefern `pending`. Quarantäne und Download-Deny bleiben dadurch intakt.

## Verifikation

- Strict TypeScript: grün
- Vitest: 586 bestanden, 17 optionale Real-Service-Tests übersprungen
- Next.js Production Build: grün
- Production Dependency Audit: 0 bekannte Schwachstellen
- MinIO-/ClamAV-Docker-Zertifizierung: Harness implementiert, in dieser
  Arbeitsumgebung nicht ausgeführt, da kein Docker-Programm vorhanden ist
- PostgreSQL-17-Docker-Zertifizierung: ebenfalls nicht ausgeführt, da Docker fehlt

## Bewusst offen

- Tatsächlicher grüner und archivierter Lauf des neuen Real-Service-Harness
- Production-S3-/TLS-/Credential-Rotation und ClamAV-Signaturupdate-/Ausfallmatrix
- PostgreSQL-17-Races für Quota, Completion, Delete und Lifecycle
- Multipart-/Resumable-Uploads, CDN und optionale Media-Transformationen
- Storage-Backup/Restore, Lasttest, Browser-/Accessibility-Smokes und unabhängiger
  Security-Test
- Die offenen Project-Auth-Live-Gates aus 1.3, Realtime, Functions, SDK/CLI,
  Billing und Managed Swiss Operations

Der Release ist ein Alpha-Quellstand und keine Managed-Production-Freigabe. Der
nächste Agent beginnt mit `docs/CLAUDE_HANDOFF.md`; historische Release Notes
bleiben unverändert.
