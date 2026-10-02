BEGIN;

-- Stueckweise Artefakte und ein Zeitplan fuer Projektdatenbank-Backups (2.129).
--
-- ## Was 2.73.0 offen gelassen hat
--
-- `docs/RELEASE_2.73.md` nennt drei Stellen selbst: der Dump geht durch den
-- Speicher mit 256 MiB Grenze, es gibt keine Route und keinen Knopf, und es gibt
-- keinen Zeitplan. Diese Migration ist die Datenbankseite der ersten und der
-- dritten.

-- ## 1. Die Form des Artefakts
--
-- Bis 2.73.0 war ein Backup **ein** Umschlag in **einem** `PUT`. Seit 2.129 ist
-- es eine Folge von Teilen, je mit eigenem Siegel, hochgeladen als
-- Multipart-Upload. Der Aufbau und die Begruendungen stehen in
-- `lib/server/backup/project-database-artifact.ts`; was hier steht, ist das,
-- was der Leser aus der Zeile braucht, bevor er ein Byte holt.
ALTER TABLE project_database_backups
  ADD COLUMN artifact_format text NOT NULL DEFAULT 'single'
    CHECK (artifact_format IN ('single', 'chunked'));

COMMENT ON COLUMN project_database_backups.artifact_format IS
  'single: der Umschlag aus 2.73.0 ueber das ganze Artefakt. chunked: die Teilefolge aus 2.129. Die Voreinstellung ist single, damit die Zeilen aus 2.73.0 ihre Form behalten; neue Zeilen schreiben chunked.';

-- Die Zahl der Teile. Der Leser rechnet sie aus `size_bytes` und
-- `part_plaintext_bytes` **selbst** nach und glaubt diese Spalte nicht: weichen
-- die beiden Zahlen ab, ist das ein Befund und kein Rundungsfehler. Warum sie
-- trotzdem hier steht: ohne sie kaeme der Leser nicht auf die Bytebereiche, ohne
-- erst das Artefakt zu lesen, und genau das soll er nicht muessen.
--
-- 10 000 ist nicht unsere Wahl; es ist die Teilegrenze des S3-Protokolls.
ALTER TABLE project_database_backups
  ADD COLUMN part_count integer CHECK (part_count BETWEEN 1 AND 10000);

-- Nutzbytes je Teil. Im Produkt 64 MiB; die Spalte traegt den Wert, mit dem
-- **dieses** Backup geschrieben wurde, und nicht die aktuelle Einstellung des
-- Dienstes. Ein Backup, dessen Teilegroesse sich nachtraeglich mit einer
-- Einstellung aendert, waere unlesbar, und das ohne jede Meldung.
ALTER TABLE project_database_backups
  ADD COLUMN part_plaintext_bytes integer
    CHECK (part_plaintext_bytes BETWEEN 1024 AND 268435456);

-- Ein `chunked`-Backup, das da ist, nennt beide Zahlen. Der Riegel steht neben
-- `project_database_backups_available_shape` und nicht darin: die vorhandene
-- Zusage aendert sich nicht, es kommt eine dazu.
ALTER TABLE project_database_backups
  ADD CONSTRAINT project_database_backups_chunked_shape CHECK (
    artifact_format <> 'chunked' OR status <> 'available' OR
    (part_count IS NOT NULL AND part_plaintext_bytes IS NOT NULL));

-- Und umgekehrt: ein `single`-Backup hat keine Teile. Ohne diesen Riegel koennte
-- eine Zeile beide Formen gleichzeitig behaupten, und der Leser muesste
-- entscheiden, welcher Angabe er glaubt.
ALTER TABLE project_database_backups
  ADD CONSTRAINT project_database_backups_single_shape CHECK (
    artifact_format = 'chunked' OR
    (part_count IS NULL AND part_plaintext_bytes IS NULL));

