-- Run once after 0002_qkern_migration_fence.sql as the trusted project database
-- provisioner. Provides trigger-based change capture for Realtime.
--
-- ## Warum Trigger und nicht logische Replikation
--
-- Logische Replikation sieht jede Aenderung ohne Schemaeingriff, verlangt aber
-- eine Rolle mit Replikationsrecht und einen Slot. Beides steht im direkten
-- Widerspruch zu diesem Schema: 0001 prueft fuer jede beteiligte Rolle
-- ausdruecklich rolreplication = false. Ein hängender Konsument laesst den Slot
-- ausserdem unbegrenzt WAL halten, bis die Platte voll ist -- ein
-- Betriebsrisiko, das der Kunde traegt und QKERN nicht begrenzen kann.
--
-- Trigger sind begrenzbar: der Feed hat Groessengrenzen und Aufbewahrung, und
-- das Anschalten je Tabelle ist eine Schemaaenderung, die den vorhandenen
-- Change-Set- und Approval-Weg durchlaeuft.
--
-- ## Warum keine Zeilenwerte gespeichert werden
--
-- Der Feed haelt ausschliesslich die Primaerschluesselwerte. Die eigentlichen
-- Zeilenwerte werden je Abonnent frisch gelesen, und zwar mit dessen Claims.
-- Row Level Security autorisiert und erzeugt die Nutzlast damit in einem
-- Schritt. Wuerden die Werte hier liegen, muesste eine zweite, unabhaengige
-- Sichtbarkeitspruefung sie korrekt filtern -- eine Kopie der RLS-Logik
-- ausserhalb der Datenbank und damit eine dauerhafte Fehlerquelle.

BEGIN;

CREATE TABLE qkern_internal.change_feed (
  position bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schema_name text NOT NULL CHECK (schema_name ~ '^[a-z_][a-z0-9_]{0,62}$'),
  table_name text NOT NULL CHECK (table_name ~ '^[a-z_][a-z0-9_]{0,62}$'),
  operation text NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
  -- Nur Primaerschluesselwerte. Die Grenze verhindert, dass ein zusammengesetzter
  -- Schluessel den Feed aufblaeht.
  row_key jsonb NOT NULL CHECK (octet_length(row_key::text) <= 4096),
  committed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX change_feed_retention_idx ON qkern_internal.change_feed (committed_at);

ALTER TABLE qkern_internal.change_feed OWNER TO qkern_ledger_owner;

-- SECURITY DEFINER: Der Schreiber einer Zeile besitzt keine Rechte auf dem
-- Feed und soll sie auch nicht bekommen. Der Trigger schreibt stellvertretend.
-- search_path wird fest gesetzt, damit kein Aufrufer die aufgeloesten Objekte
-- umlenken kann.
CREATE OR REPLACE FUNCTION qkern_internal.capture_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = qkern_internal, pg_catalog
AS $$
DECLARE
  key_columns text[];
  source record;
  key jsonb;
BEGIN
  SELECT array_agg(attribute.attname ORDER BY attribute.attnum)
    INTO key_columns
    FROM pg_index index
    JOIN pg_attribute attribute
      ON attribute.attrelid = index.indrelid AND attribute.attnum = ANY (index.indkey)
   WHERE index.indrelid = TG_RELID AND index.indisprimary;

  IF key_columns IS NULL THEN
    RAISE EXCEPTION 'change capture requires a primary key on %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;

  source := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT jsonb_object_agg(entry.key, entry.value)
    INTO key
    FROM jsonb_each(to_jsonb(source)) AS entry
   WHERE entry.key = ANY (key_columns);

  INSERT INTO qkern_internal.change_feed (schema_name, table_name, operation, row_key)
  VALUES (TG_TABLE_SCHEMA, TG_TABLE_NAME, lower(TG_OP), key);

  RETURN NULL;
END;
$$;

ALTER FUNCTION qkern_internal.capture_change() OWNER TO qkern_ledger_owner;

REVOKE ALL ON qkern_internal.change_feed FROM PUBLIC;
REVOKE ALL ON FUNCTION qkern_internal.capture_change() FROM PUBLIC;

-- Die Laufzeitrolle liest den Feed und raeumt ihn auf. Sie darf ihn niemals
-- schreiben: ein erfundenes Aenderungsereignis wuerde einen Lesevorgang mit
-- fremden Claims ausloesen.
GRANT USAGE ON SCHEMA qkern_internal TO qkern_project_api_app;
GRANT SELECT, DELETE ON qkern_internal.change_feed TO qkern_project_api_app;

COMMIT;
