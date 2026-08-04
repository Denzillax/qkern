import { ConfigurationError } from "@/lib/server/db/errors";

export type RuntimeMode = "memory" | "postgres";

export function runtimeModeFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): RuntimeMode {
  const configured = [
    ["QKERN_RUNTIME_MODE", env.QKERN_RUNTIME_MODE],
    ["QKERN_AUTH_ADAPTER", env.QKERN_AUTH_ADAPTER],
    ["QKERN_TENANCY_ADAPTER", env.QKERN_TENANCY_ADAPTER],
    ["QKERN_CONTROL_PLANE_ADAPTER", env.QKERN_CONTROL_PLANE_ADAPTER],
  ] as const;
  const selected = configured.flatMap(([name, raw]) => {
    if (!raw?.trim()) return [];
    const value = raw.trim().toLowerCase();
    if (value !== "memory" && value !== "postgres") throw new ConfigurationError(`${name} must be either memory or postgres.`);
    return [value as RuntimeMode];
  });
  if (new Set(selected).size > 1) throw new ConfigurationError("All QKERN runtime adapters must select one consistent mode.");
  const mode = selected[0] ?? "memory";
  if (env.NODE_ENV === "production" && env.NEXT_PHASE !== "phase-production-build" && mode !== "postgres") {
    throw new ConfigurationError("Production requires QKERN_RUNTIME_MODE=postgres.");
  }
  return mode;
}
