# QKERN Realtime Protocol v1

Dieses Dokument beschreibt den in `1.5.0-alpha.1` eingeführten und seither
unverändert geltenden ausführbaren Vertrag.

Der Satz, der hier bis zu diesem Slice stand, galt seit `1.72.0` nicht mehr:
Der Transport verweigerte `NODE_ENV=production` bedingungslos. Seit `1.73.0`
steht dort ein Tor mit benannten Bedingungen, und der Start dagegen ist jetzt
belegt. Der Stack `docker-compose.realtime-certification.yml` führt ein
PostgreSQL mit eigener CA, das jede Verbindung ohne TLS abweist; der
ausgelieferte Prozess läuft davor unter `production` an, und `pg_stat_ssl`
nennt für jede seiner Verbindungen Version und Cipher. Im selben Stack steht ein
echter Vault, und Postgres Changes laufen unter `production` darüber. Was
Production heute noch nicht kann, steht unter „Grenzen unter Production".

## Verbindung und Authentifizierung

- URL: `ws://127.0.0.1:8788/realtime/v1/projects/{projectId}/environments/{environment}`
- Subprotocol: `qkern.realtime.v1`
- Environment: exakt `development`, `staging` oder `production`
- Origin: muss exakt in `QKERN_REALTIME_ALLOWED_ORIGINS` stehen
- Query-String: vollständig verboten; Credentials gehören nie in URLs
- Binärframes: verboten

Der erste Textframe ist immer die Authentifizierung:

```json
{
  "type": "auth",
  "requestId": "auth-1",
  "projectKey": "<qk_public_... oder qk_service_...>",
  "accessToken": "<optionales Project-Auth-Access-JWT>"
}
```

Ohne `accessToken` wird aus dem serverseitig verifizierten Project Key `anon` oder
`service_role`. Mit Token wird der Principal ausschließlich nach erfolgreicher
Project-Auth-Prüfung `authenticated`. Organisation, Projekt, Umgebung, Rolle und
Subject werden nie aus Client-Claims übernommen. Erfolg:

```json
{"type":"ready","requestId":"auth-1","connectionId":"...","heartbeatSeconds":30}
```

## Client-Kommandos

Jedes Kommando ist ein striktes JSON-Objekt ohne zusätzliche Felder.

```json
{"type":"subscribe","requestId":"sub-1","channel":"private:orders"}
{"type":"subscribe","requestId":"sub-2","channel":"private:orders","cursor":"qk_rt_..."}
{"type":"unsubscribe","requestId":"unsub-1","channel":"private:orders"}
{"type":"broadcast","requestId":"send-1","channel":"private:orders","event":"order.created","payload":{"id":"order-1"}}
{"type":"presence.track","requestId":"track-1","channel":"private:orders","state":{"online":true}}
{"type":"presence.untrack","requestId":"track-2","channel":"private:orders"}
{"type":"ping","requestId":"ping-1","nonce":"client-1"}
```

Broadcast und Presence setzen ein vorher erfolgreiches Subscribe derselben
Verbindung voraus. Eventnamen beginnen mit einem Kleinbuchstaben und enthalten
höchstens 64 Zeichen aus `a-z`, `0-9`, Punkt, Unterstrich und Bindestrich.

## Channel-Policy

| Channel | `anon` | `authenticated` | `service_role` |
| --- | --- | --- | --- |
| `public:<name>` | Subscribe | Subscribe, Broadcast, Presence | Subscribe, Broadcast |
| `private:<name>` | kein Zugriff | Subscribe, Broadcast, Presence | Subscribe, Broadcast |
| `user:<subject>:<name>` | kein Zugriff | nur eigenes Subject | Subscribe, Broadcast |

Channels sind immer an die serverseitig ermittelte Kombination aus Organisation,
Projekt und Environment gebunden. Gleiche Channelnamen in anderen Scopes teilen
weder Events noch Presence. Service Roles dürfen in diesem Alpha keine Presence
publizieren, damit privilegierte Automatisierung nicht als Endnutzer erscheint.

## Ordering, Cursor und Replay

Events erhalten pro Scope und Channel eine monoton steigende Sequenz. Subscribe,
Replay und Live-Broadcast laufen unter derselben Channel-Serialisierung; Live-
Events können einen laufenden Replay nicht überholen. Jeder Broadcast enthält
einen HMAC-signierten, Scope- und Channel-gebundenen `qk_rt_...`-Cursor.

