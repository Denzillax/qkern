import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConnectionUnavailableError } from "@/lib/server/db/errors";
import { computeRouteError } from "@/lib/server/compute/definitions-http";
import { projectAuthRouteError } from "@/lib/server/project-auth/http";
import { projectQueueRouteError } from "@/lib/server/project-queues/http";
import { projectStorageRouteError } from "@/lib/server/project-storage/http";
import { usageRouteError } from "@/lib/server/usage/http";
import { routeError as generatedDataRouteError } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/tables/[table]/rows/route";
import { routeError as apiKeyRouteError } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/api-keys/route";
import { routeError as automationPolicyRouteError } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/automation-policy/route";
import { dataPlaneRouteError } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/schema/route";

/**
 * Ein erschoepfter Verbindungspool ist ueberall dasselbe: 503.
 *
 * Release 1.64 hat ihn klassifizierbar gemacht und in einer Grenze richtig
 * beantwortet. Die anderen fuenf haben ihn weiter als 500 gemeldet — eine
 * Aussage, die dem Aufrufer sagt, es sei etwas kaputt, obwohl nur gerade keine
 * Verbindung frei war.
 *
 * Die Regel an sechs Stellen zu wiederholen ist die eine Haelfte. Die andere
 * ist, dass die siebte Stelle sie mitbekommt: Der Vertrag **zaehlt die Grenzen
 * selbst** und verlangt, dass jede gefundene hier auch geprueft wird. Eine
 * handgepflegte Liste waere die naechste Stelle, an der etwas vergessen wird —
 * die Lehre aus Release 1.40.
 */

const ROOT = process.cwd();

/** Jede Funktion, die eine Route-Antwort aus einem Fehler macht. */
const HANDLER = /\bfunction\s+([a-zA-Z0-9]*[rR]outeError)\s*\(/g;

function sources(directory: string, out: string[] = []): string[] {
  if (!existsSync(directory)) return out;
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules") continue;
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * `datei:name`, nicht nur `name`.
 *
 * Drei Route-Dateien nennen ihre Grenze schlicht `routeError`. Wer nur nach
 * Namen zaehlt, haelt drei Grenzen fuer eine — und genau diese drei hatte die
 * erste Fassung dieses Vertrags uebersehen.
 */
function declaredHandlers(): string[] {
  const found = new Set<string>();
  for (const directory of ["lib/server", "app"]) {
    for (const file of sources(path.join(ROOT, directory))) {
      const relative = path.relative(ROOT, file).split(path.sep).join("/");
      for (const match of readFileSync(file, "utf8").matchAll(HANDLER)) {
        found.add(`${relative}:${match[1]}`);
      }
    }
  }
  return [...found].sort();
}

/** Die hier geprueften Grenzen, mit dem Namen, unter dem sie deklariert sind. */
const ROUTES = "app/api/v1/projects/[projectId]/environments/[environment]";
const CHECKED: ReadonlyArray<readonly [string, (error: unknown) => Response | Promise<Response>]> = [
  ["lib/server/compute/definitions-http.ts:computeRouteError", computeRouteError],
  ["lib/server/project-auth/http.ts:projectAuthRouteError", projectAuthRouteError],
  ["lib/server/project-queues/http.ts:projectQueueRouteError", projectQueueRouteError],
  ["lib/server/project-storage/http.ts:projectStorageRouteError", projectStorageRouteError],
  ["lib/server/usage/http.ts:usageRouteError", usageRouteError],
  [`${ROUTES}/tables/[table]/rows/route.ts:routeError`, generatedDataRouteError],
  [`${ROUTES}/api-keys/route.ts:routeError`, apiKeyRouteError],
  [`${ROUTES}/automation-policy/route.ts:routeError`, automationPolicyRouteError],
  [`${ROUTES}/schema/route.ts:dataPlaneRouteError`, dataPlaneRouteError],
];

describe("route unavailable contract", () => {
  it("checks every route error boundary the source declares", () => {
    expect(declaredHandlers()).toEqual(CHECKED.map(([name]) => name).sort());
    // Explizites Budget wie beim Zahlen-Vertrag in 1.84: Der Scan liest jede
    // Routenquelle, und unter der I/O-Last eines vollen Suitenlaufs riss die
    // 5-Sekunden-Voreinstellung.
  }, 30_000);

  it.each(CHECKED)("answers 503 from %s when no connection was available", async (_name, handler) => {
    const response = await handler(new ConnectionUnavailableError(new Error("timeout")));
    expect(response.status).toBe(503);
  });

  /**
   * Auch verpackt. Die Dienste hüllen den Fehler in ihre eigene Fehlerklasse,
   * bevor er die Grenze erreicht; eine Prüfung nur auf die nackte Klasse würde
   * genau den Weg verfehlen, den er im Betrieb nimmt.
   */
  it.each(CHECKED)("answers 503 from %s when the failure is wrapped", async (_name, handler) => {
    const wrapped = new Error("service failure", { cause: new ConnectionUnavailableError() });
    const response = await handler(wrapped);
    expect(response.status).toBe(503);
  });
});
