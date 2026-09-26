BEGIN;

-- Grenzen je Zeitfenster fuer die Anmeldung (2.56).
--
-- Zwei Dinge auf einmal, und sie gehoeren zusammen: **wo die Grenzen stehen**
-- und **wo gezaehlt wird**.
--
-- Warum die Grenzen in project_auth_settings: Dieselbe Begruendung wie 0051.
-- Die Tabelle aus 0048 ist genau eine Zeile je (Organisation, Projekt,
-- Umgebung), mit derselben Fremdschluessel-Kaskade auf project_environments,
-- demselben Trigger gegen Scope-Aenderungen und denselben Rechten fuer
-- qkern_auth. Eine zweite Tabelle mit denselben drei Scope-Spalten haette
-- nichts gekonnt, was diese nicht kann, und haette einen zweiten Ort
-- geschaffen, an dem eine Umgebung "Einstellungen" hat.
--
-- Warum sechs Spalten und kein jsonb: Beide Zahlen jeder Art sind beidseitig
-- begrenzt, und eine Begrenzung soll die Datenbank selbst pruefen koennen.
-- Ein CHECK auf einer int-Spalte tut das ohne Umweg; ein CHECK auf einem
-- jsonb-Dokument muesste erst dessen Form pruefen, bevor es etwas pruefen
-- koennte. Sechs Spalten sind laenger zu lesen und kuerzer zu glauben.
--
-- Eine fehlende Zeile bedeutet "Vorgabe". Die Vorgaben stehen bewusst auch
-- hier als DEFAULT und nicht nur im Dienst: Wer eine Zeile anlegt, weil er
-- den zweiten Faktor einschaltet, bekommt dieselben Grenzen wie jemand ohne
-- Zeile. Sonst haette das Einschalten eines Schalters nebenbei die Grenzen
-- veraendert.
--
-- Die Werte sind genau die, die der Dienst vor 2.56 im Prozessspeicher hielt.
-- 2.56 aendert nicht, wie streng gezaehlt wird, sondern wo und wonach.
ALTER TABLE project_auth_settings
  ADD COLUMN sign_in_max integer NOT NULL DEFAULT 10,
  ADD COLUMN sign_in_window_seconds integer NOT NULL DEFAULT 900,
  ADD COLUMN mail_max integer NOT NULL DEFAULT 5,
  ADD COLUMN mail_window_seconds integer NOT NULL DEFAULT 3600,
  ADD COLUMN refresh_max integer NOT NULL DEFAULT 60,
  ADD COLUMN refresh_window_seconds integer NOT NULL DEFAULT 3600;

-- Beide Zahlen jeder Art, beidseitig begrenzt. Die untere Grenze von max ist
-- 1 und nicht 0: Eine Grenze von 0 waere kein Limit, sondern ein Ausschalter
-- fuer die Anmeldung, und den gibt es woanders. Das Fenster liegt zwischen
-- einer Minute und einem Tag.
ALTER TABLE project_auth_settings
  ADD CONSTRAINT project_auth_settings_rate_limits_check CHECK (
    sign_in_max BETWEEN 1 AND 10000 AND
    mail_max BETWEEN 1 AND 10000 AND
    refresh_max BETWEEN 1 AND 10000 AND
    sign_in_window_seconds BETWEEN 60 AND 86400 AND
    mail_window_seconds BETWEEN 60 AND 86400 AND
    refresh_window_seconds BETWEEN 60 AND 86400
  );

