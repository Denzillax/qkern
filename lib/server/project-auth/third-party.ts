import { createPublicKey, verify as verifySignature, type JsonWebKey, type KeyObject } from "node:crypto";

/**
 * Fremde Anbieter (2.80): Token eines Identitaetsdienstes, den QKERN nicht
 * kontrolliert, direkt von der Data API angenommen.
 *
 * ## Der Unterschied zum OIDC-Weg, und warum er hier steht
 *
 * Beim OIDC-Login (`oidc.ts`) ist das fremde Token eine **Zwischenstation**.
 * QKERN prueft es, legt daraufhin einen eigenen Nutzer in
 * `project_auth_users` an, verbindet ihn mit `project_auth_oidc_identities`
 * und gibt danach ein **eigenes** Access Token aus: eigene Unterschrift,
 * eigener Aussteller, eigene Laufzeit, widerrufbare Sitzung. Alles, was die
 * Data API danach sieht, gehoert QKERN.
 *
 * Hier gibt es keine Zwischenstation. Die Anwendung schickt das Token, das sie
 * vom fremden Dienst schon hat, und die Data API arbeitet damit. Es entsteht
 * kein Konto, keine Sitzung, kein Refresh Token. Das ist der ganze Zweck, und
 * es ist auch der ganze Preis:
 *
 * - **Kein Widerruf.** QKERN kann ein Token nicht zurueckziehen, das es nicht
 *   ausgegeben hat. Gilt es bis `exp`, gilt es bis `exp`. Wer schneller
 *   schliessen will, entfernt den Anbieter; danach faellt jedes Token dieses
 *   Ausstellers, auch die noch gueltigen.
 * - **Keine Nutzerliste.** Unter Auth → Nutzer steht niemand, der so
 *   hereinkommt. Wer diese Menschen zaehlen will, zaehlt sie beim Anbieter.
 * - **Kein zweiter Faktor, keine Sperrung, keine Passwortregel.** Alles drei
 *   sind Zusagen ueber Konten, und Konten gibt es hier nicht.
 *
 * ## Die Entscheidung, um die es geht: welche Rolle ein fremdes Token bekommt
 *
 * Hoechstens `authenticated`. **Nie `service_role`.**
 *
 * `service_role` umgeht in der Data API jede Policy. Ein Token mit dieser Rolle
 * liest jede Zeile jeder Tabelle. Wer sie einem Aussteller gibt, den QKERN
 * nicht kontrolliert, hat die Zeilensicherheit des Projekts an die
 * Registrierungsseite dieses Ausstellers delegiert: Wer dort ein Konto anlegen
 * kann, liest danach alles. Das ist keine Einstellung, die man mit einem
 * Warnhinweis vertreten kann, sondern eine Tuer, und sie wird nicht gebaut. Wer
 * eine Anfrage ohne Policies braucht, nimmt einen Service Key dieses Projekts:
 * Den gibt QKERN aus, er ist widerrufbar, und seine Ausgabe steht im Audit.
 *
 * Die Grenze steht an zwei Stellen, hier und als CHECK in Migration 0061. Nicht
 * aus Misstrauen gegen den Dienst, sondern weil beide Wege einzeln richtig sein
 * sollen: Die Datenbank soll keiner Anwendung glauben muessen, und der Dienst
 * soll keiner Zeile glauben muessen.
 *
 * ## Warum die Positivliste der Verfahren so aussieht
 *
 * Zwei alte Loecher in der Pruefung von JWTs, und beide muessen zu sein:
 *
 * 1. **`alg: none`.** Ein Token ohne Unterschrift, das ein Pruefer annimmt,
 *    weil der Header sagt, es gebe keine zu pruefen. Es faellt hier, weil
 *    `none` in `PROJECT_AUTH_THIRD_PARTY_ALGORITHMS` nicht vorkommt.
 * 2. **Ein symmetrisches Verfahren mit dem oeffentlichen Schluessel als
 *    Geheimnis.** Der Angreifer nimmt den frei abrufbaren oeffentlichen
 *    Schluessel des Ausstellers, rechnet damit ein HMAC und schreibt
 *    `alg: HS256` in den Header. Ein Pruefer, der dem Header folgt, benutzt
 *    dasselbe oeffentliche Material als Geheimnis und bestaetigt jede Faelschung.
 *    Es faellt hier zweimal: `HS256` steht nicht in der Liste, **und** jeder
 *    Eintrag der Liste nennt den Schluesseltyp, den er verlangt, sodass ein
 *    `oct`-Schluessel aus einem Schluesselsatz zu keinem Verfahren passt.
 *
 * Der tragende Satz: **Das Verfahren kommt aus dieser Liste und dem
 * Schluessel, nicht aus dem Token.** Der Header darf sagen, welchen Eintrag der
 * Liste er meint; er darf nicht sagen, wie gerechnet wird. Wer diese Zeile
 * aendert und `header.alg` direkt an `verify` gibt, oeffnet Loch 1 und Loch 2
 * zugleich, und genau das prueft der Zertifizierungsfall (2.80).
 */

