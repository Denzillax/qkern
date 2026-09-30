# QKERN Realtime Protocol v1

Dieses Dokument beschreibt den in `1.5.0-alpha.1` eingeführten und seither
unverändert geltenden ausführbaren Vertrag.

Der Satz, der hier bis zu diesem Slice stand, galt seit `1.72.0` nicht mehr:
Der Transport verweigerte `NODE_ENV=production` bedingungslos. Seit `1.73.0`
steht dort ein Tor mit benannten Bedingungen, und der Start dagegen ist jetzt
belegt. Der Stack `docker-compose.realtime-certification.yml` führt ein
PostgreSQL mit eigener CA, das jede Verbindung ohne TLS abweist; der
ausgelieferte Prozess läuft davor unter `production` an, und `pg_stat_ssl`
nennt für jede seiner Verbindungen Version und Cipher. Was Production heute
nicht kann, steht unter „Grenzen unter Production".

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
- Alpha 1 hält History im Prozessspeicher. Ein Neustart verliert die History; bei
  zufälligem lokalem Cursor-Secret werden außerdem frühere Cursors ungültig.

## Presence

Presence enthält nur einen HMAC-abgeleiteten `qk_presence_...`-Schlüssel und den
begrenzten JSON-State. User-ID, Project-Key, Token und Connection-ID werden nicht
ausgegeben. Neue Subscriber erhalten einen Snapshot; Track/Untrack und Disconnect
erzeugen Join-/Leave-Nachrichten.

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

Nicht erreichbar unter Production sind **Postgres Changes**. Der Prozess baut
seinen Projektdatenbank-Katalog ausschließlich über
`createLocalProjectDatabaseCatalogFromEnv` beziehungsweise
`createGeneratedDataApiFromEnv` auf, und beide weisen `production` ab: Sie
verlangen einen eingespeisten, vault-gestützten Katalog. Der Migrations-Prozess
hat diesen Zweig, der Realtime-Prozess hat ihn nicht. Wer `changes:` unter
Production anschaltet, bekommt beim Start eine benannte Abweisung; ein leeres
Abonnement gibt es nicht.

Ebenfalls offen: History und Presence liegen je Verbindung im Prozessspeicher,
externe Rate-Limits und ein Lastprofil jenseits des Soak fehlen.

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

Postgres Changes (CDC) sind nicht implementiert. `lib/server/realtime/change-source.ts`
hält den vorgesehenen Port und die offenen Entwurfsentscheidungen fest. Der
zentrale Unterschied: Datenbankänderungen entstehen außerhalb von QKERN und
brauchen deshalb RLS pro Ereignis und pro Abonnent; sie dürfen nicht über den
kanalweit sichtbaren Event-Log laufen.

Die Aufbewahrung ist als `prune` implementiert, wird aber von keinem Scheduler
aufgerufen.
