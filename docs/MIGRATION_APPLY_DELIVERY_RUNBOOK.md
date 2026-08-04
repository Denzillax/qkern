# Migration Apply Delivery Runbook

Dieser Ablauf behandelt ausschließlich die Zustellung eines bereits autorisiert erzeugten `migration.apply.requested`-Events an den Apply-Broker. Er genehmigt keine Migration, führt kein SQL aus und ersetzt keine Target-Ledger-Prüfung.

## 1. Zustand feststellen

1. `GET /api/v1/migrations/delivery/health` aufrufen. `critical` bedeutet mindestens ein Dead Letter oder einen aktiven Signing-Key-Ausfall. `degraded` bedeutet einen anderen aktiven Zustellfehler, ein seit fünf Minuten pendentes Event oder ein abgelaufenes Lease.
2. Für das betroffene Job-Handle `GET /api/v1/migrations/{jobId}/delivery` lesen und `status`, `lastFailureCode`, `retryCycleCount`, `maxRetryCycles` sowie `retryCommandPending` sichern.
3. Keine Outbox-Tabelle manuell ändern. Lease-Inhaber/-Token, Brokerantworten und Credentials sind absichtlich nicht Teil der Operator-Sicht.

## 2. Ursache beheben

- `SIGNING_KEY_UNAVAILABLE`: private Schlüsseldatei beziehungsweise Provider-Verfügbarkeit und Key-ID-Überlappung korrigieren. Die Datei atomar ersetzen, nicht in-place teilweise überschreiben.
- `DELIVERY_TIMEOUT`: Broker-Verfügbarkeit, Egress und Timeout-Budget prüfen. `QKERN_APPLY_BROKER_TIMEOUT_MS` muss mindestens 1000 ms unter `QKERN_OUTBOX_LEASE_MS` bleiben.
- `DESTINATION_REJECTED`: Endpoint, Broker-Authentisierung, Tenant-/Topic-ACL und Receiver-Status beheben.
- `INVALID_ACK`: Receiver muss Content-Type JSON und exakt `{"status":"ack","eventId":"<Event-ID>"}` liefern.
- `PUBLISH_FAILED`: Prozess-, DNS-/TLS- und Transportzustand anhand externer, credentialfreier Infrastrukturtelemetrie prüfen.

Der Receiver muss Signatur und Timestamp vor Verarbeitung prüfen und jede Event-ID idempotent behandeln. Ein HTTP-Erfolg ohne exaktes Ack gilt nicht als Zustellerfolg.

## 3. Begrenzte Recovery anfordern

Nur Owner oder Administratoren dürfen einen Dead Letter öffnen. Unmittelbar nach der Detailabfrage:

```http
POST /api/v1/migrations/{jobId}/delivery/retry
Content-Type: application/json

{
  "reasonCode": "destination_recovered",
  "expectedFailureCode": "DELIVERY_TIMEOUT",
  "expectedRetryCycle": 1
}
```

Kompatibilität:

| Fehlercode | Erlaubte Gründe |
|---|---|
| `SIGNING_KEY_UNAVAILABLE` | `credentials_rotated` |
| `DESTINATION_REJECTED` | `destination_recovered`, `credentials_rotated`, `provider_incident_resolved` |
| `PUBLISH_FAILED`, `INVALID_ACK`, `DELIVERY_TIMEOUT` | `destination_recovered`, `provider_incident_resolved` |

`202` legt erstmals das exakte Command an, `200` bestätigt dessen idempotente Wiederholung. `409` bedeutet, dass Zustand oder Retry-Generation nicht mehr dem gelesenen Snapshot entsprechen, ein anderes Command pendent ist oder drei Recovery-Zyklen ausgeschöpft sind. Dann neu lesen; niemals Werte raten.

## 4. Nachweis und Eskalation

1. Publisher-Telemetrie auf `migration_outbox.retry_command_applied`, `retry_command_rejected`, `dead_lettered` und `published` überwachen.
2. Detail- und Health-Sicht erneut lesen. Nur `published` mit passendem Event-ID-Ack beweist Brokerzustellung, nicht die SQL-Ausführung.
3. Nach drei ausgeschöpften Recovery-Zyklen an Platform Engineering eskalieren. Keine Zähler, Commands oder Outbox-Zustände per SQL zurücksetzen.
4. Bei Verdacht auf Credential-Offenlegung Schlüssel rotieren, alte Key-ID nach kontrollierter Überlappung widerrufen und Logs/Traces auf unzulässige Daten prüfen. Der QKERN-Vertrag selbst loggt keine Secrets oder Rohantworten.

## Not-Aus

`SIGTERM` oder `SIGINT` stoppt neue Claims und lässt die aktive Iteration gefenct auslaufen. Alternativ `QKERN_OUTBOX_PUBLISHER_ENABLED=false` für den nächsten kontrollierten Start setzen. Das Stoppen des Publishers verändert weder Migration-Job noch Change Set und führt kein SQL aus.
