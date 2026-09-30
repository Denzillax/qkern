BEGIN;

-- Multipart am S3-Endpunkt: eine Reservierung, deren Groesse mit den Teilen kommt.
--
-- Der fortsetzbare Upload ueber REST (0041) kennt Groesse und Pruefsumme der
-- ganzen Datei, bevor das erste Teil fliegt: Der Client sagt sie in
-- `prepareMultipartUpload` zu, die Reservierung haelt sie fest, und der Scanner
-- rechnet sie beim Abschluss nach.
--
-- Ein S3-Client sagt beides nicht zu. `CreateMultipartUpload` nennt Bucket,
-- Schluessel und Inhaltstyp, mehr nicht; wie gross die Datei wird, weiss erst
-- `CompleteMultipartUpload`. Damit dieselbe Reservierung trotzdem Quota und
-- Schluessel-Eindeutigkeit traegt, gibt es eine zweite Sorte:
-- `parts_declared` heisst "die Groesse waechst mit den Teilen". Sie beginnt bei
-- null Bytes, jedes angenommene Teil erhoeht sie unter derselben Quota-Pruefung
-- wie eine Reservierung, und beim Abschluss steht die Summe da, gegen die der
-- HEAD des Providers geprueft wird.
--
-- Die Pruefsumme der ganzen Datei bleibt es, die den Scanner sauber machen
-- laesst. Sie ist bis zum Abschluss NULL und wird dort eingetragen, nachdem der
-- Endpunkt das zusammengesetzte Objekt ueber eine Lesezusage des Dienstes
-- durchgerechnet hat. Erst dann laeuft der Scan, und nur sein Abgleich
-- entscheidet zwischen sauber und Quarantaene.
ALTER TABLE project_storage_uploads
  ADD COLUMN parts_declared boolean NOT NULL DEFAULT false;

-- Nur ein fortsetzbarer Upload darf seine Groesse nachliefern.
ALTER TABLE project_storage_uploads
  ADD CONSTRAINT project_storage_uploads_parts_declared_multipart
  CHECK (NOT parts_declared OR kind = 'multipart');

-- Null Bytes und keine Pruefsumme gibt es nur bei dieser Sorte. Ein
-- abgeschlossener Upload hat beides, egal welcher Sorte er ist: Ohne Groesse
-- stimmt die Quota nicht, und ohne Pruefsumme hatte der Scanner nichts
-- nachzurechnen.
ALTER TABLE project_storage_uploads
  DROP CONSTRAINT project_storage_uploads_size_bytes_check;

ALTER TABLE project_storage_uploads
  ADD CONSTRAINT project_storage_uploads_size_bytes_check
  CHECK (size_bytes BETWEEN 0 AND 5368709120 AND (size_bytes > 0 OR parts_declared));

ALTER TABLE project_storage_uploads
  ALTER COLUMN checksum_sha256 DROP NOT NULL;

ALTER TABLE project_storage_uploads
  DROP CONSTRAINT project_storage_uploads_checksum_sha256_check;

ALTER TABLE project_storage_uploads
  ADD CONSTRAINT project_storage_uploads_checksum_sha256_check
  CHECK ((checksum_sha256 IS NULL AND parts_declared) OR checksum_sha256 ~ '^[A-Za-z0-9+/]{43}=$');

ALTER TABLE project_storage_uploads
  ADD CONSTRAINT project_storage_uploads_completed_content
  CHECK (status <> 'completed' OR (size_bytes > 0 AND checksum_sha256 IS NOT NULL));

-- Die Teile, die der Endpunkt angenommen und zum Provider weitergereicht hat.
--
-- Sie stehen hier aus drei Gruenden. Erstens traegt jedes Teil die Bytes, um
-- die die Reservierung gewachsen ist; ohne diesen Satz weiss niemand, was ein
-- zweites `UploadPart` mit derselben Nummer an Quota freigibt. Zweitens
-- verlangt `CompleteMultipartUpload`, dass jedes genannte Teil eines ist, das
-- dieser Endpunkt mit geprueften Bytes abgelegt hat, in aufsteigender
-- Reihenfolge. Drittens beantwortet `ListParts` daraus, ohne den Provider zu
-- fragen.
--
-- Die Zeilen haengen an der Reservierung: Verfaellt oder endet sie, raeumt der
-- Fremdschluessel mit ab, und der Lifecycle findet den Provider-Upload
-- weiterhin ueber `provider_upload_id` derselben Zeile.
CREATE TABLE project_storage_upload_parts (
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  upload_id uuid NOT NULL,
  part_number integer NOT NULL CHECK (part_number BETWEEN 1 AND 10000),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 5368709120),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[A-Za-z0-9+/]{43}=$'),
  etag text CHECK (etag IS NULL OR char_length(etag) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, project_id, environment, upload_id, part_number),
  FOREIGN KEY (organization_id, project_id, environment, upload_id)
    REFERENCES project_storage_uploads (organization_id, project_id, environment, id)
    ON DELETE CASCADE
);

