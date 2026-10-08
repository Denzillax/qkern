BEGIN;

-- Der Abraeumer fuer geloeschte Projekte, zweiter Teil: Storage (2.176).
--
-- Entschieden von Denzil (docs/PROJEKT_LOESCHEN.md): Die Buckets eines
-- Projekts gehen mit ihm. Die Reihenfolge ist dieselbe wie bei den Backups:
-- erst verschwindet die Datei beim Anbieter, dann vergisst der Katalog sie.
-- Den Anbieter erreicht nur der Provisioner, darum ruft er hier drei
-- Funktionen und haelt dazwischen die Dateien selbst ab.
--
-- 1. `qkern_list_project_purge_storage` nennt, was beim Anbieter noch liegt:
--    lebende Objekte (`deleted_at IS NULL`) und offene Uploads (`pending`).
-- 2. `qkern_forget_project_purge_storage` vermerkt eines davon als weg: ein
--    Objekt bekommt `deleted_at`, ein Upload wird `cancelled`. Beides laesst
--    der Schutz-Trigger aus 0025 schon zu; es ist derselbe Schritt wie beim
--    Loeschen eines Objekts durch den Nutzer.
-- 3. `qkern_purge_project` loescht danach die Buckets (die Kaskade nimmt
--    Objekt-, Upload- und Teilzeilen und die Bucket-Zuordnung der S3-Schluessel
--    mit) und setzt erst dann `purged_at`. Liegt noch ein lebendes Objekt
--    oder ein offener Upload, kommt eine leere Antwort zurueck, wie bei einem
--    laufenden Backup.
--
-- Alle drei pruefen die Frist selbst: Ein Projekt, das nicht geloescht ist
-- oder dessen Frist noch laeuft, sieht der Provisioner hier nicht.

CREATE FUNCTION qkern_project_purge_due(requested_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects AS project
     WHERE project.organization_id = public.qkern_current_organization_id()
       AND project.id = requested_project_id
       AND project.deleted_at IS NOT NULL
       AND project.delete_after <= pg_catalog.now()
       AND project.purged_at IS NULL);
$$;

CREATE FUNCTION qkern_list_project_purge_storage(requested_project_id uuid, max_rows integer)
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
         AND upload.status = 'pending'
    ) AS entry
    ORDER BY entry.created_at, entry.id
    LIMIT bounded;
END;
$$;

CREATE FUNCTION qkern_forget_project_purge_storage(requested_project_id uuid, entry_kind text, entry_id uuid)
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
    RETURN FOUND;
  END IF;
  RETURN false;
END;
$$;

-- `qkern_purge_project` bekommt eine Spalte dazu; das geht nur ueber
-- DROP und CREATE. Der Rest ist der Koerper aus 0089 und der neue Block.
DROP FUNCTION qkern_purge_project(uuid);

CREATE FUNCTION qkern_purge_project(requested_project_id uuid)
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

  -- Storage (2.176): Erst wenn beim Anbieter nichts mehr liegt, das der
  -- Katalog kennt, duerfen die Buckets gehen. Sonst verloere die Kaskade den
  -- letzten Verweis auf eine Datei, die noch da ist.
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

REVOKE ALL ON FUNCTION qkern_project_purge_due(uuid) FROM PUBLIC, qkern_runtime, qkern_worker, qkern_provisioner;
REVOKE ALL ON FUNCTION qkern_list_project_purge_storage(uuid, integer) FROM PUBLIC, qkern_runtime, qkern_worker, qkern_provisioner;
REVOKE ALL ON FUNCTION qkern_forget_project_purge_storage(uuid, text, uuid) FROM PUBLIC, qkern_runtime, qkern_worker, qkern_provisioner;
REVOKE ALL ON FUNCTION qkern_purge_project(uuid) FROM PUBLIC, qkern_runtime, qkern_worker, qkern_provisioner;
GRANT EXECUTE ON FUNCTION qkern_project_purge_due(uuid) TO qkern_provisioner;
GRANT EXECUTE ON FUNCTION qkern_list_project_purge_storage(uuid, integer) TO qkern_provisioner;
GRANT EXECUTE ON FUNCTION qkern_forget_project_purge_storage(uuid, text, uuid) TO qkern_provisioner;
GRANT EXECUTE ON FUNCTION qkern_purge_project(uuid) TO qkern_provisioner;

COMMIT;
