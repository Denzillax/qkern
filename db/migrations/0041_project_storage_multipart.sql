BEGIN;

-- Fortsetzbare Uploads auf dem Dienstweg — zweite Haelfte von Sprosse 3.
--
-- Ein Multipart-Upload ist dieselbe Reservierung wie ein einfacher, plus die
-- Kennung, unter der der Provider die Teile sammelt. Die Pruefsumme bleibt die
-- der **ganzen** Datei: Der Provider prueft je Teil (signierter Header seit
-- 1.69), und die volle Summe rechnet der Virenscanner beim Abschluss nach —
-- ein Multipart-Objekt wird nur durch diesen nachgerechneten Abgleich sauber.
ALTER TABLE project_storage_uploads
  ADD COLUMN kind text NOT NULL DEFAULT 'single' CHECK (kind IN ('single', 'multipart')),
  ADD COLUMN provider_upload_id text CHECK (provider_upload_id ~ '^[A-Za-z0-9._-]{1,1024}$');

-- Die Kennung gehoert genau zu einem Multipart-Upload — nie zu einem
-- einfachen, nie fehlend bei einem fortsetzbaren.
ALTER TABLE project_storage_uploads
  ADD CONSTRAINT project_storage_uploads_multipart_identity
  CHECK ((kind = 'multipart') = (provider_upload_id IS NOT NULL));

COMMIT;
