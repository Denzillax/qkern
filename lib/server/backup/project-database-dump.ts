import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { recognisedByName } from "@/lib/server/errors/identity";
import type { SqlPool, SqlQueryable } from "@/lib/server/db/sql";
import type {
  ProjectDatabaseDumpPort,
  ProjectDatabaseDumpStream,
  ProjectDatabaseRestoreTargetPort,
} from "@/lib/server/backup/project-database";

/**
 * Dump und Wiederherstellung als Kindprozess (2.126).
 *
 * ## Warum `pg_dump` und nicht SQL aus dem Dienst
 *
 * Ein logischer Dump ist nicht "alle Tabellen auslesen". Er ist Schema in
 * abhaengigkeitsrichtiger Reihenfolge, Policies, Sequenzstaende, Rechte,
 * Erweiterungen, Default-Privilegien und Identitaetsspalten -- und das fuer eine
 * Datenbank, deren Inhalt einem Mandanten gehoert und die QKERN nicht kennt.
 * Das in TypeScript nachzubauen hiesse, `pg_dump` nachzubauen, und zwar
 * schlechter: jede Postgres-Version brachte bisher eine Form mit, an die
 * niemand gedacht hat.
 *
 * Der Preis ist ein Kindprozess, und der kostet drei Dinge, die hier
 * ausdruecklich geregelt sind:
 *
 * 1. **Das Passwort.** Es geht ueber `PGPASSWORD` in die Umgebung des Kindes.
 *    Nicht in `argv` (`ps` zeigt `argv` jedem Benutzer auf der Maschine), nicht
 *    in eine `.pgpass`-Datei (eine Datei, die liegen bleibt), nicht in eine
 *    Verbindungszeile in einem Log. Die Umgebung des Kindes wird **neu
 *    gebaut** und nicht von `process.env` geerbt: ein Backup-Kindprozess hat
 *    nichts mit dem Vault-Token des Dienstes zu tun.
 * 2. **Die Meldung.** `stderr` des Kindes kann Tabellennamen eines Mandanten
 *    tragen. Sie wird gelesen, aber nur, um den Fehlercode zu setzen, und
 *    verlaesst diese Datei nicht. Der Fehler nach draussen hat einen festen
 *    Code und kein `cause`.
 * 3. **Die Groesse.** `stdout` wird mitgezaehlt und bei der Obergrenze
 *    abgebrochen. Ein Dienst, der einen Dump unbegrenzt in den Speicher legt,
 *    stirbt an einer fremden Datenbank.
 *
 * ## TLS
 *
 * `sslmode=verify-full` mit `sslrootcert`, wie im Control-Plane-Drill aus 2.29.
 * Kein `require`: `require` verschluesselt und prueft niemanden. Der Pfad des
 * Vertrauensankers ist ein Pfad und kein Geheimnis; fehlt er, kommt die
 * Verbindung nicht zustande, und das ist richtig so.
 */

export type ProjectDatabaseBackupEndpoint = Readonly<{
  host: string;
  port: number;
  database: string;
  /**
   * Der Ledger-Eigentuemer der Projektdatenbank.
   *
   * Er steht hier, weil die **Zieldatenbank ihm gehoeren muss**, und das ist
   * der Befund des ersten Laufs von (2.126): Ein Dump traegt
   * `ALTER ... OWNER TO <ledger-owner>` fuer jedes Objekt, und PostgreSQL
   * verlangt dafuer nicht nur, dass der Ausfuehrende Mitglied des neuen
   * Eigentuemers ist, sondern dass der **neue Eigentuemer** CREATE auf dem
   * Schema hat. In einer frisch angelegten Datenbank hat er das nur, wenn er
   * ihr Eigentuemer ist (ueber `pg_database_owner`). Legt die
   * Wiederherstellung die Datenbank auf sich selbst an, scheitert sie an der
   * ersten `ALTER SEQUENCE ... OWNER TO`-Zeile mit "permission denied for
   * schema public" -- und zwar erst nach dem halben Dump.
   *
   * `db/docker/998-project-database.sh` legt die lebende Projektdatenbank
   * genauso an: `CREATE DATABASE project_database OWNER qkern_ledger_owner`.
   * Die Wiederherstellung tut damit dasselbe wie das Bereitstellen.
   */
  ledgerOwner?: string;
  /** Pfad zum Vertrauensanker. Ein Pfad, kein Geheimnis. */
  caFilePath?: string;
}>;

