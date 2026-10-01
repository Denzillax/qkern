BEGIN;

-- Eine Rechnungszeile bekommt eine Bezeichnung, und eine Rechnung mehr als
-- sechs Positionen.
--
-- Der Befund aus 2.62 lautete: „Add-ons fehlt keine Oberflaeche, sondern die
-- Form. Eine Rechnungszeile hat kein Feld fuer eine Bezeichnung, und die
-- Eindeutigkeit je Metrik begrenzt sie auf sechs. Eine Pauschale haette keine
-- Menge und damit keinen Weg zu einem Betrag." Diese Migration raeumt alle
-- drei Punkte weg, ohne die Zusage aufzugeben, die hinter der Eindeutigkeit
-- stand.
--
-- ## Warum ein stabiler Schluessel und nicht einfach keine Eindeutigkeit
--
-- `UNIQUE (invoice_id, metric)` aus 0040 hat zwei Dinge zugleich getan, und
-- nur eines davon war gewollt:
--
-- 1. Sie hat verhindert, dass eine Rechnung dieselbe Position zweimal nennt.
--    Das ist die Zusage, und sie bleibt.
-- 2. Sie hat die Position an eine der sechs Metriken gebunden und die
--    Rechnung damit auf sechs Zeilen begrenzt. Das war eine Folge, keine
--    Absicht.
--
-- Der Ersatz ist `UNIQUE (invoice_id, line_key)` mit einem Schluessel, der die
-- Position benennt statt ihre Metrik: `metric:<kennung>` fuer eine gemessene
-- Position, `charge:<code>` fuer eine Pauschale. Der Schluessel ist stabil,
-- weil er aus dem abgeleitet wird, was die Position ist, und nicht aus einer
-- Reihenfolge oder einer erzeugten Kennung: Derselbe Monat, dieselbe Quelle,
-- derselbe Schluessel. Ein Lauf kann deshalb nie zwei Zeilen fuer dieselbe
-- Sache schreiben, auch wenn das Preisblatt und die Pauschalen zusammen
-- einmal dieselbe Position ergeben wuerden.
--
-- Was dieser Schluessel ausdruecklich **nicht** traegt: die Idempotenz des
-- Rechnungslaufs ueber zwei Laeufe hinweg. Die traegt
-- `UNIQUE (organization_id, project_id, environment, period_start)` auf
-- `billing_invoices`, und sie ist unberuehrt. Ein zweiter Lauf desselben
-- Monats verliert dort im ON CONFLICT und schreibt keine einzige Zeile, weil
-- die Posten erst nach der gewonnenen Rechnung entstehen. Die beiden
-- Beschraenkungen sichern zwei verschiedene Fehler; sie ersetzen einander
-- nicht.
--
-- ## Eine Pauschale kommt zu ihrem Betrag mit einer Menge von 1
--
-- Es gibt keinen zweiten Positionstyp mit einem eingetragenen Betrag. Der
-- Betrag einer Zeile bleibt gerechnet: `menge * stueckpreis / bezugsgroesse`,
-- eine Formel fuer alle Positionen, nachrechenbar von jedem. Eine Pauschale
-- ist der entartete Fall dieser Formel: Menge 1, Bezugsgroesse 1,
-- Stueckpreis gleich dem Betrag. Ein eingetragener Betrag waere die einzige
-- Zahl auf der Rechnung, die niemand nachrechnen koennte, und genau das
-- sollte die Rechnung nie haben.
--
-- Ob eine Position gemessen oder pauschal ist, sagt `metric`: gesetzt bei
-- einer Metrik, NULL bei einer Pauschale. Eine eigene Typspalte waere eine
-- zweite Quelle fuer dieselbe Auskunft und irgendwann die, die nicht stimmt.
ALTER TABLE billing_invoice_lines
  ADD COLUMN line_key text,
  ADD COLUMN label text;

-- Bestehende Zeilen tragen den Schluessel ihrer Metrik und deren Namen. Die
-- Namen sind dieselben wie in `USAGE_METRIC_DEFINITIONS`; die Console zeigt
-- bei einer gemessenen Position weiterhin ihre uebersetzte Metrikbezeichnung,
-- diese Spalte ist das Protokoll der Rechnung selbst.
UPDATE billing_invoice_lines SET
  line_key = 'metric:' || metric,
  label = CASE metric
    WHEN 'api_requests' THEN 'API requests'
    WHEN 'database_row_reads' THEN 'Database row reads'
    WHEN 'storage_egress_bytes' THEN 'Storage egress'
    WHEN 'realtime_messages' THEN 'Realtime messages'
    WHEN 'queue_operations' THEN 'Queue operations'
    WHEN 'function_invocations' THEN 'Function invocations'
  END;

