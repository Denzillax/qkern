BEGIN;

-- Bereiche fuer die Werkzeuge, die keinen hatten.
--
-- ## Was hier geaendert wird, und warum es eine Migration braucht
--
-- Nichts an der Gestalt: keine Tabelle, keine Spalte, kein Index. Geaendert
-- werden vier CHECK-Bedingungen, und zwar die, die die Liste der erlaubten
-- Bereiche als Muster hinschreiben. Migration 0062 hat sie mit drei Bereichen
-- angelegt (`project_auth_oauth_clients`, `_codes`, `_tokens`), Migration 0064
-- mit denselben drei fuer die Zustimmungen. Die Liste steht dort absichtlich
-- zweimal: in der Datenbank und in `lib/server/project-auth/oauth.ts`, weil die
-- Datenbank nicht darauf vertrauen soll, dass jeder Schreiber durch den Dienst
-- kommt, und der Dienst nicht darauf, dass jede Zeile durch diesen CHECK
-- gekommen ist. Wer einen Bereich hinzufuegt und nur die eine Stelle anfasst,
-- bekommt eine Zustimmung, die der Dienst annimmt und die Datenbank abweist.
--
-- ## Die Luecke, die das schliesst
--
-- Der entfernte MCP-Server (2.91) hat vier Werkzeuge nach Bereichen freigegeben
-- und zwoelf fuer eine OAuth-Sitzung gar nicht erst angemeldet, weil es keinen
-- Bereich gab, der sie beschreibt. Das war kein Schutz, sondern eine
-- Unerreichbarkeit, und `docs/PARITAET.md` hat sie als Luecke gefuehrt.
--
-- Sechs Bereiche kommen dazu, und jeder sagt genau einen Satz:
--
-- * `project:read`     Gestalt dieser Projektumgebung aus der Control Plane,
--                      ohne Zugangsdaten, plus die geltende
--                      Automatisierungsregel mit ihrer Risikogrenze.
-- * `storage:read`     Buckets mit festen Zugriffsregeln, Kontingenten und
--                      Verbrauch, sowie begrenzte Objektmetadaten. Kein Inhalt.
-- * `queues:read`      Queue-Definitionen und Zaehler je Nachrichtenzustand.
--                      Keine Nachrichteninhalte.
-- * `queues:write`     Einstellen einer Nachricht, und nur das. Keine
--                      Worker-Operation: kein Claim, kein Lease, kein Renewal,
--                      kein Abschluss.
-- * `logs:read`        Suche im begrenzten, redigierten Audit-Log dieser
--                      Projektumgebung.
-- * `migrations:propose` Anlegen einer unveraenderlichen Migrationsvorschau.
--                      Kein Anwenden.
--
-- Was nicht dazukommt und warum:
--
-- * **`storage:write`**: Es gibt kein schreibendes Storage-Werkzeug im
--   MCP-Server, und die HTTP-Tueren von Storage nehmen ein OAuth-Token
--   weiterhin nicht an. Ein Bereich, den niemand prueft, ist eine Beschriftung,
--   und auf einer Zustimmungsseite ist eine Beschriftung schlimmer als ein
--   fehlender Eintrag: Der Nutzer liest eine Grenze, die nirgends gilt.
-- * **`migrations:apply`**: Ein Anwenden ueber einen fremden Client bleibt die
--   Tuer, die niemand will. Es faellt nicht unter `migrations:propose`, und es
--   bekommt hier auch keinen eigenen Bereich; das waere eine eigene
--   Entscheidung mit eigener Widerrufsflaeche und eigenem Fall.
--
-- ## Warum die Obergrenze mitwaechst
--
-- `array_length(scopes, 1) BETWEEN 1 AND 3` war die Zahl der Bereiche, nicht
-- eine Begrenzung mit eigenem Grund. Sie wird 9, also wieder die Zahl der
-- Bereiche. Eine Obergrenze unter dieser Zahl wuerde einen Client verbieten,
-- der alles darf, was es gibt, und das ist eine Entscheidung, die der Betreiber
-- trifft und nicht die Tabelle.
--
-- ## Warum ein DROP und ein ADD, und kein zweiter CHECK daneben
--
-- Ein zweiter CHECK neben dem alten waere eine UND-Verknuepfung: Der alte laesst
-- `storage:read` nicht durch, und keine Fassung des neuen aendert das. Die
-- Bedingung muss ersetzt werden, und sie behaelt ihren Namen, damit ein Leser
-- der Tabelle eine Bedingung je Frage findet und nicht zwei mit Jahresringen.
--
-- Bestehende Zeilen bleiben gueltig: Die neue Menge enthaelt die alten drei, das
-- Muster ist echt weiter, und PostgreSQL prueft beim ADD CONSTRAINT alle Zeilen.
-- Ein Fehler hier waere also ein Fehler in dieser Migration und nicht in den
-- Daten.

