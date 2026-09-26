import {
  SECURITY_CHECK_REASONS,
  SECURITY_RULE_IDS,
  SECURITY_RULES,
  type SecurityCheckReason,
  type SecurityRuleId,
  type SecuritySeverity,
} from "@/lib/console/security-advisor-texts";
import type { Environment } from "@/lib/types";

/**
 * Die Regeln des Sicherheitsberaters (2.39), rein und ohne Ein- und Ausgabe.
 *
 * Eingabe sind Daten, die QKERN ohnehin liest: Tabellen und Policies aus dem
 * Katalog, die Richtlinien der Buckets, Art und Ablauf der API-Keys und seit
 * 2.57 je Anmeldeanbieter ein Slug und ein Ja/Nein zu `email_verified`. Jede
 * Quelle kann fehlen; dann steht in `checks`, welche Regel deshalb nicht lief
 * und warum. Nichts hier schreibt, nichts repariert. Gleiche Eingabe gibt
 * gleiche Ausgabe, auch in derselben Reihenfolge.
 */

export type SecurityFinding = {
  id: string;
  rule: SecurityRuleId;
  severity: SecuritySeverity;
  object: { kind: "table" | "policy" | "bucket" | "api_key" | "auth_provider"; name: string };
  summary: string;
  remedy: string;
};

export type SecurityCheck = { rule: SecurityRuleId; ran: boolean; reason?: string };

export type SecurityAdvisorTable = {
  name: string;
  kind: "table" | "partitioned_table" | "view" | "materialized_view";
  rowSecurityEnabled: boolean;
};

export type SecurityAdvisorPolicy = {
  name: string;
  table: string;
  permissive: boolean;
  command: "select" | "insert" | "update" | "delete" | "all";
  roles: string[];
  usingExpression: string | null;
  checkExpression: string | null;
};

export type SecurityAdvisorBucket = {
  name: string;
  readPolicy: string;
  writePolicy: string;
  allowedMimeTypes: string[];
};

export type SecurityAdvisorApiKey = {
  id: string;
  name: string;
  kind: "public" | "service";
  expiresAt: string;
  revokedAt: string | null;
};

/**
 * Ein Anmeldeanbieter, so weit die Regel ihn braucht (2.57).
 *
 * Genau zwei Felder, und das zweite ist ein `boolean`. Issuer, Client-ID,
 * Endpunkte und der Name der Secret-Umgebungsvariablen stehen hier
 * ausdruecklich nicht: Der Slug benennt den Anbieter im Befund, das Ja/Nein
 * entscheidet die Regel. In ein `boolean` passt kein Geheimnis.
 */
export type SecurityAdvisorAuthProvider = {
  id: string;
  requiresVerifiedEmail: boolean;
};

type Unavailable = { unavailable: SecurityCheckReason };

export type SecurityAdvisorInput = {
  environment: Environment;
  now: Date;
  database: Unavailable | {
    schema: string;
    tables: SecurityAdvisorTable[];
    tablesTruncated: boolean;
    policies: SecurityAdvisorPolicy[];
    policiesTruncated: boolean;
  };
  storage: Unavailable | { buckets: SecurityAdvisorBucket[] };
  apiKeys: Unavailable | { keys: SecurityAdvisorApiKey[] };
  authProviders: Unavailable | { providers: SecurityAdvisorAuthProvider[] };
};

export type SecurityAdvisorResult = { findings: SecurityFinding[]; checks: SecurityCheck[] };

/** Rollen, hinter denen jede Anfrage der Data API stehen kann. `public` heisst: alle Rollen. */
export const BROAD_POLICY_ROLES: ReadonlySet<string> = new Set(["public", "anon", "authenticated"]);

const SEVERITY_ORDER: Record<SecuritySeverity, number> = { high: 0, medium: 1, low: 2 };

/** Schemas, die QKERN oder PostgreSQL selbst gehoeren; dort meldet der Berater nichts. */
export function isInternalSchema(schema: string): boolean {
  return schema.startsWith("pg_") || schema === "information_schema" ||
    schema === "qkern_internal" || schema.startsWith("qkern_");
}

/**
 * `true`, `(true)`, ` ( ( TRUE ) ) ` sind dieselbe Bedingung. `pg_get_expr`
 * liefert heute `true`; die Klammern stehen hier, damit eine andere
 * Schreibweise desselben Katalogs nicht durchrutscht.
 */
export function isTriviallyTrue(expression: string | null): boolean {
  if (expression === null) return false;
  let value = expression.trim();
  for (;;) {
    if (!value.startsWith("(") || !value.endsWith(")") || !outerParenthesesWrapAll(value)) break;
    value = value.slice(1, -1).trim();
  }
  return value.toLowerCase() === "true";
}

/** Umschliessen die erste und die letzte Klammer den ganzen Ausdruck? `(a) OR (b)` nein. */
function outerParenthesesWrapAll(value: string): boolean {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")") {
      depth -= 1;
      if (depth === 0 && index < value.length - 1) return false;
    }
  }
  return depth === 0;
}

function finding(rule: SecurityRuleId, kind: SecurityFinding["object"]["kind"], name: string, key = name): SecurityFinding {
  const text = SECURITY_RULES[rule];
  return { id: `${rule}:${kind}:${key}`, rule, severity: text.severity, object: { kind, name }, summary: text.summary, remedy: text.remedy };
}

function check(rule: SecurityRuleId, ran: boolean, reason?: SecurityCheckReason): SecurityCheck {
  return reason ? { rule, ran, reason: SECURITY_CHECK_REASONS[reason] } : { rule, ran };
}

