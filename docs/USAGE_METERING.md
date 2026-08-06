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
Limits.

Seit `1.29.0` melden **Project Queues** und **Functions** selbst, seit `1.31.0`
auch **Generated Data API** und **Storage**. Damit melden vier der sechs
Metriken.

Seit `1.32.0` zählt auch `api_requests`, seit `1.33.0` Realtime. Damit melden
**alle sechs Metriken**.

## Gebündelt: `realtime_messages`

Eine Control-Plane-Transaktion je Broadcast wäre auf dem Realtime-Pfad ein
absehbarer Fehler. `BufferedUsageEmitter` sammelt deshalb je Scope und Metrik
und schreibt gebündelt — beim Erreichen einer Menge, in einem Intervall und beim
Herunterfahren des Prozesses.

Der Preis ist doppelt und wird hier ausdrücklich genannt:

- **Der Emitter kann nicht gaten.** Man kann keine Nachricht ablehnen, die
  bereits in einem offenen Stapel gezählt ist.
- **Ein Absturz verliert den Puffer.** Das ist die gewählte Richtung: lieber zu
  wenig zählen als zu viel. Wer zu viel zählt, stellt in Rechnung, was nie
  stattgefunden hat.

Ein Stapel, den das Ledger nicht erreicht hat, wird **unverändert** und mit
demselben Schlüssel erneut gesendet — ein doppelt angekommener Stapel zählt
trotzdem einmal. Ein Stapel, über den das Ledger entschieden hat, wird
verworfen: Ein erneuter Versuch bekäme dieselbe Antwort.

Gezählt wird die Nachricht im Log, nicht die Zustellungen daraus. Ein Kanal mit
hundert Abonnenten erzeugt eine Nachricht, nicht hundert.

## `api_requests` an der HTTP-Grenze

Diese Metrik entsteht nicht in einem Dienst. Eine Route ruft mehrere
Dienstmethoden; eine Messung je Methode wäre kein Ersatz, sondern systematisch
zu hoch.

Gezählt wird deshalb dort, wo eine Anfrage genau einmal ihren Scope bekommt: im
**Kontext-Resolver** des jeweiligen Moduls — `adminProjectQueueContext`,
`applicationProjectQueueContext`, `adminProjectStorageContext`,
`applicationProjectStorageContext` und `generatedDataContext`. Der Aufruf steht
am **Ende** des Resolvers: Eine Anfrage, die schon an der Authentifizierung
scheitert, hat keinen Scope, den man belasten könnte, und einen fremden zu
belasten wäre schlimmer, als sie nicht zu zählen.

Anders als bei den nachträglichen Metriken ist die Menge hier **vorher**
bekannt: genau eins. Deshalb darf und soll `api_requests` gaten. Ein
erschöpftes hartes Limit beantwortet die Anfrage mit `429` — „später
wiederkommen", nicht „kaputt".

Der Helfer liegt in `lib/server/usage/api-requests.ts`, bewusst nicht in
`usage/http.ts`: Dort steht die HTTP-Fläche der Usage-Projektion selbst.

## Metriken ohne hartes Limit

Drei Metriken stehen in `UNENFORCEABLE_USAGE_METRICS`, aus zwei verschiedenen
Gründen.

**Nachträglich**: `database_row_reads` und `storage_egress_bytes` stehen erst
fest, wenn die Arbeit getan ist. Wie viele Zeilen eine Abfrage liefert, weiss
man nach der Abfrage.

**Gebündelt**: `realtime_messages` ist beim Schreiben längst gezählt.

Für alle drei gilt: **`enforce` ist nicht setzbar.**
Ein hartes Limit könnte dort nichts mehr verhindern und würde nur aufhören zu
zählen — ein Zähler, der stehen bleibt, während die Nutzung weiterläuft, ist
schlimmer als gar keiner. `setQuota` weist den Modus mit
`USAGE_INVALID_INPUT` ab; `observe` bleibt erlaubt.

Deshalb dürfen die beiden Emitter ihre Antwort ignorieren: Das Ledger kann diese
Ereignisse gar nicht ablehnen. Das ist keine Nachlässigkeit, sondern eine
abgesicherte Eigenschaft.

Gezählt wird bei Storage die **freigegebene**, nicht die ausgelieferte Menge.
Die Auslieferung übernimmt der Provider direkt; QKERN sieht sie nie und könnte
sie nur schätzen. Eine Freigabe, die niemand einlöst, zählt deshalb mit — und
das ist ein Grund mehr, diese Zahl nicht als Abrechnungsbeleg zu verwenden.

Bei der Generated Data API zählt, was der Aufrufer tatsächlich bekommt. Die eine
Zeile über dem Limit dient nur dazu, `hasMore` zu bestimmen, und verlässt QKERN
nie.

## Der Emitter

`lib/server/usage/emitter.ts` ist der vertrauenswürdige Emitter, den dieser
Slice seit Alpha 1 voraussetzt. Er hat **eine** Methode:

```ts
admit(scope, { metric, reference, quantity?, observedAt? }): Promise<UsageAdmission>
```

