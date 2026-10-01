BEGIN;

-- Der Bereich `storage:write`, jetzt mit einem Werkzeug, das ihn prueft.
--
-- ## Was hier geaendert wird
--
-- Nichts an der Gestalt: keine Tabelle, keine Spalte, kein Index. Geaendert
-- werden dieselben vier CHECK-Bedingungen, die Migration 0073 mit neun Bereichen
-- geschrieben hat (`project_auth_oauth_clients`, `_codes`, `_tokens`,
-- `_consents`). Die Liste steht absichtlich zweimal, in der Datenbank und in
-- `lib/server/project-auth/oauth.ts`: Die Datenbank soll nicht darauf
-- vertrauen, dass jeder Schreiber durch den Dienst kommt, und der Dienst nicht
-- darauf, dass jede Zeile durch diesen CHECK gekommen ist. Wer einen Bereich
-- hinzufuegt und nur die eine Stelle anfasst, bekommt eine Zustimmung, die der
-- Dienst annimmt und die Datenbank abweist.
--
-- ## Warum er jetzt kommt und in 0073 nicht
--
-- 0073 hat ihn ausdruecklich weggelassen, und die Begruendung stand dort: Es gab
-- kein schreibendes Storage-Werkzeug im MCP-Server, ein Bereich, den niemand
-- prueft, ist eine Beschriftung, und auf einer Zustimmungsseite ist eine
-- Beschriftung schlimmer als ein fehlender Eintrag. Er sollte mit dem Werkzeug
-- kommen, das ihn braucht.
--
-- Das Werkzeug ist `qkern_storage_object_delete`, und es loescht ein Objekt in
-- einem Bucket dieser Projektumgebung. Es ist kein Hochladen: Ein Hochladen ist
-- bei QKERN Reservierung, Bytes beim Anbieter und Abschluss mit Pruefsumme und
-- Scan, und der Schritt mit den Bytes gehoert nicht in einen Modellkontext. Es
-- ist auch kein Bucket: Anlegen, Aendern und Entfernen eines Buckets verlangen
-- die Betreiberrolle und stehen in der Werkzeugtabelle nicht.
--
-- ## Die Decke, die dieser Bereich mitbringt
--
-- Das Loeschwerkzeug laeuft ueber OAuth mit `authenticated` und der Kennung des
-- zustimmenden Nutzers. Die beiden lesenden Storage-Werkzeuge laufen weiterhin
-- mit `role: "admin"` im Namen des Betreibers; dieses hier tut es nicht. Damit
-- entscheidet die Schreibregel des Buckets wirklich: `owner` gibt nur die
-- Objekte dieses Nutzers her, `private` keines. Bei einem Lesen war die Betreiberrolle eine
-- offene Grenze, bei einem Loeschen waere sie eine Rechteausweitung durch
-- Zustimmung eines Endnutzers.
--
-- Die HTTP-Tueren von Storage nehmen ein OAuth-Token weiterhin nicht an. Dieser
-- Bereich wirkt am entfernten MCP-Server und nirgends sonst.
--
-- ## Warum die Obergrenze mitwaechst
--
-- `array_length(scopes, 1) BETWEEN 1 AND 9` war die Zahl der Bereiche und keine
-- Begrenzung mit eigenem Grund. Sie wird 10, also wieder die Zahl der Bereiche.
-- Eine Obergrenze darunter wuerde einen Client verbieten, der alles darf, was es
-- gibt, und das ist eine Entscheidung des Betreibers und nicht der Tabelle.
--
-- ## Warum ein DROP und ein ADD
--
-- Ein zweiter CHECK neben dem alten waere eine UND-Verknuepfung, und der alte
-- laesst `storage:write` nicht durch. Die Bedingung wird ersetzt und behaelt
-- ihren Namen, damit ein Leser der Tabelle eine Bedingung je Frage findet.
--
-- Bestehende Zeilen bleiben gueltig: Die neue Menge enthaelt die alten neun, das
-- Muster ist echt weiter, und PostgreSQL prueft beim ADD CONSTRAINT alle Zeilen.
-- Ein Fehler hier waere also ein Fehler in dieser Migration und nicht in den
-- Daten.

