import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import pg from "pg";

/**
 * Fuellt lokal ein frisch registriertes Projekt mit Beispieldaten.
 *
 * **Wofuer.** Nach der Registrierung steht in der Konsole eine Organisation und
 * ein leeres Projekt. Leer heisst: keine Tabelle, keine Zeile, kein Diagramm,
 * nichts zu klicken. Dieses Skript macht aus dem leeren Projekt eines, an dem
 * sich die Konsole ansehen laesst, und es macht genau die beiden Schritte, die
 * lokal niemand sonst macht: die Bindung der Umgebung an ihre Datenbank (in
 * Produktion der Provisionierer) und ein paar Tabellen samt Zeilen (in
 * Produktion der Entwickler selbst).
 *
 * **Was es nicht tut.** Es legt kein Konto an. Registrieren muss sich der
 * Mensch; das Skript findet die Organisation, die dabei entstanden ist, und
 * wenn es keine findet, sagt es das und hoert auf.
 *
 * **Warum die Bindung ueber das vorhandene Skript laeuft.** `dev-bind-project-
 * database.mjs` geht als Provisionierer durch dieselbe Zeilensicherheit wie in
 * Produktion. Hier mit dem Superuser durchzugreifen waere kuerzer und wuerde
 * genau den Weg auslassen, der in Produktion der schwierige ist.
 *
 * **Warum die Tabellen ueber `SET ROLE qkern_ledger_owner` entstehen.** Alles,
 * was die Data API je sieht, gehoert dem Ledger-Owner, und der kann sich nicht
 * anmelden, auch lokal nicht. Ohne Zeilensicherheit gibt die Data API eine
 * Tabelle gar nicht erst frei, darum traegt jede Tabelle hier ihre Policies.
 *
 * Aufruf: `npm run dev:seed-example-project`
 */
const CONTROL_URL = "postgresql://qkern:qkern_local_only@127.0.0.1:5432/qkern_control";
const PROJECT_URL = "postgresql://qkern:qkern_local_only@127.0.0.1:5432/project_database";

/** Erwarteter Fehler: nur die Meldung, kein Stacktrace. */
class ExpectedError extends Error {}

/**
 * Die Beispieldaten.
 *
 * Drei Tabellen statt einer, und zwar mit Absicht: `beitraege` zeigt auf
 * `autoren`, damit die Konsole eine Beziehung zu zeichnen hat und die Data API
 * eine Einbettung anbieten kann. `notizen` steht fuer sich und ist die
 * einfachste Tabelle, an der sich Lesen, Filtern und Sortieren zeigen laesst.
 *
 * Die Policies sind bewusst verschieden: `notizen` darf jeder lesen und
 * schreiben (ein Public Key kommt also durch), `autoren` und `beitraege` darf
 * jeder lesen und niemand schreiben. Damit sieht man in der Konsole den
 * Unterschied, ohne ihn erklaert zu bekommen.
 */
