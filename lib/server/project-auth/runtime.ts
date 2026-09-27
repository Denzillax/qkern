import { readFileSync, statSync } from "node:fs";
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
import { createFunctionInvocationServiceFromEnv } from "@/lib/server/compute/definitions-runtime";
import { ProjectAuthFunctionHooks } from "@/lib/server/project-auth/hooks-functions";
import type { ProjectAuthHookPort } from "@/lib/server/project-auth/hooks";
import {
  parseProjectAuthLeakList,
  projectAuthBuiltInLeakList,
  PROJECT_AUTH_LEAK_ALGORITHMS,
  PROJECT_AUTH_LEAK_LIST_BOUNDS,
  type ProjectAuthLeakAlgorithm,
  type ProjectAuthLeakList,
} from "@/lib/server/project-auth/password-leaks";

export type ProjectAuthRuntimeDependencies = {
  repository?: ProjectAuthRepository;
  delivery?: ProjectAuthDeliveryPort;
  tokens?: ProjectAuthTokenService;
  secrets?: ProjectAuthSecretProtector;
  oidcCatalog?: ProjectAuthOidcCatalog;
  oidcClient?: ProjectAuthOidcClient;
  audit?: ProjectAuthAuditSink;
  hooks?: ProjectAuthHookPort;
};

/**
 * Der Weg zu den hinterlegten Functions fuer die Auth-Hooks (2.77).
 *
 * Es gibt ihn nur, wenn es Functions gibt: `QKERN_FUNCTIONS_ENABLED=true` und
 * PostgreSQL-Betrieb. Fremden Code auszufuehren ist eine eigene Freischaltung,
 * und Project Auth darf sie nicht nebenbei mitbringen.
 *
 * Ohne diesen Weg bleibt der Port leer. Ein Punkt ohne eingetragene Function
 * merkt davon nichts; ein Punkt **mit** eingetragener Function faellt dann
 * geschlossen, weil ein Hook, den niemand rufen kann, nicht geantwortet hat.
 * Wer Project Auth ohne Functions betreibt, traegt keinen Hook ein.
 */
function projectAuthHookPortFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): ProjectAuthHookPort | undefined {
  if (env.QKERN_FUNCTIONS_ENABLED !== "true" || runtimeModeFromEnv(env) !== "postgres") return undefined;
  return new ProjectAuthFunctionHooks({
    functions: createFunctionInvocationServiceFromEnv(env),
    // Geloggt werden Punkt und Fehlerklasse, nie eine Nutzlast und nie eine
    // Adresse. Die Entscheidung selbst faellt im Dienst und steht im Audit.
    onFailure: ({ point, error }) => {
      console.error("Project Auth hook did not answer", { point, error });
    },
  });
}

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
    leakedPasswords: leakedPasswordListFromEnv(env),
    rateLimiter: new InMemoryRateLimiter(),
    tokens: dependencies.tokens ?? projectAuthTokenServiceFromEnv(env),
    mfa: new ProjectAuthTotp(),
    secrets: dependencies.secrets ?? projectAuthSecretProtectorFromEnv(env),
    delivery,
    oidcCatalog: dependencies.oidcCatalog ?? projectAuthOidcCatalogFromEnv(env),
    oidcClient: dependencies.oidcClient ?? new ProjectAuthOidcClient(env),
    audit,
    hooks: dependencies.hooks ?? projectAuthHookPortFromEnv(env),
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

/**
 * Die Leckliste (2.53), einmal beim Bau des Dienstes von der Platte gelesen.
 *
 * Ohne `QKERN_PROJECT_AUTH_LEAKED_PASSWORD_FILE` gilt die eingebaute Liste.
 * Mit ihr gilt die Datei — und zwar entweder ganz oder gar nicht: Eine
 * fehlende, zu grosse oder fehlerhafte Datei ist eine
 * `ConfigurationError` und laesst Project Auth gar nicht erst starten. Das
 * ist die unbequeme Variante und die richtige: Eine Installation, die auf
 * eine Leckliste zeigt, will gegen sie pruefen. Stillschweigend auf die
 * eingebaute Liste zurueckzufallen hiesse, eine eingeschaltete Pruefung
 * weiterlaufen zu lassen, die nichts mehr prueft.
 *
 * Der Fehlertext nennt den Grund und die Zeilennummer, nie den Pfad und nie
 * einen Eintrag.
 */
export function leakedPasswordListFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProjectAuthLeakList {
  const file = env.QKERN_PROJECT_AUTH_LEAKED_PASSWORD_FILE?.trim();
  if (!file) return projectAuthBuiltInLeakList();
  const algorithmValue = env.QKERN_PROJECT_AUTH_LEAKED_PASSWORD_ALGORITHM?.trim() || "sha1";
  if (!(PROJECT_AUTH_LEAK_ALGORITHMS as readonly string[]).includes(algorithmValue)) {
    throw new ConfigurationError(
      "QKERN_PROJECT_AUTH_LEAKED_PASSWORD_ALGORITHM must be sha1 or sha256.",
    );
  }
  const algorithm = algorithmValue as ProjectAuthLeakAlgorithm;
  let text: string;
  try {
    // Erst die Groesse, dann der Inhalt: Eine Datei jenseits der Grenze soll
    // gar nicht erst in den Speicher kommen.
    if (statSync(file).size > PROJECT_AUTH_LEAK_LIST_BOUNDS.bytes) {
      throw new ConfigurationError(
        "The Project Auth leaked password list is larger than the allowed 16 MiB.",
      );
    }
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError("The Project Auth leaked password list could not be read.");
  }
  const parsed = parseProjectAuthLeakList(text, algorithm);
  if (!parsed.ok) {
    throw new ConfigurationError(
      `The Project Auth leaked password list is malformed (${parsed.reason}, line ${parsed.line}).`,
    );
  }
  return parsed.list;
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
