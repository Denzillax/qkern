# Usage Metering und Quotas

Gültig für `1.8.0-alpha.1`. Dieser Slice liefert ein tenantgebundenes, monatliches
Usage-Ledger und atomare Quota-Entscheidungen. Er ist die Grundlage für spätere
Tarife und Rechnungen, aber selbst **kein Billing-System**.

## Umfang von Alpha 1

- sechs feste Metriken mit stabilen Einheiten;
- UTC-Kalendermonate als Abrechnungsfenster;
- idempotente, append-only Usage-Entscheidungen;
- `observe`- und hartes `enforce`-Limit;
- atomare Counter und optimistisch versionierte Quota-Policies;
- RLS-gebundener PostgreSQL-Adapter plus deterministischer Memory-Testport;
- read-only REST- und Console-Projektion für den aktuellen oder einen der
  vorherigen 23 Monate;
- verifier-only Event Keys und decimal-string Antworten ohne JavaScript-
  Präzisionsverlust.

Nicht enthalten sind Preise, Tarife, Währungen, Rechnungen, Steuern, Zahlungen,
Provider-Abgleich, Credits, Kostenalarme oder eine öffentliche API zum Ändern von
Limits. Bestehende Produktmodule erzeugen in Alpha 1 noch nicht automatisch alle
Usage Events; ohne vertrauenswürdigen Emitter zeigt die Projektion deshalb null.

## Feste Metriken

| Metrik | Einheit | Erlaubte Quellen |
| --- | --- | --- |
| `api_requests` | Operationen | Control Plane, Data Plane, Generated Data API, Project Auth, Project Storage, Project Queues, MCP |
| `database_row_reads` | Zeilen | Data Plane, Generated Data API |
| `storage_egress_bytes` | Bytes | Project Storage |
| `realtime_messages` | Operationen | Realtime |
| `queue_operations` | Operationen | Project Queues |
| `function_invocations` | Operationen | Compute |

Quellen dürfen keine fachfremde Metrik schreiben. Ein Event zählt höchstens
`1_000_000_000_000` Einheiten; ein Limit höchstens `9_000_000_000_000_000`.
Observed-Zeitpunkte dürfen höchstens sieben Tage zurück und fünf Minuten voraus
liegen.

## Quota-Entscheidung

Ohne Policy ist eine Metrik `unlimited`. Eine Policy besitzt ein positives Limit,
einen Modus und eine monotone Revision:

- `observe`: Der Counter wächst auch über das Limit; Status wird `exceeded`.
- `enforce`: Eine Überschreitung wird atomar abgelehnt; der Counter bleibt
  unverändert und das Event speichert `QUOTA_EXCEEDED`.

Statuswerte sind `unlimited`, `ok`, `warning`, `exhausted` und `exceeded`.
`warning` beginnt bei 80 Prozent. Eine abgelehnte Entscheidung wird ebenfalls
append-only gespeichert, damit derselbe Retry dauerhaft dasselbe Ergebnis erhält.

## Idempotenz und Parallelität

Jeder vertrauenswürdige Emitter liefert einen scope-intern eindeutigen
`idempotencyKey`. QKERN speichert nie den Rohwert, sondern nur SHA-256-Verifier und
einen Fingerprint aus Scope, Metrik, Quelle, Menge und Monatsfenster.

- derselbe Schlüssel und derselbe Fingerprint geben die ursprüngliche Entscheidung
  mit `deduplicated: true` zurück;
- derselbe Schlüssel mit verändertem Inhalt scheitert geschlossen;
- konkurrierende Events sperren zuerst den Schlüssel und dann den Monatscounter;
- Policy, Counter und Evententscheidung werden in einer PostgreSQL-Transaktion
  ausgewertet und geschrieben;
- ein hartes Limit kann dadurch auch bei Parallelrennen nicht überbucht werden.

## Persistenz und Tenant-Grenze

Migration `0028_usage_metering.sql` ergänzt:

| Tabelle | Inhalt |
| --- | --- |
| `usage_quota_policies` | ein versioniertes Limit je Projektumgebung und Metrik |
| `usage_counters` | monatlicher atomarer Zähler je Metrik |
| `usage_events` | unveränderliche, redigierte Entscheidungsbelege |

Alle Tabellen tragen Organisation, Projekt und Umgebung, besitzen zusammengesetzte
Projekt-Fremdschlüssel und RLS. Die Runtime arbeitet ausschließlich innerhalb
einer tenantgebundenen Transaktion. Trigger verhindern Event-Updates/-Deletes,
rückläufige Counter und übersprungene Policy-Revisionen. Rohschlüssel, Preise,
Payloads und Provider-Credentials gehören nicht in diese Tabellen.

## Autoritäten

| Rolle | Erlaubt |
| --- | --- |
| `reader` | Projektion des eigenen Scopes lesen |
| `meter` | Events für den eigenen Scope und eine erlaubte Quelle erfassen |
| `operator` | Projektion lesen und interne Quota-Policy mit erwarteter Revision setzen |

Der Browser erhält nur `reader`. Es gibt in Alpha 1 keine öffentliche REST- oder
MCP-Mutation für Policies und keine Event-Ingestion-Route. Emitter und Operatoren
sind interne, dependency-injizierte Ports. Organisation, Projekt und Umgebung
werden nie aus einer frei behaupteten Browser-Payload übernommen.

## Read-only API

```http
GET /api/v1/projects/{projectId}/environments/{environment}/usage?period=2026-08
Cookie: __Host-qkern_session=...
```

`period` ist optional und exakt einmal erlaubt. Antworten sind `no-store`. Jede
Metrik ist immer vorhanden; `used`, `limit` und `remaining` sind Dezimalstrings.
Event Keys, einzelne Events und Kosten werden nicht ausgegeben.

Beispielausschnitt:

```json
{
  "data": {
    "period": "2026-08",
    "metrics": [{
      "metric": "queue_operations",
      "unit": "operations",
      "used": "4200",
      "limit": "10000",
      "remaining": "5800",
      "mode": "enforce",
      "status": "ok",
      "revision": 2
    }]
  }
}
```

## Aktivierung

Lokal ist die Funktion absichtlich aus:

```powershell
$env:QKERN_USAGE_METERING_ENABLED="true"
npm run dev
```

Der lokale Memory-Port verliert Daten beim Neustart. Production akzeptiert ihn
nicht. Dauerhafte Nutzung erfordert `QKERN_RUNTIME_MODE=postgres`, die getrennte
Runtime-URL und kontrolliert angewendete Migration 0028.

## Tests und offene Gates

Die lokale Suite prüft Idempotenzkonflikte, harte parallele Limits, `observe`,
Tenant-/Quellen-/Periodengrenzen, Policy-Revisionen, HTTP-Redaktion, Runtime-Deny
und den statischen Migrationsvertrag. Vier optionale PostgreSQL-Fälle prüfen harte
Concurrent-Limits, verifier-only Persistenz, Restart-Replay, dauerhafte Projektion
und Cross-Tenant-RLS.

Vor kommerziellem Betrieb fehlen weiterhin echte archivierte PostgreSQL-Last- und
Crash-Races, transaktionale Emitter in Data/Storage/Realtime/Queues/Compute,
Reconciliation mit Providerwerten, Metrics/Alerts, Retention/Export, Tarife,
Rechnungs- und Zahlungsintegration sowie unabhängige Security-/Finanzprüfung.
