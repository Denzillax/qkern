BEGIN;

-- Der Anschluss wird weitergegeben (2.124, 2.125).
--
-- ## Der offene Punkt aus 2.72.0, woertlich
--
-- `trace.ts` fuehrt ihn selbst unter "Offen": "QKERN gibt keinen `traceparent`
-- weiter. Der Anschluss kommt herein und steht in der Spur; ein Worker, der eine
-- Nachricht verarbeitet, bekommt ihn im Claim nicht mitgeliefert, und ein
-- Webhook, der danach feuert, traegt ihn nicht. Das ist der naechste Schritt und
-- nicht dieser: Er braucht eine eigene Span-Id je Station und damit eine
-- Entscheidung darueber, wer in QKERN Spans erzeugt."
--
-- Diese Migration trifft genau diese Entscheidung, und zwar in zwei Haelften
-- derselben Sache. Darum eine Migration und nicht zwei: Eine Span-Id ohne einen
-- Weg nach draussen waere eine Spalte, die niemand liest, und ein Weg nach
-- draussen ohne Span-Id haette nichts zu tragen.
--
-- ## Haelfte eins: QKERN erzeugt Spans, eine je Station
--
-- **Wer erzeugt sie: QKERN, beim Schreiben der Station.** Eine Station ist ein
-- Ereignis mit Anfang und Ende; in W3C-Sprache ist das ein Span. Es gab drei
-- Kandidaten, und zwei fallen aus:
--
-- 1. *Der Aufrufer liefert sie mit.* Er kann nicht: Die Stationen `claimed`,
--    `completed`, `retry_scheduled`, `dead_lettered` und `lease_expired`
--    entstehen Minuten bis Tage nach seiner Anfrage, teils auf einem Wirt, den
--    es beim Einreihen noch nicht gab, teils (bei `lease_expired`) ohne dass
--    irgendwer etwas aufruft.
-- 2. *Abgeleitet aus den Koordinaten der Zeile*, etwa als Hash aus
--    `message_id` und `sequence`. Spart diese Spalte und faellt an zwei
--    Stellen: Erstens ist `message_id` ein Wert, den QKERN dem Aufrufer in der
--    Quittung herausgibt. Wer ihn hat, koennte jede Span-Id von QKERN
--    nachrechnen und sich als Kind in eine fremde Spur haengen. Eine Span-Id
--    muss nicht geheim sein, aber sie darf auch nicht geraten werden koennen.
--    Zweitens ist `sequence` nicht fuer immer eindeutig: Der Aufraeumer loescht
--    abgelaufene Stationen, `recordTrace` rechnet die naechste Nummer aus
--    `max(sequence)`, und damit kann eine Nummer nach einem Schnitt ein zweites
--    Mal vorkommen. Eine abgeleitete Id waere dann dieselbe wie die einer Span,
--    die ein Collector draussen schon aufgezeichnet hat.
-- 3. **Gewaehlt: acht Zufallsbytes beim Schreiben, in dieser Spalte.** Eine
--    Span-Id ist die Identitaet eines Ereignisses und keine Funktion seiner
--    Koordinaten. Sie muss gespeichert werden, weil der Claim sie in einer
--    anderen Anfrage als dem Einreihen herausgibt und der Leser der Spur sie
--    Wochen spaeter noch zeigen koennen muss.
--
-- `NOT NULL` fuer **jede** Station, auch fuer eine Nachricht ohne Anschluss nach
-- draussen. Eine Station ist ein Span, ob jemand danach fragt oder nicht, und
-- eine Spalte, deren Bedeutung von einer anderen Spalte abhaengt, ist eine
-- Spalte, die man zweimal erklaeren muss.
--
-- ## Was QKERN **nicht** anlegt: eine eigene Spur-Id
--
-- Eine Nachricht, die ohne `traceparent` eingereiht wurde, bekommt keine
-- erfundene `trace_id`, und ihr Claim traegt keinen `traceparent`. Der Grund ist
-- nicht Sparsamkeit: Eine von QKERN erfundene Spur-Id waere eine Spur mit genau
-- einem Teilnehmer. Kein Dienst draussen hat je in sie hineingemeldet, kein
-- Collector kennt ihre Wurzel, und ein Worker, der sie weiterreicht, baut einen
-- Baum ohne Stamm. Schlimmer: In der Antwort der Trace-Route waere sie von einem
-- echten Anschluss nicht zu unterscheiden, und damit koennte ein Betreiber nicht
-- mehr lesen, ob sein Aufrufer die Spur angehaengt hat oder ob QKERN sich eine
-- gedacht hat. Der Anschluss bleibt leer, und leer heisst hier: Es gab keinen.
--
-- Die Spalte `trace_id` bleibt deshalb unveraendert an Sequenz eins gebunden
-- (`project_queue_message_traces_trace_anchor` aus 0081), und `span_id` tritt
-- ausdruecklich **nicht** in diesen CHECK ein.
--
-- ## Was `trace-flags` traegt: `01`, und warum keine Spalte dafuer
--
-- QKERN speichert die Flags des Aufrufers nicht und gibt immer `01` (sampled)
-- heraus. Nach W3C beschreiben die Flags die Span, die im `traceparent` **steht**
-- und das ist hier die eigene Station von QKERN, nicht die Span des Aufrufers. Diese
-- Station ist aufgezeichnet, immer und unabhaengig davon, was draussen
-- entschieden wurde: `project_queue_message_traces` wird bei jedem
-- Zustandswechsel geschrieben, in derselben Transaktion, ohne Sampling. `00` zu
-- melden hiesse dem naechsten Dienst zu sagen, es sei nichts aufgeschrieben,
-- waehrend es das ist. Dieselbe Begruendung steht seit 2.72.0 an
-- `formatProjectQueueTraceparent`.
--
-- Der Preis, damit ihn niemand suchen muss: Wer draussen am Kopf der Kette
-- `00` setzt, um eine Spur gar nicht aufzuzeichnen, bekommt sie hinter QKERN
-- wieder eingeschaltet. Eine Spalte `trace_flags` waere die Alternative; sie
-- scheitert an der Regel, die 0081 fuer `trace_id` und `parent_span_id`
-- aufgeschrieben hat: "Kein Pfad in QKERN entscheidet etwas an diesen beiden
-- Spalten." Fuer die Flags waere das noch schaerfer: kein Pfad **koennte** an
-- ihnen etwas entscheiden, weil QKERN ohnehin immer schreibt. Eine Spalte, die
-- nur durchgereicht wird, ist eine Spalte, die nichts weiss.
--
-- ## Was ausdruecklich nicht mitgeht: `tracestate`
--
-- Drei Gruende, jeder allein ausreichend. Erstens ist `tracestate`
-- Anbieterzustand: Jeder Anbieter haelt dort seinen eigenen Schluessel, QKERN ist
-- keiner und haette nichts hineinzuschreiben. Was bliebe, ist das Durchkopieren
-- einer fremden Zeichenkette. Zweitens ist genau das eine Nutzlast, und 0081
-- hat die Grenze nicht als Absicht im Code gezogen, sondern als fehlende Spalte:
-- "Keine Nutzlast, kein Dedupe-Verifikator, kein Lease-Token, keine
-- Fehlermeldung." Ein Freitextfeld mit 512 Byte Budget auf einer Logflaeche
-- waere der Rueckschritt. Drittens geht dieser Wert in einer Kopfzeile an einen
-- fremden Empfaenger hinaus; ein durchkopierter Blob ist die eine Stelle, an der
-- ein Geheimnis mitreisen koennte, das niemand angesehen hat.
ALTER TABLE project_queue_message_traces
  -- Der Vorgabewert ist fluechtig (`gen_random_bytes`), und das ist Absicht:
  -- PostgreSQL schreibt die Tabelle dafuer neu und wertet ihn **je Zeile** aus.
  -- Ein `UPDATE` zum Nachfuellen waere der naheliegende Weg und gaebe es hier
  -- nicht: `project_queue_message_traces_append_only` aus 0081 weist jedes
  -- UPDATE auf dieser Tabelle ab, und ein Trigger, den eine Migration umgeht,
  -- ist ein Trigger, auf den sich niemand mehr verlassen kann. Eine
  -- Tabellenumschreibung durch ALTER TABLE loest keine Zeilentrigger aus.
  --
  -- Die Zeilen aus 2.72.0 bekommen damit rueckwirkend Span-Ids. Erfunden wird
  -- dabei nichts: Vor dieser Migration gab QKERN keine Span-Id heraus, also hat
  -- keine dieser Spans je einen Collector erreicht, und eine frische Id
  -- widerspricht keiner, die draussen schon steht.
  --
  -- Der CHECK weiter unten verbietet die Nullspan. Ein Zufallswert aus acht
  -- Nullbytes wuerde diese Migration also abbrechen, und zwar mit
  -- Wahrscheinlichkeit 2^-64 je Zeile. Das bleibt so: Fehlschlagen ist die
  -- richtige Richtung (eine ungueltige Span-Id waere schlimmer als eine
  -- abgebrochene Migration), und Code gegen ein Ereignis zu schreiben, das in
  -- der Lebensdauer dieses Produkts nicht eintritt, waere ein Zweig, den kein
  -- Fall je betritt. `pgcrypto` steht seit 0001.
  ADD COLUMN span_id text NOT NULL DEFAULT encode(gen_random_bytes(8), 'hex');

