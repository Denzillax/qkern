BEGIN;

-- Verfallene und abgebrochene Uploads geben ihre Datei beim Anbieter frei (2.178).
--
-- Bis hierher konnte ein Upload, der nie abgeschlossen wurde, eine Datei beim
-- Anbieter hinterlassen: Ein einfacher Upload, dessen vorab signierte Anfrage
-- ausgefuehrt, aber nie abgeschlossen wurde, verfiel nur im Katalog
-- (`status = 'expired'`). Fuer Multipart gab es seit 1.78 das Netz der
-- Waisen, fuer einfache Uploads keines, und der Anbieter kann sie nicht
-- auflisten, ohne den ganzen Bucket zu lesen.
--
-- Jetzt traegt jeder Upload, der nicht abgeschlossen wurde, einen Vermerk:
-- `provider_released_at`. Er wird gesetzt, nachdem die Datei beim Anbieter
-- geloescht (einfach) oder der Upload abgebrochen (Multipart) ist; beides gilt
-- auch bei 404 als erledigt. Ohne Vermerk nimmt die Lifecycle-Runde den Upload
-- wieder, bis es klappt. Der Schluessel einer Reservierung enthaelt ihre
-- eigene Kennung (`<scope>/<bucket>/<upload>/<key>`), ein Loeschen trifft also
-- nie ein abgeschlossenes Objekt.
--
-- Der Abraeumer (2.176) nimmt diese Uploads ebenfalls, und `qkern_purge_project`
-- loescht die Buckets erst, wenn keiner mehr ohne Vermerk ist: Die Kaskade
-- naehme sonst den letzten Verweis auf eine Datei mit, die noch liegt.

ALTER TABLE project_storage_uploads
  ADD COLUMN provider_released_at timestamptz,
  ADD CONSTRAINT project_storage_uploads_provider_release
    CHECK (provider_released_at IS NULL OR status IN ('expired', 'cancelled'));

CREATE INDEX project_storage_uploads_unreleased_idx
  ON project_storage_uploads (organization_id, project_id, environment, created_at, id)
  WHERE status IN ('expired', 'cancelled') AND provider_released_at IS NULL;

-- Der Schutz aus 0071, mit genau einer neuen Ausnahme: Ein verfallener oder
-- abgebrochener Upload darf seinen Vermerk einmal von NULL auf einen Wert
-- setzen, und sonst nichts aendern. Jede andere Aenderung des Vermerks ist
-- verboten, auch solange der Upload noch offen ist.
CREATE OR REPLACE FUNCTION qkern_reject_project_storage_upload_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  probe public.project_storage_uploads;
BEGIN
  IF OLD.status IN ('expired', 'cancelled') AND OLD.provider_released_at IS NULL AND
     NEW.provider_released_at IS NOT NULL THEN
    probe := NEW;
    probe.provider_released_at := NULL;
    IF probe IS NOT DISTINCT FROM OLD THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.provider_released_at IS DISTINCT FROM OLD.provider_released_at THEN
    RAISE EXCEPTION 'project storage upload verifier and identity are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
     NEW.project_id IS DISTINCT FROM OLD.project_id OR
     NEW.environment IS DISTINCT FROM OLD.environment OR NEW.id IS DISTINCT FROM OLD.id OR
     NEW.bucket_id IS DISTINCT FROM OLD.bucket_id OR NEW.object_key IS DISTINCT FROM OLD.object_key OR
     NEW.provider_key IS DISTINCT FROM OLD.provider_key OR NEW.owner_subject IS DISTINCT FROM OLD.owner_subject OR
     NEW.content_type IS DISTINCT FROM OLD.content_type OR
     NEW.completion_token_hash IS DISTINCT FROM OLD.completion_token_hash OR
     NEW.parts_declared IS DISTINCT FROM OLD.parts_declared OR
     NEW.kind IS DISTINCT FROM OLD.kind OR
     NEW.provider_upload_id IS DISTINCT FROM OLD.provider_upload_id OR
     NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR
     OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'project storage upload verifier and identity are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.size_bytes IS DISTINCT FROM OLD.size_bytes AND NOT OLD.parts_declared THEN
    RAISE EXCEPTION 'project storage upload verifier and identity are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.checksum_sha256 IS DISTINCT FROM OLD.checksum_sha256 AND
     (NOT OLD.parts_declared OR OLD.checksum_sha256 IS NOT NULL) THEN
    RAISE EXCEPTION 'project storage upload verifier and identity are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

GRANT UPDATE (provider_released_at) ON project_storage_uploads TO qkern_runtime;

