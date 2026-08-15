BEGIN;

-- Der Rechnungsnummernkreis — der letzte offene Billing-Punkt aus 1.68.
--
-- Lueckenlos je Organisation, monoton, vergeben in derselben Transaktion wie
-- die Rechnung selbst. Die Rechnungen bleiben append-only: Die Nummer steht
-- im INSERT, nie in einem UPDATE. Wer den ON-CONFLICT-Wettlauf verliert,
-- rollt seinen Zaehlerstand per SAVEPOINT zurueck — eine vergebene Nummer
-- ohne Rechnung ist damit nicht ausdrueckbar.
CREATE TABLE billing_invoice_counters (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
  next_number bigint NOT NULL CHECK (next_number >= 1)
);

ALTER TABLE billing_invoice_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_invoice_counters FORCE ROW LEVEL SECURITY;

CREATE POLICY billing_invoice_counters_tenant_select ON billing_invoice_counters
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY billing_invoice_counters_tenant_insert ON billing_invoice_counters
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY billing_invoice_counters_tenant_update ON billing_invoice_counters
  FOR UPDATE USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

ALTER TABLE billing_invoices
  ADD COLUMN invoice_number bigint CHECK (invoice_number >= 1);
-- Die Faelligkeit ist eine feste Regel: 30 Tage nach Ausstellung. Eine
-- generierte Spalte scheitert daran, dass timestamptz + interval nicht
-- immutable ist; stattdessen traegt der DEFAULT die Regel — now() ist die
-- Transaktionszeit und damit exakt derselbe Anker wie der DEFAULT von
-- issued_at. Schreibbar ist die Spalte fuer niemanden: kein Spalten-Grant,
-- keine UPDATE-Policy.
ALTER TABLE billing_invoices
  ADD COLUMN due_at timestamptz;
UPDATE billing_invoices SET due_at = issued_at + interval '30 days';
ALTER TABLE billing_invoices ALTER COLUMN due_at SET DEFAULT (now() + interval '30 days');
ALTER TABLE billing_invoices ALTER COLUMN due_at SET NOT NULL;

-- Bestehende Rechnungen bekommen ihre Nummern in Ausstellungsreihenfolge;
-- der Zaehler beginnt dahinter.
WITH numbered AS (
  SELECT id, row_number() OVER (
    PARTITION BY organization_id ORDER BY issued_at ASC, id ASC) AS assigned
  FROM billing_invoices)
UPDATE billing_invoices SET invoice_number = numbered.assigned
FROM numbered WHERE billing_invoices.id = numbered.id;

INSERT INTO billing_invoice_counters (organization_id, next_number)
SELECT organization_id, max(invoice_number) FROM billing_invoices GROUP BY organization_id;

ALTER TABLE billing_invoices ALTER COLUMN invoice_number SET NOT NULL;
CREATE UNIQUE INDEX billing_invoices_org_number_key
  ON billing_invoices (organization_id, invoice_number);

-- Der Worker vergibt Nummern; die Laufzeit liest sie ueber den bestehenden
-- Tabellen-SELECT aus 0040 mit.
GRANT SELECT, INSERT ON billing_invoice_counters TO qkern_worker;
GRANT UPDATE (next_number) ON billing_invoice_counters TO qkern_worker;
GRANT INSERT (invoice_number) ON billing_invoices TO qkern_worker;

COMMIT;