export type ProjectDatabaseBackupCredential = Readonly<{ username: string; password: string }>;

/**
 * Woher Adresse und Zugangsdatum kommen. Die Umsetzung im Produkt steht in
 * `project-database-backup-runtime.ts` und holt beides aus dem
 * Vault-gestuetzten Verbindungskatalog; es gibt keinen zweiten Weg.
 */
export interface ProjectDatabaseBackupEndpointResolver {
  /**
   * Asynchron, weil die Adresse aus der Control Plane kommt und nicht aus einer
   * Umgebungsvariablen: eine Bindung ist eine Zeile unter Zeilensicherheit.
   */
  endpoint(databaseInstanceRef: string): Promise<ProjectDatabaseBackupEndpoint>;
  credential(databaseInstanceRef: string, signal?: AbortSignal): Promise<ProjectDatabaseBackupCredential>;
}

export type ProjectDatabaseDumpErrorCode =
  | "DUMP_FAILED"
  | "ARTIFACT_TOO_LARGE"
  | "CONNECTION_UNAVAILABLE";

/**
 * Welcher Schritt gescheitert ist. Dieselbe Lehre wie beim Provisioner-Log
 * (`ProvisioningStep`): Ein Fehlschlag, der nur sich selbst meldet, kostete
 * dort drei Releases, bis jemand die richtige Stelle vermutete. Vier Schritte,
 * fester Satz, kein Text aus einer Meldung.
 */
export type ProjectDatabaseDumpStep = "configuration" | "endpoint" | "credential" | "process";

export class ProjectDatabaseDumpError extends Error {
  readonly code: ProjectDatabaseDumpErrorCode;
  readonly step: ProjectDatabaseDumpStep;
  constructor(code: ProjectDatabaseDumpErrorCode, step: ProjectDatabaseDumpStep = "process") {
    super(code === "ARTIFACT_TOO_LARGE"
      ? "The project database dump exceeded the size limit."
      : "The project database dump failed.");
    this.name = "ProjectDatabaseDumpError";
    this.code = code;
    this.step = step;
  }
}
recognisedByName(ProjectDatabaseDumpError, "ProjectDatabaseDumpError");

export type PgDumpOptions = Readonly<{
  endpoints: ProjectDatabaseBackupEndpointResolver;
  /**
   * Die Leseverbindung fuer das Manifest, mit **derselben Rolle** wie der Dump.
   * Asynchron, weil der Pool an einer Bindung haengt, die erst gelesen werden
   * muss; der Katalog, der ihn baut, haelt das Passwort.
   */
  readerPool(databaseInstanceRef: string): Promise<SqlPool>;
  pgDumpPath?: string;
  timeoutMs?: number;
}>;

const DEFAULT_TIMEOUT_MS = 1_800_000;

