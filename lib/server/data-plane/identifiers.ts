/**
 * Namen von Tabellen, Spalten, Funktionen und Argumenten der Data API (2.26),
 * seit 2.33 auch Schemanamen.
 *
 * Bis 2.25 galt die Grammatik `[a-z_][a-z0-9_]*`: nur Kleinbuchstaben. Damit
 * fehlten im Table Editor und in der generierten REST-API alle Tabellen, die
 * Prisma, TypeORM oder Drizzle mit Anfuehrungszeichen anlegen: `"Order"`,
 * `"UserProfile"`, Spalten wie `"createdAt"`. Jetzt sind Gross- und
 * Kleinbuchstaben erlaubt, sonst nichts Neues: kein Leerzeichen, kein
 * Anfuehrungszeichen, kein Punkt, hoechstens 63 Zeichen wie PostgreSQL.
 *
 * Die Grenze bleibt eine Sicherheitsgrenze: jeder Name landet in SQL nur
 * ueber `"..."` oder als Parameter, und ein Name, der diese Grammatik
 * erfuellt, kann das Anfuehrungszeichen nicht verlassen. Seit 2.33 gilt
 * dieselbe Grammatik fuer Schemanamen (`"Shop"`); `public` ist die Vorgabe.
 * Systemschemas (`pg_*`, `information_schema`, `qkern_internal`) bleiben
 * abgelehnt, siehe `isDataSchemaName`. Der Vergleich ist wie in PostgreSQL
 * exakt: `Shop` und `shop` sind zwei Schemas.
 */
export const DATA_IDENTIFIER_PATTERN = "[A-Za-z_][A-Za-z0-9_]{0,62}";
export const DATA_IDENTIFIER = new RegExp(`^${DATA_IDENTIFIER_PATTERN}$`);

export function isDataIdentifier(value: unknown): value is string {
  return typeof value === "string" && DATA_IDENTIFIER.test(value);
}

/**
 * Ein Schema, das die Data API lesen darf: Grammatik wie oben, ohne die
 * Systemschemas. PostgreSQL reserviert `pg_` mit exaktem Vergleich; ein
 * Nutzerschema `"Pg_x"` ist also kein Systemschema.
 */
export function isDataSchemaName(value: unknown): value is string {
  return isDataIdentifier(value) && !value.startsWith("pg_") &&
    value !== "information_schema" && value !== "qkern_internal";
}