/** Die Rollen, die ein fremdes Token bekommen kann. `service_role` fehlt, und das ist die Zusage. */
export const PROJECT_AUTH_THIRD_PARTY_ROLES = ["anon", "authenticated"] as const;
export type ProjectAuthThirdPartyRole = (typeof PROJECT_AUTH_THIRD_PARTY_ROLES)[number];

/** Die Rolle, die ein fremdes Token nie bekommt. Als Wert, damit Console und Test sie nennen koennen. */
export const PROJECT_AUTH_THIRD_PARTY_FORBIDDEN_ROLE = "service_role";

export function isProjectAuthThirdPartyRole(value: unknown): value is ProjectAuthThirdPartyRole {
  return typeof value === "string" && (PROJECT_AUTH_THIRD_PARTY_ROLES as readonly string[]).includes(value);
}

/**
 * Die Positivliste der Signaturverfahren.
 *
 * Je Eintrag steht, **was fuer ein Schluessel** dazugehoert und **wie gerechnet
 * wird**. Beides kommt aus dieser Tabelle und nie aus dem Token.
 *
 * Was fehlt, fehlt mit Grund:
 * - `none`: kein Verfahren, nur eine Behauptung.
 * - `HS256`, `HS384`, `HS512`: symmetrisch. Ein Aussteller, dessen Schluessel
 *   oeffentlich abrufbar ist, hat kein Geheimnis mit QKERN, und der abrufbare
 *   Schluessel als Geheimnis ist die Faelschung von oben.
 * - `RS384`, `ES512`, `PS*`: nicht, weil sie schwach waeren, sondern weil sie
 *   heute niemand braucht, den QKERN kennt. Ein Verfahren aufzunehmen ist ein
 *   Satz Code und ein Zertifizierungsfall; eine Liste mit Verfahren, die nie
 *   gelaufen sind, ist eine Liste mit ungeprueften Zweigen.
 */
export const PROJECT_AUTH_THIRD_PARTY_ALGORITHMS = {
  RS256: { keyType: "RSA", curve: null, digest: "RSA-SHA256", encoding: null },
  RS512: { keyType: "RSA", curve: null, digest: "RSA-SHA512", encoding: null },
  // `ieee-p1363`: Ein JWS traegt die ECDSA-Unterschrift als r und s hintereinander,
  // nicht als DER-Sequenz. Ohne diese Angabe scheitert jede echte Unterschrift.
  ES256: { keyType: "EC", curve: "P-256", digest: "sha256", encoding: "ieee-p1363" },
  ES384: { keyType: "EC", curve: "P-384", digest: "sha384", encoding: "ieee-p1363" },
  // Ed25519 bringt seinen Hash selbst mit; `null` ist hier der richtige Wert
  // und kein fehlender.
  EdDSA: { keyType: "OKP", curve: "Ed25519", digest: null, encoding: null },
} as const satisfies Record<string, {
  keyType: "RSA" | "EC" | "OKP";
  curve: string | null;
  digest: string | null;
  encoding: "ieee-p1363" | null;
}>;

export type ProjectAuthThirdPartyAlgorithm = keyof typeof PROJECT_AUTH_THIRD_PARTY_ALGORITHMS;

