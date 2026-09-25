/**
 * Fehler, die `instanceof` auch aus einem zweiten Modulgraphen bestehen (2.25).
 *
 * Dreimal an einem Tag derselbe Fehler: ein Dienst liegt im Dev-Modus auf
 * `globalThis` und ueberlebt das Neuladen der Module, die Route importiert
 * danach eine andere Kopie der Fehlerklasse, `instanceof` ist falsch, und
 * aus einem sauberen 503 wird ein stummes 500 (Auth in 2.8, Data Plane und
 * Queues in 2.24). Statt an jeder der rund hundert Pruefstellen eine
 * `isXError`-Funktion einzuziehen, macht `recognisedByName` die Klasse
 * selbst robust: `value instanceof XError` ist wahr, wenn `value` ein Error
 * mit dem Namen `"XError"` ist, gleich aus welchem Graphen die Klasse kam.
 *
 * Der Name ist ein Literal, nie `constructor.name`: ein minifiziertes Bundle
 * darf Klassennamen kuerzen, den Namen im Fehler nicht. Er liegt auf dem
 * Prototyp, damit auch Klassen ohne eigenes `this.name = ...` ihn tragen.
 * Fuer Basisklassen zaehlen zusaetzlich die Namen ihrer Unterklassen, damit
 * `instanceof RepositoryError` eine fremde `ConflictError` erkennt.
 */
type ErrorConstructor = abstract new (...args: never[]) => Error;

export function recognisedByName(constructor: ErrorConstructor, name: string, subclassNames: readonly string[] = []): void {
  const names = new Set([name, ...subclassNames]);
  Object.defineProperty(constructor.prototype, "name", { value: name, configurable: true, writable: true });
  Object.defineProperty(constructor, Symbol.hasInstance, {
    configurable: true,
    value(this: ErrorConstructor, value: unknown): boolean {
      if (typeof value === "object" && value !== null && Object.prototype.isPrototypeOf.call(this.prototype, value)) return true;
      return value instanceof Error && names.has(value.name);
    },
  });
}
