BEGIN;

-- Der Abraeumer fuer geloeschte Projekte, erster Teil (2.175).
--
-- Entschieden von Denzil (docs/PROJEKT_LOESCHEN.md): Nach sieben Tagen werden
-- Projektdatenbank, Backups und Buckets entfernt; das Audit-Log und die
-- Abrechnung bleiben. Die Zeile in `projects` bleibt darum als Huelle stehen,
-- und `purged_at` sagt, wann sie zur Huelle wurde.
--
-- Dieser Schnitt raeumt ab, was Daten traegt oder Zugang gibt: die Backups
-- (Objekt und Schluessel, das erledigt der Provisioner vor dem Aufruf, wie in
-- `pruneExpired`) und die Keys. Buckets kommen mit 2.176, der Abbau der
-- Datenbank ueber den Broker mit 2.177.
--
-- Warum eine Funktion und keine Rechte: Der Provisioner soll Keys widerrufen
-- und genau eine Spalte in `projects` setzen koennen, und beides nur fuer ein
-- Projekt, dessen Frist abgelaufen ist. Mit Spaltenrechten koennte er jeden
-- Key jedes Projekts widerrufen. Die Funktion prueft die Frist selbst.
--
-- Sie setzt `purged_at` nur, wenn kein Backup des Projekts mehr lesbar ist und
-- keines mehr laeuft, und keine Wiederherstellung mehr wartet. Ein Backup, das
-- im Moment des Loeschens lief, wird sonst nach dem Abraeumen fertig, und ein
-- lesbares Backup eines abgeraeumten Projekts bliebe liegen. Dann kommt eine
-- leere Antwort zurueck, und der naechste Lauf versucht es wieder.

ALTER TABLE projects
  ADD COLUMN purged_at timestamptz,
  ADD CONSTRAINT projects_purged_after_deadline
    CHECK (purged_at IS NULL OR (deleted_at IS NOT NULL AND delete_after IS NOT NULL AND purged_at >= delete_after));

CREATE FUNCTION qkern_purge_project(requested_project_id uuid)
RETURNS TABLE (purged_at timestamptz, api_keys_revoked integer, s3_keys_revoked integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  organization uuid := public.qkern_current_organization_id();
  api_count integer;
  s3_count integer;
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
    RETURNING project.purged_at, api_count, s3_count;
END;
$$;

REVOKE ALL ON FUNCTION qkern_purge_project(uuid) FROM PUBLIC, qkern_runtime, qkern_worker, qkern_provisioner;
GRANT EXECUTE ON FUNCTION qkern_purge_project(uuid) TO qkern_provisioner;

COMMIT;
