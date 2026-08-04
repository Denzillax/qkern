BEGIN;

ALTER TABLE project_queue_messages
  ADD COLUMN replayed_from_message_id uuid,
  ADD CONSTRAINT project_queue_messages_replay_not_self
    CHECK (replayed_from_message_id IS NULL OR replayed_from_message_id <> id),
  ADD CONSTRAINT project_queue_messages_replay_source_fk
    FOREIGN KEY (organization_id, project_id, environment, replayed_from_message_id)
    REFERENCES project_queue_messages (organization_id, project_id, environment, id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX project_queue_messages_replay_once
  ON project_queue_messages
    (organization_id, project_id, environment, queue_id, replayed_from_message_id)
  WHERE replayed_from_message_id IS NOT NULL;

CREATE INDEX project_queue_messages_dead_letter_list_idx
  ON project_queue_messages
    (organization_id, project_id, environment, queue_id, dead_lettered_at DESC, id)
  WHERE status = 'dead_lettered';

CREATE OR REPLACE FUNCTION qkern_reject_project_queue_replay_binding_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.replayed_from_message_id IS DISTINCT FROM OLD.replayed_from_message_id THEN
    RAISE EXCEPTION 'project queue replay binding is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_queue_messages_replay_binding_guard
  BEFORE UPDATE ON project_queue_messages FOR EACH ROW
  EXECUTE FUNCTION qkern_reject_project_queue_replay_binding_update();

REVOKE ALL ON FUNCTION qkern_reject_project_queue_replay_binding_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qkern_reject_project_queue_replay_binding_update() TO qkern_runtime;

COMMIT;
