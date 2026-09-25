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
 *
 * Seit 2.28 (Review-Befund) meldet sich jede registrierte Klasse bei ihren
 * registrierten Vorfahren an, damit `instanceof RepositoryError` eine fremde
 * `ConflictError` erkennt, ohne dass die Basisklasse ihre Unterklassen
 * aufzaehlen muss. Und weil `Symbol.hasInstance` statisch vererbt wird,
 * faellt eine *nicht* registrierte Unterklasse auf die Prototypkette zurueck,
 * statt die Namen ihres Vorfahren als die eigenen zu nehmen.
 */
type ErrorConstructor = abstract new (...args: never[]) => Error;

const registry = new WeakMap<ErrorConstructor, Set<string>>();

export function recognisedByName(constructor: ErrorConstructor, name: string, subclassNames: readonly string[] = []): void {
  const names = new Set([name, ...subclassNames]);
  registry.set(constructor, names);
  // Bei allen registrierten Vorfahren anmelden: eine fremde Kopie dieser
  // Klasse ist auch eine Instanz der Basisklasse.
  let ancestor = Object.getPrototypeOf(constructor) as ErrorConstructor | null;
  while (ancestor && ancestor !== Function.prototype) {
    registry.get(ancestor)?.add(name);
    ancestor = Object.getPrototypeOf(ancestor) as ErrorConstructor | null;
  }
  Object.defineProperty(constructor.prototype, "name", { value: name, configurable: true, writable: true });
  Object.defineProperty(constructor, Symbol.hasInstance, {
    configurable: true,
    value(this: ErrorConstructor, value: unknown): boolean {
      const byPrototype = typeof value === "object" && value !== null && Object.prototype.isPrototypeOf.call(this.prototype, value);
      if (byPrototype) return true;
      // Geerbt von einer registrierten Basisklasse, selbst nicht registriert: nur die Prototypkette zaehlt.
      const known = registry.get(this);
      if (!known) return false;
      return value instanceof Error && known.has(value.name);
    },
  });
}
