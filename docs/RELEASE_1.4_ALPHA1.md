# QKERN 1.4.0 Alpha 1 — Object Storage

Datum: 3. August 2026

## Ergebnis

Dieser Release liefert den ersten ausführbaren Object-Storage-Vertical-Slice.
Storage ist ein eigenes Modul mit Repository-, Provider- und Scanner-Ports und
bleibt standardmäßig deaktiviert. Buckets sind privat, bis ein Owner oder
Administrator eine engere feste Policy ausdrücklich auswählt.

## Enthalten

- Tenant-, Projekt- und Environment-gebundene Bucket-, Upload- und Object-Metadaten
- Migration `0025_project_storage.sql` mit RLS, unveränderlichen Identitäten,
  partiellen Eindeutigkeitsindizes und Least-Privilege-Spaltengrants
- Feste Read-Policies `private`, `authenticated`, `owner`, `public`, `service` und
  Write-Policies ohne öffentliche Schreibmöglichkeit
- Sichere MIME-Allowlist, Object-Größenlimit, Bucket-Quota, atomare Reservierung
  und Freigabe bei Ablauf, Abbruch, Malware oder Delete
- Kurzlebige S3-SigV4-POST-Grants, exakt an Object-Key, Content-Type und Base64-
  SHA-256 gebunden; die gesamte Multipart-Größe ist eng begrenzt und die tatsächliche
  Object-Bytezahl wird vor Commit per Provider-HEAD exakt geprüft
- Completion Token nur einmal in der Antwort; persistent liegt ausschließlich der
  SHA-256-Verifier
- Provider-HEAD-Prüfung vor Metadaten-Commit; abweichende Größe, MIME oder Checksum
  löscht das Provider-Objekt und verwirft die Reservierung
- Quarantäne bis zum Scanner-Urteil, Download-Deny für nicht saubere Objects,
  Infected-Delete sowie bounded Retention-/Lifecycle-Verarbeitung
- Kurzlebige signierte Downloads von 30 bis höchstens 900 Sekunden
- REST- und OpenAPI-3.1-Vertrag, echte Console-Bucket-Liste/-Erzeugung/-Löschung
  ohne Beispieldaten und zwei strikt lesende MCP-Werkzeuge
- Gepinnter Hono-Override 4.12.34 für einen Production-Dependency-Audit ohne
  bekannte Critical/High/Moderate-Befunde

## Sicherheitsgrenzen

Project Storage ist disabled-by-default. Browserzugriff benötigt eine exakte CORS-
Allowlist. Öffentliche und App-User-Operationen verlangen den passenden Projekt-Key;
`authenticated` und `owner` benötigen zusätzlich ein aktives Project-Auth-JWT.
Eine Service-Rolle umgeht keine Policy. Öffentliche Writes existieren nicht.

Production lehnt rohe S3-Credentials aus Environment-Variablen ab und verlangt
injizierte rotierende Provider-Credentials plus Malware-Scanner. Endpunkte sind
HTTPS-only, Redirects verboten und Requests zeitlich begrenzt. Der sichere lokale
Default-Scanner liefert `pending`, wodurch das Objekt in Quarantäne bleibt.
Provider-Keys, SHA-256-Checksums, persistierte Token-Verifier und Organization-IDs
werden in öffentlichen Object-Antworten nicht ausgegeben.

## Verifikation

- Strict TypeScript: grün
- Vitest: 575 bestanden, 15 optionale Real-PostgreSQL-Tests übersprungen
- Next.js Production Build: grün
- Production Dependency Audit: 0 bekannte Schwachstellen
- PostgreSQL-17-Docker-Zertifizierung: um zwei Storage-Tests erweitert; lokal nicht
  ausgeführt, weil in der Arbeitsumgebung kein Docker-Programm vorhanden ist

## Bewusst offen

- Reale S3-kompatible Provider-/TLS-/Credential-Rotation-E2E
- Reale Malware-Engine mit Signaturupdate-, Timeout-, Ausfall- und Abuse-Matrix
- PostgreSQL-17-Races für gleichzeitige Quota-, Completion-, Delete- und Lifecycle-
  Übergänge; die neuen zwei Integrationstests sind in diesem Lauf übersprungen
- Multipart-/Resumable-Uploads, CDN und optionale Image-/Media-Transformationen
- Storage-Backup/Restore, Lasttest, Browser-/Accessibility-Smokes und unabhängiger
  Security-Test
- Die offenen Project-Auth-Live-Gates aus 1.3, Realtime, Functions, SDK/CLI,
  Billing und Managed Swiss Operations

Der Release ist ein Alpha-Quellstand und weder eine Managed-Production-Freigabe
noch eine vollständige Supabase-Alternative. Der nahtlose nächste Einstieg steht
in `docs/CLAUDE_HANDOFF.md`; historische Release Notes bleiben unverändert.
