import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import {
  API_GATEWAY_LOG_TEXTS,
  CONTAINER_LOG_TEXTS,
  DEPLOYMENT_COLUMNS,
  MISSING_LOG_STATES,
  POOLER_LOG_TEXTS,
  missingLogTexts,
} from "@/lib/console/missing-log-texts";

/**
 * Die drei Logseiten aus 2.84 am Quelltext geprueft.
 *
 * Alle drei haben als Platzhalter ein Log versprochen, das es nicht gibt, und
 * alle drei sagen das jetzt selbst. Der Vertrag prueft nicht bloss, dass die
 * Saetze dastehen, sondern dass sie **stimmen**: Er liest die Stellen im
 * Backend, ueber die die Seiten eine Aussage machen, und faellt, sobald eine
 * Aussage nicht mehr zur Lage passt. Ein Pooler in den Compose-Dateien, eine
 * `middleware.ts` oder ein viertes Modul, das Anfragen zaehlt, laesst hier
 * einen Fall scheitern, statt eine Seite stillschweigend zur Luege zu machen.
 *
 * Kein Fall gegen die echte Datenbank: Die drei Seiten lesen ausschliesslich
 * Routen, die es schon gibt, und fuehren weder neues SQL noch eine neue Route
 * ein. Die Lesungen dahinter belegt der vorhandene Postgres-Fall
 * (`compute-definitions-postgres.integration`) und die Faelle zu
 * `database/activity` und `database/settings`.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

async function exists(file: string) {
  try { await stat(path.resolve(process.cwd(), file)); return true; } catch { return false; }
}

/**
 * Dieselbe Datei ohne ihre Kommentare.
 *
 * Die Ansichten erklaeren in ihrem Kopf, warum es stdout, stderr und eine
 * Aufteilung je Quelle nicht gibt. Eine Zusicherung „kommt nicht vor" muss
 * diese Erklaerung meinen duerfen, ohne an ihr zu scheitern: Gemeint ist der
 * Code, nicht die Begruendung.
 */
