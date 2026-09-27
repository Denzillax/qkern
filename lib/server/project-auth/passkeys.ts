import { createHash, createPublicKey, createVerify, timingSafeEqual } from "node:crypto";

/**
 * Anmeldung mit WebAuthn fuer Project Auth (2.79), als reines Modul.
 *
 * Hier steht die ganze Kryptografie und keine Ablage: Was hereinkommt, sind
 * die drei Felder, die der Browser aus `navigator.credentials` zurueckgibt,
 * plus die Herausforderung und die erlaubten Herkuenfte. Was herausgeht, ist
 * ein Urteil mit Grund. Kein Zugriff auf die Datenbank, keine Uhr, kein
 * React: Ein Modul, das man ohne Stack ausrechnen kann, laesst sich auch ohne
 * Stack pruefen.
 *
 * Warum keine fremde Bibliothek: Node bringt alles mit, was diese Pruefungen
 * brauchen. SHA-256 und ECDSA stehen in `node:crypto`, und der einzige Teil,
 * den das Modul selbst schreibt, ist ein Leser fuer die Teilmenge von CBOR,
 * die WebAuthn benutzt (CTAP2 verlangt kanonisches CBOR mit festen Laengen).
 * Ein Leser fuer feste Laengen ist kuerzer als die Einbindung einer
 * Abhaengigkeit und laesst sich hier vollstaendig lesen.
 *
 * ## Welche Verfahren zugelassen sind, und warum nicht mehr
 *
 * Genau eines: **ES256** (COSE `alg` = -7, ECDSA ueber der Kurve P-256 mit
 * SHA-256). Das ist das Verfahren, das jeder Authenticator anbietet, der
 * heute im Feld ist: Windows Hello, Touch ID und Face ID, Android, jeder
 * YubiKey ab Serie 5.
 *
 * Nicht zugelassen sind RS256 (-257) und EdDSA (-8, Ed25519), und das ist
 * eine Entscheidung und kein Versehen. Beide waeren in Node in zwei Zeilen
 * eingebunden, aber jedes zusaetzliche Verfahren ist ein zweiter
 * Unterschriftenweg, den niemand mit einem echten Schluessel probefaehrt.
 * Ein Weg, der nur so aussieht, als wuerde er pruefen, ist schlechter als ein
 * Weg, den es nicht gibt: Der zweite steht auf der Seite, der erste nicht.
 * RS256 existiert praktisch nur fuer aeltere TPM-gestuetzte Windows-Hello-
 * Installationen; wer so einen Authenticator hat, bekommt hier eine Ablehnung
 * mit dem Grund `unsupported_algorithm` und kann sich weiter mit Passwort
 * oder TOTP anmelden.
 *
 * Die Liste der erlaubten Verfahren geht auch nach aussen: Der Aufrufer
 * bekommt sie als `pubKeyCredParams`, damit der Browser gar nicht erst einen
 * Schluessel erzeugt, den dieser Server nicht pruefen kann.
 */

/** Das eine zugelassene Verfahren, in der Zaehlung von COSE. */
export const PASSKEY_ES256 = -7;

/**
 * Was der Aufrufer als `pubKeyCredParams` an den Browser gibt. Eine Liste mit
 * einem Eintrag, und sie ist genau die Liste, die dieses Modul auch pruefen
 * kann.
 */
export const PASSKEY_ALGORITHMS = [{ type: "public-key" as const, alg: PASSKEY_ES256 }] as const;

/**
 * Warum eine Antwort abgelehnt wurde. Jeder Grund steht fuer genau eine
 * Pruefung, die wirklich laeuft; es gibt hier keinen Grund fuer eine Pruefung,
 * die das Modul nicht macht.
 */
export type PasskeyRefusal =
  | "malformed_response"
  | "malformed_client_data"
  | "type_mismatch"
  | "challenge_mismatch"
  | "origin_not_allowed"
  | "cross_origin"
  | "rp_id_hash_mismatch"
  | "user_not_present"
  | "attested_credential_data_missing"
  | "unsupported_algorithm"
  | "signature_invalid"
  | "sign_count_regressed";