-- Der Vorgabewert fliegt wieder weg. Er war fuer die vorhandenen Zeilen da, und
-- stehenlassen hiesse: Ein Schreiber, der `span_id` vergisst, bekaeme still eine
-- zufaellige. Ohne Vorgabewert ist das eine NOT-NULL-Verletzung, also laut.
ALTER TABLE project_queue_message_traces ALTER COLUMN span_id DROP DEFAULT;

-- Hexschreibweise in Kleinbuchstaben und nicht die Nullspan. Dieselbe Form und
-- dieselbe Begruendung wie bei `parent_span_id` in 0081: Die Nullspan ist nach
-- W3C ungueltig, und sie herauszugeben hiesse, einen kaputten Kopf als Anschluss
-- auszugeben.
ALTER TABLE project_queue_message_traces
  ADD CONSTRAINT project_queue_message_traces_span_shape
  CHECK (span_id ~ '^[0-9a-f]{16}$' AND span_id <> repeat('0', 16));

-- Eindeutig je Nachricht, nicht bloss wahrscheinlich eindeutig.
--
-- Acht Zufallsbytes kollidieren praktisch nie, aber "praktisch nie" ist eine
-- Hoffnung und keine Zusage. Zwei Stationen derselben Nachricht mit derselben
-- Span-Id waeren draussen eine Span, die zweimal anfaengt, und der Fall, der
-- das findet, waere der Betreiber in sechs Monaten. Die Grenze ist die Nachricht
-- und nicht die Spur-Id: Eine Nachricht ohne Anschluss hat keine Spur-Id, und
-- ihre Stationen brauchen die Zusage genauso, sobald ein Replay eine Spur-Id
-- dazubekommt.
ALTER TABLE project_queue_message_traces
  ADD CONSTRAINT project_queue_message_traces_span_key
  UNIQUE (organization_id, project_id, environment, message_id, span_id);

