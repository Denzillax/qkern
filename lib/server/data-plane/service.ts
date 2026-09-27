import { DATA_IDENTIFIER, isDataSchemaName } from "@/lib/server/data-plane/identifiers";
import { recognisedByName } from "@/lib/server/errors/identity";
import { isReadOnlySql, redactSensitive } from "@/lib/security";
import { readQueryPlan, type QueryPlanReading } from "@/lib/console/query-insights";
import type { Environment } from "@/lib/types";
import type { SqlPoolClient } from "@/lib/server/db/sql";
import type {
  ProjectDatabaseConnectionResolver,
  ResolvedProjectDatabaseConnection,
} from "@/lib/server/migrations/postgres-executor";
import { isCatalogReference } from "@/lib/server/migrations/connection-catalog";

// Rollen- und Datenbanknamen bleiben klein; Schemanamen stehen in identifiers.ts.
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const SENSITIVE_COLUMN = /(?:password|secret|token|cookie|private.?key|authorization|api.?key)/i;
const MAX_TABLES = 100;
const MAX_COLUMNS_PER_TABLE = 200;
const MAX_QUERY_ROWS = 100;
const MAX_QUERY_BYTES = 256 * 1024;

export type ProjectDataPlaneContext = {
  organizationId: string;
  actorRef: string;
};

export type ProjectDataPlaneScope = {
  projectId: string;
  environment: Environment;
};

export type ProjectDataPlaneTarget = {
  databaseInstanceRef: string;
};

