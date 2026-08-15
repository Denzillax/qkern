BEGIN;

-- Der Provisioner konnte seit Migration 0020 keine Bindung schreiben.
--
-- `complete()` schreibt mit `INSERT … RETURNING`, und `RETURNING` verlangt
-- SELECT-Recht auf den zurueckgegebenen Spalten. Migration 0020 hat nur
-- `GRANT INSERT ON project_database_bindings` erteilt. Der Aufruf endet mit
-- `permission denied for table` — die Zeile wird nie geschrieben, weil die
-- ganze Anweisung abgewiesen wird.
--
-- Es ist dieselbe Klasse Fehler wie beim Heartbeat in Migration 0036: Ein
-- Recht, das nicht die Operation verlangt, sondern eine ihrer Klauseln. Beide
-- Male hat kein Test es gefunden, weil kein Test die Operation je mit der
-- echten Rolle ausgefuehrt hat.
--
-- Die Zeilenpolitik `project_database_bindings_tenant` aus 0020 bleibt die
-- Grenze: Sie bindet jeden Zugriff an `qkern_current_organization_id()`, ein
-- Provisioner sieht also ausschliesslich Bindungen seiner eigenen
-- Organisation.
GRANT SELECT ON project_database_bindings TO qkern_provisioner;

COMMIT;
