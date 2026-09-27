/**
 * Auth-Hooks (2.77): hinterlegter eigener Code an den Punkten der Anmeldung,
 * an denen ein Aufruf wirklich etwas aendern darf.
 *
 * Warum das ein eigenes, reines Modul ist: Hier stehen die Entscheidungen mit
 * Sicherheitsgewicht, und zwar alle. Welche Punkte es gibt, was ein Hook sehen
 * darf, was er aendern darf und was gilt, wenn er nicht antwortet. Kein React,
 * keine Datenbank, kein Aufrufdienst, nur `node:crypto` braucht es nicht
 * einmal. Ein Rand gehoert einzeln geprueft.
 *
 * ## Die zwei Punkte, und warum es nur zwei sind
 *
 * Ein Hook ist eine hinterlegte Function von QKERN, die an einem festen Punkt
 * gerufen wird. Ein Punkt, an dem das Ergebnis des Aufrufs verworfen wuerde,
 * ist kein Hook, sondern eine Benachrichtigung. Diese Fassung baut darum zwei:
 *
 * - **`sign_in`**: Gerufen, nachdem die Anmeldedaten stimmen und der zweite
 *   Faktor geklaert ist, aber **bevor** eine Sitzung entsteht. Der Hook darf
 *   die Anmeldung abweisen. Das ist eine Wirkung: Ohne diesen Punkt gaebe es
 *   keinen Ort, an dem ein Projekt eine eigene Regel ueber die Zulassung
 *   durchsetzen kann, ohne QKERN zu aendern.
 * - **`access_token_claims`**: Gerufen bei **jeder** Ausgabe eines Access
 *   Token, also bei der Anmeldung und bei jeder Erneuerung. Der Hook darf
 *   Ansprueche aus einer vorher erklaerten Liste setzen. Auch das ist eine
 *   Wirkung: Die Ansprueche stehen danach im signierten Token und entscheiden
 *   in den Policies des Projekts mit.
 *
 * Nicht gebaut ist ein Punkt beim Mailversand, und der Grund ist kein
 * Zeitmangel: Der Link einer Aktionsmail traegt das einmalige Token im
 * Klartext. Ein Mail-Hook bekaeme es also zu sehen, und damit einen
 * Anmeldeschein. Fremder Code, der einen Anmeldeschein bekommt, ist keine
 * Erweiterung des Mailwegs, sondern ein zweiter Weg zur Anmeldung.
 *
 * Ebenfalls nicht gebaut ist ein Punkt "nach der Anmeldung". Er waere leicht
 * und waere eine Luege: Sein Ergebnis kaeme zu spaet, um noch etwas zu
 * aendern, und wuerde verworfen.
 *
 * ## Was ein Hook sieht
 *
 * Siehe `projectAuthSignInHookPayload` und
 * `projectAuthClaimsHookPayload`. Jede Auslassung ist dort begruendet.
 *
 * ## Was gilt, wenn der Hook nicht antwortet
 *
 * **Beide Punkte fallen geschlossen.** Antwortet der Hook nicht innerhalb
 * seiner Frist, oder antwortet er etwas, das dieses Modul nicht als Antwort
 * annimmt, dann entsteht keine Sitzung und kein Token. Das ist die unbequeme
 * Haelfte, und sie ist ausgeschrieben, weil sie die wichtigste Entscheidung
 * dieses Schnitts ist:
 *
 * - Bei `sign_in` ist der Zweck des Punktes das Abweisen. Ein Gatter, das im
 *   Zweifel durchlaesst, ist Zierde. Wer es offen wollte, braeuchte den Punkt
 *   nicht.
 * - Bei `access_token_claims` ist der Zweck, dass das Token mehr sagt, als
 *   QKERN weiss. Ein Token ohne diese Ansprueche sagt etwas anderes als das
 *   Token, das das Projekt bestellt hat, und die Policies dahinter lesen den
 *   Unterschied nicht. Ein falsches Token stillschweigend auszugeben ist
 *   schlimmer, als keines auszugeben.
 *
 * Der Preis steht dazu, und die Console sagt ihn woertlich: Ein kaputter Hook
 * sperrt diese Projektumgebung aus. Darum ist die Frist nach oben begrenzt,
 * darum ist ein Punkt ohne hinterlegte Function aus, und darum ist Ausschalten
 * ein Schreibzugriff, der eine Audit-Zeile hinterlaesst.
 *
 * Der Unterschied zum Zaehler der Rate Limits (2.56) ist Absicht: Der Zaehler
 * ist eine Schicht vor der Tuer und darf bei eigenem Fehler durchlassen. Ein
 * Hook ist die Tuer selbst.
 */

