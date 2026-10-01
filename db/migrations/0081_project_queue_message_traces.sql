BEGIN;

-- Die Spur einer Nachricht (2.121).
--
-- ## Der offene Punkt
--
-- `docs/PARITAET.md` sagt in der Queues-Zeile seit `1.88.0`: vor
-- Supabase-Stand, offen nur Tracing. Scope-Isolation, Dedupe, Leases, Fencing,
-- Dead Letters, Multi-Instanz unter Last, ein arbeitender Wirt und ein
-- Metrics-Export stehen. Was fehlte, ist die eine Frage, die ein Betreiber vor
-- jeder anderen stellt: **Was ist mit dieser einen Nachricht passiert.**
--
-- Beantworten konnte das bisher niemand. Die Zustandsspalten von
-- `project_queue_messages` (0026) tragen den **letzten** Stand, nicht den Weg
-- dorthin: `attempt_count` sagt vier Versuche, aber nicht wann, nicht von
-- welchem Wirt und nicht woran die ersten drei scheiterten. `last_failure_code`
-- traegt genau einen Code und vergisst die vorherigen. Und
-- `ProjectQueueWorkerLogger` aus `worker.ts` schreibt zwar jede Station, aber
-- in den Prozess: ein Wirt-Neustart nimmt alles mit, und zwei Instanzen
-- schreiben in zwei Logs, die niemand zusammenfuehrt.
--
-- ## Die Form, und warum diese
--
-- Eine Station je Ereignis, eine Zeile je Station, geschrieben **in derselben
-- Transaktion wie der Zustandswechsel**, den sie beschreibt. Damit gilt: es
-- gibt keine Station ohne ihren Zustandswechsel und keinen Zustandswechsel ohne
-- seine Station. Dieselbe Regel traegt die Messung des Einreihens seit 1.29.
--
-- Zusammengehalten wird eine Spur von `message_id`, und das ist **keine neue
-- Kennung**. Die Nachrichten-Id entsteht beim Einstellen, steht in der
-- Quittung, kommt im Claim zurueck, benennt Ack, Fail und Lease und steht in
-- der Dead-Letter-Liste. Sie ist die Korrelationskennung, die QKERN schon hat;
-- eine zweite danebenzustellen hiesse, zwei Antworten auf dieselbe Frage zu
-- pflegen (die Haltung von `projectQueueDedupeKeyHash` in `service.ts`).
--
-- `trace_id` und `parent_span_id` sind der Anschluss nach draussen, und nur
-- dort steht W3C Trace Context: Der Aufrufer darf beim Einreihen einen
-- `traceparent` mitgeben, dessen Spur-Id und Span-Id auf der **ersten** Station
-- liegen. Die Nachrichten-Id endet an der QKERN-Grenze; wer QKERN zwischen
-- anderen Diensten betreibt, haengt seine Spur so an. Mehr als die Kopfzeile am
-- Rand kostet es nicht: Kein Pfad in QKERN entscheidet etwas an diesen beiden
-- Spalten, und fehlen sie, traegt die Spur sich weiter selbst.
--
-- ## Kein Fremdschluessel auf die Nachricht, und das ist der Zweck
--
-- `project_queue_messages` wird aufgeraeumt: `cleanup()` loescht erledigte
-- Nachrichten nach `retention_seconds`, und der Loeschwaechter aus 0026 laesst
-- das zu. Eine Spur mit `ON DELETE CASCADE` an der Nachricht waere damit genau
-- dann weg, wenn sie das Einzige ist, was von der Nachricht noch erzaehlen
-- kann. Die Spur haengt darum an der **Queue** und nicht an der Nachricht, und
-- sie hat eine eigene Frist (siehe unten). Der Preis steht hier, damit ihn
-- niemand suchen muss: Eine Spur kann auf eine Nachrichten-Id zeigen, die es
-- nicht mehr gibt. Das ist richtig so; eine Spur ist ein Protokoll, keine
-- Beziehung.
--
-- ## Kein Inhalt
--
-- Keine Nutzlast, kein Dedupe-Verifikator, kein Lease-Token, keine
-- Fehlermeldung. Was hier steht, sind Zeitpunkte, feste Codes, die
-- Wirt-Kennung und Zaehler. Dieselbe Haltung wie im Aufrufprotokoll der
-- Functions (0045: "Nur feste Codes, nie eine Meldung") und im Zustellstatus
-- der Webhooks. Ein Payload gehoert nicht in eine Logflaeche, und die Grenze
-- ist hier keine Absicht im Code, sondern eine fehlende Spalte.
CREATE TABLE project_queue_message_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  queue_id uuid NOT NULL,
  -- Keine Beziehung: siehe den Kommentar oben. Die Nachricht darf vor ihrer
  -- Spur verschwinden, und die Spur bleibt lesbar.
  message_id uuid NOT NULL,
  -- Die Ordnung der Spur. Zwei Stationen koennen denselben Zeitstempel tragen
  -- (eine eingespeiste Uhr im Fall tut das), und eine Spur, deren Reihenfolge
  -- von der Uhr abhaengt, ist keine Spur. Dieselbe Lage wie bei der
  -- Audit-Kette aus 0047, und dieselbe Antwort: eine eigene Ordnung.
  sequence integer NOT NULL CHECK (sequence BETWEEN 1 AND 64),
  station text NOT NULL CHECK (station IN (
    'enqueued', 'deduplicated', 'replayed', 'claimed',
    'completed', 'retry_scheduled', 'dead_lettered', 'lease_expired')),
  attempt integer NOT NULL CHECK (attempt BETWEEN 0 AND 20),
  worker_id text CHECK (worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  -- Nur feste Codes, nie eine Meldung (0045).
  failure_code text CHECK (failure_code IN (
    'HANDLER_ERROR', 'HANDLER_TIMEOUT', 'DEPENDENCY_UNAVAILABLE',
    'INVALID_PAYLOAD', 'LEASE_EXPIRED')),
  -- Der Anschluss nach draussen, W3C Trace Context in seiner Hex-Schreibweise.
  -- Die beiden Nullspuren der Spezifikation sind ausgeschlossen: Eine Spur-Id
  -- aus Nullen ist nach W3C ungueltig, und sie anzunehmen hiesse, einen
  -- kaputten Kopf als Spur auszugeben.
  trace_id text CHECK (trace_id ~ '^[0-9a-f]{32}$' AND trace_id <> repeat('0', 32)),
  parent_span_id text CHECK (parent_span_id ~ '^[0-9a-f]{16}$' AND parent_span_id <> repeat('0', 16)),
  -- Die Dead-Letter-Nachricht, aus der diese entstanden ist. Traegt die
  -- Station `replayed`, und nur sie: Darueber laeuft die Spur einer
  -- wiedereingereihten Nachricht in beide Richtungen.
  source_message_id uuid,
  occurred_at timestamptz NOT NULL,
  -- Die eigene Frist. Siehe `trace.ts`: geschnitten wird hier und nie am
  -- Ausgang der Nachricht. Wer sie durchsetzt, steht weiter unten bei den
  -- Triggern, und warum es kein Trigger ist, steht da auch.
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (organization_id, project_id, environment, queue_id)
    REFERENCES project_queues (organization_id, project_id, environment, id)
    ON DELETE CASCADE,
  CONSTRAINT project_queue_message_traces_order_key
    UNIQUE (organization_id, project_id, environment, message_id, sequence),
  -- Die Frist liegt hinter dem Ereignis. Eine Zeile, die im Augenblick ihres
  -- Entstehens schon abgelaufen ist, waere eine Station, die der Aufraeumer
  -- wegnimmt, bevor sie jemand sieht.
  CONSTRAINT project_queue_message_traces_expiry CHECK (expires_at > occurred_at),
  -- Eine Station mit Wirt ist eine, die ein Worker ausgeloest hat. Beim
  -- Einstellen, beim Dedupe-Treffer und beim Wiedereinreihen gibt es keinen,
  -- und eine erfundene Kennung waere dort schlimmer als keine.
  CONSTRAINT project_queue_message_traces_worker_shape CHECK (
    (station IN ('enqueued', 'deduplicated', 'replayed') AND worker_id IS NULL) OR
    (station IN ('claimed', 'completed', 'retry_scheduled', 'dead_lettered', 'lease_expired')
      AND worker_id IS NOT NULL)),
  -- Ein Ausgang mit Grund traegt genau dann einen Code, wenn er einer ist.
  CONSTRAINT project_queue_message_traces_failure_shape CHECK (
    (station IN ('retry_scheduled', 'dead_lettered') AND failure_code IS NOT NULL) OR
    (station = 'lease_expired' AND failure_code = 'LEASE_EXPIRED') OR
    (station IN ('enqueued', 'deduplicated', 'replayed', 'claimed', 'completed')
      AND failure_code IS NULL)),
  -- Der Anschluss nach draussen entsteht beim Einstellen und nie spaeter: Eine
  -- Spur, die auf Station sieben eine fremde Spur-Id dazubekommt, waere ab
  -- dort eine andere Spur. Eine Eltern-Span ohne Spur ist nach W3C nichts.
  CONSTRAINT project_queue_message_traces_trace_anchor CHECK (
    (sequence = 1 OR (trace_id IS NULL AND parent_span_id IS NULL)) AND
    (trace_id IS NOT NULL OR parent_span_id IS NULL)),
  -- Die Herkunft gehoert zum Wiedereinreihen und sonst nirgends hin.
  CONSTRAINT project_queue_message_traces_source_shape CHECK (
    (station = 'replayed' AND source_message_id IS NOT NULL AND source_message_id <> message_id) OR
    (station <> 'replayed' AND source_message_id IS NULL))
);