export class PgDumpProjectDatabaseDumpPort implements ProjectDatabaseDumpPort {
  private readonly pgDumpPath: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: PgDumpOptions) {
    this.pgDumpPath = options.pgDumpPath ?? "pg_dump";
    this.timeoutMs = bounded(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000, 7_200_000);
  }

  /**
   * Der Dump als **Strom** (2.129).
   *
   * Was hier nicht mehr steht, ist die Obergrenze: der Dienst zaehlt die Bytes,
   * weil er die Teilegroesse und die Teilezahl kennt, aus denen sich die Grenze
   * rechnet. Zwei Zaehler mit zwei Grenzen waeren zwei Antworten auf dieselbe
   * Frage, und sie wuerden auseinanderlaufen, sobald einer der beiden Werte sich
   * aendert. Was dieser Port dafuer zusagen muss: `cancel()` beendet den
   * Kindprozess, damit ein `pg_dump` ueber eine fremde Datenbank nicht
   * weiterlaeuft, nachdem der Dienst aufgegeben hat.
   */
  async dumpStream(
    input: Readonly<{ databaseInstanceRef: string }>,
    signal?: AbortSignal,
  ): Promise<ProjectDatabaseDumpStream> {
    let endpoint: ProjectDatabaseBackupEndpoint;
    try {
      endpoint = await this.options.endpoints.endpoint(input.databaseInstanceRef);
    } catch {
      throw new ProjectDatabaseDumpError("CONNECTION_UNAVAILABLE", "endpoint");
    }
    const credential = await this.credential(input.databaseInstanceRef, signal);
    return streamProcess({
      command: this.pgDumpPath,
      // `--format=plain`, damit die Wiederherstellung mit `psql` geht und kein
      // zweites Werkzeug braucht. `--quote-all-identifiers`, damit ein
      // Mandantenname, der zufaellig ein Schluesselwort ist, nicht die
      // Wiederherstellung kippt. Keine `--no-owner`- und keine
      // `--no-privileges`-Option: Eigentuemer und Rechte sind Teil des
      // Zustandes, den ein Backup zurueckbringen soll. Was fehlt, ist
      // `--create`: die Zieldatenbank legt der Provisioner-Weg an, nicht der
      // Dump, denn nur der Provisioner-Weg darf eine Datenbank anlegen.
      //
      // `--format=plain` ist ausserdem die Form, die als Strom ueberhaupt
      // taugt: ein Custom-Format-Dump schreibt ein Inhaltsverzeichnis, das
      // `pg_dump` erst am Ende kennt, und laesst sich darum nicht ohne Datei
      // erzeugen.
      args: [
        "--format=plain",
        "--no-password",
        "--quote-all-identifiers",
        "--encoding=UTF8",
        "--dbname", connectionString(endpoint, credential.username),
      ],
      password: credential.password,
      timeoutMs: this.timeoutMs,
      signal,
    });
  }

  async withReader<T>(
    input: Readonly<{ databaseInstanceRef: string }>,
    operation: (database: SqlQueryable) => Promise<T>,
  ): Promise<T> {
    let pool: SqlPool;
    try {
      pool = await this.options.readerPool(input.databaseInstanceRef);
    } catch {
      throw new ProjectDatabaseDumpError("CONNECTION_UNAVAILABLE");
    }
    const client = await pool.connect().catch(() => {
      throw new ProjectDatabaseDumpError("CONNECTION_UNAVAILABLE");
    });
    try {
      // Nur lesen, und das als Zusage an die Datenbank und nicht als Absicht im
      // Dienst: eine read-only Transaktion weist jedes `INSERT` ab, auch eines,
      // das jemand spaeter hier hineinschreibt.
      await client.query("BEGIN TRANSACTION READ ONLY");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async credential(
    databaseInstanceRef: string,
    signal?: AbortSignal,
  ): Promise<ProjectDatabaseBackupCredential> {
    try {
      return await this.options.endpoints.credential(databaseInstanceRef, signal);
    } catch (error) {
      if (error instanceof ProjectDatabaseDumpError) throw error;
      throw new ProjectDatabaseDumpError("CONNECTION_UNAVAILABLE", "credential");
    }
  }
}

export type PsqlRestoreOptions = Readonly<{
  /**
   * Der Weg mit dem Recht, eine Datenbank anzulegen. Das ist **nicht** der
   * Backup-Leser: der darf `NOCREATEDB` sein und ist es auch. Hier steht die
   * Rolle des Provisioner-Weges, und sie ist der einzige Ort in diesem Weg mit
   * `CREATEDB`.
   */
  admin: ProjectDatabaseBackupEndpointResolver;
  /**
   * Womit das Manifest der wiederhergestellten Datenbank gelesen wird.
   *
   * Das muss **dieselbe Rolle** sein, mit der das Manifest beim Backup gelesen
   * wurde, und darum nicht `admin`. Teile des Manifests haengen an der
   * lesenden Rolle, sobald sie aus einer Sicht wie
   * `information_schema.table_privileges` kommen; der Vergleich zweier
   * Manifeste unter zwei Rollen vergleicht dann die Rollen und nicht die
   * Datenbanken. Das Manifest selbst meidet solche Sichten inzwischen (siehe
   * `project-database-manifest.ts`), und trotzdem steht hier der Leser: eine
   * Zusage, die an zwei Stellen haengt, soll an beiden stimmen.
   */
  reader?: ProjectDatabaseBackupEndpointResolver;
  /** Die Wartungsdatenbank, in der `CREATE DATABASE` lauft. Nie die Projektdatenbank. */
  maintenanceDatabase?: string;
  psqlPath?: string;
  /** Der Pool-Bauer fuer das Nachlesen; eingespeist, damit der Fall keinen echten Pool braucht. */
  readerFactory: (input: Readonly<{
    endpoint: ProjectDatabaseBackupEndpoint;
    credential: ProjectDatabaseBackupCredential;
    databaseName: string;
  }>) => Promise<Readonly<{ database: SqlQueryable; close: () => Promise<void> }>>;
  timeoutMs?: number;
}>;

/**
 * Das Ziel einer Wiederherstellung.
 *
 * **Nie ueber die lebende Datenbank.** `createDatabase` legt eine neue an und
 * laesst `CREATE DATABASE` an einer vorhandenen scheitern, statt sie zu
 * leeren; es gibt in dieser Klasse kein `DROP DATABASE` und kein `TRUNCATE`.
 * Wer eine Wiederherstellung uebernehmen will, tauscht danach selbst -- QKERN
 * entscheidet das nicht fuer einen Betreiber, und ein Weg, der es koennte,
 * waere ein Weg, eine lebende Mandantendatenbank zu verlieren.
 */
export class PsqlProjectDatabaseRestoreTargetPort implements ProjectDatabaseRestoreTargetPort {
  private readonly psqlPath: string;
  private readonly maintenanceDatabase: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: PsqlRestoreOptions) {
    this.psqlPath = options.psqlPath ?? "psql";
    this.maintenanceDatabase = options.maintenanceDatabase ?? "postgres";
    this.timeoutMs = bounded(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000, 7_200_000);
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(this.maintenanceDatabase)) {
      throw new ProjectDatabaseDumpError("CONNECTION_UNAVAILABLE");
    }
  }

  async createDatabase(
    input: Readonly<{ databaseInstanceRef: string; databaseName: string }>,
    signal?: AbortSignal,
  ): Promise<void> {
    assertName(input.databaseName);
    const endpoint = await this.options.admin.endpoint(input.databaseInstanceRef);
    if (endpoint.ledgerOwner !== undefined) assertName(endpoint.ledgerOwner);
    const credential = await this.options.admin.credential(input.databaseInstanceRef, signal);
    await runProcess({
      command: this.psqlPath,
      args: [
        "--no-password",
        "--no-psqlrc",
        "--set", "ON_ERROR_STOP=1",
        "--dbname", connectionString({ ...endpoint, database: this.maintenanceDatabase }, credential.username),
        // Beide Namen sind durch `assertName` auf `[a-z_][a-z0-9_]*` begrenzt;
        // der eine kommt aus der Backup-Id, der andere aus der Bindung, und
        // keiner aus einer Anfrage. Ein Name mit einem Anfuehrungszeichen kommt
        // hier nicht an.
        "--command", endpoint.ledgerOwner
          ? `CREATE DATABASE ${input.databaseName} OWNER ${endpoint.ledgerOwner}`
          : `CREATE DATABASE ${input.databaseName}`,
      ],
      password: credential.password,
      timeoutMs: this.timeoutMs,
      maxBytes: 1_048_576,
      signal,
    });
  }

  /**
   * Der Dump geht als **Strom** in `stdin` von `psql` (2.129).
   *
   * Vorher war es ein Puffer, und damit lag das ganze entschluesselte Artefakt
   * einmal im Speicher -- auf der Leseseite dieselbe Grenze, die auf der
   * Schreibseite gerade weggefallen ist. Jetzt entschluesselt der Dienst Teil
   * fuer Teil und schiebt jeden in dieselbe Pipe; `psql` liest sie mit
   * Gegendruck, also bestimmt nicht der Dienst das Tempo, sondern die Datenbank.
   *
   * Was dabei wichtig ist und leicht verloren geht: ein Fehler **im Strom** (ein
   * Siegel, das nicht passt, eine Kette, die bricht) muss den Lauf kippen und
   * darf nicht als "`psql` hat frueh zugemacht" durchgehen. Darum wird der
   * Fehler des Stroms gemerkt und am Ende bevorzugt geworfen, auch wenn `psql`
   * mit 0 endet -- und das kann es, weil es bis dahin gueltiges SQL bekam.
   */
  async restore(
    input: Readonly<{
      databaseInstanceRef: string;
      databaseName: string;
      dump: AsyncIterable<Buffer>;
    }>,
    signal?: AbortSignal,
  ): Promise<void> {
    assertName(input.databaseName);
    const endpoint = await this.options.admin.endpoint(input.databaseInstanceRef);
    const credential = await this.options.admin.credential(input.databaseInstanceRef, signal);
    await runProcess({
      command: this.psqlPath,
      args: [
        "--no-password",
        "--no-psqlrc",
        "--set", "ON_ERROR_STOP=1",
        "--dbname", connectionString({ ...endpoint, database: input.databaseName }, credential.username),
        // `--file=-` statt einer Datei: der Dump geht ueber `stdin` und liegt
        // nie entschluesselt auf einer Platte. Genau das ist der Grund, warum
        // der Umschlag erst im Dienst aufgeht und nicht vorher.
        "--file", "-",
      ],
      password: credential.password,
      stdinStream: input.dump,
      timeoutMs: this.timeoutMs,
      maxBytes: 16 * 1_048_576,
      signal,
    });
  }

  async withReader<T>(
    input: Readonly<{ databaseInstanceRef: string; databaseName: string }>,
    operation: (database: SqlQueryable) => Promise<T>,
  ): Promise<T> {
    assertName(input.databaseName);
    const resolver = this.options.reader ?? this.options.admin;
    const endpoint = await resolver.endpoint(input.databaseInstanceRef);
    const credential = await resolver.credential(input.databaseInstanceRef);
    const reader = await this.options.readerFactory({
      endpoint,
      credential,
      databaseName: input.databaseName,
    });
    try {
      return await operation(reader.database);
    } finally {
      await reader.close().catch(() => undefined);
    }
  }
}