export type PasskeyVerdict<T> = { ok: true; value: T } | { ok: false; reason: PasskeyRefusal };

/** Was aus einer gelungenen Registrierung abgelegt wird. */
export type RegisteredPasskey = {
  /** Die Kennung des Schluessels, base64url, wie der Browser sie fuehrt. */
  credentialId: string;
  /** Der oeffentliche Schluessel als SPKI-DER in base64url. */
  publicKey: string;
  /** Das Verfahren, in der Zaehlung von COSE. Heute immer -7. */
  algorithm: number;
  /** Der Zaehlerstand, den der Authenticator bei der Registrierung nannte. */
  signCount: number;
  /** Ob der Authenticator den Nutzer erkannt hat (PIN, Fingerabdruck, Gesicht). */
  userVerified: boolean;
  /** Das Format der Attestation, wie es im Objekt stand. Nur zur Ablage. */
  attestationFormat: string;
};

/** Was aus einer gelungenen Anmeldung herauskommt. */
export type AssertedPasskey = {
  signCount: number;
  userVerified: boolean;
};

/**
 * Die Registrierung eines Passkeys.
 *
 * Geprueft wird, in dieser Reihenfolge: die Form der Antwort, die Client-Daten
 * (`type`, `challenge`, `origin`, `crossOrigin`), der `rpIdHash` gegen die
 * Domaene derselben Herkunft, das Bit fuer die Anwesenheit des Nutzers, und
 * dass ein Schluessel dabei ist, den dieser Server pruefen kann.
 *
 * Nicht geprueft wird die Attestation. Bei `fmt: "none"`, und das ist der
 * Normalfall jeder Plattform-Anmeldung, gibt es keine Aussage ueber die
 * Herkunft des Authenticators, die man pruefen koennte; eine Kette gegen die
 * FIDO-Metadaten waere ein eigener Schnitt mit eigener Ablage. Was das
 * bedeutet, steht als Satz auf der Seite: Dieser Server glaubt bei der
 * Registrierung, dass der Schluessel aus dem Geraet kommt, das der Nutzer
 * gerade in der Hand hat. Ab der ersten Anmeldung glaubt er nichts mehr,
 * sondern rechnet die Unterschrift nach.
 */
export function verifyPasskeyRegistration(input: {
  attestationObject: string;
  clientDataJSON: string;
  challenge: string;
  allowedOrigins: ReadonlySet<string>;
}): PasskeyVerdict<RegisteredPasskey> {
  let attestation: { fmt: string; authData: Buffer };
  try {
    attestation = readAttestationObject(base64url(input.attestationObject));
  } catch {
    return { ok: false, reason: "malformed_response" };
  }
  const clientData = checkClientData({
    clientDataJSON: input.clientDataJSON,
    expectedType: "webauthn.create",
    challenge: input.challenge,
    allowedOrigins: input.allowedOrigins,
  });
  if (!clientData.ok) return clientData;

  let authenticator: AuthenticatorData;
  try {
    authenticator = readAuthenticatorData(attestation.authData);
  } catch {
    return { ok: false, reason: "malformed_response" };
  }
  if (!sameHash(authenticator.rpIdHash, rpIdHash(clientData.value.origin))) {
    return { ok: false, reason: "rp_id_hash_mismatch" };
  }
  // Ohne dieses Bit hat niemand das Geraet beruehrt. Eine Registrierung, die
  // ohne Zutun des Nutzers zustande kommt, ist keine Registrierung.
  if (!authenticator.userPresent) return { ok: false, reason: "user_not_present" };
  if (!authenticator.credentialId || !authenticator.coseKey) {
    return { ok: false, reason: "attested_credential_data_missing" };
  }
  const key = coseKeyToPublicKey(authenticator.coseKey);
  if (!key) return { ok: false, reason: "unsupported_algorithm" };
  return {
    ok: true,
    value: {
      credentialId: authenticator.credentialId.toString("base64url"),
      publicKey: key.spki.toString("base64url"),
      algorithm: key.algorithm,
      signCount: authenticator.signCount,
      userVerified: authenticator.userVerified,
      attestationFormat: attestation.fmt,
    },
  };
}

