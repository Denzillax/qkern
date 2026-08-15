BEGIN;

-- Seit Migration 0019 konnte die Control Plane keinen Apply-Auftrag mehr
-- einreihen.
--
-- `enqueueApproved()` schreibt das Auftragsereignis mit
-- `INSERT … ON CONFLICT (organization_id, migration_job_id, event_type)
-- DO NOTHING`. Ein **benannter** Arbiter verlangt Leserecht auf genau diesen
-- Spalten. Migration 0019 hat `SELECT ON migration_outbox` von `qkern_runtime`
-- entzogen — mit gutem Grund, denn die Laufzeit soll weder Lease noch
-- Broker-Zustand einsehen —, und damit zugleich das Einreihen abgeschaltet.
--
-- Der Auftrag und sein Ereignis stehen in einer Transaktion. Es entstand also
-- nicht etwa ein Auftrag ohne Ereignis, sondern gar nichts: Jede Freigabe mit
-- automatischer Einreihung scheiterte.
--
-- Erteilt werden genau die drei Arbiter-Spalten. Sie tragen keinen Lease- und
-- keinen Broker-Zustand; `status`, `lease_owner`, `lease_token`,
-- `lease_expires_at`, `failure_count` und `available_at` bleiben fuer die
-- Laufzeit unlesbar, und die Absicht von 0019 bleibt damit erhalten. Die
-- Zeilenpolitik aus 0005 bindet den Zugriff weiterhin an die Organisation.
--
-- Ohne benannten Arbiter braeuchte es dieses Recht nicht — `ON CONFLICT DO
-- NOTHING` allein prueft es nicht. Der Arbiter steht aber absichtlich da: Er
-- benennt, welche Gleichheit gemeint ist, statt jede beliebige Verletzung
-- schweigend zu schlucken.
GRANT SELECT (organization_id, migration_job_id, event_type)
  ON migration_outbox TO qkern_runtime;

COMMIT;
