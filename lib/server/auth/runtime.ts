import { InMemorySessionRepository, InMemoryUserRepository } from "@/lib/server/auth/memory-repositories";
import { PostgresRegistrationRepository, PostgresSessionRepository, PostgresUserRepository } from "@/lib/server/auth/postgres-repositories";
import { Argon2idPasswordHasher } from "@/lib/server/auth/password";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import { AuthService } from "@/lib/server/auth/service";
import { ConfigurationError } from "@/lib/server/db/errors";
import { getAuthPostgresPool } from "@/lib/server/db/pool";
import type { SqlPool } from "@/lib/server/db/sql";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";

export type AuthAdapter = "memory" | "postgres";

export function authAdapterFromEnv(env: Record<string, string | undefined> = process.env): AuthAdapter {
  const adapter = runtimeModeFromEnv(env);
  if (adapter === "postgres" && !env.QKERN_AUTH_DATABASE_URL?.trim()) {
    throw new ConfigurationError("QKERN_AUTH_DATABASE_URL is required when QKERN_RUNTIME_MODE=postgres.");
  }
  return adapter;
}

export function createAuthRuntime(env: Record<string, string | undefined> = process.env, dependencies: { pool?: SqlPool } = {}) {
  const adapter = authAdapterFromEnv(env);
  const pool = adapter === "postgres" ? dependencies.pool ?? getAuthPostgresPool(env) : undefined;
  const users = pool ? new PostgresUserRepository(pool) : new InMemoryUserRepository();
  const sessions = pool ? new PostgresSessionRepository(pool) : new InMemorySessionRepository();
  const rateLimiter = new InMemoryRateLimiter();
  const passwords = new Argon2idPasswordHasher({ pepper: env.QKERN_PASSWORD_PEPPER });
  const registration = pool ? new PostgresRegistrationRepository(pool) : undefined;
  return {
    adapter,
    users,
    sessions,
    rateLimiter,
    passwords,
    registration,
    service: new AuthService({ users, sessions, rateLimiter, passwords, registration }),
  };
}

type AuthRuntime = ReturnType<typeof createAuthRuntime>;
const globalAuth = globalThis as typeof globalThis & { __qkernAuthRuntime?: AuthRuntime };
export const authRuntime = globalAuth.__qkernAuthRuntime ?? createAuthRuntime();
if (process.env.NODE_ENV !== "production") globalAuth.__qkernAuthRuntime = authRuntime;
