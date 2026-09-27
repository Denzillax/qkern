BEGIN;

-- Auth-Hooks (2.77): hinterlegter eigener Code an den Punkten der Anmeldung,
-- an denen ein Aufruf wirklich etwas aendern darf.
--
-- Warum in project_auth_settings und nicht in einer eigenen Tabelle: Dieselbe
-- Begruendung wie 0051, 0052 und 0053. Die Tabelle aus 0048 ist genau eine
-- Zeile je (Organisation, Projekt, Umgebung), mit der Fremdschluessel-Kaskade
-- auf project_environments, dem Trigger gegen Scope-Aenderungen und den
-- Rechten fuer qkern_auth. Eine eigene Tabelle mit einer Zeile je Punkt haette
-- zwei Punkte getragen, also hoechstens zwei Zeilen, und dafuer einen zweiten
-- Ort geschaffen, an dem eine Umgebung "Einstellungen" hat.
--
-- Warum Spalten und kein jsonb: Jeder Rand soll von der Datenbank selbst
-- geprueft werden. Ein CHECK auf einer text- oder integer-Spalte tut das ohne
-- Umweg; ein CHECK auf einem jsonb-Dokument muesste erst seine Form pruefen,
-- bevor es etwas pruefen koennte.
--
-- Es gibt bewusst **keine** enabled-Spalte. Ein Punkt ohne hinterlegte
-- Function ruft nichts, und das ist derselbe Zustand wie "ausgeschaltet". Zwei
-- Wege zu demselben Zustand sind ein Weg zu viel: Sie erlauben die Stellung
-- "Function eingetragen, aber aus", und die sieht in einer Uebersicht aus wie
-- ein Hook, der laeuft.
--
-- Eine fehlende Zeile bedeutet "kein Hook an keinem Punkt". Die Vorgaben
-- stehen auch hier als DEFAULT und nicht nur im Dienst: Wer eine Zeile anlegt,
-- weil er den zweiten Faktor einschaltet, soll dabei keinen Hook bekommen.
ALTER TABLE project_auth_settings
  -- Der Punkt `sign_in`. Gerufen, nachdem die Anmeldedaten stimmen und der
  -- zweite Faktor geklaert ist, aber bevor eine Sitzung entsteht. Antwortet er
  -- nicht, entsteht keine Sitzung.
  ADD COLUMN sign_in_hook_function text,
  ADD COLUMN sign_in_hook_timeout_ms integer NOT NULL DEFAULT 2000,
  -- Der Punkt `access_token_claims`. Gerufen bei jeder Ausgabe eines Access
  -- Token, also bei der Anmeldung und bei jeder Erneuerung. Antwortet er
  -- nicht, entsteht kein Token.
  ADD COLUMN access_token_hook_function text,
  ADD COLUMN access_token_hook_timeout_ms integer NOT NULL DEFAULT 2000,
  -- Die feste Liste der Ansprueche, die dieser Hook setzen darf.
  ADD COLUMN access_token_hook_claims text[] NOT NULL DEFAULT '{}';

-- Der Name einer Function, genau wie der Aufrufdienst ihn kennt. NULL heisst
-- "dieser Punkt ruft nichts"; eine leere Zeichenkette faellt damit durch, und
-- das ist gewollt: '' waere ein Name, den es nicht gibt, und sah wie einer aus.
ALTER TABLE project_auth_settings
  ADD CONSTRAINT project_auth_settings_hook_function_check CHECK (
    (sign_in_hook_function IS NULL OR sign_in_hook_function ~ '^[a-z][a-z0-9_-]{2,62}$') AND
    (access_token_hook_function IS NULL OR access_token_hook_function ~ '^[a-z][a-z0-9_-]{2,62}$')
  );

