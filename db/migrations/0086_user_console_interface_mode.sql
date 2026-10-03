BEGIN;

-- Der Oberflaechenmodus (2.134), je Person.
--
-- Die Console hat seit 2.134 zwei Anordnungen derselben 99 Ansichten: `easy`
-- mit neun Gruppen und zugeklappten Abschnitten, `advanced` mit der
-- vollstaendigen Navigation. Welche jemand sieht, ist eine Vorliebe wie die
-- Sprache und die Zeitzone, und sie gehoert darum in dieselbe Zeile und nicht
-- an das Projekt: Wer in zwei Projekten arbeitet, will nicht in jedem einzeln
-- umstellen.
--
-- Der Vorgabewert ist `easy`, und das ist die einzige Vorgabe dieser Tabelle,
-- die das Verhalten gegenueber vorher aendert. Vor 2.134 gab es nur die
-- vollstaendige Navigation. Wer sie weiter will, stellt einmal um, und die
-- Zeile bleibt.
--
-- Der CHECK wiederholt die Auswahl aus `lib/console/display-settings`, aus
-- demselben Grund wie bei den Nachbarspalten: Die Grenze soll auch dann noch
-- halten, wenn der Dienst daneben einen Fehler hat.

ALTER TABLE user_console_settings
  ADD COLUMN interface_mode text NOT NULL DEFAULT 'easy'
    CHECK (interface_mode IN ('easy', 'advanced'));

GRANT SELECT (interface_mode),
      INSERT (interface_mode),
      UPDATE (interface_mode)
  ON user_console_settings TO qkern_auth;

COMMIT;