CREATE INDEX project_storage_upload_parts_upload_idx
  ON project_storage_upload_parts (organization_id, project_id, environment, upload_id, part_number);

-- Der Verifizierer einer Reservierung bleibt unbeweglich; diese Sorte bekommt
-- ihn erst.
--
-- Der Waechter aus 0025 haelt `size_bytes` und `checksum_sha256` fest, sobald
-- eine Reservierung steht. Das ist der Grund, warum eine Zusage etwas wert
-- ist: Was der Client zugesagt hat, kann danach niemand mehr umschreiben, auch
-- die Laufzeit nicht. Bei einer Reservierung, deren Groesse mit den Teilen
-- kommt, gibt es beim Anlegen noch nichts festzuhalten, also erlaubt der
-- Waechter genau zwei Bewegungen, und nur solange die Teile fliegen:
--
--   * `size_bytes` darf sich aendern, weil jedes angenommene Teil sie erhoeht
--     und ein ersetztes Teil sie senkt;
--   * `checksum_sha256` darf **einmal** von NULL auf einen Wert gehen, beim
--     Abschluss, nachdem das zusammengesetzte Objekt durchgerechnet wurde.
--
-- Ein Wert, der schon steht, bleibt stehen. Eine Reservierung des REST-Wegs
-- (`parts_declared = false`) ist unberuehrt: Dort gilt weiter, dass beides von
-- der ersten Zeile an unbeweglich ist.
CREATE OR REPLACE FUNCTION qkern_reject_project_storage_upload_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
     NEW.project_id IS DISTINCT FROM OLD.project_id OR
     NEW.environment IS DISTINCT FROM OLD.environment OR NEW.id IS DISTINCT FROM OLD.id OR
     NEW.bucket_id IS DISTINCT FROM OLD.bucket_id OR NEW.object_key IS DISTINCT FROM OLD.object_key OR
     NEW.provider_key IS DISTINCT FROM OLD.provider_key OR NEW.owner_subject IS DISTINCT FROM OLD.owner_subject OR
     NEW.content_type IS DISTINCT FROM OLD.content_type OR
     NEW.completion_token_hash IS DISTINCT FROM OLD.completion_token_hash OR
     NEW.parts_declared IS DISTINCT FROM OLD.parts_declared OR
     NEW.kind IS DISTINCT FROM OLD.kind OR
     NEW.provider_upload_id IS DISTINCT FROM OLD.provider_upload_id OR
     NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR
     OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'project storage upload verifier and identity are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.size_bytes IS DISTINCT FROM OLD.size_bytes AND NOT OLD.parts_declared THEN
    RAISE EXCEPTION 'project storage upload verifier and identity are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.checksum_sha256 IS DISTINCT FROM OLD.checksum_sha256 AND
     (NOT OLD.parts_declared OR OLD.checksum_sha256 IS NOT NULL) THEN
    RAISE EXCEPTION 'project storage upload verifier and identity are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- Und die Laufzeit darf genau diese zwei Spalten anfassen, keine dritte.
GRANT UPDATE (size_bytes, checksum_sha256) ON project_storage_uploads TO qkern_runtime;

-- Die Teiletabelle unter denselben Regeln wie die Reservierung: niemand aus
-- PUBLIC, Zeilensicherheit je Organisation, und die Laufzeit darf lesen,
-- schreiben, die Kennung nachtragen und beim Abschluss aufraeumen.
REVOKE ALL ON project_storage_upload_parts FROM PUBLIC;

ALTER TABLE project_storage_upload_parts ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_storage_upload_parts_select ON project_storage_upload_parts
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_storage_upload_parts_insert ON project_storage_upload_parts
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_storage_upload_parts_update ON project_storage_upload_parts
  FOR UPDATE USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_storage_upload_parts_delete ON project_storage_upload_parts
  FOR DELETE USING (organization_id = qkern_current_organization_id());

GRANT SELECT, INSERT, DELETE ON project_storage_upload_parts TO qkern_runtime;
GRANT UPDATE (size_bytes, checksum_sha256, etag, created_at) ON project_storage_upload_parts TO qkern_runtime;

COMMIT;