-- Ein Ausdruck, viermal derselbe. Er steht viermal hin und nicht in einer
-- Funktion: Eine Funktion in einem CHECK ist an dieser Stelle eine Abhaengigkeit,
-- die ein pg_dump mitschleppen muss, und sie liesse sich spaeter aendern, ohne
-- dass an der Tabelle etwas sichtbar waere. Vier gleiche Zeilen sind
-- langweiliger und ehrlicher.

ALTER TABLE project_auth_oauth_clients
  DROP CONSTRAINT project_auth_oauth_clients_scope_check;
ALTER TABLE project_auth_oauth_clients
  ADD CONSTRAINT project_auth_oauth_clients_scope_check CHECK (
    array_length(scopes, 1) BETWEEN 1 AND 9 AND
    array_to_string(scopes, ' ') ~ (
      '^(identity:read|data:read|data:write|project:read|storage:read' ||
      '|queues:read|queues:write|logs:read|migrations:propose)' ||
      '( (identity:read|data:read|data:write|project:read|storage:read' ||
      '|queues:read|queues:write|logs:read|migrations:propose))*$'
    )
  );

ALTER TABLE project_auth_oauth_codes
  DROP CONSTRAINT project_auth_oauth_codes_scope_check;
ALTER TABLE project_auth_oauth_codes
  ADD CONSTRAINT project_auth_oauth_codes_scope_check CHECK (
    array_length(scopes, 1) BETWEEN 1 AND 9 AND
    array_to_string(scopes, ' ') ~ (
      '^(identity:read|data:read|data:write|project:read|storage:read' ||
      '|queues:read|queues:write|logs:read|migrations:propose)' ||
      '( (identity:read|data:read|data:write|project:read|storage:read' ||
      '|queues:read|queues:write|logs:read|migrations:propose))*$'
    )
  );

ALTER TABLE project_auth_oauth_tokens
  DROP CONSTRAINT project_auth_oauth_tokens_scope_check;
ALTER TABLE project_auth_oauth_tokens
  ADD CONSTRAINT project_auth_oauth_tokens_scope_check CHECK (
    array_length(scopes, 1) BETWEEN 1 AND 9 AND
    array_to_string(scopes, ' ') ~ (
      '^(identity:read|data:read|data:write|project:read|storage:read' ||
      '|queues:read|queues:write|logs:read|migrations:propose)' ||
      '( (identity:read|data:read|data:write|project:read|storage:read' ||
      '|queues:read|queues:write|logs:read|migrations:propose))*$'
    )
  );

ALTER TABLE project_auth_oauth_consents
  DROP CONSTRAINT project_auth_oauth_consents_scope_check;
ALTER TABLE project_auth_oauth_consents
  ADD CONSTRAINT project_auth_oauth_consents_scope_check CHECK (
    array_length(scopes, 1) BETWEEN 1 AND 9 AND
    array_to_string(scopes, ' ') ~ (
      '^(identity:read|data:read|data:write|project:read|storage:read' ||
      '|queues:read|queues:write|logs:read|migrations:propose)' ||
      '( (identity:read|data:read|data:write|project:read|storage:read' ||
      '|queues:read|queues:write|logs:read|migrations:propose))*$'
    )
  );

-- Die Unveraenderlichkeit der Scope-Spalten bleibt, wie sie ist: Die Trigger aus
-- 0024 haengen an den Tabellen und nicht an diesen Bedingungen. Ein Bereich, der
-- neu erlaubt ist, laesst sich damit an einer bestehenden Zustimmung trotzdem
-- nicht nachtragen, und das ist richtig: Eine Zustimmung mit mehr Bereichen ist
-- eine neue Zeile, und der Nutzer hat sie erteilt.

COMMIT;