/**
 * Die Verbindungszeile fuer ein Kindprozess-Werkzeug. **Ohne Passwort.** Sie
 * steht in `argv` und ist damit fuer jeden Benutzer der Maschine lesbar; was
 * hier hineingeschrieben wird, ist oeffentlich.
 */
export function connectionString(
  endpoint: ProjectDatabaseBackupEndpoint,
  username: string,
): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(username) || username.startsWith("pg_")) {
    throw new ProjectDatabaseDumpError("CONNECTION_UNAVAILABLE", "configuration");
  }
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(endpoint.database) ||
      !Number.isSafeInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65_535 ||
      !/^[A-Za-z0-9._:[\]-]{1,253}$/.test(endpoint.host)) {
    throw new ProjectDatabaseDumpError("CONNECTION_UNAVAILABLE", "configuration");
  }
  const parts = [
    `host=${endpoint.host}`,
    `port=${endpoint.port}`,
    `user=${username}`,
    `dbname=${endpoint.database}`,
  ];
  if (endpoint.caFilePath) {
    if (!endpoint.caFilePath.startsWith("/") || /[\s'"\\]/.test(endpoint.caFilePath)) {
      throw new ProjectDatabaseDumpError("CONNECTION_UNAVAILABLE");
    }
    parts.push("sslmode=verify-full", `sslrootcert=${endpoint.caFilePath}`);
  }
  return parts.join(" ");
}

