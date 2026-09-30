import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import { LOG_DESTINATION_TARGETS } from "@/lib/server/data-plane/service";
import { LOCALES } from "@/lib/i18n/locales";
import {
  SERVER_LOG_CONTENT,
  SERVER_LOG_FACTS,
  SERVER_LOG_NEXT_STEPS,
  SERVER_LOG_OWN_STACK,
  SERVER_LOG_VERDICTS,
  serverLogTexts,
  serverLogVerdict,
} from "@/lib/console/server-log-texts";

/**
 * Logs -> Postgres-Zustand, die Karte zum Serverlog (2.109), am Quelltext
 * geprueft.
 *
 * WARUM DIESER VERTRAG NOETIG IST
 *
 * Bis 2.108 stand an vier Stellen im Baum derselbe Satz: das Serverlog von
 * PostgreSQL liege in Dateien neben dem Datenverzeichnis, und QKERN habe
 * darauf keinen Zugriff. Der zweite Teil ist wahr, und der erste war eine
 * Annahme, die nie jemand am Server nachgesehen hat. In jedem Stack, den
 * QKERN faehrt, ist sie falsch: Der Server laeuft mit
 * `logging_collector = off`, und dann gibt es diese Datei nicht.
 *
 * Eine Seite, die eine Annahme behauptet, faellt kein Test. Eine Seite, die
 * ihr Urteil aus einer Ableitung holt, faellt, sobald die Ableitung nicht mehr
 * stimmt. Darum prueft dieser Vertrag genau das: dass die Ansicht keinen
 * festen Satz ueber das Serverlog mehr enthaelt, dass jedes Urteil aus dem
 * Katalog kommt, und dass der alte Satz in keiner der vier Sprachen mehr
 * steht.
 *
 * WAS DIESER VERTRAG NICHT PRUEFEN KANN
 *
 * Was der Server dieses Stacks wirklich mit seinem Log tut, sagt kein
 * Quelltext. Das kann nur ein Lauf gegen die echte Datenbank, und das ist der
 * Fall (2.109) in `tests/postgres.integration.test.ts`. Dort wird auch
 * belegt, dass die Laufzeitrolle die beiden Rechte wirklich nicht hat und
 * dass `adminpack` auf diesem Server wirklich fehlt.
 */
const VIEW = "components/console/database-health-view.tsx";
const TEXTS = "lib/console/server-log-texts.ts";
const SERVICE = "lib/server/data-plane/service.ts";

/**
 * Die vier Saetze, die bis 2.108 im Baum standen und die Annahme trugen. Kein
 * Wortlaut davon darf in einer Uebersetzung oder in einem Modul der Console
 * zurueckkommen.
 */
const RETIRED_CLAIMS = [
  "Ein Serverlog der Projektdatenbank gibt es hier nicht. QKERN hat keinen Dateizugriff auf den Server, und log_destination schreibt in Dateien des Servers. Was diese Seite zeigt, sind die Statistiksichten der Datenbank.",
  "Das Log des Postgres-Servers liegt in Dateien neben seinem Datenverzeichnis, und QKERN hat auf dieses Verzeichnis keinen Zugriff. Eine Fläche, die so täte, als läse sie mit, wäre eine Lüge. Wer das Serverlog braucht, holt es dort, wo der Server läuft.",
  "Für keine dieser vier Quellen gibt es eine Leseroute über die ganze Umgebung. Das Serverlog von Postgres liegt neben dem Datenverzeichnis, auf das QKERN keinen Zugriff hat; einen Pooler und einen protokollierenden Rand gibt es gar nicht; und für Realtime fehlt das Backend.",
  "Welche Abfrage wie viel Zeit gekostet hat, steht unter Berichte → Abfrage-Leistung, und auch dort ohne ihren Text. Eine Grenze, ab der ein Statement als langsam protokolliert wird, gibt es in QKERN nicht: log_min_duration_statement schriebe wieder in eine Datei des Servers.",
];

async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