-- ## 1b. Eine Wiederherstellung, bestellt ueber eine Route
--
-- Seit 2.129 gibt es eine Route, die eine Wiederherstellung **anstoesst**. Sie
-- fuehrt sie nicht aus, und das ist keine Bequemlichkeit: eine Wiederherstellung
-- legt eine **neue Datenbank** an, und `CREATEDB` hat in QKERN genau ein Prozess
-- (`lib/server/backup/project-database.ts`). Der Next-Prozess hat weder dieses
-- Recht noch `psql` noch `pg_dump`, und beides dort hineinzulegen waere eine
-- zweite Stelle mit dem schaerfsten Recht im Cluster -- genau das, was 2.126
-- begruendet vermieden hat.
--
-- Also ist eine Wiederherstellung ein **Auftrag**, und er steht wie das Backup
-- in derselben Zeile: ein Auftrag und sein Gegenstand sind dasselbe Ding, und
-- eine zweite Tabelle waere eine zweite Antwort auf dieselbe Frage (die
-- Begruendung aus 0083 gilt hier wortgleich).
ALTER TABLE project_database_backups
  ADD COLUMN restore_status text
    CHECK (restore_status IN ('requested', 'running', 'succeeded', 'failed')),
  ADD COLUMN restore_requested_at timestamptz,
  -- Wer sie bestellt hat. Eine Kennung des Bestellers, wie `requested_by` in
  -- 0020, und **keine** Mailadresse: die stuende dann in einem Katalog, der
  -- sonst keine Personendaten traegt.
  ADD COLUMN restore_requested_by text
    CHECK (restore_requested_by ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  -- Der Name der Zieldatenbank. Er wird aus der Backup-Id abgeleitet und nie aus
  -- einer Anfrage uebernommen; die Form steht hier, damit eine von Hand
  -- geschriebene Zeile sie nicht umgehen kann.
  ADD COLUMN restore_database_name text
    CHECK (restore_database_name ~ '^[a-z_][a-z0-9_]{0,62}$'),
  ADD COLUMN restore_completed_at timestamptz,
  ADD COLUMN restore_error_code text CHECK (restore_error_code IN (
    'BACKUP_NOT_AVAILABLE', 'BACKUP_ARTIFACT_MISMATCH', 'RESTORE_MANIFEST_MISMATCH',
    'OBJECT_STORE_UNAVAILABLE', 'KEY_UNAVAILABLE', 'CONNECTION_UNAVAILABLE', 'RESTORE_FAILED')),
  -- Die Lease der Wiederherstellung. **Zweiteilig** und nicht dreiteilig wie die
  -- des Backups, und der Unterschied ist der Grund, warum es ueberhaupt eigene
  -- Spalten sind: eine Wiederherstellung wird **nicht** wiederholt.
  --
  -- Ein zweiter Versuch wuerde `CREATE DATABASE` mit demselben Namen rufen und
  -- daran scheitern, und davor laege eine halb gebaute Datenbank, die jemand
  -- ansehen muss. Ein Fehlschlag bleibt darum ein Fehlschlag, und wer es wieder
  -- versuchen will, bestellt neu. Deshalb gibt es hier kein `attempt_count` und
  -- kein `claimed_by`: beide gibt es beim Backup, damit ein Betreiber sieht,
  -- welcher Wirt den wievielten Versuch verloren hat, und beides hat hier keine
  -- Bedeutung.
  ADD COLUMN restore_lease_token uuid,
  ADD COLUMN restore_lease_expires_at timestamptz;

ALTER TABLE project_database_backups
  ADD CONSTRAINT project_database_backups_restore_shape CHECK (
    (restore_status IS NULL AND restore_requested_at IS NULL AND
     restore_requested_by IS NULL AND restore_database_name IS NULL) OR
    (restore_status IS NOT NULL AND restore_requested_at IS NOT NULL AND
     restore_requested_by IS NOT NULL AND restore_database_name IS NOT NULL)),
  ADD CONSTRAINT project_database_backups_restore_lease_shape CHECK (
    (restore_lease_token IS NULL AND restore_lease_expires_at IS NULL) OR
    (restore_lease_token IS NOT NULL AND restore_lease_expires_at IS NOT NULL)),
  ADD CONSTRAINT project_database_backups_restore_running_shape CHECK (
    restore_status <> 'running' OR restore_lease_token IS NOT NULL),
  -- Ein Fehlschlag nennt seinen Grund, ein Erfolg nennt keinen. Dieselbe Zusage
  -- wie beim Backup selbst.
  ADD CONSTRAINT project_database_backups_restore_failure_shape CHECK (
    (restore_status = 'failed') = (restore_error_code IS NOT NULL)),
  ADD CONSTRAINT project_database_backups_restore_done_shape CHECK (
    restore_status NOT IN ('succeeded', 'failed') OR restore_completed_at IS NOT NULL);

-- Der Wirt sucht die naechste bestellte Wiederherstellung. Teilindex, weil es
-- fast immer keine gibt (die Lehre aus 0063).
CREATE INDEX project_database_backups_restore_claim_idx
  ON project_database_backups (organization_id, restore_requested_at, id)
  WHERE restore_status IN ('requested', 'running');

-- ### Und doch kein `UPDATE` fuer die Console
--
-- 0083 hat `qkern_runtime` ausdruecklich **kein** `UPDATE` gegeben, mit dieser
-- Begruendung: "ein Weg, der einen Zustand von Hand auf `available` setzen kann,
-- waere ein Weg, ein Backup zu behaupten." Diese Zusage bleibt wortwoertlich
-- stehen.
--
-- Was die Route braucht, ist ein `UPDATE` auf **sechs Spalten**, und genau die
-- bekommt sie. PostgreSQL kann Rechte je Spalte, und das ist hier kein
-- Feinschliff: mit einem Tabellenrecht koennte derselbe Weg `status`,
-- `object_key`, `artifact_sha256`, `manifest_sha256` und `expires_at` schreiben,
-- also ein Backup behaupten, das es nie gab. Mit diesen sechs kann er eine
-- Wiederherstellung bestellen und sonst nichts.
--
-- **Warum sechs und nicht vier.** Vier waren es im ersten Entwurf, und der erste
-- Lauf von (2.130) hat ihn umgeworfen: Nach einem Fehlschlag traegt die Zeile
-- einen `restore_error_code`, und `project_database_backups_restore_failure_shape`
-- verlangt, dass ein Code genau dann dasteht, wenn der Zustand `failed` ist. Eine
-- **neue** Bestellung setzt den Zustand auf `requested` und kam damit an der
-- Zusicherung nicht vorbei. Es gibt also zwei Wege: die Zusicherung aufweichen,
-- dann stuende an einer wartenden Wiederherstellung der Fehlercode der vorigen,
-- oder die Route den alten Ausgang mitraeumen lassen. Der zweite haelt die Zeile
-- sauber, und darum kommen `restore_error_code` und `restore_completed_at` dazu.
--
-- **Was das oeffnet, ausgeschrieben.** Mit `restore_status` und diesen beiden
-- Spalten koennte der Next-Prozess eine Wiederherstellung als `succeeded`
-- hinschreiben, die nie lief. Das ist tragbar, und zwar aus zwei Gruenden: Die
-- Bestellung einer Wiederherstellung ist ohnehin seine, er ist also der Autor
-- dieses Lebenslaufs; und die Luege waere sichtbar, denn die Datenbank, die
-- `restore_database_name` nennt, gibt es dann nicht. Was er weiterhin nicht
-- anfassen kann, ist alles am **Backup** selbst und die Pacht der
-- Wiederherstellung (`restore_lease_token`): sie bleibt beim Provisioner, also
-- kann die Route sich keine laufende Wiederherstellung nehmen.
GRANT UPDATE (restore_status, restore_requested_at, restore_requested_by,
              restore_database_name, restore_error_code, restore_completed_at)
  ON project_database_backups TO qkern_runtime;

-- ## 2. Der Zeitplan
--
-- ### Warum nicht der vorhandene Cron-Weg
--
-- QKERN hat Cron-Definitionen (0026, `lib/server/compute/cron.ts`) und einen
-- Cron-Prozess, und die Frage "traegt der vorhandene Weg das" war die erste.
-- Die Antwort ist nein, und zwar aus vier Gruenden, nicht aus Bequemlichkeit:
--
-- 1. **Eine Cron-Definition zeigt auf eine Compute-Funktion des Mandanten.** Ihr
--    Dispatcher legt eine Nachricht in eine **Projekt-Queue**, und ein Worker
--    des Mandanten holt sie. Ein Backup laeuft im Provisioner, mit einer
--    privilegierten Rolle und einem Vault-Weg; es als Mandantenfunktion
--    auszuloesen hiesse, diesen Weg an einer Mandanten-Queue aufzuhaengen.
-- 2. **Eine Cron-Definition ist mandantenbearbeitbar.** Es gibt Routen, mit
--    denen ein Mandant sie abschaltet, umbiegt oder loescht. Der Zeitplan eines
--    Backups darf nicht an einer Zeile haengen, deren Besitzer sie nach Belieben
--    auf eine andere Funktion umlegt.
-- 3. **Der Cron-Prozess ist der Compute-Prozess.** Der Backup-Weg laeuft im
--    Provisioner, und der Grund dafuer steht in
--    `lib/server/backup/project-database.ts`: er ist der einzige Prozess mit
--    `CREATEDB` und einem privilegierten Weg zu einer Projektdatenbank.
-- 4. **Ein Backup braucht keine Cron-Zeile.** Ein Takt ("alle 24 Stunden") sagt
--    alles, was hier zu sagen ist. Ein Cron-Ausdruck koennte "jeden Montag um
--    3:07 in Europe/Zurich" sagen, und damit kaeme eine Zeitzone und eine
--    Sommerzeit in einen Weg, der sie nicht braucht. Ein Takt kann nicht
--    zweimal in derselben Stunde feuern, weil eine Uhr zurueckgestellt wurde.
--
-- **Und doch kein zweiter Scheduler.** Was hier entsteht, ist keine Schleife und
-- kein Prozess: es ist eine Pflicht in der **Runde, die es schon gibt**. Der
-- Provisioner ruft in seiner Leerlaufrunde `ProjectDatabaseBackupService.runRound`
-- (2.126), und die ruft jetzt zuerst den Takt. Siehe
-- `lib/server/backup/project-database-schedule.ts`.
CREATE TABLE project_database_backup_schedules (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  -- Der Takt in Stunden. 24 ist die Voreinstellung und nicht gewuerfelt:
  -- Supabase sichert auf den bezahlten Stufen **taeglich**, und wer von dort
  -- kommt, erwartet das. Nach oben ein Jahr, weil alles darueber keine
  -- Aufbewahrung mehr beschreibt.
  interval_hours integer NOT NULL DEFAULT 24
    CHECK (interval_hours BETWEEN 1 AND 8760),
  -- **Hier steht die Frist je Umgebung**, und nur hier.
  --
  -- Bis 2.129 stand sie in einer Umgebungsvariablen des Prozesses
  -- (`QKERN_PROJECT_BACKUP_RETENTION_DAYS`), also fuer alle Projekte und alle
  -- Umgebungen gleich. Das ist keine Frist, das ist eine Prozesseinstellung: ein
  -- Betreiber, der Produktion 30 Tage und Staging 7 Tage aufbewahren will,
  -- braucht zwei Prozesse. Die Variable bleibt als **Vorgabe** fuer eine
  -- Umgebung ohne Zeile; was hier steht, gewinnt.
  retention_days integer NOT NULL DEFAULT 30
    CHECK (retention_days BETWEEN 1 AND 730),
  -- Wann der naechste Auftrag faellig ist. Der Takt schreibt sie fort, und zwar
  -- auf `now() + interval` und **nicht** auf `next_due_at + interval`: nach einem
  -- Ausfall von drei Tagen soll ein Zeitplan wieder laufen und nicht drei Tage
  -- nachholen. Dieselbe Entscheidung wie `maxCatchUp` im Cron-Scheduler, nur
  -- ohne Nachholen.
  next_due_at timestamptz NOT NULL DEFAULT now(),
  last_enqueued_at timestamptz,
  -- Der Auftrag, den der Takt zuletzt eingestellt hat. Eine Id, keine Groesse
  -- und kein Schluessel.
  last_backup_id uuid,
  -- Wie oft ein faelliger Takt den vorigen Auftrag noch wartend oder laufend
  -- fand. Das ist die Zahl, an der ein Betreiber sieht, dass sein Takt kuerzer
  -- ist als ein Dump dauert -- und sie steht hier statt in einem Log, weil ein
  -- Log nach vier Wochen weg ist und diese Zeile nicht.
  busy_count integer NOT NULL DEFAULT 0 CHECK (busy_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, project_id, environment),
  CONSTRAINT project_database_backup_schedules_binding_fk
    FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_database_bindings (organization_id, project_id, environment)
    ON DELETE CASCADE
);

-- Der Takt sucht, was faellig ist. Ohne diesen Index waere jede Runde ein Seq
-- Scan ueber die Zeitplaene aller Mandanten (die Lehre aus 0063).
CREATE INDEX project_database_backup_schedules_due_idx
  ON project_database_backup_schedules (organization_id, next_due_at)
  WHERE enabled;

CREATE TRIGGER project_database_backup_schedules_touch_updated_at
BEFORE UPDATE ON project_database_backup_schedules
FOR EACH ROW EXECUTE FUNCTION qkern_touch_updated_at();

-- Die Zeilen, die es schon gibt. Ohne diesen Nachtrag haetten genau die
-- Datenbanken keinen Zeitplan, die am laengsten laufen.
--
-- Der Nachtrag steht **vor** dem Einschalten der Zeilensicherheit, und das ist
-- kein Stilfrage: mit `FORCE` haelt die Policy auch fuer den Eigentuemer, und
-- eine Migration lauft ohne gesetztes `qkern.organization_id`. Danach eingefuegt
-- waere diese Anweisung je nach Rolle, mit der ein Betreiber Migrationen fahrt,
-- entweder erfolgreich oder ein Fehlschlag mitten im Release.
INSERT INTO project_database_backup_schedules
  (organization_id, project_id, environment, enabled)
SELECT organization_id, project_id, environment, environment <> 'development'
FROM project_database_bindings
ON CONFLICT (organization_id, project_id, environment) DO NOTHING;

ALTER TABLE project_database_backup_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_database_backup_schedules FORCE ROW LEVEL SECURITY;

-- Dieselbe Mandantengrenze wie in 0083, und zwar ohne Filter in der Anfrage.
CREATE POLICY project_database_backup_schedules_tenant ON project_database_backup_schedules
  USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

REVOKE ALL ON project_database_backup_schedules FROM PUBLIC, qkern_auth, qkern_worker;
-- Der Provisioner fahrt den Takt, also schreibt er `next_due_at`, `busy_count`
-- und `last_backup_id`.
GRANT SELECT, INSERT, UPDATE, DELETE ON project_database_backup_schedules TO qkern_provisioner;
-- Die Console und die Route lesen den Zeitplan. Sie aendern ihn nicht: dafuer
-- gibt es in 2.129 keine Route, und ein Recht ohne Aufrufer ist ein offenes Tor
-- ohne Nutzen.
GRANT SELECT ON project_database_backup_schedules TO qkern_runtime;

-- ## Wer eine Zeitplanzeile anlegt
--
-- Ein Trigger auf der Bindung, und nicht ein zweiter Weg im Quelltext.
--
-- Die Begruendung: "jede bereitgestellte Projektdatenbank hat einen Zeitplan"
-- ist eine Aussage ueber den **Zustand** und nicht ueber einen Aufrufer. Als
-- Aufrufer im Provisioner waere sie an genau einem Pfad wahr und an jedem
-- anderen nicht -- und 0083 hat selbst eine Bindung aus einem Fall heraus
-- geschrieben, ohne durch den Provisioner zu gehen. Als Trigger ist sie
-- ueberall wahr.
--
-- `development` bekommt die Zeile **abgeschaltet**. Eine Entwicklungsdatenbank
-- ist eine, die ein Entwickler wegwirft; ein taeglicher Dump davon ist Kosten
-- ohne Zusage. Die Zeile ist trotzdem da, damit ein Betreiber sie anschalten
-- kann, ohne sie anzulegen.
CREATE FUNCTION qkern_project_database_backup_schedule_seed()
RETURNS trigger
LANGUAGE plpgsql
-- **Kein `SECURITY DEFINER`.** Die Funktion laeuft als der, der die Bindung
-- schreibt, und das ist richtig so: wer eine Bindung schreiben darf, lauft in
-- einer Transaktion mit gesetztem `qkern.organization_id` (sonst haette die
-- Zeilensicherheit auf `project_database_bindings` ihn schon abgewiesen), also
-- traegt die Policy auf dem Zeitplan genauso. Ein `SECURITY DEFINER` waere hier
-- eine Stelle, an der ein Einfuegen die Mandantengrenze nicht mehr sieht -- und
-- das fuer eine Zeile, die sie gar nicht braucht.
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO project_database_backup_schedules
    (organization_id, project_id, environment, enabled)
  VALUES (NEW.organization_id, NEW.project_id, NEW.environment,
          NEW.environment <> 'development')
  ON CONFLICT (organization_id, project_id, environment) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION qkern_project_database_backup_schedule_seed() FROM PUBLIC;

CREATE TRIGGER project_database_bindings_seed_backup_schedule
AFTER INSERT ON project_database_bindings
FOR EACH ROW EXECUTE FUNCTION qkern_project_database_backup_schedule_seed();

COMMIT;
