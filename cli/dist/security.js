import { parse } from "pgsql-ast-parser";
const MUTATING_SQL = /\b(insert|update|delete|alter|drop|truncate|create|grant|revoke|comment|vacuum|copy)\b/i;
const CRITICAL_SQL = /\b(drop\s+(database|table)|truncate|alter\s+table\s+\S+\s+drop|delete\s+from\s+\S+\s*;?$)\b/i;
const HIGH_SQL = /\b(update\s+\S+\s+set\b(?![\s\S]*\bwhere\b)|delete\s+from\b(?![\s\S]*\bwhere\b)|alter\s+table)\b/i;
export function validateSingleSqlStatement(statement) {
    const normalized = statement.trim();
    if (!normalized)
        return { valid: false, reason: "SQL statement is empty" };
    if (normalized.length > 10_000)
        return { valid: false, reason: "SQL statement exceeds the 10,000 character limit" };
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
        if (parse(normalized).length !== 1)
            return { valid: false, reason: "Exactly one SQL statement is required per Change Set" };
        return { valid: true };
    }
    catch {
        return { valid: false, reason: "SQL statement could not be parsed" };
    }
}
export function classifySqlRisk(statement, environment) {
    if (CRITICAL_SQL.test(statement))
        return "critical";
    if (HIGH_SQL.test(statement))
        return environment === "production" ? "critical" : "high";
    if (MUTATING_SQL.test(statement))
        return environment === "production" ? "high" : "medium";
    return "low";
}
//# sourceMappingURL=security.js.map