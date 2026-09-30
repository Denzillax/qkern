BEGIN;

-- Die sechste Quelle eines Log-Drains (2.108): die Inhaltslogs je Aufruf.
--
-- ## Warum die Quelle bis jetzt fehlte
--
-- 0054 hat die Liste der Quellen als IMMUTABLE Funktion in die Datenbank
-- gelegt, mit fuenf Namen und der Grenze `cardinality BETWEEN 1 AND 5`. Das
-- war der ganze Bestand an gespeicherten Logs. 0069 hat danach die Inhaltslogs
-- angelegt -- was ein Function-Container auf stdout und stderr geschrieben hat,
-- mit harten Grenzen je Aufruf -- und die Console zeigt sie seit derselben
-- Ausgabe. Weiterleiten liess sich das nicht: Die Liste hier kannte den Namen
-- nicht, und ein Betreiber, der seine Container-Ausgabe im SIEM sehen wollte,
-- hatte keinen Weg dorthin.
--
-- ## Was sich aendert und was nicht
--
-- Nur diese Funktion. Keine neue Tabelle, keine neue Spalte, kein neues Recht:
-- `qkern_runtime` hat auf `project_function_invocation_output` seit 0069
-- SELECT, und die Policy dort begrenzt die Sicht wie ueberall auf
-- `qkern_current_organization_id()`. Der Sammler liest mit genau diesem Recht.
--
-- Die Reihenfolge wird weiter mitgeprueft, und `function_output` steht am Ende
-- der Liste. Damit bleibt jede vorhandene Zeile gueltig: Eine Definition, die
-- gestern `['auth_audit','usage_series']` hielt, haelt heute dasselbe, und der
-- Vergleich gegen die geordnete Liste fuehrt zum selben Ergebnis. Ein Name
-- mitten in der Liste haette jede Zeile mit spaeteren Quellen ungueltig
-- gemacht, ohne dass ein CHECK sie noch einmal ansieht -- ein Zustand, den
-- erst das naechste UPDATE entdeckt haette, und UPDATE gibt es hier nicht.
--
-- ## Was die Quelle traegt
--
-- Eine Zeile je Ausgabezeile, nicht je Aufruf: Zeitpunkt, Strom, Text, die
-- Markierung fuer eine gekuerzte Zeile, die Aufrufkennung und die beiden
-- Angaben, ob dem Aufruf etwas fehlt. Was hinausgeht, entscheidet weiter
-- allein die Whitelist in `lib/console/log-drains`; diese Migration nennt
-- keine Felder, weil sie keine Spalte dafuer hat, und das ist seit 0054 der
-- Punkt.
--
-- ## Die eigene Grenze der Menge
--
-- 0069 laesst 500 Zeilen und 64 KiB je Aufruf zu. Bei der bisherigen
-- Lesegrenze von 200 Zeilen je Lauf waeren das 12,8 MiB in einer einzigen
-- Ladung -- kein Empfaenger nimmt das an, und die Outbox trueg es als eine
-- unteilbare Zustellung mit sich herum. Deshalb hat diese Quelle eine eigene
-- Grenze: hoechstens vier Aufrufe je Lauf, also hoechstens 256 KiB. Die Zahl
-- steht in `lib/console/log-drains.ts` und in jedem Text, den die Console
-- ueber diese Quelle zeigt.
CREATE OR REPLACE FUNCTION qkern_log_drain_sources_ok(sources text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT sources IS NOT NULL
     AND cardinality(sources) BETWEEN 1 AND 6
     AND sources = ARRAY(
       SELECT allowed.source
         FROM unnest(ARRAY['auth_audit', 'function_invocations', 'storage_objects',
                           'webhook_deliveries', 'usage_series', 'function_output'])
              WITH ORDINALITY AS allowed(source, nth)
        WHERE allowed.source = ANY (sources)
        ORDER BY allowed.nth)
$$;

-- CREATE OR REPLACE behaelt die Rechte einer vorhandenen Funktion, aber diese
-- Zeilen stehen trotzdem hier: Ein Lauf auf einer Datenbank, die 0054 nicht
-- kannte, soll dasselbe Ergebnis haben wie einer auf einer, die sie kannte.
REVOKE ALL ON FUNCTION qkern_log_drain_sources_ok(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qkern_log_drain_sources_ok(text[]) TO qkern_runtime;

COMMIT;