type ProcessRun = {
  command: string;
  args: readonly string[];
  password: string;
  timeoutMs: number;
  maxBytes: number;
  stdin?: Buffer;
  /** Ein Strom nach `stdin`, fuer die Wiederherstellung (2.129). */
  stdinStream?: AsyncIterable<Buffer>;
  signal?: AbortSignal;
};

/**
 * Die Umgebung eines Kindprozesses. Frisch gebaut und **nicht** von
 * `process.env` geerbt: dort steht das Vault-Token des Dienstes, es stehen
 * Datenbank-URLs der Control Plane darin und alles, was ein Betreiber je gesetzt
 * hat. Davon braucht ein `pg_dump` nichts.
 *
 * Die Funktion steht hier, weil `runProcess` und `streamProcess` sie beide
 * brauchen und zwei Kopien auseinanderlaufen wuerden -- und eine davon waere
 * dann die, die das Token weitergibt.
 */
function childEnvironment(password: string): NodeJS.ProcessEnv {
  return {
    PGPASSWORD: password,
    PGCONNECT_TIMEOUT: "10",
    // Eine feste Sprache, damit eine Meldung nicht von der Locale des Wirts
    // abhaengt. Keine Zeitzone und kein `PGOPTIONS`.
    LC_ALL: "C",
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  } as unknown as NodeJS.ProcessEnv;
}