/**
 * Die Anmeldung mit einem Passkey, und das ist die Pruefung, auf die es
 * ankommt.
 *
 * Die Unterschrift geht ueber `authenticatorData || sha256(clientDataJSON)`,
 * so wie es die Spezifikation verlangt, und wird gegen den abgelegten
 * oeffentlichen Schluessel gerechnet. Vorher stehen dieselben Pruefungen der
 * Client-Daten wie bei der Registrierung, danach die des Zaehlers.
 *
 * Reihenfolge mit Absicht: die Client-Daten vor der Unterschrift, weil eine
 * gueltige Unterschrift ueber Daten fuer eine fremde Herkunft trotzdem ein
 * Angriff ist; der Zaehler nach der Unterschrift, weil ein Zaehlerstand ohne
 * gueltige Unterschrift keine Aussage ist.
 */
export function verifyPasskeyAssertion(input: {
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
  challenge: string;
  allowedOrigins: ReadonlySet<string>;
  credential: { publicKey: string; algorithm: number; signCount: number };
}): PasskeyVerdict<AssertedPasskey> {
  if (input.credential.algorithm !== PASSKEY_ES256) {
    return { ok: false, reason: "unsupported_algorithm" };
  }
  let authenticatorBytes: Buffer;
  let clientDataBytes: Buffer;
  let signature: Buffer;
  try {
    authenticatorBytes = base64url(input.authenticatorData);
    clientDataBytes = base64url(input.clientDataJSON);
    signature = base64url(input.signature);
    if (signature.length < 8 || signature.length > 256) throw new Error("signature out of bounds");
  } catch {
    return { ok: false, reason: "malformed_response" };
  }
  const clientData = checkClientData({
    clientDataJSON: input.clientDataJSON,
    expectedType: "webauthn.get",
    challenge: input.challenge,
    allowedOrigins: input.allowedOrigins,
  });
  if (!clientData.ok) return clientData;

  let authenticator: AuthenticatorData;
  try {
    authenticator = readAuthenticatorData(authenticatorBytes);
  } catch {
    return { ok: false, reason: "malformed_response" };
  }
  if (!sameHash(authenticator.rpIdHash, rpIdHash(clientData.value.origin))) {
    return { ok: false, reason: "rp_id_hash_mismatch" };
  }
  if (!authenticator.userPresent) return { ok: false, reason: "user_not_present" };

  // Die Unterschrift selbst. `createVerify` liest die DER-Form, und das ist
  // genau die Form, in der WebAuthn eine ECDSA-Unterschrift liefert.
  let valid = false;
  try {
    const key = createPublicKey({
      key: base64url(input.credential.publicKey), format: "der", type: "spki",
    });
    const signed = Buffer.concat([authenticatorBytes, createHash("sha256").update(clientDataBytes).digest()]);
    valid = createVerify("sha256").update(signed).verify(key, signature);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "signature_invalid" };

  // Der Zaehler. Ein Authenticator, der ihn fuehrt, zaehlt bei jeder Benutzung
  // hoch; ein Stand, der nicht gewachsen ist, heisst, dass zwei Kopien
  // desselben Schluessels unterwegs sind. Stehen beide Staende auf 0, fuehrt
  // dieser Authenticator keinen Zaehler (Apple tut das nicht), und dann gibt
  // es hier nichts zu vergleichen. Das ist die eine Stelle, an der das Modul
  // etwas durchlaesst, und sie steht als Satz auf der Seite.
  if (!(authenticator.signCount === 0 && input.credential.signCount === 0) &&
      authenticator.signCount <= input.credential.signCount) {
    return { ok: false, reason: "sign_count_regressed" };
  }
  return {
    ok: true,
    value: { signCount: authenticator.signCount, userVerified: authenticator.userVerified },
  };
}

