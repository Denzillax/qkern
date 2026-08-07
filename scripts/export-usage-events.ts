/**
 * Schreibt die Usage-Ereignisse eines Monats als NDJSON nach stdout.
 *
 * `usage_events` ist die einzige Tabelle, die absichtlich wächst — der Trigger
 * weist DELETE ab, weil sie zugleich der Beleg hinter jedem Zähler und der
 * Idempotenz-Speicher ist. Ein Export war seit Alpha 1 als fehlend verzeichnet.
 *
 * **Dieses Skript ist der Aufrufweg**, nicht nur ein Beispiel. Ein Export ohne
 * Aufrufer wäre genau das Muster, das dieser Sprint sechsmal gefunden hat:
 * gebaut, zertifiziert und trotzdem wirkungslos.
 *
 * Aufruf:
 *   npm run usage:export -- --organization <uuid> --project <uuid> \
 *     --environment development --period 2026-08
 *
 * NDJSON, weil ein Archiv zeilenweise wächst und zeilenweise gelesen wird. Ein
 * einzelnes JSON-Array müsste erst vollständig im Speicher stehen.
 */

import { createUsageServiceFromEnv } from "@/lib/server/usage/runtime";
import type { UsagePrincipal, UsageScope } from "@/lib/server/usage/model";

const PAGE = 500;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function required(name: string): string {
  const value = argument(name)?.trim();
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

const scope: UsageScope = {
  organizationId: required("organization"),
  projectId: required("project"),
  environment: required("environment") as UsageScope["environment"],
};

// Der Operator ist eine interne Autorität; es gibt bewusst keine oeffentliche
// Route dafuer. Wer dieses Skript ausfuehrt, hat bereits Zugriff auf die
// Runtime-Datenbank.
const principal: UsagePrincipal = {
  organizationId: scope.organizationId,
  actorRef: `system:usage-export:${required("operator")}`,
  subject: `system:usage-export:${required("operator")}`,
  role: "operator",
};

const usage = createUsageServiceFromEnv();
let cursor: { recordedAt: string; id: string } | null = null;
let written = 0;

do {
  const page = await usage.exportEvents(principal, scope, {
    period: argument("period"), cursor, limit: PAGE,
  });
  for (const event of page.events) {
    process.stdout.write(`${JSON.stringify(event)}\n`);
    written += 1;
  }
  cursor = page.nextCursor;
} while (cursor);

// Auf stderr, damit die Zahl die NDJSON-Ausgabe nicht verunreinigt.
console.error(`usage export: ${written} Ereignisse`);
