# Release 1.6 Alpha 4 — Compute Contracts

Release: `1.6.0-alpha.4` · Datum: 4. August 2026

## Ergebnis

QKERN ergänzt ausführbare Sicherheitsverträge für Functions, Cron und Webhooks.
Function-Images sind digest-gepinnt und an feste Ressourcen-/Egress-/Secret-Ref-
Grenzen gebunden. Cron dispatcht deterministisch in Project Queues. Webhooks sind
signiert, HTTPS/443-only, redirectfrei, timeoutbegrenzt und verlangen Exact-Ack.

## Enthalten

- `lib/server/compute` mit getrenntem Modell, Sandbox-, Signer-, Transport- und
  Queue-Ports;
- Function-Definitionen für `nodejs24`, SHA-256-Image-Digest, Timeout, Memory,
  Concurrency, Egress-Origin und Secret-Referenzen;
- bounded JSON-In/Out und sichere Response-Header;
- UTC-Cron-Parser für bounded Intervalle und tägliche Ausführung;
- deterministische Cron→Queue-Dedupe-Schlüssel;
- Webhook-Ziel-, Payload-, Event-, Signatur-, Redirect-, Timeout- und Exact-Ack-
  Validierung ohne Secret-Wert im Delivery-Port;
- neun neue Contract-/Negativtests und vollständige Dokumentation.

## Verifikation

Strict TypeScript, **650 lokale Vitest-Tests**, der Next.js-Production-Build und
der Production-Dependency-Audit sind grün; **26** optionale Real-Service-Tests
blieben übersprungen. Audit: 0 bekannte Schwachstellen.

## Grenzen

Das ist ein sicherer interner Port, noch keine Production-Functions-Plattform.
Persistente Definitionen, Scheduler-Leases, Webhook-Outbox, DNS/IP-Pinning,
Sandbox-Adapter, CPU/Ephemeral-Disk-Kill, Metrics und Provider-E2E bleiben offen.
Stufe 1.6 bleibt deshalb Alpha. Der nächste aktive Slice ist Stufe 1.7 Developer
Experience: SDK, Typed Clients, CLI, Schema/Migration/Seed und Fresh-Install-E2E.
