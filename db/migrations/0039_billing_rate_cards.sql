BEGIN;

-- Preise fuer die sechs Nutzungsmetriken — die erste Sprosse der
-- Paritaetsleiter (docs/PARITAET.md).
--
-- Ein Preis ist ein Bruch, kein Skalar: `unit_price_micros` Mikro-Einheiten
-- der Waehrung je `per_units` Einheiten der Metrik. Ohne den Nenner liesse
-- sich ein Byte-Preis nicht ausdruecken — CHF 0.09 je Gigabyte sind 90000
-- Mikro-Franken je 1e9 Bytes, und je Byte waere das keine ganze Zahl mehr.
--
-- Die Tabelle ist append-only wie das Audit-Log, und aus demselben Grund:
-- Ein Preis, der rueckwirkend umgeschrieben werden kann, taugt nicht als
-- Grundlage einer Abrechnung. Ein neuer Preis ist eine neue Zeile mit
-- spaeterem `effective_from`; wirksam ist je Metrik die juengste Zeile, deren
-- `effective_from` nicht in der Zukunft liegt.
CREATE TABLE billing_rate_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  metric text NOT NULL CHECK (metric IN (
    'api_requests','database_row_reads','storage_egress_bytes','realtime_messages',
    'queue_operations','function_invocations'
  )),
  unit_price_micros bigint NOT NULL CHECK (unit_price_micros BETWEEN 1 AND 1000000000000),
  per_units bigint NOT NULL DEFAULT 1 CHECK (per_units BETWEEN 1 AND 1000000000000),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  effective_from date NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, metric, effective_from)
);

CREATE INDEX billing_rate_cards_effective_idx
  ON billing_rate_cards (organization_id, metric, effective_from DESC);

ALTER TABLE billing_rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_rate_cards FORCE ROW LEVEL SECURITY;

-- Lesen und Anfuegen innerhalb der Organisation. Es gibt absichtlich keine
-- UPDATE- und keine DELETE-Policy: FORCE ROW LEVEL SECURITY laesst damit auch
-- den Eigentuemer nicht mehr umschreiben, was einmal galt.
CREATE POLICY billing_rate_cards_tenant_select ON billing_rate_cards
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY billing_rate_cards_tenant_insert ON billing_rate_cards
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());

REVOKE ALL ON billing_rate_cards
  FROM PUBLIC, qkern_runtime, qkern_worker, qkern_provisioner, qkern_auth;

-- Volles SELECT fuer die Laufzeit: `INSERT … RETURNING` verlangt Leserecht auf
-- den zurueckgegebenen Spalten — die Lehre aus den Migrationen 0036 bis 0038,
-- geprueft vom Rechteklausel-Vertrag. Preise sind innerhalb der Organisation
-- nicht geheim.
GRANT SELECT ON billing_rate_cards TO qkern_runtime;
GRANT INSERT (organization_id, metric, unit_price_micros, per_units, currency, effective_from, created_by)
  ON billing_rate_cards TO qkern_runtime;

COMMIT;
