BEGIN;

-- Die Migrations-Warteschlange laesst geloeschte Projekte aus (2.174).
--
-- Seit 2.173 laesst sich ein Projekt loeschen. Die Abholung der Migrationen
-- laeuft unter `qkern_worker`, und diese Rolle durfte `projects` nicht lesen:
-- Sie haette einen Auftrag fuer ein geloeschtes Projekt weiter angewendet.
-- Sie bekommt genau die drei Spalten, mit denen sie fragt, ob ein Projekt
-- geloescht ist, und keine weitere. Die Zeilensicherheit von `projects`
-- gilt auch fuer sie: Sie sieht nur den Mandanten, den sie gesetzt hat.
GRANT SELECT (organization_id, id, deleted_at) ON projects TO qkern_worker;

COMMIT;
