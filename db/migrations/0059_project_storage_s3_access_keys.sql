BEGIN;

-- S3-Zugang (2.78): ausgegebene Schluesselpaare je Projektumgebung und
-- Bucket-Satz, einmal gezeigt und widerrufbar.
--
-- ## Warum hier nur die Ausgabe steht und kein Pruefweg
--
-- Der Auftrag kannte zwei Wege. Beide sind geprueft, und beide enden hier.
--
-- Weg 1, ein Schluesselpaar beim Objektspeicher selbst anlegen, waere der
-- bessere: Das fremde Werkzeug spraeche direkt mit dem Provider, und QKERN
-- stuende nicht im Byte-Strom. Der Weg ist nicht gebaut, weil er mit dem
-- vorhandenen Provider nicht geht. `ProjectStorageProvider` in
-- lib/server/project-storage/provider.ts kennt Zusagen, HEAD, DELETE und die
-- Multipart-Verben, aber keine Operation, die Zugangsdaten anlegt; es gibt
-- weder IAM noch STS. Und die Rechte sind gar nicht je Bucket zu trennen: Der
-- Dienst legt jedes Objekt jeder Organisation in genau einen Provider-Bucket
-- (`QKERN_PROJECT_STORAGE_S3_BUCKET`) und trennt allein ueber das Praefix
-- `organisation/projekt/umgebung/bucket/upload/schluessel`. Ein QKERN-Bucket
-- ist eine Zeile in `project_storage_buckets`, kein Bucket des Providers. Wer
-- hier ein Provider-Schluesselpaar ausgaebe, gaebe den ganzen Speicher aller
-- Mandanten heraus. Der Zertifizierungsstack bestaetigt das Bild: versitygw
-- laeuft mit genau einem Wurzelkonto (-a/-s) auf einem posix-Backend.
--
-- Weg 2, ein Schluesselpaar gegen QKERN selbst, mit selbst geprufter
-- SigV4-Signatur, scheitert an der Zusage dieses Slices. Wer SigV4 prueft,
-- muss die Signatur nachrechnen, und die Rechnung ist eine HMAC-Kette aus dem
-- Geheimnis. Ein Pruefer braucht also das Geheimnis selbst oder einen daraus
-- abgeleiteten Signierschluessel, der nur einen Tag und eine Region gilt und
-- damit das Geheimnis fuer den naechsten Tag wieder verlangt. Gespeichert wird
-- hier aber ein SHA-256-Hash, und aus einem Hash laesst sich kein HMAC
-- rechnen. Ein Pruefweg und "nie der Wert" sind zusammen nicht zu haben. Ein
-- halb geprufter Signaturweg waere schlechter als kein Zugang, also gibt es
-- keinen.
--
-- Was bleibt, ist ehrlich das, was diese Tabelle hergibt: die Erklaerung, wer
-- mit welchem Paar auf welche Buckets welcher Umgebung duerfen soll, bis
-- wann, und der Widerruf. Kein Endpunkt nimmt ein solches Paar heute an, und
-- die Console sagt genau diesen Satz. Wer spaeter einen Pruefweg baut, prueft
-- gegen diese Zeilen -- und muss dann zuerst entscheiden, wo das Geheimnis
-- liegen soll, denn hier liegt es nicht.
--
-- ## Warum der Bucket-Satz eine zweite Tabelle ist
--
-- "Ein Schluessel gehoert zu einem Satz Buckets" waere als uuid[] eine Spalte
-- ohne Fremdschluessel: Ein geloeschter Bucket bliebe als Nummer im Array
-- stehen, und der Satz zeigte auf nichts. Die Kopplungstabelle traegt je
-- Zeile einen echten Fremdschluessel auf `project_storage_buckets` mit
-- demselben Umgebungsschluessel, also greift das Loeschen eines Buckets
-- durch. Derselbe Schnitt wie 0057 fuer die Dashboard-Webhooks.