- Subscribe ohne Cursor beginnt am aktuellen Ende und liefert keine alte History.
- Subscribe mit Cursor liefert ausschließlich spätere Events mit `replay: true`.
- Manipulierte, fremde, zukünftige oder zu alte Cursors werden abgewiesen.
- Überschreitet der Catch-up das konfigurierte Replaylimit, antwortet der Server
  fail-closed mit `REALTIME_CURSOR_STALE`; er überspringt keine Events. Die App muss
  ihren Zustand über die normale Daten-API neu laden und danach neu abonnieren.
- Der Log liegt in PostgreSQL und überlebt einen Neustart. Bei zufälligem lokalem
  Cursor-Secret werden frühere Cursors ungültig; unter Production verlangt das Tor
  deshalb ein gesetztes Geheimnis.

### Nachreichen auf einem `changes:`-Kanal

Ein `changes:`-Kanal hat keinen Event-Log und kann keinen haben: Was dort ankommt,
entsteht in der Projektdatenbank. Sein Cursor zeigt deshalb auf eine Position im
Änderungs-Feed, nicht auf eine Kanalsequenz. Jede `change`-Nachricht trägt ihre
Position als Zahl und denselben signierten Cursor darauf.

- Subscribe ohne Cursor beginnt am aktuellen Ende des Feeds.
- Subscribe mit Cursor reicht die verpassten Änderungen dieser Tabelle nach, mit
  `replay: true`.
- **Jede nachgereichte Zeile wird einzeln mit den Claims des Abonnenten gelesen.**
  Row Level Security entscheidet dabei neu, und zwar durch dieselbe Generated Data
  API wie im Livebetrieb. Der Feed hält keine Zeilenwerte, nur Primärschlüssel; es
  gibt hier also keinen Weg, auf dem eine Zeile an RLS vorbeikäme. `subscribed.replayed`
  nennt die Zahl der Zeilen, die dieser Abonnent wirklich bekommt, nicht die Zahl im
  Feed. Löschungen erreichen weiterhin nur `service_role`.
- Zwei harte Grenzen, und beide fallen geschlossen mit `REALTIME_CURSOR_STALE`:
  mehr Zeilen als `QKERN_REALTIME_HISTORY_LIMIT`, und eine älteste Zeile jenseits
  von `QKERN_REALTIME_HISTORY_MAX_AGE_MS`. Ebenso, wenn die Aufbewahrung den
  angeforderten Bereich bereits entfernt hat oder die Position hinter dem Feed liegt.
  Ohne konfigurierte Quelle wird ein Cursor abgewiesen und nicht als „ab jetzt“
  gelesen: Ein ignorierter Cursor wäre eine verschwiegene Lücke.
- Eine Verbindung bekommt keine Position zweimal. Das Nachreichen und der Poller
  laufen unter derselben Kanal-Serialisierung, und jede Verbindung führt die
  höchste Position, die sie gesehen hat.

## Presence

Presence enthält nur einen HMAC-abgeleiteten `qk_presence_...`-Schlüssel und den
begrenzten JSON-State. User-ID, Project-Key, Token und Connection-ID werden nicht
ausgegeben. Neue Subscriber erhalten einen Snapshot; Track/Untrack und Disconnect
erzeugen Join-/Leave-Nachrichten. Ein geänderter State ist ein Join unter demselben
Schlüssel.

### Dauerhaft, und was das heißt

Presence liegt in `realtime_presence` (Migration 0077) und nicht mehr in einer Map
je Verbindung. Der Snapshot beim Abonnieren liest diese Tabelle und trägt darum die
Abonnenten **aller** Instanzen; eine Änderung in einer Instanz erreicht die anderen
über denselben `LISTEN`/`NOTIFY`-Kanal wie ein Ereignisverweis. Der Hinweis trägt
keinen Eintrag, nur den Kanal: Die empfangende Instanz liest frisch und bildet die
Differenz zu dem, was ihre Abonnenten zuletzt gesehen haben.

### Die Pacht, und was mit einer verschwundenen Verbindung passiert

Eine Verbindung verschwindet auch ohne Abmeldung: gekapptes Netz, getöteter Prozess,
abgestürzter Rechner. Ein Leave schreibt dann niemand. Jeder Eintrag trägt deshalb
ein `expires_at`, das der Prozess mit der Verbindung alle
`QKERN_REALTIME_PRESENCE_SWEEP_MS` erneuert; nur er darf das, eine fremde Instanz
nicht.

Läuft die Pacht aus, wirkt das in zwei Stufen:

1. **Die Sichtbarkeit endet am Ablauf.** Jede Lesung filtert auf `expires_at > now`.
   Ab dieser Sekunde zählt der Eintrag für niemanden mehr.
2. **Die Zeile fällt eine Frist später.** Der Aufräumer löscht bei
   `expires_at < now - QKERN_REALTIME_PRESENCE_RETENTION_MS` (Vorgabe zehn Minuten),
   damit eine Fehlersuche unmittelbar nach einem Vorfall die Waise noch findet.