/**
 * Die Client-Daten, und hier sitzen vier der fuenf Pruefungen dieses Slices.
 *
 * `challenge` wird zeitgleichlang verglichen. Das ist hier weniger wichtig als
 * bei einem Geheimnis, weil die Herausforderung ohnehin verbraucht wird, aber
 * ein Vergleich mit `===` auf einem Wert, der aus der Anfrage kommt, ist eine
 * Gewohnheit, die man sich nicht angewoehnen sollte.
 *
 * `origin` muss **genau** in der Liste stehen. Ein falsches `origin` ist ein
 * Angriff und kein Tippfehler: Es heisst, dass die Unterschrift auf einer
 * fremden Seite entstanden ist.
 *
 * `crossOrigin` muss fehlen oder `false` sein. Eine Anmeldung aus einem
 * eingebetteten Rahmen heraus sieht fuer den Nutzer nicht wie die Seite aus,
 * auf der er zu sein glaubt.
 */
function checkClientData(input: {
  clientDataJSON: string;
  expectedType: "webauthn.create" | "webauthn.get";
  challenge: string;
  allowedOrigins: ReadonlySet<string>;
}): PasskeyVerdict<{ origin: string }> {
  let parsed: unknown;
  try {
    const raw = base64url(input.clientDataJSON);
    if (raw.length < 2 || raw.length > 8_192) throw new Error("client data out of bounds");
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed_client_data" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "malformed_client_data" };
  }
  const data = parsed as Record<string, unknown>;
  if (typeof data.type !== "string" || typeof data.challenge !== "string" ||
      typeof data.origin !== "string") {
    return { ok: false, reason: "malformed_client_data" };
  }
  if (data.type !== input.expectedType) return { ok: false, reason: "type_mismatch" };
  if (!sameString(data.challenge, input.challenge)) return { ok: false, reason: "challenge_mismatch" };
  if (!input.allowedOrigins.has(data.origin)) return { ok: false, reason: "origin_not_allowed" };
  if (data.crossOrigin !== undefined && data.crossOrigin !== false) {
    return { ok: false, reason: "cross_origin" };
  }
  return { ok: true, value: { origin: data.origin } };
}

/**
 * Die erlaubte Domaene als Hash, abgeleitet aus der Herkunft, die die
 * Client-Daten genannt haben und die schon in der Liste stand.
 *
 * Streng und ohne Nachsicht: Der `rpIdHash` muss der Hash genau dieses
 * Hostnamens sein. WebAuthn erlaubt auch eine registrierbare Oberdomaene als
 * `rpId` (`app.example.com` mit `rpId: example.com`); dieser Server nimmt das
 * nicht an, weil er dafuer wissen muesste, wo eine registrierbare Domaene
 * anfaengt, und diese Liste ist eine eigene Ablage. Wer Passkeys ueber mehrere
 * Unterdomaenen teilen will, kann das hier nicht, und das steht auf der Seite.
 */
function rpIdHash(origin: string): Buffer {
  return createHash("sha256").update(new URL(origin).hostname, "utf8").digest();
}

type AuthenticatorData = {
  rpIdHash: Buffer;
  userPresent: boolean;
  userVerified: boolean;
  signCount: number;
  credentialId: Buffer | null;
  coseKey: Map<unknown, unknown> | null;
};

/**
 * `authenticatorData` nach der Spezifikation: 32 Byte `rpIdHash`, ein Byte
 * Flags, vier Byte Zaehler, danach die Daten des Schluessels, wenn Bit 6
 * gesetzt ist.
 */