async function code(file: string) {
  return (await source(file)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const CONTAINER_VIEW = "components/console/function-container-log-view.tsx";
const GATEWAY_VIEW = "components/console/api-gateway-log-view.tsx";
const POOLER_VIEW = "components/console/pooler-log-view.tsx";
const VIEWS = [CONTAINER_VIEW, GATEWAY_VIEW, POOLER_VIEW] as const;
const TEXTS = "lib/console/missing-log-texts.ts";

describe("console missing log views contract", () => {
  it("makes all three pages real and takes their placeholder claims off the navigation", async () => {
    for (const id of ["compute-logs", "logs-api", "logs-pooler"] as const) {
      expect(REAL_VIEWS).toContain(id);
      expect(isPlaceholder(id as never)).toBe(false);
      expect(id in PLACEHOLDERS).toBe(false);
    }
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "compute-logs": return <FunctionContainerLogView');
    expect(app).toContain('case "logs-api": return <ApiGatewayLogView');
    expect(app).toContain('case "logs-pooler": return <PoolerLogView');
    // Die alten Versprechen stehen nirgends mehr.
    const navigation = await source("components/console/navigation.ts");
    for (const claim of [
      "Ausgaben aus dem Container. Inhaltslogs bleiben heute im Container.",
      "Jede Anfrage am Rand mit Status und Dauer.",
      "Log des Verbindungspools: Warteschlange, abgewiesene Verbindungen, Grenzen.",
    ]) {
      expect(navigation, claim).not.toContain(claim);
    }
    // Und keine der drei Uebersetzungen ist stehen geblieben.
    for (const locale of ["en", "fr", "it"] as const) {
      expect(CONSOLE_TRANSLATIONS[locale]["Jede Anfrage am Rand mit Status und Dauer."]).toBeUndefined();
      expect(CONSOLE_TRANSLATIONS[locale]["Log des Verbindungspools: Warteschlange, abgewiesene Verbindungen, Grenzen."]).toBeUndefined();
      expect(CONSOLE_TRANSLATIONS[locale]["Ausgaben aus dem Container. Inhaltslogs bleiben heute im Container."]).toBeUndefined();
    }
  });

  it("only reads and never writes", async () => {
    for (const view of VIEWS) {
      const src = await source(view);
      expect(src, view).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
      // Jede Ansicht kennt ihre Zustaende und bricht eine alte Ladung ab.
      expect(src, view).toContain("AbortController");
      expect(src, view).toContain("StableLabel");
      expect(src, view).toContain('tAll("Lädt…", "Neu laden")');
    }
    // Die Darstellung laeuft ueber console-display, nicht ueber Intl.
    for (const view of VIEWS) {
      const src = await source(view);
      for (const forbidden of ["Intl.", "toLocaleString", "toLocaleDateString", "toFixed", ".slice(0, 10)"]) {
        expect(src, `${view}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  // ---------------------------------------------------------------- //
  // Function-Logs: die Ausgabe des Containers                         //
  // ---------------------------------------------------------------- //

  it("says why the container output does not exist, and the reason matches migration 0045", async () => {
    const view = await source(CONTAINER_VIEW);
    for (const key of ["noOutput", "stdoutIsProtocol", "stderrIsCounted", "containerIsGone", "neverInIt"] as const) {
      expect(view, key).toContain(`CONTAINER_LOG_TEXTS.${key}`);
    }
    // Migration 0045 haelt die beiden Spalten wirklich nicht.
    const migration = await source("db/migrations/0045_project_function_invocations.sql");
    const columns = migration.slice(migration.indexOf("CREATE TABLE"), migration.indexOf("CREATE INDEX"));
    for (const word of ["stdout", "stderr", "payload"]) {
      expect(columns.toLowerCase().includes(`  ${word} `), word).toBe(false);
    }
    // Und sie schreibt den Grund, den die Seite vertritt, selbst hin.
    expect(migration).toContain("Bewusst **nicht** protokolliert werden stdout und");
    expect(CONTAINER_LOG_TEXTS.noOutput).toContain("Migration 0045");
    expect(CONTAINER_LOG_TEXTS.noOutput).toContain("fremdem Code");
  });

  it("matches what the sandbox really does with stdout and stderr", async () => {
    const sandbox = await source("lib/server/compute/function-sandbox-docker.ts");
    // stdout ist die JSON-Leitung, nicht ein Ausgabekanal: Eine Zeile, die
    // kein JSON ist, beendet den Aufruf.
    expect(sandbox).toContain("JSON.parse(raw)");
    expect(sandbox).toContain('new FunctionInvocationError("FUNCTION_SANDBOX_FAILED")');
    expect(CONTAINER_LOG_TEXTS.stdoutIsProtocol).toContain("zeilenweise JSON");
    // stderr wird gezaehlt und gekappt, nie gesammelt.
    expect(sandbox).toContain("const MAX_STDERR_BYTES = 8 * 1024;");
    expect(sandbox).toContain("if (stderrBytes > MAX_STDERR_BYTES) child.stderr?.destroy();");
    expect(CONTAINER_LOG_TEXTS.stderrIsCounted).toContain("8 KiB");
    // Der Container wird entfernt, also gibt es kein spaeteres docker logs.
    expect(sandbox).toContain('"run", "--rm", "--interactive",');
    expect(sandbox).toContain('["rm", "--force", "--volumes", container]');
    expect(CONTAINER_LOG_TEXTS.containerIsGone).toContain("--rm");
    // Das Praefix, das die Seite einem Betreiber nennt, stimmt.
    expect(sandbox).toContain('export const SANDBOX_CONTAINER_PREFIX = "qkern-fn-";');
    expect(CONTAINER_LOG_TEXTS.operatorSteps).toContain("qkern-fn-");
    // Niemand liest die Ausgabe irgendwo aus.
    expect(sandbox).not.toContain("docker logs");
  });

  it("shows the deployment history, the one real reading this placeholder yields", async () => {
    const view = await source(CONTAINER_VIEW);
    expect(view).toContain("${base}/functions/${wanted}/deployments");
    expect(view).toContain("DEPLOYMENT_COLUMNS");
    // Jede Spalte hat ein Gegenstueck in der Antwort der Route.
    expect(DEPLOYMENT_COLUMNS.map((column) => column.label)).toEqual([
      "Revision", "Image", "Eingesetzt von", "Eingesetzt am",
    ]);
    for (const field of ["entry.revision", "entry.image", "entry.deployedBy", "entry.deployedAt"]) {
      expect(view, field).toContain(field);
    }
    // Die Route dahinter liest, und ihr GET traegt genau diese Felder.
    const repository = await source("lib/server/compute/definitions-postgres-repository.ts");
    const history = repository.slice(repository.indexOf("  async listFunctionDeployments("));
    for (const column of ["revision", "image", "deployed_by", "deployed_at"]) {
      expect(history, column).toContain(column);
    }
    // Und die Ansicht greift von einer Einsatzzeile genau diese vier Felder
    // ab und kein fuenftes. Die Seite *nennt* stdout und stderr
    // ausdruecklich; abgegriffen wird keines von beiden.
    const body = await code(CONTAINER_VIEW);
    const read = new Set([...body.matchAll(/\bentry\.([A-Za-z]+)/g)].map((match) => match[1]));
    expect([...read].sort()).toEqual(["deployedAt", "deployedBy", "id", "image", "name", "revision"]);
  });

  it("points from the container page to the invocation log and to the drain", async () => {
    expect(CONTAINER_LOG_TEXTS.invocationsMeaning).toContain("Logs → Functions");
    expect(CONTAINER_LOG_TEXTS.operatorDrain).toContain("function_invocations");
    expect(CONTAINER_LOG_TEXTS.operatorDrain).toContain("Einstellungen → Log-Drains");
    // Die Quelle, auf die verwiesen wird, gibt es im Drain wirklich.
    const drains = await source("lib/console/log-drains.ts");
    expect(drains).toContain('"auth_audit", "function_invocations", "storage_objects", "webhook_deliveries", "usage_series",');
  });

  // ---------------------------------------------------------------- //
  // API-Gateway: der fehlende Rand                                    //
  // ---------------------------------------------------------------- //

  it("says first that there is no edge, and there really is none", async () => {
    const view = await source(GATEWAY_VIEW);
    expect(view).toContain("API_GATEWAY_LOG_TEXTS.noEdge");
    expect(API_GATEWAY_LOG_TEXTS.noEdge.startsWith("Ein API-Gateway hat QKERN nicht.")).toBe(true);
    // Es gibt wirklich keine Middleware, an keiner der Stellen, an denen
    // Next eine suchen wuerde.
    for (const candidate of ["middleware.ts", "middleware.js", "app/middleware.ts", "src/middleware.ts"]) {
      expect(await exists(candidate), candidate).toBe(false);
    }
    // Das Einzige, was fuer alle Pfade gilt, sind feste Header, und die
    // schreiben nichts mit.
    const config = await source("next.config.ts");
    expect(config).toContain("X-Content-Type-Options");
    expect(config).not.toContain("console.log");
  });

  it("names exactly the modules that really count a request", async () => {
    // Gezaehlt wird an genau einer Stelle, mit genau einer Metrik.
    const meter = await source("lib/server/usage/api-requests.ts");
    expect(meter.match(/metric: "api_requests"/g)?.length).toBe(1);
    // Und gerufen wird sie aus genau drei Modulen. Kommt ein viertes dazu,
    // faellt dieser Fall, statt die Seite falsch werden zu lassen.
    const sources = new Set<string>();
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(path.resolve(process.cwd(), dir), { withFileTypes: true })) {
        const next = `${dir}/${entry.name}`;
        if (entry.isDirectory()) await walk(next);
        else if (entry.name.endsWith(".ts")) {
          for (const match of (await source(next)).matchAll(/admitApiRequest\("([a-z_]+)"/g)) sources.add(match[1]);
        }
      }
    };
    await walk("lib/server");
    expect([...sources].sort()).toEqual(["generated_data_api", "project_queues", "project_storage"]);
    // Die Seite nennt dieselben drei und behauptet keine weiteren.
    const view = await source(GATEWAY_VIEW);
    expect(view).toContain('const COUNTING_SOURCES = ["generated_data_api", "project_storage", "project_queues"] as const;');
    expect(API_GATEWAY_LOG_TEXTS.counterMeaning).toContain("Drei Module");
    expect(API_GATEWAY_LOG_TEXTS.counterLimit).toContain("keine Zahl aller Anfragen");
    // Der Lauf durchsucht `lib/server` ganz; das dauert laenger als die
    // Vorgabe von fuenf Sekunden.
  }, 30_000);

  it("says that an unauthenticated request is never counted, and the meter agrees", async () => {
    const meter = await source("lib/server/usage/api-requests.ts");
    expect(meter).toContain("Der Aufruf steht am **Ende** des Resolvers.");
    expect(API_GATEWAY_LOG_TEXTS.counterBlindSpot).toContain("Kontext-Resolvers");
    expect(API_GATEWAY_LOG_TEXTS.counterBlindSpot).toContain("nie gezählt");
    // „Abgelehnt" heisst Quota und sonst nichts; die Migration kennt genau
    // einen Ablehnungsgrund.
    const migration = await source("db/migrations/0028_usage_metering.sql");
    expect(migration).toContain("rejection_code = 'QUOTA_EXCEEDED'");
    expect(API_GATEWAY_LOG_TEXTS.rejectedMeaning).toContain("genau einen Ablehnungsgrund");
  });

  it("reads only the one series it names and claims no breakdown per source", async () => {
    const view = await source(GATEWAY_VIEW);
    expect(view).toContain("/usage/series?metric=api_requests&bucket=hour");
    // Eine Aufteilung je Quelle gibt es nicht: Die Reihe gruppiert nur nach
    // Eimer, und die Seite fragt auch keine an.
    expect(await code(GATEWAY_VIEW)).not.toContain("source=");
    const repository = await source("lib/server/usage/postgres-repository.ts");
    const series = repository.slice(repository.indexOf("  readSeries("));
    expect(series).toContain("GROUP BY 1");
    expect(series).not.toContain("GROUP BY 1, 2");
    expect(API_GATEWAY_LOG_TEXTS.counterLimit).toContain("keine Aufteilung je Quelle");
  });

  it("points from the gateway page to the places where rows really exist", async () => {
    expect(API_GATEWAY_LOG_TEXTS.whereRowsExistMeaning).toContain("Logs → Functions");
    expect(API_GATEWAY_LOG_TEXTS.whereRowsExistMeaning).toContain("Logs → Audit");
    expect(API_GATEWAY_LOG_TEXTS.whatItWouldTake).toContain("Migration 0045");
    expect(API_GATEWAY_LOG_TEXTS.operatorDrain).toContain("usage_series");
    expect(API_GATEWAY_LOG_TEXTS.operatorDrain).toContain("Einstellungen → Log-Drains");
  });

  // ---------------------------------------------------------------- //
  // Pooler: der, den es nicht gibt                                    //
  // ---------------------------------------------------------------- //

  it("says first that there is no pooler, and no compose file starts one", async () => {
    const view = await source(POOLER_VIEW);
    expect(view).toContain("POOLER_LOG_TEXTS.noPooler");
    expect(POOLER_LOG_TEXTS.noPooler.startsWith("Zwischen Anwendung und Datenbank steht bei QKERN nichts.")).toBe(true);
    // Keine der Compose-Dateien bringt einen Pooler mit.
    for (const file of (await readdir(process.cwd())).filter((name) => name.startsWith("docker-compose"))) {
      const compose = (await source(file)).toLowerCase();
      for (const word of ["pgbouncer", "supavisor", "6543"]) {
        expect(compose.includes(word), `${file}: ${word}`).toBe(false);
      }
    }
  });

  it("says the application pool is unreadable, and the interface really hides it", async () => {
    const view = await source(POOLER_VIEW);
    for (const key of ["appPoolMeaning", "appPoolWhyNot", "appPoolNoQueueLog"] as const) {
      expect(view, key).toContain(`POOLER_LOG_TEXTS.${key}`);
    }
    // Die Grenze steht wirklich nur in der Umgebung und erreicht keine Route.
    const pool = await source("lib/server/db/pool.ts");
    expect(pool).toContain('max: numberFromEnv("DATABASE_POOL_MAX", 10)');
    expect(POOLER_LOG_TEXTS.appPoolMeaning).toContain("DATABASE_POOL_MAX");
    // Die Schnittstelle kann genau drei Dinge; die Zaehler des Treibers
    // liegen dahinter.
    const sql = await source("lib/server/db/sql.ts");
    expect(sql).toContain("SqlPool");
    for (const counter of ["totalCount", "idleCount", "waitingCount"]) {
      expect(sql, counter).not.toContain(counter);
      expect(view, counter).not.toContain(counter);
    }
    expect(POOLER_LOG_TEXTS.appPoolWhyNot).toContain("genau drei Dinge");
  });

  it("shows the connections the server really reports, by role and never by session", async () => {
    const view = await source(POOLER_VIEW);
    expect(view).toContain("useDatabaseActivity");
    expect(view).toContain("/database/settings");
    // Die Abfrage dahinter gruppiert nach Rolle und Zustand und waehlt
    // weder Abfragetext noch Adresse noch Anwendungsnamen.
    const service = await source("lib/server/data-plane/service.ts");
    const activity = service.slice(service.indexOf("FROM pg_catalog.pg_stat_activity AS activity"));
    const query = activity.slice(0, activity.indexOf("`"));
    expect(query).toContain("GROUP BY 1, 2");
    for (const column of ["application_name", "client_addr", "client_hostname"]) {
      expect(query, column).not.toContain(column);
    }
    // Genau das sagt die Seite auch.
    expect(POOLER_LOG_TEXTS.connectionsLimit).toContain("Name der Anwendung");
    expect(POOLER_LOG_TEXTS.connectionsMeaning).toContain("pg_stat_activity");
    expect(POOLER_LOG_TEXTS.connectionsMeaning).toContain("nie eine Zeile je Sitzung");
    expect(POOLER_LOG_TEXTS.connectionsNoHistory).toContain("kein Verlauf");
  });

  it("shows the four limits that really decide a refusal", async () => {
    const view = await source(POOLER_VIEW);
    for (const field of ["limits.maxConnections", "limits.superuserReserved", "limits.database", "limits.role"]) {
      expect(view, field).toContain(field);
    }
    // Alle vier kommen aus derselben Abfrage.
    const service = await source("lib/server/data-plane/service.ts");
    for (const setting of [
      "current_setting('max_connections')", "superuser_reserved_connections",
      "datconnlimit", "rolconnlimit",
    ]) {
      expect(service, setting).toContain(setting);
    }
    expect(POOLER_LOG_TEXTS.limitsMeaning).toContain("Datenbank → Einstellungen");
    expect(POOLER_LOG_TEXTS.operatorSteps).toContain("log_connections");
    expect(POOLER_LOG_TEXTS.operatorDrain).toContain("keine Quelle für Verbindungen");
  });

  // ---------------------------------------------------------------- //
  // Texte und Sprachen                                                //
  // ---------------------------------------------------------------- //

  it("keeps every honesty sentence long enough to be an explanation", () => {
    for (const text of [
      CONTAINER_LOG_TEXTS.noOutput, CONTAINER_LOG_TEXTS.stdoutIsProtocol,
      CONTAINER_LOG_TEXTS.stderrIsCounted, CONTAINER_LOG_TEXTS.neverInIt,
      API_GATEWAY_LOG_TEXTS.noEdge, API_GATEWAY_LOG_TEXTS.counterLimit,
      API_GATEWAY_LOG_TEXTS.counterBlindSpot, API_GATEWAY_LOG_TEXTS.whatItWouldTake,
      POOLER_LOG_TEXTS.noPooler, POOLER_LOG_TEXTS.appPoolWhyNot,
      POOLER_LOG_TEXTS.connectionsLimit, POOLER_LOG_TEXTS.appPoolNoQueueLog,
    ]) {
      expect(text.length, text.slice(0, 40)).toBeGreaterThanOrEqual(150);
    }
    // Kein Gedankenstrich: Dieses Projekt schreibt Punkt, Komma oder Klammer.
    for (const text of missingLogTexts()) {
      expect(text.includes("–") || text.includes("—"), text.slice(0, 40)).toBe(false);
    }
  });

  it("translates every text of all three pages into en, fr and it", async () => {
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = missingLogTexts().filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
    const keys = (await Promise.all(VIEWS.map(source)))
      .flatMap((src) => [...src.matchAll(/(?<![A-Za-z0-9_])t\(("(?:[^"\\]|\\.)*")\)/g)]
        .map((match) => JSON.parse(match[1]) as string));
    expect(keys.length).toBeGreaterThan(40);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = keys.filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
  });

  it("keeps the texts module pure and complete", async () => {
    const texts = await source(TEXTS);
    expect(texts).not.toContain("react");
    expect(texts).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    const exported = new Set(missingLogTexts());
    for (const text of [
      ...Object.values(CONTAINER_LOG_TEXTS), ...Object.values(API_GATEWAY_LOG_TEXTS),
      ...Object.values(POOLER_LOG_TEXTS), ...Object.values(MISSING_LOG_STATES),
      ...DEPLOYMENT_COLUMNS.map((column) => column.meaning),
    ]) {
      expect(exported.has(text), text.slice(0, 40)).toBe(true);
    }
  });
});