-- ## Haelfte zwei: der Weg nach draussen
--
-- Eine Zustellung traegt den Anschluss, aus dem sie entstanden ist, und der
-- Zusteller macht daraus die Kopfzeile `traceparent`.
--
-- **Warum das in der Datenbank steht und nicht im Prozess.** Zwischen dem
-- Einreihen einer Zustellung und ihrem Versand liegen eine Lease, ein
-- Wiederholungsplan und moeglicherweise ein Prozessneustart; `claim` kann auf
-- einer anderen Instanz laufen als `enqueue`. Ein Anschluss im Prozess waere
-- nach dem ersten verfallenen Lease weg, und der zweite Versuch derselben
-- Zustellung ginge ohne Kopfzeile hinaus. Derselbe Grund, aus dem 0081 die
-- Stationen nicht in `ProjectQueueWorkerLogger` stehen laesst.
--
-- **Dieselbe Form wie in 0081**, absichtlich bis auf den Namen gleich: Spur-Id
-- und Eltern-Span, Hex in Kleinbuchstaben, keine Nullwerte der Spezifikation,
-- und eine Eltern-Span ohne Spur ist nach W3C nichts. Eine zweite Schreibweise
-- fuer denselben Wert waere eine zweite Stelle, an der sie auseinanderlaufen
-- kann.
--
-- Eine eigene Span-Id je Zustellversuch gibt es hier **nicht**, und das ist der
-- Unterschied zur ersten Haelfte. Eine Station der Queue ist ein Ereignis, das
-- QKERN selbst beobachtet und aufschreibt; ein Zustellversuch ist ein Aufruf
-- nach draussen, und die Span, die ihn beschreibt, gehoert dem Empfaenger
-- beziehungsweise dem Collector, der beide Seiten sieht. QKERN sagt mit der
-- Kopfzeile, woran der Empfaenger sich haengen soll, und nicht, was er
-- aufschreiben soll.
ALTER TABLE project_webhook_deliveries
  ADD COLUMN trace_id text
    CHECK (trace_id ~ '^[0-9a-f]{32}$' AND trace_id <> repeat('0', 32)),
  ADD COLUMN parent_span_id text
    CHECK (parent_span_id ~ '^[0-9a-f]{16}$' AND parent_span_id <> repeat('0', 16)),
  ADD CONSTRAINT project_webhook_deliveries_trace_anchor
    CHECK (trace_id IS NOT NULL OR parent_span_id IS NULL);

