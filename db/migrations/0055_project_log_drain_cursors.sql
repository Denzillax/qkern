BEGIN;

-- Die Position des Log-Drain-Sammlers, je Drain und Quelle (2.64).
--
-- ## Warum es diese Tabelle geben muss
--
-- 2.54 hat den Sammler gebaut und seinen Stand ausdruecklich instanzlokal
-- gefuehrt: `LogDrainCollector` haelt eine Map im Prozess und beginnt bei der
-- Spitze der Quelle. Solange nur ein Test ihn aufrief, war das richtig. Sobald
-- ein Dauerprozess ihn betreibt, ist es der Unterschied zwischen einem
-- Neustart, der weiterliest, und einem, der alles ueberspringt, was waehrend
-- der Pause entstanden ist.
--
-- Dieselbe Luecke hat 2.50 bei der Webhook-Bruecke hinterlassen und 2.51 mit
-- `0050_project_database_webhook_cursors.sql` geschlossen. Diese Tabelle ist
-- ihr Geschwister und folgt ihr Zeile fuer Zeile.
--
-- ## Warum je Drain und je Quelle, nicht je Umgebung
--
-- 0050 haelt eine Position je Umgebung, weil es dort genau einen Leser gibt:
-- den Aenderungs-Feed der Projektdatenbank. Hier gibt es fuenf Quellen, und
-- zwei Drains derselben Umgebung duerfen verschiedene davon beliefern. Eine
-- gemeinsame Position waere entweder die des schnelleren Drains -- dann
-- ueberspringt der langsamere -- oder die des langsameren -- dann wiederholt
-- der schnellere. Beides waere falsch, und zwar still.
--
-- Der Schluessel nennt den **Webhook**, nicht die Drain-Id. Das ist dasselbe:
-- `project_log_drains_webhook_key` laesst je Webhook hoechstens einen Drain zu.
-- Es ist aber der Schluessel, auf den ein Fremdschluessel zeigen kann, und
-- damit verschwindet eine Position mit ihrem Drain, ohne dass jemand sie
-- loeschen muss.
--
-- ## Warum die Position Text ist und nicht eine Zahl
--
-- Der Feed aus 0050 zaehlt; eine Log-Quelle tut das nicht. Ihre Position ist
-- `<zeitpunkt>#<id>` -- genau der undurchsichtige Cursor, den
-- `PostgresLogDrainSourceReader` bildet und als einziger versteht. Er ist als
-- Text aufsteigend sortierbar, weil der Zeitpunkt in ISO-8601 mit fester
-- Laenge vorne steht.
--
-- `COLLATE "C"` steht ausdruecklich da: Nur die Byte-Ordnung stimmt mit der
-- Ordnung `(zeitpunkt, id)` ueberein, nach der der Leser sortiert. Eine
-- sprachabhaengige Sortierung ignoriert Satzzeichen und koennte `GREATEST`
-- eine aeltere Position als die groessere ausgeben lassen.
--
-- Die leere Zeichenkette heisst "von Anfang an" und ist der Stand, den eine
-- Quelle ohne eine einzige Zeile bekommt. Der Sammler schreibt sie beim
-- Anlegen, damit ein Neustart nicht auf eine inzwischen gewachsene Spitze
-- springt und dabei ueberspringt, was dazwischen entstanden ist.
--
-- ## Warum ein GREATEST beim Schreiben
--
-- Dieselbe Begruendung wie in 0050: Zwei Compute-Prozesse mit derselben
-- Scope-Liste sind eine zulaessige Betriebsform. Sie duerfen dieselbe Ladung
-- doppelt einreihen -- eine Zustellung traegt eine eigene Id. Sie duerfen die
-- Position aber nicht zurueckdrehen, sonst liest die schnellere Instanz beim
-- naechsten Start einen Bereich erneut. Der Schreibweg ist deshalb monoton,
-- und zwar in der Datenbank und nicht im Prozess.
--
-- ## Warum hier kein Eintrag und kein Feld vorkommt
--
-- Diese Tabelle haelt einen Drain, eine Quelle und eine Position. Sie hat
-- keine Spalte, in die eine gelesene Zeile, ein Feldname, ein Ziel oder eine
-- Geheimnisreferenz passen wuerde. Was hinausgeht, entscheidet weiterhin
-- ausschliesslich die Projektion in `lib/console/log-drains`.

CREATE TABLE project_log_drain_cursors (
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  webhook_id uuid NOT NULL,
  -- Dieselbe geschlossene Liste wie die Kopplung selbst, geprueft von
  -- derselben Funktion aus 0054. Eine Position fuer eine Quelle, die es nicht
  -- gibt, waere eine Zeile, die nie jemand liest und nie jemand raeumt.
  source text NOT NULL CHECK (qkern_log_drain_sources_ok(ARRAY[source])),
  position text COLLATE "C" NOT NULL CHECK (char_length(position) <= 512),
  -- Wann zuletzt wirklich eine Ladung hinausgegangen ist -- `NULL`, solange
  -- nur der Anfangsstand festgehalten wurde. Ohne diese Unterscheidung zeigte
  -- die Console fuer einen frisch angelegten Drain einen Zeitpunkt an, zu dem
  -- niemand etwas weitergeleitet hat. `updated_at` beantwortet die andere
  -- Frage: wann diese Zeile zuletzt angefasst wurde.
  forwarded_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, project_id, environment, webhook_id, source),
  FOREIGN KEY (organization_id, project_id, environment, webhook_id)
    REFERENCES project_log_drains (organization_id, project_id, environment, webhook_id)
    ON DELETE CASCADE
);

ALTER TABLE project_log_drain_cursors ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_log_drain_cursors_select ON project_log_drain_cursors
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_log_drain_cursors_insert ON project_log_drain_cursors
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_log_drain_cursors_update ON project_log_drain_cursors
  FOR UPDATE USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

REVOKE ALL ON project_log_drain_cursors FROM PUBLIC;

-- Kein DELETE, genau wie in 0050: Eine Position verschwindet mit ihrem Drain
-- ueber den Fremdschluessel und sonst gar nicht. Wer sie einzeln loeschen
-- koennte, koennte einen Drain beim naechsten Start an der Spitze neu beginnen
-- lassen -- und damit still ueberspringen, was dazwischen entstanden ist.
GRANT SELECT, INSERT, UPDATE ON project_log_drain_cursors TO qkern_runtime;

COMMIT;
