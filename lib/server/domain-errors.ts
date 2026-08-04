import { RepositoryError } from "@/lib/server/db/errors";

export function domainErrorCode(error: unknown): string | undefined {
  if (error instanceof RepositoryError) return error.code;
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return error instanceof Error ? error.message : undefined;
}
