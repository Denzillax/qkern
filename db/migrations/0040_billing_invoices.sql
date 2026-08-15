BEGIN;

-- Rechnungen ueber abgeschlossene Monatsfenster — Sprosse 2 der
-- Paritaetsleiter (docs/PARITAET.md).
--
-- Eine Rechnung unterscheidet sich von der Projektion aus 1.67 in genau einem
-- Punkt: Sie friert ein. Das Fenster ist abgeschlossen, die Zeile ist
-- append-only, und je (Organisation, Projekt, Umgebung, Periode) gibt es
-- hoechstens eine. Die eindeutige Beschraenkung ist die Idempotenz des
-- Rechnungslaufs: Ein zweiter Lauf findet den Konflikt und schreibt nichts.
CREATE TABLE billing_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  period_start date NOT NULL CHECK (period_start = (date_trunc('month', period_start))::date),
  period_end date NOT NULL CHECK (period_end = (period_start + interval '1 month')::date),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  total_micros bigint NOT NULL CHECK (total_micros >= 0),
  -- Metriken mit Nutzung, aber ohne Preis zum Stichtag. Sie werden genannt
  -- statt verschwiegen: Eine Rechnung, die stillschweigend Posten auslaesst,
  -- ist die gefaehrlichere Variante.
  unpriced_metrics text[] NOT NULL DEFAULT '{}',
  issued_by text NOT NULL CHECK (char_length(issued_by) BETWEEN 1 AND 200),
  issued_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, project_id, environment, period_start),
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE RESTRICT
);

CREATE TABLE billing_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES billing_invoices(id) ON DELETE RESTRICT,
  metric text NOT NULL CHECK (metric IN (
    'api_requests','database_row_reads','storage_egress_bytes','realtime_messages',
    'queue_operations','function_invocations'
  )),
  quantity bigint NOT NULL CHECK (quantity >= 0),
  unit_price_micros bigint NOT NULL CHECK (unit_price_micros BETWEEN 1 AND 1000000000000),
  per_units bigint NOT NULL CHECK (per_units BETWEEN 1 AND 1000000000000),
  amount_micros bigint NOT NULL CHECK (amount_micros >= 0),
  UNIQUE (invoice_id, metric)
);

ALTER TABLE billing_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE billing_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_invoice_lines FORCE ROW LEVEL SECURITY;

-- Wie beim Preisblatt: keine UPDATE- und keine DELETE-Policy. Was einmal
-- fakturiert ist, schreibt auch der Eigentuemer nicht mehr um.
CREATE POLICY billing_invoices_tenant_select ON billing_invoices
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY billing_invoices_tenant_insert ON billing_invoices
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY billing_invoice_lines_tenant_select ON billing_invoice_lines
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY billing_invoice_lines_tenant_insert ON billing_invoice_lines
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());

REVOKE ALL ON billing_invoices, billing_invoice_lines
  FROM PUBLIC, qkern_runtime, qkern_worker, qkern_provisioner, qkern_auth;

-- Der Rechnungslauf ist ein Hintergrundprozess und laeuft als qkern_worker.
-- SELECT ist zweifach noetig: fuer den benannten ON-CONFLICT-Arbiter und fuer
-- RETURNING — die Lektion aus den Migrationen 0036 bis 0038, geprueft vom
-- Rechteklausel-Vertrag.
GRANT SELECT ON billing_invoices, billing_invoice_lines TO qkern_worker;
GRANT INSERT (organization_id, project_id, environment, period_start, period_end,
              currency, total_micros, unpriced_metrics, issued_by)
  ON billing_invoices TO qkern_worker;
GRANT INSERT (organization_id, invoice_id, metric, quantity, unit_price_micros,
              per_units, amount_micros)
  ON billing_invoice_lines TO qkern_worker;

-- Was der Lauf liest: Umgebungen, Zaehler, Preise. Alles nur lesend, alles
-- weiter durch die Zeilenpolitik der jeweiligen Tabelle begrenzt.
GRANT SELECT ON project_environments, usage_counters, billing_rate_cards TO qkern_worker;

-- Die Console und REST lesen Rechnungen spaeter ueber die Laufzeitrolle; die
-- Flaeche dafuer ist nicht Teil dieses Slices, das Leserecht schon — sonst
-- waere die naechste Grenze wieder ein GRANT, den niemand gezogen hat.
GRANT SELECT ON billing_invoices, billing_invoice_lines TO qkern_runtime;

COMMIT;