-- Die Frist, beidseitig begrenzt. Nach unten 100 Millisekunden, weil darunter
-- auch ein gesunder Containerstart nicht antwortet und die Frist dann nur noch
-- echte Anmeldungen bricht. Nach oben 5000, weil beide Punkte geschlossen
-- fallen: Eine Frist von einer Minute machte aus jedem haengenden Hook eine
-- Minute Wartezeit je Anmeldeversuch, und das ist kein Schutz mehr, sondern
-- ein Hebel.
ALTER TABLE project_auth_settings
  ADD CONSTRAINT project_auth_settings_hook_timeout_check CHECK (
    sign_in_hook_timeout_ms BETWEEN 100 AND 5000 AND
    access_token_hook_timeout_ms BETWEEN 100 AND 5000
  );

-- Die Liste der Ansprueche, und hier steckt die Aussage dieses Slices in SQL.
--
-- 1. Hoechstens acht Namen. Eine Liste, die beliebig lang werden darf, ist
--    keine Liste, sondern ein offenes Tor mit Anmeldeformular.
-- 2. Jeder Name klein, mit Unterstrich, 2 bis 31 Zeichen. Geprueft ueber
--    array_to_string, weil ein CHECK keine Unterabfrage haben darf; das
--    Trennzeichen kommt im Muster nicht vor, der Umweg aendert also nichts.
-- 3. **Kein reservierter Name.** sub, iss, aud, exp, iat und role stehen
--    vorne; das sind die, um die es im Ernstfall geht. Die uebrigen sind die
--    restlichen Ansprueche, die QKERN selbst ausgibt, denn ein Anspruch, den
--    QKERN ausgibt, darf nicht zwei Bedeutungen haben. Die Liste steht auch im
--    Dienst (lib/server/project-auth/hooks.ts); zweimal geschrieben und
--    einmal gemeint, weil eine Datenbank nicht darauf vertrauen soll, dass
--    jeder Schreiber durch den Dienst kommt.
-- 4. Eine Liste ohne Function ist eine Erlaubnis fuer niemanden, und eine
--    Function ohne Liste ist ein Hook, dessen Ergebnis vollstaendig verworfen
--    wuerde. Beides ist ein Punkt, der nichts tut und so aussieht, als taete
--    er etwas; beides weist die Datenbank ab.
ALTER TABLE project_auth_settings
  ADD CONSTRAINT project_auth_settings_hook_claims_check CHECK (
    coalesce(array_length(access_token_hook_claims, 1), 0) <= 8 AND
    (
      access_token_hook_claims = '{}'::text[] OR
      array_to_string(access_token_hook_claims, ',') ~
        '^[a-z][a-z0-9_]{1,30}(,[a-z][a-z0-9_]{1,30})*$'
    ) AND
    NOT (access_token_hook_claims && ARRAY[
      'sub', 'iss', 'aud', 'exp', 'iat', 'role',
      'nbf', 'jti', 'token_use', 'project_id', 'environment',
      'email', 'email_verified', 'aal', 'session_id',
      'user_metadata', 'app_metadata'
    ]::text[]) AND
    (access_token_hook_function IS NOT NULL) = (access_token_hook_claims <> '{}'::text[])
  );

-- Dieselbe Regel wie in 0048, 0051, 0052 und 0053: explizite Spalten fuer
-- UPDATE, kein DELETE auf den Einstellungen. Die fuenf neuen Spalten kommen zu
-- den bisherigen hinzu; die Scope-Spalten bleiben unerreichbar, und der
-- Trigger aus 0048 haelt sie ohnehin fest.
REVOKE UPDATE ON project_auth_settings FROM qkern_auth;
GRANT UPDATE (
  mfa_required, redirect_allow_list, updated_at,
  sign_in_max, sign_in_window_seconds,
  mail_max, mail_window_seconds,
  refresh_max, refresh_window_seconds,
  leaked_password_check, password_min_length, leaked_password_notice,
  sign_in_hook_function, sign_in_hook_timeout_ms,
  access_token_hook_function, access_token_hook_timeout_ms, access_token_hook_claims
) ON project_auth_settings TO qkern_auth;

COMMIT;