export const PROJECT_AUTH_THIRD_PARTY_ALGORITHM_IDS =
  Object.keys(PROJECT_AUTH_THIRD_PARTY_ALGORITHMS) as ProjectAuthThirdPartyAlgorithm[];

/**
 * Die Raender, jeder einzeln begruendet.
 *
 * `clockSkewSeconds`: 30 Sekunden in beide Richtungen. Die eigene Pruefung in
 * `tokens.ts` nimmt 5, und das ist dort richtig: Der Aussteller ist derselbe
 * Prozess. Hier ist er eine fremde Maschine mit fremder Zeitquelle, und eine
 * Toleranz von 5 Sekunden wuerde bei jedem gesunden Aussteller gelegentlich ein
 * frisches Token abweisen. Nach oben begrenzt bleibt sie, weil jede Sekunde
 * Toleranz ein abgelaufenes Token eine Sekunde laenger gelten laesst.
 *
 * `tokenLength`: 16 KiB. Dieselbe Grenze wie fuer ein eigenes Token. Ein Token
 * wird dekodiert, bevor irgendetwas geprueft ist; die Grenze steht vor dem
 * Dekodieren.
 *
 * `subjectLength`: 320 Zeichen, dieselbe Grenze, die die Data API fuer den
 * Anspruch `sub` ohnehin zieht (`assertRequest` in generated-api.ts). Sie steht
 * hier trotzdem, damit ein zu langes Subjekt als Ablehnung mit Grund auffaellt
 * und nicht als allgemeiner Fehler eine Ebene weiter.
 *
 * `externalClaims` und `externalBytes`: Was von den Anspruechen des fremden
 * Ausstellers in `request.jwt.claims` wandert, ist begrenzt. Ein fremdes Token
 * kann beliebig viele Ansprueche tragen, und sie landen in einer
 * Transaktionseinstellung von PostgreSQL, die bei jeder Anfrage gesetzt wird.
 * 16 Namen und 2 KiB sind reichlich fuer eine Policy und wenig genug, dass
 * niemand darueber die Anfrage aufblaehen kann.
 */
export const PROJECT_AUTH_THIRD_PARTY_BOUNDS = {
  clockSkewSeconds: 30,
  tokenLength: 16_384,
  subjectLength: 320,
  audiences: { min: 1, max: 5 },
  externalClaims: { max: 16 },
  externalBytes: { max: 2_048 },
  jwksKeys: { max: 20 },
  jwksBytes: { max: 128 * 1024 },
  jwksTimeoutMs: 5_000,
  jwksTtlSeconds: 300,
  jwksFailureTtlSeconds: 30,
  providers: { max: 10 },
} as const;

/** Der Name eines Anbieters, so wie die Console und die Adresse ihn schreiben. */
export const PROJECT_AUTH_THIRD_PARTY_NAME = /^[a-z][a-z0-9_-]{1,62}$/;

/** Der Name eines Anspruchs beim fremden Aussteller. Punkt und Doppelpunkt erlaubt, weil Namensraeume ueblich sind. */
export const PROJECT_AUTH_THIRD_PARTY_CLAIM_NAME = /^[A-Za-z][A-Za-z0-9_.:/-]{0,126}$/;

/**
 * Die Ansprueche, die QKERN in `request.jwt.claims` selbst setzt und die darum
 * nicht aus einem fremden Token uebernommen werden.
 *
 * Es ist dieselbe Regel wie bei den Auth-Hooks, aus demselben Grund: Ein
 * Anspruch, den QKERN setzt, darf nicht zwei Bedeutungen haben. Der Unterschied
 * zu dort ist, dass hier nichts abgewiesen wird. Ein fremder Aussteller hat
 * `iss`, `aud` und `exp` in seinem Token, weil ein JWT sie braucht, und daraus
 * einen Fehler zu machen hiesse, jedes Token abzuweisen. Sie werden
 * uebergangen, und sie werden hier aufgelistet, damit nachlesbar ist, welche.
 */
