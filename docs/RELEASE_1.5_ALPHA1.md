# QKERN 1.5 Alpha 1 — Realtime Foundation

Release: `1.5.0-alpha.1` · Datum: 4. August 2026

## Ergebnis

QKERN besitzt erstmals einen echten lokalen WebSocket-Durchstich für tenant- und
projektisolierte Channels, Broadcast, Presence und begrenzten Catch-up. Der Slice
ist modular hinter Authentifizierungs-, Autorisierungs-, Event-Log- und Transport-
Ports aufgebaut. Er ist eine Realtime Foundation, keine Production-Freigabe.

## Implementiert

- echter Node-/`ws`-Transport mit Subprotocol `qkern.realtime.v1`, exaktem Pfad,
  Origin-Allowlist, Text-only-Frames, Auth-Timeout, Heartbeat und Backpressure
- Authentifizierung ausschließlich im ersten Frame über Project API Key plus
  optional verifiziertes Project-Auth-Access-Token; keine URL-Credentials
- serverseitig abgeleitete `anon`-, `authenticated`- und `service_role`-Principals
- Scope-Isolation über Organisation, Projekt und Environment
- feste `public:`, `private:` und subjectgebundene `user:`-Channel-Policy
- Broadcast mit monotoner Channel-Sequenz und HMAC-signiertem Scope-Cursor
- begrenzter In-Memory-Event-Log, geordnetes Replay und fail-closed Stale-/Overflow-
  Verhalten ohne stilles Überspringen
- Presence mit privaten HMAC-Schlüsseln, Snapshot, Join und Leave
- Grenzen für Verbindungen, Frames, Rate, Subscriptions, JSON, Payload, Presence,
  History, Replay und Sendepuffer
- Schutz gegen verspätete Auth-Ergebnisse nach Socket-Close und generische,
  credential-freie Fehlerantworten
- eigener disabled-by-default Loopback-Runtime-Host und dokumentiertes Protokoll

## Prüfung

- 19 neue Unit-, Policy-, Replay-, Presence-, Gateway-, Runtime- und echte lokale
  WebSocket-Transporttests
- Strict TypeScript, vollständiger Vitest-Lauf, Next.js-Production-Build und
  Production-Dependency-Audit sind Release-Gates
- echte PostgreSQL-/Docker-/Last-/Multi-Instance-Zertifizierung war in dieser
  Arbeitsumgebung nicht verfügbar und wird nicht als bestanden behauptet

## Bewusst offen

- PostgreSQL CDC und persistenter Event Log
- horizontales Redis-/PostgreSQL-Fan-out und Multi-Instance-Ordering
- feingranulare, datenbankgestützte RLS-Policy pro Event
- Production-TLS-/Reverse-Proxy-/Origin-/DDoS-Grenze und Metriken
- Browser-Reconnect-SDK, Last-/Drop-/Soak-Tests und archivierte Real-Service-E2E

Darum verweigert `workers/realtime-runtime.ts` in Alpha 1 technisch jeden Start mit
`NODE_ENV=production`. Die nächsten 1.5-Slices dürfen diese Sperre erst entfernen,
wenn die fehlenden Betriebs- und Persistenzgrenzen implementiert und geprüft sind.
