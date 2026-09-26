/**
 * Die erlaubten Ruecksprungziele einer Projektumgebung (2.54).
 *
 * Warum das ein eigenes, reines Modul ist: Es ist der Teil dieses Slices mit
 * Sicherheitsgewicht. Ein Ruecksprungziel ist der Ort, an den ein Magic Link
 * oder ein OIDC-Flow den Nutzer zurueckschickt; wer die Liste weiten kann,
 * kann sich ein Token an eine fremde Adresse schicken lassen. Die
 * Entscheidung muss darum einzeln pruefbar sein: keine Datenbank, keine Zeit,
 * kein React, keine Farbe.
 *
 * Zwei Begriffe, und der Unterschied traegt alles:
 *
 * - **Aeussere Grenze** (`outerBound`): die Herkuenfte aus
 *   `QKERN_PROJECT_AUTH_REDIRECT_ORIGINS`, gelesen beim Start des Prozesses
 *   (`lib/server/project-auth/runtime.ts`). Diese Grenze gehoert dem Betrieb
 *   und ist aus der Console nicht erreichbar.
 * - **Liste des Projekts** (`allowList`): was eine Projektumgebung davon
 *   uebrig laesst. Sie kann die aeussere Grenze nur **verengen**, nie weiten.
 *   Eine leere Liste verengt nichts; dann gilt genau die aeussere Grenze,
 *   also das Verhalten von vor 2.54.
 *
 * Diese Richtung ist bewusst so herum: Ein Console-Nutzer mit
 * `project_auth_admin` koennte sonst per Schreibzugriff eine Herkunft
 * hinzufuegen, die der Betrieb nie erlaubt hat. Jeder Eintrag, der ausserhalb
 * der aeusseren Grenze laege, wird darum beim Schreiben abgelehnt — nicht
 * stillschweigend gefiltert, sondern mit Grund abgelehnt, damit in der
 * Console steht, warum.
 *
 * Die Form eines Eintrags ist dieselbe strenge Form wie bei der aeusseren
 * Grenze: exakte Herkunft, HTTPS ausser auf einem lokalen Entwicklungshost,
 * keine Zugangsdaten, kein Pfad, keine Abfrage, kein Fragment, kein
 * Platzhalter. Platzhalter gibt es an keiner Stelle dieses Produkts, also
 * auch hier nicht.
 */

/** Wie viele Ziele eine Umgebung hoechstens fuehren darf. */
export const PROJECT_AUTH_RETURN_TARGET_LIMIT = 20;

/** Wie lang ein einzelner Eintrag hoechstens sein darf. */
export const PROJECT_AUTH_RETURN_TARGET_MAX_LENGTH = 255;

/**
 * Warum ein Eintrag abgelehnt wurde. Der Schluessel ist stabil; die Console
 * uebersetzt ihn, die Route gibt ihn unveraendert heraus.
 */
export type ProjectAuthReturnTargetRejection =
  | "not_a_string"
  | "empty"
  | "too_long"
  | "wildcard"
  | "not_a_url"
  | "not_an_origin"
  | "insecure_scheme"
  | "carries_credentials"
  | "outside_outer_bound"
  | "too_many";

export type ProjectAuthReturnTargetResult =
  | { ok: true; targets: string[] }
  | { ok: false; reason: ProjectAuthReturnTargetRejection; value: string };

/** Ein lokaler Entwicklungshost, und nur diese drei. */
export function isLocalDevelopmentHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Prueft die Form eines einzelnen Eintrags, ohne die aeussere Grenze.
 * Gibt die normalisierte Herkunft zurueck oder den Grund der Ablehnung.
 */