export const PROJECT_AUTH_THIRD_PARTY_OWN_CLAIMS = [
  "role", "sub", "iss", "aud", "exp", "iat", "nbf", "jti",
  "key_id", "email_verified", "aal", "session_id",
  "user_metadata", "app_metadata", "token_use", "project_id", "environment",
] as const;

/** Ein hinterlegter Anbieter, so wie der Dienst ihn sieht. */
export type ProjectAuthThirdPartyProvider = {
  id: string;
  name: string;
  issuer: string;
  jwksUri: string;
  audiences: string[];
  /** Aus welchem Anspruch die Identitaet wird. */
  subjectClaim: string;
  /** Aus welchem Anspruch die Rolle wird, oder `null` fuer "aus keinem". */
  roleClaim: string | null;
  /** Die Rolle ohne Anspruch. Hoechstens `authenticated`. */
  defaultRole: ProjectAuthThirdPartyRole;
  createdAt: Date;
};

/** Eine Eingabe fuer einen neuen Anbieter, schon geprueft. */
export type ProjectAuthThirdPartyDefinition = Omit<ProjectAuthThirdPartyProvider, "id" | "createdAt">;

/** Warum eine eingegebene Definition abgelehnt wurde. Stabile Schluessel. */
export type ProjectAuthThirdPartyRejection =
  | "not_an_object"
  | "unknown_field"
  | "name_invalid"
  | "issuer_not_https"
  | "issuer_trailing_slash"
  | "jwks_not_https"
  | "audiences_not_an_array"
  | "audiences_out_of_range"
  | "audience_invalid"
  | "duplicate_audience"
  | "subject_claim_invalid"
  | "role_claim_invalid"
  | "role_not_allowed"
  | "role_forbidden"
  /**
   * Nicht von `parseProjectAuthThirdPartyProvider` vergeben: Wie viele Anbieter
   * eine Umgebung schon hat, weiss nur der Dienst. Der Grund steht trotzdem
   * hier, weil die Console eine Liste von Gruenden anzeigt und nicht zwei.
   */
  | "too_many_providers";

export type ProjectAuthThirdPartyParseResult =
  | { ok: true; provider: ProjectAuthThirdPartyDefinition }
  | { ok: false; reason: ProjectAuthThirdPartyRejection; field: string };

/**
 * Prueft eine ganze Definition. Alle Felder ausser `roleClaim` muessen dabei
 * sein; `subjectClaim` und `defaultRole` haben eine Vorgabe, weil es fuer beide
 * genau eine sinnvolle gibt (`sub` und `authenticated`), und ein Pflichtfeld
 * mit genau einer sinnvollen Antwort ist eine Frage ohne Zweck.
 *
 * Die Adresse wird hier nur auf ihre Form geprueft. Ob der Name des Gegenuebers
 * oeffentlich aufloest, entscheidet die Adresspolicy beim Holen; das kann diese
 * Funktion nicht wissen, und sie tut nicht so.
 */
