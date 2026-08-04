# Release 1.6 Alpha 3 — Worker & Dead Letters

Release: `1.6.0-alpha.3` · Datum: 4. August 2026

## Ergebnis

QKERN ergänzt einen injizierbaren Queue-Worker mit Lease-Heartbeat, Handler-
Timeout, Abort/Shutdown und redigierter Observability. Owner und Administratoren
können Dead Letters ohne Payload einsehen und genau ein gebundenes Replay
anfordern. Kein Handler läuft im Next.js-Request.

## Enthalten

- `ProjectQueueWorker` mit service-role Claim, einem In-flight Handler, periodischer
  Lease-Erneuerung und exaktem Ack/Fail;
- feste Handlerfehler, servereigener Timeout und abortierbarer Shutdown;
- prozesslokale redigierte Zähler und strukturierte Events ohne Payload, Worker-ID,
  Dedupe- oder Lease-Secret;
- serialisierter `ProjectQueueWorkerRuntime` mit Probe-/Backoff-Grenze;
- Admin-only `GET .../dead-letters` und Same-Origin-geschütztes
  `POST .../dead-letters/{messageId}/replay`;
- Migration `0027_project_queue_dead_letter_replay.sql` mit same-tenant Self-FK,
  unveränderlicher Replay-Bindung und partiellem Unique-Index;
- Concurrent-idempotentes Replay mit Audit und ohne Ausführung im Request;
- OpenAPI, Tests, Status, Handbuch und Claude-Handoff.

## Verifikation

Strict TypeScript, **641 lokale Vitest-Tests**, der Next.js-Production-Build und
der Production-Dependency-Audit sind grün; **26** optionale Real-Service-Tests
blieben übersprungen. Der Audit meldet 0 bekannte Schwachstellen. Docker,
PostgreSQL, Podman und `psql` waren nicht verfügbar; der neue reale DLQ-Replay-Fall
ist daher implementiert, aber nicht ausgeführt.

## Grenzen und nächster Slice

Der Worker ist ein sicherer injizierbarer Port, noch kein allgemeiner Code-
Sandbox-Host. Zähler werden noch nicht extern exportiert. Reale Crash-/Soak-/Last-
und Multi-Instance-Evidenz bleibt offen. Nächster Slice `1.6.0-alpha.4`: Cron-
Definitionen, Webhook-Delivery und Function-Invocation als getrennte Ports mit
SSRF-/Egress-, Secret- und Ressourcen-Grenzen.