export function parseProjectAuthReturnTarget(value: unknown):
| { ok: true; origin: string }
| { ok: false; reason: ProjectAuthReturnTargetRejection } {
  if (typeof value !== "string") return { ok: false, reason: "not_a_string" };
  const entry = value.trim();
  if (entry === "") return { ok: false, reason: "empty" };
  if (entry.length > PROJECT_AUTH_RETURN_TARGET_MAX_LENGTH) return { ok: false, reason: "too_long" };
  // Vor dem Parsen: ein Stern ist nie ein Tippfehler, sondern der Versuch,
  // eine Gruppe von Herkuenften zu erlauben. Das kann dieses Produkt nicht,
  // und es soll nicht so aussehen, als koennte es das.
  if (entry.includes("*")) return { ok: false, reason: "wildcard" };
  let url: URL;
  try { url = new URL(entry); } catch { return { ok: false, reason: "not_a_url" }; }
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "carries_credentials" };
  // `origin` ist die Herkunft ohne Pfad, Abfrage und Fragment. Stimmt sie
  // nicht Zeichen fuer Zeichen mit der Eingabe ueberein, stand dort mehr als
  // eine Herkunft — ein Pfad, ein Schraegstrich am Ende, eine Abfrage.
  if (url.origin !== entry) return { ok: false, reason: "not_an_origin" };
  const localHttp = url.protocol === "http:" && isLocalDevelopmentHost(url.hostname);
  if (url.protocol !== "https:" && !localHttp) return { ok: false, reason: "insecure_scheme" };
  return { ok: true, origin: url.origin };
}

/**
 * Prueft eine ganze Liste gegen die aeussere Grenze. Doppelte Eintraege
 * fallen weg, die Reihenfolge bleibt. Eine leere Liste ist erlaubt und heisst
 * "nicht verengt".
 */
export function parseProjectAuthReturnTargets(
  values: readonly unknown[],
  outerBound: ReadonlySet<string>,
): ProjectAuthReturnTargetResult {
  if (values.length > PROJECT_AUTH_RETURN_TARGET_LIMIT) {
    return { ok: false, reason: "too_many", value: String(values.length) };
  }
  const targets: string[] = [];
  for (const value of values) {
    const parsed = parseProjectAuthReturnTarget(value);
    if (!parsed.ok) return { ok: false, reason: parsed.reason, value: typeof value === "string" ? value : "" };
    // Der tragende Satz dieses Moduls: verengen, nie weiten.
    if (!outerBound.has(parsed.origin)) {
      return { ok: false, reason: "outside_outer_bound", value: parsed.origin };
    }
    if (!targets.includes(parsed.origin)) targets.push(parsed.origin);
  }
  return { ok: true, targets };
}

/**
 * Die Entscheidung an der Stelle, an der ein Ziel wirklich angenommen wird:
 * Darf dieser Wert als Ruecksprungziel dienen?
 *
 * Erst die Form, dann beide Grenzen. Ein Fragment ist hier zusaetzlich
 * verboten, weil der Wert als Abfrageparameter in einen Link wandert und ein
 * Fragment dort alles danach abschneiden wuerde.
 */
export function projectAuthReturnTargetAllowed(input: {
  value: string;
  outerBound: ReadonlySet<string>;
  allowList: readonly string[];
}): boolean {
  let url: URL;
  try { url = new URL(input.value); } catch { return false; }
  if (url.username !== "" || url.password !== "" || url.hash !== "") return false;
  if (!input.outerBound.has(url.origin)) return false;
  // Leere Liste: die Umgebung verengt nicht, es gilt die aeussere Grenze.
  return input.allowList.length === 0 || input.allowList.includes(url.origin);
}

/**
 * Was am Ende wirklich gilt: die Schnittmenge, und zwar als Liste, damit die
 * Console sie zeigen kann, ohne sie selbst auszurechnen.
 */
export function effectiveProjectAuthReturnTargets(
  outerBound: ReadonlySet<string>,
  allowList: readonly string[],
): string[] {
  const bound = [...outerBound];
  if (allowList.length === 0) return bound;
  return bound.filter((origin) => allowList.includes(origin));
}
