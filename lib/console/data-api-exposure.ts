/**
 * Reine Hilfen fuer die Data-API-Einstellungen der Console.
 *
 * Welche Tabellen die Data API freigibt, entscheidet der Server beim Erzeugen
 * des OpenAPI-Dokuments (RLS an, Primaerschluessel, lesbar, eine nicht
 * sensible Spalte; Views nur mit security_invoker). Die Console rechnet das
 * nicht nach, sondern liest die Pfade `.../tables/{name}/rows` aus dem
 * Dokument. So kann die Anzeige nie etwas freigeben, was der Server nicht
 * freigibt.
 */

const ROWS_PATH = /\/tables\/([^/]+)\/rows$/;

export function exposedTablesFromOpenApi(paths: Record<string, unknown>): string[] {
  const names = new Set<string>();
  for (const key of Object.keys(paths)) {
    const match = ROWS_PATH.exec(key);
    if (match) names.add(decodeURIComponent(match[1]));
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Status der Data API aus der Antwort der OpenAPI-Route.
 *
 * Die Route kennt fuer eine noch nicht gebundene Umgebung keinen eigenen
 * Code: Sie wirft dann `GENERATED_DATA_API_NOT_READY` (409), denselben Code
 * wie fuer jeden anderen fehlenden Schritt. Ein Zustand "not-bound" liesse
 * sich deshalb nicht ehrlich unterscheiden und fehlt hier.
 *
 * 503 heisst nur dann "abgeschaltet", wenn der Code das sagt (oder keiner
 * mitkommt). `GENERATED_DATA_API_UNAVAILABLE` ist ebenfalls 503, bedeutet
 * aber eine nicht erreichbare Datenbank und ist deshalb ein Fehler.
 */
export type DataApiReadiness = "ready" | "not-ready" | "disabled" | "error";

export function dataApiReadiness(status: number, code?: string): DataApiReadiness {
  if (status === 200) return "ready";
  if (status === 409) return "not-ready";
  if (status === 503 && (code === undefined || code === "GENERATED_DATA_API_DISABLED")) return "disabled";
  return "error";
}
