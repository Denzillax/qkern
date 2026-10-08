BEGIN;

-- Der Abraeumer fuer geloeschte Projekte, dritter Teil: die Datenbank (2.177).
--
-- Entschieden von Denzil (docs/PROJEKT_LOESCHEN.md): Der Broker baut die
-- Projektdatenbank auf eine signierte Anfrage hin ab. QKERN selbst fuehrt nie
-- `DROP DATABASE` aus; die Grenze aus 2.126 bleibt.
--
-- Eine Abbau-Anfrage ist eine Zeile hier, je Bindung genau eine. Ihre `id` ist
-- der Idempotenzschluessel: Eine Wiederholung nach einem Timeout traegt
-- dieselbe Kennung, und der Broker darf sie als schon erledigt bestaetigen.
-- Die Anfrage nennt auch die Zieldatenbanken von Wiederherstellungen
-- (`restore_database_name` aus 0084); sie liegen im selben Cluster.
--
-- `qkern_purge_project` setzt `purged_at` erst, wenn jede Bindung des
-- Projekts eine bestaetigte Anfrage hat. Bis dahin steht die Datenbank
-- gesperrt: Die Keys sind seit 0087 tot, und die Konsole zeigt das Projekt als
-- "wird abgeraeumt".

CREATE TABLE project_database_teardowns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  binding_id uuid NOT NULL,
  database_instance_ref text NOT NULL
    CHECK (database_instance_ref ~ '^managed:[a-z0-9][a-z0-9._:-]{0,119}$'),
  restore_databases text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(restore_databases) <= 1000 AND array_position(restore_databases, NULL) IS NULL),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'confirmed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 1000000),
  last_error_code text CHECK (last_error_code IN (
    'PROVIDER_UNAVAILABLE', 'PROVIDER_REJECTED', 'INVALID_RESPONSE', 'TEARDOWN_TIMEOUT')),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  requested_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  CONSTRAINT project_database_teardowns_binding_fk
    FOREIGN KEY (organization_id, binding_id)
    REFERENCES project_database_bindings (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT project_database_teardowns_project_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES projects (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT project_database_teardowns_binding_key UNIQUE (organization_id, binding_id),
  CONSTRAINT project_database_teardowns_confirmation CHECK (
    (status = 'confirmed') = (confirmed_at IS NOT NULL)
  )
);

CREATE INDEX project_database_teardowns_due_idx
  ON project_database_teardowns (organization_id, project_id, next_attempt_at)
  WHERE status = 'requested';

ALTER TABLE project_database_teardowns ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_database_teardowns FORCE ROW LEVEL SECURITY;
CREATE POLICY project_database_teardowns_select ON project_database_teardowns
  FOR SELECT USING (organization_id = qkern_current_organization_id());
REVOKE ALL ON project_database_teardowns FROM PUBLIC;
-- Lesen duerfen Konsole und Provisioner; schreiben nur die Funktionen unten.
GRANT SELECT ON project_database_teardowns TO qkern_runtime, qkern_provisioner;

-- Legt fuer jede Bindung eines faelligen Projekts die Anfrage an, falls sie
-- fehlt, und gibt die offenen zurueck, deren naechster Versuch faellig ist.
-- Solange ein Backup laeuft, eine Wiederherstellung wartet oder ein offener
-- Bereitstellungsauftrag noch keine Bindung hat, kommt nichts zurueck: Jeder
-- davon braucht die Datenbank noch, oder er legt gleich eine an. Ein Auftrag
-- mit Bindung legt keine zweite an; die Bindung ist je Umgebung eindeutig.
CREATE FUNCTION qkern_open_project_database_teardowns(requested_project_id uuid)
RETURNS TABLE (
  teardown_id uuid, environment qkern_environment, database_instance_ref text,
  restore_databases text[], attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  organization uuid := public.qkern_current_organization_id();
BEGIN
  IF organization IS NULL OR NOT public.qkern_project_purge_due(requested_project_id) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.project_database_backups AS backup
              WHERE backup.organization_id = organization
                AND backup.project_id = requested_project_id
                AND (backup.status IN ('pending', 'running', 'available')
                     OR backup.restore_status IN ('requested', 'running')))
     OR EXISTS (SELECT 1 FROM public.project_database_provisioning_jobs AS job
              WHERE job.organization_id = organization
                AND job.project_id = requested_project_id
                AND job.status IN ('pending', 'running')
                AND NOT EXISTS (SELECT 1 FROM public.project_database_bindings AS bound
                                 WHERE bound.organization_id = job.organization_id
                                   AND bound.project_id = job.project_id
                                   AND bound.environment = job.environment)) THEN
    RETURN;
  END IF;

  INSERT INTO public.project_database_teardowns
    (organization_id, project_id, environment, binding_id, database_instance_ref, restore_databases)
  SELECT binding.organization_id, binding.project_id, binding.environment, binding.id,
         binding.database_instance_ref,
         COALESCE((SELECT array_agg(DISTINCT backup.restore_database_name ORDER BY backup.restore_database_name)
                     FROM public.project_database_backups AS backup
                    WHERE backup.organization_id = binding.organization_id
                      AND backup.project_id = binding.project_id
                      AND backup.environment = binding.environment
                      AND backup.restore_database_name IS NOT NULL), '{}')
    FROM public.project_database_bindings AS binding
   WHERE binding.organization_id = organization
     AND binding.project_id = requested_project_id
  ON CONFLICT (organization_id, binding_id) DO NOTHING;

  RETURN QUERY
    SELECT teardown.id, teardown.environment, teardown.database_instance_ref,
           teardown.restore_databases, teardown.attempt_count
      FROM public.project_database_teardowns AS teardown
     WHERE teardown.organization_id = organization
       AND teardown.project_id = requested_project_id
       AND teardown.status = 'requested'
       AND teardown.next_attempt_at <= pg_catalog.now()
     ORDER BY teardown.requested_at, teardown.id;
END;
$$;

-- Vermerkt die Antwort des Brokers. Bestaetigt ist endgueltig; ein Fehlschlag
-- schiebt den naechsten Versuch hinaus, eine Minute und doppelt so lang je
-- Fehlschlag, hoechstens eine Stunde.
CREATE FUNCTION qkern_record_project_database_teardown(
  requested_project_id uuid, requested_teardown_id uuid, confirmed boolean, error_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  organization uuid := public.qkern_current_organization_id();
BEGIN
  IF organization IS NULL OR NOT public.qkern_project_purge_due(requested_project_id) THEN RETURN false; END IF;
  IF confirmed THEN
    UPDATE public.project_database_teardowns AS teardown
       SET status = 'confirmed', confirmed_at = pg_catalog.now(),
           attempt_count = teardown.attempt_count + 1, last_error_code = NULL
     WHERE teardown.organization_id = organization
       AND teardown.project_id = requested_project_id
       AND teardown.id = requested_teardown_id
       AND teardown.status = 'requested';
  ELSE
    UPDATE public.project_database_teardowns AS teardown
       SET attempt_count = teardown.attempt_count + 1,
           last_error_code = error_code,
           next_attempt_at = pg_catalog.now() + LEAST(
             pg_catalog.make_interval(mins => 60),
             pg_catalog.make_interval(mins => (2 ^ LEAST(teardown.attempt_count, 6))::integer))
     WHERE teardown.organization_id = organization
       AND teardown.project_id = requested_project_id
       AND teardown.id = requested_teardown_id
       AND teardown.status = 'requested';
  END IF;
  RETURN FOUND;
END;
$$;

-- `qkern_purge_project` bekommt die Bedingung der Datenbank dazu; Signatur
-- und Koerper sonst wie in 0090.
CREATE OR REPLACE FUNCTION qkern_purge_project(requested_project_id uuid)
RETURNS TABLE (purged_at timestamptz, api_keys_revoked integer, s3_keys_revoked integer, buckets_removed integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  organization uuid := public.qkern_current_organization_id();
  api_count integer;
  s3_count integer;
  bucket_count integer;
BEGIN
  IF organization IS NULL THEN RETURN; END IF;
  PERFORM 1 FROM public.projects AS project
   WHERE project.organization_id = organization
     AND project.id = requested_project_id
     AND project.deleted_at IS NOT NULL
     AND project.delete_after <= pg_catalog.now()
     AND project.purged_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.project_database_backups AS backup
              WHERE backup.organization_id = organization
                AND backup.project_id = requested_project_id
                AND (backup.status IN ('pending', 'running', 'available')
                     OR backup.restore_status IN ('requested', 'running'))) THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.project_storage_objects AS object
              WHERE object.organization_id = organization
                AND object.project_id = requested_project_id
                AND object.deleted_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.project_storage_uploads AS upload
              WHERE upload.organization_id = organization
                AND upload.project_id = requested_project_id
                AND upload.status = 'pending') THEN
    RETURN;
  END IF;

  -- Datenbank (2.177): Jede Bindung braucht eine bestaetigte Abbau-Anfrage,
  -- und kein offener Bereitstellungsauftrag ohne Bindung darf noch eine
  -- Datenbank anlegen.
  IF EXISTS (SELECT 1 FROM public.project_database_bindings AS binding
              WHERE binding.organization_id = organization
                AND binding.project_id = requested_project_id
                AND NOT EXISTS (SELECT 1 FROM public.project_database_teardowns AS teardown
                                 WHERE teardown.organization_id = binding.organization_id
                                   AND teardown.binding_id = binding.id
                                   AND teardown.status = 'confirmed'))
     OR EXISTS (SELECT 1 FROM public.project_database_provisioning_jobs AS job
              WHERE job.organization_id = organization
                AND job.project_id = requested_project_id
                AND job.status IN ('pending', 'running')
                AND NOT EXISTS (SELECT 1 FROM public.project_database_bindings AS bound
                                 WHERE bound.organization_id = job.organization_id
                                   AND bound.project_id = job.project_id
                                   AND bound.environment = job.environment)) THEN
    RETURN;
  END IF;

  DELETE FROM public.project_storage_buckets AS bucket
   WHERE bucket.organization_id = organization
     AND bucket.project_id = requested_project_id;
  GET DIAGNOSTICS bucket_count = ROW_COUNT;

  UPDATE public.project_api_keys AS api_key
     SET revoked_at = pg_catalog.now()
   WHERE api_key.organization_id = organization
     AND api_key.project_id = requested_project_id
     AND api_key.revoked_at IS NULL;
  GET DIAGNOSTICS api_count = ROW_COUNT;

  UPDATE public.project_storage_s3_access_keys AS access_key
     SET revoked_at = pg_catalog.now()
   WHERE access_key.organization_id = organization
     AND access_key.project_id = requested_project_id
     AND access_key.revoked_at IS NULL;
  GET DIAGNOSTICS s3_count = ROW_COUNT;

  RETURN QUERY
    UPDATE public.projects AS project
       SET purged_at = pg_catalog.now(), updated_at = pg_catalog.now()
     WHERE project.organization_id = organization
       AND project.id = requested_project_id
    RETURNING project.purged_at, api_count, s3_count, bucket_count;
END;
$$;

REVOKE ALL ON FUNCTION qkern_open_project_database_teardowns(uuid) FROM PUBLIC, qkern_runtime, qkern_worker, qkern_provisioner;
REVOKE ALL ON FUNCTION qkern_record_project_database_teardown(uuid, uuid, boolean, text) FROM PUBLIC, qkern_runtime, qkern_worker, qkern_provisioner;
REVOKE ALL ON FUNCTION qkern_purge_project(uuid) FROM PUBLIC, qkern_runtime, qkern_worker, qkern_provisioner;
GRANT EXECUTE ON FUNCTION qkern_open_project_database_teardowns(uuid) TO qkern_provisioner;
GRANT EXECUTE ON FUNCTION qkern_record_project_database_teardown(uuid, uuid, boolean, text) TO qkern_provisioner;
GRANT EXECUTE ON FUNCTION qkern_purge_project(uuid) TO qkern_provisioner;

COMMIT;
