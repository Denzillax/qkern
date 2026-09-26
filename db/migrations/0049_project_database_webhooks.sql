-- Datenbank-Webhooks (2.50): die Kopplung zwischen einer Tabelle des Projekts
-- und einem ausgehenden Webhook.
--
-- ## Warum eine Kopplungstabelle und keine zweite Definitionstabelle
--
-- Der ausgehende Weg steht vollstaendig: 0032 haelt die Definition mit Ziel,
-- Geheimnisreferenz, Zeitbudget und Versuchsgrenze, dazu die Outbox mit Lease,
-- Backoff und Dead Letter. Signiert wird ueber den Vault, zugestellt vom
-- Zustellprozess, und der Zustellstatus hat bereits eine Route.
--
-- Ein Datenbank-Webhook ist kein zweiter Zustellweg. Er ist ein vorhandener
-- Webhook plus die Aussage, welche Tabelle und welche Operationen ihn
-- ausloesen. Diese Tabelle haelt genau diese Aussage; alles andere bleibt, wo
-- es ist. Der An- und Ausschalter ist darum `project_webhooks.enabled`, und
-- die Zustellliste ist dieselbe wie fuer jeden anderen Webhook.
--
-- ## Warum kein Zeilenwert hier vorkommt
--
-- Die Nutzlast entsteht nicht hier, sondern aus `qkern_internal.change_feed`
-- der Projektdatenbank, und der haelt ausschliesslich Primaerschluesselwerte.
-- Diese Tabelle kennt den Namen einer Tabelle und drei Operationen. Sie kann
-- keinen Spaltenwert speichern, weil sie keine Spalte dafuer hat.

CREATE TABLE project_database_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  webhook_id uuid NOT NULL,
  -- Wie die uebrigen Katalogflaechen arbeitet diese auf `public`. Der CHECK ist
  -- keine Meinung, sondern die Grenze, die der Dienst ebenfalls zieht.
  schema_name text NOT NULL DEFAULT 'public' CHECK (schema_name = 'public'),
  -- Dieselbe Grammatik wie `lib/server/data-plane/identifiers`: Buchstabe oder
  -- Unterstrich am Anfang, danach Buchstaben, Ziffern, Unterstriche, hoechstens
  -- 63 Zeichen. Kein Anfuehrungszeichen, kein Semikolon, kein Kommentarzeichen.
  table_name text NOT NULL CHECK (table_name ~ '^[A-Za-z_][A-Za-z0-9_]{0,62}$'),
  -- Die feste Liste, hier ein zweites Mal, und zwar ausgeschrieben. Ein CHECK
  -- darf keine Unterabfrage enthalten; "jedes Element erlaubt, keines doppelt"
  -- laesst sich damit nicht ausdruecken. Bei drei Operationen gibt es sieben
  -- Moeglichkeiten, und sie hinzuschreiben prueft zugleich die Reihenfolge, in
  -- der der Dienst schreibt. Ein direkter INSERT mit ['delete','insert'] faellt
  -- also ebenso wie einer mit ['insert','insert'].
  events text[] NOT NULL CHECK (events IN (
    ARRAY['insert'], ARRAY['update'], ARRAY['delete'],
    ARRAY['insert', 'update'], ARRAY['insert', 'delete'], ARRAY['update', 'delete'],
    ARRAY['insert', 'update', 'delete']
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id, environment, webhook_id)
    REFERENCES project_webhooks (organization_id, project_id, environment, id)
    ON DELETE CASCADE,
  -- Ein Webhook traegt hoechstens eine Kopplung. Zwei waeren zwei Definitionen
  -- mit einem Namen und einem Ziel, und die Liste koennte nicht sagen, welche
  -- eine Zustellung ausgeloest hat.
  CONSTRAINT project_database_webhooks_webhook_key
    UNIQUE (organization_id, project_id, environment, webhook_id)
);

-- Der Weg der Bruecke: alle aktiven Kopplungen einer Umgebung, um jede
-- gelesene Aenderung dagegen zu halten.
CREATE INDEX project_database_webhooks_scope_idx
  ON project_database_webhooks (organization_id, project_id, environment, table_name);

-- Die Kopplung ist unveraenderlich, genau wie die Definition in 0031 und 0032.
-- Wer Tabelle oder Ereignisse aendern will, legt neu an: Sonst koennte eine
-- wartende Zustellung gegen eine Kopplung laufen, die zum Zeitpunkt des
-- Ausloesens eine andere war. Ausgedrueckt ist das ueber die Spaltenrechte --
-- die Laufzeitrolle bekommt auf dieser Tabelle kein UPDATE.
ALTER TABLE project_database_webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_database_webhooks_select ON project_database_webhooks
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_database_webhooks_insert ON project_database_webhooks
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_database_webhooks_delete ON project_database_webhooks
  FOR DELETE USING (organization_id = qkern_current_organization_id());

REVOKE ALL ON project_database_webhooks FROM PUBLIC;

-- DELETE nur, damit das Loeschen eines Webhooks ueber den Fremdschluessel
-- durchgreift. Die Produktflaeche dieses Slices loescht nicht.
GRANT SELECT, INSERT, DELETE ON project_database_webhooks TO qkern_runtime;