/** Die Punkte. Zwei, und mehr gibt es nicht. */
export const PROJECT_AUTH_HOOK_POINTS = ["sign_in", "access_token_claims"] as const;
export type ProjectAuthHookPoint = (typeof PROJECT_AUTH_HOOK_POINTS)[number];

/**
 * Wie ein Hook an die Sitzung kam, aus der er gerufen wird. `mfa` ist die
 * Bestaetigung des zweiten Faktors; sie ist ein eigener Weg zur Sitzung und
 * darum ein eigener Wert.
 */
export const PROJECT_AUTH_HOOK_METHODS = [
  // `passkey` kam mit 2.79 dazu. Er steht hier, weil die Anmeldung mit einem
  // Passkey durch dieselbe Stelle laeuft wie die mit Passwort und darum
  // denselben Hook ruft. Ein Hook, der `password` abweist und `passkey` nicht
  // kennte, haette ein Loch, das genau so aussieht wie eine Anmeldung.
  "password", "magic_link", "email_verification", "oidc", "mfa", "passkey",
] as const;
export type ProjectAuthHookMethod = (typeof PROJECT_AUTH_HOOK_METHODS)[number];

/** Warum ein Access Token ausgegeben wird: neue Anmeldung oder Erneuerung. */
export const PROJECT_AUTH_HOOK_REASONS = ["sign_in", "refresh"] as const;
export type ProjectAuthHookReason = (typeof PROJECT_AUTH_HOOK_REASONS)[number];

/**
 * Die Namen, die ein Hook nie setzen darf.
 *
 * Das sind genau die Ansprueche, die QKERN selbst ausgibt. Die sechs, um die
 * es im Ernstfall geht, stehen vorne: `sub`, `iss`, `aud`, `exp`, `iat`,
 * `role`. Wer `sub` setzen koennte, waere jemand anderes; wer `exp` setzen
 * koennte, haette ein Token ohne Ende; wer `role` setzen koennte, waere in der
 * Datenbank eine andere Rolle. Die uebrigen stehen mit, weil ein Anspruch, den
 * QKERN ausgibt, nicht zwei Bedeutungen haben darf.
 */
export const PROJECT_AUTH_RESERVED_CLAIMS = [
  "sub", "iss", "aud", "exp", "iat", "role",
  "nbf", "jti", "token_use", "project_id", "environment",
  "email", "email_verified", "aal", "session_id",
  "user_metadata", "app_metadata",
] as const;

export function isProjectAuthReservedClaim(name: string): boolean {
  return (PROJECT_AUTH_RESERVED_CLAIMS as readonly string[]).includes(name);
}

/**
 * Die Raender, und jeder einzeln begruendet.
 *
 * `timeoutMs`: Die Frist gehoert in die Definition und nicht in den Code, weil
 * sie eine Abwaegung des Betreibers ist und nicht des Herstellers: Wie lange
 * darf eine Anmeldung auf fremden Code warten, bevor sie scheitert? Nach unten
 * 100 Millisekunden, weil darunter auch ein gesunder Containerstart nicht
 * antwortet und die Frist dann nur noch Anmeldungen bricht. Nach oben 5000
 * Millisekunden, weil der Punkt geschlossen faellt: Eine Frist von einer
 * Minute machte aus jedem haengenden Hook eine Minute Wartezeit je
 * Anmeldeversuch, und das ist kein Schutz mehr, sondern ein Hebel.
 *
 * `claims`: Hoechstens acht Namen. Nicht, weil neun zu viele waeren, sondern
 * weil eine Liste, die beliebig lang werden darf, keine Liste mehr ist,
 * sondern ein offenes Tor mit Anmeldeformular. Acht deckt jeden Fall ab, den
 * ein Token tragen sollte; was mehr braucht, gehoert in die Datenbank des
 * Projekts und nicht in jedes Token.
 *
 * `claimValueLength` und `claimsBytes`: Ein Access Token wandert bei jeder
 * Anfrage mit. `user_metadata` ist seit jeher auf 512 Byte begrenzt; die
 * Ansprueche eines Hooks bekommen dieselbe Grenze, aus demselben Grund.
 */
