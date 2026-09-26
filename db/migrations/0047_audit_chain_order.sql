BEGIN;

-- Kettenreihenfolge gleich Zeitreihenfolge (2.36).
--
-- Das Rennen: audit_logs.created_at hat den Default now(), und now() ist die
-- Startzeit der Transaktion, nicht die Zeit des INSERT. Der Trigger
-- qkern_prepare_audit_log (0002) serialisiert die Kette je Organisation ueber
-- pg_advisory_xact_lock und verkettet mit der neuesten Zeile. Beginnt
-- Transaktion A vor Transaktion B, schreibt aber erst nach B, dann bekommt A
-- den Lock als zweite: previous_hash von A zeigt auf B, created_at von A liegt
-- aber vor dem von B. Wer die Kette in der Ordnung (created_at, id) nachrechnet
-- (auditChainIntact im Backup-Drill, der Fall 2.35), sieht dann eine
-- gebrochene Kette, ohne dass jemand etwas veraendert hat. Seit 2.35 schreibt
-- jede Anmeldung eine Zeile in die Kette, das Rennen ist also kein Randfall
-- mehr.
--
-- Die Zusage ab hier: Innerhalb einer Organisation ist die Reihenfolge der
-- Kette (previous_hash) gleich der Reihenfolge nach (created_at, id). Dafuer
-- setzt der Trigger created_at selbst, nachdem er den Lock hat und die neueste
-- Zeile kennt: clock_timestamp() (die echte Uhrzeit, nicht die Startzeit der
-- Transaktion), mindestens aber eine Mikrosekunde nach der created_at der
-- Vorgaengerzeile. Das Minimum deckt eine rueckwaerts gestellte Uhr und
-- mehrere Zeilen in derselben Mikrosekunde ab. Ein vom Aufrufer mitgegebenes
-- created_at wird damit ueberschrieben; kein Pfad im Code gibt eines mit.
--
-- created_at gehoert zum gehashten Inhalt (jsonb_build_object unten). Die
-- Zuweisung steht deshalb vor der Hash-Berechnung, damit entry_hash ueber den
-- endgueltigen Wert gerechnet wird. Die Hash-Berechnung selbst ist
-- unveraendert aus 0002 uebernommen; bestehende Zeilen bleiben gueltig.
--
-- Die neueste Zeile wird wie in 0002 nach (created_at DESC, id DESC) gesucht,
-- passend zum Index audit_logs_chain_idx und zur Ordnung der Pruefer.
--
-- Rechte: CREATE OR REPLACE FUNCTION behaelt Eigentuemer und alle Rechte der
-- Funktion. Die EXECUTE-Rechte fuer qkern_runtime (0002), qkern_worker (0006),
-- qkern_provisioner (0020) und qkern_auth (0046) bleiben also bestehen, ohne
-- neues GRANT. Die Funktion bleibt SECURITY INVOKER wie bisher (kein
-- SECURITY-Zusatz), der Trigger audit_logs_prepare_insert bleibt unberuehrt.
CREATE OR REPLACE FUNCTION qkern_prepare_audit_log()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous_created_at timestamptz;
BEGIN
  -- Serialize the hash chain per organization, including inserts that do not
  -- pass through the TypeScript repository.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text, 0));

  SELECT entry_hash, created_at
  INTO NEW.previous_hash, previous_created_at
  FROM audit_logs
  WHERE organization_id = NEW.organization_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  -- Chain order equals (created_at, id) order: stamp the row under the lock,
  -- strictly after its predecessor. greatest() ignores NULL for the first row.
  NEW.created_at := greatest(clock_timestamp(), previous_created_at + interval '1 microsecond');

  NEW.redacted_metadata = coalesce(NEW.redacted_metadata, '{}'::jsonb);
  NEW.entry_hash = encode(
    digest(
      jsonb_build_object(
        'id', NEW.id,
        'organization_id', NEW.organization_id,
        'project_id', NEW.project_id,
        'environment', NEW.environment,
        'actor_type', NEW.actor_type,
        'actor_ref', NEW.actor_ref,
        'action', NEW.action,
        'resource_ref', NEW.resource_ref,
        'status', NEW.status,
        'redacted_metadata', NEW.redacted_metadata,
        'previous_hash', NEW.previous_hash,
        'created_at', NEW.created_at
      )::text,
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$;

COMMIT;
