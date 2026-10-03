import type { Environment, Risk } from "@/lib/types";
import { classifySqlRisk, isReadOnlySql, requiresApproval } from "@/lib/security";

/**
 * Was der SQL-Editor ueber eine Abfrage weiss, bevor und nachdem sie lief
 * (2.143), rein und ohne React.
 *
 * **Warum das ein eigenes Modul ist.** Der Editor bekommt eine Dreiteilung
 * aus Editor, Ergebnis und Verlauf. Zwei Urteile haengen daran, und beide
 * duerfen nicht in einer Ansicht stehen, wo sie niemand einzeln pruefen kann:
 * ob eine Abfrage gefaehrlich ist, und was ein fehlgeschlagener Lauf
 * bedeutet.
 *
 * **Die Gefahr kommt nicht von hier.** Der Editor zeigte bis 2.142 schon ein
 * Risiko an, und zwar aus `classifySqlRisk` in `lib/security.ts`. Genau
 * dieselbe Funktion entscheidet in `requiresApproval`, ob eine Anweisung ohne
 * Freigabe laufen darf, und damit auch, was die Freigabezentrale als Risiko
 * eines Change Sets fuehrt. Dieses Modul baut darum keine zweite Liste von
 * Schluesselwoertern. Es ruft die vorhandene Erkennung und sagt nur, was ihr
 * Urteil fuer den Betreiber heisst: `high` und `critical` sind die beiden
 * Stufen, in denen `DROP`, `TRUNCATE`, `ALTER TABLE`, ein `DELETE` ohne
 * `WHERE` und ein `UPDATE` ohne `WHERE` landen, und genau die werden im
 * Editor vor dem Ausfuehren gekennzeichnet. Eine eigene Liste waere eine
 * zweite Wahrheit, die irgendwann von der ersten abweicht.
 *
 * **Die Fehlermeldung ist nicht die von PostgreSQL.** Das ist der
 * unbequeme Befund dieses Slices, und er steht hier, damit die Ansicht ihn
 * nicht uebertoent. `ProjectDataPlaneError` ist in
 * `lib/server/data-plane/service.ts` ausdruecklich ohne `cause` gebaut
 * ("connection, role, SQL and catalog details never leave the boundary"), und
 * `run()` faengt jeden Datenbankfehler ab und wirft `DATA_PLANE_UNAVAILABLE`.
 * Ein `relation "kunden" does not exist`, ein Syntaxfehler, eine abgelaufene
 * `statement_timeout`: alle drei kommen in der Console als derselbe Code an.
 * Die Query-Route gibt also eine Handvoll QKERN-Codes heraus und nie einen
 * SQLSTATE und nie den Text von PostgreSQL. Dieses Modul erfindet darum
 * keinen Fehlercode und keine Erklaerung zu einem, den es nicht gibt: Es
 * ordnet die tatsaechlich moeglichen Antworten der Route einem Code zu, und
 * die Ansicht haengt an jeden Code einen Satz, der aus dem Routencode
 * abgeleitet ist.
 */

/** Das Urteil ueber eine Abfrage, bevor jemand den Knopf drueckt. */
export type SqlRunReading = {
  /** Die Stufe aus `classifySqlRisk`, unveraendert. */
  level: Risk;
  /** Laeuft die Abfrage lesend, also direkt gegen die Datenbank? */
  readOnly: boolean;
  /**
   * Muss diese Abfrage vor dem Ausfuehren gekennzeichnet sein? Wahr ab
   * `high`, denn dort liegen die zerstoerenden Formen.
   */
  dangerous: boolean;
  /** Braucht sie eine Freigabe, statt direkt zu laufen? */
  approvalRequired: boolean;
};

/**
 * Das Urteil zu einem Statement.
 *
 * Die Zeilenumbrueche fallen weg, bevor `isReadOnlySql` und `classifySqlRisk`
 * das Statement sehen: Beide Pruefungen arbeiten mit Mustern ueber eine Zeile,
 * und ein `DELETE FROM kunden\nWHERE id = 1` waere sonst ein anderes Urteil
 * als dasselbe Statement in einer Zeile.
 */
export function readSqlRun(statement: string, environment: Environment): SqlRunReading {
  const flat = statement.replace(/\s+/g, " ").trim();
  const level = classifySqlRisk(flat, environment);
  return {
    level,
    readOnly: isReadOnlySql(flat),
    dangerous: level === "high" || level === "critical",
    approvalRequired: requiresApproval(flat, environment),
  };
}

/**
 * Die Codes, mit denen ein Lauf scheitern kann.
 *
 * Jeder einzelne steht so in `app/api/v1/projects/[projectId]/environments/
 * [environment]/query/route.ts` oder in `app/api/v1/changesets/route.ts`.
 * `UNKNOWN` ist kein Platzhalter fuer einen erratenen Fall, sondern das
 * Eingestaendnis, dass die Route eine Antwort gab, die hier nicht vorgesehen
 * ist; die Ansicht sagt dann genau das.
 */
export type SqlRunFailureCode =
  | "READ_ONLY_QUERY_REQUIRED"
  | "DATA_PLANE_INVALID_INPUT"
  | "DATA_PLANE_NOT_READY"
  | "DATA_PLANE_DISABLED"
  | "DATA_PLANE_BOUNDARY_REJECTED"
  | "DATA_PLANE_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "AUTHENTICATION_REQUIRED"
  | "NOT_FOUND"
  | "CHANGE_SET_REJECTED"
  | "UNKNOWN";

/** Die Codes, die der Data-Plane-Dienst selbst fuehrt. */
const DATA_PLANE: ReadonlySet<string> = new Set([
  "READ_ONLY_QUERY_REQUIRED", "DATA_PLANE_INVALID_INPUT", "DATA_PLANE_NOT_READY",
  "DATA_PLANE_DISABLED", "DATA_PLANE_BOUNDARY_REJECTED", "DATA_PLANE_UNAVAILABLE",
]);

/**
 * Der Code einer gescheiterten Antwort, aus Status und Rumpf.
 *
 * Der Code aus dem Rumpf gilt, wenn es einer der bekannten ist; sonst
 * entscheidet der Status. Ein unbekannter Code wird nicht durchgereicht,
 * denn die Ansicht haette keinen Satz dazu und wuerde einen erfinden.
 */
export function sqlRunFailureCode(status: number, code: unknown): SqlRunFailureCode {
  if (typeof code === "string" && DATA_PLANE.has(code)) return code as SqlRunFailureCode;
  if (status === 401) return "AUTHENTICATION_REQUIRED";
  if (status === 404) return "NOT_FOUND";
  if (status === 400) return "INVALID_REQUEST";
  return "UNKNOWN";
}

/**
 * Dasselbe fuer den schreibenden Weg, der kein Change Set anlegen konnte.
 *
 * Diese Route gibt keinen Data-Plane-Code heraus, sondern 400 bei ungueltigem
 * SQL, 409 bei einer nicht bereitgestellten Umgebung und 500 sonst. Die
 * Unterscheidung bleibt grob, weil die Route selbst nicht feiner antwortet.
 */
export function changeSetFailureCode(status: number): SqlRunFailureCode {
  if (status === 401) return "AUTHENTICATION_REQUIRED";
  if (status === 404) return "NOT_FOUND";
  if (status === 400) return "CHANGE_SET_REJECTED";
  if (status === 409) return "DATA_PLANE_NOT_READY";
  return "UNKNOWN";
}