/**
 * Ein Kindprozess, dessen `stdout` als Strom herauskommt (2.129).
 *
 * Drei Dinge, die ein naiver Strom falsch macht und die hier geregelt sind:
 *
 * 1. **Der Exit-Code zaehlt.** Ein `pg_dump`, das nach der Haelfte mit 1 endet,
 *    schliesst `stdout` ganz normal. Wer nur den Strom liest, haelt den halben
 *    Dump fuer den ganzen. Darum wird der Fehler des Kindes im Strom
 *    nachgeschoben: der Verbraucher bekommt ihn beim Lesen und nicht gar nicht.
 * 2. **`stderr` wird verbraucht** und nicht aufbewahrt, aus demselben Grund wie
 *    oben: eine Meldung kann Tabellennamen eines Mandanten tragen.
 * 3. **`cancel()` toetet.** Gibt der Dienst auf, soll kein `pg_dump` ueber eine
 *    fremde Datenbank weiterlaufen.
 */
function streamProcess(run: Omit<ProcessRun, "maxBytes">): ProjectDatabaseDumpStream {
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(run.command, [...run.args], {
      env: childEnvironment(run.password),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch {
    throw new ProjectDatabaseDumpError("DUMP_FAILED");
  }
  let stderrBytes = 0;
  child.stderr?.on("data", (chunk: Buffer) => { stderrBytes += chunk.length; });
  const kill = () => { try { child.kill("SIGKILL"); } catch { /* schon weg */ } };
  const timer = setTimeout(kill, run.timeoutMs);
  const onAbort = () => kill();
  run.signal?.addEventListener("abort", onAbort, { once: true });

  const stdout = child.stdout;
  if (!stdout) { kill(); throw new ProjectDatabaseDumpError("DUMP_FAILED"); }

  const exited = new Promise<void>((resolve, reject) => {
    child.on("error", () => reject(new ProjectDatabaseDumpError("DUMP_FAILED")));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new ProjectDatabaseDumpError(
        stderrBytes > 0 ? "DUMP_FAILED" : "CONNECTION_UNAVAILABLE",
      ));
    });
  });
  // Ein Handler, damit Node die Ablehnung nicht als unbehandelt meldet, wenn
  // niemand den Strom zu Ende liest (etwa weil die Obergrenze gerissen wurde).
  // `await exited` weiter unten lehnt trotzdem ab.
  exited.catch(() => undefined);

  async function* chunks(): AsyncGenerator<Buffer> {
    try {
      for await (const chunk of stdout as AsyncIterable<Buffer>) yield chunk;
      // Erst jetzt. `stdout` kann zu Ende sein, waehrend das Kind noch mit
      // einem Fehlercode endet.
      await exited;
    } finally {
      clearTimeout(timer);
      run.signal?.removeEventListener("abort", onAbort);
    }
  }

  return Object.freeze({
    chunks: chunks(),
    cancel: () => {
      clearTimeout(timer);
      run.signal?.removeEventListener("abort", onAbort);
      kill();
    },
  });
}

