import {
  AUTH_ACCESS_COMMANDS,
  type AuthAccessAllowance,
  type AuthAccessCommand,
  type AuthAccessCondition,
  type AuthAccessVerdict,
} from "@/lib/console/auth-policies-texts";
import type { ProjectPolicy, ProjectSchemaTable } from "@/lib/server/data-plane/service";

/**
 * Was ein angemeldeter Nutzer wirklich lesen und schreiben darf (2.62), rein
 * und ohne Ein- und Ausgabe.
 *
 * Eingabe sind zwei Katalogauskuenfte, die es schon gibt: die Tabellen eines
 * Schemas mit ihrem Row-Security-Schalter (`inspectSchema`) und die Policies
 * desselben Schemas (`inspectPolicies`), dazu der Name der Datenbankrolle, mit
 * der jede Anfrage der Data API laeuft (`inspectSettings.currentRole`).
 * Ausgabe ist je Tabelle ein Urteil in Worten, je Befehl eine Antwort und je
 * Policy die Angabe, ob sie fuer diese Rolle ueberhaupt gilt.
 *
 * Der wichtigste Unterschied zur Policy-Liste unter Datenbank -> Policies:
 * Dort steht, welche Regeln es gibt. Hier steht, was am Ende gilt. Dazu
 * gehoert die Abbildung, die eine Liste nicht kennt -- eine angemeldete
 * Anfrage wird keine eigene Datenbankrolle, sie laeuft ueber die
 * Anwendungsrolle dieser Umgebung, und ihre Anmeldung steht nur in den Claims
 * und in `request.jwt.*`.
 *
 * Was dieses Modul nicht kann, sagt es und raet nicht: Eine Bedingung, die
 * `current_setting`, `current_user` oder irgendeine Funktion liest, kann bei
 * einer Anfrage zutreffen und bei der naechsten nicht. Sie wird `request`
 * genannt, der Befehl heisst dann `sometimes`, und die Ansicht zeigt das in
 * der Zeile, um die es geht.
 */

/** Eine Policy, so weit die Regel sie braucht. Nichts hier kommt aus einer Zeile der Tabelle. */
export type AuthAccessPolicyInput = Pick<
  ProjectPolicy,
  "name" | "table" | "permissive" | "command" | "roles" | "usingExpression" | "checkExpression"
>;

/** Eine Relation, so weit die Regel sie braucht. */
export type AuthAccessTableInput = Pick<ProjectSchemaTable, "name" | "kind" | "rowSecurityEnabled">;

export type AuthAccessInput = {
  schema: string;
  /** Die Datenbankrolle, ueber die jede Anfrage der Data API laeuft */
  role: string;
  tables: readonly AuthAccessTableInput[];
  policies: readonly AuthAccessPolicyInput[];
};

export type AuthAccessCommandReport = {
  command: AuthAccessCommand;
  allowed: AuthAccessAllowance;
  condition: AuthAccessCondition;
  /** Namen der permissiven Policies, die fuer diese Rolle und diesen Befehl gelten */
  policies: string[];
  /** Namen der restriktiven Policies, die denselben Befehl einengen */
  restrictedBy: string[];
};

export type AuthAccessPolicyReport = {
  name: string;
  command: ProjectPolicy["command"];
  permissive: boolean;
  roles: string[];
  /** Ob die Policy fuer eine angemeldete Anfrage ueberhaupt zaehlt */
  applies: boolean;
  usingExpression: string | null;
  checkExpression: string | null;
  /** Ueber beide Ausdruecke zusammen; `none` heisst: erfasst jede Zeile */
  condition: AuthAccessCondition;
};

export type AuthAccessTableReport = {
  table: string;
  rowSecurityEnabled: boolean;
  verdict: AuthAccessVerdict;
  /** True, sobald ein Befehl von einer Bedingung auf die Anfrage abhaengt */
  uncertain: boolean;
  commands: AuthAccessCommandReport[];
  policies: AuthAccessPolicyReport[];
  /** Wie viele Policies dieser Tabelle nur andere Rollen nennen */
  foreignRolePolicies: number;
};