Sie meldet die Operation und gibt zurück, ob sie stattfinden darf. Eine zweite
Methode ohne Antwort hätte einen zweiten Codepfad ergeben, auf dem ein hartes
Limit nicht greift — und eine Grenze, die an einer Stelle wirkt und an einer
anderen nicht, ist schlimmer als gar keine. Wer nicht gaten will, ignoriert die
Antwort sichtbar.

Der Emitter besitzt den `meter`-Principal. Ein Produktmodul, das sich seinen
eigenen bauen dürfte, könnte in einen fremden Scope schreiben.

Er baut auch den Idempotenzschlüssel: `<quelle>:<metrik>:<bezug>`. Der
Schlüsselraum ist **scope-weit**, nicht metrikweit; zwei Module mit derselben
Kennung würden sich sonst gegenseitig deduplizieren.

**Gezählt wird die Operation, nicht ihr Ergebnis.** Ein Aufruf, der scheitert,
hat trotzdem einen Container gestartet; ein deduplizierter Enqueue hat trotzdem
stattgefunden.

### Transaktional, wo es eine Transaktion gibt

Seit `1.30.0` nehmen `consume`, `record` und `admit` eine **laufende**
Transaktion entgegen. `ProjectQueueRepository.enqueue` erhält dafür einen
`ProjectQueueMeter`, der innerhalb der Enqueue-Transaktion läuft: nach dem
Schreiben der Nachricht, vor dem Festschreiben.

Damit gilt beides zusammen oder keines von beidem. Lehnt die Messung ab, rollt
die bereits geschriebene Nachricht mit zurück. Bis `1.29.0` lag zwischen Zählung
und Schreiben ein Fenster, in dem ein Absturz eine Nachricht zählte, die es nie
gab.

Alle Sperren des Ledgers sind transaktionsgebunden (`pg_advisory_xact_lock`,
`FOR UPDATE`). Sie enden mit der Transaktion, in der sie genommen wurden — der
eigenen wie der fremden. Ohne diese Eigenschaft wäre eine mitbenutzte
Transaktion nicht möglich, ohne Sperren zu verlieren oder zu lange zu halten.

Die Messung steht dabei **hinter** den Konflikten der Operation. Eine wegen
voller Warteschlange abgewiesene Nachricht verbraucht kein Kontingent.

Der **Function-Aufruf bleibt nicht-transaktional**. Er schreibt nichts in die
Control Plane, mit dem er atomar sein könnte; ein Container startet oder startet
nicht. Dort bleibt es bei der Reihenfolge: erst messen, dann starten.

Der Memory-Port hat keine Transaktion und ignoriert das Argument. Für Produktion
war er ohnehin nie zugelassen.

### Zwei Ausfallsemantiken

| Wann | Verhalten |
| --- | --- |
| Fehlkonfiguration beim Start | abweisen — niemand soll unbemerkt ohne Zähler laufen |
| Messung fällt im Betrieb aus | durchlassen (`QKERN_USAGE_EMITTER_ON_FAILURE=admit`) |
| Schlüssel wiederverwendet, Inhalt verändert | immer abweisen |

Die mittlere Zeile ist bewusst nicht fail-closed. Eine Quota ist eine
kaufmännische Grenze, keine Sicherheitsgrenze: Der Schaden eines kurz nicht
gezählten Aufrufs ist begrenzt und nachträglich abgleichbar, der Schaden einer
Plattform, die bei jedem Datenbankschluckauf jede Operation abweist, ist es
nicht. `reject` stellt das um.

Ein erschöpftes Kontingent beantwortet REST mit `429` und den Codes
`QUEUE_QUOTA_EXCEEDED` beziehungsweise `COMPUTE_QUOTA_EXCEEDED` — ausdrücklich
getrennt von `QUEUE_CAPACITY_EXCEEDED` und `COMPUTE_AT_CAPACITY`, damit eine
volle Warteschlange nicht wie ein erreichtes Limit aussieht.

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

Seit `1.29.0` kommen neun lokale Emitter-Fälle und sieben PostgreSQL-Fälle dazu.
Die sieben messen nicht den Emitter, sondern seine Wirkung: echter Zählerstand
nach echter Operation, ein hartes Limit, das den Enqueue abweist ohne eine
Nachricht zu schreiben, und ein erschöpftes Kontingent, das den Function-Aufruf
abweist ohne den Invoker zu starten.

Seit `1.30.0` kommen drei weitere PostgreSQL-Fälle dazu: eine abgewiesene
Nachricht verbraucht kein Kontingent; eine abgelehnte Zählung rollt die bereits
geschriebene Nachricht zurück; acht gleichzeitige Enqueues über vier Queues
ergeben genau acht Nachrichten und Zählerstand acht.

Vor kommerziellem Betrieb fehlen weiterhin echte archivierte PostgreSQL-Last- und
Crash-Races, Emitter in Data/Storage/Realtime, Reconciliation mit Providerwerten,
Metrics/Alerts, Retention/Export, Tarife, Rechnungs- und Zahlungsintegration
sowie unabhängige Security-/Finanzprüfung.
