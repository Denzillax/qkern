import type { Environment, Risk } from "@/lib/types";
import { parse } from "pgsql-ast-parser";

const MUTATING_SQL = /\b(insert|update|delete|alter|drop|truncate|create|grant|revoke|comment|vacuum|copy)\b/i;
const CRITICAL_SQL = /\b(drop\s+(database|table)|truncate|alter\s+table\s+\S+\s+drop|delete\s+from\s+\S+\s*;?$)\b/i;
const HIGH_SQL = /\b(update\s+\S+\s+set\b(?![\s\S]*\bwhere\b)|delete\s+from\b(?![\s\S]*\bwhere\b)|alter\s+table)\b/i;

export function isReadOnlySql(statement: string): boolean {
  const normalized = statement.trim();
  if (!normalized || normalized.length > 4_000) return false;
  try {
    const statements = parse(normalized);
    if (statements.length !== 1 || !isSelectStatement(statements[0] as unknown as Record<string, unknown>)) return false;
    return !containsUnsafeSelectFeature(statements[0]);
  } catch {
    return false;
  }
}

export function validateSingleSqlStatement(statement: string): { valid: true } | { valid: false; reason: string } {
  const normalized = statement.trim();
  if (!normalized) return { valid: false, reason: "SQL statement is empty" };
  if (normalized.length > 10_000) return { valid: false, reason: "SQL statement exceeds the 10,000 character limit" };
  if (/\b(?:alter|create)\s+(?:user|role)\b[\s\S]{0,160}\bpassword\b/i.test(normalized) ||
      /\b(?:password|secret|access[_-]?token|refresh[_-]?token|api[_-]?key)\b\s*(?:=|to)\s*(?:'|")/i.test(normalized)) {
    return { valid: false, reason: "Inline credentials are forbidden; use a managed secret reference" };
  }
  if (/\bqkern_internal\b/i.test(normalized)) {
    return { valid: false, reason: "The qkern_internal namespace is reserved for QKERN's migration ledger" };
  }
  if (/^(?:begin|start\s+transaction|commit|end|rollback|abort|savepoint|release\s+savepoint|prepare\s+transaction|commit\s+prepared|rollback\s+prepared)\b/i.test(normalized) ||
      /^(?:set|reset)\s+(?:local\s+|session\s+)?(?:role|session\s+authorization)\b/i.test(normalized) ||
      /^(?:alter\s+system|create\s+database|drop\s+database|vacuum)\b/i.test(normalized) ||
      /\b(?:create\s+(?:unique\s+)?index|drop\s+index|reindex\b[\s\S]*?)\s+concurrently\b/i.test(normalized) ||
      /^copy\b[\s\S]*\bprogram\b/i.test(normalized)) {
    return { valid: false, reason: "Statement is not allowed inside QKERN's managed migration transaction" };
  }
  try {
    const statements = parse(normalized);
    if (statements.length !== 1) return { valid: false, reason: "Exactly one SQL statement is required per Change Set" };
    return { valid: true };
  } catch {
    return { valid: false, reason: "SQL statement could not be parsed" };
  }
}

function isSelectStatement(node: Record<string, unknown>): boolean {
  if (node.type === "select") return !("into" in node);
  if (node.type === "union" || node.type === "union all") {
    return isSelectStatement(node.left as Record<string, unknown>) && isSelectStatement(node.right as Record<string, unknown>);
  }
  if (node.type === "with") {
    const bindings = Array.isArray(node.bind) ? node.bind : [];
    return bindings.every((binding) => {
      const statement = (binding as Record<string, unknown>).statement;
      return !!statement && isSelectStatement(statement as Record<string, unknown>);
    }) && !!node.in && isSelectStatement(node.in as Record<string, unknown>);
  }
  return false;
}

const UNSAFE_READ_FUNCTION = /^(?:pg_(?:read|write|ls|stat)_file|pg_(?:terminate|cancel)_backend|pg_reload_conf|pg_rotate_logfile|pg_advisory_lock|pg_try_advisory_lock|lo_(?:import|export)|dblink|dblink_connect|set_config|setval|nextval)$/i;

function containsUnsafeSelectFeature(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsUnsafeSelectFeature);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.type === "call" && record.function && typeof record.function === "object") {
    const name = (record.function as Record<string, unknown>).name;
    if (typeof name === "string" && UNSAFE_READ_FUNCTION.test(name)) return true;
  }
  return Object.values(record).some(containsUnsafeSelectFeature);
}

export function classifySqlRisk(statement: string, environment: Environment): Risk {
  if (CRITICAL_SQL.test(statement)) return "critical";
  if (HIGH_SQL.test(statement)) return environment === "production" ? "critical" : "high";
  if (MUTATING_SQL.test(statement)) return environment === "production" ? "high" : "medium";
  return "low";
}

export function requiresApproval(statement: string, environment: Environment): boolean {
  return environment === "production" || classifySqlRisk(statement, environment) !== "low";
}

const SECRET_KEYS = /(secret|password|token|cookie|session|private.?key|authorization|api.?key)/i;

export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SECRET_KEYS.test(key) ? "[REDACTED]" : redactSensitive(entry),
      ]),
    );
  }
  return typeof value === "string" ? redactSensitiveText(value) : value;
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(/(\b(?:password|secret|access[_-]?token|refresh[_-]?token|api[_-]?key|authorization)\b\s*(?:=|:|to)?\s*)(?:'(?:''|[^'])*'|"(?:""|[^"])*"|[^\s,;)]+)/gi, "$1[REDACTED]");
}

export function assertTenant(resourceOrganizationId: string, callerOrganizationId: string): void {
  if (!callerOrganizationId || resourceOrganizationId !== callerOrganizationId) {
    throw new Error("RESOURCE_NOT_FOUND");
  }
}
