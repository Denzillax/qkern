BEGIN;

-- Dashboard-Webhooks (2.75): die Kopplung zwischen den Ereignissen des
-- Projekts, die die Console zeigt, und einem ausgehenden Ziel.
--
-- ## Warum eine Kopplungstabelle und keine zweite Definitionstabelle
--
-- Dieselbe Begruendung wie 0049 fuer die Datenbank-Webhooks und 0054 fuer die
-- Log-Drains: Der ausgehende Weg steht vollstaendig. 0032 haelt Ziel,
-- Geheimnisreferenz, Zeitbudget und Versuchsgrenze, dazu die Outbox mit Lease,
-- serverberechnetem Backoff und Dead Letter. Signiert wird ueber den Vault,
-- zugestellt vom Zustellprozess, und der Zustellstatus hat bereits eine Route.
--
-- Ein Dashboard-Webhook ist kein zweiter Zustellweg. Er ist ein vorhandener
-- Webhook plus die Aussage, welche Ereignisse des Projekts ihn beliefern.
-- Diese Tabelle haelt genau diese Aussage; alles andere bleibt, wo es ist. Der
-- An- und Ausschalter ist darum `project_webhooks.enabled`, und die
-- Zustellliste ist dieselbe wie fuer jeden anderen Webhook.
--
-- ## Warum es keine Ereignistabelle gibt
--
-- Die Ereignisse selbst stehen schon da. `audit_logs` aus 0001 haelt jede
-- angewandte Migration, jede Freigabe und jeden Schritt der Provisionierung,
-- mit Akteur, Ressourcenreferenz, Zustand, redigierten Metadaten und der
-- Hashkette aus 0002. Eine eigene Ereignistabelle waere eine zweite Wahrheit
-- ueber dieselben Vorgaenge -- und die erste, die beim Auseinanderfallen
-- niemand bemerkt, weil beide plausibel aussehen.
--
-- Diese Migration legt darum **keine** Spalte an, in der ein Ereignis, ein
-- Feld, eine Nutzlast oder ein Akteur liegen koennte. Sie nennt einen Webhook
-- und eine Liste von Ereignisarten.
--
-- ## Warum hier kein Feld und keine Filterregel steht
--
-- Was eine Meldung traegt, entscheidet nicht der Betreiber, sondern die
-- Projektion der Console-Ansicht zur jeweiligen Ereignisart. Sie steht in
-- `lib/console/dashboard-webhooks` und haengt am Vertrag
-- `dashboard-webhook-field-boundary`. Gaebe es hier eine Spalte fuer eine
-- Feldauswahl oder einen Filter, waere die Grenze verhandelbar, und ein
-- Betreiber, der versehentlich ein Feld mehr auswaehlt, haette ein Datenleck
-- bestellt. Diese Tabelle kann keine Felder speichern, weil sie keine Spalte
-- dafuer hat.

