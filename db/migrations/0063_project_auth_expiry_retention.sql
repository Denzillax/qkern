BEGIN;

-- Was abgelaufen ist, verschwindet auch (2.89).
--
-- ## Der offene Punkt
--
-- Drei Tabellen halten Einmal-Artefakte: `project_auth_one_time_tokens` (0024,
-- seit 0060 auch die Passkey-Herausforderungen), `project_auth_oauth_codes`
-- und `project_auth_oauth_tokens` (0062). Alle drei tragen eine Ablaufspalte,
-- alle drei werden bei der Pruefung gegen die Uhr gehalten, und keine einzige
-- Zeile wurde je geloescht. 0062 hat das selbst hingeschrieben: "Was hier
-- fehlt und fehlen darf: ein Aufraeumer fuer abgelaufene Zeilen." Er fehlt
-- jetzt nicht mehr, und diese Migration gibt ihm das Recht dazu.
--
-- ## Die Rolle
--
-- DELETE bekommt **nur** `qkern_auth`. Das ist dieselbe Rolle, die diese drei
-- Tabellen ueberhaupt sehen darf; `qkern_runtime`, `qkern_worker` und
-- `qkern_provisioner` haben auf ihnen kein einziges Recht und bekommen hier
-- auch keines. Der Aufraeumer laeuft deshalb ueber die Auth-Verbindung, obwohl
-- er im Compute-Prozess wohnt: Ein Aufraeumer, der eine zweite Rolle an diese
-- Tabellen liesse, waere eine groessere Aenderung an der Auth-Grenze als der
-- Zweck hergibt.
--
-- ## Was hier ausdruecklich **kein** DELETE bekommt
--
-- * `project_auth_users`, `project_auth_sessions`, `project_auth_mfa_factors`,
--   `project_auth_oidc_identities`: Eine widerrufene Sitzung bleibt stehen,
--   damit die Spur erhalten bleibt, und ein Nutzer verschwindet ueber sein
--   eigenes Loeschen, nicht ueber eine Frist.
-- * `project_auth_passkeys`, `project_auth_oauth_clients`,
--   `project_storage_s3_access_keys`, `project_api_keys`: Das sind Schluessel
--   und Einwilligungen, keine Einmal-Artefakte. Sie laufen nicht ab, sie
--   werden widerrufen, und ein widerrufener Schluessel bleibt stehen.
-- * `audit_logs` und die Auth-Audit-Kette: append-only, und zwar per Trigger.
--   Eine Frist auf einer Kette waere ein Loch in der Kette.
-- * `project_auth_rate_counters`: raeumt 0052 bereits selbst beim Zaehlen auf.

-- ## Die Indizes
--
-- Der Aufraeumer sucht je Umgebung nach "alles, was vor dem Stichtag abgelaufen
-- ist", und zwar in Haeppchen mit fester Obergrenze. Ohne diese Indizes waere
-- jede Runde ein Seq Scan ueber die ganze Tabelle -- also genau die Last, die
-- ein Aufraeumer vermeiden soll.
--
-- Der vorhandene `project_auth_one_time_tokens_active_idx` hilft hier nicht: Er
-- ist partiell auf `consumed_at IS NULL` und laesst genau die verbrauchten
-- Zeilen aus, die die Mehrheit der Altlast stellen.
CREATE INDEX project_auth_one_time_tokens_expiry_idx
  ON project_auth_one_time_tokens (organization_id, project_id, environment, expires_at);

CREATE INDEX project_auth_oauth_codes_expiry_idx
  ON project_auth_oauth_codes (organization_id, project_id, environment, expires_at);

CREATE INDEX project_auth_oauth_tokens_expiry_idx
  ON project_auth_oauth_tokens (organization_id, project_id, environment, expires_at);

-- Die Rechte. DELETE und sonst nichts Neues: Der Aufraeumer liest, um zu
-- zaehlen, und loescht. Er schreibt keine Zeile und aendert keine.
GRANT DELETE ON project_auth_one_time_tokens TO qkern_auth;
GRANT DELETE ON project_auth_oauth_tokens TO qkern_auth;

-- Beim Code ist die Reihenfolge wichtig, und sie steht nicht hier, sondern im
-- Aufraeumer: `project_auth_oauth_tokens.code_id` haengt mit ON DELETE CASCADE
-- am Code. Ein geloeschter abgelaufener Code risse ein Token mit, das noch gilt
-- -- ein Code lebt Minuten, ein Token bis zu zwoelf Stunden. Der Aufraeumer
-- loescht darum erst die abgelaufenen Token und dann nur solche Codes, an denen
-- kein Token mehr haengt. Das Recht allein sagt das nicht; der Fall (2.89) sagt
-- es, und er faellt, wenn es jemand umdreht.
GRANT DELETE ON project_auth_oauth_codes TO qkern_auth;

COMMIT;