const SEED_SQL = `
SET ROLE qkern_ledger_owner;

CREATE TABLE IF NOT EXISTS public.notizen (
  id serial PRIMARY KEY,
  titel text NOT NULL,
  erledigt boolean NOT NULL DEFAULT false,
  angelegt_am timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notizen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notizen_lesen ON public.notizen;
CREATE POLICY notizen_lesen ON public.notizen FOR SELECT USING (true);
DROP POLICY IF EXISTS notizen_schreiben ON public.notizen;
CREATE POLICY notizen_schreiben ON public.notizen FOR INSERT WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.autoren (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  stadt text
);
ALTER TABLE public.autoren ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS autoren_lesen ON public.autoren;
CREATE POLICY autoren_lesen ON public.autoren FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.beitraege (
  id serial PRIMARY KEY,
  autor_id integer NOT NULL REFERENCES public.autoren(id) ON DELETE CASCADE,
  titel text NOT NULL,
  veroeffentlicht boolean NOT NULL DEFAULT false,
  angelegt_am timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.beitraege ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS beitraege_lesen ON public.beitraege;
CREATE POLICY beitraege_lesen ON public.beitraege FOR SELECT USING (true);

-- Zeilen nur, wenn die Tabelle leer ist: Ein zweiter Lauf soll nichts
-- verdoppeln, und geloeschte Zeilen sollen geloescht bleiben.
INSERT INTO public.notizen (titel, erledigt)
SELECT * FROM (VALUES
  ('Konsole ansehen', false),
  ('Tabelle anlegen', true),
  ('Public Key holen', false),
  ('Zeile per REST lesen', false)
) AS v(titel, erledigt)
WHERE NOT EXISTS (SELECT 1 FROM public.notizen);

INSERT INTO public.autoren (name, stadt)
SELECT * FROM (VALUES
  ('Ada Lovelace', 'London'),
  ('Grace Hopper', 'New York'),
  ('Barbara Liskov', 'Boston')
) AS v(name, stadt)
WHERE NOT EXISTS (SELECT 1 FROM public.autoren);

INSERT INTO public.beitraege (autor_id, titel, veroeffentlicht)
SELECT a.id, v.titel, v.veroeffentlicht
FROM (VALUES
  ('Ada Lovelace', 'Notizen zur Analytical Engine', true),
  ('Ada Lovelace', 'Was eine Maschine nicht kann', false),
  ('Grace Hopper', 'Der erste Compiler', true),
  ('Barbara Liskov', 'Abstrakte Datentypen', true),
  ('Barbara Liskov', 'Wann eine Ersetzung erlaubt ist', true)
) AS v(autor, titel, veroeffentlicht)
JOIN public.autoren a ON a.name = v.autor
WHERE NOT EXISTS (SELECT 1 FROM public.beitraege);

RESET ROLE;
`;

export async function findProject(client) {
  const { rows } = await client.query(`
    SELECT p.id AS project_id, p.name AS project_name, p.organization_id,
           o.name AS organization_name,
           e.environment, e.database_instance_ref
      FROM projects p
      JOIN organizations o ON o.id = p.organization_id
      LEFT JOIN project_environments e
        ON e.project_id = p.id AND e.environment = 'development'
     ORDER BY p.created_at ASC`);
  if (rows.length === 0) {
    throw new ExpectedError(
      "Kein Projekt gefunden. Erst unter http://localhost:3000/register ein Konto anlegen; " +
      "QKERN legt dabei eine Organisation und ein Projekt an.");
  }
  // Das aelteste: Nach der Registrierung gibt es genau eines, und wer spaeter
  // weitere anlegt, will beim ersten bleiben.
  return rows[0];
}

export function bindArguments(project) {
  return ["run", "dev:bind-project-database", "--", project.project_id, "development", project.organization_id];
}

async function main() {
  const control = new pg.Client({ connectionString: CONTROL_URL });
  await control.connect();
  let project;
  try {
    project = await findProject(control);
  } finally {
    await control.end();
  }

  console.log(`Projekt: ${project.project_name} (${project.project_id})`);
  console.log(`Organisation: ${project.organization_name} (${project.organization_id})`);

  if (project.database_instance_ref && !String(project.database_instance_ref).startsWith("pending:")) {
    console.log(`development ist schon gebunden an ${project.database_instance_ref}`);
  } else {
    // Ueber das vorhandene Skript, damit der Weg derselbe bleibt wie in
    // Produktion: Provisionierer-Login, Zeilensicherheit, nur aus `pending:`.
    execFileSync("npm", bindArguments(project), { stdio: "inherit", shell: true });
  }

  const db = new pg.Client({ connectionString: PROJECT_URL });
  await db.connect();
  try {
    await db.query(SEED_SQL);
    const counts = await db.query(`
      SELECT 'notizen' AS tabelle, count(*)::int AS zeilen FROM public.notizen
      UNION ALL SELECT 'autoren', count(*)::int FROM public.autoren
      UNION ALL SELECT 'beitraege', count(*)::int FROM public.beitraege
      ORDER BY 1`);
    for (const row of counts.rows) console.log(`${row.tabelle}: ${row.zeilen} Zeilen`);
  } finally {
    await db.end();
  }

  console.log("");
  console.log("Fertig. In der Konsole unter Tabellen stehen jetzt drei Tabellen,");
  console.log("`beitraege` zeigt auf `autoren`, und das Schemabild hat etwas zu zeichnen.");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof ExpectedError ? error.message : error);
    process.exit(1);
  });
}