-- Die feste Liste der Ereignisarten, geprueft in der Datenbank.
--
-- Dieselbe Bauform wie `qkern_log_drain_sources_ok` aus 0054: Ein CHECK darf
-- keine Unterabfrage enthalten, und "jedes Element erlaubt, keines doppelt, in
-- dieser Reihenfolge" laesst sich ohne eine nicht ausschreiben, ohne alle 15
-- erlaubten Arrays aufzuzaehlen. Die Unterabfrage steht darum in einer
-- IMMUTABLE Funktion, wo sie erlaubt ist.
--
-- Die Reihenfolge wird mitgeprueft, nicht nur die Menge. Zwei gleichbedeutende
-- Definitionen sollen gleich aussehen, sonst koennte eine Liste zweimal
-- dasselbe zeigen und verschieden aussehen. Der Dienst schreibt in genau
-- dieser Reihenfolge.
CREATE FUNCTION qkern_dashboard_event_kinds_ok(kinds text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT kinds IS NOT NULL
     AND cardinality(kinds) BETWEEN 1 AND 4
     AND kinds = ARRAY(
       SELECT allowed.kind
         FROM unnest(ARRAY['migration_applied', 'approval_decided',
                           'project_state_changed', 'environment_added'])
              WITH ORDINALITY AS allowed(kind, nth)
        WHERE allowed.kind = ANY (kinds)
        ORDER BY allowed.nth)
$$;

REVOKE ALL ON FUNCTION qkern_dashboard_event_kinds_ok(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qkern_dashboard_event_kinds_ok(text[]) TO qkern_runtime;

CREATE TABLE project_dashboard_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  webhook_id uuid NOT NULL,
  kinds text[] NOT NULL CHECK (qkern_dashboard_event_kinds_ok(kinds)),
  -- Die Fassung des Vertrags mit dem Empfaenger. Sie steht an der Definition,
  -- damit ein Empfaenger einer alten Fassung nicht stillschweigend eine neue
  -- bekommt, und sie ist beidseitig begrenzt, weil eine offene Zahl hier nichts
  -- ausdrueckt.
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id, environment, webhook_id)
    REFERENCES project_webhooks (organization_id, project_id, environment, id)
    ON DELETE CASCADE,
  -- Ein Webhook traegt hoechstens eine Kopplung. Zwei waeren zwei Definitionen
  -- mit einem Namen und einem Ziel, und die Liste koennte nicht sagen, welche
  -- eine Meldung ausgeloest hat.
  CONSTRAINT project_dashboard_webhooks_webhook_key
    UNIQUE (organization_id, project_id, environment, webhook_id)
);

-- Der Weg des Sammlers: alle Kopplungen einer Umgebung.
CREATE INDEX project_dashboard_webhooks_scope_idx
  ON project_dashboard_webhooks (organization_id, project_id, environment);

-- Die Kopplung ist unveraenderlich, genau wie die Definition in 0032 und die
-- Kopplungen in 0049 und 0054. Wer die Ereignisarten aendern will, legt neu an:
-- Sonst koennte eine wartende Meldung gegen eine Kopplung laufen, die zum
-- Zeitpunkt des Sammelns eine andere war. Ausgedrueckt ist das ueber die
-- Rechte -- die Laufzeitrolle bekommt auf dieser Tabelle kein UPDATE.
ALTER TABLE project_dashboard_webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_dashboard_webhooks_select ON project_dashboard_webhooks
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_dashboard_webhooks_insert ON project_dashboard_webhooks
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_dashboard_webhooks_delete ON project_dashboard_webhooks
  FOR DELETE USING (organization_id = qkern_current_organization_id());

REVOKE ALL ON project_dashboard_webhooks FROM PUBLIC;

-- DELETE nur, damit das Loeschen eines Webhooks ueber den Fremdschluessel
-- durchgreift. Die Produktflaeche dieses Slices loescht nicht.
GRANT SELECT, INSERT, DELETE ON project_dashboard_webhooks TO qkern_runtime;