Derselbe Takt, der die eigenen Pachten erneuert, rechnet jeden Kanal mit lokalen
Abonnenten neu und stellt den Ablauf als Leave zu. Ohne ihn bliebe eine Waise in
einem Kanal, in dem nichts mehr passiert, für immer sichtbar.

Eine geordnete Trennung wartet nicht auf die Pacht: Ein geschlossener Socket nimmt
den Eintrag sofort weg. Die Pacht ist für den ungeordneten Fall da.

Ein wieder aufsetzender Client bekommt einen neuen Presence-Schlüssel, weil er in
die Verbindungskennung eingeht. Was den Neustart überlebt, ist die Presence des
Kanals, nicht die Identität eines einzelnen Eintrags.

## Fehler und Schutzlimits

Fehlerantworten enthalten nur `type`, optional `requestId` und einen festen Code,
niemals Credentials oder interne Ursachen. Authentifizierungsfehler schließen mit
4401, Protokollfehler mit 4400, Rate-Limits mit 4429 und Transport-Backpressure mit
1013. Drei ungültige authentifizierte Frames schließen die Session.

Konfigurierbar und hart begrenzt sind Verbindungen, Nachrichtengröße, Payload,
Presence-State, Subscriptions, History, Replay, Auth-Timeout, Heartbeat und
WebSocket-Sendepuffer. JSON-Tiefe, Knotenzahl, Schlüssel und Prototype-relevante
Namen werden zusätzlich geprüft.

## Alpha-1-Betriebsgrenze

Start lokal nach einer laufenden PostgreSQL-Control-Plane und aktivierten Project
Auth/API Keys:

```powershell
$env:QKERN_RUNTIME_MODE="postgres"
$env:QKERN_REALTIME_ENABLED="true"
$env:QKERN_REALTIME_ALLOWED_ORIGINS="http://localhost:3000"
npm run realtime
```

Der Prozess bindet standardmäßig `127.0.0.1`. Ein Binding darüber hinaus
verlangt in jeder Umgebung ein ausdrückliches `QKERN_REALTIME_PUBLIC_BIND=true`.

## Grenzen unter Production

Das Tor in `lib/server/realtime/production-gate.ts` prüft fünf Bedingungen
einzeln und nennt jede, die fehlt: dauerhafter Event-Log, Cursor-Geheimnis mit
mindestens 32 Byte, konfigurierte Aufbewahrung, eine ausdrückliche
`https`-Origin-Allowlist und, bei öffentlichem Binding, die Attestierung
`QKERN_REALTIME_TLS_TERMINATED=proxy`. Der Transport selbst spricht `ws` ohne
TLS; die Attestierung ist deshalb eine Attestierung und kein Beweis.

Die Datenbankverbindung ist unter Production `DATABASE_SSL=require`, und das
heißt in diesem Prozess beides: Kette und Hostname werden geprüft. Der
Vertrauensanker kommt aus `NODE_EXTRA_CA_CERTS`, wenn der Server nicht auf eine
öffentlich vertrauenswürdige CA lautet. Dieselbe Konfiguration gilt für die
`LISTEN`-Verbindung des Fan-outs; bis zu diesem Slice baute sie sich ohne jede
auf, und gegen ein PostgreSQL mit `hostnossl ... reject` kam der Prozess darum
gar nicht hoch.

**Postgres Changes** laufen unter Production. Der Prozess baut seinen
Projektdatenbank-Katalog über dieselbe Fabrik wie der Migrations-Prozess
(`lib/server/migrations/connection-catalog-runtime.ts`), und unter `production`
ist das der vault-gestützte Zweig. Verlangt werden:

- `QKERN_REALTIME_CHANGES_ENABLED=true` und `QKERN_GENERATED_DATA_API_ENABLED=true`.
  Der Leser holt jede Zeile durch die Generated Data API; ohne sie würde er bei
  jedem Lesevorgang geschlossen fallen und der Abonnent bekäme dauerhaft nichts.
  Der Start fällt deshalb, statt diesen Zustand zuzulassen.
- `QKERN_PROJECT_DATABASE_CATALOG_SOURCE=static-env` mit den Bindungen in
  `QKERN_VAULT_PROJECT_DATABASE_CATALOG_JSON`. Die Bindungstabelle der Control
  Plane gehört der Worker-Rolle; der Realtime-Prozess läuft mit der Laufzeitrolle
  und bekäme sie nur durch ein zusätzliches Leserecht. Er verlangt darum
  ausdrückliche Bindungen und nennt beim Start, wenn sie fehlen.