/** Dieselbe Datei ohne ihre Kommentare: gemeint ist der Code, nicht der Grund. */
async function code(file: string) {
  return (await source(file)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("console server log view contract", () => {
  it("derives its verdict from the catalogue and not from a fixed sentence", () => {
    // Ohne Sammler gibt es keine Datei, und dann ist jedes Recht gleichgueltig.
    // Beide Zeilen fahren denselben Zweig mit entgegengesetzten Rechten; faellt
    // die Reihenfolge der Fragen um, faellt genau eine davon.
    expect(serverLogVerdict({ collector: false, destination: "stderr", mayReadFiles: false, maySeeLogPath: false })).toBe("no_file");
    expect(serverLogVerdict({ collector: false, destination: "csvlog", mayReadFiles: true, maySeeLogPath: true })).toBe("no_file");
    // Eine Datei aus freiem Text bleibt freier Text, auch mit jedem Recht.
    expect(serverLogVerdict({ collector: true, destination: "stderr", mayReadFiles: false, maySeeLogPath: false })).toBe("free_text_out_of_reach");
    expect(serverLogVerdict({ collector: true, destination: "stderr", mayReadFiles: true, maySeeLogPath: true })).toBe("free_text_out_of_reach");
    // Spalten und kein Recht: der einzige Zweig, an dem ein Recht etwas aendert.
    expect(serverLogVerdict({ collector: true, destination: "stderr,csvlog", mayReadFiles: false, maySeeLogPath: false })).toBe("structured_out_of_reach");
    expect(serverLogVerdict({ collector: true, destination: "stderr,csvlog", mayReadFiles: true, maySeeLogPath: false })).toBe("reachable");
    // jsonlog zaehlt genauso, und Schreibweise und Leerzeichen entscheiden nicht.
    expect(serverLogVerdict({ collector: true, destination: " JSONLOG , stderr ", mayReadFiles: false, maySeeLogPath: false })).toBe("structured_out_of_reach");

    // Jedes Urteil im Katalog traegt einen Grund und keine Platzhalterzeile.
    for (const verdict of Object.values(SERVER_LOG_VERDICTS)) {
      expect(verdict.label.length).toBeGreaterThan(10);
      expect(verdict.explains.length).toBeGreaterThan(80);
    }
    // Jede Kennung des Typs steht wirklich im Katalog, und keine zweimal.
    const labels = Object.values(SERVER_LOG_VERDICTS).map((verdict) => verdict.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(Object.keys(SERVER_LOG_VERDICTS)).toHaveLength(4);
  });

  it("holds its facts in one place, and the page takes them from there", async () => {
    expect(SERVER_LOG_FACTS.collectorSetting).toBe("logging_collector");
    expect(SERVER_LOG_FACTS.destinationSetting).toBe("log_destination");
    expect(SERVER_LOG_FACTS.fileRole).toBe("pg_read_server_files");
    expect(SERVER_LOG_FACTS.settingsRole).toBe("pg_read_all_settings");
    expect(SERVER_LOG_FACTS.removedExtension).toBe("adminpack");
    expect(SERVER_LOG_FACTS.removedInMajor).toBe(17);
    expect([...SERVER_LOG_FACTS.structuredDestinations]).toEqual(["csvlog", "jsonlog"]);
    // Die Ziele, aus denen das Urteil faellt, muessen Ziele sein, die die
    // Grenze im Dienst auch durchlaesst. Zwei Listen, die auseinanderlaufen,
    // hiessen: Die Seite urteilt ueber einen Wert, den sie nie zu sehen bekommt.
    for (const target of SERVER_LOG_FACTS.structuredDestinations) {
      expect(LOG_DESTINATION_TARGETS, target).toContain(target);
    }

    const view = await code(VIEW);
    // Die Namen stehen einmal im Modul und werden in der Ansicht referenziert.
    expect(view).toContain("SERVER_LOG_FACTS.collectorSetting");
    expect(view).toContain("SERVER_LOG_FACTS.destinationSetting");
    expect(view).toContain("SERVER_LOG_FACTS.fileRole");
    expect(view).toContain("SERVER_LOG_FACTS.settingsRole");
    expect(view).not.toMatch(/"logging_collector"/u);
    expect(view).not.toMatch(/"pg_read_server_files"/u);
    expect(view).not.toMatch(/"pg_read_all_settings"/u);
  });

  it("shows the verdict through the catalogue instead of writing it into the view", async () => {
    const view = await code(VIEW);
    expect(view).toContain("serverLogVerdict(");
    expect(view).toContain("SERVER_LOG_VERDICTS[");
    // Der Satz entsteht nicht in der Ansicht: Sie zeigt label und explains.
    expect(view).toContain("t(verdict.label)");
    expect(view).toContain("t(verdict.explains)");
    // Kein Urteil steht als Literal in der Ansicht; sonst waere der Katalog
    // Zierde und die Seite haette doch einen festen Satz.
    for (const verdict of Object.values(SERVER_LOG_VERDICTS)) {
      expect(view).not.toContain(verdict.label);
      expect(view).not.toContain(verdict.explains);
    }
  });

  it("reads the two settings and the two roles, and never a path or a file", async () => {
    const service = await code(SERVICE);
    expect(service).toContain("SERVER_LOG_SQL");
    expect(service).toContain("'logging_collector'");
    expect(service).toContain("'log_destination'");
    expect(service).toContain("'pg_read_server_files'");
    expect(service).toContain("'pg_read_all_settings'");
    // Die Lesung fasst keine Datei an und fragt nach keinem Pfad. Diese Namen
    // sind genau die, die andere Vertraege im Baum schon verbieten; hier
    // stehen sie noch einmal fuer die eine Anweisung, die 2.109 hinzufuegt.
    const statement = /const SERVER_LOG_SQL = `([\s\S]*?)`;/u.exec(service);
    expect(statement, "SERVER_LOG_SQL steht nicht als eine Anweisung im Dienst").not.toBeNull();
    const sql = statement![1];
    for (const forbidden of ["pg_read_file", "pg_stat_file", "pg_ls_dir", "pg_ls_logdir",
      "pg_current_logfile", "log_directory", "log_filename", "data_directory", "COPY", "file_fdw"]) {
      expect(sql, forbidden).not.toContain(forbidden);
    }
    // Und sie schreibt nicht.
    for (const verb of ["INSERT", "UPDATE", "DELETE", "ALTER", "CREATE", "GRANT"]) {
      expect(sql, verb).not.toContain(verb);
    }
  });

  it("keeps the privilege the page names on the forbidden list of the role boundary", async () => {
    // Befund einer Mutationsprobe zu 2.109/2.110: Nahm man
    // `pg_read_server_files` aus der namentlichen Liste in `pool.ts`, blieb der
    // ganze Zertifizierungsstack gruen. Die Grenze haelt trotzdem, weil
    // `unexpected_member` jede fremde Mitgliedschaft abweist; die Liste ist
    // der zweite Riegel. Gehalten hat sie bis hierher aber kein einziger Test,
    // in keiner der beiden Dateien, die sie fuehren. Die Seite sagt, QKERN
    // gebe dieses Recht keiner Rolle, und dieser Vertrag ist die Stelle, an
    // der diese Aussage haengt.
    for (const file of ["lib/server/db/pool.ts", "lib/server/migrations/postgres-executor.ts"]) {
      const module = await source(file);
      expect(module, `${file}: ${SERVER_LOG_FACTS.fileRole}`).toContain(`'${SERVER_LOG_FACTS.fileRole}'`);
      expect(module, `${file}: ${SERVER_LOG_FACTS.settingsRole}`).toContain(`'${SERVER_LOG_FACTS.settingsRole}'`);
      // Die Geschwister derselben Familie stehen mit, denn ein Serverlog liesse
      // sich auch ueber sie holen: schreibend, als Programm, oder als Leser
      // aller Daten.
      for (const sibling of ["pg_write_server_files", "pg_execute_server_program"]) {
        expect(module, `${file}: ${sibling}`).toContain(`'${sibling}'`);
      }
    }
  });

  it("does not read or write anything new on the page", async () => {
    const view = await code(VIEW);
    // Dieselbe Route wie vorher, und weiter kein Schreibverb.
    expect(view).toContain("/database/health");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(view, method).not.toContain(`method: "${method}"`);
    }
  });

  it("carries the retired claim in no language any more", async () => {
    for (const claim of RETIRED_CLAIMS) {
      for (const locale of LOCALES) {
        if (locale === "de") continue;
        expect(CONSOLE_TRANSLATIONS[locale as Exclude<typeof locale, "de">][claim], `${locale}: ${claim.slice(0, 40)}`).toBeUndefined();
      }
    }
    // Und auch nicht als deutscher Text in einem Modul der Console.
    const dir = path.resolve(process.cwd(), "lib/console");
    const entries = await readdir(dir);
    for (const entry of entries) {
      if (!entry.endsWith(".ts")) continue;
      const module = await readFile(path.join(dir, entry), "utf8");
      for (const claim of RETIRED_CLAIMS) {
        expect(module, `${entry}: ${claim.slice(0, 40)}`).not.toContain(claim);
      }
    }
  });

  it("keeps every text of the module inside the translation contract", () => {
    const texts = serverLogTexts();
    expect(new Set(texts).size).toBe(texts.length);
    // Die vier Tabellen sind vollstaendig abgedeckt: nichts steht in der
    // Ansicht, was der Uebersetzungsvertrag nicht sieht.
    const expected = 2 * Object.keys(SERVER_LOG_VERDICTS).length +
      2 * SERVER_LOG_CONTENT.length + 2 * SERVER_LOG_NEXT_STEPS.length + 2 * SERVER_LOG_OWN_STACK.length;
    expect(texts).toHaveLength(expected);
    for (const entry of [...SERVER_LOG_CONTENT, ...SERVER_LOG_NEXT_STEPS, ...SERVER_LOG_OWN_STACK]) {
      expect(entry.title.length).toBeGreaterThan(10);
      expect(entry.body.length).toBeGreaterThan(120);
    }
  });

  it("names the collector as the next step and not the file it cannot read", async () => {
    // Der Befund von 2.109 in einem Satz: Der Weg fuehrt an der Datenbank
    // vorbei. Steht der erste Schritt eines Tages auf "die Datei lesen", dann
    // ist das eine Entscheidung ueber ein Recht, und sie soll hier auffallen.
    expect(SERVER_LOG_NEXT_STEPS[0]?.title).toContain("Sammler");
    expect(SERVER_LOG_NEXT_STEPS[0]?.body).toContain("Supabase");
    expect(SERVER_LOG_NEXT_STEPS[0]?.body).not.toContain(SERVER_LOG_FACTS.fileRole);
    // Der Weg, der im eigenen Stack ginge, steht getrennt davon und nennt
    // beides: dass er geht, und dass er bei einem Anbieter nicht geht.
    const ownStack = SERVER_LOG_OWN_STACK.map((entry) => entry.body).join(" ");
    expect(ownStack).toContain("file_fdw");
    expect(ownStack).toContain("csvlog");
    expect(ownStack).toContain("postgres:17-alpine");
    expect(ownStack).toContain("Superuser");
  });

  it("keeps the claim about the stack true: no compose file turns the collector on", async () => {
    // Die Seite urteilt aus dem, was der Server sagt, und der Fall (2.109)
    // erwartet heute "kein Serverlog als Datei". Schaltet eine Compose-Datei
    // den Sammler ein, dann urteilt die Seite anders und der Fall muss
    // mitwandern. Das soll hier auffallen und nicht im Stack.
    const root = process.cwd();
    const entries = await readdir(root);
    const composes = entries.filter((entry) => /^docker-compose.*\.ya?ml$/u.test(entry));
    expect(composes.length).toBeGreaterThanOrEqual(8);
    for (const compose of composes) {
      const text = await readFile(path.join(root, compose), "utf8");
      expect(text, compose).not.toContain("logging_collector");
      expect(text, compose).not.toContain("log_destination");
    }
  });
});
