BEGIN;

-- Dauerhafte Presence (2.113).
--
-- ## Der offene Punkt
--
-- `docs/PARITAET.md` nennt in der Realtime-Zeile seit langem denselben Rest:
-- persistente Presence. Presence lag bis hierher ausschliesslich im
-- Prozessspeicher, in einer `Map` je Verbindung. Zwei Folgen, beide sichtbar:
-- Ein Neustart loescht jeden Eintrag, und eine zweite Instanz hat von den
-- Abonnenten der ersten nie etwas erfahren. Wer in einem Kanal mit zwei
-- Instanzen fragte, wer da sei, bekam die Haelfte.
--
-- ## Die Frist, und warum Presence eine braucht
--
-- Diese Tabelle ist die einzige in QKERN, deren Zeilen einen **lebenden**
-- Zustand behaupten: "dieser Abonnent ist jetzt da". Ein Eintrag ohne Frist
-- waere darum schlimmer als keine Presence. Eine Verbindung verschwindet auch
-- ohne Abmeldung -- ein gekapptes Netz, ein getoeteter Prozess, ein
-- Rechnerabsturz -- und niemand schreibt dann ein Leave. Der Eintrag bliebe
-- stehen und zeigte auf Dauer Leute an, die nicht da sind.
--
-- Deshalb traegt jede Zeile `expires_at`, und zwar als **Pacht**: Der Prozess,
-- dem die Verbindung gehoert, schreibt sie bei jedem Takt neu. Hoert er auf,
-- laeuft sie ab. Zwei Stufen folgen daraus, und sie sind absichtlich getrennt:
--
-- 1. **Sichtbarkeit endet am Ablauf.** Jede Lesung filtert `expires_at > now()`.
--    Ab der Sekunde, in der die Pacht ausgelaufen ist, zaehlt der Eintrag fuer
--    niemanden mehr, auch wenn die Zeile noch steht.
-- 2. **Die Zeile endet eine Frist spaeter.** Der Aufraeumer loescht bei
--    `expires_at < now() - Frist`. Die Frist ist kurz (Vorgabe zehn Minuten):
--    Eine abgelaufene Presence-Zeile ist kein Beweisstueck wie eine
--    Token-Pruefsumme, sie ist nur lange genug noch da, dass eine Fehlersuche
--    direkt nach dem Vorfall sie findet.
--
-- Ohne Stufe 1 waere Stufe 2 ein Zeitfenster, in dem Abwesende als anwesend
-- gelten. Ohne Stufe 2 waere Stufe 1 eine Tabelle, die von Waisen lebt.
--
-- ## Was hier bewusst **nicht** steht
--
-- **Keine Verbindung.** Diese Tabelle haelt Presence, nicht die
-- Verbindungsliste. Eine Verbindung ist Transport und liegt weiter im Prozess;
-- sie hier zu speichern hiesse, bei jedem Frame zu schreiben.
--
-- **Kein Subjekt, kein Connection-Key.** Was hier liegt, ist derselbe
-- HMAC-abgeleitete `qk_presence_...`-Schluessel, den das Protokoll ohnehin
-- herausgibt, und der begrenzte JSON-State des Abonnenten. Nutzer-Id,
-- Project-Key und Verbindungskennung gehen in die Ableitung ein und stehen
-- nirgends als Klartext in der Zeile.
--
-- **Keine Unveraenderlichkeit.** `realtime_events` traegt einen
-- Append-only-Trigger, weil ein Log eine Kette ist. Presence ist das Gegenteil:
-- Der Zustand eines Abonnenten aendert sich, und die Pacht wird fortgeschrieben.
-- Ein Trigger gegen UPDATE waere hier falsch.

CREATE TABLE realtime_presence (
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  channel text NOT NULL CHECK (char_length(channel) BETWEEN 1 AND 128),
  -- Der `qk_presence_...`-Schluessel. Dieselbe Zeichenkette, die das Protokoll
  -- ausgibt; sie ist bereits eine Ableitung und kein Bezeichner.
  presence_key text NOT NULL CHECK (char_length(presence_key) BETWEEN 1 AND 64),
  -- Wem die Pacht gehoert. Nur zum Erneuern und zum Aufraeumen beim geordneten
  -- Herunterfahren; kein Abonnent erfaehrt sie.
  instance_id text NOT NULL CHECK (char_length(instance_id) BETWEEN 1 AND 64),
  state jsonb NOT NULL CHECK (octet_length(state::text) <= 32768),
  tracked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, project_id, environment, channel, presence_key),
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE CASCADE,
  -- Eine Pacht, die vor ihrem Beginn endet, ist keine.
  CONSTRAINT realtime_presence_lease_forward CHECK (expires_at > tracked_at)
);

-- Die Lesung eines Kanals geht ueber den Primaerschluessel-Prefix; dafuer
-- braucht es keinen eigenen Index. Diese zwei brauchen die beiden anderen Wege:
-- der Aufraeumer sucht nach abgelaufenen Zeilen quer ueber die Kanaele, und das
-- geordnete Herunterfahren nach den eigenen.
CREATE INDEX realtime_presence_lease_idx
  ON realtime_presence (organization_id, project_id, environment, expires_at);
CREATE INDEX realtime_presence_instance_idx
  ON realtime_presence (organization_id, project_id, environment, instance_id);

ALTER TABLE realtime_presence ENABLE ROW LEVEL SECURITY;

CREATE POLICY realtime_presence_select ON realtime_presence
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY realtime_presence_insert ON realtime_presence
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
-- Die Pacht wird fortgeschrieben, und der State aendert sich: beides UPDATE.
-- Eng wie bei `realtime_channel_sequences`: dieselbe Organisation auf beiden
-- Seiten, keine Umschreibung auf eine fremde.
CREATE POLICY realtime_presence_update ON realtime_presence
  FOR UPDATE USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY realtime_presence_delete ON realtime_presence
  FOR DELETE USING (organization_id = qkern_current_organization_id());

REVOKE ALL ON realtime_presence FROM PUBLIC;

-- Dieselbe Rolle, die den Event-Log fuehrt. Der Realtime-Prozess laeuft mit
-- `qkern_runtime`, und Presence entsteht auf demselben Weg wie ein Broadcast.
-- Die Spaltenliste beim UPDATE ist die vollstaendige Menge, die eine Erneuerung
-- und eine Zustandsaenderung anfassen; Kanal, Schluessel und Scope stehen
-- ausdruecklich nicht darin.
GRANT SELECT, INSERT, DELETE ON realtime_presence TO qkern_runtime;
GRANT UPDATE (instance_id, state, tracked_at, expires_at) ON realtime_presence
  TO qkern_runtime;

COMMIT;
