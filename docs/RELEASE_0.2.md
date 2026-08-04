# QKERN 0.2 – autonomer Hardening-Stand

## Fertig in dieser Iteration

- vollständiger Browser-Accountfluss für Registrierung, Login, Session, Logout und persönlichen Workspace
- serverseitige Rollen- und Tenant-Autorisierung ohne Vertrauen in Client-Actor oder Organisationsheader
- native Argon2id-Passwort-Hashes, nur gehashte Session-Tokens sowie Secure/HttpOnly/SameSite-Strict-Cookies
- echte PostgreSQL-Repositories, tenantgebundene Transaktionen, zusammengesetzte Tenant-FKs, erzwungene RLS und append-only Audit-Hash-Kette
- SQL-AST-Prüfung, Secret-Redaction sowie Approval Action Hash, 24-Stunden-TTL und Replay-Schutz
- gehärtete MCP-Session-Limits, Ablaufprüfung, erforderlicher Scope-Kontext und klar markierte Beispieldaten
- OpenAPI 3.1, lokale Infrastruktur nur an Loopback gebunden und 45 automatisierte Tests

## Bewusst offene Produktionsgrenzen

- Die direkt startbare Web-Demo verwendet noch prozesslokale Adapter; die PostgreSQL-Repositories sind implementiert und getestet, aber noch nicht der Standardadapter.
- Database/Table/Auth-provider/Storage/API/Monitoring/Backup und Teile der AI-/SQL-Oberfläche sind deutlich als Product Preview markiert.
- Remote MCP benötigt vor Multi-Tenant-Go-Live OAuth/OIDC, Scope-Prüfung und Token-Widerruf statt eines statischen Bearer-Tokens.
- `npm audit --omit=dev` meldet zwei moderate Befunde aus dem transitiven Next.js-`postcss` ohne verfügbare Korrektur; es gibt keine offenen Critical/High Findings.
- Produktives E2E gegen PostgreSQL/Redis/S3, externer Pentest und belegte Schweizer Datenresidenz bleiben Release Gates.
