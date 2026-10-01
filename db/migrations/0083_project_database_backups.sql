BEGIN;

-- Backup und Wiederherstellung einer Projektdatenbank (2.126).
--
-- ## Die offene Stelle
--
-- Seit `2.29.0` gibt es einen Backup-/Restore-Drill, und `STATUS.md` nennt ihn
-- mit einem Fall. Was er belegt, ist das Backup der **Steuerungsdatenbank**:
-- ein physisches Basisbackup des Clusters, verschluesselt, mit
-- Wiederherstellung bis zu einem Zeitpunkt aus dem WAL-Archiv. Die
-- **Projektdatenbank** eines Mandanten war darin nie enthalten, und genau sie
-- ist bei Supabase das, was ein Kunde kauft.
--
-- Diese Tabelle ist der Katalog dieser Backups. Sie ist absichtlich auch die
-- Queue (siehe `lib/server/backup/project-database.ts`, Abschnitt "Wer das
-- Backup fahrt"): ein Auftrag ist eine Zeile im Zustand `pending`, ein Wirt
-- nimmt ihn mit einer Lease, und derselbe Datensatz traegt danach das Ergebnis.
-- Eine zweite Tabelle daneben waere eine zweite Antwort auf dieselbe Frage.
--
-- ## Warum ein Basisbackup hier **nicht** reicht
--
-- Ein `pg_basebackup` zieht den **Cluster**, nicht eine Datenbank. In einem
-- Cluster, in dem mehrere Projektdatenbanken liegen, ist ein Basisbackup damit
-- ein Backup fremder Mandanten mit, und das Artefakt eines Mandanten traegt die
-- Zeilen eines anderen. Das waere ein Bruch der Mandantengrenze im Artefakt
-- selbst, und keine Verschluesselung repariert ihn: wer sein eigenes Backup
-- entschluesseln darf, darf es ganz entschluesseln.
--
-- Darum ist das Backup einer Projektdatenbank hier **logisch** (ein Dump genau
-- dieser Datenbank) und nicht physisch. Was das kostet, steht in
-- `lib/server/backup/project-database.ts` unter "Was ein Backup umfasst": es
-- gibt keinen Zeitpunkt zwischen zwei Dumps, also keine Wiederherstellung auf
-- eine Sekunde. Das bleibt die Zusage des Control-Plane-Weges aus 2.29 und
-- wird hier nicht behauptet.
--
-- ## Was hier **nicht** steht
--
-- Kein Passwort, kein Vault-Token, keine Verbindungszeile, kein Bucket-Name,
-- kein Endpunkt und kein Schluessel. Was an Schluesselmaterial in der Zeile
-- liegt, ist der **eingewickelte** Datenschluessel (`wrapped_data_key`): der
-- Datenschluessel dieses einen Backups, verschluesselt mit dem Mandanten-
-- Schluessel aus dem Vault. Ohne diesen Vault-Schluessel ist die Spalte
-- nutzlos; mit ihm kann der Betreiber lesen, und genau das steht als Aussage
-- ueber das Produkt im Backup-Dokument.
CREATE TABLE project_database_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  -- Derselbe Verweis, den der Verbindungskatalog aufloest, und mit denselben
  -- Pruefungen wie in 0020. Eine URL oder ein Zugangsdatum kommt hier nicht
  -- durch, und das ist eine fehlende Form, keine Absicht im Code.
  database_instance_ref text NOT NULL
    CHECK (char_length(database_instance_ref) BETWEEN 9 AND 128)
    CHECK (database_instance_ref ~ '^managed:[a-z0-9][a-z0-9._:-]{0,119}$')
    CHECK (database_instance_ref !~ '://|@'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'available', 'failed', 'expired')),
  -- Der Schluessel im Objektspeicher. Er faengt mit der Organisation an, und
  -- der Dienst leitet ihn aus der Zeile ab, nie aus einer Anfrage; die Form
  -- steht hier, damit eine von Hand geschriebene Zeile sie nicht umgehen kann.
  object_key text
    CHECK (object_key ~ '^project-database-backups/[0-9a-f-]{36}/[0-9a-f-]{36}/(development|staging|production)/[0-9a-f-]{36}\.qkbak$'),
  artifact_sha256 text CHECK (artifact_sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint CHECK (size_bytes BETWEEN 1 AND 1099511627776),
  -- Der Datenschluessel dieses Backups, eingewickelt. Base64, begrenzt.
  --
  -- Die Obergrenze ist 255 und nicht 512, und das ist keine Schaetzung: Die
  -- Regex-Engine von PostgreSQL laesst in einer Wiederholung hoechstens 255 zu
  -- (`DUPMAX`). `{32,512}` ist eine **ungueltige** Regex, und sie faellt nicht
  -- beim Anlegen der Tabelle auf, sondern erst beim ersten Schreiben, mit
  -- SQLSTATE 2201B. Der erste Lauf des Falls (2.126) hat genau das vorgefuehrt:
  -- Dump, Manifest, Verschluesselung und Upload liefen durch, und die Zeile kam
  -- nicht zustande. Das Paeckchen ist ohnehin 80 Zeichen lang (12 Byte IV, 16
  -- Byte Tag, 32 Byte Schluessel), 255 ist also reichlich.
  wrapped_data_key text CHECK (wrapped_data_key ~ '^[A-Za-z0-9+/]{32,255}={0,2}$'),
  -- Welcher Mandanten-Schluessel ihn eingewickelt hat. Ein Name, kein Material.
  key_id text CHECK (key_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  -- Geordnete Zeilen und Schemaobjekte, gehasht: gleich nur, wenn alles gleich
  -- ist. Dieselbe Rolle wie `sourceDataManifestSha256` im Drill aus 2.29.
  manifest_sha256 text CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  -- Was das Artefakt umfasst. Eine Liste und keine Sammlung von Booleans:
  -- was fehlt, fehlt sichtbar, und `lib/server/backup/project-database.ts`
  -- begruendet jedes Stueck einzeln.
  includes text[] NOT NULL DEFAULT '{}'
    CHECK (includes <@ ARRAY['schema', 'rows', 'policies', 'extensions', 'sequences', 'grants']::text[]),
  snapshot_at timestamptz,
  completed_at timestamptz,
  -- Die Aufbewahrung. Der Aufraeumer schneidet hier und nirgends sonst.
  expires_at timestamptz,
  -- Die Lease des Wirts. Dieselbe Form wie in 0020: Kennung, Token, Ablauf.
  claimed_by text CHECK (claimed_by ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 20),
  -- Nur feste Codes, nie eine Meldung (0045, 0081). Eine Datenbankmeldung aus
  -- einer Projektdatenbank traegt Tabellennamen eines Mandanten.
  last_error_code text CHECK (last_error_code IN (
    'DUMP_FAILED', 'OBJECT_STORE_UNAVAILABLE', 'KEY_UNAVAILABLE',
    'CONNECTION_UNAVAILABLE', 'ARTIFACT_TOO_LARGE', 'LEASE_EXPIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_database_backups_scope_key UNIQUE (organization_id, id),
  CONSTRAINT project_database_backups_binding_fk
    FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_database_bindings (organization_id, project_id, environment)
    ON DELETE RESTRICT,
  -- Ein Backup, das da ist, hat alles, was es zum Lesen braucht. Fehlt ein
  -- Stueck, ist es kein `available`, sondern ein `failed`. Der Riegel steht
  -- hier und nicht nur im Dienst: ein halbes Backup, das als vorhanden gilt,
  -- ist schlimmer als keines.
  CONSTRAINT project_database_backups_available_shape CHECK (
    status <> 'available' OR (
      object_key IS NOT NULL AND artifact_sha256 IS NOT NULL AND size_bytes IS NOT NULL AND
      wrapped_data_key IS NOT NULL AND key_id IS NOT NULL AND manifest_sha256 IS NOT NULL AND
      snapshot_at IS NOT NULL AND completed_at IS NOT NULL AND expires_at IS NOT NULL AND
      'schema' = ANY (includes) AND 'rows' = ANY (includes))),
  -- Eine Lease ist dreiteilig oder gar nicht da.
  CONSTRAINT project_database_backups_lease_shape CHECK (
    (claimed_by IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL) OR
    (claimed_by IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CONSTRAINT project_database_backups_running_shape CHECK (
    status <> 'running' OR lease_token IS NOT NULL),
  CONSTRAINT project_database_backups_retention_shape CHECK (
    expires_at IS NULL OR completed_at IS NULL OR expires_at > completed_at),
  -- Ein Fehlschlag nennt seinen Grund, ein Erfolg nennt keinen.
  CONSTRAINT project_database_backups_failure_shape CHECK (
    (status = 'failed' AND last_error_code IS NOT NULL) OR status <> 'failed')
);

-- Der Wirt sucht den naechsten faelligen Auftrag. Ohne diesen Index waere jede
-- Runde ein Seq Scan ueber alle Backups aller Mandanten (die Lehre aus 0063).
CREATE INDEX project_database_backups_claim_idx
  ON project_database_backups (organization_id, created_at, id)
  WHERE status IN ('pending', 'running');
-- Der Aufraeumer sucht, was abgelaufen ist, haeppchenweise.
CREATE INDEX project_database_backups_expiry_idx
  ON project_database_backups (organization_id, expires_at)
  WHERE status = 'available';
-- Die Console listet je Umgebung, neueste zuerst.
CREATE INDEX project_database_backups_listing_idx
  ON project_database_backups (organization_id, project_id, environment, created_at DESC);

CREATE TRIGGER project_database_backups_touch_updated_at
BEFORE UPDATE ON project_database_backups
FOR EACH ROW EXECUTE FUNCTION qkern_touch_updated_at();

ALTER TABLE project_database_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_database_backups FORCE ROW LEVEL SECURITY;

-- Die Mandantengrenze, und zwar ohne Filter in der Anfrage. `SELECT * FROM
-- project_database_backups` gibt genau die Backups der Organisation zurueck,
-- die in `qkern.organization_id` steht; ein Dienst, der den Filter vergisst,
-- bekommt trotzdem nichts Fremdes. `FORCE` gilt auch fuer den Eigentuemer der
-- Tabelle.
CREATE POLICY project_database_backups_tenant ON project_database_backups
  USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

REVOKE ALL ON project_database_backups FROM PUBLIC, qkern_auth, qkern_worker;

-- Wer das Backup fahrt, steht in `lib/server/backup/project-database.ts`
-- begruendet: der vorhandene Provisioner-Prozess. Er ist der einzige Prozess,
-- der schon einen privilegierten, Vault-gestuetzten Weg zu einer
-- Projektdatenbank hat und der eine Datenbank anlegen darf -- und das Ziel
-- einer Wiederherstellung ist eine neue Datenbank. Darum traegt seine Rolle
-- hier die Schreibrechte und keine zweite.
GRANT SELECT, INSERT, UPDATE, DELETE ON project_database_backups TO qkern_provisioner;
-- Die Console liest und stellt einen Auftrag ein; sie fasst kein Ergebnis an.
-- `UPDATE` fehlt hier bewusst: ein Weg, der einen Zustand von Hand auf
-- `available` setzen kann, waere ein Weg, ein Backup zu behaupten.
GRANT SELECT, INSERT ON project_database_backups TO qkern_runtime;

COMMIT;