-- Eine Spur lesen: das deckt der UNIQUE-Index oben ab.
-- Der Aufraeumer sucht je Queue nach allem, was abgelaufen ist, haeppchenweise.
-- Ohne diesen Index waere jede Runde ein Seq Scan ueber die ganze Tabelle, also
-- genau die Last, die ein Aufraeumer vermeiden soll (die Lehre aus 0063).
CREATE INDEX project_queue_message_traces_expiry_idx
  ON project_queue_message_traces (organization_id, project_id, environment, queue_id, expires_at);
-- Die Spur vorwaerts: Welche Nachricht ist aus diesem Dead Letter entstanden.
CREATE INDEX project_queue_message_traces_source_idx
  ON project_queue_message_traces (organization_id, project_id, environment, source_message_id)
  WHERE source_message_id IS NOT NULL;

-- Append-only. Eine Station ist ein Ereignis, das stattgefunden hat; sie laesst
-- sich nicht umschreiben. Kein UPDATE-Recht, keine UPDATE-Policy, und der
-- Trigger faengt auch den, der sich beides nachtraeglich gibt. 0045 haelt es
-- genauso, kommt dort aber ohne Trigger aus, weil dort auch kein DELETE
-- vergeben ist; hier muss eines sein, damit die Frist wirkt.
CREATE OR REPLACE FUNCTION qkern_reject_project_queue_trace_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'a project queue trace station is append-only' USING ERRCODE = '55000';
END;
$$;