export const PROJECT_AUTH_HOOK_BOUNDS = {
  timeoutMs: { min: 100, max: 5_000 },
  claims: { max: 8 },
  claimValueLength: { max: 256 },
  claimsBytes: { max: 512 },
} as const;

/** Der Name einer Function, so wie der Aufrufdienst ihn kennt. */
export const PROJECT_AUTH_HOOK_FUNCTION_NAME = /^[a-z][a-z0-9_-]{2,62}$/;

/**
 * Der Name eines Anspruchs. Klein, mit Unterstrich, 2 bis 31 Zeichen. Kein
 * Doppelpunkt und kein Punkt: Ein Anspruch mit Namensraum sieht aus wie ein
 * Standardanspruch fremder Herkunft, und diese Verwechslung soll es nicht
 * geben.
 */
export const PROJECT_AUTH_HOOK_CLAIM_NAME = /^[a-z][a-z0-9_]{1,30}$/;

/** Die Frist eines Punktes ohne eigene Angabe. */
export const PROJECT_AUTH_HOOK_DEFAULT_TIMEOUT_MS = 2_000;

export type ProjectAuthHookBinding = {
  /** `null` heisst: Dieser Punkt ruft nichts. Es gibt keinen zweiten Schalter. */
  functionName: string | null;
  timeoutMs: number;
};

export type ProjectAuthClaimsHookBinding = ProjectAuthHookBinding & {
  /** Die feste Liste der Ansprueche, die dieser Hook setzen darf. */
  claims: string[];
};

export type ProjectAuthHooks = {
  signIn: ProjectAuthHookBinding;
  accessTokenClaims: ProjectAuthClaimsHookBinding;
};

/**
 * Die Vorgabe: kein Hook an keinem Punkt.
 *
 * Eine fehlende Zeile in `project_auth_settings` bedeutet damit "nichts wird
 * gerufen" und nicht "etwas wird gerufen, aber nichts passiert". Eine
 * Installation, die nichts einstellt, verhaelt sich genau wie vor 2.77.
 */
export const DEFAULT_PROJECT_AUTH_HOOKS: ProjectAuthHooks = {
  signIn: { functionName: null, timeoutMs: PROJECT_AUTH_HOOK_DEFAULT_TIMEOUT_MS },
  accessTokenClaims: { functionName: null, timeoutMs: PROJECT_AUTH_HOOK_DEFAULT_TIMEOUT_MS, claims: [] },
};

/** Warum eine eingegebene Definition abgelehnt wurde. Stabile Schluessel. */
export type ProjectAuthHookRejection =
  | "not_an_object"
  | "unknown_field"
  | "missing_point"
  | "function_not_a_name"
  | "function_name_invalid"
  | "timeout_not_an_integer"
  | "timeout_out_of_range"
  | "claims_not_an_array"
  | "too_many_claims"
  | "claim_not_a_string"
  | "claim_name_invalid"
  | "claim_reserved"
  | "duplicate_claim"
  | "claims_without_function"
  | "claims_required";

export type ProjectAuthHookParseResult =
  | { ok: true; hooks: ProjectAuthHooks }
  | { ok: false; reason: ProjectAuthHookRejection; field: string };

/**
 * Prueft eine ganze Definition. Beide Punkte muessen dabei sein: Ein Koerper,
 * der nur einen nennt, liesse offen, was mit dem anderen geschehen soll, und
 * "unveraendert lassen" waere eine Annahme. Dieselbe Regel wie bei den Grenzen
 * (2.56) und beim Passwortschutz (2.53).
 */
export function parseProjectAuthHooks(value: unknown): ProjectAuthHookParseResult {
  if (!isPlainObject(value)) return { ok: false, reason: "not_an_object", field: "" };
  for (const key of Object.keys(value)) {
    if (key !== "signIn" && key !== "accessTokenClaims") {
      return { ok: false, reason: "unknown_field", field: key };
    }
  }
  const signIn = parseBinding(value.signIn, "signIn", false);
  if (!signIn.ok) return signIn;
  const claims = parseBinding(value.accessTokenClaims, "accessTokenClaims", true);
  if (!claims.ok) return claims;
  return {
    ok: true,
    hooks: {
      signIn: { functionName: signIn.binding.functionName, timeoutMs: signIn.binding.timeoutMs },
      accessTokenClaims: {
        functionName: claims.binding.functionName,
        timeoutMs: claims.binding.timeoutMs,
        claims: claims.binding.claims,
      },
    },
  };
}

