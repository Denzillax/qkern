/**
 * Namen von Tabellen, Spalten, Funktionen und Argumenten der Data API (2.26).
 *
 * Bis 2.25 galt die Grammatik `[a-z_][a-z0-9_]*`: nur Kleinbuchstaben. Damit
 * fehlten im Table Editor und in der generierten REST-API alle Tabellen, die
 * Prisma, TypeORM oder Drizzle mit Anfuehrungszeichen anlegen: `"Order"`,
 * `"UserProfile"`, Spalten wie `"createdAt"`. Jetzt sind Gross- und
 * Kleinbuchstaben erlaubt, sonst nichts Neues: kein Leerzeichen, kein
 * Anfuehrungszeichen, kein Punkt, hoechstens 63 Zeichen wie PostgreSQL.
 *
 * Die Grenze bleibt eine Sicherheitsgrenze: jeder Name landet in SQL nur
 * ueber `"..."`, und ein Name, der diese Grammatik erfuellt, kann das
 * Anfuehrungszeichen nicht verlassen. Schemanamen bleiben bei der alten
 * Grammatik; `public` ist die Regel, und ein Schema mit Grossbuchstaben ist
 * ein eigener Schritt.
 */
export const DATA_IDENTIFIER_PATTERN = "[A-Za-z_][A-Za-z0-9_]{0,62}";
export const DATA_IDENTIFIER = new RegExp(`^${DATA_IDENTIFIER_PATTERN}$`);

export function isDataIdentifier(value: unknown): value is string {
  return typeof value === "string" && DATA_IDENTIFIER.test(value);
}