- `QKERN_VAULT_DATABASE_URL` als `https`-Adresse einer Vault-Datenbank-Mount und
  `QKERN_VAULT_TOKEN_FILE` als absoluter Pfad auf einen Token-Sink, der für
  andere nicht lesbar ist. Jede Bindung trägt unter Production einen
  Blatt-Pin (`serverCertificateSha256`) der Projektdatenbank.

Ein vault-gestützter Katalog holt seine Zugangsdaten erst beim ersten Zugriff.
Der Prozess greift deshalb vor dem Lauschen einmal je Bindung bis zur Datenbank
durch und meldet, wie viele er erreicht hat. Ein leerer Katalog oder ein Vault,
der für eine gültige Bindung nichts liefert, lässt den Start fallen. Ohne diesen
Griff hätte der Prozess gelauscht und der Abonnent hätte für immer ein leeres
`changes:`-Abonnement gehabt, ohne Fehler und ohne Hinweis.

Belegt ist der Weg im Stack `docker-compose.realtime-certification.yml`: Dort
steht neben dem TLS-PostgreSQL ein echter Vault mit einem Serverzertifikat aus
derselben CA, und eine echte Datenbankänderung geht durch
`qkern_internal.change_feed` bis zu einem angemeldeten Abonnenten. Gelesen wird
mit dessen Claims; die Zeile eines anderen Nutzers kommt nicht an, weil Row Level
Security sie nicht herausgibt.

Ebenfalls offen: externe Rate-Limits und ein Lastprofil jenseits des Soak fehlen.

## Dauerhaftigkeit und Mehrinstanzbetrieb (Release 1.11)

Der Event-Log liegt nicht mehr im Prozessspeicher. Migration `0030` speichert
Ereignisse und die Sequenz je Kanal mit Tenant-RLS, Append-only-Trigger und
engen Spaltengrants. Die Sequenz stammt aus der Datenbank: Nur so sehen mehrere
Instanzen dieselbe Reihenfolge, und nur so überlebt sie einen Neustart.

Die Vergabe verwendet `INSERT … ON CONFLICT DO UPDATE … RETURNING` statt
`SELECT … FOR UPDATE`. PostgreSQL verlangt für jede Sperrklausel zusätzlich ein
UPDATE-Recht und eine UPDATE-Policy; der Upsert ist atomar und braucht beides
nicht.

### Zustellung zwischen Instanzen

`RealtimeEventBus` verteilt **Verweise**, keine Ereignisse. Eine Benachrichtigung
enthält Organisation, Projekt, Environment, Kanal, Sequenz und die
Ursprungsinstanz — keine Payload. Zwei Gründe: `NOTIFY` begrenzt die Nutzlast
auf 8000 Byte, und eine Payload auf einem Seitenkanal würde den Log als einzige
Wahrheit über Reihenfolge und Inhalt umgehen. Die empfangende Instanz liest das
Ereignis aus dem RLS-geprüften Log.

Ein eingehender Verweis löst ein Replay ab der zuletzt zugestellten Sequenz aus,
nicht das Holen des genannten Ereignisses. `NOTIFY` ist nicht dauerhaft; ein
verpasster Hinweis würde sonst eine stille Lücke hinterlassen, die dem
Cursor-Vertrag widerspricht.

Die eigene Instanz erkennt ihre Ereignisse an der Ursprungskennung und stellt
sie nicht doppelt zu.

### Grenzen

Ohne konfigurierten Bus verhält sich der Dienst wie zuvor: Ein Broadcast erreicht
ausschließlich Verbindungen desselben Prozesses. Das ist der Default.

Der Zertifizierungsnachweis führt zwei Instanzen mit getrennten Pools und
getrennten `LISTEN`-Verbindungen gegen echtes PostgreSQL, **aber im selben
Betriebssystemprozess**. Prozessabsturz und Netzwerkausfall sind nicht geprüft.

Stand `1.11.0` waren Postgres Changes (CDC) nicht implementiert, und die
Aufbewahrung lag als `prune` bereit, ohne dass jemand sie aufrief. Beides gilt
nicht mehr: Der Feed liegt in `db/project/0003_qkern_change_feed.sql`, die
Aufbewahrung hat mit `RealtimeRetentionRuntime` einen Besitzer im
Realtime-Prozess, und unter `production` läuft der Feed über den
vault-gestützten Katalog. `lib/server/realtime/change-source.ts` hält weiter die
Entwurfsentscheidungen fest, und eine davon bleibt der zentrale Unterschied:
Datenbankänderungen entstehen außerhalb von QKERN und brauchen deshalb RLS pro
Ereignis und pro Abonnent; über den kanalweit sichtbaren Event-Log dürfen sie
nicht laufen.
