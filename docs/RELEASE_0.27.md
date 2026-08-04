# Release 0.27 — Fail-closed Background Runtime Readiness

## Ergebnis

QKERN 0.27 ergänzt einen gemeinsamen Liveness-/Readiness-Vertrag für den Projekt-Datenbank-Provisioner, den Migration Worker sowie die Apply- und Incident-Publisher. Jeder Host kann optional einen kleinen, ausschließlich an `127.0.0.1` gebundenen HTTP-Listener starten. Die Probe ist standardmäßig deaktiviert und besitzt keine Browser-, Tenant-, Datenbank- oder Secret-Autorität.

`/live` bestätigt nur den laufenden Prozess. `/ready` wird erst nach einem erfolgreichen Poll grün, fällt bei Queue-/Control-Plane-Fehlern sofort auf `503`, veraltet ohne aktuellen Erfolg und bleibt bei Clock-Rollback, Startup und Shutdown geschlossen. Ein externer Provider- oder Jobfehler, der vom Zustandsautomaten sicher verarbeitet wurde, wird nicht mit Prozessunfähigkeit verwechselt.

## Sicherheitsgrenzen

- fester Listener `127.0.0.1`; `0.0.0.0`, andere Hosts und privilegierte Ports werden abgewiesen
- nur `GET` und `HEAD` auf exakt `/live` und `/ready`
- feste `text/plain`-Antworten mit `no-store` und ohne IDs, Zeitpunkte, Prozesse, Endpoints oder Fehlerursachen
- Observer-Ausfälle können Queue-, Migration-, Publish- oder Provisioning-Ergebnisse nicht verändern
- Startup, letzter Poll-Fehler, Veraltung, rückwärts laufende Uhr und Shutdown sind fail-closed
- keine neue öffentliche API und keine Control-Plane-Datenbankmigration

## Betrieb

Aktivierung und sichere `exec`-Probe sind in `docs/RUNTIME_PROBES_RUNBOOK.md` dokumentiert. Bei getrennten Containern kann derselbe Default-Port `9464` verwendet werden; mehrere Prozesse im selben Netzwerk-Namespace benötigen unterschiedliche Ports. Die Probe darf nicht an Service oder Ingress exponiert werden.

## Validierung

- Strict TypeScript Typecheck
- 453 erfolgreiche automatisierte Tests in 72 Testdateien
- 9 bewusst übersprungene Real-PostgreSQL-Tests ohne bereitgestellten Dienst
- erfolgreicher Next.js-Production-Build
- Production-Dependency-Audit: 0 Critical, 0 High, 2 Moderate in der MCP-SDK→`@hono/node-server`-Transitivkette
- direkte Probe-Integrationstests für alle vier Runtime-Schleifen sowie Negativtests für Startup, Fehler, Veraltung, Clock-Rollback, Shutdown, Methoden und Bindings

## Keine Production-Freigabe

0.27 stellt den sicheren lokalen Orchestrator-Vertrag bereit, aber noch keine überwachten Production-Deployments. Reales Scraping, Alarmrouting, Pod-/Container-Restart- und Shutdown-Zertifizierung, Provider-/Broker-/Pager-Onboarding, Live-Vault-/PostgreSQL-/Target-Races und archivierte Restore-Drills bleiben offen. Production-Apply bleibt bis zu diesen Nachweisen und den übrigen Gates aus `docs/QA.md` deaktiviert.