function readAuthenticatorData(buffer: Buffer): AuthenticatorData {
  if (buffer.length < 37) throw new Error("authenticator data too short");
  const flags = buffer[32];
  const base: AuthenticatorData = {
    rpIdHash: buffer.subarray(0, 32),
    userPresent: (flags & 0x01) !== 0,
    userVerified: (flags & 0x04) !== 0,
    signCount: buffer.readUInt32BE(33),
    credentialId: null,
    coseKey: null,
  };
  if ((flags & 0x40) === 0) return base;
  if (buffer.length < 55) throw new Error("attested credential data too short");
  const credentialIdLength = buffer.readUInt16BE(53);
  // 1023 ist die Grenze der Spezifikation. Ohne sie waere eine Laengenangabe
  // aus der Anfrage eine Anweisung, beliebig viel Speicher zu lesen.
  if (credentialIdLength < 1 || credentialIdLength > 1_023) throw new Error("credential id out of bounds");
  const keyStart = 55 + credentialIdLength;
  if (buffer.length < keyStart + 1) throw new Error("cose key missing");
  const decoded = readCbor(buffer, keyStart);
  if (!(decoded.value instanceof Map)) throw new Error("cose key is not a map");
  return {
    ...base,
    credentialId: buffer.subarray(55, keyStart),
    coseKey: decoded.value,
  };
}

/** Das Attestation-Objekt: eine CBOR-Karte mit `fmt`, `attStmt` und `authData`. */
function readAttestationObject(buffer: Buffer): { fmt: string; authData: Buffer } {
  const decoded = readCbor(buffer, 0);
  if (!(decoded.value instanceof Map)) throw new Error("attestation object is not a map");
  const fmt = decoded.value.get("fmt");
  const authData = decoded.value.get("authData");
  if (typeof fmt !== "string" || fmt.length > 32 || !Buffer.isBuffer(authData)) {
    throw new Error("attestation object is incomplete");
  }
  return { fmt, authData };
}

/**
 * Der COSE-Schluessel als Schluessel, den Node pruefen kann.
 *
 * Der Umweg geht ueber JWK und nicht ueber selbst zusammengesetztes DER: Node
 * baut aus `{kty: "EC", crv: "P-256", x, y}` denselben Schluessel, und ein
 * Aufruf, der die Form pruefen laesst, ist besser als 40 Byte Praefix, die
 * man von Hand richtig haben muss. Abgelegt wird danach SPKI-DER, weil das
 * die Form ist, die jeder Leser dieser Tabelle kennt.
 *
 * `null` heisst: kein Verfahren, das dieser Server prueft. Es ist kein Fehler
 * der Antwort, sondern eine Ablehnung mit Grund.
 */
function coseKeyToPublicKey(key: Map<unknown, unknown>): { spki: Buffer; algorithm: number } | null {
  const kty = key.get(1);
  const alg = key.get(3);
  const crv = key.get(-1);
  const x = key.get(-2);
  const y = key.get(-3);
  // kty 2 ist EC2, crv 1 ist P-256, alg -7 ist ES256. Alle drei muessen
  // zusammenpassen: Ein Schluessel auf einer anderen Kurve mit `alg: -7` waere
  // eine Angabe, die sich selbst widerspricht.
  if (kty !== 2 || alg !== PASSKEY_ES256 || crv !== 1) return null;
  if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) return null;
  try {
    const publicKey = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: x.toString("base64url"), y: y.toString("base64url") },
      format: "jwk",
    });
    return { spki: publicKey.export({ format: "der", type: "spki" }), algorithm: PASSKEY_ES256 };
  } catch {
    return null;
  }
}