-- Die Zaehltabelle.
--
-- Warum ueberhaupt in der Datenbank: Bis 2.56 zaehlte ein Zaehler im
-- Prozessspeicher (lib/server/auth/rate-limit.ts, InMemoryRateLimiter). Der
-- ist bei genau einer Instanz richtig und bei zweien falsch, und zwei
-- Instanzen sind ein erlaubter Betrieb: Bei n Instanzen hinter einem
-- Lastverteiler gilt in Wahrheit das n-Fache der eingestellten Grenze, und
-- ein Neustart setzt alles auf null. Eine Grenze, die man durch Neustart
-- oder durch Hinzufuegen einer Instanz weitet, ist keine.
--
-- Warum subject_hash und nicht der Schluessel: In dieser Tabelle steht nie
-- eine Adresse und nie eine IP. Gezaehlt wird nach Identitaet (Anmeldung,
-- Mail) oder nach Sitzungsfamilie (Refresh); was davon in die Zeile kommt,
-- ist ein SHA-256 ueber Scope, Art und Wert, base64url. Das ist ein
-- Pseudonym, keine Anonymisierung — wer eine Adresse vermutet, kann sie
-- nachrechnen —, und genau so viel braucht ein Zaehler.
--
-- Warum window_start im Primaerschluessel: Das Fenster ist ein festes Raster
-- (floor(t / w) * w). Zwei Instanzen rechnen ohne Absprache denselben
-- Fensteranfang aus und treffen darum dieselbe Zeile; das INSERT ... ON
-- CONFLICT DO UPDATE ... RETURNING count macht daraus einen Zaehler, der
-- unter Nebenlaeufigkeit keinen Versuch verliert und keinen doppelt zaehlt.
-- Ein gleitendes Fenster koennten zwei Instanzen nicht teilen, ohne sich zu
-- einigen.
CREATE TABLE project_auth_rate_counters (
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  kind text NOT NULL,
  subject_hash text NOT NULL,
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, project_id, environment, kind, subject_hash, window_start),
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE CASCADE,
  CONSTRAINT project_auth_rate_counters_kind_check
    CHECK (kind IN ('sign_in', 'mail', 'refresh')),
  -- 43 Zeichen sind ein SHA-256 in base64url. Eine Adresse passte da zwar
  -- zufaellig auch hinein, aber ein Schluessel aus mehr als einem Wort nicht,
  -- und ein Stern oder ein "@" gar nicht.
  CONSTRAINT project_auth_rate_counters_subject_hash_check
    CHECK (subject_hash ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT project_auth_rate_counters_attempts_check
    CHECK (attempts >= 0)
);

-- Ein Index auf den Fensteranfang allein, fuer das Wegraeumen: Der
-- Primaerschluessel beginnt mit dem Scope und hilft einer Abfrage nach
-- "alles aelter als" nicht.
CREATE INDEX project_auth_rate_counters_window_start_idx
  ON project_auth_rate_counters (window_start);

REVOKE ALL ON project_auth_rate_counters FROM PUBLIC;

-- Hier gibt es DELETE, und das ist der einzige Bruch mit der Regel der
-- uebrigen project_auth_*-Tabellen. Der Grund ist, dass diese Tabelle keine
-- Geschichte fuehrt: Eine Zeile mit einem abgelaufenen Fenster sagt nichts
-- mehr, sie liegt nur herum. Der Dienst raeumt beim Zaehlen die abgelaufenen
-- Zeilen **desselben** Schluessels weg, in derselben Anweisung; damit bleibt
-- hoechstens eine Zeile je aktivem Schluessel stehen, ohne dass irgendwo ein
-- Aufraeumprozess laufen muss.
--
-- Was dieses DELETE nicht kann: fremde Geschichte loeschen. Die Tabelle
-- enthaelt keine, und audit_logs bleibt unberuehrt — dort schreibt der Dienst
-- weiterhin nur an und kann nichts loeschen.
GRANT SELECT, INSERT, UPDATE, DELETE ON project_auth_rate_counters TO qkern_auth;

-- Dieselbe Regel wie in 0048 und 0051: explizite Spalten fuer UPDATE, kein
-- DELETE auf den Einstellungen. Die sechs Zahlen kommen zu mfa_required,
-- redirect_allow_list und updated_at hinzu; die Scope-Spalten bleiben
-- unerreichbar, und der Trigger aus 0048 haelt sie ohnehin fest.
REVOKE UPDATE ON project_auth_settings FROM qkern_auth;
GRANT UPDATE (
  mfa_required, redirect_allow_list, updated_at,
  sign_in_max, sign_in_window_seconds,
  mail_max, mail_window_seconds,
  refresh_max, refresh_window_seconds
) ON project_auth_settings TO qkern_auth;

COMMIT;