export interface ProjectDataPlaneTargetResolver {
  resolveTarget(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectDataPlaneTarget>;
}

export type ProjectSchemaColumn = {
  name: string;
  dataType: string;
  nullable: boolean;
  identity: boolean;
  generated: boolean;
  sensitive: boolean;
};

export type ProjectSchemaTable = {
  name: string;
  kind: "table" | "partitioned_table" | "view" | "materialized_view";
  rowSecurityEnabled: boolean;
  columns: ProjectSchemaColumn[];
  truncated: boolean;
};

export type ProjectSchemaResult = {
  source: "postgres";
  schema: string;
  tables: ProjectSchemaTable[];
  truncated: boolean;
};

export type ProjectTrigger = {
  name: string;
  table: string;
  /** BEFORE, AFTER oder INSTEAD OF */
  timing: "before" | "after" | "instead_of";
  events: Array<"insert" | "update" | "delete" | "truncate">;
  /** FOR EACH ROW oder FOR EACH STATEMENT */
  orientation: "row" | "statement";
  enabled: "origin" | "always" | "replica" | "disabled";
  functionSchema: string;
  functionName: string;
  condition: string | null;
};

export type ProjectTriggerResult = {
  source: "postgres";
  schema: string;
  triggers: ProjectTrigger[];
  truncated: boolean;
};

export type ProjectFunction = {
  name: string;
  /** f = Funktion, p = Prozedur; Aggregate und Fensterfunktionen bleiben draussen */
  kind: "function" | "procedure";
  language: string;
  /** Wie `pg_get_function_arguments`: Namen, Typen, Modi, Vorgaben */
  arguments: string;
  /** Wie `pg_get_function_identity_arguments`: ohne Vorgaben, mit OUT-Parametern */
  identityArguments: string;
  /** Wie `pg_get_function_result`; Prozeduren haben keinen */
  returnType: string | null;
  returnsSet: boolean;
  volatility: "immutable" | "stable" | "volatile";
  securityDefiner: boolean;
};

export type ProjectFunctionResult = {
  source: "postgres";
  schema: string;
  functions: ProjectFunction[];
  truncated: boolean;
};

export type ProjectIndex = {
  name: string;
  table: string;
  /** btree, hash, gin, gist, brin, spgist ... */
  accessMethod: string;
  unique: boolean;
  primary: boolean;
  /** false waehrend CREATE INDEX CONCURRENTLY oder nach einem Fehlschlag */
  valid: boolean;
  /** Spalten in Indexreihenfolge; Ausdruecke fehlen hier und stehen in `definition` */
  columns: string[];
  /** Wie `pg_get_indexdef` */
  definition: string;
  /** WHERE-Teil eines partiellen Index, sonst null */
  predicate: string | null;
};

export type ProjectIndexResult = {
  source: "postgres";
  schema: string;
  indexes: ProjectIndex[];
  truncated: boolean;
};

export type ProjectTableStatistics = {
  table: string;
  /** Sequenzielle Scans seit dem letzten Zuruecksetzen der Zaehler */
  seqScan: number;
  seqTupRead: number;
  /** Scans ueber einen Index der Tabelle; null im Katalog heisst 0 */
  idxScan: number;
  /** Schaetzungen des Statistiksammlers, keine exakte Zeilenzahl */
  liveTuples: number;
  deadTuples: number;
  lastAutovacuum: string | null;
  /** Letzte Stichprobe, manuell oder automatisch (`GREATEST`) */
  lastAnalyze: string | null;
};

export type ProjectIndexStatistics = {
  name: string;
  table: string;
  scans: number;
  sizeBytes: number;
  isUnique: boolean;
  isPrimary: boolean;
};

export type ProjectStatisticsResult = {
  source: "postgres";
  schema: string;
  tables: ProjectTableStatistics[];
  indexes: ProjectIndexStatistics[];
  truncated: boolean;
};

/**
 * Ein Statement aus `pg_stat_statements`, auf drei Zahlen reduziert (2.57).
 *
 * Es gibt hier kein Textfeld, und das ist der ganze Punkt. 2.40 hat die
 * Sicht bewusst ungelesen gelassen, weil `pg_stat_statements` nur Abfragen
 * normalisiert und ein Utility-Befehl (`CREATE ROLE … PASSWORD '…'`) seine
 * Literale behaelt — auf einem Cluster auch die eines fremden Mandanten. Der
 * sichere Teilausschnitt ist: nur Zeilen der eigenen Datenbank, und von
 * jeder Zeile nur die normalisierte Kennung und zwei Zaehler. Die Kennung
 * ist ein Hash ueber den Abfragebaum; sie traegt kein Literal, und aus ihr
 * laesst sich der Text nicht zurueckrechnen.
 *
 * 2.67 haelt an dieser Entscheidung fest und legt zwei weitere Zahlen dazu,
 * damit die Seite Abfrage-Leistung ohne Text auskommt: den Mittelwert je
 * Aufruf und die Summe der beruehrten Zeilen. Beide sind Zaehler der Sicht,
 * beide tragen kein Literal. Die Entscheidung gegen `query` steht
 * ausgeschrieben in `STATEMENT_DIGESTS_SQL`, weil sie die Seite spuerbar
 * aermer macht und darum nicht stillschweigend getroffen werden darf.
 */
export type ProjectStatementDigest = {
  /** `queryid` als Dezimaltext; `bigint` passt nicht verlustfrei in `number` */
  id: string;
  calls: number;
  /** Gesamte Ausfuehrungszeit in Millisekunden, abgerundet */
  totalTimeMs: number;
  /**
   * Mittlere Ausfuehrungszeit je Aufruf in Mikrosekunden, abgerundet (2.67).
   *
   * Nicht in Millisekunden: Die meisten Statements einer gesunden Datenbank
   * liegen unter einer Millisekunde, und ein abgerundeter Millisekundenwert
   * waere fuer sie durchgehend 0. Eine Spalte voller Nullen sagt weniger als
   * gar keine Spalte. Gelesen wird `mean_exec_time` der Sicht, nicht
   * `totalTimeMs / calls`: Die Sicht rechnet den Mittelwert ungerundet, die
   * Division aus zwei gerundeten Zahlen waere ungenauer.
   */
  meanTimeUs: number;
  /** Summe der von diesem Statement gelieferten oder geaenderten Zeilen */
  rows: number;
};

export type ProjectStatementResult = {
  source: "postgres";
  /** `false`, wenn `pg_stat_statements` in dieser Datenbank nicht erreichbar ist */
  installed: boolean;
  statements: ProjectStatementDigest[];
  truncated: boolean;
};

/**
 * Betriebszahlen der Projektdatenbank aus `pg_stat_database` (2.46).
 *
 * Alles hier sind Zaehler seit `statsReset`, nicht seit dem Start des
 * Servers. Die Ansicht sagt das ausdruecklich, weil eine Trefferquote von
 * 99 Prozent ueber zwei Minuten etwas anderes ist als ueber zwei Wochen.
 */
export type ProjectDatabaseActivity = {
  commits: number;
  rollbacks: number;
  /** Bloecke, die von der Platte kamen */
  blocksRead: number;
  /** Bloecke, die schon im Cache lagen; daraus rechnet die Ansicht die Trefferquote */
  blocksHit: number;
  deadlocks: number;
  tempFiles: number;
  tempBytes: number;
  /** Offene Backends dieser Datenbank, wie `pg_stat_database` sie zaehlt */
  backends: number;
  /** `current_setting('max_connections')` des Servers, nicht dieser Datenbank */
  maxConnections: number;
  /** Zeitpunkt des letzten Zuruecksetzens, UTC-Text; null heisst nie zurueckgesetzt */
  statsReset: string | null;
};

/**
 * Eine Gruppe offener Verbindungen (2.46): Rolle, Zustand, Anzahl, Alter der
 * aeltesten Sitzung in Sekunden.
 *
 * Eine Zeile je Gruppe, nie eine je Sitzung. Eine einzelne Sitzung ist ein
 * Mensch bei der Arbeit; eine Anzahl ist eine Betriebszahl. Der Abfragetext,
 * `client_addr` und `backend_xmin` stehen ausdruecklich nicht hier: Ein
 * Abfragetext kann ein Literal eines anderen Mandanten tragen.
 */
export type ProjectConnectionGroup = {
  role: string;
  /** `active`, `idle`, `idle in transaction`, ... oder `unknown` */
  state: string;
  count: number;
  /** Alter der aeltesten Sitzung dieser Gruppe in Sekunden, aus `backend_start` */
  oldestSeconds: number;
};

export type ProjectActivityResult = {
  source: "postgres";
  database: ProjectDatabaseActivity;
  connections: ProjectConnectionGroup[];
  truncated: boolean;
};

export type ProjectPolicy = {
  name: string;
  table: string;
  permissive: boolean;
  command: "select" | "insert" | "update" | "delete" | "all";
  /** `public` steht fuer alle Rollen */
  roles: string[];
  usingExpression: string | null;
  checkExpression: string | null;
};

export type ProjectPolicyResult = {
  source: "postgres";
  schema: string;
  policies: ProjectPolicy[];
  truncated: boolean;
};

/**
 * Was PostgreSQL bei einer geloeschten oder geaenderten Elternzeile tut. Der
 * Katalog schreibt einen Buchstaben; hier stehen Worte.
 */
export type ProjectForeignKeyAction = "no_action" | "restrict" | "cascade" | "set_null" | "set_default";

export type ProjectForeignKey = {
  name: string;
  /** Die verweisende Tabelle; sie liegt im abgefragten Schema */
  table: string;
  /** Die verweisenden Spalten, in der Reihenfolge des Schluessels */
  columns: string[];
  /** Das Schema der Zieltabelle; kann ein anderes als das abgefragte sein */
  referencedSchema: string;
  referencedTable: string;
  /** Die Zielspalten, in derselben Reihenfolge wie `columns` */
  referencedColumns: string[];
  onDelete: ProjectForeignKeyAction;
  onUpdate: ProjectForeignKeyAction;
};

export type ProjectForeignKeyResult = {
  source: "postgres";
  schema: string;
  foreignKeys: ProjectForeignKey[];
  truncated: boolean;
};

export type ProjectEnumType = {
  name: string;
  /** In Sortierreihenfolge des Typs */
  labels: string[];
};

export type ProjectEnumTypeResult = {
  source: "postgres";
  schema: string;
  types: ProjectEnumType[];
  truncated: boolean;
};

export type ProjectExtension = {
  name: string;
  defaultVersion: string;
  /** null, wenn die Erweiterung verfuegbar, aber nicht installiert ist */
  installedVersion: string | null;
  schema: string | null;
  comment: string | null;
};

export type ProjectExtensionResult = {
  source: "postgres";
  extensions: ProjectExtension[];
  truncated: boolean;
};

export type ProjectRole = {
  name: string;
  superuser: boolean;
  createDatabase: boolean;
  createRole: boolean;
  inherit: boolean;
  login: boolean;
  replication: boolean;
  bypassRowSecurity: boolean;
  /** null heisst unbegrenzt */
  connectionLimit: number | null;
  validUntil: string | null;
};

export type ProjectRoleResult = {
  source: "postgres";
  roles: ProjectRole[];
  truncated: boolean;
};

export type ProjectPublication = {
  name: string;
  owner: string;
  publishInsert: boolean;
  publishUpdate: boolean;
  publishDelete: boolean;
  publishTruncate: boolean;
  allTables: boolean;
  /** `schema.table`, oder `schema.*` bei FOR TABLES IN SCHEMA; leer bei FOR ALL TABLES */
  tables: string[];
};

export type ProjectPublicationResult = {
  source: "postgres";
  publications: ProjectPublication[];
  truncated: boolean;
};

/**
 * Ein Replikations-Slot (2.74), aus `pg_catalog.pg_replication_slots`.
 *
 * Der Slot ist die Stelle, an der Replikation im Betrieb weh tut. Er merkt
 * sich, bis wohin ein Konsument gelesen hat, und PostgreSQL haelt dafuer jedes
 * WAL-Segment ab `restart_lsn` fest. Liest niemand mehr, waechst der Rueckstand
 * weiter, bis die Platte voll ist; das ist kein Fehlerfall, sondern die
 * zugesagte Arbeitsweise eines Slots.
 *
 * `retainedBytes` ist darum die Zahl dieser Antwort. Sie ist der Abstand
 * zwischen der Schreibposition des Servers und `restart_lsn`, gemessen in
 * Bytes WAL. `null` heisst, der Slot hat noch keine Position reserviert; dann
 * haelt er auch nichts fest.
 *
 * `safeBytes` kommt aus `safe_wal_size` und sagt, wie viel WAL noch
 * geschrieben werden darf, bevor dieser Slot ungueltig wird. `null` heisst
 * nicht „sicher", sondern `max_slot_wal_keep_size = -1`: Es gibt keine Grenze,
 * bei der PostgreSQL den Slot fallen laesst, statt weiter WAL zu halten.
 *
 * `restart_lsn` selbst steht nicht in der Antwort. Eine LSN ist eine Position
 * im WAL und keine Betriebsangabe, die eine Weboberflaeche jemandem erklaeren
 * kann; die Zahl, auf die es ankommt, ist der Abstand.
 */
export type ProjectReplicationSlot = {
  name: string;
  /** `physical` gehoert zu einem Standby, `logical` zu einem Dekodier-Plugin */
  slotType: "physical" | "logical";
  /** Das Ausgabe-Plugin eines logischen Slots; bei einem physischen `null` */
  plugin: string | null;
  /** Die Datenbank, an die ein logischer Slot gebunden ist; bei einem physischen `null` */
  database: string | null;
  /** Ein temporaerer Slot verschwindet mit der Sitzung, die ihn angelegt hat */
  temporary: boolean;
  /** Ob gerade ein Konsument daran haengt. `false` und ein wachsender Rueckstand ist der schlechte Fall */
  active: boolean;
  /** `reserved`, `extended`, `unreserved` oder `lost`; `null`, wenn der Slot keine Position hat */
  walStatus: "reserved" | "extended" | "unreserved" | "lost" | null;
  /** WAL in Bytes, das dieser Slot festhaelt; `null` bei einem Slot ohne Position */
  retainedBytes: number | null;
  /** WAL in Bytes bis zur Ungueltigkeit; `null` heisst: keine Grenze gesetzt */
  safeBytes: number | null;
};

/**
 * Ein Abonnement dieser Datenbank (2.74), aus `pg_catalog.pg_subscription`.
 *
 * **Ohne `subconninfo`, und zwar ohne sie auch nur auszuwaehlen.** Dort steht
 * die Verbindungszeichenfolge zum Herausgeber, und in ihr steht im Regelfall
 * ein Passwort. PostgreSQL entzieht `public` das Recht auf genau diese Spalte
 * und laesst den Rest der Tabelle lesbar; QKERN verlaesst sich darauf nicht,
 * sondern fragt die Spalte nicht. Die Leserolle eines Projekts kann morgen eine
 * andere sein, die Zusage dieser Antwort soll es nicht.
 *
 * Aus demselben Grund fehlt `suborigin`: Der Wert ist zwar kein Geheimnis,
 * beschreibt aber den Herausgeber und nicht diese Datenbank.
 */
export type ProjectReplicationSubscription = {
  name: string;
  owner: string;
  /** Ein abgeschaltetes Abonnement holt nichts und haelt drueben trotzdem einen Slot */
  enabled: boolean;
  /** Der Slot beim Herausgeber, den dieses Abonnement benutzt; `null` bei `slot_name = NONE` */
  slotName: string | null;
  /** Die Publikationen, die dieses Abonnement drueben liest */
  publications: string[];
};

/**
 * Was PostgreSQL ueber die Replikation dieser Datenbank hergibt (2.74).
 *
 * Vier Auskuenfte an einem Stueck, weil sie nur zusammen etwas bedeuten: Ohne
 * `walLevel = logical` gibt es keine logische Replikation, und ein Slot ohne
 * Konsument ist nur an seinem Rueckstand zu erkennen.
 *
 * Die Publikationen kommen aus derselben Lesung wie auf der Seite
 * Publikationen (2.20); es gibt dafuer genau eine Stelle im Code.
 *
 * Ausdruecklich nicht enthalten: jede Verbindungsangabe. Kein Host, kein Port,
 * keine Zeichenfolge, kein Passwort, weder zum Herausgeber eines Abonnements
 * noch zu dieser Datenbank selbst.
 */
export type ProjectReplicationResult = {
  source: "postgres";
  /** `wal_level` des Servers: unter `logical` gibt es keine logische Replikation */
  walLevel: "minimal" | "replica" | "logical";
  /** `pg_is_in_recovery()`: true heisst, diese Verbindung liest ein Standby */
  inRecovery: boolean;
  publications: ProjectPublication[];
  subscriptions: ProjectReplicationSubscription[];
  slots: ProjectReplicationSlot[];
  /** Gilt fuer die Antwort, nicht fuer eine einzelne Liste */
  truncated: boolean;
};

/**
 * Der Aenderungs-Feed dieser Projektdatenbank (2.86).
 *
 * `qkern_internal.change_feed` ist die Stelle, an der eine erfasste Aenderung
 * liegt, bis ein Leser sie geholt hat. Die Zahl, auf die es im Betrieb
 * ankommt, ist der Rueckstand: wie viele Zeilen oberhalb der gespeicherten
 * Position noch warten. Er wird in der Datenbank gezaehlt und nicht aus zwei
 * Positionen geschaetzt, denn zwischen zwei Positionen koennen Zeilen fehlen,
 * die die Aufbewahrung bereits entfernt hat.
 *
 * `present` unterscheidet zwei Faelle, die eine Null nicht unterscheiden
 * koennte: ein Feed ohne wartende Zeile und eine Projektdatenbank, in der die
 * Erfassung gar nicht eingerichtet ist.
 *
 * `capturedTables` zaehlt die Trigger, die auf `qkern_internal.capture_change`
 * zeigen. Ohne einen davon bleibt der Feed leer, und das ist keine Stoerung,
 * sondern eine Einrichtung, die noch aussteht.
 *
 * Ausdruecklich nicht enthalten: `row_key`. Dort stehen die
 * Primaerschluesselwerte echter Zeilen des Kunden, und eine Logseite braucht
 * sie nicht, um zu sagen, wie viele Aenderungen warten.
 */
export type ProjectChangeFeedResult = {
  source: "postgres";
  present: boolean;
  /** Zeilen, die im Feed liegen. */
  rows: number;
  /** Zeilen oberhalb der uebergebenen Position. */
  backlog: number;
  oldestPosition: number | null;
  newestPosition: number | null;
  oldestCommittedAt: string | null;
  newestCommittedAt: string | null;
  byOperation: { insert: number; update: number; delete: number };
  /** Tabellen mit einem Trigger auf `qkern_internal.capture_change`. */
  capturedTables: number;
};

export type ProjectColumnPrivilege = {
  table: string;
  column: string;
  /** `public` steht fuer alle Rollen */
  grantee: string;
  privileges: Array<{ type: "select" | "insert" | "update" | "references"; grantable: boolean }>;
};

export type ProjectColumnPrivilegeResult = {
  source: "postgres";
  schema: string;
  privileges: ProjectColumnPrivilege[];
  truncated: boolean;
};

/**
 * Ein installierter Foreign Data Wrapper (2.72), aus
 * `pg_catalog.pg_foreign_data_wrapper`.
 *
 * `handler` und `validator` sind Funktionsnamen, wie `regproc` sie schreibt;
 * `null` heisst, die Spalte steht auf 0, der Wrapper hat also keine. Ein
 * Wrapper ohne Validator nimmt jede Option an, die jemand hinschreibt, und
 * genau darum steht er hier: Die Ansicht kann daran zeigen, warum sie
 * Optionswerte nicht ungeprueft weitergibt.
 *
 * `fdwoptions` liest QKERN nicht. Die Optionen des Wrappers selbst tragen bei
 * manchen Erweiterungen Voreinstellungen fuer alle Server darunter, und was
 * darin steht, entscheidet die Erweiterung und nicht PostgreSQL.
 */
export type ProjectForeignDataWrapper = {
  name: string;
  owner: string;
  handler: string | null;
  validator: string | null;
};

/**
 * Eine Option eines Fremdservers (2.72).
 *
 * `value` ist `null`, wenn der Schluessel nicht auf der Liste steht, die ihren
 * Wert zeigen darf (`SHOWN_SERVER_OPTION_KEYS`). Zurueckgehalten und leer sind
 * damit unterscheidbar: ein leerer Wert ist `""`.
 */
export type ProjectForeignServerOption = {
  key: string;
  value: string | null;
};

/**
 * Ein Fremdserver (2.72), aus `pg_catalog.pg_foreign_server`.
 *
 * `type` und `version` sind zwei freie Textfelder, die beim Anlegen gesetzt
 * werden koennen und die PostgreSQL nicht auswertet; meist sind sie leer.
 */
export type ProjectForeignServer = {
  name: string;
  /** Der Wrapper, unter dem dieser Server haengt */
  wrapper: string;
  owner: string;
  type: string | null;
  version: string | null;
  options: ProjectForeignServerOption[];
};

/**
 * Eine Benutzerzuordnung (2.72), aus der Sicht `pg_catalog.pg_user_mappings`.
 *
 * **Ohne Optionen, und zwar ohne sie auch nur zu lesen.** In `umoptions`
 * stehen die Zugangsdaten zum fremden System, beim `postgres_fdw` woertlich
 * als `user` und `password`. PostgreSQL schuetzt die Spalte selbst: Die
 * Katalogtabelle `pg_user_mapping` ist fuer `public` gesperrt, und die Sicht
 * `pg_user_mappings` liefert `umoptions` nur dem Eigentuemer oder einem
 * Superuser. QKERN verlaesst sich darauf nicht, sondern waehlt die Spalte
 * nicht aus: Die Leserolle eines Projekts kann morgen eine andere sein, die
 * Zusage dieser Antwort soll es nicht.
 *
 * `user` ist der Rollenname, oder `public` fuer eine Zuordnung, die fuer alle
 * gilt.
 */
export type ProjectUserMapping = {
  server: string;
  user: string;
};

/** Eine Fremdtabelle (2.72), aus `pg_foreign_table` verbunden mit `pg_class`. */
export type ProjectForeignTable = {
  schema: string;
  name: string;
  /** Der Fremdserver, ueber den diese Tabelle gelesen wird */
  server: string;
};

/**
 * Fremde Datenquellen (2.72), lesend und an einem Stueck: Wrapper, Server,
 * Zuordnungen und Fremdtabellen aus einer Transaktion.
 *
 * `truncated` gilt fuer die Antwort, nicht fuer eine einzelne Liste: Sobald
 * eine der vier Grenzen greift, steht das Feld auf `true`.
 */
export type ProjectForeignDataWrapperResult = {
  source: "postgres";
  wrappers: ProjectForeignDataWrapper[];
  servers: ProjectForeignServer[];
  userMappings: ProjectUserMapping[];
  tables: ProjectForeignTable[];
  truncated: boolean;
};

/**
 * Der TLS-Zustand dieser einen Verbindung (2.53).
 *
 * Zwei verschiedene Aussagen, darum zwei Felder. `encrypted` gilt fuer das
 * Backend, das gerade liest: `pg_stat_ssl` fuer `pg_backend_pid()`, also die
 * Sitzung selbst und nie eine fremde. `serverEnabled` ist die
 * Servereinstellung `ssl`; sie sagt, ob der Server TLS ueberhaupt anbietet,
 * und nicht, ob er es erzwingt. Erzwungen wird TLS in `pg_hba.conf`, und die
 * liest QKERN nicht.
 *
 * `version` ist der Protokollname, den PostgreSQL meldet, oder null ohne TLS.
 * Chiffre, Bits und `client_dn` stehen bewusst nicht hier: Ein Zertifikatsname
 * ist eine Identitaet und keine Betriebszahl.
 */
export type ProjectDatabaseTls = {
  encrypted: boolean;
  version: string | null;
  serverEnabled: boolean;
};

/**
 * Die Verbindungsgrenzen, die der Server selbst haelt (2.53). `null` heisst
 * jeweils unbegrenzt, so wie PostgreSQL das mit -1 ausdrueckt.
 */
export type ProjectDatabaseConnectionLimits = {
  /** `max_connections` des Servers, nicht dieser Datenbank */
  maxConnections: number;
  /** `superuser_reserved_connections`; so viele Plaetze bleiben fuer Superuser frei */
  superuserReserved: number;
  /** `pg_database.datconnlimit` dieser Datenbank */
  database: number | null;
  /** `rolconnlimit` der Rolle, mit der die Data Plane liest */
  role: number | null;
};

/**
 * Was ueber die Projektdatenbank wirklich gilt (2.53): Name und Eigentuemer,
 * der TLS-Zustand, die Verbindungsgrenzen und die Rollen aus demselben
 * Katalog, den `inspectRoles` liest.
 *
 * Ausdruecklich nicht enthalten: Verbindungszeichenfolge, Passwort, Host,
 * Port. Sie stehen im Katalog der Verbindungen, verlassen ihn nie und haben
 * in dieser Antwort keinen Platz.
 */
export type ProjectDatabaseSettingsResult = {
  source: "postgres";
  databaseName: string;
  databaseOwner: string;
  /** Die Rolle, mit der diese Antwort gelesen wurde */
  currentRole: string;
  tls: ProjectDatabaseTls;
  limits: ProjectDatabaseConnectionLimits;
  roles: ProjectRole[];
  truncated: boolean;
};

/**
 * Worauf diese Umgebung laeuft (2.68): die Angaben, die der Server ueber sich
 * selbst macht, und die Groesse der einen Datenbank.
 *
 * Die Abgrenzung zu `inspectSettings` ist gewollt. Dort steht, wie die
 * Datenbank eingestellt ist (Rollen, TLS, Grenzen); hier steht, worauf sie
 * laeuft. Kein Feld wird gerechnet und keines geraten: `serverVersion` und
 * `serverVersionNum` sind zwei Angaben desselben Servers, weil die eine
 * lesbar ist und die andere vergleichbar, und QKERN aus der einen nicht die
 * andere ableiten will.
 *
 * `inRecovery` sagt, ob die Verbindung gerade auf einem Standby liest. Es ist
 * keine Liste von Lese-Replikaten, und die Ansicht sagt das so. Was die
 * Datenbank sonst ueber Replikation hergibt, liest `inspectReplication` (2.74):
 * die Publikationen, die Abonnements und die Slots mit ihrem Rueckstand.
 *
 * Ausdruecklich nicht enthalten: Host, Port, Verbindungszeichenfolge,
 * Datenpfad. Der Ort der Datenbank ist kein Betriebswert.
 */
export type ProjectDatabaseRuntimeResult = {
  source: "postgres";
  /** `server_version`, wie der Server ihn schreibt, etwa `17.2` */
  serverVersion: string;
  /** `server_version_num`, etwa 170002; danach laesst sich vergleichen */
  serverVersionNum: number;
  /** `server_encoding` dieser Datenbank, etwa `UTF8` */
  encoding: string;
  /** `datcollate` aus `pg_database` */
  collate: string;
  /** `datctype` aus `pg_database` */
  ctype: string;
  /**
   * `pg_database_size(current_database())`. Postgres meldet `bigint`; die Zahl
   * bleibt hier eine `number`, weil selbst 9 Petabyte noch in einen sicheren
   * Integer passen. Ueber die Grenze geht sie trotzdem geprueft.
   */
  sizeBytes: number;
  /** `pg_is_in_recovery()`: true heisst, diese Verbindung liest ein Standby */
  inRecovery: boolean;
  /** `pg_postmaster_start_time()`, UTC-Text: seit wann dieser Server laeuft */
  startedAt: string;
};

/**
 * Der Zustand der Projektdatenbank (2.70), aus den Statistiksichten.
 *
 * Das ist ausdruecklich **kein Serverlog**. QKERN hat keinen Dateizugriff auf
 * die Projektdatenbank, und `log_destination` schreibt in Dateien des
 * Servers. Was hier steht, sind Zaehler: Summen seit dem letzten Zuruecksetzen
 * der Statistik. Kein Feld traegt einen Zeitpunkt eines Ereignisses, mit einer
 * benannten Ausnahme (`checksumLastFailure`), und keines traegt einen Wortlaut.
 *
 * Die Abgrenzung zu `inspectActivity` ist gewollt. Dort stehen Durchsatz und
 * die Verbindungen je Rolle und Zustand; hier stehen die Stoerungen und der
 * Schreibweg des Servers. Die Verbindungsgruppen werden hier nicht wiederholt.
 */
export type ProjectDatabaseHealthResult = {
  source: "postgres";
  database: {
    /** `numbackends`: offene Verbindungen dieser Datenbank, kein Zaehler, sondern ein Stand */
    backends: number;
    /** `xact_commit` seit der letzten Ruecksetzung */
    commits: number;
    /** `xact_rollback`: abgebrochene Transaktionen, seit der letzten Ruecksetzung */
    rollbacks: number;
    blocksRead: number;
    blocksHit: number;
    deadlocks: number;
    /** `conflicts`: Abbrueche wegen der Wiederherstellung auf einem Standby */
    conflicts: number;
    tempFiles: number;
    tempBytes: number;
    /**
     * `checksum_failures`. `null` heisst nicht null Fehler, sondern dass
     * dieser Server ohne Datenpruefsummen laeuft und darum nichts zaehlt.
     */
    checksumFailures: number | null;
    /** `checksum_last_failure`, UTC-Text; `null`, solange keine Pruefsumme fiel */
    checksumLastFailure: string | null;
    /** `sessions`: eroeffnete Sitzungen seit der letzten Ruecksetzung */
    sessions: number;
    /** `sessions_abandoned`: die Gegenstelle ging verloren */
    sessionsAbandoned: number;
    /** `sessions_fatal`: ein fataler Fehler beendete die Sitzung */
    sessionsFatal: number;
    /** `sessions_killed`: ein Operator oder ein Zeitlimit beendete die Sitzung */
    sessionsKilled: number;
    /** `stats_reset`, UTC-Text; `null` heisst, es wurde nie zurueckgesetzt */
    statsReset: string | null;
  };
  /**
   * Der Schreibweg des Servers. Er gilt fuer den ganzen Cluster und nicht nur
   * fuer diese eine Datenbank; die Ansicht sagt das.
   */
  writeback: {
    /**
     * Woher die Checkpoint-Zaehler kommen. PostgreSQL 17 hat sie aus
     * `pg_stat_bgwriter` nach `pg_stat_checkpointer` verschoben. QKERN liest
     * die Sicht, die dieser Server wirklich hat, und sagt welche.
     */
    checkpointSource: "pg_stat_checkpointer" | "pg_stat_bgwriter";
    /** Checkpoints, die der Zeitplan ausgeloest hat */
    checkpointsTimed: number;
    /** Checkpoints, die eine Anforderung ausgeloest hat, etwa die Menge an WAL */
    checkpointsRequested: number;
    /** Millisekunden, gerundet: Schreibphase aller Checkpoints */
    checkpointWriteMs: number;
    /** Millisekunden, gerundet: Synchronisationsphase aller Checkpoints */
    checkpointSyncMs: number;
    /** Puffer, die Checkpoints geschrieben haben */
    buffersCheckpoint: number;
    /** Puffer, die der Hintergrundschreiber geschrieben hat */
    buffersClean: number;
    /** Wie oft der Hintergrundschreiber an seiner eigenen Grenze aufhoerte */
    maxwrittenClean: number;
    /** Angeforderte Puffer; die Zahl steigt mit jeder Leseanforderung */
    buffersAlloc: number;
    /** `stats_reset` der Checkpoint-Sicht, UTC-Text */
    checkpointerStatsReset: string | null;
    /** `stats_reset` von `pg_stat_bgwriter`, UTC-Text */
    bgwriterStatsReset: string | null;
  };
};

export type ProjectReadQueryResult = {
  source: "postgres";
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  maxRows: number;
};

/**
 * Der Plan einer lesenden Abfrage (2.69).
 *
 * `analyzed` ist absichtlich ein Literal und kein Schalter: Diese Lesung
 * benutzt `EXPLAIN` ohne `ANALYZE`, die Abfrage wird nicht ausgefuehrt, und
 * die Antwort traegt diese Zusage mit, statt sie nur im Kommentar zu haben.
 * Wollte jemand spaeter `ANALYZE` einbauen, muesste er hier vorbei.
 */
export type ProjectQueryPlanResult = {
  source: "postgres";
  analyzed: false;
  plan: QueryPlanReading;
};

export interface ProjectDataPlanePort {
  inspectSchema(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectSchemaResult>;
  queryReadOnly(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    statement: string,
    limit: number,
  ): Promise<ProjectReadQueryResult>;
  explainReadQuery(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    statement: string,
  ): Promise<ProjectQueryPlanResult>;
  inspectTriggers(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectTriggerResult>;
  inspectFunctions(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectFunctionResult>;
  inspectIndexes(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectIndexResult>;
  inspectPolicies(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectPolicyResult>;
  inspectStatistics(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectStatisticsResult>;
  inspectActivity(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectActivityResult>;
  inspectStatements(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectStatementResult>;
  inspectForeignKeys(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectForeignKeyResult>;
  inspectEnumTypes(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectEnumTypeResult>;
  inspectExtensions(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectExtensionResult>;
  inspectRoles(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectRoleResult>;
  inspectPublications(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectPublicationResult>;
  inspectReplication(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectReplicationResult>;
  /**
   * Der Aenderungs-Feed mit seinem Rueckstand (2.86).
   *
   * `cursorPosition` ist die gespeicherte Position der Webhook-Bruecke aus der
   * Kontrollebene. Sie wird uebergeben und nicht hier gelesen: Sie steht in
   * einer anderen Datenbank, und diese Lesung soll keine zweite Verbindung
   * dorthin aufmachen.
   */
  inspectChangeFeed(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    cursorPosition: number,
  ): Promise<ProjectChangeFeedResult>;
  inspectColumnPrivileges(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectColumnPrivilegeResult>;
  inspectForeignDataWrappers(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectForeignDataWrapperResult>;
  inspectSettings(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectDatabaseSettingsResult>;
  inspectRuntime(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectDatabaseRuntimeResult>;
  inspectDatabaseHealth(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectDatabaseHealthResult>;
}

export type ProjectDataPlaneErrorCode =
  | "DATA_PLANE_DISABLED"
  | "DATA_PLANE_INVALID_INPUT"
  | "DATA_PLANE_NOT_READY"
  | "DATA_PLANE_UNAVAILABLE"
  | "DATA_PLANE_BOUNDARY_REJECTED"
  | "READ_ONLY_QUERY_REQUIRED"
  /** Die Datenbank hat geantwortet, aber die Abfrage laesst sich nicht planen (2.69). */
  | "QUERY_PLAN_REJECTED";

/** Cause-free by design: connection, role, SQL and catalog details never leave the boundary. */
export class ProjectDataPlaneError extends Error {
  constructor(readonly code: ProjectDataPlaneErrorCode) {
    super("The project data plane is unavailable.");
    this.name = "ProjectDataPlaneError";
  }
}
recognisedByName(ProjectDataPlaneError, "ProjectDataPlaneError");

/**
 * Erkennt einen Data-Plane-Fehler an Name und Code statt an der Klasse (2.24,
 * dasselbe Muster wie `isAuthError` aus 2.8): der Dienst lebt auf `globalThis`
 * und ueberlebt Neuladen der Module im Dev-Server; die Route importiert dann
 * eine andere Klasse als die, mit der der Fehler geworfen wurde, `instanceof`
 * ist falsch, und aus einem sauberen 503 wird ein stummes 500. Genau so sah
 * die Console am 25. September aus: jede Katalogansicht "nicht verfuegbar".
 */
export function isProjectDataPlaneError(error: unknown, code?: ProjectDataPlaneErrorCode): error is ProjectDataPlaneError {
  if (!(error instanceof Error) || error.name !== "ProjectDataPlaneError") return false;
  const candidate = error as Error & { code?: unknown };
  if (typeof candidate.code !== "string") return false;
  return code === undefined || candidate.code === code;
}

type SchemaRow = {
  table_name: string;
  relation_kind: "r" | "p" | "v" | "m";
  row_security_enabled: boolean;
  ordinal_position: number;
  column_name: string;
  data_type: string;
  not_null: boolean;
  identity_kind: string;
  generated_kind: string;
};

const SCHEMA_SQL = `
  SELECT relation.relname AS table_name,
         relation.relkind AS relation_kind,
         relation.relrowsecurity AS row_security_enabled,
         attribute.attnum::integer AS ordinal_position,
         attribute.attname AS column_name,
         pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
         attribute.attnotnull AS not_null,
         attribute.attidentity AS identity_kind,
         attribute.attgenerated AS generated_kind
  FROM pg_catalog.pg_namespace AS namespace
  JOIN pg_catalog.pg_class AS relation ON relation.relnamespace = namespace.oid
  JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = relation.oid
  WHERE namespace.nspname = $1
    AND relation.relkind IN ('r', 'p', 'v', 'm')
    AND relation.relpersistence <> 't'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
  ORDER BY relation.relname ASC, attribute.attnum ASC
  LIMIT $2`;

type TriggerRow = {
  trigger_name: string;
  table_name: string;
  enabled_mode: "O" | "A" | "R" | "D";
  is_row: boolean;
  is_before: boolean;
  is_instead: boolean;
  on_insert: boolean;
  on_update: boolean;
  on_delete: boolean;
  on_truncate: boolean;
  function_schema: string;
  function_name: string;
  condition: string | null;
};

const MAX_TRIGGERS = 200;

/**
 * Trigger eines Schemas, aus `pg_trigger` (2.9).
 *
 * Abgeleitet aus `triggers.sql` in supabase/postgres-meta (Apache 2.0), auf
 * `pg_catalog` reduziert: `information_schema.triggers` zeigt nur Trigger auf
 * Tabellen, an denen die Rolle Rechte hat, und listet je Ereignis eine Zeile;
 * hier entscheiden die Bits in `tgtype`. Interne Trigger (Fremdschluessel,
 * Constraints) bleiben draussen, wie bei postgres-meta.
 */
const TRIGGERS_SQL = `
  SELECT trigger.tgname AS trigger_name,
         relation.relname AS table_name,
         trigger.tgenabled AS enabled_mode,
         (trigger.tgtype & 1) <> 0 AS is_row,
         (trigger.tgtype & 2) <> 0 AS is_before,
         (trigger.tgtype & 64) <> 0 AS is_instead,
         (trigger.tgtype & 4) <> 0 AS on_insert,
         (trigger.tgtype & 16) <> 0 AS on_update,
         (trigger.tgtype & 8) <> 0 AS on_delete,
         (trigger.tgtype & 32) <> 0 AS on_truncate,
         function_namespace.nspname AS function_schema,
         function.proname AS function_name,
         substring(pg_catalog.pg_get_triggerdef(trigger.oid) FROM ' WHEN \((.*)\) EXECUTE ') AS condition
  FROM pg_catalog.pg_trigger AS trigger
  JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  JOIN pg_catalog.pg_proc AS function ON function.oid = trigger.tgfoid
  JOIN pg_catalog.pg_namespace AS function_namespace ON function_namespace.oid = function.pronamespace
  WHERE namespace.nspname = $1
    AND NOT trigger.tgisinternal
    AND relation.relpersistence <> 't'
  ORDER BY relation.relname ASC, trigger.tgname ASC
  LIMIT $2`;

type FunctionRow = {
  function_name: string;
  kind: "f" | "p";
  language: string;
  arguments: string;
  identity_arguments: string;
  return_type: string | null;
  returns_set: boolean;
  volatility: "i" | "s" | "v";
  security_definer: boolean;
};

const MAX_FUNCTIONS = 200;

/**
 * Funktionen und Prozeduren eines Schemas, aus `pg_proc` (2.18).
 *
 * Abgeleitet aus `functions.sql` in supabase/postgres-meta (Apache 2.0), auf
 * das reduziert, was die Liste braucht: Signatur und Rueckgabe liefern die
 * Katalogfunktionen `pg_get_function_*`, statt die Argument-Arrays selbst zu
 * entfalten. Aggregate und Fensterfunktionen bleiben draussen (`prokind`),
 * der Quelltext ebenfalls: er kann Geheimnisse tragen und gehoert in eine
 * eigene, bewusst geoeffnete Ansicht.
 */
const FUNCTIONS_SQL = `
  SELECT function.proname AS function_name,
         function.prokind AS kind,
         language.lanname AS language,
         pg_catalog.pg_get_function_arguments(function.oid) AS arguments,
         pg_catalog.pg_get_function_identity_arguments(function.oid) AS identity_arguments,
         pg_catalog.pg_get_function_result(function.oid) AS return_type,
         function.proretset AS returns_set,
         function.provolatile AS volatility,
         function.prosecdef AS security_definer
  FROM pg_catalog.pg_proc AS function
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function.pronamespace
  JOIN pg_catalog.pg_language AS language ON language.oid = function.prolang
  WHERE namespace.nspname = $1
    AND function.prokind IN ('f', 'p')
  ORDER BY function.proname ASC, function.oid ASC
  LIMIT $2`;

type IndexRow = {
  index_name: string;
  table_name: string;
  access_method: string;
  is_unique: boolean;
  is_primary: boolean;
  is_valid: boolean;
  columns: string[];
  definition: string;
  predicate: string | null;
};

type PolicyRow = {
  policy_name: string;
  table_name: string;
  permissive: boolean;
  command: "r" | "a" | "w" | "d" | "*";
  roles: string[];
  using_expression: string | null;
  check_expression: string | null;
};

type ForeignKeyRow = {
  constraint_name: string;
  table_name: string;
  referenced_schema: string;
  referenced_table: string;
  on_delete: string;
  on_update: string;
  columns: string[];
  referenced_columns: string[];
};

type EnumTypeRow = {
  type_name: string;
  labels: string[];
};

const MAX_INDEXES = 200;
const MAX_POLICIES = 200;
const MAX_ENUM_TYPES = 200;
const MAX_ENUM_LABELS = 200;
const MAX_EXPRESSION = 4000;

/**
 * Indizes eines Schemas, aus `pg_index` (2.19). Abgeleitet aus `indexes.sql`
 * in supabase/postgres-meta (Apache 2.0): statt `pg_indexes` (das ueber den
 * Namen joint und bei gleichnamigen Indizes in zwei Schemas doppelt liefert)
 * direkt `pg_get_indexdef`; die Spaltennamen kommen aus `indkey`, Ausdruecke
 * (attnum 0) fallen dort weg und stehen in der Definition.
 */
const INDEXES_SQL = `
  SELECT index_class.relname AS index_name,
         relation.relname AS table_name,
         access_method.amname AS access_method,
         idx.indisunique AS is_unique,
         idx.indisprimary AS is_primary,
         idx.indisvalid AS is_valid,
         COALESCE((SELECT array_agg(attribute.attname::text ORDER BY key.ordinality)
                   FROM unnest(idx.indkey) WITH ORDINALITY AS key(attnum, ordinality)
                   JOIN pg_catalog.pg_attribute AS attribute
                     ON attribute.attrelid = idx.indrelid AND attribute.attnum = key.attnum
                   WHERE key.attnum > 0), ARRAY[]::text[]) AS columns,
         pg_catalog.pg_get_indexdef(idx.indexrelid) AS definition,
         pg_catalog.pg_get_expr(idx.indpred, idx.indrelid) AS predicate
  FROM pg_catalog.pg_index AS idx
  JOIN pg_catalog.pg_class AS index_class ON index_class.oid = idx.indexrelid
  JOIN pg_catalog.pg_class AS relation ON relation.oid = idx.indrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  JOIN pg_catalog.pg_am AS access_method ON access_method.oid = index_class.relam
  WHERE namespace.nspname = $1
    AND relation.relpersistence <> 't'
  ORDER BY relation.relname ASC, index_class.relname ASC
  LIMIT $2`;

type TableStatisticsRow = {
  table_name: string;
  seq_scan: string | number;
  seq_tup_read: string | number;
  idx_scan: string | number;
  live_tuples: string | number;
  dead_tuples: string | number;
  last_autovacuum: string | null;
  last_analyze: string | null;
};

type IndexStatisticsRow = {
  index_name: string;
  table_name: string;
  scans: string | number;
  size_bytes: string | number;
  is_unique: boolean;
  is_primary: boolean;
};

const MAX_STATISTICS_TABLES = 200;
const MAX_STATISTICS_INDEXES = 400;

/**
 * Tabellenstatistik eines Schemas, aus `pg_stat_user_tables` (2.40).
 *
 * Der Leistungsberater rechnet daraus seine Verdachtsfaelle. Die Sicht zeigt
 * Zaehler, keine Zeileninhalte: Scans, geschaetzte lebende und tote Zeilen,
 * Zeitpunkte des letzten Aufraeumens. `last_analyze` und `last_autoanalyze`
 * kommen als `GREATEST` heraus: eine nur automatisch analysierte Tabelle hat
 * eine Stichprobe, und die Regel `never_analyzed` soll sie nicht melden.
 * Zeitpunkte als UTC-Text wie in `ROLES_SQL`, damit kein Treibertyp mitreist.
 */
const TABLE_STATISTICS_SQL = `
  SELECT stat.relname AS table_name,
         stat.seq_scan AS seq_scan,
         stat.seq_tup_read AS seq_tup_read,
         COALESCE(stat.idx_scan, 0) AS idx_scan,
         stat.n_live_tup AS live_tuples,
         stat.n_dead_tup AS dead_tuples,
         to_char(stat.last_autovacuum AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_autovacuum,
         to_char(GREATEST(stat.last_analyze, stat.last_autoanalyze) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_analyze
  FROM pg_catalog.pg_stat_user_tables AS stat
  WHERE stat.schemaname = $1
  ORDER BY stat.relname ASC
  LIMIT $2`;

/**
 * Indexstatistik eines Schemas, aus `pg_stat_user_indexes` (2.40), mit
 * `pg_index` fuer unique und Primaerschluessel und `pg_relation_size` fuer die
 * Groesse. Ein Index mit null Scans ist erst dann ein Befund, wenn er auch
 * Platz kostet; darum gehoert die Groesse dazu.
 */
const INDEX_STATISTICS_SQL = `
  SELECT stat.indexrelname AS index_name,
         stat.relname AS table_name,
         COALESCE(stat.idx_scan, 0) AS scans,
         pg_catalog.pg_relation_size(stat.indexrelid) AS size_bytes,
         idx.indisunique AS is_unique,
         idx.indisprimary AS is_primary
  FROM pg_catalog.pg_stat_user_indexes AS stat
  JOIN pg_catalog.pg_index AS idx ON idx.indexrelid = stat.indexrelid
  WHERE stat.schemaname = $1
  ORDER BY stat.relname ASC, stat.indexrelname ASC
  LIMIT $2`;

type StatementDigestRow = {
  statement_id: string;
  calls: string | number;
  total_time_ms: string | number;
  mean_time_us: string | number;
  rows: string | number;
};

/** Mehr als das braucht keine Regel; der Berater nimmt ohnehin nur die teuersten fuenf. */
const MAX_STATEMENT_DIGESTS = 50;

/**
 * Gibt es `pg_stat_statements` ueberhaupt, und zwar im `search_path` dieser
 * Sitzung? `to_regclass` antwortet mit NULL statt mit einem Fehler, und ein
 * Fehler mitten in der lesenden Transaktion wuerde sie abbrechen. Steht die
 * Erweiterung in einem Schema, das die Leserolle nicht im Pfad hat, gilt sie
 * hier als nicht vorhanden — das ist die ehrlichere Antwort als ein Rateversuch.
 */
const STATEMENTS_INSTALLED_SQL = `
  SELECT to_regclass('pg_stat_statements') IS NOT NULL AS installed`;

/**
 * Der sichere Teilausschnitt aus `pg_stat_statements` (2.57).
 *
 * Drei Zusagen stecken in dieser Abfrage, und jede davon ist der Grund,
 * warum 2.40 die Sicht gar nicht erst angefasst hat:
 *
 * - **`dbid`.** Die Sicht gilt fuer den ganzen Cluster. `dbid` auf die OID
 *   der eigenen Datenbank einzugrenzen ist die Mandantengrenze, nicht eine
 *   Bequemlichkeit — genau wie `datname = current_database()` in 2.46.
 * - **Kein `query`.** Die Spalte wird nicht ausgewaehlt, nicht gefiltert und
 *   nicht sortiert. Ein Utility-Befehl behaelt seine Literale; in dieser
 *   Antwort kann er sie darum nirgends unterbringen. Uebrig bleiben die
 *   normalisierte Kennung und zwei Zaehler.
 * - **`queryid IS NOT NULL`.** Wem `pg_read_all_stats` fehlt, dem zeigt
 *   PostgreSQL fremde Zeilen ohne Kennung. Eine Zeile ohne Kennung waere im
 *   Befund nicht benennbar; sie faellt hier heraus.
 *
 * `total_exec_time` ist `double precision`; `floor(...)::bigint` macht daraus
 * einen Zaehler, den `counter` pruefen kann. Dasselbe gilt fuer
 * `mean_exec_time`, nur in Mikrosekunden (2.67), weil ein abgerundeter
 * Millisekundenwert fuer die meisten Statements 0 waere.
 *
 * **Die Entscheidung gegen den Abfragetext, ausgeschrieben (2.67).** Die
 * Seite Abfrage-Leistung koennte `query` zeigen; `pg_stat_statements` ersetzt
 * die Literale einer Abfrage durch `$1`, `$2` und so weiter, der Text waere
 * also im Normalfall harmlos und fuer den Leser weit nuetzlicher als ein
 * Hash. QKERN zeigt ihn trotzdem nicht, aus drei Gruenden, die alle bleiben:
 *
 * 1. "Im Normalfall" reicht hier nicht. Normalisiert wird nur, was der
 *    Parser als Abfrage sieht. Ein Utility-Befehl (`CREATE ROLE … PASSWORD
 *    '…'`, `ALTER ROLE … PASSWORD '…'`) steht mit seinem Literal in der
 *    Sicht. Wer den Text zeigt, zeigt frueher oder spaeter ein Passwort.
 * 2. Auch eine normalisierte Abfrage traegt noch Bezeichner: Schema-,
 *    Tabellen- und Spaltennamen. `pg_stat_statements` gilt fuer den ganzen
 *    Cluster, und die Eingrenzung auf `dbid` ist eine Zeile SQL, die jemand
 *    im naechsten Umbau entfernen kann. Ein Feld, das keinen Text traegt,
 *    kann auch keinen fremden Text tragen.
 * 3. Die Seite bleibt ohne Text benutzbar. Aufrufe, Gesamtzeit, Mittelwert,
 *    Zeilen und der Anteil an der Gesamtzeit sagen, welches Statement Zeit
 *    kostet. Welches Statement das ist, sagt der Abfrageplan im SQL-Editor,
 *    wo der Text vom Menschen kommt und nicht aus fremden Sitzungen.
 *
 * Der Preis ist echt: Die Seite nennt eine Kennung, keine Abfrage, und muss
 * das wortwoertlich sagen. Das ist die Ehrlichkeit, die hier billiger ist
 * als die Bequemlichkeit.
 */
const STATEMENT_DIGESTS_SQL = `
  SELECT stat.queryid::text AS statement_id,
         stat.calls AS calls,
         floor(stat.total_exec_time)::bigint AS total_time_ms,
         floor(stat.mean_exec_time * 1000)::bigint AS mean_time_us,
         stat.rows AS rows
  FROM pg_stat_statements AS stat
  WHERE stat.dbid = (SELECT database.oid FROM pg_catalog.pg_database AS database
                     WHERE database.datname = current_database())
    AND stat.queryid IS NOT NULL
  ORDER BY stat.total_exec_time DESC, stat.queryid ASC
  LIMIT $1`;

type DatabaseActivityRow = {
  commits: string | number;
  rollbacks: string | number;
  blocks_read: string | number;
  blocks_hit: string | number;
  deadlocks: string | number;
  temp_files: string | number;
  temp_bytes: string | number;
  backends: string | number;
  max_connections: string | number;
  stats_reset: string | null;
};

type ConnectionGroupRow = {
  role_name: string;
  state: string;
  connections: string | number;
  oldest_seconds: string | number;
};

/** Mehr Gruppen als das hat kein Server: Rollen mal sechs Zustaende. */
const MAX_CONNECTION_GROUPS = 200;

/**
 * Betriebszahlen der eigenen Datenbank, aus `pg_stat_database` (2.46).
 *
 * `datname = current_database()` ist keine Bequemlichkeit, sondern die
 * Grenze: Auf einem Cluster stehen in dieser Sicht auch die Zeilen anderer
 * Datenbanken, also anderer Mandanten. Gelesen werden nur Zaehler, kein Name
 * und kein Wert aus einer Tabelle. `max_connections` gilt fuer den ganzen
 * Server und ist der einzige Wert, der nicht aus dieser Zeile stammt.
 */
const DATABASE_ACTIVITY_SQL = `
  SELECT stat.xact_commit AS commits,
         stat.xact_rollback AS rollbacks,
         stat.blks_read AS blocks_read,
         stat.blks_hit AS blocks_hit,
         stat.deadlocks AS deadlocks,
         stat.temp_files AS temp_files,
         stat.temp_bytes AS temp_bytes,
         stat.numbackends AS backends,
         current_setting('max_connections') AS max_connections,
         to_char(stat.stats_reset AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS stats_reset
  FROM pg_catalog.pg_stat_database AS stat
  WHERE stat.datname = current_database()`;

/**
 * Offene Verbindungen je Rolle und Zustand, aus `pg_stat_activity` (2.46).
 *
 * Diese Sicht ist die gefaehrlichste des ganzen Katalogs: Sie traegt den
 * Abfragetext laufender Statements, und fuer eine Rolle mit genug Rechten
 * auch die Sitzungen anderer Datenbanken desselben Clusters. Ein
 * Abfragetext kann ein Literal eines fremden Mandanten enthalten. Darum:
 *
 * - `datname = current_database()` grenzt auf die eigene Datenbank ein.
 * - Ausgewaehlt werden nur `usename`, `state` und zwei Aggregate. `query`,
 *   `backend_xmin`, `client_addr`, `client_hostname`, `application_name`,
 *   `pid` und `query_start` bleiben draussen; keines von ihnen wird
 *   gelesen, keines steht in der Antwort.
 * - `GROUP BY` statt einer Zeile je Sitzung: Eine einzelne Sitzung ist ein
 *   Mensch bei der Arbeit, eine Anzahl ist eine Betriebszahl.
 *
 * Was eine unprivilegierte Rolle nicht sehen darf, fehlt hier einfach;
 * PostgreSQL blendet fremde Sitzungen aus. Die Ansicht sagt das.
 */
const CONNECTION_GROUPS_SQL = `
  SELECT COALESCE(activity.usename::text, 'unknown') AS role_name,
         COALESCE(activity.state, 'unknown') AS state,
         count(*) AS connections,
         COALESCE(floor(EXTRACT(EPOCH FROM (now() - min(activity.backend_start)))), 0) AS oldest_seconds
  FROM pg_catalog.pg_stat_activity AS activity
  WHERE activity.datname = current_database()
  GROUP BY 1, 2
  ORDER BY connections DESC, role_name ASC, state ASC
  LIMIT $1`;

type DatabaseHealthRow = {
  backends: string | number;
  commits: string | number;
  rollbacks: string | number;
  blocks_read: string | number;
  blocks_hit: string | number;
  deadlocks: string | number;
  conflicts: string | number;
  temp_files: string | number;
  temp_bytes: string | number;
  /** `null`, wenn der Server ohne Datenpruefsummen laeuft */
  checksum_failures: string | null;
  checksum_last_failure: string | null;
  sessions: string | number;
  sessions_abandoned: string | number;
  sessions_fatal: string | number;
  sessions_killed: string | number;
  stats_reset: string | null;
};

type WritebackRow = {
  checkpoints_timed: string | number;
  checkpoints_requested: string | number;
  checkpoint_write_ms: string | number;
  checkpoint_sync_ms: string | number;
  buffers_checkpoint: string | number;
  buffers_clean: string | number;
  maxwritten_clean: string | number;
  buffers_alloc: string | number;
  checkpointer_stats_reset: string | null;
  bgwriter_stats_reset: string | null;
};

/**
 * Der Zustand der eigenen Datenbank, aus `pg_stat_database` (2.70).
 *
 * Diese Anweisung steht neben `DATABASE_ACTIVITY_SQL` und wiederholt sie
 * nicht aus Versehen: Dort werden die Zahlen des Durchsatzes gelesen, hier
 * die der Stoerungen. Ueberschneiden tun sich nur die Zaehler, die beide
 * Seiten brauchen, um ueberhaupt eine Aussage zu machen (Commits gegen
 * Rollbacks, Treffer gegen Lesen).
 *
 * `datname = current_database()` ist die Grenze und keine Bequemlichkeit: In
 * dieser Sicht stehen auf einem Cluster auch die Zeilen anderer Mandanten.
 *
 * Gelesen werden nur Zaehler und zwei Zeitpunkte. Kein Name einer Relation,
 * kein Abfragetext, kein Wortlaut einer Fehlermeldung: `pg_stat_database`
 * fuehrt keinen, und QKERN holt ihn sich auch nicht anderswo.
 *
 * `bigint` geht als Text ueber die Grenze, damit der Treiber nichts rundet,
 * was die Pruefung danach nicht mehr sehen koennte.
 */
const DATABASE_HEALTH_SQL = `
  SELECT stat.numbackends AS backends,
         stat.xact_commit::text AS commits,
         stat.xact_rollback::text AS rollbacks,
         stat.blks_read::text AS blocks_read,
         stat.blks_hit::text AS blocks_hit,
         stat.deadlocks::text AS deadlocks,
         stat.conflicts::text AS conflicts,
         stat.temp_files::text AS temp_files,
         stat.temp_bytes::text AS temp_bytes,
         stat.checksum_failures::text AS checksum_failures,
         to_char(stat.checksum_last_failure AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS checksum_last_failure,
         stat.sessions::text AS sessions,
         stat.sessions_abandoned::text AS sessions_abandoned,
         stat.sessions_fatal::text AS sessions_fatal,
         stat.sessions_killed::text AS sessions_killed,
         to_char(stat.stats_reset AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS stats_reset
  FROM pg_catalog.pg_stat_database AS stat
  WHERE stat.datname = current_database()`;

/**
 * Ob dieser Server `pg_stat_checkpointer` schon kennt (2.70).
 *
 * PostgreSQL 17 hat die Checkpoint-Zaehler aus `pg_stat_bgwriter` in eine
 * eigene Sicht verschoben. Eine Anweisung, die beide Spaltensaetze abdeckt,
 * gibt es nicht: Ein Name, den der Katalog nicht kennt, scheitert schon beim
 * Parsen, also auch in einem CASE-Zweig, der nie laeuft. Darum wird zuerst
 * gefragt und dann die passende Anweisung geschickt. `to_regclass` gibt
 * `NULL` statt eines Fehlers, wenn es die Sicht nicht gibt.
 */
const HAS_CHECKPOINTER_SQL = `
  SELECT to_regclass('pg_catalog.pg_stat_checkpointer') IS NOT NULL AS has_checkpointer`;

/**
 * Der Schreibweg ab PostgreSQL 17 (2.70): Checkpoints aus
 * `pg_stat_checkpointer`, der Hintergrundschreiber aus `pg_stat_bgwriter`.
 *
 * Beide Sichten haben genau eine Zeile und gelten fuer den ganzen Cluster,
 * nicht fuer diese eine Datenbank. Das ist keine Luecke in der Eingrenzung:
 * Es sind Zahlen ueber die Arbeit des Servers, keine Zahlen ueber Daten. Die
 * Ansicht sagt es trotzdem, damit niemand sie dieser Datenbank zuschreibt.
 *
 * Die Zeiten kommen als `double precision` in Millisekunden. Gerundet wird
 * hier und nicht in der Console, damit die Grenze eine ganze Zahl pruefen
 * kann statt einer Gleitkommazahl.
 */
const CHECKPOINTER_SQL = `
  SELECT checkpointer.num_timed::text AS checkpoints_timed,
         checkpointer.num_requested::text AS checkpoints_requested,
         round(checkpointer.write_time)::bigint::text AS checkpoint_write_ms,
         round(checkpointer.sync_time)::bigint::text AS checkpoint_sync_ms,
         checkpointer.buffers_written::text AS buffers_checkpoint,
         bgwriter.buffers_clean::text AS buffers_clean,
         bgwriter.maxwritten_clean::text AS maxwritten_clean,
         bgwriter.buffers_alloc::text AS buffers_alloc,
         to_char(checkpointer.stats_reset AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS checkpointer_stats_reset,
         to_char(bgwriter.stats_reset AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS bgwriter_stats_reset
  FROM pg_catalog.pg_stat_checkpointer AS checkpointer,
       pg_catalog.pg_stat_bgwriter AS bgwriter`;

/**
 * Derselbe Schreibweg vor PostgreSQL 17 (2.70), als alles noch in
 * `pg_stat_bgwriter` stand.
 *
 * Die Antwort hat dieselbe Form wie die der neuen Sicht, damit die Ansicht
 * nur eine kennt. Nur `checkpointer_stats_reset` bleibt leer, und zwar
 * wahrheitsgemaess: Es gibt keine zweite Sicht, die zurueckgesetzt werden
 * koennte. Die Antwort nennt darum auch ihre Quelle, statt die neue Sicht
 * vorzutaeuschen.
 */
const LEGACY_BGWRITER_SQL = `
  SELECT bgwriter.checkpoints_timed::text AS checkpoints_timed,
         bgwriter.checkpoints_req::text AS checkpoints_requested,
         round(bgwriter.checkpoint_write_time)::bigint::text AS checkpoint_write_ms,
         round(bgwriter.checkpoint_sync_time)::bigint::text AS checkpoint_sync_ms,
         bgwriter.buffers_checkpoint::text AS buffers_checkpoint,
         bgwriter.buffers_clean::text AS buffers_clean,
         bgwriter.maxwritten_clean::text AS maxwritten_clean,
         bgwriter.buffers_alloc::text AS buffers_alloc,
         NULL::text AS checkpointer_stats_reset,
         to_char(bgwriter.stats_reset AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS bgwriter_stats_reset
  FROM pg_catalog.pg_stat_bgwriter AS bgwriter`;

/**
 * Row-Level-Security-Regeln eines Schemas, aus `pg_policy` (2.19). Abgeleitet
 * aus `policies.sql` in supabase/postgres-meta (Apache 2.0). `polroles = {0}`
 * heisst PUBLIC, also alle Rollen; USING und WITH CHECK kommen als Text aus
 * `pg_get_expr`. Ob RLS auf der Tabelle eingeschaltet ist, sagt `/schema`.
 */
const POLICIES_SQL = `
  SELECT policy.polname AS policy_name,
         relation.relname AS table_name,
         policy.polpermissive AS permissive,
         policy.polcmd AS command,
         CASE WHEN policy.polroles = '{0}'::oid[] THEN ARRAY['public']::text[]
              ELSE ARRAY(SELECT member.rolname::text FROM pg_catalog.pg_roles AS member
                         WHERE member.oid = ANY (policy.polroles) ORDER BY member.rolname) END AS roles,
         pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) AS using_expression,
         pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) AS check_expression
  FROM pg_catalog.pg_policy AS policy
  JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = $1
  ORDER BY relation.relname ASC, policy.polname ASC
  LIMIT $2`;

const MAX_FOREIGN_KEYS = 400;
/** Ein zusammengesetzter Schluessel darf hoechstens so viele Spalten tragen; PostgreSQL erlaubt 32. */
const MAX_FOREIGN_KEY_COLUMNS = 32;

/**
 * Fremdschluessel eines Schemas, aus `pg_constraint` mit `contype = 'f'`
 * (2.41). Der Schema-Visualizer zeichnet daraus die Linien.
 *
 * `conkey` und `confkey` sind Arrays von Spaltennummern, und ihre Reihenfolge
 * ist die des Schluessels: bei `FOREIGN KEY (b, a) REFERENCES p (y, x)` gehoert
 * `b` zu `y`. `unnest ... WITH ORDINALITY` haelt genau diese Reihenfolge fest;
 * `array_agg` ohne `ORDER BY` waere sonst die Reihenfolge des Joins, und das
 * Bild wuerde die Spalten verwechseln. Dasselbe Muster wie `indkey` in
 * `INDEXES_SQL`.
 *
 * Gefiltert wird nach dem Schema der verweisenden Tabelle. Zeigt ein Schluessel
 * in ein anderes Schema, bleibt er drin und nennt jenes Schema; wegwerfen
 * waere eine Luege im Bild.
 */
const FOREIGN_KEYS_SQL = `
  SELECT fk.conname AS constraint_name,
         relation.relname AS table_name,
         referenced_namespace.nspname AS referenced_schema,
         referenced.relname AS referenced_table,
         fk.confdeltype AS on_delete,
         fk.confupdtype AS on_update,
         COALESCE((SELECT array_agg(attribute.attname::text ORDER BY key.ordinality)
                   FROM unnest(fk.conkey) WITH ORDINALITY AS key(attnum, ordinality)
                   JOIN pg_catalog.pg_attribute AS attribute
                     ON attribute.attrelid = fk.conrelid AND attribute.attnum = key.attnum), ARRAY[]::text[]) AS columns,
         COALESCE((SELECT array_agg(attribute.attname::text ORDER BY key.ordinality)
                   FROM unnest(fk.confkey) WITH ORDINALITY AS key(attnum, ordinality)
                   JOIN pg_catalog.pg_attribute AS attribute
                     ON attribute.attrelid = fk.confrelid AND attribute.attnum = key.attnum), ARRAY[]::text[]) AS referenced_columns
  FROM pg_catalog.pg_constraint AS fk
  JOIN pg_catalog.pg_class AS relation ON relation.oid = fk.conrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  JOIN pg_catalog.pg_class AS referenced ON referenced.oid = fk.confrelid
  JOIN pg_catalog.pg_namespace AS referenced_namespace ON referenced_namespace.oid = referenced.relnamespace
  WHERE namespace.nspname = $1
    AND fk.contype = 'f'
  ORDER BY relation.relname ASC, fk.conname ASC
  LIMIT $2`;

/**
 * Aufzaehlungstypen eines Schemas, aus `pg_type` und `pg_enum` (2.19).
 * Abgeleitet aus `types.sql` in supabase/postgres-meta (Apache 2.0), auf
 * `typtype = 'e'` reduziert; die Werte in der Sortierreihenfolge des Typs.
 */
const ENUM_TYPES_SQL = `
  SELECT type.typname AS type_name,
         ARRAY(SELECT enum.enumlabel::text FROM pg_catalog.pg_enum AS enum
               WHERE enum.enumtypid = type.oid ORDER BY enum.enumsortorder) AS labels
  FROM pg_catalog.pg_type AS type
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type.typnamespace
  WHERE namespace.nspname = $1
    AND type.typtype = 'e'
  ORDER BY type.typname ASC
  LIMIT $2`;

type ExtensionRow = { name: string; default_version: string; installed_version: string | null; schema: string | null; comment: string | null };
type RoleRow = {
  role_name: string; superuser: boolean; create_database: boolean; create_role: boolean; inherit: boolean;
  login: boolean; replication: boolean; bypass_rls: boolean; connection_limit: number; valid_until: string | null;
};
type PublicationRow = {
  publication_name: string; owner: string; publish_insert: boolean; publish_update: boolean; publish_delete: boolean;
  publish_truncate: boolean; all_tables: boolean; tables: string[];
};
type ColumnPrivilegeRow = { table_name: string; column_name: string; grantee: string; privilege_type: string; is_grantable: boolean };
/** Der Rueckstand und die Restfrist kommen als `numeric` und `bigint`, also als Text (2.74). */
type ReplicationSlotRow = {
  slot_name: string; slot_type: string; plugin: string | null; database_name: string | null;
  temporary: boolean; active: boolean; wal_status: string | null;
  retained_bytes: string | null; safe_bytes: string | null;
};
type ReplicationSubscriptionRow = {
  subscription_name: string; owner: string; enabled: boolean; slot_name: string | null; publications: string[];
};
type ReplicationStateRow = { wal_level: string; in_recovery: boolean };

type ChangeFeedRow = {
  rows: string;
  backlog: string;
  oldest_position: string | null;
  newest_position: string | null;
  oldest_committed_at: Date | null;
  newest_committed_at: Date | null;
  inserts: string;
  updates: string;
  deletes: string;
};
type ForeignDataWrapperRow = { wrapper_name: string; owner: string; handler: string | null; validator: string | null };
type ForeignServerRow = {
  server_name: string; wrapper_name: string; owner: string;
  server_type: string | null; server_version: string | null; options: string[];
};
type UserMappingRow = { server_name: string; user_name: string };
type ForeignTableRow = { schema_name: string; table_name: string; server_name: string };

const MAX_EXTENSIONS = 400;
const MAX_ROLES = 200;
const MAX_PUBLICATIONS = 100;
const MAX_PUBLICATION_TABLES = 500;
const MAX_COLUMN_PRIVILEGE_ROWS = 2000;
const MAX_COLUMN_PRIVILEGES = 500;
const VERSION = /^[A-Za-z0-9._+-]{1,64}$/;
// Erweiterungsnamen duerfen Bindestriche tragen (`uuid-ossp`), anders als Bezeichner.
const EXTENSION_NAME = /^[a-z_][a-z0-9_-]{0,62}$/;

/**
 * Erweiterungen (2.20): alle verfuegbaren, mit installierter Version, wo sie
 * installiert sind. Abgeleitet aus `extensions.sql` in postgres-meta (Apache
 * 2.0). Ob eine Erweiterung installiert werden darf, entscheidet weiter die
 * Migration; hier wird nur gelesen.
 */
const EXTENSIONS_SQL = `
  SELECT available.name AS name,
         available.default_version AS default_version,
         installed.extversion AS installed_version,
         namespace.nspname AS schema,
         available.comment AS comment
  FROM pg_catalog.pg_available_extensions() AS available(name, default_version, comment)
  LEFT JOIN pg_catalog.pg_extension AS installed ON installed.extname = available.name
  LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = installed.extnamespace
  ORDER BY (installed.extversion IS NULL) ASC, available.name ASC
  LIMIT $1`;

/**
 * Rollen (2.20), aus `pg_roles`, ohne die vordefinierten `pg_*`-Rollen.
 * Abgeleitet aus `roles.sql` in postgres-meta (Apache 2.0), ohne Passwort
 * (in `pg_roles` ohnehin maskiert) und ohne Verbindungszaehler
 * (`pg_stat_activity` zeigt fremde Sitzungen nur mit Sonderrecht).
 *
 * `pg_roles` ist clusterweit. Seit 2.23 (Review-Befund) bleiben nur Rollen,
 * die diese Datenbank betreffen: die eigene, Eigentuemer von Objekten in
 * Anwendungsschemata, Empfaenger von Tabellen- oder Spaltenrechten dort,
 * oder in einer Policy genannt. Superuser bleiben draussen; auf einem
 * geteilten Cluster gehoeren Steuerungs- und Nachbarrollen nicht in die
 * Ansicht eines Projekts.
 */
const ROLES_SQL = `
  SELECT account.rolname AS role_name,
         account.rolsuper AS superuser,
         account.rolcreatedb AS create_database,
         account.rolcreaterole AS create_role,
         account.rolinherit AS inherit,
         account.rolcanlogin AS login,
         account.rolreplication AS replication,
         account.rolbypassrls AS bypass_rls,
         account.rolconnlimit AS connection_limit,
         to_char(account.rolvaliduntil AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS valid_until
  FROM pg_catalog.pg_roles AS account
  WHERE NOT pg_catalog.starts_with(account.rolname, 'pg_')
    AND NOT account.rolsuper
    AND (account.rolname = current_user
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_class AS relation
                 JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
                 WHERE relation.relowner = account.oid
                   AND namespace.nspname <> 'information_schema' AND NOT pg_catalog.starts_with(namespace.nspname, 'pg_'))
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_class AS relation
                 JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
                 CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
                 WHERE acl.grantee = account.oid
                   AND namespace.nspname <> 'information_schema' AND NOT pg_catalog.starts_with(namespace.nspname, 'pg_'))
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS attribute
                 JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
                 JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
                 CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
                 WHERE acl.grantee = account.oid AND attribute.attnum > 0
                   AND namespace.nspname <> 'information_schema' AND NOT pg_catalog.starts_with(namespace.nspname, 'pg_'))
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS policy WHERE account.oid = ANY (policy.polroles)))
  ORDER BY account.rolname ASC
  LIMIT $1`;

type SettingsRow = {
  database_name: string;
  database_owner: string;
  current_role_name: string;
  connection_encrypted: boolean;
  tls_version: string | null;
  server_tls_enabled: boolean;
  max_connections: number;
  superuser_reserved: number;
  database_connection_limit: number;
  role_connection_limit: number;
};

/**
 * Was ueber die Projektdatenbank gilt (2.53): Name, Eigentuemer, TLS-Zustand
 * und Verbindungsgrenzen, in einer Anweisung.
 *
 * Gelesen wird nur, was der Server ohnehin ueber sich selbst meldet. Aus
 * `pg_stat_ssl` kommt ausschliesslich die Zeile des eigenen Backends
 * (`pg_backend_pid()`); fremde Sitzungen werden nicht einmal betrachtet, und
 * `client_dn` wird nicht ausgewaehlt. `current_setting('ssl', true)` kann auf
 * einem Server ohne TLS-Unterstuetzung fehlen, darum die Vorgabe `off` statt
 * eines Fehlers.
 *
 * Es gibt hier keine Adresse: weder `inet_server_addr` noch
 * `inet_server_port`, weder `client_addr` noch ein Pfad. Der Ort der
 * Datenbank ist kein Betriebswert und hat in einer Antwort an den Mandanten
 * nichts verloren.
 */
const SETTINGS_SQL = `
  SELECT current_database() AS database_name,
         pg_catalog.pg_get_userbyid(database.datdba) AS database_owner,
         current_user::text AS current_role_name,
         COALESCE(ssl.ssl, false) AS connection_encrypted,
         ssl.version AS tls_version,
         COALESCE(current_setting('ssl', true), 'off') = 'on' AS server_tls_enabled,
         current_setting('max_connections')::integer AS max_connections,
         COALESCE(current_setting('superuser_reserved_connections', true), '0')::integer AS superuser_reserved,
         database.datconnlimit::integer AS database_connection_limit,
         account.rolconnlimit::integer AS role_connection_limit
  FROM pg_catalog.pg_database AS database
  JOIN pg_catalog.pg_roles AS account ON account.rolname = current_user
  LEFT JOIN pg_catalog.pg_stat_ssl AS ssl ON ssl.pid = pg_catalog.pg_backend_pid()
  WHERE database.datname = current_database()`;

type RuntimeRow = {
  server_version: string;
  server_version_num: number;
  server_encoding: string;
  collate: string;
  ctype: string;
  /** `bigint` kommt als Text aus dem Treiber; die Pruefung sieht ihn so */
  size_bytes: string;
  in_recovery: boolean;
  started_at: string;
};

/**
 * Worauf diese Umgebung laeuft (2.68), in einer Anweisung.
 *
 * Alles hier ist Auskunft des Servers ueber sich selbst. `current_setting`
 * fuer Version und Kodierung, `pg_database` fuer Sortierung und
 * Zeichenklassen der einen Datenbank, `pg_database_size` fuer ihre Groesse.
 *
 * `pg_is_in_recovery()` steht dabei, weil es die Auskunft ueber Replikation
 * ist, die zu dieser Verbindung gehoert; den Rest liest `inspectReplication`
 * (2.74) aus dem Katalog. Eine Liste von
 * Lese-Replikaten gibt es nicht: die stuende in `pg_stat_replication` des
 * Primaerservers und setzt ein Recht voraus, das die Leserolle eines Projekts
 * nicht hat und nicht bekommen soll.
 *
 * Keine Adresse, kein Pfad: weder `inet_server_addr` noch `data_directory`.
 */
const RUNTIME_SQL = `
  SELECT current_setting('server_version') AS server_version,
         current_setting('server_version_num')::integer AS server_version_num,
         current_setting('server_encoding') AS server_encoding,
         database.datcollate AS collate,
         database.datctype AS ctype,
         pg_catalog.pg_database_size(database.oid)::text AS size_bytes,
         pg_catalog.pg_is_in_recovery() AS in_recovery,
         to_char(pg_catalog.pg_postmaster_start_time() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS started_at
  FROM pg_catalog.pg_database AS database
  WHERE database.datname = current_database()`;

/** Wie `server_version` aussehen darf: `17.2`, `16.4 (Debian 16.4-1)`, `18beta1`. */
const SERVER_VERSION = /^[0-9][0-9A-Za-z.()+~ _-]{0,63}$/;
/** Kodierung, Sortierung und Zeichenklasse sind Katalognamen, keine Prosa. */
const ENCODING = /^[A-Za-z0-9_]{1,40}$/;
const LOCALE_NAME = /^[A-Za-z0-9._@ -]{1,100}$/;
const UNSIGNED_DECIMAL = /^[0-9]{1,20}$/;
const UTC_MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * Publikationen (2.20), aus `pg_publication` und `pg_publication_rel`.
 * Abgeleitet aus `publications.sql` in postgres-meta (Apache 2.0); die
 * Tabellen als `schema.name`, leer bei FOR ALL TABLES.
 */
const PUBLICATIONS_SQL = `
  SELECT publication.pubname AS publication_name,
         publication.pubowner::regrole::text AS owner,
         publication.pubinsert AS publish_insert,
         publication.pubupdate AS publish_update,
         publication.pubdelete AS publish_delete,
         publication.pubtruncate AS publish_truncate,
         publication.puballtables AS all_tables,
         COALESCE((SELECT array_agg(entry ORDER BY entry) FROM (
                     SELECT namespace.nspname || '.' || relation.relname AS entry
                     FROM pg_catalog.pg_publication_rel AS member
                     JOIN pg_catalog.pg_class AS relation ON relation.oid = member.prrelid
                     JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
                     WHERE member.prpubid = publication.oid
                     UNION ALL
                     SELECT namespace.nspname || '.*'
                     FROM pg_catalog.pg_publication_namespace AS member
                     JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = member.pnnspid
                     WHERE member.pnpubid = publication.oid) AS entries), ARRAY[]::text[]) AS tables
  FROM pg_catalog.pg_publication AS publication
  ORDER BY publication.pubname ASC
  LIMIT $1`;

/**
 * Die Replikations-Slots (2.74), mit Zustand und Rueckstand.
 *
 * Der Rueckstand wird in der Datenbank gerechnet und nicht in TypeScript, weil
 * nur die Datenbank beide Positionen im selben Moment kennt. Der Bezugspunkt
 * haengt davon ab, wo diese Verbindung liest: Auf einem Primaerserver ist es
 * die Schreibposition (`pg_current_wal_lsn`), auf einem Standby die Position,
 * bis zu der WAL empfangen wurde (`pg_last_wal_receive_lsn`). Beide sind nie
 * hinter `restart_lsn`, darum ist die Differenz nie negativ, und ein negativer
 * Wert faellt an der Grenze durch statt zu null gebogen zu werden.
 *
 * `restart_lsn` selbst wird nicht ausgewaehlt. Ausgewaehlt wird auch keine der
 * Transaktionsnummern (`xmin`, `catalog_xmin`): Sie sagen etwas ueber das
 * Aufraeumen und nichts ueber die Replikation, und die Seite soll keine Spalte
 * zeigen, die sie nicht erklaeren kann.
 *
 * `pg_replication_slots` ist eine Sicht auf eine Funktion und fuer jede Rolle
 * lesbar; sie traegt keine Verbindungsangabe.
 */
const REPLICATION_SLOTS_SQL = `
  SELECT slot.slot_name AS slot_name,
         slot.slot_type AS slot_type,
         slot.plugin AS plugin,
         slot.database AS database_name,
         slot.temporary AS temporary,
         slot.active AS active,
         slot.wal_status AS wal_status,
         CASE WHEN slot.restart_lsn IS NULL THEN NULL ELSE
           pg_catalog.pg_wal_lsn_diff(
             CASE WHEN pg_catalog.pg_is_in_recovery()
                  THEN pg_catalog.pg_last_wal_receive_lsn()
                  ELSE pg_catalog.pg_current_wal_lsn() END,
             slot.restart_lsn)::bigint::text END AS retained_bytes,
         slot.safe_wal_size::text AS safe_bytes
  FROM pg_catalog.pg_replication_slots AS slot
  ORDER BY slot.slot_name ASC
  LIMIT $1`;

/**
 * Die Abonnements dieser Datenbank (2.74), ohne `subconninfo`.
 *
 * Die fehlende Spalte ist der Punkt dieser Lesung. In `subconninfo` steht die
 * Verbindungszeichenfolge zum Herausgeber, und darin steht ueblicherweise ein
 * Passwort; PostgreSQL entzieht `public` das Recht auf diese eine Spalte und
 * laesst die uebrigen lesbar. QKERN fragt sie nicht, und damit kann sie auch
 * dann nicht herauskommen, wenn die Lesung morgen mit mehr Rechten laeuft.
 *
 * `pg_subscription` ist clusterweit. Die Einschraenkung auf `subdbid` ist
 * darum keine Bequemlichkeit: Eine Antwort dieser Seite beschreibt genau die
 * eine Datenbank dieser Umgebung, und ein Abonnement einer fremden Datenbank
 * desselben Servers gehoert nicht dazu.
 *
 * `subslotname` ist ein Slotname beim Herausgeber, kein Geheimnis; er steht
 * dabei, weil er die einzige Bruecke zwischen dem Abonnement hier und dem Slot
 * drueben ist.
 */
const REPLICATION_SUBSCRIPTIONS_SQL = `
  SELECT subscription.subname AS subscription_name,
         subscription.subowner::regrole::text AS owner,
         subscription.subenabled AS enabled,
         subscription.subslotname AS slot_name,
         COALESCE(subscription.subpublications, ARRAY[]::text[]) AS publications
  FROM pg_catalog.pg_subscription AS subscription
  WHERE subscription.subdbid = (
    SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database())
  ORDER BY subscription.subname ASC
  LIMIT $1`;

/**
 * Die zwei Schalter, ohne die der Rest nichts bedeutet (2.74).
 *
 * `wal_level` entscheidet, ob logische Replikation ueberhaupt moeglich ist.
 * `pg_is_in_recovery()` sagt, ob diese Verbindung ein Standby liest; dieselbe
 * Auskunft steht in `inspectRuntime` (2.68), und sie steht hier ein zweites
 * Mal, weil die Seite sonst den Rueckstand ohne seinen Bezugspunkt zeigte.
 */
const REPLICATION_STATE_SQL = `
  SELECT current_setting('wal_level') AS wal_level,
         pg_catalog.pg_is_in_recovery() AS in_recovery`;

/**
 * Ob die Erfassung in dieser Projektdatenbank ueberhaupt eingerichtet ist
 * (2.86).
 *
 * `to_regclass` gibt null statt zu scheitern, wenn es die Tabelle nicht gibt.
 * Ein Fehler an dieser Stelle waere von einer nicht erreichbaren Datenbank
 * nicht zu unterscheiden, und die Seite sagte dann das Falsche.
 */
const CHANGE_FEED_PRESENT_SQL = `
  SELECT pg_catalog.to_regclass('qkern_internal.change_feed') IS NOT NULL AS present`;

/**
 * Der Stand des Feeds und sein Rueckstand (2.86).
 *
 * Der Rueckstand wird gezaehlt und nicht gerechnet: `max(position) - $1` waere
 * eine Schaetzung, sobald die Aufbewahrung Zeilen zwischen der Position und dem
 * Ende entfernt hat.
 *
 * `row_key` steht in keiner Spalte dieser Anweisung. Dort liegen die
 * Primaerschluesselwerte echter Kundenzeilen, und diese Lesung braucht sie
 * nicht.
 */
const CHANGE_FEED_SQL = `
  SELECT count(*)::text AS rows,
         count(*) FILTER (WHERE position > $1)::text AS backlog,
         min(position)::text AS oldest_position,
         max(position)::text AS newest_position,
         min(committed_at) AS oldest_committed_at,
         max(committed_at) AS newest_committed_at,
         count(*) FILTER (WHERE operation = 'insert')::text AS inserts,
         count(*) FILTER (WHERE operation = 'update')::text AS updates,
         count(*) FILTER (WHERE operation = 'delete')::text AS deletes
    FROM qkern_internal.change_feed`;

/**
 * Wie viele Tabellen ihre Aenderungen wirklich erfassen (2.86).
 *
 * Ueber `pg_proc` und `pg_namespace` statt ueber einen `regprocedure`-Cast:
 * Der Cast scheitert, wenn es die Funktion nicht gibt, und ein Fehler waere
 * hier wieder von einer nicht erreichbaren Datenbank nicht zu unterscheiden.
 */
const CHANGE_FEED_TRIGGERS_SQL = `
  SELECT count(*)::text AS captured
    FROM pg_catalog.pg_trigger AS trigger
    JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = trigger.tgfoid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
   WHERE NOT trigger.tgisinternal
     AND namespace.nspname = 'qkern_internal'
     AND procedure.proname = 'capture_change'`;

const MAX_REPLICATION_SLOTS = 200;
const MAX_REPLICATION_SUBSCRIPTIONS = 100;
const MAX_SUBSCRIPTION_PUBLICATIONS = 100;
const WAL_LEVELS: readonly string[] = ["minimal", "replica", "logical"];
const WAL_STATUSES: readonly string[] = ["reserved", "extended", "unreserved", "lost"];

/**
 * Spaltenrechte eines Schemas (2.20), aus `pg_attribute.attacl` ueber
 * `aclexplode`. Abgeleitet aus `column_privileges.sql` in postgres-meta
 * (Apache 2.0), das `information_schema.column_privileges` nachbaut, weil
 * die Sicht nur zeigt, was die eigene Rolle betrifft. Tabellenrechte
 * ueberlagern Spaltenrechte; hier stehen nur die je Spalte gesetzten.
 */
const COLUMN_PRIVILEGES_SQL = `
  SELECT relation.relname AS table_name,
         attribute.attname AS column_name,
         CASE WHEN acl.grantee = 0 THEN 'public' ELSE grantee_role.rolname END AS grantee,
         acl.privilege_type AS privilege_type,
         acl.is_grantable AS is_grantable
  FROM pg_catalog.pg_attribute AS attribute
  JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
  LEFT JOIN pg_catalog.pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
  WHERE namespace.nspname = $1
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND attribute.attacl IS NOT NULL
    AND relation.relkind IN ('r', 'v', 'm', 'p', 'f')
  ORDER BY relation.relname ASC, attribute.attnum ASC, grantee ASC, acl.privilege_type ASC
  LIMIT $2`;

/**
 * Fremde Datenquellen (2.72), vier Lesungen in einer Transaktion.
 *
 * Die Wrapper mit Eigentuemer, Handler und Validator. `regproc` schreibt einen
 * Funktionsnamen; steht die Spalte auf 0, hat der Wrapper keine solche
 * Funktion, und `NULLIF` macht daraus ein `null` statt des Textes `-`.
 */
const FOREIGN_DATA_WRAPPERS_SQL = `
  SELECT wrapper.fdwname AS wrapper_name,
         wrapper.fdwowner::regrole::text AS owner,
         NULLIF(wrapper.fdwhandler, 0)::regproc::text AS handler,
         NULLIF(wrapper.fdwvalidator, 0)::regproc::text AS validator
  FROM pg_catalog.pg_foreign_data_wrapper AS wrapper
  ORDER BY wrapper.fdwname ASC
  LIMIT $1`;

/**
 * Die Fremdserver (2.72), mit ihrem Wrapper und ihren Optionen.
 *
 * `srvoptions` kommt roh heraus, als `name=wert` je Eintrag, und wird erst in
 * TypeScript getrennt und gefiltert. Der Optionsname ist ein Bezeichner und
 * traegt kein `=`, also ist das erste `=` die Trennstelle und keine Schaetzung.
 *
 * Die Spalte ist fuer jede Rolle lesbar, die `pg_foreign_server` lesen darf,
 * und das ist `public`. Wer ein Geheimnis in eine Serveroption schreibt, legt
 * es damit offen; `SHOWN_SERVER_OPTION_KEYS` entscheidet danach, was QKERN
 * davon weitergibt.
 */
const FOREIGN_SERVERS_SQL = `
  SELECT server.srvname AS server_name,
         wrapper.fdwname AS wrapper_name,
         server.srvowner::regrole::text AS owner,
         server.srvtype AS server_type,
         server.srvversion AS server_version,
         COALESCE(server.srvoptions, ARRAY[]::text[]) AS options
  FROM pg_catalog.pg_foreign_server AS server
  JOIN pg_catalog.pg_foreign_data_wrapper AS wrapper ON wrapper.oid = server.srvfdw
  ORDER BY server.srvname ASC
  LIMIT $1`;

/**
 * Die Benutzerzuordnungen (2.72), aus der Sicht und ohne `umoptions`.
 *
 * Die Sicht statt der Katalogtabelle, weil `pg_user_mapping` fuer `public`
 * gesperrt ist: Eine nicht privilegierte Leserolle bekaeme dort „permission
 * denied for table pg_user_mapping" und die ganze Seite faellt aus, obwohl
 * QKERN nur zwei harmlose Spalten will. Die Sicht gibt Servername und
 * Rollenname jeder Zuordnung heraus.
 *
 * `umoptions` steht nicht in der Liste, und das ist der Punkt dieser Lesung.
 */
const USER_MAPPINGS_SQL = `
  SELECT mapping.srvname AS server_name,
         mapping.usename AS user_name
  FROM pg_catalog.pg_user_mappings AS mapping
  ORDER BY mapping.srvname ASC, mapping.usename ASC
  LIMIT $1`;

/**
 * Die Fremdtabellen (2.72), mit Schema, Name und Server.
 *
 * `ftoptions` bleibt ungelesen. Dort steht, wie die Tabelle drueben heisst;
 * das ist eine Angabe ueber das fremde System, und diese Seite beschreibt das
 * eigene.
 */
const FOREIGN_TABLES_SQL = `
  SELECT namespace.nspname AS schema_name,
         relation.relname AS table_name,
         server.srvname AS server_name
  FROM pg_catalog.pg_foreign_table AS foreign_table
  JOIN pg_catalog.pg_class AS relation ON relation.oid = foreign_table.ftrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  JOIN pg_catalog.pg_foreign_server AS server ON server.oid = foreign_table.ftserver
  ORDER BY namespace.nspname ASC, relation.relname ASC
  LIMIT $1`;

/**
 * Welche Optionsschluessel eines Fremdservers ihren **Wert** zeigen duerfen
 * (2.72). Die Entscheidung steht hier und nicht in der Ansicht: Sie gilt fuer
 * jeden, der die Lesung aufruft, also auch fuer die MCP-Bruecke.
 *
 * Eine Liste des Erlaubten, keine Liste des Verbotenen. Ein Fremdserver kann
 * unter einem Wrapper ohne Validator jede Option tragen, die jemand
 * hinschreibt; eine Sperrliste mit `password` und `secret` darin waere schon
 * bei `passwd`, `pwd`, `token` oder `api_key` blind. Auf der Liste stehen
 * darum nur Schluessel, die beschreiben, **wohin** verbunden wird und **wie**
 * gelesen wird, und keiner, der beschreibt, **als wer**.
 *
 * `user`, `password` und `sslpassword` fehlen hier nicht aus Versehen. Der
 * `postgres_fdw` weist sie auf Serverebene selbst zurueck, aber er ist nicht
 * der einzige Wrapper, und diese Antwort soll nicht davon abhaengen, welcher
 * Wrapper installiert ist. `sslcert`, `sslkey` und `passfile` fehlen ebenso:
 * Ein Pfad auf dem Server ist keine Betriebsangabe, die in eine Weboberflaeche
 * gehoert.
 *
 * Jeder andere Schluessel steht trotzdem in der Antwort, aber mit `value:
 * null`. Der Name einer Option kommt aus dem Wortschatz des Wrappers, der
 * Wert vom Menschen, der ihn gesetzt hat; dass eine Option gesetzt ist, darf
 * man sehen, was drinsteht nicht.
 */
const SHOWN_SERVER_OPTION_KEYS: ReadonlySet<string> = new Set([
  "host", "port", "dbname", "sslmode",
  "fetch_size", "batch_size", "use_remote_estimate", "fdw_startup_cost", "fdw_tuple_cost",
  "updatable", "truncatable", "async_capable", "keep_connections", "parallel_commit", "parallel_abort",
  "analyze_sampling", "extensions",
]);

/**
 * Der Name einer Serveroption (2.72). PostgreSQL legt Optionsnamen als
 * Bezeichner an; was dieser Form nicht entspricht, faellt an der Grenze durch,
 * statt als Text in die Ansicht zu wandern.
 */
const SERVER_OPTION_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

const MAX_FOREIGN_DATA_WRAPPERS = 50;
const MAX_FOREIGN_SERVERS = 200;
const MAX_FOREIGN_SERVER_OPTIONS = 50;
const MAX_USER_MAPPINGS = 500;
const MAX_FOREIGN_TABLES = 1000;

/**
 * Ein Eintrag aus `srvoptions` in Schluessel und Wert (2.72), und der
 * Schluessel entscheidet, ob der Wert mitkommt.
 *
 * Wirft, statt `null` zurueckzugeben: Ein Eintrag ohne `=` oder mit einem
 * Namen ausserhalb der Bezeichner-Grammatik ist kein Grund zum Raten. Dann
 * meldet der Katalog etwas, das QKERN nicht versteht, und die Seite sagt das,
 * statt die Haelfte zu zeigen.
 */
function foreignServerOption(entry: unknown): ProjectForeignServerOption {
  if (typeof entry !== "string" || entry.length > 2048) {
    throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
  }
  const separator = entry.indexOf("=");
  const key = separator > 0 ? entry.slice(0, separator) : "";
  const value = entry.slice(separator + 1);
  if (!SERVER_OPTION_KEY.test(key) || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
  }
  return { key, value: SHOWN_SERVER_OPTION_KEYS.has(key) ? value : null };
}

function assertInspectableSchema(schema: string): void {
  if (!isDataSchemaName(schema)) {
    throw new ProjectDataPlaneError("DATA_PLANE_INVALID_INPUT");
  }
}

/**
 * Ein Name, den der Katalog zurueckgibt (2.23): nicht die Bezeichner-Grammatik
 * fuer Eingaben, denn `"Order_pkey"`, `Enable read access for all users` oder
 * `uuid-ossp` sind legitime Katalogwerte. Sie kommen parametrisiert aus dem
 * Katalog und gehen nur als JSON hinaus; geprueft wird Typ, Laenge (PostgreSQL
 * kappt bei 63 Bytes) und dass keine Steuerzeichen drinstecken.
 */
function catalogName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 63 && !/[\u0000-\u001f\u007f]/.test(value);
}

function boundedText(value: unknown, max: number): value is string | null {
  return value === null || (typeof value === "string" && value.length <= max);
}

/**
 * Ein Zaehler aus einer Statistiksicht (2.40). `bigint` kommt beim Treiber als
 * Dezimaltext an, darum beides. Ueber 2^53 wird gekappt statt abgelehnt: ein
 * Zaehler dieser Groesse ist real, und ein abgelehnter Wert wuerde den ganzen
 * Berater abschalten. Alle Schwellen liegen weit darunter. `null` heisst:
 * kein gueltiger Zaehler.
 */
function counter(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === "string" && /^[0-9]{1,20}$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  }
  return null;
}

/**
 * Die Publikationen aus `PUBLICATIONS_SQL` (2.20), an einer Stelle abgebildet.
 *
 * Zwei Lesungen zeigen sie: die Seite Publikationen und die Seite Replikation
 * (2.74). Die Abbildung steht darum hier und nicht in einer Methode, damit die
 * Grenze fuer beide dieselbe ist.
 *
 * Erwartet die Zeilen einschliesslich der einen ueberzaehligen, die
 * `LIMIT MAX_PUBLICATIONS + 1` holt; daran erkennt sie, dass abgeschnitten
 * wurde.
 */
function projectPublications(rows: readonly PublicationRow[]): { publications: ProjectPublication[]; truncated: boolean } {
  const kept = rows.slice(0, MAX_PUBLICATIONS);
  const publications: ProjectPublication[] = kept.map((row) => {
    const flags = [row.publish_insert, row.publish_update, row.publish_delete, row.publish_truncate, row.all_tables];
    if (!catalogName(row.publication_name) || typeof row.owner !== "string" || row.owner.length === 0 || row.owner.length > 130 ||
        flags.some((flag) => typeof flag !== "boolean") || !Array.isArray(row.tables) || row.tables.length > MAX_PUBLICATION_TABLES ||
        row.tables.some((table) => typeof table !== "string" || table.length === 0 || table.length > 130)) {
      throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
    }
    return {
      name: row.publication_name, owner: row.owner, publishInsert: row.publish_insert, publishUpdate: row.publish_update,
      publishDelete: row.publish_delete, publishTruncate: row.publish_truncate, allTables: row.all_tables, tables: row.tables,
    };
  });
  return { publications, truncated: rows.length > kept.length };
}

/**
 * Eine Byte-Angabe aus dem WAL (2.74): Rueckstand oder Restfrist.
 *
 * `null` bleibt `null` und heisst nicht null Bytes: Ein Slot ohne reservierte
 * Position haelt nichts fest, und eine fehlende Restfrist heisst, dass es keine
 * Grenze gibt. Beides ist etwas anderes als die Zahl 0, und die Ansicht sagt
 * beides verschieden.
 *
 * Alles andere wird geprueft und nicht zurechtgelegt. `numeric` und `bigint`
 * kommen als Text; ein negativer Rueckstand oder eine Zahl jenseits des
 * sicheren Integers ist keine Angabe, die QKERN versteht, und faellt an der
 * Grenze durch. Gerundet wird nichts: Eine gerundete Byte-Zahl ueber einem
 * Betriebsrisiko waere eine stille Falschaussage.
 */
function walBytes(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !UNSIGNED_DECIMAL.test(value)) {
    throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
  return parsed;
}

/**
 * Eine Zahl aus dem Aenderungs-Feed (2.86).
 *
 * `count(*)` und `position` sind `bigint` und erreichen den Treiber als
 * Zeichenkette. Ungeprueft wuerde daraus still `NaN`, und die Seite zeigte eine
 * Zahl, die keine ist.
 */
function feedCount(value: unknown): number {
  if (typeof value !== "string" || !UNSIGNED_DECIMAL.test(value)) {
    throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
  }
  return parsed;
}

/** `min`/`max` ueber eine leere Tabelle sind null, und null heisst hier "keine Zeile". */
function feedMoment(value: Date | null): string | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
  return parsed.toISOString();
}

function identifierList(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 63);
}

export class ProjectDataPlaneService implements ProjectDataPlanePort {
  constructor(
    private readonly targets: ProjectDataPlaneTargetResolver,
    private readonly connections: ProjectDatabaseConnectionResolver,
  ) {}

  async inspectSchema(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectSchemaResult> {
    assertContextAndScope(context, scope);
    if (!isDataSchemaName(schema)) {
      throw new ProjectDataPlaneError("DATA_PLANE_INVALID_INPUT");
    }
    return this.run(context, scope, async (client) => {
      const result = await client.query<SchemaRow>(SCHEMA_SQL, [
        schema,
        MAX_TABLES * MAX_COLUMNS_PER_TABLE + 1,
      ]);
      const rows = result.rows.slice(0, MAX_TABLES * MAX_COLUMNS_PER_TABLE);
      const tables = new Map<string, ProjectSchemaTable>();
      let truncated = result.rows.length > rows.length;
      for (const row of rows) {
        // Seit 2.26 mit Grossbuchstaben: `"Order"` aus Prisma fehlte sonst im Table Editor.
        if (!DATA_IDENTIFIER.test(row.table_name) || !DATA_IDENTIFIER.test(row.column_name) ||
            typeof row.data_type !== "string" || row.data_type.length > 160 ||
            !Number.isSafeInteger(row.ordinal_position) || row.ordinal_position < 1) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        let table = tables.get(row.table_name);
        if (!table) {
          if (tables.size >= MAX_TABLES) { truncated = true; continue; }
          table = {
            name: row.table_name,
            kind: relationKind(row.relation_kind),
            rowSecurityEnabled: row.row_security_enabled === true,
            columns: [],
            truncated: false,
          };
          tables.set(row.table_name, table);
        }
        if (table.columns.length >= MAX_COLUMNS_PER_TABLE) {
          table.truncated = true;
          truncated = true;
          continue;
        }
        table.columns.push({
          name: row.column_name,
          dataType: row.data_type,
          nullable: row.not_null !== true,
          identity: Boolean(row.identity_kind),
          generated: Boolean(row.generated_kind),
          sensitive: SENSITIVE_COLUMN.test(row.column_name),
        });
      }
      return { source: "postgres", schema, tables: [...tables.values()], truncated };
    });
  }

  async inspectTriggers(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectTriggerResult> {
    assertContextAndScope(context, scope);
    if (!isDataSchemaName(schema)) {
      throw new ProjectDataPlaneError("DATA_PLANE_INVALID_INPUT");
    }
    return this.run(context, scope, async (client) => {
      const result = await client.query<TriggerRow>(TRIGGERS_SQL, [schema, MAX_TRIGGERS + 1]);
      const rows = result.rows.slice(0, MAX_TRIGGERS);
      const triggers: ProjectTrigger[] = rows.map((row) => {
        if (!catalogName(row.trigger_name) || !catalogName(row.table_name) ||
            !catalogName(row.function_name) || !catalogName(row.function_schema) ||
            !["O", "A", "R", "D"].includes(row.enabled_mode) ||
            (row.condition !== null && (typeof row.condition !== "string" || row.condition.length > 2000))) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        const events: ProjectTrigger["events"] = [];
        if (row.on_insert) events.push("insert");
        if (row.on_update) events.push("update");
        if (row.on_delete) events.push("delete");
        if (row.on_truncate) events.push("truncate");
        return {
          name: row.trigger_name,
          table: row.table_name,
          timing: row.is_instead ? "instead_of" : row.is_before ? "before" : "after",
          events,
          orientation: row.is_row ? "row" : "statement",
          enabled: ({ O: "origin", A: "always", R: "replica", D: "disabled" } as const)[row.enabled_mode],
          functionSchema: row.function_schema,
          functionName: row.function_name,
          condition: row.condition,
        };
      });
      return { source: "postgres", schema, triggers, truncated: result.rows.length > rows.length };
    });
  }

  async inspectFunctions(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectFunctionResult> {
    assertContextAndScope(context, scope);
    if (!isDataSchemaName(schema)) {
      throw new ProjectDataPlaneError("DATA_PLANE_INVALID_INPUT");
    }
    return this.run(context, scope, async (client) => {
      const result = await client.query<FunctionRow>(FUNCTIONS_SQL, [schema, MAX_FUNCTIONS + 1]);
      const rows = result.rows.slice(0, MAX_FUNCTIONS);
      const functions: ProjectFunction[] = rows.map((row) => {
        if (!catalogName(row.function_name) || !catalogName(row.language) ||
            !["f", "p"].includes(row.kind) || !["i", "s", "v"].includes(row.volatility) ||
            typeof row.arguments !== "string" || row.arguments.length > 2000 ||
            typeof row.identity_arguments !== "string" || row.identity_arguments.length > 2000 ||
            (row.return_type !== null && (typeof row.return_type !== "string" || row.return_type.length > 2000)) ||
            typeof row.returns_set !== "boolean" || typeof row.security_definer !== "boolean") {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return {
          name: row.function_name,
          kind: row.kind === "p" ? "procedure" : "function",
          language: row.language,
          arguments: row.arguments,
          identityArguments: row.identity_arguments,
          returnType: row.return_type,
          returnsSet: row.returns_set,
          volatility: ({ i: "immutable", s: "stable", v: "volatile" } as const)[row.volatility],
          securityDefiner: row.security_definer,
        };
      });
      return { source: "postgres", schema, functions, truncated: result.rows.length > rows.length };
    });
  }

  async inspectIndexes(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectIndexResult> {
    assertContextAndScope(context, scope);
    assertInspectableSchema(schema);
    return this.run(context, scope, async (client) => {
      const result = await client.query<IndexRow>(INDEXES_SQL, [schema, MAX_INDEXES + 1]);
      const rows = result.rows.slice(0, MAX_INDEXES);
      const indexes: ProjectIndex[] = rows.map((row) => {
        if (!catalogName(row.index_name) || !catalogName(row.table_name) || !catalogName(row.access_method) ||
            typeof row.is_unique !== "boolean" || typeof row.is_primary !== "boolean" || typeof row.is_valid !== "boolean" ||
            !identifierList(row.columns, 32) || typeof row.definition !== "string" || row.definition.length > MAX_EXPRESSION ||
            !boundedText(row.predicate, MAX_EXPRESSION)) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return {
          name: row.index_name, table: row.table_name, accessMethod: row.access_method,
          unique: row.is_unique, primary: row.is_primary, valid: row.is_valid,
          columns: row.columns, definition: row.definition, predicate: row.predicate,
        };
      });
      return { source: "postgres", schema, indexes, truncated: result.rows.length > rows.length };
    });
  }

  async inspectPolicies(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectPolicyResult> {
    assertContextAndScope(context, scope);
    assertInspectableSchema(schema);
    return this.run(context, scope, async (client) => {
      const result = await client.query<PolicyRow>(POLICIES_SQL, [schema, MAX_POLICIES + 1]);
      const rows = result.rows.slice(0, MAX_POLICIES);
      const policies: ProjectPolicy[] = rows.map((row) => {
        if (!catalogName(row.policy_name) || !catalogName(row.table_name) || typeof row.permissive !== "boolean" ||
            !["r", "a", "w", "d", "*"].includes(row.command) || !identifierList(row.roles, 64) || row.roles.length === 0 ||
            !boundedText(row.using_expression, MAX_EXPRESSION) || !boundedText(row.check_expression, MAX_EXPRESSION)) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return {
          name: row.policy_name, table: row.table_name, permissive: row.permissive,
          command: ({ r: "select", a: "insert", w: "update", d: "delete", "*": "all" } as const)[row.command],
          roles: row.roles, usingExpression: row.using_expression, checkExpression: row.check_expression,
        };
      });
      return { source: "postgres", schema, policies, truncated: result.rows.length > rows.length };
    });
  }

  async inspectStatistics(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectStatisticsResult> {
    assertContextAndScope(context, scope);
    assertInspectableSchema(schema);
    return this.run(context, scope, async (client) => {
      const tableRows = await client.query<TableStatisticsRow>(TABLE_STATISTICS_SQL, [schema, MAX_STATISTICS_TABLES + 1]);
      const indexRows = await client.query<IndexStatisticsRow>(INDEX_STATISTICS_SQL, [schema, MAX_STATISTICS_INDEXES + 1]);
      const selectedTables = tableRows.rows.slice(0, MAX_STATISTICS_TABLES);
      const selectedIndexes = indexRows.rows.slice(0, MAX_STATISTICS_INDEXES);
      const tables: ProjectTableStatistics[] = selectedTables.map((row) => {
        const numbers = [counter(row.seq_scan), counter(row.seq_tup_read), counter(row.idx_scan), counter(row.live_tuples), counter(row.dead_tuples)];
        if (!catalogName(row.table_name) || numbers.some((value) => value === null) ||
            !boundedText(row.last_autovacuum, 40) || !boundedText(row.last_analyze, 40)) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        const [seqScan, seqTupRead, idxScan, liveTuples, deadTuples] = numbers as number[];
        return {
          table: row.table_name, seqScan, seqTupRead, idxScan, liveTuples, deadTuples,
          lastAutovacuum: row.last_autovacuum, lastAnalyze: row.last_analyze,
        };
      });
      const indexes: ProjectIndexStatistics[] = selectedIndexes.map((row) => {
        const scans = counter(row.scans);
        const sizeBytes = counter(row.size_bytes);
        if (!catalogName(row.index_name) || !catalogName(row.table_name) || scans === null || sizeBytes === null ||
            typeof row.is_unique !== "boolean" || typeof row.is_primary !== "boolean") {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return { name: row.index_name, table: row.table_name, scans, sizeBytes, isUnique: row.is_unique, isPrimary: row.is_primary };
      });
      return {
        source: "postgres", schema, tables, indexes,
        truncated: tableRows.rows.length > selectedTables.length || indexRows.rows.length > selectedIndexes.length,
      };
    });
  }

  /**
   * Betriebszahlen und Verbindungsgruppen der Projektdatenbank (2.46).
   *
   * Zwei Abfragen in derselben lesenden Transaktion wie jede andere
   * Inspektion. Die Antwort traegt keinen Abfragetext, keine Adresse und
   * keine einzelne Sitzung; was die Grenze nicht als Zaehler oder Namen
   * erkennt, faellt hier heraus statt in die Console.
   */
  async inspectActivity(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectActivityResult> {
    assertContextAndScope(context, scope);
    return this.run(context, scope, async (client) => {
      const databaseRows = await client.query<DatabaseActivityRow>(DATABASE_ACTIVITY_SQL);
      const groupRows = await client.query<ConnectionGroupRow>(CONNECTION_GROUPS_SQL, [MAX_CONNECTION_GROUPS + 1]);
      const row = databaseRows.rows[0];
      // Ohne Zeile in `pg_stat_database` gibt es keine Zahlen. Eine Null
      // waere gelogen, darum faellt der Aufruf hier fail-closed.
      if (!row) throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      const numbers = [
        counter(row.commits), counter(row.rollbacks), counter(row.blocks_read), counter(row.blocks_hit),
        counter(row.deadlocks), counter(row.temp_files), counter(row.temp_bytes),
        counter(row.backends), counter(row.max_connections),
      ];
      if (numbers.some((value) => value === null) || !boundedText(row.stats_reset, 40)) {
        throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      }
      const [commits, rollbacks, blocksRead, blocksHit, deadlocks, tempFiles, tempBytes, backends, maxConnections] = numbers as number[];
      const selected = groupRows.rows.slice(0, MAX_CONNECTION_GROUPS);
      const connections: ProjectConnectionGroup[] = selected.map((group) => {
        const count = counter(group.connections);
        const oldestSeconds = counter(group.oldest_seconds);
        if (!catalogName(group.role_name) || !catalogName(group.state) || group.state.length > 64 ||
            count === null || oldestSeconds === null) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return { role: group.role_name, state: group.state, count, oldestSeconds };
      });
      return {
        source: "postgres",
        database: {
          commits, rollbacks, blocksRead, blocksHit, deadlocks, tempFiles, tempBytes,
          backends, maxConnections, statsReset: row.stats_reset,
        },
        connections,
        truncated: groupRows.rows.length > selected.length,
      };
    });
  }

  /**
   * Der Zustand der Projektdatenbank (2.70), aus den Statistiksichten.
   *
   * Drei Anweisungen in derselben lesenden Transaktion: die Zeile dieser
   * Datenbank aus `pg_stat_database`, die Frage, welche Checkpoint-Sicht
   * dieser Server hat, und der Schreibweg aus der Sicht, die es wirklich
   * gibt. Die Frage dazwischen ist noetig, weil ein Name, den der Katalog
   * nicht kennt, schon beim Parsen scheitert; siehe `HAS_CHECKPOINTER_SQL`.
   *
   * Jeder Zaehler passiert die Grenze. Das ist hier kein Formalismus: Der
   * Treiber liefert `bigint` als Text, und ein Text, der kein Zaehler ist,
   * wuerde in der Console als Zahl gelesen. Was nicht wie ein Zaehler
   * aussieht, laesst den Aufruf scheitern, statt eine Zahl zu erfinden.
   *
   * `checksum_failures` ist der einzige Wert, der `null` sein darf und
   * trotzdem gueltig ist: Ein Server ohne Datenpruefsummen zaehlt nicht, und
   * eine 0 waere hier die Behauptung, es sei geprueft und nichts gefunden
   * worden.
   */
  async inspectDatabaseHealth(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectDatabaseHealthResult> {
    assertContextAndScope(context, scope);
    return this.run(context, scope, async (client) => {
      const databaseRows = await client.query<DatabaseHealthRow>(DATABASE_HEALTH_SQL);
      const row = databaseRows.rows[0];
      // Ohne Zeile gibt es nichts zu sagen. Nullen waeren hier gelogen, also
      // faellt der Aufruf fail-closed.
      if (!row) throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");

      const probe = await client.query<{ has_checkpointer: boolean }>(HAS_CHECKPOINTER_SQL);
      const hasCheckpointer = probe.rows[0]?.has_checkpointer;
      if (typeof hasCheckpointer !== "boolean") throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      const writebackRows = await client.query<WritebackRow>(
        hasCheckpointer ? CHECKPOINTER_SQL : LEGACY_BGWRITER_SQL,
      );
      const writeback = writebackRows.rows[0];
      if (!writeback) throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");

      const counters = [
        counter(row.backends), counter(row.commits), counter(row.rollbacks),
        counter(row.blocks_read), counter(row.blocks_hit), counter(row.deadlocks),
        counter(row.conflicts), counter(row.temp_files), counter(row.temp_bytes),
        counter(row.sessions), counter(row.sessions_abandoned),
        counter(row.sessions_fatal), counter(row.sessions_killed),
        counter(writeback.checkpoints_timed), counter(writeback.checkpoints_requested),
        counter(writeback.checkpoint_write_ms), counter(writeback.checkpoint_sync_ms),
        counter(writeback.buffers_checkpoint), counter(writeback.buffers_clean),
        counter(writeback.maxwritten_clean), counter(writeback.buffers_alloc),
      ];
      if (counters.some((value) => value === null)) {
        throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      }
      // Zeitpunkte gehen nur als UTC-Text durch, in genau der Form, die
      // `to_char` oben schreibt. Alles andere wuerde die Console formatieren,
      // ohne es zu verstehen.
      for (const moment of [row.checksum_last_failure, row.stats_reset,
        writeback.checkpointer_stats_reset, writeback.bgwriter_stats_reset]) {
        if (moment !== null && (typeof moment !== "string" || !UTC_MOMENT.test(moment))) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
      }
      const checksumFailures = row.checksum_failures === null ? null : counter(row.checksum_failures);
      if (row.checksum_failures !== null && checksumFailures === null) {
        throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      }

      const [
        backends, commits, rollbacks, blocksRead, blocksHit, deadlocks, conflicts,
        tempFiles, tempBytes, sessions, sessionsAbandoned, sessionsFatal, sessionsKilled,
        checkpointsTimed, checkpointsRequested, checkpointWriteMs, checkpointSyncMs,
        buffersCheckpoint, buffersClean, maxwrittenClean, buffersAlloc,
      ] = counters as number[];

      return {
        source: "postgres",
        database: {
          backends, commits, rollbacks, blocksRead, blocksHit, deadlocks, conflicts,
          tempFiles, tempBytes, checksumFailures,
          checksumLastFailure: row.checksum_last_failure,
          sessions, sessionsAbandoned, sessionsFatal, sessionsKilled,
          statsReset: row.stats_reset,
        },
        writeback: {
          checkpointSource: hasCheckpointer ? "pg_stat_checkpointer" : "pg_stat_bgwriter",
          checkpointsTimed, checkpointsRequested, checkpointWriteMs, checkpointSyncMs,
          buffersCheckpoint, buffersClean, maxwrittenClean, buffersAlloc,
          checkpointerStatsReset: writeback.checkpointer_stats_reset,
          bgwriterStatsReset: writeback.bgwriter_stats_reset,
        },
      };
    });
  }

  /**
   * Die teuersten Statements der eigenen Datenbank, ohne ihren Text (2.57).
   *
   * Der Gegenentwurf zu "gar nicht lesen" aus 2.40: Statt die Sicht ganz
   * liegen zu lassen, wird sie so eng gelesen, dass ihr gefaehrlicher Teil
   * gar nicht erst mitkommt. `STATEMENT_DIGESTS_SQL` waehlt `query` nicht
   * aus, und dieser Rumpf baut die Antwort aus fuenf Feldern, die alle die
   * Grenze passieren muessen: eine Kennung aus Ziffern, vier Zaehler (2.67).
   * Was die Grenze nicht als solches erkennt, laesst den Aufruf scheitern,
   * statt in die Console zu laufen.
   *
   * Fehlt die Erweiterung, ist das kein Fehler: `installed: false` ist die
   * ehrliche Antwort, und der Berater macht daraus einen Grund.
   */
  async inspectStatements(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectStatementResult> {
    assertContextAndScope(context, scope);
    return this.run(context, scope, async (client) => {
      const probe = await client.query<{ installed: boolean }>(STATEMENTS_INSTALLED_SQL);
      if (probe.rows[0]?.installed !== true) {
        return { source: "postgres", installed: false, statements: [], truncated: false };
      }
      const result = await client.query<StatementDigestRow>(STATEMENT_DIGESTS_SQL, [MAX_STATEMENT_DIGESTS + 1]);
      const rows = result.rows.slice(0, MAX_STATEMENT_DIGESTS);
      const statements: ProjectStatementDigest[] = rows.map((row) => {
        const calls = counter(row.calls);
        const totalTimeMs = counter(row.total_time_ms);
        const meanTimeUs = counter(row.mean_time_us);
        const rows = counter(row.rows);
        // Eine `queryid` ist ein `bigint`, also hoechstens 20 Zeichen aus
        // Ziffern und einem moeglichen Minus. Alles andere waere kein
        // Statement-Hash, und was hier nicht hineinpasst, geht nicht hinaus.
        if (typeof row.statement_id !== "string" || !/^-?[0-9]{1,20}$/.test(row.statement_id) ||
            calls === null || totalTimeMs === null || meanTimeUs === null || rows === null) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return { id: row.statement_id, calls, totalTimeMs, meanTimeUs, rows };
      });
      return {
        source: "postgres", installed: true, statements,
        truncated: result.rows.length > rows.length,
      };
    });
  }

  async inspectForeignKeys(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectForeignKeyResult> {
    assertContextAndScope(context, scope);
    assertInspectableSchema(schema);
    return this.run(context, scope, async (client) => {
      const result = await client.query<ForeignKeyRow>(FOREIGN_KEYS_SQL, [schema, MAX_FOREIGN_KEYS + 1]);
      const rows = result.rows.slice(0, MAX_FOREIGN_KEYS);
      const foreignKeys: ProjectForeignKey[] = rows.map((row) => {
        if (!catalogName(row.constraint_name) || !catalogName(row.table_name) ||
            !catalogName(row.referenced_schema) || !catalogName(row.referenced_table) ||
            !identifierList(row.columns, MAX_FOREIGN_KEY_COLUMNS) || row.columns.length === 0 ||
            !identifierList(row.referenced_columns, MAX_FOREIGN_KEY_COLUMNS) ||
            // Ein Fremdschluessel hat auf beiden Seiten gleich viele Spalten. Stimmt
            // das nicht, hat die Abfrage eine Spalte verloren, und das Bild waere falsch.
            row.referenced_columns.length !== row.columns.length) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return {
          name: row.constraint_name,
          table: row.table_name,
          columns: row.columns,
          referencedSchema: row.referenced_schema,
          referencedTable: row.referenced_table,
          referencedColumns: row.referenced_columns,
          onDelete: foreignKeyAction(row.on_delete),
          onUpdate: foreignKeyAction(row.on_update),
        };
      });
      return { source: "postgres", schema, foreignKeys, truncated: result.rows.length > rows.length };
    });
  }

  async inspectEnumTypes(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectEnumTypeResult> {
    assertContextAndScope(context, scope);
    assertInspectableSchema(schema);
    return this.run(context, scope, async (client) => {
      const result = await client.query<EnumTypeRow>(ENUM_TYPES_SQL, [schema, MAX_ENUM_TYPES + 1]);
      const rows = result.rows.slice(0, MAX_ENUM_TYPES);
      const types: ProjectEnumType[] = rows.map((row) => {
        if (!catalogName(row.type_name) || !identifierList(row.labels, MAX_ENUM_LABELS)) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return { name: row.type_name, labels: row.labels };
      });
      return { source: "postgres", schema, types, truncated: result.rows.length > rows.length };
    });
  }

  async inspectExtensions(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectExtensionResult> {
    assertContextAndScope(context, scope);
    return this.run(context, scope, async (client) => {
      const result = await client.query<ExtensionRow>(EXTENSIONS_SQL, [MAX_EXTENSIONS + 1]);
      const rows = result.rows.slice(0, MAX_EXTENSIONS);
      const extensions: ProjectExtension[] = rows.map((row) => {
        if (!EXTENSION_NAME.test(row.name) || !VERSION.test(row.default_version) ||
            (row.installed_version !== null && !VERSION.test(row.installed_version)) ||
            (row.schema !== null && !catalogName(row.schema)) || !boundedText(row.comment, 400)) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return { name: row.name, defaultVersion: row.default_version, installedVersion: row.installed_version, schema: row.schema, comment: row.comment };
      });
      return { source: "postgres", extensions, truncated: result.rows.length > rows.length };
    });
  }

  async inspectRoles(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectRoleResult> {
    assertContextAndScope(context, scope);
    return this.run(context, scope, async (client) => {
      const result = await client.query<RoleRow>(ROLES_SQL, [MAX_ROLES + 1]);
      const rows = result.rows.slice(0, MAX_ROLES);
      const roles: ProjectRole[] = rows.map((row) => {
        const flags = [row.superuser, row.create_database, row.create_role, row.inherit, row.login, row.replication, row.bypass_rls];
        if (!catalogName(row.role_name) || flags.some((flag) => typeof flag !== "boolean") ||
            !Number.isSafeInteger(row.connection_limit) || row.connection_limit < -1 || !boundedText(row.valid_until, 40)) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return {
          name: row.role_name, superuser: row.superuser, createDatabase: row.create_database, createRole: row.create_role,
          inherit: row.inherit, login: row.login, replication: row.replication, bypassRowSecurity: row.bypass_rls,
          connectionLimit: row.connection_limit === -1 ? null : row.connection_limit, validUntil: row.valid_until,
        };
      });
      return { source: "postgres", roles, truncated: result.rows.length > rows.length };
    });
  }

  /**
   * Die Einstellungen der Projektdatenbank (2.53). Dieselbe Verbindung, zwei
   * Anweisungen: die Rollen aus `ROLES_SQL`, also genau die Liste, die
   * `inspectRoles` liefert, und daneben Name, Eigentuemer, TLS-Zustand und
   * Grenzen. Nichts davon wird gerechnet oder geraten; was der Katalog nicht
   * in der erwarteten Form meldet, faellt an der Grenze durch.
   */
  async inspectSettings(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectDatabaseSettingsResult> {
    assertContextAndScope(context, scope);
    return this.run(context, scope, async (client) => {
      const settingsResult = await client.query<SettingsRow>(SETTINGS_SQL);
      const roleResult = await client.query<RoleRow>(ROLES_SQL, [MAX_ROLES + 1]);
      const row = settingsResult.rows[0];
      // Ohne Zeile gibt es nichts zu sagen. Eine leere Antwort waere eine
      // Behauptung ueber eine Datenbank, die der Katalog nicht kennt.
      if (!row) throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      const flags = [row.connection_encrypted, row.server_tls_enabled];
      const numbers = [row.max_connections, row.superuser_reserved, row.database_connection_limit, row.role_connection_limit];
      if (!catalogName(row.database_name) || !catalogName(row.database_owner) || !catalogName(row.current_role_name) ||
          flags.some((flag) => typeof flag !== "boolean") ||
          numbers.some((value) => !Number.isSafeInteger(value) || value < -1) ||
          !boundedText(row.tls_version, 32) ||
          (typeof row.tls_version === "string" && !/^[A-Za-z0-9. _-]{1,32}$/.test(row.tls_version))) {
        throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      }
      const roleRows = roleResult.rows.slice(0, MAX_ROLES);
      const roles: ProjectRole[] = roleRows.map((entry) => {
        const roleFlags = [entry.superuser, entry.create_database, entry.create_role, entry.inherit, entry.login, entry.replication, entry.bypass_rls];
        if (!catalogName(entry.role_name) || roleFlags.some((flag) => typeof flag !== "boolean") ||
            !Number.isSafeInteger(entry.connection_limit) || entry.connection_limit < -1 || !boundedText(entry.valid_until, 40)) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return {
          name: entry.role_name, superuser: entry.superuser, createDatabase: entry.create_database, createRole: entry.create_role,
          inherit: entry.inherit, login: entry.login, replication: entry.replication, bypassRowSecurity: entry.bypass_rls,
          connectionLimit: entry.connection_limit === -1 ? null : entry.connection_limit, validUntil: entry.valid_until,
        };
      });
      return {
        source: "postgres",
        databaseName: row.database_name,
        databaseOwner: row.database_owner,
        currentRole: row.current_role_name,
        tls: {
          encrypted: row.connection_encrypted,
          version: row.connection_encrypted ? row.tls_version : null,
          serverEnabled: row.server_tls_enabled,
        },
        limits: {
          maxConnections: row.max_connections,
          superuserReserved: row.superuser_reserved,
          database: row.database_connection_limit === -1 ? null : row.database_connection_limit,
          role: row.role_connection_limit === -1 ? null : row.role_connection_limit,
        },
        roles,
        truncated: roleResult.rows.length > roleRows.length,
      };
    });
  }

  /**
   * Worauf diese Umgebung laeuft (2.68), in einer Anweisung und ohne Rechnung.
   *
   * Jede Angabe wird an der Grenze geprueft, bevor sie den Dienst verlaesst.
   * Das ist hier kein Formalismus: `server_version` ist ein freier Text, den
   * der Packager setzt, und `datcollate` traegt einen Gebietsnamen aus dem
   * Betriebssystem. Was nicht wie ein Katalogwert aussieht, faellt durch,
   * statt in der Console zu landen.
   */
  async inspectRuntime(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectDatabaseRuntimeResult> {
    assertContextAndScope(context, scope);
    return this.run(context, scope, async (client) => {
      const result = await client.query<RuntimeRow>(RUNTIME_SQL);
      const row = result.rows[0];
      // Ohne Zeile gibt es nichts zu sagen. Eine leere Antwort waere eine
      // Behauptung ueber eine Datenbank, die der Katalog nicht kennt.
      if (!row) throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      if (typeof row.server_version !== "string" || !SERVER_VERSION.test(row.server_version) ||
          !Number.isSafeInteger(row.server_version_num) ||
          row.server_version_num < 80_000 || row.server_version_num > 99_999_999 ||
          typeof row.server_encoding !== "string" || !ENCODING.test(row.server_encoding) ||
          typeof row.collate !== "string" || !LOCALE_NAME.test(row.collate) ||
          typeof row.ctype !== "string" || !LOCALE_NAME.test(row.ctype) ||
          typeof row.size_bytes !== "string" || !UNSIGNED_DECIMAL.test(row.size_bytes) ||
          typeof row.in_recovery !== "boolean" ||
          typeof row.started_at !== "string" || !UTC_MOMENT.test(row.started_at)) {
        throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      }
      const sizeBytes = Number(row.size_bytes);
      // Eine Groesse jenseits des sicheren Integers waere still falsch. Lieber
      // keine Antwort als eine gerundete.
      if (!Number.isSafeInteger(sizeBytes)) throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      return {
        source: "postgres",
        serverVersion: row.server_version,
        serverVersionNum: row.server_version_num,
        encoding: row.server_encoding,
        collate: row.collate,
        ctype: row.ctype,
        sizeBytes,
        inRecovery: row.in_recovery,
        startedAt: row.started_at,
      };
    });
  }

  async inspectPublications(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectPublicationResult> {
    assertContextAndScope(context, scope);
    return this.run(context, scope, async (client) => {
      const result = await client.query<PublicationRow>(PUBLICATIONS_SQL, [MAX_PUBLICATIONS + 1]);
      const read = projectPublications(result.rows);
      return { source: "postgres", publications: read.publications, truncated: read.truncated };
    });
  }

  /**
   * Replikation (2.74), lesend.
   *
   * Vier Anweisungen in derselben Transaktion, damit die Teile zueinander
   * passen: Ein Slot, der zwischen zwei Lesungen verschwindet, liesse ein
   * Abonnement ohne Slot stehen, und ein `wal_level` aus einem anderen Moment
   * wuerde einen logischen Slot erklaeren, den es dann nicht gibt.
   *
   * Die Publikationen kommen aus `PUBLICATIONS_SQL`, derselben Anweisung, die
   * `inspectPublications` (2.20) benutzt, und werden von derselben Funktion
   * abgebildet. Zwei Lesestellen fuer dieselbe Sache waeren zwei Orte, an denen
   * eine Grenze anders gezogen werden kann.
   *
   * Die Grenze dieser Lesung ist `subconninfo`, und sie wird nicht gefiltert,
   * sondern nicht gefragt: Die Spalte steht in keiner der vier Anweisungen.
   */
  async inspectReplication(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectReplicationResult> {
    assertContextAndScope(context, scope);
    return this.run(context, scope, async (client) => {
      const stateResult = await client.query<ReplicationStateRow>(REPLICATION_STATE_SQL);
      const publicationResult = await client.query<PublicationRow>(PUBLICATIONS_SQL, [MAX_PUBLICATIONS + 1]);
      const subscriptionResult = await client.query<ReplicationSubscriptionRow>(
        REPLICATION_SUBSCRIPTIONS_SQL, [MAX_REPLICATION_SUBSCRIPTIONS + 1]);
      const slotResult = await client.query<ReplicationSlotRow>(REPLICATION_SLOTS_SQL, [MAX_REPLICATION_SLOTS + 1]);

      const state = stateResult.rows[0];
      // Ohne Zeile gibt es nichts zu sagen. Eine Vorgabe waere eine Behauptung
      // ueber die Einstellung eines Servers, der sie nicht gemeldet hat.
      if (!state || !WAL_LEVELS.includes(state.wal_level) || typeof state.in_recovery !== "boolean") {
        throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      }

      const read = projectPublications(publicationResult.rows);
      const subscriptionRows = subscriptionResult.rows.slice(0, MAX_REPLICATION_SUBSCRIPTIONS);
      const slotRows = slotResult.rows.slice(0, MAX_REPLICATION_SLOTS);
      const truncated = read.truncated ||
        subscriptionResult.rows.length > subscriptionRows.length ||
        slotResult.rows.length > slotRows.length;

      const subscriptions: ProjectReplicationSubscription[] = subscriptionRows.map((row) => {
        if (!catalogName(row.subscription_name) || typeof row.owner !== "string" || row.owner.length === 0 || row.owner.length > 130 ||
            typeof row.enabled !== "boolean" || !boundedText(row.slot_name, 63) ||
            !identifierList(row.publications, MAX_SUBSCRIPTION_PUBLICATIONS)) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return {
          name: row.subscription_name, owner: row.owner, enabled: row.enabled,
          slotName: row.slot_name, publications: row.publications,
        };
      });

      const slots: ProjectReplicationSlot[] = slotRows.map((row) => {
        if (!catalogName(row.slot_name) || (row.slot_type !== "physical" && row.slot_type !== "logical") ||
            !boundedText(row.plugin, 63) || !boundedText(row.database_name, 63) ||
            typeof row.temporary !== "boolean" || typeof row.active !== "boolean" ||
            !(row.wal_status === null || (typeof row.wal_status === "string" && WAL_STATUSES.includes(row.wal_status)))) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return {
          name: row.slot_name,
          slotType: row.slot_type,
          plugin: row.plugin,
          database: row.database_name,
          temporary: row.temporary,
          active: row.active,
          walStatus: row.wal_status as ProjectReplicationSlot["walStatus"],
          retainedBytes: walBytes(row.retained_bytes),
          safeBytes: walBytes(row.safe_bytes),
        };
      });

      return {
        source: "postgres",
        walLevel: state.wal_level as ProjectReplicationResult["walLevel"],
        inRecovery: state.in_recovery,
        publications: read.publications,
        subscriptions,
        slots,
        truncated,
      };
    });
  }

  /**
   * Der Aenderungs-Feed mit seinem Rueckstand (2.86).
   *
   * Drei Anweisungen in derselben Transaktion: ob es den Feed gibt, was in ihm
   * liegt, und wie viele Tabellen ueberhaupt erfassen. Getrennt gefragt
   * koennte die Antwort einen Feed mit Zeilen und null erfassenden Tabellen
   * melden, den es so nie gab.
   *
   * Ohne Feed werden die beiden anderen Anweisungen nicht gestellt. Sie waeren
   * ein Syntaxfehler auf einer Tabelle, die es nicht gibt, und der Fehler
   * verliesse diese Methode als "nicht erreichbar" -- eine falsche Auskunft
   * ueber eine Datenbank, die sehr wohl geantwortet hat.
   */
  async inspectChangeFeed(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    cursorPosition: number,
  ): Promise<ProjectChangeFeedResult> {
    assertContextAndScope(context, scope);
    if (!Number.isSafeInteger(cursorPosition) || cursorPosition < 0) {
      throw new ProjectDataPlaneError("DATA_PLANE_INVALID_INPUT");
    }
    return this.run(context, scope, async (client) => {
      const presence = await client.query<{ present: boolean }>(CHANGE_FEED_PRESENT_SQL);
      const present = presence.rows[0];
      if (!present || typeof present.present !== "boolean") {
        throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      }
      if (!present.present) {
        return {
          source: "postgres" as const, present: false, rows: 0, backlog: 0,
          oldestPosition: null, newestPosition: null,
          oldestCommittedAt: null, newestCommittedAt: null,
          byOperation: { insert: 0, update: 0, delete: 0 }, capturedTables: 0,
        };
      }

      const feed = await client.query<ChangeFeedRow>(CHANGE_FEED_SQL, [cursorPosition]);
      const triggers = await client.query<{ captured: string }>(CHANGE_FEED_TRIGGERS_SQL);
      const row = feed.rows[0];
      const trigger = triggers.rows[0];
      // `count(*)` liefert immer eine Zeile, auch auf einer leeren Tabelle.
      // Fehlt sie, hat die Datenbank nicht geantwortet, was diese Anweisung
      // zusagt.
      if (!row || !trigger) throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");

      return {
        source: "postgres" as const,
        present: true,
        rows: feedCount(row.rows),
        backlog: feedCount(row.backlog),
        oldestPosition: row.oldest_position === null ? null : feedCount(row.oldest_position),
        newestPosition: row.newest_position === null ? null : feedCount(row.newest_position),
        oldestCommittedAt: feedMoment(row.oldest_committed_at),
        newestCommittedAt: feedMoment(row.newest_committed_at),
        byOperation: {
          insert: feedCount(row.inserts),
          update: feedCount(row.updates),
          delete: feedCount(row.deletes),
        },
        capturedTables: feedCount(trigger.captured),
      };
    });
  }

  async inspectColumnPrivileges(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectColumnPrivilegeResult> {
    assertContextAndScope(context, scope);
    assertInspectableSchema(schema);
    return this.run(context, scope, async (client) => {
      const result = await client.query<ColumnPrivilegeRow>(COLUMN_PRIVILEGES_SQL, [schema, MAX_COLUMN_PRIVILEGE_ROWS + 1]);
      const rows = result.rows.slice(0, MAX_COLUMN_PRIVILEGE_ROWS);
      const grouped = new Map<string, ProjectColumnPrivilege>();
      let truncated = result.rows.length > rows.length;
      for (const row of rows) {
        const type = String(row.privilege_type).toLowerCase();
        if (!catalogName(row.table_name) || !catalogName(row.column_name) || !catalogName(row.grantee) ||
            !["select", "insert", "update", "references"].includes(type) || typeof row.is_grantable !== "boolean") {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        const key = `${row.table_name}\u0000${row.column_name}\u0000${row.grantee}`;
        let entry = grouped.get(key);
        if (!entry) {
          if (grouped.size >= MAX_COLUMN_PRIVILEGES) { truncated = true; continue; }
          entry = { table: row.table_name, column: row.column_name, grantee: row.grantee, privileges: [] };
          grouped.set(key, entry);
        }
        entry.privileges.push({ type: type as ProjectColumnPrivilege["privileges"][number]["type"], grantable: row.is_grantable });
      }
      return { source: "postgres", schema, privileges: [...grouped.values()], truncated };
    });
  }

  /**
   * Fremde Datenquellen (2.72), lesend.
   *
   * Vier Anweisungen in derselben Transaktion, damit Wrapper, Server,
   * Zuordnungen und Fremdtabellen zueinander passen: Ein Server, der zwischen
   * zwei Lesungen verschwindet, wuerde sonst eine Fremdtabelle ohne Server
   * hinterlassen.
   *
   * Die Grenze ist hier enger als bei den anderen Katalog-Lesungen, und das
   * hat einen Grund. `srvoptions` traegt in der Praxis Zugangsdaten zu fremden
   * Systemen, `umoptions` traegt sie fast immer. Was in dieser Antwort landet,
   * entscheidet `SHOWN_SERVER_OPTION_KEYS`, und die Zuordnungen kommen ganz
   * ohne Optionen heraus.
   */
  async inspectForeignDataWrappers(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
  ): Promise<ProjectForeignDataWrapperResult> {
    assertContextAndScope(context, scope);
    return this.run(context, scope, async (client) => {
      const wrapperResult = await client.query<ForeignDataWrapperRow>(FOREIGN_DATA_WRAPPERS_SQL, [MAX_FOREIGN_DATA_WRAPPERS + 1]);
      const serverResult = await client.query<ForeignServerRow>(FOREIGN_SERVERS_SQL, [MAX_FOREIGN_SERVERS + 1]);
      const mappingResult = await client.query<UserMappingRow>(USER_MAPPINGS_SQL, [MAX_USER_MAPPINGS + 1]);
      const tableResult = await client.query<ForeignTableRow>(FOREIGN_TABLES_SQL, [MAX_FOREIGN_TABLES + 1]);

      const wrapperRows = wrapperResult.rows.slice(0, MAX_FOREIGN_DATA_WRAPPERS);
      const serverRows = serverResult.rows.slice(0, MAX_FOREIGN_SERVERS);
      const mappingRows = mappingResult.rows.slice(0, MAX_USER_MAPPINGS);
      const tableRows = tableResult.rows.slice(0, MAX_FOREIGN_TABLES);

      const wrappers: ProjectForeignDataWrapper[] = wrapperRows.map((row) => {
        // Handler und Validator koennen schema-qualifiziert ankommen, darum
        // 130 Zeichen statt der 63 eines blossen Namens.
        if (!catalogName(row.wrapper_name) || !catalogName(row.owner) ||
            !boundedText(row.handler, 130) || !boundedText(row.validator, 130)) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return { name: row.wrapper_name, owner: row.owner, handler: row.handler, validator: row.validator };
      });

      let truncated = wrapperResult.rows.length > wrapperRows.length ||
        serverResult.rows.length > serverRows.length ||
        mappingResult.rows.length > mappingRows.length ||
        tableResult.rows.length > tableRows.length;

      const servers: ProjectForeignServer[] = serverRows.map((row) => {
        if (!catalogName(row.server_name) || !catalogName(row.wrapper_name) || !catalogName(row.owner) ||
            !boundedText(row.server_type, 130) || !boundedText(row.server_version, 130) ||
            !Array.isArray(row.options)) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        if (row.options.length > MAX_FOREIGN_SERVER_OPTIONS) truncated = true;
        const options = row.options.slice(0, MAX_FOREIGN_SERVER_OPTIONS)
          .map(foreignServerOption)
          .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
        return {
          name: row.server_name, wrapper: row.wrapper_name, owner: row.owner,
          type: row.server_type, version: row.server_version, options,
        };
      });

      const userMappings: ProjectUserMapping[] = mappingRows.map((row) => {
        if (!catalogName(row.server_name) || !catalogName(row.user_name)) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return { server: row.server_name, user: row.user_name };
      });

      const tables: ProjectForeignTable[] = tableRows.map((row) => {
        if (!catalogName(row.schema_name) || !catalogName(row.table_name) || !catalogName(row.server_name)) {
          throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
        }
        return { schema: row.schema_name, name: row.table_name, server: row.server_name };
      });

      return { source: "postgres", wrappers, servers, userMappings, tables, truncated };
    });
  }

  async queryReadOnly(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    statement: string,
    limit: number,
  ): Promise<ProjectReadQueryResult> {
    assertContextAndScope(context, scope);
    if (!isReadOnlySql(statement) || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_QUERY_ROWS) {
      throw new ProjectDataPlaneError("READ_ONLY_QUERY_REQUIRED");
    }
    const normalized = statement.trim().replace(/;\s*$/, "");
    return this.run(context, scope, async (client) => {
      // The bounded literal is server-generated. Wrapping prevents the driver from
      // buffering an attacker-selected number of rows before application limits run.
      const result = await client.query<Record<string, unknown>>(
        `SELECT * FROM (${normalized}) AS qkern_read_result LIMIT ${limit + 1}`,
      );
      const selected = result.rows.slice(0, limit);
      const rows: Array<Record<string, unknown>> = [];
      let bytes = 0;
      for (const raw of selected) {
        const normalizedRow = normalizeDataValue(raw) as Record<string, unknown>;
        const redacted = redactSensitive(normalizedRow) as Record<string, unknown>;
        const encoded = JSON.stringify(redacted);
        if (bytes + Buffer.byteLength(encoded, "utf8") > MAX_QUERY_BYTES) break;
        bytes += Buffer.byteLength(encoded, "utf8");
        rows.push(redacted);
      }
      const columns = rows[0] ? Object.keys(rows[0]).slice(0, 128) : [];
      if (columns.length === 128 && rows[0] && Object.keys(rows[0]).length > 128) {
        throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      }
      return {
        source: "postgres",
        columns,
        rows,
        rowCount: rows.length,
        truncated: result.rows.length > limit || rows.length < selected.length,
        maxRows: limit,
      };
    });
  }

  /**
   * Der Plan einer lesenden Abfrage (2.69), ohne sie auszufuehren.
   *
   * Drei Entscheidungen stecken in den drei Zeilen darunter:
   *
   * 1. **Kein `ANALYZE`.** `EXPLAIN` stellt den Plan auf und gibt ihn zurueck;
   *    `EXPLAIN ANALYZE` liesse die Abfrage wirklich laufen. Das waere ueber
   *    eine Konsolenflaeche eine andere Zusage, und der SQL-Editor gibt es
   *    schon fuer den, der ausfuehren will.
   * 2. **Derselbe Weg wie `queryReadOnly`.** Es gibt keine eigene Verbindung
   *    und keine eigene Rolle: `this.run` loest dasselbe Ziel auf, prueft
   *    dieselbe Grenze und oeffnet dieselbe `BEGIN READ ONLY`-Transaktion mit
   *    denselben Zeitlimits.
   * 3. **`isReadOnlySql` vor dem Praefix.** `EXPLAIN` selbst waere kein
   *    Schutz: `EXPLAIN ANALYZE DELETE ...` loescht. Der Waechter laesst genau
   *    ein SELECT durch, also kann davor nur ein Plan stehen.
   *
   * Was die Datenbank an Bedingungstexten mitschickt, wird hier nicht
   * durchgereicht: `readQueryPlan` nimmt nur Knotenart, Relation, Indexnamen
   * und Zahlen, und `Filter` oder `Index Cond` bleiben liegen.
   */
  async explainReadQuery(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    statement: string,
  ): Promise<ProjectQueryPlanResult> {
    assertContextAndScope(context, scope);
    if (!isReadOnlySql(statement)) throw new ProjectDataPlaneError("READ_ONLY_QUERY_REQUIRED");
    const normalized = statement.trim().replace(/;\s*$/, "");
    return this.run(context, scope, async (client) => {
      // COSTS ON liefert die Schaetzungen, SUMMARY ON die gemessene
      // Planungszeit. VERBOSE bliebe aus: es haengt Ausgabespalten und
      // Schemapfade an jeden Knoten, die diese Seite nicht zeigt.
      let result;
      try {
        result = await client.query<{ "QUERY PLAN": unknown }>(
          `EXPLAIN (FORMAT JSON, COSTS ON, VERBOSE OFF, SUMMARY ON) ${normalized}`,
        );
      } catch {
        // Eine Abfrage, die sich nicht planen laesst, ist etwas anderes als
        // eine Datenbank, die nicht antwortet. Ohne eigenen Code wuerde die
        // Ansicht "nicht erreichbar" sagen, obwohl die Datenbank sehr wohl
        // geantwortet hat, und das waere schlicht falsch. Der Grund selbst
        // bleibt drinnen: er nennt Relationen und Spalten.
        throw new ProjectDataPlaneError("QUERY_PLAN_REJECTED");
      }
      const raw = result.rows[0]?.["QUERY PLAN"];
      // Der Treiber gibt JSON je nach Typ als Objekt oder als Text zurueck.
      try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) as unknown : raw;
        return { source: "postgres" as const, analyzed: false as const, plan: readQueryPlan(parsed) };
      } catch {
        // Antwort da, aber nicht in der Form, die EXPLAIN (FORMAT JSON)
        // zusagt. Das ist ein Befund ueber die Grenze, nicht ueber die Abfrage.
        throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      }
    });
  }

  private async run<T>(
    context: ProjectDataPlaneContext,
    scope: ProjectDataPlaneScope,
    operation: (client: SqlPoolClient) => Promise<T>,
  ): Promise<T> {
    let resolved: ResolvedProjectDatabaseConnection;
    try {
      const target = await this.targets.resolveTarget(context, scope);
      if (!isCatalogReference(target.databaseInstanceRef)) {
        throw new ProjectDataPlaneError("DATA_PLANE_NOT_READY");
      }
      resolved = await this.connections.resolve(target.databaseInstanceRef);
      assertResolvedBoundary(resolved);
    } catch (error) {
      if (isProjectDataPlaneError(error)) throw error;
      throw new ProjectDataPlaneError("DATA_PLANE_UNAVAILABLE");
    }

    let client: SqlPoolClient;
    try {
      client = await resolved.pool.connect();
    } catch {
      throw new ProjectDataPlaneError("DATA_PLANE_UNAVAILABLE");
    }

    let started = false;
    try {
      await client.query("BEGIN READ ONLY");
      started = true;
      await client.query("SET LOCAL statement_timeout = '5s'");
      await client.query("SET LOCAL lock_timeout = '1s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
      await client.query("SET LOCAL row_security = on");
      const boundary = await client.query<{
        role_name: string;
        session_name: string;
        database_name: string;
        read_only: boolean;
        can_login: boolean;
        superuser: boolean;
        bypass_rls: boolean;
        create_database: boolean;
        create_role: boolean;
        replication: boolean;
        has_memberships: boolean;
      }>(`SELECT role.rolname AS role_name,
                 session_user::text AS session_name,
                 current_database() AS database_name,
                 current_setting('transaction_read_only') = 'on' AS read_only,
                 role.rolcanlogin AS can_login,
                 role.rolsuper AS superuser,
                 role.rolbypassrls AS bypass_rls,
                 role.rolcreatedb AS create_database,
                 role.rolcreaterole AS create_role,
                 role.rolreplication AS replication,
                 EXISTS (
                   SELECT 1 FROM pg_catalog.pg_auth_members AS membership
                   WHERE membership.member = role.oid
                 ) AS has_memberships
          FROM pg_catalog.pg_roles AS role
          WHERE role.rolname = current_user`);
      const checked = boundary.rows[0];
      if (!checked || checked.role_name !== resolved.expectedRole ||
          checked.session_name !== resolved.expectedRole ||
          checked.database_name !== resolved.expectedDatabase || !checked.read_only || !checked.can_login ||
          checked.superuser || checked.bypass_rls || checked.create_database || checked.create_role ||
          checked.replication || checked.has_memberships) {
        throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
      }
      const output = await operation(client);
      await client.query("COMMIT");
      started = false;
      return output;
    } catch (error) {
      if (started) await client.query("ROLLBACK").catch(() => undefined);
      if (isProjectDataPlaneError(error)) throw error;
      throw new ProjectDataPlaneError("DATA_PLANE_UNAVAILABLE");
    } finally {
      client.release();
    }
  }
}

export class DisabledProjectDataPlane implements ProjectDataPlanePort {
  /** Literal statt Klassenname: ein Bundle darf den Klassennamen kuerzen (Review 2.28). */
  readonly kind = "disabled" as const;

  async inspectSchema(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
    _schema: string,
  ): Promise<ProjectSchemaResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectTriggers(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
    _schema: string,
  ): Promise<ProjectTriggerResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectFunctions(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
    _schema: string,
  ): Promise<ProjectFunctionResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectIndexes(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
    _schema: string,
  ): Promise<ProjectIndexResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectPolicies(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
    _schema: string,
  ): Promise<ProjectPolicyResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectEnumTypes(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
    _schema: string,
  ): Promise<ProjectEnumTypeResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectStatistics(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
    _schema: string,
  ): Promise<ProjectStatisticsResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectActivity(_context: ProjectDataPlaneContext, _scope: ProjectDataPlaneScope): Promise<ProjectActivityResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectStatements(_context: ProjectDataPlaneContext, _scope: ProjectDataPlaneScope): Promise<ProjectStatementResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectForeignKeys(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
    _schema: string,
  ): Promise<ProjectForeignKeyResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectExtensions(_context: ProjectDataPlaneContext, _scope: ProjectDataPlaneScope): Promise<ProjectExtensionResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectRoles(_context: ProjectDataPlaneContext, _scope: ProjectDataPlaneScope): Promise<ProjectRoleResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectPublications(_context: ProjectDataPlaneContext, _scope: ProjectDataPlaneScope): Promise<ProjectPublicationResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectReplication(_context: ProjectDataPlaneContext, _scope: ProjectDataPlaneScope): Promise<ProjectReplicationResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectChangeFeed(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
    _cursorPosition: number,
  ): Promise<ProjectChangeFeedResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectColumnPrivileges(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
    _schema: string,
  ): Promise<ProjectColumnPrivilegeResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectForeignDataWrappers(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
  ): Promise<ProjectForeignDataWrapperResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectSettings(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
  ): Promise<ProjectDatabaseSettingsResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectRuntime(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
  ): Promise<ProjectDatabaseRuntimeResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async inspectDatabaseHealth(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
  ): Promise<ProjectDatabaseHealthResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async queryReadOnly(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
    _statement: string,
    _limit: number,
  ): Promise<ProjectReadQueryResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }

  async explainReadQuery(
    _context: ProjectDataPlaneContext,
    _scope: ProjectDataPlaneScope,
    _statement: string,
  ): Promise<ProjectQueryPlanResult> {
    throw new ProjectDataPlaneError("DATA_PLANE_DISABLED");
  }
}

function assertContextAndScope(context: ProjectDataPlaneContext, scope: ProjectDataPlaneScope): void {
  if (!context.organizationId || context.organizationId.length > 128 ||
      !context.actorRef || context.actorRef.length > 320 ||
      !scope.projectId || scope.projectId.length > 128 ||
      !["development", "staging", "production"].includes(scope.environment)) {
    throw new ProjectDataPlaneError("DATA_PLANE_INVALID_INPUT");
  }
}

function assertResolvedBoundary(resolved: ResolvedProjectDatabaseConnection): void {
  if (!resolved || !IDENTIFIER.test(resolved.expectedRole) ||
      !IDENTIFIER.test(resolved.expectedDatabase) || !resolved.pool ||
      typeof resolved.pool.connect !== "function") {
    throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
  }
}

/**
 * `confdeltype` und `confupdtype` aus `pg_constraint` in Worte (2.41). Ein
 * unbekannter Buchstabe ist kein Fall fuer eine Vorgabe: dann kennt QKERN die
 * PostgreSQL-Version nicht, die ihn schreibt, und raten waere schlimmer als
 * abbrechen.
 */
function foreignKeyAction(value: unknown): ProjectForeignKeyAction {
  switch (value) {
    case "a": return "no_action";
    case "r": return "restrict";
    case "c": return "cascade";
    case "n": return "set_null";
    case "d": return "set_default";
    default: throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
  }
}

function relationKind(value: SchemaRow["relation_kind"]): ProjectSchemaTable["kind"] {
  switch (value) {
    case "r": return "table";
    case "p": return "partitioned_table";
    case "v": return "view";
    case "m": return "materialized_view";
    default: throw new ProjectDataPlaneError("DATA_PLANE_BOUNDARY_REJECTED");
  }
}

function normalizeDataValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[MAX_DEPTH]";
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `[BINARY:${value.byteLength}]`;
  if (Array.isArray(value)) return value.map((entry) => normalizeDataValue(entry, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).slice(0, 128)) {
      output[key] = normalizeDataValue(entry, depth + 1);
    }
    return output;
  }
  return String(value);
}
