# QKERN 1.3.0 Alpha 1 — Project Auth

Datum: 3. August 2026

## Ergebnis

Dieser Release liefert den ersten ausführbaren Project-Auth-Vertical-Slice. App-
User bleiben vollständig von QKERN-Control-Plane-Accounts und Memberships getrennt
und sind exakt an Organisation, Projekt und Environment gebunden.

## Enthalten

- Email/Passwort-Signup und Login mit separatem Argon2id-Pepper
- Email-Verifikation, Magic Link und Passwort-Reset mit kurzen, einmaligen und nur
  als Verifier gespeicherten Tokens
- Ed25519-Access-JWTs mit 15 Minuten Standard-TTL, exaktem Issuer/Audience/Scope,
  Sessionbindung und JWKS mit aktueller plus bis zu fünf vorherigen Public Keys
- Opaque Refresh Tokens mit atomarer Einmalrotation; Replay kompromittiert und
  widerruft die gesamte Tokenfamilie
- Sofortige Revocation durch persistierte User-/Session-Prüfung bei jedem Access-JWT
- TOTP-MFA, AES-256-GCM-geschützte Secrets, AAL1/AAL2 und einmalige Recovery Codes,
  deren Werte nur als HMAC-Verifier gespeichert werden
- OIDC Authorization Code + PKCE mit State/Nonce, serverseitig festen HTTPS-
  Endpunkten, no-redirect Transport sowie RS256/ES256/EdDSA-ID-Token-Prüfung
- Öffentliche REST-Flows mit exaktem Projekt-Key, expliziter CORS-Allowlist,
  no-store Responses und enumeration-safe E-Mail-Anforderungen
- Owner-/Administrator-Admin-API zum Listen, Aktivieren und Deaktivieren von App-
  Usern sowie eine datenbasierte Console-Sicht ohne Demo-Accounts
- App-JWT plus passender Projekt-Key als servergeprüfte Claims für die Generated
  Data API; freie Client-Claims erhalten keinen RLS-Autoritätspfad
- OpenAPI-3.1-Vertrag und Migration `0024_project_auth.sql`
- Gepatchte Transitivgrenzen `fast-uri` 4.1.2 und `ip-address` 10.4.0 für einen
  Production-Dependency-Audit ohne bekannte Critical/High/Moderate-Befunde

## Sicherheitsgrenzen

Project Auth ist disabled-by-default. Production verlangt exakte HTTPS-Origins,
einen Ed25519-Private-Key, einen getrennten Passwort-Pepper und einen 32-Byte-MFA-
Encryption-Key. Das Entwicklungsflag für zurückgegebene Delivery-Tokens wird in
Production technisch abgewiesen. Ohne injizierten Delivery-Adapter bleiben Verify,
Magic Link und Passwort-Reset dort fail-closed. OIDC-Provider und Endpunkte stammen
nur aus Serverkonfiguration; Redirects, unsafe URLs und unpassende Claims scheitern.

Migration `0024_project_auth.sql` führt eigene App-User-, Session-, Einmal-Token-,
MFA- und OIDC-Identity-Tabellen ein. Scope ist triggergeschützt unveränderlich,
Tokenmaterial wird nie roh gespeichert, `qkern_auth` erhält nur die benötigten
Spaltenrechte und `qkern_runtime` keinen direkten Tabellenzugriff.

## Verifikation

- Strict TypeScript: grün
- Vitest: 551 bestanden, 13 optionale Real-PostgreSQL-Tests übersprungen
- Next.js Production Build: grün
- Production Dependency Audit: 0 Critical, 0 High, 0 Moderate
- PostgreSQL-17-Docker-Zertifizierung: Harness erweitert; lokal nicht ausgeführt,
  weil in der Arbeitsumgebung kein Docker-Programm vorhanden ist

## Bewusst offen

- Reale Mail-/Delivery-Integration und deren Bounce-/Retry-/Abuse-E2E
- Reale OIDC-Provider-E2E, Key-Rotation und Provider-Ausfallmatrix
- Vollständiger Account-Lifecycle gegen den PostgreSQL-17-Docker-Stack
- Browser-, Accessibility-, Last- und unabhängige Security-Zertifizierung
- Storage, Realtime, Functions, SDK/CLI, Billing und Managed Swiss Operations

Der Release ist ein Alpha-Quellstand und keine Managed-Production- oder vollständige
Supabase-Alternative. Der nahtlose nächste Einstieg steht in
`docs/CLAUDE_HANDOFF.md`; historische Release Notes bleiben unverändert.