export function evaluateSecurityRules(input: SecurityAdvisorInput): SecurityAdvisorResult {
  const findings: SecurityFinding[] = [];
  const checks = new Map<SecurityRuleId, SecurityCheck>();

  // Datenbank: Tabellen und Policies
  const databaseRules: SecurityRuleId[] = ["rls_disabled", "rls_no_policies", "policy_always_true", "policy_check_missing"];
  if ("unavailable" in input.database) {
    for (const rule of databaseRules) checks.set(rule, check(rule, false, input.database.unavailable));
  } else {
    const database = input.database;
    const internal = isInternalSchema(database.schema);
    const ordinary = internal ? [] : database.tables.filter((table) => table.kind === "table" || table.kind === "partitioned_table");
    const policies = internal ? [] : database.policies;
    const tableNote: SecurityCheckReason | undefined = database.tablesTruncated ? "tablesTruncated" : undefined;
    const policyNote: SecurityCheckReason | undefined = database.policiesTruncated ? "policiesTruncated" : undefined;

    for (const table of ordinary) {
      if (!table.rowSecurityEnabled) findings.push(finding("rls_disabled", "table", table.name));
    }
    checks.set("rls_disabled", check("rls_disabled", true, tableNote));

    // Ohne vollstaendige Policy-Liste koennte die fehlende Policy nur abgeschnitten sein.
    if (database.policiesTruncated) {
      checks.set("rls_no_policies", check("rls_no_policies", false, "policiesIncomplete"));
    } else {
      const withPolicy = new Set(policies.map((policy) => policy.table));
      for (const table of ordinary) {
        if (table.rowSecurityEnabled && !withPolicy.has(table.name)) findings.push(finding("rls_no_policies", "table", table.name));
      }
      checks.set("rls_no_policies", check("rls_no_policies", true, tableNote));
    }

    for (const policy of policies) {
      if (!policy.permissive) continue;
      const name = `${policy.table}.${policy.name}`;
      if (policy.roles.some((role) => BROAD_POLICY_ROLES.has(role)) &&
          (isTriviallyTrue(policy.usingExpression) || isTriviallyTrue(policy.checkExpression))) {
        findings.push(finding("policy_always_true", "policy", name));
      }
      // PostgreSQL nimmt bei UPDATE und ALL ohne WITH CHECK die USING-Bedingung
      // auch fuer neue Zeilen. Offen ist eine Policy erst, wenn beides fehlt,
      // oder bei INSERT, wo es kein USING gibt.
      if ((policy.command === "insert" || policy.command === "update" || policy.command === "all") &&
          policy.checkExpression === null && (policy.command === "insert" || policy.usingExpression === null)) {
        findings.push(finding("policy_check_missing", "policy", name));
      }
    }
    checks.set("policy_always_true", check("policy_always_true", true, policyNote));
    checks.set("policy_check_missing", check("policy_check_missing", true, policyNote));
  }

  // Storage: Richtlinien der Buckets
  if ("unavailable" in input.storage) {
    checks.set("bucket_public_read", check("bucket_public_read", false, input.storage.unavailable));
    checks.set("bucket_authenticated_write_any_type", check("bucket_authenticated_write_any_type", false, input.storage.unavailable));
  } else {
    for (const bucket of input.storage.buckets) {
      if (bucket.readPolicy === "public") findings.push(finding("bucket_public_read", "bucket", bucket.name));
      if (bucket.writePolicy === "authenticated" && bucket.allowedMimeTypes.length === 0) {
        findings.push(finding("bucket_authenticated_write_any_type", "bucket", bucket.name));
      }
    }
    checks.set("bucket_public_read", check("bucket_public_read", true));
    checks.set("bucket_authenticated_write_any_type", check("bucket_authenticated_write_any_type", true));
  }

  // API-Keys: nur Art, Ablauf und Widerruf
  if ("unavailable" in input.apiKeys) {
    checks.set("api_key_broad", check("api_key_broad", false, input.apiKeys.unavailable));
  } else if (input.environment !== "production") {
    checks.set("api_key_broad", check("api_key_broad", true, "productionOnly"));
  } else {
    const now = input.now.getTime();
    for (const key of input.apiKeys.keys) {
      if (key.kind === "service" && key.revokedAt === null && Date.parse(key.expiresAt) > now) {
        findings.push(finding("api_key_broad", "api_key", key.name, key.id));
      }
    }
    checks.set("api_key_broad", check("api_key_broad", true));
  }

  // Anmeldeanbieter: nur der Slug und das abgeleitete Ja/Nein aus 2.57.
  //
  // Bis 2.56 stand hier eine Regel, die nie lief, weil die Projektion nur
  // Slug und Issuer nannte. Statt einen dauerhaften "nicht geprueft"-Eintrag
  // stehen zu lassen, traegt die Projektion jetzt genau das eine `boolean`,
  // das die Regel braucht.
  if ("unavailable" in input.authProviders) {
    checks.set("auth_provider_unverified_email",
      check("auth_provider_unverified_email", false, input.authProviders.unavailable));
  } else {
    for (const provider of input.authProviders.providers) {
      if (!provider.requiresVerifiedEmail) {
        findings.push(finding("auth_provider_unverified_email", "auth_provider", provider.id));
      }
    }
    checks.set("auth_provider_unverified_email", check("auth_provider_unverified_email", true));
  }

  findings.sort((a, b) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    compare(a.object.name, b.object.name) ||
    compare(a.object.kind, b.object.kind) ||
    SECURITY_RULE_IDS.indexOf(a.rule) - SECURITY_RULE_IDS.indexOf(b.rule) ||
    compare(a.id, b.id));
  return { findings, checks: SECURITY_RULE_IDS.map((rule) => checks.get(rule)!) };
}

/** Codepunkt-Vergleich statt `localeCompare`: unabhaengig von der Locale des Servers. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
