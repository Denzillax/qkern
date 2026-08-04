# Release 1.11.0 — Realtime Durability and Fan-out

> Datum: 4. August 2026 · Vorgänger: `1.10.0`

## Wofür dieses Release steht

Realtime war bis hierher eine Foundation mit einer harten Grenze: Der Event-Log
lag im Prozessspeicher. Ereignisse gingen bei jedem Neustart verloren und
erreichten niemals eine zweite Instanz. Ein Broadcast war damit auf genau einen
Prozess beschränkt — brauchbar für eine Demo, nicht für Betrieb.

Dieses Release macht den Log dauerhaft und die Zustellung instanzübergreifend.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| PostgreSQL-17-Zertifizierung | 33 von 33 bestanden, exit 0, 30 Migrationen |
| davon Realtime gegen echtes PostgreSQL | 5 Fälle mit zwei Instanzen |
| MinIO-/ClamAV-Zertifizierung | 2 von 2 bestanden, exit 0 |
| Project-Auth-Provider-Zertifizierung | 5 von 5 bestanden, exit 0 |
| Strict TypeScript | grün |

Bemerkenswert: Der Realtime-Zertifizierungslauf war **beim ersten Versuch
grün**. Die Fehlerklassen aus Release 1.9 — `bigint` erreicht den Treiber als
Zeichenkette, jede Sperrklausel verlangt zusätzlich UPDATE-Recht und
UPDATE-Policy, jeder Zugriffspfad braucht seine eigene RLS-Policy — wurden
vorbeugend angewandt statt nachträglich gefunden.

## Was neu ist

### Dauerhafter Event-Log mit globaler Sequenz

Migration `0030` ergänzt `realtime_events` und `realtime_channel_sequences` mit
Tenant-RLS, zusammengesetzten Projekt-Fremdschlüsseln, engen Spaltengrants,
einem Append-only-Trigger und Indizes für Replay und Aufbewahrung.

Die Sequenz pro Kanal stammt jetzt aus der Datenbank. Nur so sehen mehrere
Instanzen dieselbe Reihenfolge, und nur so überlebt sie einen Neustart.

Die Vergabe nutzt `INSERT … ON CONFLICT DO UPDATE … RETURNING` statt
`SELECT … FOR UPDATE`. Das ist direkt aus 1.9 gelernt: Für jede Sperrklausel
verlangt PostgreSQL zusätzlich ein UPDATE-Recht **und** eine UPDATE-Policy, was
dort erst der erste echte Lauf zeigte. Der Upsert ist atomar, serialisiert auf
derselben Zeile und braucht keine Sperrklausel.

### Instanzübergreifende Zustellung

`RealtimeEventBus` ist ein neuer optionaler Port mit einem Memory- und einem
PostgreSQL-Adapter über `LISTEN`/`NOTIFY`.

Zwei Entwurfsentscheidungen prägen ihn:

**Die Benachrichtigung trägt keine Payload**, sondern nur Scope, Kanal, Sequenz
und Ursprungsinstanz. `NOTIFY` begrenzt die Nutzlast auf 8000 Byte, aber der
wichtigere Grund ist ein anderer: Eine Payload auf einem Seitenkanal würde den
Log als einzige Wahrheit über Reihenfolge und Inhalt umgehen. Die empfangende
Instanz liest das Ereignis aus dem Log, dessen Zugriff bereits RLS-geprüft ist.

**Ein eingehender Verweis löst ein Replay ab der zuletzt zugestellten Sequenz
aus**, statt nur das genannte Ereignis zu holen. `NOTIFY` ist nicht dauerhaft;
verliert eine Instanz kurz die Verbindung, verpasst sie Hinweise. Ohne das
Replay bliebe eine stille Lücke zurück — genau das, was der Cursor-Vertrag
ausschließt. Ein Test hält diesen Fall fest.

Kein zusätzlicher Broker: Die Ereignisse liegen bereits dauerhaft in derselben
Datenbank. Ein zweites System einzuführen, nur um auf sie hinzuweisen, brächte
eine weitere Ausfall- und Betriebsfläche ohne zusätzliche Garantie.

### Rückwärtskompatibilität

Ohne `eventBus` verhält sich der Dienst exakt wie zuvor: Ein Broadcast erreicht
ausschließlich Verbindungen dieses Prozesses. `MemoryRealtimeEventLog` bleibt
der Default für Test und Entwicklung. Kein vorhandener Aufruf ändert sich; ein
eigener Test hält das fest.

### Vorbereitete CDC-Schnittstelle

`RealtimeChangeSource` und `RealtimeChangeVisibility` sind als dokumentierte
Ports definiert und **bewusst nicht implementiert**. Sie halten die Architektur
für den nächsten Slice fest und markieren, wo die Grenze verläuft.

Der zentrale Punkt darin: Broadcast-Ereignisse sind beim Schreiben bereits
autorisiert, Datenbankänderungen dagegen entstehen außerhalb von QKERN. Für sie
gilt die Autorisierung des Absenders nicht, weshalb CDC **RLS pro Ereignis und
pro Abonnent** braucht. Zwei Abonnenten desselben Kanals dürfen unterschiedliche
Teilmengen derselben Änderung erhalten. Deshalb darf CDC nicht über
`RealtimeEventLog` laufen, dessen Ereignisse kanalweit sichtbar sind.

## Stufenwirkung

**Stufe 1.5 bleibt offen.** Persistenz, globale Reihenfolge und horizontaler
Fan-out sind erfüllt und zertifiziert. Das Austrittskriterium verlangt zusätzlich
PostgreSQL-CDC, RLS pro Ereignis sowie Drop-, Reconnect- und Lasttests gegen
echte Infrastruktur; diese sind nicht erbracht.

Der Fortschritt ist damit erheblich, aber die Stufe wird nicht als abgeschlossen
ausgewiesen.

## Ehrlich offen

- Postgres Changes (CDC) und RLS pro Ereignis
- Drop-, Reconnect-, Ordering- unter Last, Soak- und Lasttests
- Mehrprozess- statt Mehrinstanznachweis: Die Zertifizierung führt zwei Instanzen
  mit getrennten Pools und getrennten `LISTEN`-Verbindungen, aber im selben
  Betriebssystemprozess. Prozessabsturz und Netzwerkausfall sind nicht geprüft.
- Production-TLS/Proxy, Telemetrie, Browser-SDK
- Aufbewahrung des Event-Logs im Betrieb: `prune` existiert, wird aber von keinem
  Scheduler aufgerufen
