-- Registry-Bezüge mit Port.
--
-- Der Check aus Migration 0033 liess keinen Doppelpunkt zu. Damit war jede
-- Registry mit Port ausgeschlossen — also jede lokale, jede in einem Cluster
-- und jede in einem Zertifizierungsstack. Aufgefallen ist das erst, als
-- Release 1.35 versuchte, eine **echte** Registry zu benutzen: Bis dahin trug
-- jede Definition eine erfundene Referenz, und die kam ohne Port aus.
--
-- Die bindende Stelle bleibt unverändert der Digest. Was vor dem `@` steht, ist
-- nur die Adresse, unter der gesucht wird; Docker löst über den Digest auf.
-- Deshalb wird hier genau ein Zeichen mehr erlaubt und nichts weiter
-- aufgeweicht: Der `@sha256:`-Teil ist weiterhin Pflicht.
--
-- Anfang und Ende bleiben alphanumerisch. Ein Bezug, der auf `:` oder `/`
-- endet, wäre keine Adresse, sondern ein Tippfehler.

ALTER TABLE project_functions DROP CONSTRAINT project_functions_image_check;

ALTER TABLE project_functions
  ADD CONSTRAINT project_functions_image_check
  CHECK (image ~ '^[a-z0-9][a-z0-9.:/_-]{1,254}[a-z0-9]@sha256:[0-9a-f]{64}$');
