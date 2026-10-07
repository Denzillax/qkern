BEGIN;

-- Ein Projekt loeschen, mit Frist (2.173).
--
-- Entschieden von Denzil am 7. Oktober 2026: Ein geloeschtes Projekt ist
-- sofort gesperrt und ausgeblendet und wird nach sieben Tagen endgueltig
-- abgeraeumt, mit Projektdatenbank, Backups und Buckets. Das Audit-Log bleibt,
-- weil es zur Organisation gehoert. Loeschen darf nur die Owner-Rolle; das
-- haelt die Anwendung mit dem Recht `project_delete`, denn die Rolle kennt
-- die Datenbank nicht.
--
-- `deleted_at` gibt es seit 0001, und jeder Leseweg filtert schon darauf. Neu
-- ist nur die Frist. Der CHECK sagt, dass es keine Frist ohne Loeschung gibt;
-- umgekehrt darf eine Loeschung von vor dieser Migration ohne Frist bleiben.
--
-- Warum Funktionen und kein UPDATE-Recht: `qkern_runtime` darf `projects`
-- seit 0020 nicht mehr aendern, und das war Absicht. Die zwei Funktionen
-- aendern genau zwei Spalten, nur im eigenen Mandanten, und nur in die eine
-- Richtung, die sie im Namen tragen. Zurueckholen geht nur vor Ablauf der
-- Frist; danach gehoert die Zeile dem Abraeumer.

ALTER TABLE projects
  ADD COLUMN delete_after timestamptz,
  ADD CONSTRAINT projects_delete_after_needs_deleted
    CHECK (delete_after IS NULL OR (deleted_at IS NOT NULL AND delete_after > deleted_at));

CREATE INDEX projects_deletion_due_idx ON projects (delete_after)
  WHERE deleted_at IS NOT NULL AND delete_after IS NOT NULL;

CREATE FUNCTION qkern_delete_project(requested_project_id uuid)
RETURNS TABLE (deleted_at timestamptz, delete_after timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor text;
BEGIN
  actor := nullif(pg_catalog.current_setting('qkern.actor_ref', true), '');
  IF actor IS NULL OR char_length(actor) > 200 THEN RETURN; END IF;
  RETURN QUERY
    UPDATE public.projects AS project
       SET deleted_at = pg_catalog.now(),
           delete_after = pg_catalog.now() + interval '7 days',
           updated_at = pg_catalog.now()
     WHERE project.organization_id = public.qkern_current_organization_id()
       AND project.id = requested_project_id
       AND project.deleted_at IS NULL
    RETURNING project.deleted_at, project.delete_after;
END;
$$;

CREATE FUNCTION qkern_restore_project(requested_project_id uuid)
RETURNS TABLE (restored_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor text;
BEGIN
  actor := nullif(pg_catalog.current_setting('qkern.actor_ref', true), '');
  IF actor IS NULL OR char_length(actor) > 200 THEN RETURN; END IF;
  RETURN QUERY
    UPDATE public.projects AS project
       SET deleted_at = NULL,
           delete_after = NULL,
           updated_at = pg_catalog.now()
     WHERE project.organization_id = public.qkern_current_organization_id()
       AND project.id = requested_project_id
       AND project.deleted_at IS NOT NULL
       AND project.delete_after > pg_catalog.now()
    RETURNING project.id;
END;
$$;

REVOKE ALL ON FUNCTION qkern_delete_project(uuid) FROM PUBLIC, qkern_runtime, qkern_worker, qkern_provisioner;
REVOKE ALL ON FUNCTION qkern_restore_project(uuid) FROM PUBLIC, qkern_runtime, qkern_worker, qkern_provisioner;
GRANT EXECUTE ON FUNCTION qkern_delete_project(uuid) TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_restore_project(uuid) TO qkern_runtime;

-- Ein geloeschtes Projekt antwortet auf keinen Key mehr, sofort (2.173).
--
-- Gefunden vor dem Bau: Beide Pruefungen kannten nur `revoked_at` und
-- `expires_at` und fragten nie nach dem Projekt. Damit liefen nach dem
-- Loeschen alle Wege weiter, die nur einen Key brauchen: Storage aus der App,
-- der S3-Endpunkt, Realtime-Anmeldung, Project Auth, Queues aus der App und
-- Function-Aufrufe mit Service Key. Nur der Weg in die Projektdatenbank war
-- gesperrt, weil er ueber `projects.get` laeuft.
--
-- Beide Funktionen lesen `projects` ohne gesetzten Mandanten, wie
-- `qkern_memberships_for_user` aus 0003 `organizations` liest: Ihr Eigentuemer
-- ist die Migrationsautoritaet, und fuer sie gilt die Zeilensicherheit nicht.
-- Waere es anders, fiele jeder Key, und die Zertifizierung zeigte es sofort.
CREATE OR REPLACE FUNCTION qkern_authenticate_project_api_key(p_token_hash text)
RETURNS TABLE (
  key_id uuid,
  organization_id uuid,
  project_id uuid,
  environment qkern_environment,
  kind text,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT api_key.id, api_key.organization_id, api_key.project_id,
         api_key.environment, api_key.kind, api_key.expires_at
  FROM public.project_api_keys AS api_key
  JOIN public.projects AS project
    ON project.organization_id = api_key.organization_id
   AND project.id = api_key.project_id
   AND project.deleted_at IS NULL
  WHERE api_key.token_hash = p_token_hash
    AND api_key.revoked_at IS NULL
    AND api_key.expires_at > now()
    AND p_token_hash ~ '^[A-Za-z0-9_-]{43}$'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION qkern_authenticate_project_storage_s3_access_key(p_access_key_id text)
RETURNS TABLE (
  key_id uuid,
  organization_id uuid,
  project_id uuid,
  environment qkern_environment,
  name text,
  access_key_id text,
  secret_hash text,
  secret_ciphertext text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz,
  bucket_ids uuid[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT access_key.id, access_key.organization_id, access_key.project_id,
         access_key.environment, access_key.name, access_key.access_key_id,
         access_key.secret_hash, access_key.secret_ciphertext,
         access_key.expires_at, access_key.revoked_at, access_key.created_by, access_key.created_at,
         coalesce((SELECT array_agg(coupling.bucket_id ORDER BY coupling.bucket_id)
                     FROM public.project_storage_s3_access_key_buckets AS coupling
                    WHERE coupling.organization_id = access_key.organization_id
                      AND coupling.project_id = access_key.project_id
                      AND coupling.environment = access_key.environment
                      AND coupling.key_id = access_key.id), '{}'::uuid[])
  FROM public.project_storage_s3_access_keys AS access_key
  JOIN public.projects AS project
    ON project.organization_id = access_key.organization_id
   AND project.id = access_key.project_id
   AND project.deleted_at IS NULL
  WHERE access_key.access_key_id = p_access_key_id
    AND access_key.revoked_at IS NULL
    AND access_key.expires_at > now()
    AND access_key.secret_ciphertext IS NOT NULL
    AND p_access_key_id ~ '^QKERNS3[A-Z2-7]{16}$'
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION qkern_authenticate_project_api_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qkern_authenticate_project_api_key(text) TO qkern_auth;
REVOKE ALL ON FUNCTION qkern_authenticate_project_storage_s3_access_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qkern_authenticate_project_storage_s3_access_key(text) TO qkern_runtime;

COMMIT;
