-- Eine Zeitzone je Cron-Zeitplan (2.66).
--
-- Bis 2.65 rechnete jeder Zeitplan in UTC, und die Spalte gab es nicht. Wer
-- "jeden Tag um zwei" meinte, musste die Sommerzeit selbst umrechnen und den
-- Plan zweimal im Jahr neu anlegen. Jetzt traegt der Zeitplan seinen
-- IANA-Namen; der Dienst prueft ihn mit `Intl`, die Datenbank haelt nur die
-- Laenge klein.
--
-- `DEFAULT 'UTC'` ist die Zusage an jeden bestehenden Zeitplan: Er rechnet
-- nach der Migration genau wie vorher, und sein Dedupe-Schluessel
-- `cron:<id>:<zeitpunkt>` bleibt derselbe. Ein anderer Vorgabewert liesse jede
-- vorhandene Definition nach dem Deploy ein zweites Mal feuern.
--
-- Bewusst nicht im UPDATE-Recht der Laufzeitrolle: Wie Ausdruck, Queue und
-- Nutzlast ist die Zeitzone Teil dessen, was der Plan bedeutet. Eine Aenderung
-- ist Loeschen und Neuanlegen (0031).

ALTER TABLE project_cron_definitions
  ADD COLUMN time_zone text NOT NULL DEFAULT 'UTC'
    CHECK (char_length(time_zone) BETWEEN 1 AND 64);
