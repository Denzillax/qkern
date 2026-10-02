BEGIN;

-- Die Suche nach einer Spur-Id (2.131).
--
-- ## Der offene Punkt aus 2.73.0, woertlich
--
-- `trace.ts` fuehrt ihn selbst unter "Offen": "Es gibt keine Suche nach
-- Spur-Id. Gelesen wird je Nachricht. Eine Abfrage 'alle Nachrichten dieser
-- fremden Spur' braucht einen Index und eine Seitenform, und ohne einen
-- Betreiber, der sie verlangt, waere beides geraten. Mit den Span-Ids aus 2.124
-- wird die Frage haeufiger werden, denn jetzt steht QKERN in fremden Spuren
-- drin."
--
-- Der Betreiber ist jetzt da, und damit ist nichts mehr geraten. Diese
-- Migration legt den Index, den die Abfrage braucht; die Seitenform und was
-- eine Antwort traegt, entscheidet `trace.ts` und begruendet es dort.
--
-- ## Welche Spalten, in welcher Reihenfolge, und warum
--
-- Die Abfrage lautet: alle Nachrichten einer Umgebung, die an dieser fremden
-- Spur-Id haengen, in Zeitreihenfolge, haeppchenweise. Daraus faellt die
-- Reihenfolge der Spalten, und zwar ohne Spielraum:
--
-- 1. `organization_id`, `project_id`, `environment` -- **die Mandantengrenze
--    traegt der Index mit, nicht erst die Policy.** Ein Index, der mit
--    `trace_id` anfaengt, waere der kuerzeste Weg zu genau dem Fehler, den eine
--    Suche nach einem Wert von draussen aufmacht: Eine Spur-Id entsteht in einem
--    fremden Dienst, und es gibt keine Zusage, dass sie nur in einem Mandanten
--    vorkommt. Zwei Organisationen hinter demselben Gateway tragen dieselbe
--    Spur-Id, und das ist der normale Fall und nicht der Angriff. Die drei
--    Spalten stehen darum vorn, in genau der Reihenfolge, in der jeder andere
--    Index dieser Tabelle sie fuehrt (0081: Ablauf und Herkunft), damit niemand
--    zwei Reihenfolgen im Kopf halten muss.
-- 2. `trace_id` -- die Gleichheitsbedingung der Suche. Sie steht hinter dem
--    Scope und vor der Ordnung: Ein B-Tree liest eine Gleichheit vor einem
--    Bereich, und erst damit ist der Rest des Index eine zusammenhaengende
--    Strecke.
-- 3. `occurred_at`, `message_id` -- die Ordnung der Seitenform, Zeichen fuer
--    Zeichen dieselbe, die die Abfrage in `ORDER BY` schreibt. Der Keyset-Cursor
--    vergleicht genau dieses Paar, und ohne beide Spalten im Index muesste die
--    Datenbank je Seite sortieren. `message_id` ist dabei kein Schmuck, sondern
--    der Tiebreaker: Zwei Nachrichten derselben Spur koennen im selben
--    Augenblick eingereiht werden, und eine Seitenform, deren Ordnung nicht
--    eindeutig ist, zeigt eine Zeile zweimal oder keinmal.
--
-- **Ohne `queue_id`, und das ist eine Entscheidung und kein Vergessen.** Eine
-- fremde Spur laeuft durch die Umgebung und nicht durch eine Queue: Ein Auftrag
-- von draussen reiht in `orders` ein, der Worker reiht in `invoices` nach, und
-- beide Nachrichten gehoeren zu derselben Spur. Eine Suche je Queue haette genau
-- die Frage nicht beantwortet, die gestellt wird. `queue_id` steht darum nicht
-- im Index; die Antwort nennt je Nachricht ihre Queue, und die kommt aus dem
-- Verbund mit `project_queues`.
--
-- **Teilindex auf `trace_id IS NOT NULL`.** Der Anschluss liegt nach
-- `project_queue_message_traces_trace_anchor` (0081) ausschliesslich auf
-- Sequenz eins. Von acht bis vierundsechzig Stationen einer Nachricht traegt
-- also genau eine einen Wert, und die Nachrichten ohne `traceparent` tragen gar
-- keinen. Ein voller Index haette fuer jede Station eine Zeile, deren
-- Schluessel NULL ist -- Last beim Schreiben jeder Station, Nutzen bei keiner
-- Abfrage. Der Teilindex ist damit zugleich die Zusage, die die Antwort braucht:
-- Je Nachricht gibt es hoechstens eine Zeile in diesem Index, also liefert die
-- Suche je Nachricht hoechstens eine Zeile, ohne DISTINCT und ohne Gruppierung.
--
-- ## Kein zweiter Index auf `span_id`
--
-- Der naheliegende Nachbar waere eine Suche "welche Station war diese Span-Id",
-- denn ein Betreiber sieht in seinem Collector Span-Ids von QKERN (0082). Er
-- steht hier nicht, und zwar aus demselben Grund, aus dem dieser Index jetzt
-- erst kommt: Verlangt hat ihn niemand. `project_queue_message_traces_span_key`
-- aus 0082 ist ein UNIQUE ueber
-- `(organization_id, project_id, environment, message_id, span_id)` und traegt
-- `message_id` vor `span_id`; eine Suche nur nach der Span-Id koennte ihn also
-- nicht lesen. Das steht unter "Offen" in `trace.ts` und nicht als Spalte hier.
CREATE INDEX project_queue_message_traces_trace_idx
  ON project_queue_message_traces
    (organization_id, project_id, environment, trace_id, occurred_at, message_id)
  WHERE trace_id IS NOT NULL;

-- Keine neue Flaeche, keine neue Rolle, kein neues Recht: Ein Index ist eine
-- Lesehilfe auf einer Tabelle, die ihre Policies und ihre Rechte seit 0081 hat.
-- Die Suche laeuft durch dieselbe Lesepolicy wie das Lesen je Nachricht
-- (`project_queue_message_traces_select`), und der Verbund auf `project_queues`
-- durch deren eigene. Dass die Grenze damit wirklich haelt und nicht nur von
-- einer Bedingung im Code, ist Fall `(2.131)`.

COMMIT;