-- Der Anschluss gehoert zum ausloesenden Ereignis und ist damit so
-- unveraenderlich wie die Nutzlast.
--
-- 0032 begruendet das fuer `payload` so: Waere sie veraenderlich, "koennte ein
-- Wiederholungsversuch etwas anderes senden als der erste, und die Signatur des
-- Empfaengers wuerde eine andere Nachricht bestaetigen als die ausgeloeste."
-- Fuer den Anschluss gilt dasselbe eine Ebene hoeher: Ein zweiter Versuch, der
-- eine andere Spur nennt als der erste, haengt denselben Vorgang an zwei Orte.
-- Deshalb steht die Pruefung im vorhandenen Waechter und nicht in einem zweiten
-- daneben; die Spalten sind per `IS DISTINCT FROM` verglichen, weil beide NULL
-- sein duerfen und `<>` auf NULL nichts sagt.
CREATE OR REPLACE FUNCTION qkern_validate_project_webhook_delivery_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id
     OR NEW.project_id <> OLD.project_id OR NEW.environment <> OLD.environment
     OR NEW.webhook_id <> OLD.webhook_id OR NEW.event_type <> OLD.event_type
     OR NEW.payload::text <> OLD.payload::text OR NEW.occurred_at <> OLD.occurred_at
     OR NEW.created_at <> OLD.created_at
     OR NEW.trace_id IS DISTINCT FROM OLD.trace_id
     OR NEW.parent_span_id IS DISTINCT FROM OLD.parent_span_id THEN
    RAISE EXCEPTION 'webhook delivery content is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.attempt_count < OLD.attempt_count THEN
    RAISE EXCEPTION 'webhook attempts must not move backwards' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('delivered', 'dead_lettered') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'a settled webhook delivery is final' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- Kein neues Recht und keine neue Rolle: Beide Tabellen gehoeren weiter denen,
-- die sie schon hatten, und `CREATE OR REPLACE FUNCTION` behaelt die Rechte der
-- ersetzten Funktion. Zwei Spalten mehr sind keine neue Flaeche. Der REVOKE
-- steht trotzdem hier, weil 0032 ihn auch hat und eine ersetzte Funktion ohne
-- ihn aussieht wie eine, bei der jemand es vergessen hat.
REVOKE ALL ON FUNCTION qkern_validate_project_webhook_delivery_update() FROM PUBLIC;

COMMIT;