export function parseProjectAuthThirdPartyProvider(value: unknown): ProjectAuthThirdPartyParseResult {
  if (!isPlainObject(value)) return { ok: false, reason: "not_an_object", field: "" };
  const allowed = ["name", "issuer", "jwksUri", "audiences", "subjectClaim", "roleClaim", "defaultRole"];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return { ok: false, reason: "unknown_field", field: key };
  }
  const name = value.name;
  if (typeof name !== "string" || !PROJECT_AUTH_THIRD_PARTY_NAME.test(name)) {
    return { ok: false, reason: "name_invalid", field: "name" };
  }
  const issuer = value.issuer;
  if (typeof issuer !== "string" || !isExactHttpsUrl(issuer)) {
    return { ok: false, reason: "issuer_not_https", field: "issuer" };
  }
  // Der Schrägstrich am Ende ist ein eigener Grund und keine Formalie: Der
  // Anspruch `iss` wird als Zeichenkette verglichen, und `https://a.test/` und
  // `https://a.test` sind zwei Zeichenketten. Wer den Eintrag mit Schrägstrich
  // speichert, bekommt bei jedem Token eine Ablehnung ohne erkennbaren Grund.
  if (issuer.endsWith("/")) return { ok: false, reason: "issuer_trailing_slash", field: "issuer" };
  const jwksUri = value.jwksUri;
  if (typeof jwksUri !== "string" || !isExactHttpsUrl(jwksUri)) {
    return { ok: false, reason: "jwks_not_https", field: "jwksUri" };
  }
  const list = value.audiences;
  if (!Array.isArray(list)) return { ok: false, reason: "audiences_not_an_array", field: "audiences" };
  if (list.length < PROJECT_AUTH_THIRD_PARTY_BOUNDS.audiences.min ||
      list.length > PROJECT_AUTH_THIRD_PARTY_BOUNDS.audiences.max) {
    return { ok: false, reason: "audiences_out_of_range", field: "audiences" };
  }
  const audiences: string[] = [];
  for (const entry of list) {
    if (typeof entry !== "string" || entry.length < 1 || entry.length > 255 || /[,\s]/.test(entry)) {
      return { ok: false, reason: "audience_invalid", field: "audiences" };
    }
    if (audiences.includes(entry)) return { ok: false, reason: "duplicate_audience", field: "audiences" };
    audiences.push(entry);
  }
  const subjectClaim = value.subjectClaim ?? "sub";
  if (typeof subjectClaim !== "string" || !PROJECT_AUTH_THIRD_PARTY_CLAIM_NAME.test(subjectClaim)) {
    return { ok: false, reason: "subject_claim_invalid", field: "subjectClaim" };
  }
  const roleClaim = value.roleClaim ?? null;
  if (roleClaim !== null &&
      (typeof roleClaim !== "string" || !PROJECT_AUTH_THIRD_PARTY_CLAIM_NAME.test(roleClaim))) {
    return { ok: false, reason: "role_claim_invalid", field: "roleClaim" };
  }
  const defaultRole = value.defaultRole ?? "authenticated";
  // Der Versuch, `service_role` einzutragen, bekommt einen eigenen Grund. Die
  // allgemeine Ablehnung faenge ihn auch, aber sie sagte nur "keine erlaubte
  // Rolle", und das ist die falsche Auskunft: Der Name ist eine Rolle, die es
  // gibt, und sie ist hier verboten. Die Reihenfolge ist dieselbe Regel wie bei
  // den reservierten Anspruechen der Auth-Hooks (2.77).
  if (defaultRole === PROJECT_AUTH_THIRD_PARTY_FORBIDDEN_ROLE) {
    return { ok: false, reason: "role_forbidden", field: "defaultRole" };
  }
  if (!isProjectAuthThirdPartyRole(defaultRole)) {
    return { ok: false, reason: "role_not_allowed", field: "defaultRole" };
  }
  return { ok: true, provider: { name, issuer, jwksUri, audiences, subjectClaim, roleClaim, defaultRole } };
}

/* ------------------------------------------------------------------ *
 * Die Pruefung eines Tokens
 * ------------------------------------------------------------------ */

/** Warum ein fremdes Token nicht angenommen wurde. Stabile Schluessel. */
export type ProjectAuthThirdPartyRefusal =
  | "token_too_long"
  | "not_three_parts"
  | "header_not_an_object"
  | "claims_not_an_object"
  | "algorithm_not_allowed"
  | "no_matching_key"
  | "key_type_mismatch"
  | "key_unusable"
  | "signature_invalid"
  | "issuer_mismatch"
  | "audience_mismatch"
  | "expired"
  | "not_yet_valid"
  | "issued_in_the_future"
  | "no_expiry"
  | "subject_missing"
  | "subject_too_long"
  | "role_claim_not_allowed";

/** Was aus einem angenommenen Token wird. */
export type ProjectAuthThirdPartyIdentity = {
  providerId: string;
  providerName: string;
  issuer: string;
  subject: string;
  role: ProjectAuthThirdPartyRole;
  /** Die Ansprueche des Ausstellers, flach und begrenzt, fuer `request.jwt.claims`. */
  claims: Record<string, string | number | boolean | null>;
  expiresAt: Date;
};

export type ProjectAuthThirdPartyVerdict =
  | { ok: true; identity: ProjectAuthThirdPartyIdentity }
  | { ok: false; reason: ProjectAuthThirdPartyRefusal };

