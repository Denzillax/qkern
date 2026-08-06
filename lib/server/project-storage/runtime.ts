import { ConfigurationError } from "@/lib/server/db/errors";
import { getPostgresPool } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { PostgresProjectStorageRepository } from "@/lib/server/project-storage/postgres-repository";
import {
  ClamAvProjectStorageScanner,
  ClamdInstreamClient,
} from "@/lib/server/project-storage/clamav-scanner";
import {
  MemoryProjectStorageProvider,
  QuarantineOnlyProjectStorageScanner,
  S3ProjectStorageProvider,
  StaticS3ProjectStorageCredentialsProvider,
  type ProjectStorageProvider,
  type ProjectStorageScanner,
} from "@/lib/server/project-storage/provider";
import {
  MemoryProjectStorageRepository,
  type ProjectStorageRepository,
} from "@/lib/server/project-storage/repository";
import { ProjectStorageError, ProjectStorageService } from "@/lib/server/project-storage/service";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";
import { createUsageEmitterFromEnv } from "@/lib/server/usage/runtime";

export type ProjectStorageRuntimeDependencies = {
  repository?: ProjectStorageRepository;
  provider?: ProjectStorageProvider;
  scanner?: ProjectStorageScanner;
};

export function createProjectStorageServiceFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: ProjectStorageRuntimeDependencies = {},
): ProjectStorageService {
  if (env.QKERN_PROJECT_STORAGE_ENABLED !== "true") {
    throw new ProjectStorageError("PROJECT_STORAGE_DISABLED");
  }
  const production = env.NODE_ENV === "production";
  validateStorageOrigins(env, production);
  if (production && !dependencies.scanner) {
    throw new ConfigurationError("Production Project Storage requires an injected malware-scanner adapter.");
  }
  const repository = dependencies.repository ?? (runtimeModeFromEnv(env) === "postgres"
    ? new PostgresProjectStorageRepository(new PostgresControlPlane(getPostgresPool(env)))
    : new MemoryProjectStorageRepository());
  const provider = dependencies.provider ?? providerFromEnv(env, production);
  const scanner = dependencies.scanner ?? scannerFromEnv(env, production, provider);
  return new ProjectStorageService({
    repository,
    provider,
    scanner,
    controlPlane: controlPlaneService,
    usage: createUsageEmitterFromEnv("project_storage", env),
    grantTtlSeconds: integerSetting(env.QKERN_PROJECT_STORAGE_GRANT_TTL_SECONDS, 300, 30, 900),
  });
}

function scannerFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  production: boolean,
  provider: ProjectStorageProvider,
): ProjectStorageScanner {
  if (production) {
    throw new ConfigurationError("Production Project Storage requires an injected malware-scanner adapter.");
  }
  const host = env.QKERN_PROJECT_STORAGE_CLAMAV_HOST?.trim();
  const scannerSettings = [
    env.QKERN_PROJECT_STORAGE_CLAMAV_PORT,
    env.QKERN_PROJECT_STORAGE_SCANNER_CONNECT_TIMEOUT_MS,
    env.QKERN_PROJECT_STORAGE_SCANNER_TIMEOUT_MS,
    env.QKERN_PROJECT_STORAGE_SCANNER_DOWNLOAD_TIMEOUT_MS,
    env.QKERN_PROJECT_STORAGE_SCANNER_MAX_OBJECT_BYTES,
  ].some((value) => value?.trim());
  if (!host) {
    if (scannerSettings) {
      throw new ConfigurationError("QKERN_PROJECT_STORAGE_CLAMAV_HOST is required with scanner settings.");
    }
    return new QuarantineOnlyProjectStorageScanner();
  }
  const config = {
    host,
    port: integerSetting(env.QKERN_PROJECT_STORAGE_CLAMAV_PORT, 3310, 1, 65_535),
    connectTimeoutMs: integerSetting(
      env.QKERN_PROJECT_STORAGE_SCANNER_CONNECT_TIMEOUT_MS, 3_000, 250, 30_000,
    ),
    scanTimeoutMs: integerSetting(
      env.QKERN_PROJECT_STORAGE_SCANNER_TIMEOUT_MS, 60_000, 1_000, 300_000,
    ),
    downloadTimeoutMs: integerSetting(
      env.QKERN_PROJECT_STORAGE_SCANNER_DOWNLOAD_TIMEOUT_MS, 30_000, 1_000, 120_000,
    ),
    maxObjectBytes: integerSetting(
      env.QKERN_PROJECT_STORAGE_SCANNER_MAX_OBJECT_BYTES,
      25 * 1024 * 1024,
      1,
      5 * 1024 ** 3,
    ),
  };
  return new ClamAvProjectStorageScanner(
    provider,
    new ClamdInstreamClient(config),
    config,
  );
}

function providerFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  production: boolean,
): ProjectStorageProvider {
  if (production) {
    throw new ConfigurationError(
      "Production Project Storage requires injected object-provider and rotating credential adapters.",
    );
  }
  const endpoint = env.QKERN_PROJECT_STORAGE_S3_ENDPOINT?.trim();
  const region = env.QKERN_PROJECT_STORAGE_S3_REGION?.trim();
  const bucket = env.QKERN_PROJECT_STORAGE_S3_BUCKET?.trim();
  const accessKeyId = env.QKERN_PROJECT_STORAGE_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.QKERN_PROJECT_STORAGE_S3_SECRET_ACCESS_KEY?.trim();
  const configured = [endpoint, region, bucket, accessKeyId, secretAccessKey].filter(Boolean).length;
  if (configured === 0) return new MemoryProjectStorageProvider();
  if (configured !== 5) {
    throw new ConfigurationError("All QKERN_PROJECT_STORAGE_S3_* development settings are required together.");
  }
  return new S3ProjectStorageProvider({
    endpoint: endpoint!, region: region!, bucket: bucket!, production: false,
    timeoutMs: integerSetting(env.QKERN_PROJECT_STORAGE_PROVIDER_TIMEOUT_MS, 10_000, 500, 30_000),
  }, new StaticS3ProjectStorageCredentialsProvider({
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    ...(env.QKERN_PROJECT_STORAGE_S3_SESSION_TOKEN?.trim()
      ? { sessionToken: env.QKERN_PROJECT_STORAGE_S3_SESSION_TOKEN.trim() }
      : {}),
  }));
}

function integerSetting(value: string | undefined, fallback: number, min: number, max: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ConfigurationError("Invalid Project Storage numeric setting.");
  }
  return parsed;
}

function validateStorageOrigins(env: Readonly<Record<string, string | undefined>>, production: boolean) {
  const entries = env.QKERN_PROJECT_STORAGE_ALLOWED_ORIGINS?.split(",")
    .map((entry) => entry.trim()).filter(Boolean) ?? [];
  if (entries.length > 20 || new Set(entries).size !== entries.length) {
    throw new ConfigurationError("Invalid Project Storage allowed origins.");
  }
  for (const entry of entries) {
    try {
      const url = new URL(entry);
      const localHttp = !production && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
      if ((url.protocol !== "https:" && !localHttp) || url.origin !== entry || url.username || url.password) {
        throw new Error("invalid");
      }
    } catch {
      throw new ConfigurationError("Project Storage allowed origins must be exact HTTPS origins.");
    }
  }
}

type GlobalProjectStorage = typeof globalThis & { __qkernProjectStorageService?: ProjectStorageService };

export function getProjectStorageService(): ProjectStorageService {
  const runtime = globalThis as GlobalProjectStorage;
  runtime.__qkernProjectStorageService ??= createProjectStorageServiceFromEnv();
  return runtime.__qkernProjectStorageService;
}
