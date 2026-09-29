BEGIN;

-- Die Inhaltslogs je Aufruf (2.98): was ein Function-Container auf stdout
-- und stderr geschrieben hat.
--
-- Migration 0045 hat stdout und stderr bewusst nicht aufgehoben, mit dem
-- Grund: fremder Code, der alles gesehen haben koennte. Der Grund bleibt, die
-- Folgerung war zu grob. Ein Betreiber, der im Aufrufprotokoll nur einen
-- festen Fehlercode sieht, kann den Aufruf nicht verstehen. Die Zeilen liegen
-- deshalb jetzt hier, in einer **eigenen** Tabelle neben dem Aufrufprotokoll,
-- unter denselben Rechten und mit harten Grenzen:
--
--   * hoechstens 500 Zeilen je Aufruf,
--   * hoechstens 64 KiB je Aufruf (Summe der behaltenen Zeilen),
--   * hoechstens 2 KiB je Zeile; eine laengere ist abgeschnitten.
--
-- Dieselben drei Zahlen stehen in `lib/server/compute/function-output.ts`.
-- Was ueber die Grenzen hinausgeht, wird gezaehlt (`dropped_lines`) und das
-- Protokoll traegt `truncated`; es tut nie so, als waere es vollstaendig.
--
-- Genau eine Zeile je Aufruf, gebunden an das Aufrufprotokoll ueber den
-- Fremdschluessel (organization_id, invocation_id): Ohne Aufruf keine Ausgabe,
-- und faellt der Aufruf (weil seine Function geloescht wird, 0045 kaskadiert),
-- faellt die Ausgabe mit. Dieselbe Aufbewahrung wie das Aufrufprotokoll:
-- append-only, keine UPDATE-, keine DELETE-Policy.
--
-- Gestrichen wird nichts aus den Zeilen. Der Prozess, der den Container
-- startet, kennt keinen Wert eines Geheimnisses: Er reicht nur Referenzen
-- weiter, setzt kein --env und gibt seine eigene Umgebung nicht durch. Was er
-- nicht hat, kann er nicht streichen, und ein Filter, der etwas anderes
-- behauptete, waere eine Zusage ohne Deckung.
CREATE TABLE project_function_invocation_output (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  function_id uuid NOT NULL,
  invocation_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  line_count integer NOT NULL CHECK (line_count BETWEEN 0 AND 500),
  stdout_lines integer NOT NULL CHECK (stdout_lines >= 0),
  stderr_lines integer NOT NULL CHECK (stderr_lines >= 0),
  byte_count integer NOT NULL CHECK (byte_count BETWEEN 0 AND 65536),
  truncated boolean NOT NULL,
  dropped_lines integer NOT NULL CHECK (dropped_lines >= 0),
  -- Je Zeile: at (ISO-8601), stream ('stdout' oder 'stderr'), text, cut.
  lines jsonb NOT NULL,
  CONSTRAINT project_function_invocation_output_lines_shape CHECK (
    jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) = line_count),
  -- Behalten wird nie mehr, als geschrieben wurde.
  CONSTRAINT project_function_invocation_output_counts CHECK (
    line_count + dropped_lines = stdout_lines + stderr_lines),
  UNIQUE (organization_id, invocation_id),
  FOREIGN KEY (organization_id, invocation_id)
    REFERENCES project_function_invocations (organization_id, invocation_id)
    ON DELETE CASCADE
);

CREATE INDEX project_function_invocation_output_recent_idx
  ON project_function_invocation_output (organization_id, project_id, environment, recorded_at DESC);

ALTER TABLE project_function_invocation_output ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_function_invocation_output FORCE ROW LEVEL SECURITY;

CREATE POLICY project_function_invocation_output_tenant_select ON project_function_invocation_output
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_function_invocation_output_tenant_insert ON project_function_invocation_output
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());

REVOKE ALL ON project_function_invocation_output
  FROM PUBLIC, qkern_worker, qkern_provisioner, qkern_auth;
GRANT SELECT ON project_function_invocation_output TO qkern_runtime;
GRANT INSERT (organization_id, project_id, environment, function_id, invocation_id,
  line_count, stdout_lines, stderr_lines, byte_count, truncated, dropped_lines, lines)
  ON project_function_invocation_output TO qkern_runtime;

COMMIT;