/**
 * Prueft ein fremdes Token gegen einen hinterlegten Anbieter und dessen
 * Schluesselsatz.
 *
 * Rein: Der Schluesselsatz kommt als Wert herein. Wer ihn holt und wie lange er
 * ihn haelt, steht in `third-party-keys.ts`; diese Funktion soll ohne Netz und
 * ohne Uhr des Betriebssystems pruefbar sein.
 *
 * Die Reihenfolge ist Absicht. Erst das Verfahren, dann der Schluessel, dann
 * die Unterschrift, dann die Ansprueche. Wer die Ansprueche vor der
 * Unterschrift prueft, entscheidet anhand von Daten, die jeder schreiben kann.
 */
export function verifyProjectAuthThirdPartyToken(
  token: string,
  provider: ProjectAuthThirdPartyProvider,
  keys: readonly JsonWebKey[],
  now: Date,
): ProjectAuthThirdPartyVerdict {
  if (typeof token !== "string" || token.length > PROJECT_AUTH_THIRD_PARTY_BOUNDS.tokenLength) {
    return { ok: false, reason: "token_too_long" };
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    return { ok: false, reason: "not_three_parts" };
  }
  const header = decodeJsonObject(parts[0]);
  if (!header) return { ok: false, reason: "header_not_an_object" };
  const claims = decodeJsonObject(parts[1]);
  if (!claims) return { ok: false, reason: "claims_not_an_object" };

  // ### Die Zeile, um die es geht
  //
  // Das Verfahren wird in der Positivliste **gesucht**, nicht aus dem Token
  // **genommen**. Der Header darf einen Eintrag benennen; alles, was danach
  // gerechnet wird, kommt aus `PROJECT_AUTH_THIRD_PARTY_ALGORITHMS`. Ein
  // `alg: none` und ein `alg: HS256` finden hier keinen Eintrag und sind
  // damit erledigt, bevor ein Schluessel gesucht wird.
  const named = typeof header.alg === "string" ? header.alg : "";
  if (!Object.hasOwn(PROJECT_AUTH_THIRD_PARTY_ALGORITHMS, named)) {
    return { ok: false, reason: "algorithm_not_allowed" };
  }
  const algorithm = PROJECT_AUTH_THIRD_PARTY_ALGORITHMS[named as ProjectAuthThirdPartyAlgorithm];

  // Der Schluessel: nach `kid`, wenn der Header einen nennt, sonst jeder des
  // Satzes. Ohne `kid` wird nicht geraten, sondern der Reihe nach probiert;
  // ein Satz mit einem Schluessel ist der haeufige Fall, und ein Aussteller,
  // der mehrere fuehrt und keinen benennt, soll nicht am Benennen scheitern.
  const kid = typeof header.kid === "string" ? header.kid : null;
  const candidates = keys.filter((jwk) =>
    isPlainObject(jwk) && (kid === null || (jwk as { kid?: unknown }).kid === kid));
  if (candidates.length === 0) return { ok: false, reason: "no_matching_key" };

  // Der Schluesseltyp muss zum Verfahren passen, und das ist die zweite Tuer
  // gegen die Faelschung mit dem oeffentlichen Schluessel als Geheimnis: Ein
  // `oct`-Eintrag in einem Schluesselsatz passt zu keinem Verfahren dieser
  // Liste, weil keines symmetrisch ist.
  const usable = candidates.filter((jwk) => {
    const entry = jwk as { kty?: unknown; crv?: unknown; alg?: unknown };
    if (entry.kty !== algorithm.keyType) return false;
    if (algorithm.curve !== null && entry.crv !== algorithm.curve) return false;
    // Nennt der Schluessel selbst ein Verfahren, muss es dasselbe sein. Ein
    // Aussteller, der `alg: RS256` an den Schluessel schreibt, sagt damit,
    // wofuer er ihn vorgesehen hat.
    return entry.alg === undefined || entry.alg === named;
  });
  if (usable.length === 0) return { ok: false, reason: "key_type_mismatch" };

  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`, "utf8");
  const signature = Buffer.from(parts[2], "base64url");
  let sawUsableKey = false;
  let valid = false;
  for (const jwk of usable) {
    let key: KeyObject;
    try { key = createPublicKey({ key: jwk, format: "jwk" }); } catch { continue; }
    sawUsableKey = true;
    if (verifyWithAlgorithm(algorithm, signingInput, key, signature)) { valid = true; break; }
  }
  if (!sawUsableKey) return { ok: false, reason: "key_unusable" };
  if (!valid) return { ok: false, reason: "signature_invalid" };

  // Erst jetzt die Ansprueche. Sie sind ab hier vom Aussteller bezeugt.
  if (claims.iss !== provider.issuer) return { ok: false, reason: "issuer_mismatch" };
  const audience = typeof claims.aud === "string"
    ? [claims.aud]
    : Array.isArray(claims.aud) ? claims.aud.filter((entry) => typeof entry === "string") : [];
  if (!audience.some((entry) => provider.audiences.includes(entry as string))) {
    return { ok: false, reason: "audience_mismatch" };
  }
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const skew = PROJECT_AUTH_THIRD_PARTY_BOUNDS.clockSkewSeconds;
  // Ein Token ohne `exp` ist ein Token ohne Ende. Es gibt hier keinen Widerruf,
  // also ist `exp` die einzige Zusage, dass dieser Zugang irgendwann aufhoert.
  // Ein fehlendes `exp` ist darum eine eigene Ablehnung und kein "gilt immer".
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp)) {
    return { ok: false, reason: "no_expiry" };
  }
  if (claims.exp <= nowSeconds - skew) return { ok: false, reason: "expired" };
  if (typeof claims.nbf === "number" && claims.nbf > nowSeconds + skew) {
    return { ok: false, reason: "not_yet_valid" };
  }
  if (typeof claims.iat === "number" && claims.iat > nowSeconds + skew) {
    return { ok: false, reason: "issued_in_the_future" };
  }

  const subject = claims[provider.subjectClaim];
  if (typeof subject !== "string" || subject.length < 1) return { ok: false, reason: "subject_missing" };
  if (subject.length > PROJECT_AUTH_THIRD_PARTY_BOUNDS.subjectLength) {
    return { ok: false, reason: "subject_too_long" };
  }

  const role = roleOf(provider, claims);
  if (role === null) return { ok: false, reason: "role_claim_not_allowed" };

  return {
    ok: true,
    identity: {
      providerId: provider.id,
      providerName: provider.name,
      issuer: provider.issuer,
      subject,
      role,
      claims: externalClaims(claims),
      expiresAt: new Date(claims.exp * 1000),
    },
  };
}

/**
 * Welche Rolle dieses Token bekommt, oder `null` fuer "keine erlaubte".
 *
 * Ohne `roleClaim` gilt die Vorgabe des Eintrags. Mit `roleClaim` gilt der Wert
 * des Anspruchs, und er muss `anon` oder `authenticated` sein. Fehlt der
 * Anspruch, gilt wieder die Vorgabe: Ein Token ohne Rollenangabe ist kein
 * Fehler, sondern ein Token, das nichts Besonderes verlangt.
 *
 * **Was hier nicht passiert: kein stilles Herunterstufen.** Ein Token, dessen
 * Rollenanspruch `service_role` sagt, wird abgewiesen und nicht zu
 * `authenticated` gemacht. Der Unterschied ist nicht akademisch: Ein
 * Herunterstufen sieht fuer den Aufrufer aus wie ein Erfolg, und er baut danach
 * eine Anwendung auf einer Rolle, die er nicht hat. Eine Ablehnung ist ein
 * Satz, den er lesen kann.
 */
function roleOf(
  provider: ProjectAuthThirdPartyProvider,
  claims: Record<string, unknown>,
): ProjectAuthThirdPartyRole | null {
  if (provider.roleClaim === null) return provider.defaultRole;
  const value = claims[provider.roleClaim];
  if (value === undefined || value === null) return provider.defaultRole;
  return isProjectAuthThirdPartyRole(value) ? value : null;
}

/**
 * Die Ansprueche, die weitergegeben werden: flach, skalar, begrenzt, und ohne
 * die, die QKERN selbst setzt.
 *
 * Nur Skalare. Ein verschachtelter Anspruch wird uebergangen und nicht
 * abgewiesen: Ein fremdes Token traegt oft ein ganzes Profil, und daran das
 * Lesen einer Tabelle scheitern zu lassen waere Willkuer. Die Grenze steht
 * dafuer doppelt, nach Anzahl und nach Groesse, und beim Erreichen wird
 * abgeschnitten, damit `request.jwt.claims` nie ueber die Grenze der Data API
 * hinauswaechst.
 *
 * Die Reihenfolge ist die des Tokens, damit dieselbe Eingabe dieselbe Ausgabe
 * ergibt und eine Policy sich nicht darauf verlaesst, dass zufaellig sortiert
 * wird.
 */
function externalClaims(claims: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const own = PROJECT_AUTH_THIRD_PARTY_OWN_CLAIMS as readonly string[];
  const safe: Record<string, string | number | boolean | null> = {};
  let names = 0;
  for (const [name, value] of Object.entries(claims)) {
    if (own.includes(name)) continue;
    if (!PROJECT_AUTH_THIRD_PARTY_CLAIM_NAME.test(name)) continue;
    if (!isScalar(value)) continue;
    if (names >= PROJECT_AUTH_THIRD_PARTY_BOUNDS.externalClaims.max) break;
    const candidate = { ...safe, [name]: value };
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > PROJECT_AUTH_THIRD_PARTY_BOUNDS.externalBytes.max) {
      break;
    }
    safe[name] = value;
    names += 1;
  }
  return safe;
}

/**
 * Die Unterschrift, gerechnet nach dem Eintrag der Liste.
 *
 * Eine eigene Funktion, weil hier genau eine Entscheidung steht und sie
 * nachlesbar sein soll: `algorithm` kommt aus
 * `PROJECT_AUTH_THIRD_PARTY_ALGORITHMS`, und der Header des Tokens hat auf
 * diesen Aufruf keinen Zugriff mehr.
 */
function verifyWithAlgorithm(
  algorithm: (typeof PROJECT_AUTH_THIRD_PARTY_ALGORITHMS)[ProjectAuthThirdPartyAlgorithm],
  data: Buffer,
  key: KeyObject,
  signature: Buffer,
): boolean {
  try {
    if (algorithm.digest === null) return verifySignature(null, data, key, signature);
    if (algorithm.encoding === "ieee-p1363") {
      return verifySignature(algorithm.digest, data, { key, dsaEncoding: "ieee-p1363" }, signature);
    }
    return verifySignature(algorithm.digest, data, key, signature);
  } catch {
    // Ein Schluessel, der zum Verfahren nicht passt, laesst `verify` werfen.
    // Das ist eine ungueltige Unterschrift und kein Serverfehler.
    return false;
  }
}

/**
 * Eine Adresse, die genau so benutzt wird, wie sie dasteht: https, ohne
 * Anmeldedaten, ohne Fragment, und kein Name, der offensichtlich nach innen
 * zeigt.
 *
 * `localhost` und eine nackte IP fallen hier schon, obwohl die Adresspolicy
 * beim Holen sie ohnehin abweisen wuerde. Zwei Gruende: Eine Eingabemaske soll
 * beim Eintragen sagen, was nicht geht, und nicht erst bei der ersten
 * Anmeldung. Und ein Eintrag, der nie funktionieren kann, hat in der Tabelle
 * nichts zu suchen.
 */
function isExactHttpsUrl(value: string): boolean {
  if (value.length < 12 || value.length > 512) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return false;
    if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) return false;
    // Eine nackte Adresse statt eines Namens: Sie kann kein Zertifikat auf
    // einen Namen vorzeigen, und die Adresspolicy braeuchte keinen
    // Namensschritt mehr, um sie nach innen zu zeigen.
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.startsWith("[")) return false;
    return true;
  } catch {
    return false;
  }
}

function decodeJsonObject(encoded: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean | null {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  return typeof value === "number" && Number.isFinite(value);
}