-- ## Warum hier **kein** Loeschwaechter steht
--
-- Der naheliegende Riegel waere einer wie `qkern_validate_project_queue_message_delete`
-- aus 0026: ein BEFORE-DELETE-Trigger, der eine Zeile nur gehen laesst, wenn
-- `expires_at` vorbei ist. Er gehoert hier nicht hin, und zwar aus einem Grund,
-- der kein Geschmack ist.
--
-- Ein solcher Trigger kann nur `clock_timestamp()` fragen, also die Uhr des
-- Servers. Der Aufraeumer dagegen rechnet mit der Uhr des Dienstes, und die ist
-- einspeisbar: Genau darueber laesst sich eine Frist von einem Tag ueberhaupt
-- pruefen, ohne einen Tag zu warten. Beides zusammen heisst: Jede Pruefung der
-- Frist scheitert am Riegel, und ein Riegel, den kein Fall ausloesen kann, ist
-- ein Riegel, den kein Fall belegen kann. Bei `project_queue_messages` ist das
-- schon so, und dort kostet es: Eine Nachricht laesst sich nur wegraeumen, wenn
-- ihr Ausgang auch auf der Serveruhr lange genug zurueckliegt.
--
-- Die Frist steht darum dort, wo 0063 sie auch hingelegt hat: in der Begruendung
-- des Aufraeumers (`projectQueueTraceRetentionSeconds` in `trace.ts`) und in dem
-- Fall, der sie prueft. 0063 schreibt es fuer die Reihenfolge seiner Loeschungen
-- genauso hin: "Das Recht allein sagt das nicht; der Fall sagt es, und er faellt,
-- wenn es jemand umdreht." Hier ist es Fall `(2.122)`.
CREATE TRIGGER project_queue_message_traces_append_only
  BEFORE UPDATE ON project_queue_message_traces FOR EACH ROW
  EXECUTE FUNCTION qkern_reject_project_queue_trace_update();

ALTER TABLE project_queue_message_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_queue_message_traces FORCE ROW LEVEL SECURITY;

CREATE POLICY project_queue_message_traces_select ON project_queue_message_traces
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_queue_message_traces_insert ON project_queue_message_traces
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_queue_message_traces_delete ON project_queue_message_traces
  FOR DELETE USING (organization_id = qkern_current_organization_id());

REVOKE ALL ON project_queue_message_traces
  FROM PUBLIC, qkern_worker, qkern_provisioner, qkern_auth;
REVOKE ALL ON FUNCTION qkern_reject_project_queue_trace_update() FROM PUBLIC;

-- Dieselbe Rolle, die die Nachrichten schreibt, und keine zweite. Ein
-- Aufraeumer mit eigener Rolle an dieser Tabelle waere eine groessere
-- Aenderung an der Queue-Grenze als der Zweck hergibt (die Begruendung aus
-- 0063, dort fuer die andere Richtung).
GRANT SELECT, INSERT, DELETE ON project_queue_message_traces TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_reject_project_queue_trace_update() TO qkern_runtime;

COMMIT;
