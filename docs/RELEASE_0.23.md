# Release 0.23 — Project Database Provisioner Boundary

## Ergebnis

QKERN 0.23 implementiert die bisher fehlende interne Control-Plane-Grenze für eine Datenbank pro Projektumgebung. Ein autorisierter Webrequest legt ausschließlich einen persistenten Provisioning-Auftrag an. Ein separater Least-Privilege-Prozess claimt ihn gefenct, sendet einen signierten reference-only Vertrag an einen externen Infrastruktur-Broker und bindet dessen geprüftes secret-freies Ergebnis atomar an eine noch pendente Umgebung.

Der externe Provider bleibt bewusst außerhalb von QKERN. Provider-Credentials und Projekt-Datenbank-Passwörter werden weder übertragen noch gespeichert. Der Migration Worker lädt das unveränderliche Binding tenantgebunden aus der Control Plane und bezieht rotierende Credentials weiterhin ausschließlich aus Vault.

## Sicherheitsänderungen

- Neue, überschneidungsfrei geprüfte Non-Login-Rolle `qkern_provisioner` und lokaler Login `qkern_provisioner_app`
- Entzug direkter Projekt- und Environment-Updates vom Web-Login
- RLS-geschützte, tenantgebundene Provisioning-Jobs mit `FOR UPDATE SKIP LOCKED`, Lease-Owner, zufälligem Lease-Token und Ablauf-Fencing
- Genau fünf bestätigte Versuche pro Zyklus und höchstens drei actor-gebundene Recovery-Zyklen; Shutdown-Abbrüche zählen nicht als Providerfehler
- Unveränderliches Binding-Ledger ohne Passwort, Provider-Token oder Connection String
- Auf den exakten Ledger-/Fence-Bootstrapvertrag gepinnter SHA-256
- HMAC-signierter Brokeradapter mit pro Anfrage neu aufgelöstem Schlüssel, exact-host Production-HTTPS/443, deaktivierten Redirects, gemeinsamem Timeout und begrenzter Response
- Persistierter Vault-Katalog mit tenantgebundener Binding-Auflösung, Bootstrap-Pin, Singleflight und redigierter Serialisierung
- Owner-/Administrator-only Request, redigierter Lesestatus für Owner, Administrator, Deployer und Support sowie non-enumerating 404-Fehler

## Öffentliche Verträge

- `GET /api/v1/projects/{projectId}/environments/{environment}/provisioning`
- `POST /api/v1/projects/{projectId}/environments/{environment}/provisioning`
- `npm run provisioner:projects`
- `QKERN_PROJECT_DATABASE_CATALOG_SOURCE=control-plane` als Production-Resolver
- Migration `db/migrations/0020_project_database_provisioning.sql`

Die POST-Route nimmt ausschließlich ein leeres JSON-Objekt an, führt keine Infrastrukturaktion im Request aus und liefert `executed: false`. Erstanforderung und Recovery liefern HTTP 202; eine identische bereits existierende Anforderung HTTP 200.

## Validierung

- Strict TypeScript Typecheck
- 415 erfolgreiche automatisierte Tests in 66 Testdateien
- 9 bewusst übersprungene Real-PostgreSQL-Tests ohne bereitgestellten Dienst
- OpenAPI 3.1 auf Version 0.23.0 mit redigiertem Provisioning-Vertrag
- Erfolgreicher Next.js-Production-Build einschließlich der neuen dynamischen Provisioning-Route
- Production-Dependency-Audit: 0 Critical, 0 High, 2 Moderate (`next`/gebundenes `postcss`), kein verfügbarer Fix in der aktuellen Auflösung

## Keine Production-Freigabe

0.23 stellt die ausführbare QKERN-Grenze bereit, aber keinen live angebundenen Cloud-Provider. Provider-Onboarding, reale PostgreSQL-/Vault-/Zertifikat-Rotation, Crash-/Timeout-Interleavings, SLO-Alarmierung, Restore-/Compliance-Evidenz und alle übrigen Gates aus `docs/QA.md` bleiben offen. Production-Apply bleibt bis zu deren Nachweis deaktiviert.