type ParsedBinding =
  | { ok: true; binding: ProjectAuthClaimsHookBinding }
  | { ok: false; reason: ProjectAuthHookRejection; field: string };

function parseBinding(value: unknown, field: string, withClaims: boolean): ParsedBinding {
  if (!isPlainObject(value)) return { ok: false, reason: "missing_point", field };
  const allowed = withClaims ? ["functionName", "timeoutMs", "claims"] : ["functionName", "timeoutMs"];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return { ok: false, reason: "unknown_field", field: `${field}.${key}` };
  }
  const { functionName, timeoutMs } = value;
  if (functionName !== null && typeof functionName !== "string") {
    return { ok: false, reason: "function_not_a_name", field };
  }
  if (typeof functionName === "string" && !PROJECT_AUTH_HOOK_FUNCTION_NAME.test(functionName)) {
    return { ok: false, reason: "function_name_invalid", field };
  }
  if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs)) {
    return { ok: false, reason: "timeout_not_an_integer", field };
  }
  if (timeoutMs < PROJECT_AUTH_HOOK_BOUNDS.timeoutMs.min || timeoutMs > PROJECT_AUTH_HOOK_BOUNDS.timeoutMs.max) {
    return { ok: false, reason: "timeout_out_of_range", field };
  }
  if (!withClaims) {
    return { ok: true, binding: { functionName, timeoutMs, claims: [] } };
  }
  const list = value.claims;
  if (!Array.isArray(list)) return { ok: false, reason: "claims_not_an_array", field };
  if (list.length > PROJECT_AUTH_HOOK_BOUNDS.claims.max) {
    return { ok: false, reason: "too_many_claims", field };
  }
  const claims: string[] = [];
  for (const entry of list) {
    if (typeof entry !== "string") return { ok: false, reason: "claim_not_a_string", field };
    // Die Reihenfolge ist Absicht: Erst wird gesagt, dass es ein reservierter
    // Name ist, und dann erst, dass er unbrauchbar aussieht. Ein Betreiber,
    // der `role` eintraegt, soll lesen, dass `role` verboten ist, und nicht,
    // dass sein Name falsch geschrieben sei.
    if (isProjectAuthReservedClaim(entry)) return { ok: false, reason: "claim_reserved", field };
    if (!PROJECT_AUTH_HOOK_CLAIM_NAME.test(entry)) return { ok: false, reason: "claim_name_invalid", field };
    if (claims.includes(entry)) return { ok: false, reason: "duplicate_claim", field };
    claims.push(entry);
  }
  // Zwei Formfehler, die beide dasselbe bedeuten: ein Punkt, der nichts tut,
  // aber so aussieht, als taete er etwas.
  //
  // Eine Liste ohne Function ist eine Erlaubnis fuer niemanden. Eine Function
  // ohne Liste ist ein Hook, dessen Ergebnis vollstaendig verworfen wuerde,
  // und genau das ist keine Hook, sondern eine Benachrichtigung, die aussieht
  // wie eine Wirkung.
  if (functionName === null && claims.length > 0) {
    return { ok: false, reason: "claims_without_function", field };
  }
  if (functionName !== null && claims.length === 0) {
    return { ok: false, reason: "claims_required", field };
  }
  return { ok: true, binding: { functionName, timeoutMs, claims } };
}

/* ------------------------------------------------------------------ *
 * Was ein Hook sieht
 * ------------------------------------------------------------------ */

export type ProjectAuthSignInHookPayload = {
  point: "sign_in";
  projectId: string;
  environment: string;
  userId: string;
  email: string;
  emailVerified: boolean;
  method: ProjectAuthHookMethod;
  assurance: "aal1" | "aal2";
  attemptedAt: string;
};

export type ProjectAuthClaimsHookPayload = {
  point: "access_token_claims";
  projectId: string;
  environment: string;
  userId: string;
  email: string;
  emailVerified: boolean;
  assurance: "aal1" | "aal2";
  reason: ProjectAuthHookReason;
  issuedAt: string;
};

