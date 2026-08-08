import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool } from "@/lib/server/db/pool";
import type { SqlPool } from "@/lib/server/db/sql";

/**
 * Zertifiziert `db/project/0003_qkern_change_feed.sql` gegen echtes PostgreSQL.
 *
 * Die Trigger-Funktion ist nicht-trivialer plpgsql: Sie löst
 * Primärschlüsselspalten aus `pg_index` auf, filtert `to_jsonb` und
 * unterscheidet `TG_OP`. Genau solcher Code ist in den Releases 1.9 bis 1.11
 * wiederholt gegen eine echte Datenbank gefallen, obwohl er plausibel aussah.
 *
 * Ausgeführt wird die **echte Migrationsdatei**, nicht eine nachgebaute Fassung.
 * Ein Test gegen eine Kopie würde die Datei zertifizieren, die niemand
 * ausliefert.
 *
 * Ehrliche Grenze: Der Stack legt das `qkern_internal`-Schema in der
 * Zertifizierungsdatenbank an, nicht in einer eigens provisionierten
 * Projektdatenbank. Geprüft werden damit Triggerverhalten, Schlüsselextraktion
 * und die Rechtegrenze — nicht das Zusammenspiel mit dem
 * Provisionierungsablauf.
 */

const adminUrl = process.env.QKERN_TEST_ADMIN_DATABASE_URL;
const projectApiUrl = process.env.QKERN_TEST_PROJECT_API_DATABASE_URL;
const enabled = Boolean(adminUrl && projectApiUrl);

type FeedRow = {
  position: string;
  schema_name: string;
  table_name: string;
  operation: string;
  row_key: Record<string, unknown>;
};