export type AuthAccessResult = {
  schema: string;
  role: string;
  /** Der `role`-Claim eines angemeldeten Nutzers; er ist kein Rollenname in PostgreSQL */
  claimRole: "authenticated";
  tables: AuthAccessTableReport[];
  counts: Record<AuthAccessVerdict, number>;
  /** Views und materialisierte Views des Schemas; sie tragen keine eigene Policy */
  views: number;
};

/**
 * Woran eine Bedingung erkennbar von der Anfrage abhaengt: eine Einstellung,
 * die Rolle der Sitzung oder ein Funktionsaufruf. Der letzte Zweig faengt
 * jeden Aufruf, auch `auth.uid()` oder ein eigenes `hat_zugriff(...)`; ein
 * Klammerausdruck ohne Namen davor faellt nicht darunter, weil `pg_get_expr`
 * Vergleiche als `(a = b)` schreibt.
 */
const REQUEST_DEPENDENT = /current_setting|current_user|current_role|session_user|request\.jwt|[A-Za-z_][A-Za-z0-9_.]*\s*\(/i;

const CONDITION_RANK: Record<AuthAccessCondition, number> = { none: 0, constant: 1, request: 2 };
const BY_RANK: AuthAccessCondition[] = ["none", "constant", "request"];

/**
 * Wie eine einzelne Bedingung einzuordnen ist. `null` heisst: es gibt keine,
 * also erfasst sie alles. Ein woertliches `true` ist dasselbe, auch in den
 * Klammern, die `pg_get_expr` gern setzt.
 */
export function classifyAuthAccessCondition(expression: string | null): AuthAccessCondition {
  if (expression === null) return "none";
  let text = expression.trim();
  while (text.startsWith("(") && text.endsWith(")")) text = text.slice(1, -1).trim();
  if (/^true$/i.test(text)) return "none";
  if (REQUEST_DEPENDENT.test(expression)) return "request";
  return "constant";
}

function worst(conditions: readonly AuthAccessCondition[]): AuthAccessCondition {
  return BY_RANK[conditions.reduce((rank, entry) => Math.max(rank, CONDITION_RANK[entry]), 0)];
}

function best(conditions: readonly AuthAccessCondition[]): AuthAccessCondition {
  return BY_RANK[conditions.reduce((rank, entry) => Math.min(rank, CONDITION_RANK[entry]), CONDITION_RANK.request)];
}

/** Ob eine Policy diesen Befehl ueberhaupt betrifft. `all` betrifft alle vier. */
function covers(policy: AuthAccessPolicyInput, command: AuthAccessCommand): boolean {
  return policy.command === "all" || policy.command === command;
}

/**
 * Welche Ausdruecke PostgreSQL fuer diesen Befehl prueft.
 *
 * SELECT und DELETE pruefen USING gegen die vorhandene Zeile. INSERT pruefte
 * WITH CHECK gegen die neue; fehlt WITH CHECK, nimmt PostgreSQL dafuer USING.
 * UPDATE prueft beides: USING gegen die alte Zeile, WITH CHECK gegen die neue.
 */
function relevantConditions(policy: AuthAccessPolicyInput, command: AuthAccessCommand): AuthAccessCondition[] {
  const using = classifyAuthAccessCondition(policy.usingExpression);
  const check = policy.checkExpression === null ? using : classifyAuthAccessCondition(policy.checkExpression);
  if (command === "select" || command === "delete") return [using];
  if (command === "insert") return [check];
  return [using, check];
}

function appliesToRole(policy: AuthAccessPolicyInput, role: string): boolean {
  return policy.roles.includes("public") || policy.roles.includes(role);
}

function commandReport(
  command: AuthAccessCommand,
  applicable: readonly AuthAccessPolicyInput[],
): AuthAccessCommandReport {
  const covering = applicable.filter((policy) => covers(policy, command));
  const permissive = covering.filter((policy) => policy.permissive);
  const restrictive = covering.filter((policy) => !policy.permissive);
  if (permissive.length === 0) {
    return { command, allowed: "no", condition: "none", policies: [], restrictedBy: restrictive.map((policy) => policy.name) };
  }
  // Die permissiven werden verodert, darum zaehlt die schwaechste Bedingung.
  // Die restriktiven werden dazu verundet, darum zaehlt die strengste.
  const permissiveCondition = best(permissive.map((policy) => worst(relevantConditions(policy, command))));
  const restrictiveCondition = worst(restrictive.map((policy) => worst(relevantConditions(policy, command))));
  const condition = worst([permissiveCondition, restrictiveCondition]);
  return {
    command,
    allowed: condition === "none" ? "always" : "sometimes",
    condition,
    policies: permissive.map((policy) => policy.name),
    restrictedBy: restrictive.map((policy) => policy.name),
  };
}

/**
 * Ob die Tabelle jedem offensteht: eine permissive Policy fuer PUBLIC, die das
 * Lesen ohne Bedingung erlaubt, und keine restriktive, die sie einengt. Dann
 * sieht auch ein Public Key die Zeilen, und das ist eine andere Aussage als
 * "lesbar".
 */
function openToEveryone(applicable: readonly AuthAccessPolicyInput[], select: AuthAccessCommandReport): boolean {
  if (select.allowed !== "always") return false;
  return applicable.some((policy) =>
    policy.permissive && policy.roles.includes("public") && covers(policy, "select") &&
    worst(relevantConditions(policy, "select")) === "none");
}

function verdictOf(
  table: AuthAccessTableInput,
  applicable: readonly AuthAccessPolicyInput[],
  commands: readonly AuthAccessCommandReport[],
): AuthAccessVerdict {
  if (!table.rowSecurityEnabled) return "refused";
  const select = commands.find((entry) => entry.command === "select")!;
  const writes = commands.filter((entry) => entry.command !== "select");
  if (commands.every((entry) => entry.allowed === "no")) return "locked";
  if (openToEveryone(applicable, select)) return "open";
  if (writes.some((entry) => entry.allowed !== "no")) return "writable";
  if (select.allowed !== "no") return "readable";
  return "locked";
}

/**
 * Das Urteil je Tabelle, in der Reihenfolge, in der die Tabellen kommen. Die
 * Befehle kommen immer in der Reihenfolge von `AUTH_ACCESS_COMMANDS`, und die
 * Policies einer Tabelle in der Reihenfolge der Eingabe: gleiche Eingabe,
 * gleiche Ausgabe.
 */
export function evaluateAuthAccess(input: AuthAccessInput): AuthAccessResult {
  const counts: Record<AuthAccessVerdict, number> = { refused: 0, locked: 0, readable: 0, writable: 0, open: 0 };
  const tables: AuthAccessTableReport[] = [];
  let views = 0;
  for (const table of input.tables) {
    if (table.kind !== "table" && table.kind !== "partitioned_table") { views += 1; continue; }
    const own = input.policies.filter((policy) => policy.table === table.name);
    const applicable = own.filter((policy) => appliesToRole(policy, input.role));
    const commands = AUTH_ACCESS_COMMANDS.map((command) => commandReport(command, applicable));
    const verdict = verdictOf(table, applicable, commands);
    counts[verdict] += 1;
    tables.push({
      table: table.name,
      rowSecurityEnabled: table.rowSecurityEnabled,
      verdict,
      uncertain: commands.some((entry) => entry.condition === "request"),
      commands,
      policies: own.map((policy) => ({
        name: policy.name,
        command: policy.command,
        permissive: policy.permissive,
        roles: policy.roles,
        applies: appliesToRole(policy, input.role),
        usingExpression: policy.usingExpression,
        checkExpression: policy.checkExpression,
        condition: worst([
          classifyAuthAccessCondition(policy.usingExpression),
          policy.checkExpression === null ? "none" : classifyAuthAccessCondition(policy.checkExpression),
        ]),
      })),
      foreignRolePolicies: own.length - applicable.length,
    });
  }
  return { schema: input.schema, role: input.role, claimRole: "authenticated", tables, counts, views };
}
