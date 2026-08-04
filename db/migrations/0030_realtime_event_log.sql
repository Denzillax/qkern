-- Dauerhafter Realtime-Event-Log.
--
-- Bis hierher lag der Event-Log ausschliesslich im Prozessspeicher: Ereignisse
-- gingen bei jedem Neustart verloren und erreichten niemals eine zweite
-- Instanz. Diese Migration macht den Log dauerhaft und die Sequenz pro Kanal
-- global, sodass mehrere Instanzen dieselbe Reihenfolge sehen.
--
-- Die Sequenzvergabe verwendet bewusst kein SELECT ... FOR UPDATE. Migration
-- 0029 musste genau dafuer nachtraeglich ein UPDATE-Recht und eine
-- UPDATE-Policy ergaenzen, weil PostgreSQL beides fuer jede Sperrklausel
-- verlangt. Ein INSERT ... ON CONFLICT DO UPDATE ... RETURNING ist atomar,
-- serialisiert auf derselben Zeile und braucht keine Sperrklausel.

CREATE TABLE realtime_channel_sequences (
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  channel text NOT NULL CHECK (char_length(channel) BETWEEN 1 AND 128),
  next_sequence bigint NOT NULL DEFAULT 1 CHECK (next_sequence >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, project_id, environment, channel),
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE CASCADE
);

CREATE TABLE realtime_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  channel text NOT NULL CHECK (char_length(channel) BETWEEN 1 AND 128),
  sequence bigint NOT NULL CHECK (sequence >= 1),
  event text NOT NULL CHECK (char_length(event) BETWEEN 1 AND 128),
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 262144),
  actor_role text NOT NULL CHECK (actor_role IN ('anon', 'authenticated', 'service_role')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE CASCADE,
  CONSTRAINT realtime_events_channel_sequence_key
    UNIQUE (organization_id, project_id, environment, channel, sequence)
);

CREATE INDEX realtime_events_replay_idx
  ON realtime_events (organization_id, project_id, environment, channel, sequence);
CREATE INDEX realtime_events_retention_idx
  ON realtime_events (created_at);

-- Ereignisse sind unveraenderlich. Nur die Aufbewahrung darf loeschen, und auch
-- sie darf keine Luecke unterhalb der juengsten Ereignisse reissen, weil ein
-- Replay-Cursor sonst stillschweigend Ereignisse ueberspringen wuerde. Ein
-- Cursor, der auf einen entfernten Bereich zeigt, muss stattdessen als stale
-- scheitern; das prueft der Adapter.
CREATE OR REPLACE FUNCTION qkern_reject_realtime_event_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'realtime events are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER realtime_events_immutable
  BEFORE UPDATE ON realtime_events FOR EACH ROW
  EXECUTE FUNCTION qkern_reject_realtime_event_update();

ALTER TABLE realtime_channel_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtime_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY realtime_channel_sequences_select ON realtime_channel_sequences
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY realtime_channel_sequences_insert ON realtime_channel_sequences
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
-- Der Zaehler ist die einzige Zeile, die fortgeschrieben werden darf. Die
-- UPDATE-Policy ist deshalb noetig und bewusst eng: sie erlaubt nur dieselbe
-- Organisation und keine Umschreibung auf eine fremde.
CREATE POLICY realtime_channel_sequences_update ON realtime_channel_sequences
  FOR UPDATE USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

CREATE POLICY realtime_events_select ON realtime_events
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY realtime_events_insert ON realtime_events
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY realtime_events_delete ON realtime_events
  FOR DELETE USING (organization_id = qkern_current_organization_id());

REVOKE ALL ON realtime_channel_sequences, realtime_events FROM PUBLIC;
REVOKE ALL ON FUNCTION qkern_reject_realtime_event_update() FROM PUBLIC;

GRANT SELECT, INSERT ON realtime_channel_sequences TO qkern_runtime;
GRANT UPDATE (next_sequence, updated_at) ON realtime_channel_sequences TO qkern_runtime;
GRANT SELECT, INSERT, DELETE ON realtime_events TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_reject_realtime_event_update() TO qkern_runtime;
