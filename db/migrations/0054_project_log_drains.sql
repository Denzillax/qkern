BEGIN;

-- Log-Drains (2.54): die Kopplung zwischen den Logs, die die Console zeigt,
-- und einem ausgehenden Ziel.
--
-- ## Warum eine Kopplungstabelle und keine zweite Definitionstabelle
--
-- Dieselbe Begruendung wie 0049 fuer die Datenbank-Webhooks: Der ausgehende Weg
-- steht vollstaendig. 0032 haelt Ziel, Geheimnisreferenz, Zeitbudget und
-- Versuchsgrenze, dazu die Outbox mit Lease, serverberechnetem Backoff und
-- Dead Letter. Signiert wird ueber den Vault, zugestellt vom Zustellprozess,
-- und der Zustellstatus hat bereits eine Route.
--
-- Ein Log-Drain ist kein zweiter Zustellweg. Er ist ein vorhandener Webhook
-- plus die Aussage, welche Logs ihn beliefern. Diese Tabelle haelt genau diese
-- Aussage; alles andere bleibt, wo es ist. Der An- und Ausschalter ist darum
-- `project_webhooks.enabled`, und die Zustellliste ist dieselbe wie fuer jeden
-- anderen Webhook.
--
-- ## Warum hier kein Feld und keine Filterregel steht
--
-- Was ein Drain traegt, entscheidet nicht der Betreiber, sondern die Projektion
-- der Console-Ansicht zu derselben Quelle. Sie steht in
-- `lib/console/log-drains` und haengt am Vertrag `log-drain-field-boundary`.
-- Gaebe es hier eine Spalte fuer eine Feldauswahl oder einen Filter, waere die
-- Grenze verhandelbar -- und ein Betreiber, der versehentlich ein Feld mehr
-- auswaehlt, haette ein Datenleck bestellt. Diese Tabelle kann keine Felder
-- speichern, weil sie keine Spalte dafuer hat.

-- Die feste Quellenliste, geprueft in der Datenbank.
--
-- 0049 hat die drei Operationen eines Datenbank-Webhooks als sieben erlaubte
-- Arrays ausgeschrieben, weil ein CHECK keine Unterabfrage enthalten darf und
-- "jedes Element erlaubt, keines doppelt, in dieser Reihenfolge" sich anders
-- nicht ausdruecken laesst. Bei fuenf Quellen waeren das 31 Zeilen. Statt
-- dessen prueft eine IMMUTABLE Funktion dasselbe in einem Ausdruck: Die
-- Unterabfrage steht in der Funktion, wo sie erlaubt ist.
--
-- Die Reihenfolge wird mitgeprueft, nicht nur die Menge. Zwei gleichbedeutende
-- Definitionen sollen gleich aussehen, sonst koennte eine Liste zweimal
-- dasselbe zeigen und verschieden aussehen. Der Dienst schreibt in genau
-- dieser Reihenfolge.
CREATE FUNCTION qkern_log_drain_sources_ok(sources text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT sources IS NOT NULL
     AND cardinality(sources) BETWEEN 1 AND 5
     AND sources = ARRAY(
       SELECT allowed.source
         FROM unnest(ARRAY['auth_audit', 'function_invocations', 'storage_objects',
                           'webhook_deliveries', 'usage_series'])
              WITH ORDINALITY AS allowed(source, nth)
        WHERE allowed.source = ANY (sources)
        ORDER BY allowed.nth)
$$;

REVOKE ALL ON FUNCTION qkern_log_drain_sources_ok(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qkern_log_drain_sources_ok(text[]) TO qkern_runtime;

CREATE TABLE project_log_drains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  webhook_id uuid NOT NULL,
  sources text[] NOT NULL CHECK (qkern_log_drain_sources_ok(sources)),
  -- Die Fassung des Vertrags mit dem Empfaenger. Sie steht an der Definition,
  -- damit ein Empfaenger einer alten Fassung nicht stillschweigend eine neue
  -- bekommt, und sie ist beidseitig begrenzt, weil eine offene Zahl hier nichts
  -- ausdrueckt.
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id, environment, webhook_id)
    REFERENCES project_webhooks (organization_id, project_id, environment, id)
    ON DELETE CASCADE,
  -- Ein Webhook traegt hoechstens einen Drain. Zwei waeren zwei Definitionen
  -- mit einem Namen und einem Ziel, und die Liste koennte nicht sagen, welche
  -- eine Ladung ausgeloest hat.
  CONSTRAINT project_log_drains_webhook_key
    UNIQUE (organization_id, project_id, environment, webhook_id)
);

-- Der Weg des weiterleitenden Prozesses: alle aktiven Drains einer Umgebung.
CREATE INDEX project_log_drains_scope_idx
  ON project_log_drains (organization_id, project_id, environment);

-- Die Kopplung ist unveraenderlich, genau wie die Definition in 0032 und die
-- Kopplung in 0049. Wer die Quellen aendern will, legt neu an: Sonst koennte
-- eine wartende Ladung gegen eine Kopplung laufen, die zum Zeitpunkt des
-- Sammelns eine andere war. Ausgedrueckt ist das ueber die Spaltenrechte --
-- die Laufzeitrolle bekommt auf dieser Tabelle kein UPDATE.
ALTER TABLE project_log_drains ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_log_drains_select ON project_log_drains
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_log_drains_insert ON project_log_drains
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_log_drains_delete ON project_log_drains
  FOR DELETE USING (organization_id = qkern_current_organization_id());

REVOKE ALL ON project_log_drains FROM PUBLIC;

-- DELETE nur, damit das Loeschen eines Webhooks ueber den Fremdschluessel
-- durchgreift. Die Produktflaeche dieses Slices loescht nicht.
GRANT SELECT, INSERT, DELETE ON project_log_drains TO qkern_runtime;

COMMIT;
