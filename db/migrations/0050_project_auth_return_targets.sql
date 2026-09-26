BEGIN;

-- Erlaubte Ruecksprungziele je Projektumgebung (2.54).
--
-- Warum keine neue Tabelle: `project_auth_settings` aus 0048 ist genau das,
-- was hier gebraucht wird — eine Zeile je (Organisation, Projekt, Umgebung),
-- mit derselben Fremdschluessel-Kaskade auf project_environments, demselben
-- Trigger gegen Scope-Aenderungen und denselben Rechten fuer qkern_auth. Eine
-- zweite Tabelle mit denselben drei Scope-Spalten haette nichts gekonnt, was
-- diese nicht kann, und haette einen zweiten Ort geschaffen, an dem eine
-- Umgebung "Einstellungen" hat.
--
-- Warum ein Feld und keine Zeilentabelle: Die Liste ist klein (hoechstens 20
-- Herkuenfte), wird immer ganz gelesen und immer ganz ersetzt. Eine eigene
-- Tabelle haette je Aenderung ein DELETE plus INSERT gebraucht und damit eine
-- Transaktion, die zwischendurch eine leere Liste zeigt — und eine leere
-- Liste bedeutet hier etwas anderes als "gerade beim Schreiben".
--
-- Eine leere Liste heisst "nicht verengt": Es gilt dann genau die aeussere
-- Grenze aus QKERN_PROJECT_AUTH_REDIRECT_ORIGINS, also das Verhalten von vor
-- 2.54. Die Liste kann diese Grenze nur verengen, nie weiten; durchgesetzt
-- wird das im Dienst (lib/server/project-auth/return-targets.ts), weil die
-- aeussere Grenze in der Prozessumgebung steht und der Datenbank nicht
-- bekannt ist. Die Datenbank prueft darum nur, was sie ohne Unterabfrage
-- pruefen kann — CHECK erlaubt keine: eine Dimension, hoechstens 20
-- Eintraege, kein NULL darin, nirgends ein Stern und eine Gesamtlaenge, die
-- zu 20 Herkuenften von je 255 Zeichen passt.
ALTER TABLE project_auth_settings
  ADD COLUMN redirect_allow_list text[] NOT NULL DEFAULT '{}';

ALTER TABLE project_auth_settings
  ADD CONSTRAINT project_auth_settings_redirect_allow_list_check CHECK (
    array_ndims(redirect_allow_list) IS NULL OR (
      array_ndims(redirect_allow_list) = 1 AND
      array_length(redirect_allow_list, 1) <= 20 AND
      array_position(redirect_allow_list, NULL::text) IS NULL AND
      strpos(array_to_string(redirect_allow_list, ','), '*') = 0 AND
      length(array_to_string(redirect_allow_list, ',')) <= 5120
    )
  );

-- Dieselbe Regel wie in 0048: explizite Spalten fuer UPDATE, kein DELETE.
-- Die Liste kommt zu mfa_required und updated_at hinzu; die Scope-Spalten
-- bleiben unerreichbar, und der Trigger aus 0048 haelt sie ohnehin fest.
REVOKE UPDATE ON project_auth_settings FROM qkern_auth;
GRANT UPDATE (mfa_required, redirect_allow_list, updated_at)
  ON project_auth_settings TO qkern_auth;

COMMIT;
