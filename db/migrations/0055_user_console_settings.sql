BEGIN;

-- Die eigene Darstellung der Console (2.55): Sprache, Formatgebietsschema,
-- Zeitzone, Startseite und Aussehen, je Person.
--
-- ## Warum neben `users` und nicht in `users`
--
-- `users` ist seit 0003 die Tabelle der Anmeldung, und ihre Spaltenrechte sind
-- genau darauf zugeschnitten: `qkern_auth` darf `id`, `email`,
-- `password_hash`, `status` und die Zeitstempel lesen und beim Anlegen
-- schreiben -- mehr nicht, und ein UPDATE auf `users` hat die Rolle gar nicht.
-- Eine Vorliebe in diese Tabelle zu legen hiesse, der Anmelderolle ein UPDATE
-- auf der Tabelle mit den Passworthashes zu geben, damit jemand seine Zeitzone
-- wechseln kann. Das ist kein Tausch, den man macht.
--
-- Eine eigene Tabelle mit eigenen Rechten sagt dasselbe genauer: Auf ihr darf
-- `qkern_auth` lesen, einfuegen und aendern, und auf `users` weiterhin nicht.
--
-- ## Warum nicht tenant-scoped
--
-- Die Darstellung gehoert zur Person, nicht zur Organisation. Wer in zwei
-- Organisationen ist, hat eine Zeitzone und nicht zwei; und die Console muss
-- die Einstellung lesen koennen, bevor eine Organisation gewaehlt ist -- genau
-- die Lage, fuer die 0003 die Anmeldedaten bewusst global gelegt hat. Darum
-- keine `organization_id`, keine RLS ueber `qkern_current_organization_id()`
-- und kein Recht fuer `qkern_runtime`.
--
-- ## Warum jede Spalte einen CHECK hat
--
-- Die Werte kommen aus einer festen Auswahl, und dieselbe Auswahl steht in
-- `lib/console/display-settings`. Sie hier noch einmal zu pruefen ist keine
-- Verdopplung, sondern die Grenze an der Stelle, an der sie haelt: Eine Zeile,
-- die die Datenbank nicht annimmt, kann die Console auch nach einem Fehler im
-- Dienst nicht in einen Zustand bringen, den sie nicht darstellen kann.
--
-- `browser` heisst "nicht festgelegt" und ist der Vorgabewert fuer Sprache und
-- Zone. Er bildet das Verhalten vor 2.55 ab: Sprache aus dem Locale-Cookie,
-- Zone aus der Laufzeit des Browsers. Eine Zeile mit lauter Vorgaben und gar
-- keine Zeile bedeuten darum dasselbe, und der Dienst darf beides gleich
-- behandeln.

CREATE TABLE user_console_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  language text NOT NULL DEFAULT 'browser'
    CHECK (language IN ('browser', 'de', 'en', 'fr', 'it')),
  format_locale text NOT NULL DEFAULT 'de-CH'
    CHECK (format_locale IN ('de-CH', 'de-DE', 'en-GB', 'en-US',
                             'fr-CH', 'fr-FR', 'it-CH', 'it-IT')),
  -- Eine IANA-Zone oder 'browser'. Die Liste der gueltigen Zonen steht in der
  -- Laufzeit und nicht in einem CHECK; geprueft wird die Form, damit hier
  -- nichts landet, was kein Zonenname sein kann.
  time_zone text NOT NULL DEFAULT 'browser'
    CHECK (time_zone = 'browser'
           OR time_zone ~ '^[A-Za-z][A-Za-z0-9_+-]{0,20}(/[A-Za-z0-9_+-]{1,20}){0,2}$'),
  -- Die Kennung einer verbundenen Ansicht, wie sie `REAL_VIEWS` fuehrt.
  start_view text NOT NULL DEFAULT 'overview'
    CHECK (start_view ~ '^[a-z][a-z0-9-]{1,40}$'),
  theme text NOT NULL DEFAULT 'system'
    CHECK (theme IN ('system', 'light', 'dark')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER user_console_settings_touch_updated_at
BEFORE UPDATE ON user_console_settings
FOR EACH ROW EXECUTE FUNCTION qkern_touch_updated_at();

REVOKE ALL ON user_console_settings FROM PUBLIC;

-- Kein DELETE: Eine Person loescht ihre Darstellung nicht, sie stellt sie
-- zurueck auf die Vorgaben. Weg ist die Zeile erst, wenn das Konto weg ist,
-- und dafuer greift der Fremdschluessel.
GRANT SELECT (user_id, language, format_locale, time_zone, start_view, created_at, updated_at, theme),
      INSERT (user_id, language, format_locale, time_zone, start_view, theme),
      UPDATE (language, format_locale, time_zone, start_view, theme)
  ON user_console_settings TO qkern_auth;

COMMIT;
