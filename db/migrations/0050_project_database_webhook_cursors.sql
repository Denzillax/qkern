-- Die Position der Webhook-Bruecke je Umgebung (2.53).
--
-- ## Warum es diese Tabelle geben muss
--
-- 2.50 hat die Bruecke gebaut und ihre Position ausdruecklich instanzlokal
-- gefuehrt: `DatabaseWebhookBridge` beginnt bei `startPosition ?? 0`. Solange
-- nur ein Test sie aufrief, war das richtig. Sobald ein Dauerprozess sie
-- betreibt, ist es der Unterschied zwischen einem Neustart, der weiterliest,
-- und einem, der den ganzen noch vorhandenen Feed ein zweites Mal einreiht.
--
-- Beides waere falsch: Ohne gespeicherte Position wiederholt jeder Neustart
-- alles, was der Feed noch haelt. Mit einer Position, die irgendwo im Prozess
-- lebt, geht sie beim Absturz verloren und niemand merkt es.
--
-- ## Warum ein GREATEST beim Schreiben
--
-- Zwei Compute-Prozesse mit derselben Scope-Liste sind eine zulaessige
-- Betriebsform; die Outbox ist genau dafuer gebaut. Sie duerfen dieselbe
-- Aenderung doppelt einreihen -- eine Zustellung traegt eine eigene Id, und
-- `position` in der Nutzlast macht die Wiederholung erkennbar. Sie duerfen die
-- Position aber nicht zurueckdrehen: Eine langsamere Instanz, die ihren
-- aelteren Stand schreibt, liesse die schnellere beim naechsten Start einen
-- Bereich erneut lesen. Der Schreibweg ist deshalb monoton, und zwar in der
-- Datenbank und nicht im Prozess.
--
-- ## Warum kein Zeilenwert und kein Tabellenname hier vorkommt
--
-- Die Position ist eine Zahl aus `qkern_internal.change_feed` der
-- Projektdatenbank. Diese Tabelle haelt eine Umgebung und diese Zahl. Sie hat
-- keine Spalte, in die ein Schluessel, ein Tabellenname oder ein Spaltenwert
-- passen wuerde.

CREATE TABLE project_database_webhook_cursors (
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  -- `position` ist in PostgreSQL kein reserviertes Wort mehr, aber die Spalte
  -- heisst genauso wie im Feed, damit beide Seiten denselben Namen tragen.
  -- 0 heisst "noch nichts gelesen"; der Feed beginnt bei 1.
  position bigint NOT NULL CHECK (position >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, project_id, environment),
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE CASCADE
);

ALTER TABLE project_database_webhook_cursors ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_database_webhook_cursors_select ON project_database_webhook_cursors
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_database_webhook_cursors_insert ON project_database_webhook_cursors
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_database_webhook_cursors_update ON project_database_webhook_cursors
  FOR UPDATE USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

REVOKE ALL ON project_database_webhook_cursors FROM PUBLIC;

-- Kein DELETE: Eine Position verschwindet mit ihrer Umgebung ueber den
-- Fremdschluessel und sonst gar nicht. Wer sie einzeln loeschen koennte,
-- koennte einen Neustart zum Wiederholen des ganzen Feeds bringen.
GRANT SELECT, INSERT, UPDATE ON project_database_webhook_cursors TO qkern_runtime;