CREATE TABLE project_storage_s3_access_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  -- Der oeffentliche Teil des Paars. Er traegt bewusst QKERNs eigenes
  -- Praefix und nicht die Form eines Provider-Schluessels: Ein Paar, das
  -- aussieht wie ein Zugang zum Objektspeicher, aber keiner ist, waere die
  -- Unehrlichkeit, die dieser Slice gerade vermeidet.
  access_key_id text COLLATE "C" NOT NULL UNIQUE
    CHECK (access_key_id ~ '^QKERNS3[A-Z2-7]{16}$'),
  -- Nur der Hash des Geheimnisses, dieselbe Form wie bei den Projekt-Keys in
  -- 0023: SHA-256, base64url, 43 Zeichen. Es gibt keine Spalte fuer den Wert,
  -- also kann ihn auch kein spaeterer Fehlgriff hier ablegen.
  secret_hash text COLLATE "C" NOT NULL UNIQUE
    CHECK (secret_hash ~ '^[A-Za-z0-9_-]{43}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE CASCADE,
  -- Der Umgebungsschluessel, auf den die Kopplungstabelle zeigt. Er nimmt die
  -- Umgebung mit, damit ein Bucket-Satz nicht ueber die Umgebungsgrenze
  -- zeigen kann.
  CONSTRAINT project_storage_s3_access_keys_scope_id_key
    UNIQUE (organization_id, project_id, environment, id),
  CONSTRAINT project_storage_s3_access_keys_expiry_after_creation
    CHECK (expires_at > created_at),
  CONSTRAINT project_storage_s3_access_keys_revocation_after_creation
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX project_storage_s3_access_keys_scope_idx
  ON project_storage_s3_access_keys (organization_id, project_id, environment, created_at DESC);
-- Der Weg eines spaeteren Aufraeumers: die noch nicht widerrufenen Paare nach
-- Ablauf.
CREATE INDEX project_storage_s3_access_keys_active_expiry_idx
  ON project_storage_s3_access_keys (expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE project_storage_s3_access_key_buckets (
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  key_id uuid NOT NULL,
  bucket_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, project_id, environment, key_id, bucket_id),
  FOREIGN KEY (organization_id, project_id, environment, key_id)
    REFERENCES project_storage_s3_access_keys (organization_id, project_id, environment, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, project_id, environment, bucket_id)
    REFERENCES project_storage_buckets (organization_id, project_id, environment, id)
    ON DELETE CASCADE
);

-- Der Weg der Liste: zu einem Paar alle seine Buckets.
CREATE INDEX project_storage_s3_access_key_buckets_key_idx
  ON project_storage_s3_access_key_buckets (organization_id, project_id, environment, key_id);

-- Ein Paar ist unveraenderlich, bis auf den einmaligen Widerruf. Derselbe
-- Waechter wie fuer die Projekt-Keys in 0023, und aus demselben Grund: Wer
-- Namen, Ablauf oder Hash nachtraeglich aendern koennte, koennte einen
-- widerrufenen Zugang wieder oeffnen, ohne dass die Liste es zeigt. Der
-- Widerruf selbst laeuft nur in eine Richtung.
CREATE OR REPLACE FUNCTION qkern_reject_project_storage_s3_access_key_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
     NEW.project_id IS DISTINCT FROM OLD.project_id OR
     NEW.environment IS DISTINCT FROM OLD.environment OR
     NEW.name IS DISTINCT FROM OLD.name OR
     NEW.access_key_id IS DISTINCT FROM OLD.access_key_id OR
     NEW.secret_hash IS DISTINCT FROM OLD.secret_hash OR
     NEW.expires_at IS DISTINCT FROM OLD.expires_at OR
     NEW.created_by IS DISTINCT FROM OLD.created_by OR
     NEW.created_at IS DISTINCT FROM OLD.created_at OR
     (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'project storage S3 access keys are immutable except for one-way revocation'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_storage_s3_access_keys_immutable
BEFORE UPDATE ON project_storage_s3_access_keys
FOR EACH ROW EXECUTE FUNCTION qkern_reject_project_storage_s3_access_key_mutation();

ALTER TABLE project_storage_s3_access_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_storage_s3_access_key_buckets ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_storage_s3_access_keys_select ON project_storage_s3_access_keys
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_storage_s3_access_keys_insert ON project_storage_s3_access_keys
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_storage_s3_access_keys_update ON project_storage_s3_access_keys
  FOR UPDATE
  USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

CREATE POLICY project_storage_s3_access_key_buckets_select ON project_storage_s3_access_key_buckets
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_storage_s3_access_key_buckets_insert ON project_storage_s3_access_key_buckets
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_storage_s3_access_key_buckets_delete ON project_storage_s3_access_key_buckets
  FOR DELETE USING (organization_id = qkern_current_organization_id());

REVOKE ALL ON project_storage_s3_access_keys FROM PUBLIC;
REVOKE ALL ON project_storage_s3_access_key_buckets FROM PUBLIC;
REVOKE ALL ON FUNCTION qkern_reject_project_storage_s3_access_key_mutation() FROM PUBLIC;

-- Kein DELETE auf der Schluesseltabelle, und das ist die Aussage: Widerruf ist
-- nicht loeschen. Wer widerruft, will die Spur behalten, also gibt es nur
-- UPDATE auf genau einer Spalte. Die Kopplungstabelle bekommt DELETE, damit
-- das Loeschen eines Buckets ueber den Fremdschluessel durchgreifen kann; die
-- Produktflaeche dieses Slices loescht dort nicht.
GRANT SELECT, INSERT ON project_storage_s3_access_keys TO qkern_runtime;
GRANT UPDATE (revoked_at) ON project_storage_s3_access_keys TO qkern_runtime;
GRANT SELECT, INSERT, DELETE ON project_storage_s3_access_key_buckets TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_reject_project_storage_s3_access_key_mutation() TO qkern_runtime;

COMMIT;
