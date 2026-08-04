-- Repariert die Zeilensperre auf Queue-Definitionen.
--
-- enqueue, claim und settle sperren die Definitionszeile mit
-- SELECT ... FOR UPDATE, damit eine gleichzeitige Definitionsaenderung nicht
-- gegen einen Nachrichtenschreibvorgang laufen kann. PostgreSQL verlangt fuer
-- jede Sperrklausel zusaetzlich zu SELECT die UPDATE-Berechtigung auf
-- mindestens einer Spalte (siehe GRANT, Abschnitt UPDATE).
--
-- Migration 0026 gewaehrte qkern_runtime nur SELECT und INSERT auf
-- project_queues. Jedes dauerhafte enqueue scheiterte deshalb mit
-- "permission denied for table project_queues": der PostgreSQL-Queue-Adapter
-- konnte seit seiner Einfuehrung keine einzige Nachricht schreiben. Der Fehler
-- blieb unentdeckt, weil der Memory-Adapter kein Rechtemodell besitzt und die
-- optionalen Real-DB-Tests nie ausgefuehrt wurden.
--
-- Die Erweiterung bleibt eng: genau eine Spalte, und der Trigger
-- project_queues_immutable aus 0026 weist weiterhin jedes UPDATE auf dieser
-- Tabelle ab, unabhaengig vom Recht. Die Sperre ist damit erreichbar, die
-- Definition bleibt unveraenderlich.

GRANT UPDATE (updated_at) ON project_queues TO qkern_runtime;

-- Zweiter Teil desselben Fehlers: Unter aktivem Row Level Security muss eine
-- Zeile fuer SELECT ... FOR UPDATE nicht nur die SELECT-Policy erfuellen,
-- sondern auch eine UPDATE-Policy. 0026 definiert fuer project_queues nur
-- project_queues_select und project_queues_insert. Ohne UPDATE-Policy liefert
-- die Sperrabfrage deshalb selbst mit korrektem Recht keine Zeile, und enqueue
-- haette den Vertrag weiterhin als QUEUE_CONFLICT abgewiesen.
--
-- WITH CHECK (false) stellt sicher, dass ueber diese Policy niemals eine Zeile
-- geschrieben werden kann. Zusammen mit dem Trigger project_queues_immutable
-- bleibt die Definition auch dann unveraenderlich, wenn der Trigger je
-- entfernt wuerde.
CREATE POLICY project_queues_lock ON project_queues
  FOR UPDATE USING (organization_id = qkern_current_organization_id())
  WITH CHECK (false);