-- Ein Ausdruck, viermal derselbe, aus dem Grund von 0073: Eine Funktion in einem
-- CHECK ist eine Abhaengigkeit, die ein pg_dump mitschleppen muss, und sie
-- liesse sich spaeter aendern, ohne dass an der Tabelle etwas sichtbar waere.

ALTER TABLE project_auth_oauth_clients
  DROP CONSTRAINT project_auth_oauth_clients_scope_check;
ALTER TABLE project_auth_oauth_clients
  ADD CONSTRAINT project_auth_oauth_clients_scope_check CHECK (
    array_length(scopes, 1) BETWEEN 1 AND 10 AND
    array_to_string(scopes, ' ') ~ (
      '^(identity:read|data:read|data:write|project:read|storage:read' ||
      '|storage:write|queues:read|queues:write|logs:read|migrations:propose)' ||
      '( (identity:read|data:read|data:write|project:read|storage:read' ||
      '|storage:write|queues:read|queues:write|logs:read|migrations:propose))*$'
    )
  );

ALTER TABLE project_auth_oauth_codes
  DROP CONSTRAINT project_auth_oauth_codes_scope_check;
ALTER TABLE project_auth_oauth_codes
  ADD CONSTRAINT project_auth_oauth_codes_scope_check CHECK (
    array_length(scopes, 1) BETWEEN 1 AND 10 AND
    array_to_string(scopes, ' ') ~ (
      '^(identity:read|data:read|data:write|project:read|storage:read' ||
      '|storage:write|queues:read|queues:write|logs:read|migrations:propose)' ||
      '( (identity:read|data:read|data:write|project:read|storage:read' ||
      '|storage:write|queues:read|queues:write|logs:read|migrations:propose))*$'
    )
  );

ALTER TABLE project_auth_oauth_tokens
  DROP CONSTRAINT project_auth_oauth_tokens_scope_check;
ALTER TABLE project_auth_oauth_tokens
  ADD CONSTRAINT project_auth_oauth_tokens_scope_check CHECK (
    array_length(scopes, 1) BETWEEN 1 AND 10 AND
    array_to_string(scopes, ' ') ~ (
      '^(identity:read|data:read|data:write|project:read|storage:read' ||
      '|storage:write|queues:read|queues:write|logs:read|migrations:propose)' ||
      '( (identity:read|data:read|data:write|project:read|storage:read' ||
      '|storage:write|queues:read|queues:write|logs:read|migrations:propose))*$'
    )
  );

ALTER TABLE project_auth_oauth_consents
  DROP CONSTRAINT project_auth_oauth_consents_scope_check;
ALTER TABLE project_auth_oauth_consents
  ADD CONSTRAINT project_auth_oauth_consents_scope_check CHECK (
    array_length(scopes, 1) BETWEEN 1 AND 10 AND
    array_to_string(scopes, ' ') ~ (
      '^(identity:read|data:read|data:write|project:read|storage:read' ||
      '|storage:write|queues:read|queues:write|logs:read|migrations:propose)' ||
      '( (identity:read|data:read|data:write|project:read|storage:read' ||
      '|storage:write|queues:read|queues:write|logs:read|migrations:propose))*$'
    )
  );

-- Die Unveraenderlichkeit der Scope-Spalten bleibt, wie sie ist: Die Trigger aus
-- 0024 haengen an den Tabellen und nicht an diesen Bedingungen. Ein Bereich, der
-- neu erlaubt ist, laesst sich an einer bestehenden Zustimmung trotzdem nicht
-- nachtragen, und das ist richtig: Eine Zustimmung mit mehr Bereichen ist eine
-- neue Zeile, und der Nutzer hat sie erteilt.

COMMIT;
