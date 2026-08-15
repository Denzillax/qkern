-- 0043: Der CHECK auf provider_upload_id aus 0041 war nie erfuellbar.
--
-- POSIX-Regexe in PostgreSQL erlauben hoechstens 255 Wiederholungen je
-- Quantor; '{1,1024}' wirft zur **Laufzeit** "invalid regular expression:
-- invalid repetition count(s)" — beim ersten INSERT mit einem Wert, nicht
-- beim Anlegen der Bedingung. Jede Multipart-Reservierung gegen eine echte
-- Datenbank scheiterte damit seit 0041; Single-Uploads blieben unberuehrt,
-- weil NULL die Bedingung nie auswertet. Gefunden vom ersten Real-DB-Fall,
-- der gezielt einen Multipart-Upload reserviert (1.78).
--
-- Die Laenge prueft jetzt length(), das Alphabet die Regex ohne Zaehlgrenze.
ALTER TABLE project_storage_uploads
  DROP CONSTRAINT project_storage_uploads_provider_upload_id_check;

ALTER TABLE project_storage_uploads
  ADD CONSTRAINT project_storage_uploads_provider_upload_id_check
  CHECK (provider_upload_id ~ '^[A-Za-z0-9._-]+$' AND length(provider_upload_id) <= 1024);
