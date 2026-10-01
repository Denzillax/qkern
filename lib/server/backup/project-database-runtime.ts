import { ConfigurationError } from "@/lib/server/db/errors";
import { createPostgresPool } from "@/lib/server/db/pool";
import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlPool, SqlQueryable } from "@/lib/server/db/sql";
import {
  VaultProjectDatabaseConnectionCatalog,
  VaultStaticDatabaseCredentialSource,
  VaultTokenFileProvider,
  type VaultProjectDatabaseBinding,
  type VaultProjectDatabaseCatalogOptions,
} from "@/lib/server/migrations/connection-catalog-vault";
import { vaultCatalogRuntimeOptionsFromEnv } from "@/lib/server/migrations/connection-catalog-vault-env";
import {
  PgDumpProjectDatabaseDumpPort,
  PsqlProjectDatabaseRestoreTargetPort,
  type ProjectDatabaseBackupCredential,
  type ProjectDatabaseBackupEndpoint,
  type ProjectDatabaseBackupEndpointResolver,
} from "@/lib/server/backup/project-database-dump";
import {
  FileBackupDataKeyProtector,
  S3ProjectDatabaseBackupObjectStore,
} from "@/lib/server/backup/project-database-object-store";
import { PostgresProjectDatabaseBackupStore } from "@/lib/server/backup/project-database-postgres";
import {
  ProjectDatabaseBackupService,
  type ProjectDatabaseBackupLogEvent,
} from "@/lib/server/backup/project-database";

/**
 * Die Verdrahtung des Backup-Weges (2.126).
 *
 * ## Woher die Rollennamen kommen
 *
 * Eine Bindung in `project_database_bindings` (0020) traegt **eine** Rolle, und
 * das ist die der Data API. Ein Backup braucht eine andere, und die Bindung
 * kann sie nicht nennen, ohne dass 0020 eine Spalte dazubekommt.
 *
 * Sie wird darum abgeleitet, und zwar aus zwei Stuecken:
 *
 * - **Der Datenbank-Rollenname ist ueberall derselbe.** Jede Projektdatenbank
 *   entsteht aus demselben Bootstrap-Vertrag
 *   (`PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256`), also hat jede dieselben
 *   Rollen: `qkern_ledger_owner`, `qkern_project_api_app`, und seit 2.126
 *   `qkern_project_backup` und `qkern_project_restore_admin`. Ein Name je
 *   Datenbank waere eine Vielfalt, die der Vertrag gar nicht zulaesst.
 * - **Der Vault-Rollenname haengt an der Datenbank** und folgt dem der Bindung
 *   mit festem Zusatz: `<bindung>-backup` und `<bindung>-restore-admin`. Der
 *   Zusatz ist Einstellung des Betriebs und nicht Mandanteneingabe; was er
 *   ergibt, wird gegen die Form einer Vault-Rolle geprueft, bevor eine Anfrage
 *   hinausgeht.
 *
 * Das ist eine Vereinbarung, und sie steht hier, damit sie nicht in einem
 * Betriebshandbuch verloren geht: **wer eine Projektdatenbank bereitstellt,
 * legt diese beiden Vault-Rollen mit an.** Fehlt eine, scheitert das Backup mit
 * `KEY_UNAVAILABLE` oder `CONNECTION_UNAVAILABLE` und nicht still.
 *
 * ## Was hier **nicht** aus der Umgebung kommt
 *
 * Kein Passwort, kein Vault-Token (nur der Pfad seiner Datei), kein
 * Mandanten-Schluessel (nur das Verzeichnis, in das der Vault Agent ihn
 * schreibt) und keine Datenbankadresse (die kommt aus der Bindung). Die
 * Zugangsdaten des Objektspeichers sind die eine Ausnahme, und sie ist dieselbe
 * wie bei Project Storage: ein S3-Schluesselpaar ist dort schon eine
 * Umgebungsangabe, und eine zweite Quelle dafuer waere eine zweite Antwort auf
 * dieselbe Frage.
 */
