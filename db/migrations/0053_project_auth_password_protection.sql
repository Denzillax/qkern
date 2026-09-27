BEGIN;

-- Passwoerter gegen bekannte Lecks, je Projektumgebung (2.53).
--
-- Warum wieder project_auth_settings und keine neue Tabelle: Dieselbe
-- Begruendung wie 0051 und 0052. Die Tabelle aus 0048 ist genau eine Zeile je
-- (Organisation, Projekt, Umgebung), mit derselben Fremdschluessel-Kaskade auf
-- project_environments, demselben Trigger gegen Scope-Aenderungen und
-- denselben Rechten fuer qkern_auth. Eine vierte Tabelle mit denselben drei
-- Scope-Spalten haette nichts gekonnt, was diese nicht kann.
--
-- Warum drei Spalten und kein jsonb: Zwei der drei Werte sind beidseitig
-- begrenzt beziehungsweise auf eine kurze Liste festgelegt, und beides soll
-- die Datenbank selbst pruefen koennen. Ein CHECK auf einer int- und einer
-- text-Spalte tut das ohne Umweg.
--
-- Eine fehlende Zeile bedeutet "aus". Das ist die Vorgabe und sie ist
-- bewusst aus: Die Pruefung lehnt ein Passwort ab, das ein Nutzer gerade
-- gewaehlt hat, und dieses Verhalten soll ein Betreiber einschalten, nicht
-- geschenkt bekommen.
--
-- Was hier **nicht** steht, ist die Liste selbst. Sie liegt nie in der
-- Datenbank: Eine Liste bekannter Lecks ist Millionen Zeilen gross, aendert
-- sich ausserhalb von QKERN und gehoert in eine Datei, auf die eine
-- Installation zeigt. Die Spalten hier sagen nur, **ob** geprueft wird, **ab
-- welcher Laenge** ein Passwort ueberhaupt angenommen wird und **was die
-- Ablehnung sagt**.
ALTER TABLE project_auth_settings
  ADD COLUMN leaked_password_check boolean NOT NULL DEFAULT false,
  ADD COLUMN password_min_length integer NOT NULL DEFAULT 12,
  ADD COLUMN leaked_password_notice text NOT NULL DEFAULT 'named';

-- Die untere Grenze der Mindestlaenge ist 12 und nicht weniger: Der Dienst
-- weist seit jeher jedes Passwort unter 12 Zeichen ab (assertPassword), und
-- eine Einstellung, die diese Zusage unterlaufen koennte, waere eine
-- Verschlechterung, die wie eine Einstellung aussieht. Die obere Grenze ist
-- 128 und nicht 256: Bei 256 waere die einzige erlaubte Laenge genau 256,
-- weil der Dienst dort seine obere Grenze hat.
--
-- 'named' heisst: Die Ablehnung sagt, dass dieses Passwort aus bekannten
-- Lecks stammt. Das ist die Vorgabe, weil es handelbar ist und kein
-- Geheimnis: Wer das Passwort eingibt, kennt es bereits. 'generic' heisst:
-- Die Ablehnung sagt nur, dass das Passwort den Regeln dieses Projekts nicht
-- genuegt. Nie sagt eine Ablehnung, **wie oft** oder **woher** -- diese Zahl
-- kennt die Pruefung gar nicht, weil nur Hashes verglichen werden.
ALTER TABLE project_auth_settings
  ADD CONSTRAINT project_auth_settings_password_protection_check CHECK (
    password_min_length BETWEEN 12 AND 128 AND
    leaked_password_notice IN ('named', 'generic')
  );

-- Dieselbe Regel wie in 0048, 0051 und 0052: explizite Spalten fuer UPDATE,
-- kein DELETE auf den Einstellungen. Die drei neuen Spalten kommen zu den
-- bisherigen hinzu; die Scope-Spalten bleiben unerreichbar, und der Trigger
-- aus 0048 haelt sie ohnehin fest.
REVOKE UPDATE ON project_auth_settings FROM qkern_auth;
GRANT UPDATE (
  mfa_required, redirect_allow_list, updated_at,
  sign_in_max, sign_in_window_seconds,
  mail_max, mail_window_seconds,
  refresh_max, refresh_window_seconds,
  leaked_password_check, password_min_length, leaked_password_notice
) ON project_auth_settings TO qkern_auth;

COMMIT;
