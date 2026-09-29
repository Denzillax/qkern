BEGIN;

-- S3-Endpunkt (2.96): Das Geheimnis eines Schluesselpaars liegt verschluesselt
-- in der Zeile, und eine Funktion holt ein gueltiges Paar ueber den
-- oeffentlichen Teil, ohne die Organisation zu kennen.
--
-- ## Warum 0059 hier weitergebaut wird
--
-- 0059 hat begruendet, warum es keinen Pruefweg gab: Eine SigV4-Signatur ist
-- eine HMAC-Kette aus dem Geheimnis, gespeichert war nur ein SHA-256-Hash,
-- und aus einem Hash kommt kein HMAC. "Wer spaeter einen Pruefweg baut, muss
-- zuerst entscheiden, wo das Geheimnis liegen soll." Die Entscheidung: hier,
-- als AES-256-GCM-Chiffrat, gebunden an `access_key_id` als AAD. Der
-- Schluessel dazu steht in der Umgebung der Anwendung
-- (`QKERN_PROJECT_STORAGE_S3_KEY_ENCRYPTION_KEY`) und nie in der Datenbank:
-- Wer nur die Tabelle liest, liest Chiffrate.
--
-- Die Spalte ist NULL-faehig, weil alle Paare aus 2.59 bis 2.65 kein Chiffrat
-- haben und keines bekommen koennen; das Geheimnis war genau einmal sichtbar
-- und ist weg. Diese Paare bleiben in der Liste, oeffnen nichts, und die
-- Console sagt es je Paar. Wer den Endpunkt nutzen will, legt ein neues an.
--
-- `secret_hash` bleibt: Er ist die eindeutige Kennung des Geheimnisses und
-- die zweite Pruefung nach dem Entschluesseln.
--
-- ## Der Weg des Endpunkts an der RLS vorbei
--
-- Eine S3-Anfrage traegt den oeffentlichen Teil und eine Signatur, aber keine
-- Organisation. `withTenant` verlangt eine. Dieselbe Lage wie bei den
-- Projekt-API-Keys in 0023, und derselbe Schnitt: eine SECURITY-DEFINER-
-- Funktion, die genau eine Zeile ueber den oeffentlichen Teil holt, und nur,
-- wenn sie weder widerrufen noch abgelaufen ist. Sie gibt den Bucket-Satz als
-- Array mit, damit der Endpunkt mit einer Abfrage weiss, worauf das Paar
-- zeigen darf. Ausfuehren darf sie die Laufzeitrolle, denn der Endpunkt laeuft
-- in der Anwendung; sonst niemand.

ALTER TABLE project_storage_s3_access_keys
  ADD COLUMN secret_ciphertext text COLLATE "C"
    CHECK (secret_ciphertext IS NULL OR
           secret_ciphertext ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9_-]{22}$');

-- Der Waechter aus 0059 kennt die neue Spalte: Ein Chiffrat, das sich nach
-- dem Anlegen aendern liesse, waere ein Weg, ein Paar auf ein anderes
-- Geheimnis umzuschreiben.
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
     NEW.secret_ciphertext IS DISTINCT FROM OLD.secret_ciphertext OR
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

CREATE OR REPLACE FUNCTION qkern_authenticate_project_storage_s3_access_key(p_access_key_id text)
RETURNS TABLE (
  key_id uuid,
  organization_id uuid,
  project_id uuid,
  environment qkern_environment,
  name text,
  access_key_id text,
  secret_hash text,
  secret_ciphertext text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz,
  bucket_ids uuid[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT access_key.id, access_key.organization_id, access_key.project_id,
         access_key.environment, access_key.name, access_key.access_key_id,
         access_key.secret_hash, access_key.secret_ciphertext,
         access_key.expires_at, access_key.revoked_at, access_key.created_by, access_key.created_at,
         coalesce((SELECT array_agg(coupling.bucket_id ORDER BY coupling.bucket_id)
                     FROM public.project_storage_s3_access_key_buckets AS coupling
                    WHERE coupling.organization_id = access_key.organization_id
                      AND coupling.project_id = access_key.project_id
                      AND coupling.environment = access_key.environment
                      AND coupling.key_id = access_key.id), '{}'::uuid[])
  FROM public.project_storage_s3_access_keys AS access_key
  WHERE access_key.access_key_id = p_access_key_id
    AND access_key.revoked_at IS NULL
    AND access_key.expires_at > now()
    AND access_key.secret_ciphertext IS NOT NULL
    AND p_access_key_id ~ '^QKERNS3[A-Z2-7]{16}$'
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION qkern_authenticate_project_storage_s3_access_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qkern_authenticate_project_storage_s3_access_key(text) TO qkern_runtime;

-- Die Rechte aus 0059 bleiben: SELECT und INSERT auf der Tabelle, UPDATE nur
-- auf revoked_at. Die neue Spalte ist damit fuer die Laufzeitrolle
-- schreibbar beim Anlegen und danach nie wieder.

COMMIT;
