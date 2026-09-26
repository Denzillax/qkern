import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import { Argon2idPasswordHasher } from "@/lib/server/auth/password";
import { ConfigurationError } from "@/lib/server/db/errors";
import { getAuthPostgresPool } from "@/lib/server/db/pool";
import { ProjectAuthSecretProtector, ProjectAuthTotp, projectAuthSecretProtectorFromEnv } from
  "@/lib/server/project-auth/mfa";
import { ProjectAuthOidcClient, ProjectAuthOidcCatalog, projectAuthOidcCatalogFromEnv } from
  "@/lib/server/project-auth/oidc";
import { MemoryProjectAuthAuditSink, type ProjectAuthAuditSink } from "@/lib/server/project-auth/audit";
import { PostgresProjectAuthAuditSink } from "@/lib/server/project-auth/audit-postgres";
import { PostgresProjectAuthRepository } from "@/lib/server/project-auth/postgres-repository";
import { MemoryProjectAuthRepository, type ProjectAuthRepository } from "@/lib/server/project-auth/repository";
import {
  DisabledProjectAuthDelivery,
  NoopDevelopmentProjectAuthDelivery,
  ProjectAuthError,
  ProjectAuthService,
  type ProjectAuthDeliveryPort,
} from "@/lib/server/project-auth/service";
import { smtpProjectAuthDeliveryFromEnv } from "@/lib/server/project-auth/smtp-delivery";
import { projectAuthTokenServiceFromEnv, type ProjectAuthTokenService } from
  "@/lib/server/project-auth/tokens";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";

export type ProjectAuthRuntimeDependencies = {
  repository?: ProjectAuthRepository;
  delivery?: ProjectAuthDeliveryPort;
  tokens?: ProjectAuthTokenService;
  secrets?: ProjectAuthSecretProtector;
  oidcCatalog?: ProjectAuthOidcCatalog;
  oidcClient?: ProjectAuthOidcClient;
  audit?: ProjectAuthAuditSink;
};

export function createProjectAuthServiceFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: ProjectAuthRuntimeDependencies = {},
): ProjectAuthService {
  if (env.QKERN_PROJECT_AUTH_ENABLED !== "true") throw new ProjectAuthError("PROJECT_AUTH_DISABLED");
  const production = env.NODE_ENV === "production";
  const exposeTokens = env.QKERN_PROJECT_AUTH_DEV_EXPOSE_TOKENS === "true";
  if (production && exposeTokens) {
    throw new ConfigurationError("Project Auth delivery tokens can never be exposed in production.");
  }
  const postgres = runtimeModeFromEnv(env) === "postgres";
  const repository = dependencies.repository ?? (postgres
    ? new PostgresProjectAuthRepository(getAuthPostgresPool(env))
    : new MemoryProjectAuthRepository());
  // Audit ueber denselben Auth-Pool in die Hash-Kette der Plattform (2.35);
  // im Speicherbetrieb ein Speicher-Sink, damit die Console etwas zeigt.
  const audit = dependencies.audit ?? (postgres
    ? new PostgresProjectAuthAuditSink(getAuthPostgresPool(env))
    : new MemoryProjectAuthAuditSink());
  const allowedRedirectOrigins = redirectOriginsFromEnv(env);
  const callbackBaseUrl = callbackBaseFromEnv(env);
  // A configured SMTP host is the only way to obtain real delivery. Without it
  // the port stays fail-closed, so a production deployment that forgets the
  // mail configuration refuses to issue action tokens instead of silently
  // dropping them.
  const delivery = dependencies.delivery
    ?? smtpProjectAuthDeliveryFromEnv(env)
    ?? (exposeTokens ? new NoopDevelopmentProjectAuthDelivery() : new DisabledProjectAuthDelivery());
  return new ProjectAuthService({
    repository,
    passwords: new Argon2idPasswordHasher({ pepper: env.QKERN_PROJECT_AUTH_PASSWORD_PEPPER }),
    rateLimiter: new InMemoryRateLimiter(),
    tokens: dependencies.tokens ?? projectAuthTokenServiceFromEnv(env),
    mfa: new ProjectAuthTotp(),
    secrets: dependencies.secrets ?? projectAuthSecretProtectorFromEnv(env),
    delivery,
    oidcCatalog: dependencies.oidcCatalog ?? projectAuthOidcCatalogFromEnv(env),
    oidcClient: dependencies.oidcClient ?? new ProjectAuthOidcClient(env),
    audit,
    callbackBaseUrl,
    allowedRedirectOrigins,
    exposeDeliveryTokens: exposeTokens,
    refreshTtlMs: integerSetting(env.QKERN_PROJECT_AUTH_REFRESH_TTL_SECONDS, 30 * 24 * 60 * 60, 3600, 90 * 24 * 60 * 60) * 1_000,
  });
}

type GlobalProjectAuth = typeof globalThis & { __qkernProjectAuthService?: ProjectAuthService };

export function getProjectAuthService(): ProjectAuthService {
  const runtime = globalThis as GlobalProjectAuth;
  runtime.__qkernProjectAuthService ??= createProjectAuthServiceFromEnv();
  return runtime.__qkernProjectAuthService;
}

function redirectOriginsFromEnv(env: Readonly<Record<string, string | undefined>>): ReadonlySet<string> {
  const raw = env.QKERN_PROJECT_AUTH_REDIRECT_ORIGINS?.trim() ||
    (!env.NODE_ENV || env.NODE_ENV !== "production" ? env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000" : "");
  const entries = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (entries.length < 1 || entries.length > 20) {
    throw new ConfigurationError("QKERN_PROJECT_AUTH_REDIRECT_ORIGINS must contain 1 to 20 exact HTTPS origins.");
  }
  const origins = new Set<string>();
  for (const entry of entries) {
    try {
      const url = new URL(entry);
      const localHttp = env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
      if ((url.protocol !== "https:" && !localHttp) || url.origin !== entry || url.username || url.password) throw new Error("invalid");
      origins.add(url.origin);
    } catch {
      throw new ConfigurationError("Project Auth redirect origins must be exact HTTPS origins.");
    }
  }
  return origins;
}

function callbackBaseFromEnv(env: Readonly<Record<string, string | undefined>>): string {
  const raw = env.QKERN_PROJECT_AUTH_CALLBACK_BASE_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim() ||
    (env.NODE_ENV === "production" ? "" : "http://localhost:3000");
  try {
    const url = new URL(raw);
    const localHttp = env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !localHttp) || url.origin !== raw || url.username || url.password) throw new Error("invalid");
    return url.origin;
  } catch {
    throw new ConfigurationError("QKERN_PROJECT_AUTH_CALLBACK_BASE_URL must be an exact HTTPS origin.");
  }
}

function integerSetting(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ConfigurationError("Invalid Project Auth numeric setting.");
  }
  return parsed;
}