function runProcess(run: ProcessRun): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(run.command, [...run.args], {
        env: childEnvironment(run.password),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      reject(new ProjectDatabaseDumpError("DUMP_FAILED"));
      return;
    }

    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    let tooLarge = false;
    let stderrBytes = 0;
    const finish = (error: ProjectDatabaseDumpError | null, value?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run.signal?.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve(value!);
    };
    const kill = () => { try { child.kill("SIGKILL"); } catch { /* schon weg */ } };
    const onAbort = () => { kill(); finish(new ProjectDatabaseDumpError("DUMP_FAILED")); };
    const timer = setTimeout(() => { kill(); finish(new ProjectDatabaseDumpError("DUMP_FAILED")); }, run.timeoutMs);
    if (run.signal?.aborted) { kill(); finish(new ProjectDatabaseDumpError("DUMP_FAILED")); return; }
    run.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > run.maxBytes) {
        tooLarge = true;
        kill();
        finish(new ProjectDatabaseDumpError("ARTIFACT_TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    });
    // `stderr` wird verbraucht, damit das Kind nicht an einer vollen Pipe
    // haengt, und **nicht** aufbewahrt: eine Meldung von `pg_dump` kann
    // Tabellennamen eines Mandanten tragen. Gezaehlt wird sie, damit ein
    // Fehlschlag nicht nach einem leeren Lauf aussieht.
    child.stderr?.on("data", (chunk: Buffer) => { stderrBytes += chunk.length; });
    child.on("error", () => { finish(new ProjectDatabaseDumpError("DUMP_FAILED")); });
    child.on("close", (code) => {
      if (tooLarge) return;
      if (code !== 0) {
        finish(new ProjectDatabaseDumpError(stderrBytes > 0 ? "DUMP_FAILED" : "CONNECTION_UNAVAILABLE"));
        return;
      }
      // Ein Fehler **im Strom** ist der wichtigere, und er kommt unter Umstaenden
      // nach dem Ende des Kindes: `psql` endet mit 0, weil es bis dahin
      // gueltiges SQL bekam, und erst danach merkt der Dienst, dass ein Siegel
      // nicht passt oder die Kette bricht. Wer hier sofort `resolve` ruft,
      // meldet eine Wiederherstellung als gelungen, die halb ist. Darum wartet
      // der Erfolg auf das Ende der Quelle.
      if (!streamSettled) { pendingSuccess = true; return; }
      finish(streamError, streamError ? undefined : Buffer.concat(chunks, total));
    });

    let streamSettled = run.stdinStream === undefined;
    let streamError: ProjectDatabaseDumpError | null = null;
    let pendingSuccess = false;
    const settleStream = (error: ProjectDatabaseDumpError | null) => {
      if (streamSettled) return;
      streamSettled = true;
      streamError = error;
      if (error) kill();
      if (pendingSuccess || error) {
        finish(error, error ? undefined : Buffer.concat(chunks, total));
      }
    };

    if (run.stdin) {
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(run.stdin);
    } else if (run.stdinStream) {
      child.stdin?.on("error", () => undefined);
      const source = Readable.from(run.stdinStream);
      source.on("error", () => settleStream(new ProjectDatabaseDumpError("DUMP_FAILED")));
      source.on("end", () => settleStream(null));
      source.pipe(child.stdin!);
    } else {
      child.stdin?.end();
    }
  });
}

function assertName(value: string): void {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value) || value.startsWith("pg_")) {
    throw new ProjectDatabaseDumpError("CONNECTION_UNAVAILABLE", "configuration");
  }
}

function bounded(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ProjectDatabaseDumpError("CONNECTION_UNAVAILABLE", "configuration");
  }
  return value;
}