/**
 * Die Nutzlast des Punktes `sign_in`, und der Grund fuer jedes Feld, das
 * **nicht** darin steht.
 *
 * Ein Hook ist fremder Code. Er laeuft mit der Autorität des Projekts, in
 * einem Container, dessen ausgehende Verbindungen der Betreiber in der
 * Function-Definition begrenzt (`egressOrigins`). Trotzdem gilt hier die
 * engere Regel: Die Nutzlast traegt, was der Anmeldeversuch **ist**, nicht,
 * was QKERN ueber ihn weiss.
 *
 * - **Kein Passwort.** Nie, und auch nicht gehasht. Ein Hash ist kein
 *   Ersatzwert, sondern derselbe Wert in anderer Schreibweise: Wer ihn hat,
 *   kann raten, und wer ihn mitschreibt, hat ein Passwortleck angelegt. Es
 *   gibt keine Einstellung, die das erlaubt.
 * - **Kein Token.** Weder das Access Token noch das Refresh Token noch der
 *   Schein des zweiten Faktors. Ein Hook, der ein Token bekommt, ist keine
 *   Regel mehr, sondern ein weiterer Anmelder.
 * - **Keine IP-Adresse und kein User Agent.** Zwei Gruende, und der zweite
 *   traegt: Erstens sieht der Dienst sie an dieser Stelle gar nicht, weil er
 *   fuer die Anmeldung nur einen undurchsichtigen `rateLimitKey` bekommt und
 *   seine Grenzen seit 2.56 nach Identitaet zaehlt und ausdruecklich nie nach
 *   IP. Zweitens waere das Weitergeben ein neuer Datenfluss: personenbezogene
 *   Verkehrsdaten in fremden Code, dessen Logzeilen QKERN nicht kennt. Wer
 *   nach Herkunft filtern will, tut das vor QKERN, dort, wo die Adresse
 *   ohnehin steht.
 * - **Kein `user_metadata` und kein `app_metadata`.** Das sind die eigenen
 *   Daten des Projekts. Der Hook laeuft im Projekt und kann sie lesen, wenn er
 *   sie braucht; sie in jede Nutzlast zu legen hiesse, sie auch dann zu
 *   verschicken, wenn niemand sie braucht.
 *
 * Was drin steht, steht drin, weil eine Zulassungsregel ohne es nicht geht:
 * Wer entscheiden soll, ob dieser Nutzer herein darf, braucht seine Identitaet
 * (`userId`), die Adresse, an der ein Projekt seine Regel festmacht (`email`,
 * etwa eine Domain), und den Weg, auf dem er kommt (`method`, `assurance`).
 * `emailVerified` steht dabei, weil es an dieser Stelle immer wahr ist, und
 * eine Regel soll sich darauf verlassen koennen, ohne es zu erraten.
 */
export function projectAuthSignInHookPayload(input: {
  projectId: string;
  environment: string;
  userId: string;
  email: string;
  emailVerified: boolean;
  method: ProjectAuthHookMethod;
  assurance: "aal1" | "aal2";
  attemptedAt: Date;
}): ProjectAuthSignInHookPayload {
  return {
    point: "sign_in",
    projectId: input.projectId,
    environment: input.environment,
    userId: input.userId,
    email: input.email,
    emailVerified: input.emailVerified,
    method: input.method,
    assurance: input.assurance,
    attemptedAt: input.attemptedAt.toISOString(),
  };
}

/**
 * Die Nutzlast des Punktes `access_token_claims`.
 *
 * Dieselben Auslassungen wie oben, und eine zusaetzliche: **keine
 * `session_id`**. Ein Anspruchs-Hook soll Ansprueche liefern und nicht eine
 * Sitzung wiedererkennen; die Sitzungs-ID ist ein Bezeichner, der in fremden
 * Logzeilen nichts zu suchen hat, und mit ihm koennte der Hook nichts tun, was
 * er tun darf. `reason` sagt stattdessen das, worauf es fuer die Ansprueche
 * ankommt: Kommt der Aufruf von einer frischen Anmeldung oder von einer
 * Erneuerung?
 */