-- Die Position des Sammlers, je Webhook und Ereignisart.
--
-- ## Warum es diese Tabelle von Anfang an gibt
--
-- 2.54 hat den Log-Drain-Sammler ohne dauerhafte Position gebaut, und 2.64
-- hat das mit 0056 nachgeholt: Ohne sie beginnt ein Neustart an der Gegenwart
-- und ueberspringt still, was waehrend der Pause entstanden ist. Bei
-- Projektereignissen waere derselbe Fehler noch teurer, weil sie selten sind:
-- Eine uebersprungene Freigabe kommt nicht in der naechsten Sekunde noch
-- einmal vorbei.
--
-- ## Warum je Webhook und je Ereignisart
--
-- Zwei Dashboard-Webhooks derselben Umgebung duerfen verschiedene Arten
-- beliefern. Eine gemeinsame Position waere entweder die des schnelleren --
-- dann ueberspringt der langsamere -- oder die des langsameren -- dann
-- wiederholt der schnellere. Beides waere falsch, und zwar still.
--
-- Der Schluessel nennt den **Webhook**, nicht die Id der Kopplung. Das ist
-- dasselbe: `project_dashboard_webhooks_webhook_key` laesst je Webhook
-- hoechstens eine Kopplung zu. Es ist aber der Schluessel, auf den ein
-- Fremdschluessel zeigen kann, und damit verschwindet eine Position mit ihrer
-- Kopplung, ohne dass jemand sie loeschen muss.
--
-- ## Warum die Position Text ist und nicht eine Zahl
--
-- Die Audit-Kette zaehlt nicht. Ihre Position ist `<zeitpunkt>#<id>` -- genau
-- der undurchsichtige Cursor, den `PostgresDashboardEventReader` bildet und als
-- einziger versteht. Er ist als Text aufsteigend sortierbar, weil der Zeitpunkt
-- in ISO-8601 mit fester Laenge vorne steht.
--
-- `COLLATE "C"` steht ausdruecklich da, wie in 0056: Nur die Byte-Ordnung
-- stimmt mit der Ordnung `(created_at, id)` ueberein, nach der der Leser
-- sortiert -- und es ist dieselbe Ordnung, die der Index `audit_logs_chain_idx`
-- aus 0002 fuehrt. Eine sprachabhaengige Sortierung ignoriert Satzzeichen und
-- koennte `GREATEST` eine aeltere Position als die groessere ausgeben lassen.
--
-- Die leere Zeichenkette heisst "von Anfang an" und ist der Stand, den eine
-- Umgebung ohne einen einzigen Audit-Eintrag bekommt.
--
-- ## Warum ein GREATEST beim Schreiben
--
-- Dieselbe Begruendung wie in 0050 und 0056: Zwei Compute-Prozesse mit
-- derselben Scope-Liste sind eine zulaessige Betriebsform. Sie duerfen dieselbe
-- Meldung doppelt einreihen -- eine Zustellung traegt eine eigene Id, und die
-- Ansicht sagt ausdruecklich, dass mindestens einmal zugestellt wird. Sie
-- duerfen die Position aber nicht zurueckdrehen, sonst liest die schnellere
-- Instanz beim naechsten Start einen Bereich erneut. Der Schreibweg ist deshalb
-- monoton, und zwar in der Datenbank und nicht im Prozess.
CREATE TABLE project_dashboard_webhook_cursors (
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  webhook_id uuid NOT NULL,
  -- Dieselbe geschlossene Liste wie die Kopplung selbst, geprueft von derselben
  -- Funktion. Eine Position fuer eine Art, die es nicht gibt, waere eine Zeile,
  -- die nie jemand liest und nie jemand raeumt.
  kind text NOT NULL CHECK (qkern_dashboard_event_kinds_ok(ARRAY[kind])),
  position text COLLATE "C" NOT NULL CHECK (char_length(position) <= 512),
  -- Wann zuletzt wirklich eine Meldung hinausgegangen ist -- `NULL`, solange
  -- nur der Anfangsstand festgehalten wurde. Ohne diese Unterscheidung zeigte
  -- die Console fuer einen frisch angelegten Webhook einen Zeitpunkt an, zu dem
  -- niemand etwas gemeldet hat. `updated_at` beantwortet die andere Frage: wann
  -- diese Zeile zuletzt angefasst wurde.
  notified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, project_id, environment, webhook_id, kind),
  FOREIGN KEY (organization_id, project_id, environment, webhook_id)
    REFERENCES project_dashboard_webhooks (organization_id, project_id, environment, webhook_id)
    ON DELETE CASCADE
);

ALTER TABLE project_dashboard_webhook_cursors ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_dashboard_webhook_cursors_select ON project_dashboard_webhook_cursors
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_dashboard_webhook_cursors_insert ON project_dashboard_webhook_cursors
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_dashboard_webhook_cursors_update ON project_dashboard_webhook_cursors
  FOR UPDATE USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

REVOKE ALL ON project_dashboard_webhook_cursors FROM PUBLIC;

-- Kein DELETE, genau wie in 0050 und 0056: Eine Position verschwindet mit ihrer
-- Kopplung ueber den Fremdschluessel und sonst gar nicht. Wer sie einzeln
-- loeschen koennte, koennte einen Webhook beim naechsten Start an der Spitze
-- neu beginnen lassen -- und damit still ueberspringen, was dazwischen
-- entstanden ist.
GRANT SELECT, INSERT, UPDATE ON project_dashboard_webhook_cursors TO qkern_runtime;

COMMIT;