describe.runIf(enabled)("Realtime change feed PostgreSQL certification", () => {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const single = `cdc_single_${suffix}`;
  const composite = `cdc_composite_${suffix}`;
  const keyless = `cdc_keyless_${suffix}`;

  let admin: SqlPool;
  let projectApi: SqlPool;

  beforeAll(async () => {
    admin = createPostgresPool({ connectionString: adminUrl!, max: 2 });
    projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });

    // Die Migration setzt die Rollen und das Schema aus 0001/0002 voraus.
    // IF NOT EXISTS vor CREATE ROLE ist nicht atomar: parallele Testdateien
    // laufen sonst in pg_authid_rolname_index. Der Ausnahmezweig ist der
    // idiomatische Weg und braucht keine Absprache zwischen den Dateien.
    await admin.query(`DO $$
      BEGIN
        CREATE ROLE qkern_ledger_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
          NOREPLICATION NOBYPASSRLS;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;`);
    await admin.query("CREATE SCHEMA IF NOT EXISTS qkern_internal AUTHORIZATION qkern_ledger_owner")
      .catch((error: unknown) => {
        // Auch CREATE SCHEMA IF NOT EXISTS kann parallel auf pg_namespace
        // kollidieren.
        if (!String(error).includes("duplicate key value")) throw error;
      });
    // **Kein** dauerhaftes `GRANT qkern_ledger_owner TO CURRENT_USER` mehr.
    //
    // Die Rolle ist clusterweit, und die Grenzpruefung des Migrationszaunes
    // verlangt einen Ledger-Eigentuemer **ohne jede** Mitgliedschaft. Ein
    // Grant hier machte jede Migration in jeder parallel laufenden Testdatei
    // unmoeglich — gefunden in Release 1.49, nachdem der Migrations-Prozess
    // lokal anwendete und im Zertifizierungslauf nicht.
    //
    // Gebraucht wurde der Grant, um Objekte im Namen des Eigentuemers
    // anzulegen. Der Zertifizierungs-Admin ist Superuser und darf das ohnehin.

    const migration = await readFile(
      path.resolve(process.cwd(), "db/project/0003_qkern_change_feed.sql"), "utf8",
    );
    await admin.query(migration).catch((error: unknown) => {
      // Vitest fuehrt Testdateien parallel aus; mehrere koennen den Feed
      // gleichzeitig anlegen. "already exists" und der Duplikatsfehler auf
      // pg_type bedeuten dasselbe: jemand war schneller.
      const message = String(error);
      if (!message.includes("already exists")
        && !message.includes("duplicate key value")) throw error;
    });
    // Unabhaengig davon, wer ihn angelegt hat: ohne Feed ist der Test wertlos.
    const feedPresent = await admin.query<{ present: string | null }>(
      "SELECT to_regclass('qkern_internal.change_feed')::text AS present",
    );
    if (!feedPresent.rows[0]?.present) throw new Error("change feed was not created");

    for (const [name, definition] of [
      [single, "id uuid PRIMARY KEY, label text NOT NULL"],
      [composite, "tenant uuid NOT NULL, item int NOT NULL, label text, PRIMARY KEY (tenant, item)"],
      [keyless, "label text NOT NULL"],
    ] as const) {
      await admin.query(`CREATE TABLE public.${name} (${definition})`);
      await admin.query(`CREATE TRIGGER ${name}_capture
        AFTER INSERT OR UPDATE OR DELETE ON public.${name}
        FOR EACH ROW EXECUTE FUNCTION qkern_internal.capture_change()`);
    }
  });

  afterAll(async () => {
    for (const name of [single, composite, keyless]) {
      await admin?.query(`DROP TABLE IF EXISTS public.${name} CASCADE`).catch(() => undefined);
    }
    await Promise.allSettled([admin?.end(), projectApi?.end()]);
  });

  async function feed(table: string): Promise<FeedRow[]> {
    const result = await admin.query<FeedRow>(
      `SELECT position, schema_name, table_name, operation, row_key
         FROM qkern_internal.change_feed WHERE table_name = $1 ORDER BY position`,
      [table],
    );
    return result.rows;
  }

  it("captures insert, update and delete with only the primary key", async () => {
    const id = randomUUID();
    await admin.query(`INSERT INTO public.${single} (id, label) VALUES ($1, 'first')`, [id]);
    await admin.query(`UPDATE public.${single} SET label = 'second' WHERE id = $1`, [id]);
    await admin.query(`DELETE FROM public.${single} WHERE id = $1`, [id]);

    const rows = await feed(single);
    expect(rows.map((row) => row.operation)).toEqual(["insert", "update", "delete"]);
    for (const row of rows) {
      expect(row.schema_name).toBe("public");
      // Entscheidend: ausschliesslich der Schluessel, niemals der Zeilenwert.
      expect(Object.keys(row.row_key)).toEqual(["id"]);
      expect(row.row_key).toEqual({ id });
      expect(JSON.stringify(row.row_key)).not.toContain("first");
      expect(JSON.stringify(row.row_key)).not.toContain("second");
    }
  });

  it("captures every column of a composite primary key", async () => {
    const tenant = randomUUID();
    await admin.query(
      `INSERT INTO public.${composite} (tenant, item, label) VALUES ($1, 7, 'value')`, [tenant],
    );

    const rows = await feed(composite);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0].row_key).sort()).toEqual(["item", "tenant"]);
    expect(rows[0].row_key).toEqual({ tenant, item: 7 });
  });

  it("refuses a table without a primary key instead of capturing nothing", async () => {
    // Stilles Ueberspringen waere die gefaehrlichere Variante: der Kanal
    // wuerde als funktionsfaehig gelten und Aenderungen nie melden.
    await expect(admin.query(`INSERT INTO public.${keyless} (label) VALUES ('orphan')`))
      .rejects.toMatchObject({ message: expect.stringContaining("requires a primary key") });
    expect(await feed(keyless)).toEqual([]);
  });

  it("assigns strictly increasing positions", async () => {
    const first = randomUUID();
    const second = randomUUID();
    await admin.query(`INSERT INTO public.${single} (id, label) VALUES ($1, 'a'), ($2, 'b')`,
      [first, second]);

    const positions = (await feed(single)).map((row) => Number(row.position));
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("never lets the runtime role write the feed", async () => {
    // Die wichtigste Zusicherung: koennte die Laufzeitrolle schreiben, liesse
    // sich ein erfundenes Aenderungsereignis einschleusen und damit ein
    // Lesevorgang mit fremden Claims ausloesen.
    await expect(projectApi.query(
      `INSERT INTO qkern_internal.change_feed (schema_name, table_name, operation, row_key)
       VALUES ('public', 'forged', 'insert', '{"id":"forged"}'::jsonb)`,
    )).rejects.toMatchObject({ message: expect.stringContaining("permission denied") });
  });

  it("lets the runtime role read and prune the feed", async () => {
    const readable = await projectApi.query(
      "SELECT count(*)::int AS count FROM qkern_internal.change_feed",
    );
    expect(readable.rows[0]).toBeDefined();
    await expect(projectApi.query(
      "DELETE FROM qkern_internal.change_feed WHERE position < 0",
    )).resolves.toBeDefined();
  });
});