-- Der Abraeumer: die Liste nimmt nicht freigegebene verfallene und
-- abgebrochene Uploads dazu, das Vergessen setzt bei ihnen den Vermerk.
CREATE OR REPLACE FUNCTION qkern_list_project_purge_storage(requested_project_id uuid, max_rows integer)
RETURNS TABLE (kind text, id uuid, provider_key text, provider_upload_id text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  organization uuid := public.qkern_current_organization_id();
  bounded integer := LEAST(GREATEST(COALESCE(max_rows, 1), 1), 200);
BEGIN
  IF organization IS NULL OR NOT public.qkern_project_purge_due(requested_project_id) THEN RETURN; END IF;
  RETURN QUERY
    SELECT entry.kind, entry.id, entry.provider_key, entry.provider_upload_id FROM (
      SELECT 'object'::text AS kind, object.id, object.provider_key, NULL::text AS provider_upload_id,
             object.created_at
        FROM public.project_storage_objects AS object
       WHERE object.organization_id = organization
         AND object.project_id = requested_project_id
         AND object.deleted_at IS NULL
      UNION ALL
      SELECT 'upload'::text, upload.id, upload.provider_key, upload.provider_upload_id, upload.created_at
        FROM public.project_storage_uploads AS upload
       WHERE upload.organization_id = organization
         AND upload.project_id = requested_project_id
         AND (upload.status = 'pending'
              OR (upload.status IN ('expired', 'cancelled') AND upload.provider_released_at IS NULL))
    ) AS entry
    ORDER BY entry.created_at, entry.id
    LIMIT bounded;
END;
$$;

CREATE OR REPLACE FUNCTION qkern_forget_project_purge_storage(requested_project_id uuid, entry_kind text, entry_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  organization uuid := public.qkern_current_organization_id();
BEGIN
  IF organization IS NULL OR NOT public.qkern_project_purge_due(requested_project_id) THEN RETURN false; END IF;
  IF entry_kind = 'object' THEN
    UPDATE public.project_storage_objects AS object
       SET deleted_at = pg_catalog.now()
     WHERE object.organization_id = organization
       AND object.project_id = requested_project_id
       AND object.id = entry_id
       AND object.deleted_at IS NULL;
    RETURN FOUND;
  ELSIF entry_kind = 'upload' THEN
    UPDATE public.project_storage_uploads AS upload
       SET status = 'cancelled'
     WHERE upload.organization_id = organization
       AND upload.project_id = requested_project_id
       AND upload.id = entry_id
       AND upload.status = 'pending';
    IF FOUND THEN
      -- Zweiter Schritt, weil der Schutz den Vermerk nur an einem schon
      -- abgebrochenen Upload zulaesst.
      UPDATE public.project_storage_uploads AS upload
         SET provider_released_at = pg_catalog.now()
       WHERE upload.organization_id = organization
         AND upload.project_id = requested_project_id
         AND upload.id = entry_id;
      RETURN true;
    END IF;
    UPDATE public.project_storage_uploads AS upload
       SET provider_released_at = pg_catalog.now()
     WHERE upload.organization_id = organization
       AND upload.project_id = requested_project_id
       AND upload.id = entry_id
       AND upload.status IN ('expired', 'cancelled')
       AND upload.provider_released_at IS NULL;
    RETURN FOUND;
  END IF;
  RETURN false;
END;
$$;

-- `qkern_purge_project` wie in 0091, mit der Bedingung der Freigabe.
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
                AND (upload.status = 'pending'
                     OR (upload.status IN ('expired', 'cancelled') AND upload.provider_released_at IS NULL))) THEN
    RETURN;
  END IF;

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

REVOKE ALL ON FUNCTION qkern_list_project_purge_storage(uuid, integer) FROM PUBLIC, qkern_runtime, qkern_worker, qkern_provisioner;
REVOKE ALL ON FUNCTION qkern_forget_project_purge_storage(uuid, text, uuid) FROM PUBLIC, qkern_runtime, qkern_worker, qkern_provisioner;
REVOKE ALL ON FUNCTION qkern_purge_project(uuid) FROM PUBLIC, qkern_runtime, qkern_worker, qkern_provisioner;
GRANT EXECUTE ON FUNCTION qkern_list_project_purge_storage(uuid, integer) TO qkern_provisioner;
GRANT EXECUTE ON FUNCTION qkern_forget_project_purge_storage(uuid, text, uuid) TO qkern_provisioner;
GRANT EXECUTE ON FUNCTION qkern_purge_project(uuid) TO qkern_provisioner;

COMMIT;