export function projectAuthClaimsHookPayload(input: {
  projectId: string;
  environment: string;
  userId: string;
  email: string;
  emailVerified: boolean;
  assurance: "aal1" | "aal2";
  reason: ProjectAuthHookReason;
  issuedAt: Date;
}): ProjectAuthClaimsHookPayload {
  return {
    point: "access_token_claims",
    projectId: input.projectId,
    environment: input.environment,
    userId: input.userId,
    email: input.email,
    emailVerified: input.emailVerified,
    assurance: input.assurance,
    reason: input.reason,
    issuedAt: input.issuedAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * Was ein Hook antwortet
 * ------------------------------------------------------------------ */

/**
 * Die Antwort des Aufrufdienstes, wie dieses Modul sie sieht.
 *
 * `answered: false` traegt einen stabilen Code und keine Meldung: Eine
 * Sandbox- oder Datenbankmeldung an dieser Stelle waere ein Leck, und die
 * Console braucht sie nicht, um "der Hook hat nicht geantwortet" zu sagen.
 */
export type ProjectAuthHookAnswer =
  | { answered: true; statusCode: number; body: unknown }
  | { answered: false; error: string };

/** Warum eine Antwort nicht angenommen wurde. Stabile Schluessel. */
export type ProjectAuthHookRefusal =
  | "no_answer"
  | "bad_status"
  | "body_not_an_object"
  | "decision_unknown"
  | "denied"
  | "claims_not_an_object"
  | "claim_reserved"
  | "claim_not_declared"
  | "claim_value_not_scalar"
  | "claim_value_too_long"
  | "claims_too_large";

export type ProjectAuthClaimValue = string | number | boolean | null;

export type ProjectAuthSignInHookVerdict =
  | { allowed: true }
  | { allowed: false; reason: ProjectAuthHookRefusal };

export type ProjectAuthClaimsHookVerdict =
  | { ok: true; claims: Record<string, ProjectAuthClaimValue> }
  | { ok: false; reason: ProjectAuthHookRefusal; claim?: string };

/**
 * Die Entscheidung am Punkt `sign_in`.
 *
 * Erwartet wird ein 2xx mit einem Koerper `{"decision":"allow"}` oder
 * `{"decision":"deny"}`. Alles andere ist eine Ablehnung, und zwar
 * unterschieden: `denied` heisst, der Hook hat entschieden; `no_answer`,
 * `bad_status`, `body_not_an_object` und `decision_unknown` heissen, er hat es
 * nicht getan. Fuer den Nutzer ist das Ergebnis dasselbe (keine Sitzung), fuer
 * den Betreiber nicht, und darum stehen beide Faelle getrennt im Audit.
 *
 * Ein fehlendes `decision` ist ausdruecklich **kein** stilles `allow`. Ein
 * Container, der ein leeres Objekt zurueckgibt, weil sein Code vorher
 * abgebrochen ist, hat nichts entschieden.
 */
export function projectAuthSignInHookVerdict(answer: ProjectAuthHookAnswer): ProjectAuthSignInHookVerdict {
  if (!answer.answered) return { allowed: false, reason: "no_answer" };
  if (answer.statusCode < 200 || answer.statusCode > 299) return { allowed: false, reason: "bad_status" };
  if (!isPlainObject(answer.body)) return { allowed: false, reason: "body_not_an_object" };
  const decision = answer.body.decision;
  if (decision === "allow") return { allowed: true };
  if (decision === "deny") return { allowed: false, reason: "denied" };
  return { allowed: false, reason: "decision_unknown" };
}

/**
 * Die Ansprueche am Punkt `access_token_claims`.
 *
 * Erwartet wird ein 2xx mit einem Koerper `{"claims": { ... }}`. Geprueft wird
 * in dieser Reihenfolge, und die Reihenfolge ist die Aussage dieses Slices:
 *
 * 1. **Reservierter Name.** Ein Hook, der `sub`, `iss`, `aud`, `exp`, `iat`
 *    oder `role` setzen will, wird abgewiesen, und die ganze Ausgabe faellt.
 *    Nicht "der Anspruch wird uebergangen": Ein Hook, der das versucht, hat
 *    eine andere Vorstellung davon, wer dieser Nutzer ist, als QKERN, und
 *    dieser Streit wird nicht stillschweigend zugunsten von QKERN entschieden.
 *    Er wird gemeldet.
 * 2. **Nicht erklaerter Name.** Nur die Namen aus der Definition. Die Liste
 *    ist eine Zusage des Betreibers an sich selbst; ein Hook, der sie
 *    ueberschreitet, hat sich geaendert, ohne dass jemand die Definition
 *    angefasst hat.
 * 3. **Wert.** Zeichenkette, Zahl, Wahrheitswert oder `null`. Kein Objekt und
 *    keine Liste: Struktur in einem Token ist ein Ort, an dem etwas
 *    unbemerkt waechst, und ein Anspruch, der Struktur braucht, gehoert in die
 *    Datenbank des Projekts. Eine Zahl muss endlich sein, weil `NaN` und
 *    `Infinity` in JSON nicht existieren und als `null` durchrutschen wuerden.
 * 4. **Groesse.** Hoechstens 512 Byte fuer alle Ansprueche zusammen, dieselbe
 *    Grenze, die `user_metadata` seit jeher hat.
 *
 * Ein leeres `claims` ist erlaubt: Ein Hook darf entscheiden, diesem Nutzer
 * nichts hinzuzufuegen. Das ist etwas anderes als keine Antwort.
 */
export function projectAuthClaimsHookVerdict(
  answer: ProjectAuthHookAnswer,
  declared: readonly string[],
): ProjectAuthClaimsHookVerdict {
  if (!answer.answered) return { ok: false, reason: "no_answer" };
  if (answer.statusCode < 200 || answer.statusCode > 299) return { ok: false, reason: "bad_status" };
  if (!isPlainObject(answer.body)) return { ok: false, reason: "body_not_an_object" };
  const offered = answer.body.claims;
  if (!isPlainObject(offered)) return { ok: false, reason: "claims_not_an_object" };
  const claims: Record<string, ProjectAuthClaimValue> = {};
  for (const [name, value] of Object.entries(offered)) {
    // Der reservierte Name kommt vor dem erklaerten: Beide Pruefungen weisen
    // `role` ab, aber nur diese sagt, **warum**. Eine Liste kann keinen
    // reservierten Namen enthalten (die Definition laesst das nicht zu), also
    // faenge die zweite Pruefung den Fall ohne diese Zeile auch auf, nur mit
    // einer harmlos aussehenden Begruendung. Der Zertifizierungsfall (2.77)
    // prueft genau diesen Grund und nicht bloss das Scheitern.
    if (isProjectAuthReservedClaim(name)) return { ok: false, reason: "claim_reserved", claim: name };
    if (!declared.includes(name)) return { ok: false, reason: "claim_not_declared", claim: name };
    if (!isClaimValue(value)) return { ok: false, reason: "claim_value_not_scalar", claim: name };
    if (typeof value === "string" && value.length > PROJECT_AUTH_HOOK_BOUNDS.claimValueLength.max) {
      return { ok: false, reason: "claim_value_too_long", claim: name };
    }
    claims[name] = value;
  }
  if (Buffer.byteLength(JSON.stringify(claims), "utf8") > PROJECT_AUTH_HOOK_BOUNDS.claimsBytes.max) {
    return { ok: false, reason: "claims_too_large" };
  }
  return { ok: true, claims };
}

/* ------------------------------------------------------------------ *
 * Der Port
 * ------------------------------------------------------------------ */

export type ProjectAuthHookCall = {
  point: ProjectAuthHookPoint;
  organizationId: string;
  projectId: string;
  environment: string;
  functionName: string;
  timeoutMs: number;
  payload: ProjectAuthSignInHookPayload | ProjectAuthClaimsHookPayload;
};

/**
 * Der Weg zum hinterlegten Code, als Port.
 *
 * Absichtlich ein Port und kein direkter Griff auf den Aufrufdienst: Project
 * Auth soll nicht von Compute abhaengen, und ein Dienst ohne Port ruft nichts
 * und verhaelt sich wie vor 2.77. Den Port erfuellt
 * `ProjectAuthFunctionHooks`, und der ruft den **vorhandenen**
 * `FunctionInvocationService`. Es gibt keinen zweiten Aufrufweg zu einem
 * Container, und es soll keinen geben: Kapazitaetsgrenze, Kontingent,
 * Aufrufprotokoll und Egress-Grenzen haengen dort.
 *
 * Der Port wirft nicht. Was schiefgeht, kommt als `{ answered: false }`
 * zurueck, damit die Entscheidung "was gilt ohne Antwort" an genau einer
 * Stelle steht und nicht in jedem Fangblock neu.
 */
export interface ProjectAuthHookPort {
  call(input: ProjectAuthHookCall): Promise<ProjectAuthHookAnswer>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isClaimValue(value: unknown): value is ProjectAuthClaimValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  return typeof value === "number" && Number.isFinite(value);
}
