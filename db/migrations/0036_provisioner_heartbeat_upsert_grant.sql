BEGIN;

-- Der Provisioner konnte seit Migration 0021 keinen einzigen Heartbeat
-- schreiben.
--
-- `heartbeat()` schreibt mit `INSERT … ON CONFLICT (organization_id,
-- provisioner_id) DO UPDATE`. PostgreSQL verlangt fuer den Konfliktpfad
-- SELECT-Recht auf den Spalten des Arbiter-Index — 0021 hat nur INSERT und
-- UPDATE (last_seen_at) erteilt und mit `REVOKE ALL` alles andere genommen.
-- Der Aufruf scheitert deshalb mit `permission denied for table`, und zwar
-- schon beim ersten Einfuegen: Das Recht wird beim Planen geprueft, nicht
-- erst beim Konflikt.
--
-- Der Heartbeat steht als **erster** Aufruf in demselben `try`, das auch
-- `quarantineExpired` umfasst, und dessen `catch` verschluckt die Ursache.
-- Damit endete jede Runde des Prozesses in `claim_failed`, bevor sie einen
-- Auftrag auch nur gesucht hat. Release 1.60 hat die beiden anderen
-- Operationen dieses Blocks gegen echtes PostgreSQL belegt — hier lag der
-- Grund.
--
-- Erteilt werden genau die beiden Arbiter-Spalten und keine weitere. Die
-- Zeilenpolitik aus 0021 bleibt die Grenze: Sie bindet jeden Zugriff an
-- `qkern.actor_ref`, ein Provisioner sieht also weiterhin ausschliesslich
-- seinen eigenen Heartbeat und niemals den eines anderen.
GRANT SELECT (organization_id, provisioner_id)
  ON project_database_provisioner_heartbeats TO qkern_provisioner;

COMMIT;