export const PROJECT_DATABASE_BACKUP_ENV = Object.freeze({
  enabled: "QKERN_PROJECT_BACKUP_ENABLED",
  organizationId: "QKERN_PROJECT_BACKUP_ORGANIZATION_ID",
  workerId: "QKERN_PROJECT_BACKUP_WORKER_ID",
  readerRole: "QKERN_PROJECT_BACKUP_DB_ROLE",
  readerVaultSuffix: "QKERN_PROJECT_BACKUP_VAULT_ROLE_SUFFIX",
  adminRole: "QKERN_PROJECT_RESTORE_ADMIN_DB_ROLE",
  adminVaultSuffix: "QKERN_PROJECT_RESTORE_ADMIN_VAULT_ROLE_SUFFIX",
  maintenanceDatabase: "QKERN_PROJECT_RESTORE_MAINTENANCE_DATABASE",
  caFile: "QKERN_PROJECT_BACKUP_CA_FILE",
  keyDirectory: "QKERN_PROJECT_BACKUP_KEY_DIRECTORY",
  keyId: "QKERN_PROJECT_BACKUP_KEY_ID",
  objectEndpoint: "QKERN_PROJECT_BACKUP_S3_ENDPOINT",
  objectRegion: "QKERN_PROJECT_BACKUP_S3_REGION",
  objectBucket: "QKERN_PROJECT_BACKUP_S3_BUCKET",
  objectAccessKeyId: "QKERN_PROJECT_BACKUP_S3_ACCESS_KEY_ID",
  objectSecretAccessKey: "QKERN_PROJECT_BACKUP_S3_SECRET_ACCESS_KEY",
  retentionDays: "QKERN_PROJECT_BACKUP_RETENTION_DAYS",
  vaultTokenFile: "QKERN_VAULT_TOKEN_FILE",
});

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const VAULT_SUFFIX = /^-[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProjectDatabaseBackupRuntime = Readonly<{
  service: ProjectDatabaseBackupService;
  store: PostgresProjectDatabaseBackupStore;
  close(): Promise<void>;
}>;

/**
 * Die Bindung einer Projektdatenbank, gelesen aus der Control Plane. Jede
 * Lesung lauft unter der Organisation dieses Dienstes, also unter
 * Zeilensicherheit: eine fremde Bindung kommt hier nicht heraus.
 */
class ControlPlaneBackupEndpointResolver implements ProjectDatabaseBackupEndpointResolver {
  private readonly bindings = new Map<string, VaultProjectDatabaseBinding>();
  private readonly sources = new Map<string, VaultStaticDatabaseCredentialSource>();

  constructor(
    private readonly database: Pick<PostgresControlPlane, "withTenant">,
    private readonly organizationId: string,
    private readonly vaultOptions: Omit<VaultProjectDatabaseCatalogOptions, "bindings">,
    private readonly shape: Readonly<{
      expectedRole: string;
      vaultRoleSuffix: string;
      /** Gesetzt heisst: diese Verbindung geht in die Wartungsdatenbank, nicht in die Projektdatenbank. */
      database?: string;
      caFilePath?: string;
    }>,
  ) {}

  async binding(databaseInstanceRef: string): Promise<VaultProjectDatabaseBinding> {
    const cached = this.bindings.get(databaseInstanceRef);
    if (cached) return cached;
    const record = await this.database.withTenant({
      organizationId: this.organizationId,
      actorRef: "project-database-backup",
      readOnly: true,
    }, (repositories) => repositories.projectDatabaseBindings.getByReference(databaseInstanceRef));
    const vaultStaticRole = `${record.vaultStaticRole}${this.shape.vaultRoleSuffix}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(vaultStaticRole)) {
      throw new ConfigurationError("The derived Vault role for the project database backup is invalid.");
    }
    const binding: VaultProjectDatabaseBinding = Object.freeze({
      databaseInstanceRef: record.databaseInstanceRef,
      vaultStaticRole,
      host: record.host,
      port: record.port,
      expectedRole: this.shape.expectedRole,
      expectedDatabase: this.shape.database ?? record.expectedDatabase,
      expectedLedgerOwner: record.expectedLedgerOwner,
      serverCertificateSha256: record.serverCertificateSha256,
    });
    this.bindings.set(databaseInstanceRef, binding);
    return binding;
  }

  async endpoint(databaseInstanceRef: string): Promise<ProjectDatabaseBackupEndpoint> {
    const binding = await this.binding(databaseInstanceRef);
    return Object.freeze({
      host: binding.host,
      port: binding.port,
      database: binding.expectedDatabase,
      caFilePath: this.shape.caFilePath,
    });
  }

  async credential(
    databaseInstanceRef: string,
    signal?: AbortSignal,
  ): Promise<ProjectDatabaseBackupCredential> {
    const source = await this.source(databaseInstanceRef);
    const credential = await source.credentialFor(databaseInstanceRef, signal);
    return Object.freeze({ username: credential.username, password: credential.password });
  }

  /** Ein Pool fuer dieselbe Rolle, fuer das Manifest. Der Katalog haelt das Passwort. */
  async pool(databaseInstanceRef: string): Promise<SqlPool> {
    const binding = await this.binding(databaseInstanceRef);
    const existing = this.catalogs.get(databaseInstanceRef);
    if (existing) return existing.resolve(databaseInstanceRef).pool;
    const catalog = new VaultProjectDatabaseConnectionCatalog({ ...this.vaultOptions, bindings: [binding] });
    this.catalogs.set(databaseInstanceRef, catalog);
    return catalog.resolve(databaseInstanceRef).pool;
  }

  private readonly catalogs = new Map<string, VaultProjectDatabaseConnectionCatalog>();

  private async source(databaseInstanceRef: string): Promise<VaultStaticDatabaseCredentialSource> {
    const existing = this.sources.get(databaseInstanceRef);
    if (existing) return existing;
    const binding = await this.binding(databaseInstanceRef);
    const source = new VaultStaticDatabaseCredentialSource({ ...this.vaultOptions, bindings: [binding] });
    this.sources.set(databaseInstanceRef, source);
    return source;
  }

  async close(): Promise<void> {
    const catalogs = [...this.catalogs.values()];
    this.catalogs.clear();
    await Promise.allSettled(catalogs.map((catalog) => catalog.close()));
  }
}

export type ProjectDatabaseBackupRuntimeDependencies = Readonly<{
  /** Die Control Plane mit der Rolle des Prozesses, also `qkern_provisioner_app`. */
  controlPlane: Pick<PostgresControlPlane, "withTenant">;
  /** Derselbe Pool, auf dem der Katalog seine Zeilen schreibt. */
  controlPlanePool: SqlPool;
  logger?: { log(event: ProjectDatabaseBackupLogEvent): void };
  now?: () => Date;
  fetchFn?: typeof fetch;
}>;

/**
 * Baut den Backup-Weg aus der Umgebung. Fehlt eine Angabe, wird **nichts**
 * gebaut und `null` zurueckgegeben: ein Prozess ohne Backup-Einstellungen soll
 * sich nicht anders verhalten als vorher, und ein halb eingestellter Weg soll
 * nicht laufen.
 */
export function createProjectDatabaseBackupRuntimeFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  dependencies: ProjectDatabaseBackupRuntimeDependencies,
): ProjectDatabaseBackupRuntime | null {
  if (env[PROJECT_DATABASE_BACKUP_ENV.enabled] !== "true") return null;

  const organizationId = env[PROJECT_DATABASE_BACKUP_ENV.organizationId]?.trim() ?? "";
  const workerId = env[PROJECT_DATABASE_BACKUP_ENV.workerId]?.trim() ?? "";
  const readerRole = env[PROJECT_DATABASE_BACKUP_ENV.readerRole]?.trim() ?? "qkern_project_backup";
  const adminRole = env[PROJECT_DATABASE_BACKUP_ENV.adminRole]?.trim() ?? "qkern_project_restore_admin";
  const readerSuffix = env[PROJECT_DATABASE_BACKUP_ENV.readerVaultSuffix]?.trim() ?? "-backup";
  const adminSuffix = env[PROJECT_DATABASE_BACKUP_ENV.adminVaultSuffix]?.trim() ?? "-restore-admin";
  const maintenanceDatabase = env[PROJECT_DATABASE_BACKUP_ENV.maintenanceDatabase]?.trim() ?? "postgres";
  const caFilePath = env[PROJECT_DATABASE_BACKUP_ENV.caFile]?.trim();
  const tokenFile = env[PROJECT_DATABASE_BACKUP_ENV.vaultTokenFile]?.trim() ?? "";
  const production = env.NODE_ENV === "production";

  if (!UUID.test(organizationId) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(workerId) ||
      !IDENTIFIER.test(readerRole) || !IDENTIFIER.test(adminRole) ||
      !IDENTIFIER.test(maintenanceDatabase) ||
      !VAULT_SUFFIX.test(readerSuffix) || !VAULT_SUFFIX.test(adminSuffix) ||
      readerSuffix === adminSuffix || readerRole === adminRole ||
      (caFilePath !== undefined && !caFilePath.startsWith("/"))) {
    throw new ConfigurationError("The project database backup configuration is invalid.");
  }

  const vaultOptions = vaultCatalogRuntimeOptionsFromEnv(env, {
    tokenProvider: new VaultTokenFileProvider(tokenFile, { production }),
    fetchFn: dependencies.fetchFn,
    clientName: "qkern-project-database-backup",
  });

  const reader = new ControlPlaneBackupEndpointResolver(
    dependencies.controlPlane, organizationId, vaultOptions,
    { expectedRole: readerRole, vaultRoleSuffix: readerSuffix, caFilePath },
  );
  const admin = new ControlPlaneBackupEndpointResolver(
    dependencies.controlPlane, organizationId, vaultOptions,
    { expectedRole: adminRole, vaultRoleSuffix: adminSuffix, database: maintenanceDatabase, caFilePath },
  );

  const objects = new S3ProjectDatabaseBackupObjectStore({
    endpoint: env[PROJECT_DATABASE_BACKUP_ENV.objectEndpoint]?.trim() ?? "",
    region: env[PROJECT_DATABASE_BACKUP_ENV.objectRegion]?.trim() ?? "",
    bucket: env[PROJECT_DATABASE_BACKUP_ENV.objectBucket]?.trim() ?? "",
    accessKeyId: env[PROJECT_DATABASE_BACKUP_ENV.objectAccessKeyId]?.trim() ?? "",
    secretAccessKey: env[PROJECT_DATABASE_BACKUP_ENV.objectSecretAccessKey] ?? "",
    production,
  }, dependencies.fetchFn, dependencies.now);

  const keys = new FileBackupDataKeyProtector({
    directory: env[PROJECT_DATABASE_BACKUP_ENV.keyDirectory]?.trim() ?? "",
    currentKeyId: env[PROJECT_DATABASE_BACKUP_ENV.keyId]?.trim() ?? "",
    production,
  });

  const dump = new PgDumpProjectDatabaseDumpPort({
    endpoints: reader,
    // Derselbe Resolver und damit dieselbe Rolle wie der Dump. Das Manifest
    // eines Backups darf nicht von einer zweiten Rolle gelesen werden; sonst
    // vergleicht der Nachweis spaeter zwei Sichtbarkeiten.
    readerPool: (databaseInstanceRef) => reader.pool(databaseInstanceRef),
  });

  const restoreTarget = new PsqlProjectDatabaseRestoreTargetPort({
    admin,
    reader,
    maintenanceDatabase,
    readerFactory: async (input) => {
      const pool = createPostgresPool({
        connectionString: poolUrl(input.endpoint, input.credential, input.databaseName),
        applicationName: "qkern-project-database-backup",
        max: 1,
        ssl: production ? { rejectUnauthorized: true } : false,
      });
      return { database: pool, close: () => pool.end() };
    },
  });

  const store = new PostgresProjectDatabaseBackupStore(
    dependencies.controlPlanePool, organizationId, workerId,
  );

  const service = new ProjectDatabaseBackupService({
    store,
    dump,
    objects,
    keys,
    restoreTarget,
    workerId,
    retentionDays: integerFromEnv(env, PROJECT_DATABASE_BACKUP_ENV.retentionDays, 30, 1, 730),
    now: dependencies.now,
    logger: dependencies.logger,
  });

  return Object.freeze({
    service,
    store,
    close: async () => {
      await Promise.allSettled([reader.close(), admin.close()]);
    },
  });
}

/**
 * Die Verbindungszeile fuer einen Pool. Sie traegt ein Passwort und darf darum
 * nirgends hin ausser in den Treiber; `URL` setzt die Prozentkodierung, damit
 * ein Passwort mit `@` nicht die Adresse verschiebt.
 */
function poolUrl(
  endpoint: ProjectDatabaseBackupEndpoint,
  credential: ProjectDatabaseBackupCredential,
  databaseName: string,
): string {
  const url = new URL("postgresql://placeholder.invalid");
  url.username = credential.username;
  url.password = credential.password;
  url.hostname = endpoint.host.includes(":") ? `[${endpoint.host}]` : endpoint.host;
  url.port = String(endpoint.port);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function integerFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ConfigurationError("The project database backup retention is invalid.");
  }
  return value;
}