ALTER TABLE billing_invoice_lines
  ALTER COLUMN line_key SET NOT NULL,
  ALTER COLUMN label SET NOT NULL,
  ALTER COLUMN metric DROP NOT NULL;

ALTER TABLE billing_invoice_lines
  ADD CONSTRAINT billing_invoice_lines_line_key_shape
    CHECK (line_key ~ '^(metric:[a-z_]{1,60}|charge:[a-z0-9][a-z0-9-]{0,58})$'),
  ADD CONSTRAINT billing_invoice_lines_label_shape
    CHECK (char_length(label) BETWEEN 1 AND 200),
  -- Der Schluessel und die Metrik duerfen nicht verschiedene Dinge sagen: Eine
  -- gemessene Position hat eine Metrik und nennt sie im Schluessel, eine
  -- Pauschale hat keine.
  ADD CONSTRAINT billing_invoice_lines_position_shape
    CHECK (CASE WHEN metric IS NULL THEN line_key LIKE 'charge:%'
                ELSE line_key = 'metric:' || metric END);

-- Die Eindeutigkeit wandert von der Metrik auf den Schluessel. Erst danach
-- faellt die alte, damit es keinen Moment ohne Schutz gibt — innerhalb einer
-- Transaktion ohnehin, aber die Reihenfolge sagt, was gemeint ist.
ALTER TABLE billing_invoice_lines
  ADD CONSTRAINT billing_invoice_lines_invoice_id_line_key_key UNIQUE (invoice_id, line_key);
ALTER TABLE billing_invoice_lines
  DROP CONSTRAINT billing_invoice_lines_invoice_id_metric_key;

GRANT INSERT (line_key, label) ON billing_invoice_lines TO qkern_worker;

-- ## Pauschalen: ein zweites append-only Blatt, nicht ein breiteres erstes
--
-- Das Preisblatt aus 0039 bleibt unberuehrt, und zwar aus einem inhaltlichen
-- Grund: Es beantwortet „was kostet eine Einheit dieser Metrik". Eine
-- Pauschale beantwortet „was kostet dieses Projekt pro Monat, unabhaengig von
-- jeder Einheit". Das sind zwei Fragen, und eine Tabelle, die beide
-- beantwortet, braucht in jeder Zeile eine Haelfte leerer Spalten.
--
-- Die Regeln sind dieselben: append-only, keine UPDATE- und keine
-- DELETE-Policy, FORCE ROW LEVEL SECURITY. Wirksam ist je
-- (Projekt, Umgebung, Code) die juengste Zeile, deren `effective_from` nicht
-- in der Zukunft liegt.
--
-- Beendet wird eine Pauschale mit einem Betrag von null. Loeschen gibt es
-- nicht, und ein stiller Ablauf waere eine Frist, die niemand sieht. Null
-- schreibt keine Zeile, genauso wie eine Metrik ohne Menge keine schreibt.
CREATE TABLE billing_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  code text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{0,58}$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  amount_micros bigint NOT NULL CHECK (amount_micros BETWEEN 0 AND 1000000000000),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  effective_from date NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, project_id, environment, code, effective_from),
  -- Der eigene Weg, eine Pauschale einem Projekt zuzuordnen, den die
  -- Add-ons-Seite vermisst hat: dieselbe Fremdschluesselform wie bei der
  -- Rechnung selbst, damit eine Pauschale nie an einer Umgebung haengt, die
  -- es nicht gibt.
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE RESTRICT
);

CREATE INDEX billing_charges_effective_idx
  ON billing_charges (organization_id, project_id, environment, code, effective_from DESC);

ALTER TABLE billing_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_charges FORCE ROW LEVEL SECURITY;

CREATE POLICY billing_charges_tenant_select ON billing_charges
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY billing_charges_tenant_insert ON billing_charges
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());

REVOKE ALL ON billing_charges
  FROM PUBLIC, qkern_runtime, qkern_worker, qkern_provisioner, qkern_auth;

-- Volles SELECT fuer die Laufzeit wie beim Preisblatt: `INSERT … RETURNING`
-- verlangt Leserecht auf den zurueckgegebenen Spalten, und die Projektion
-- liest die wirksamen Pauschalen des laufenden Monats.
GRANT SELECT ON billing_charges TO qkern_runtime;
GRANT INSERT (organization_id, project_id, environment, code, label, amount_micros,
              currency, effective_from, created_by)
  ON billing_charges TO qkern_runtime;

-- Der Rechnungslauf liest sie mit der Worker-Rolle, nur lesend.
GRANT SELECT ON billing_charges TO qkern_worker;

COMMIT;