/**
 * Der Leser fuer die Teilmenge von CBOR, die WebAuthn benutzt: vorzeichenlose
 * und negative ganze Zahlen, Byte- und Textketten, Felder und Karten, jeweils
 * mit fester Laenge, sowie die drei einfachen Werte.
 *
 * Was fehlt, fehlt mit Absicht: unbestimmte Laengen, Tags und Gleitkommazahlen.
 * CTAP2 verlangt kanonisches CBOR, in dem es davon nichts gibt, und ein Leser,
 * der mehr annimmt als der Erzeuger schickt, ist nur mehr Flaeche.
 *
 * Die Tiefe ist begrenzt, damit eine verschachtelte Antwort nicht den Stapel
 * aufbraucht.
 */
function readCbor(buffer: Buffer, offset: number, depth = 0): { value: unknown; next: number } {
  if (depth > 8) throw new Error("cbor nested too deeply");
  if (offset >= buffer.length) throw new Error("cbor ended early");
  const initial = buffer[offset];
  const major = initial >> 5;
  const minor = initial & 0x1f;
  const head = readCborLength(buffer, offset, minor);
  switch (major) {
    case 0: return { value: head.value, next: head.next };
    case 1: return { value: -1 - head.value, next: head.next };
    case 2: {
      const end = head.next + head.value;
      if (end > buffer.length) throw new Error("cbor byte string ended early");
      return { value: buffer.subarray(head.next, end), next: end };
    }
    case 3: {
      const end = head.next + head.value;
      if (end > buffer.length) throw new Error("cbor text string ended early");
      return { value: buffer.subarray(head.next, end).toString("utf8"), next: end };
    }
    case 4: {
      const items: unknown[] = [];
      let cursor = head.next;
      for (let index = 0; index < head.value; index += 1) {
        const item = readCbor(buffer, cursor, depth + 1);
        items.push(item.value);
        cursor = item.next;
      }
      return { value: items, next: cursor };
    }
    case 5: {
      const map = new Map<unknown, unknown>();
      let cursor = head.next;
      for (let index = 0; index < head.value; index += 1) {
        const key = readCbor(buffer, cursor, depth + 1);
        const value = readCbor(buffer, key.next, depth + 1);
        map.set(key.value, value.value);
        cursor = value.next;
      }
      return { value: map, next: cursor };
    }
    case 7: {
      if (minor === 20) return { value: false, next: offset + 1 };
      if (minor === 21) return { value: true, next: offset + 1 };
      if (minor === 22) return { value: null, next: offset + 1 };
      throw new Error("cbor simple value is not supported");
    }
    default: throw new Error("cbor major type is not supported");
  }
}

/**
 * Die Laengen- oder Zahlenangabe eines CBOR-Kopfes. Mehr als vier Byte gibt es
 * hier nicht: Eine Laenge jenseits von 2^32 kaeme in einer WebAuthn-Antwort
 * nicht vor, und `Number` waere dafuer ohnehin der falsche Typ.
 */
function readCborLength(buffer: Buffer, offset: number, minor: number): { value: number; next: number } {
  if (minor < 24) return { value: minor, next: offset + 1 };
  if (minor === 24) {
    if (offset + 1 >= buffer.length) throw new Error("cbor ended early");
    return { value: buffer[offset + 1], next: offset + 2 };
  }
  if (minor === 25) {
    if (offset + 2 >= buffer.length) throw new Error("cbor ended early");
    return { value: buffer.readUInt16BE(offset + 1), next: offset + 3 };
  }
  if (minor === 26) {
    if (offset + 4 >= buffer.length) throw new Error("cbor ended early");
    return { value: buffer.readUInt32BE(offset + 1), next: offset + 5 };
  }
  throw new Error("cbor length is not supported");
}

/**
 * base64url, streng. `Buffer.from` schluckt fast jede Zeichenkette und gibt
 * still ein kuerzeres Ergebnis zurueck; das Muster davor macht daraus eine
 * Ablehnung.
 */
function base64url(value: string): Buffer {
  if (typeof value !== "string" || value.length < 1 || value.length > 16_384 ||
      !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("value is not base64url");
  }
  return Buffer.from(value, "base64url");
}

function sameHash(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function sameString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
