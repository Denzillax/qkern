import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PASSKEY_ALGORITHMS,
  verifyPasskeyAssertion,
  verifyPasskeyRegistration,
} from "@/lib/server/project-auth/passkeys";

/**
 * Das reine WebAuthn-Modul (2.79), ohne Datenbank und ohne Browser.
 *
 * Der Zertifizierungsfall (2.79) fährt die ganze Kette gegen die echte
 * Datenbank ab und belegt dort die vier Ablehnungen, auf die es im Betrieb
 * ankommt. Dieser Vertrag deckt die Zweige, für die eine echte Datenbank nichts
 * beiträgt: ein Schlüssel mit einem Verfahren, das dieser Server nicht prüft,
 * eine Antwort, die kein CBOR ist, `crossOrigin`, der falsche `type` und die
 * eine Stelle, an der der Zähler nichts sagt.
 *
 * Gerechnet wird mit echten Schlüsseln. Ein Test, der eine Unterschrift von
 * Hand zusammenstellt und dann prüft, ob das Modul sie annimmt, prüfte nur, ob
 * zwei Fehler zueinander passen.
 */
const ORIGINS = new Set(["https://app.test"]);
const RP_ID_HASH = createHash("sha256").update("app.test", "utf8").digest();

describe("project auth passkeys", () => {
  it("offers exactly the algorithm it can verify", () => {
    // Die Liste geht als `pubKeyCredParams` nach aussen. Stünde darin ein
    // Verfahren, das die Prüfung nicht kennt, erzeugte der Browser einen
    // Schlüssel, der sich nie anmelden kann.
    expect(PASSKEY_ALGORITHMS).toEqual([{ type: "public-key", alg: -7 }]);
  });

  it("registers a real ES256 credential and verifies a real assertion", () => {
    const authenticator = certificationAuthenticator();
    const challenge = randomBytes(32).toString("base64url");
    const registration = verifyPasskeyRegistration({
      attestationObject: authenticator.attestation({ challenge, signCount: 3 }),
      clientDataJSON: clientData("webauthn.create", challenge, "https://app.test"),
      challenge, allowedOrigins: ORIGINS,
    });
    expect(registration.ok).toBe(true);
    if (!registration.ok) return;
    expect(registration.value).toMatchObject({
      algorithm: -7, signCount: 3, userVerified: true, attestationFormat: "none",
    });
    expect(registration.value.publicKey).toBe(
      authenticator.publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
    );

    const next = randomBytes(32).toString("base64url");
    const assertion = verifyPasskeyAssertion({
      ...authenticator.assertion({ challenge: next, signCount: 4, origin: "https://app.test" }),
      challenge: next, allowedOrigins: ORIGINS,
      credential: {
        publicKey: registration.value.publicKey, algorithm: -7, signCount: 3,
      },
    });
    expect(assertion).toEqual({ ok: true, value: { signCount: 4, userVerified: true } });
  });

  it("refuses a key whose algorithm this server does not verify", () => {
    // Ein echter RSA-Schlüssel in einer echten COSE-Karte. Er ist nicht kaputt,
    // er ist bloss keines der Verfahren, die geprüft werden — und genau darum
    // ist die Antwort `unsupported_algorithm` und nicht `malformed_response`.
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2_048 });
    const jwk = rsa.publicKey.export({ format: "jwk" }) as { n: string; e: string };
    const coseKey = cborMap([
      [cborUnsigned(1), cborUnsigned(3)],
      [cborUnsigned(3), cborNegative(-257)],
      [cborNegative(-1), cborBytes(Buffer.from(jwk.n, "base64url"))],
      [cborNegative(-2), cborBytes(Buffer.from(jwk.e, "base64url"))],
    ]);
    const challenge = randomBytes(32).toString("base64url");
    const verdict = verifyPasskeyRegistration({
      attestationObject: attestationObject({
        rpIdHash: RP_ID_HASH, signCount: 0, credentialId: randomBytes(32), coseKey,
      }).toString("base64url"),
      clientDataJSON: clientData("webauthn.create", challenge, "https://app.test"),
      challenge, allowedOrigins: ORIGINS,
    });
    expect(verdict).toEqual({ ok: false, reason: "unsupported_algorithm" });
  });

  it("names every refusal of the client data apart", () => {
    const authenticator = certificationAuthenticator();
    const challenge = randomBytes(32).toString("base64url");
    const registered = verifyPasskeyRegistration({
      attestationObject: authenticator.attestation({ challenge, signCount: 1 }),
      clientDataJSON: clientData("webauthn.create", challenge, "https://app.test"),
      challenge, allowedOrigins: ORIGINS,
    });
    if (!registered.ok) throw new Error("registration should have been accepted");
    const credential = { publicKey: registered.value.publicKey, algorithm: -7, signCount: 1 };

    const next = randomBytes(32).toString("base64url");
    const valid = authenticator.assertion({ challenge: next, signCount: 2, origin: "https://app.test" });

    // Ein falsches `origin`, mit einer gültigen Unterschrift darüber: genau die
    // Form, die ein Phishing-Versuch hat.
    expect(verifyPasskeyAssertion({
      ...authenticator.assertion({ challenge: next, signCount: 2, origin: "https://angreifer.test" }),
      challenge: next, allowedOrigins: ORIGINS, credential,
    })).toEqual({ ok: false, reason: "origin_not_allowed" });

    // Eine fremde Herausforderung.
    expect(verifyPasskeyAssertion({
      ...valid, challenge: randomBytes(32).toString("base64url"),
      allowedOrigins: ORIGINS, credential,
    })).toEqual({ ok: false, reason: "challenge_mismatch" });

    // `webauthn.create` an der Anmeldung.
    expect(verifyPasskeyAssertion({
      ...valid, clientDataJSON: clientData("webauthn.create", next, "https://app.test"),
      challenge: next, allowedOrigins: ORIGINS, credential,
    })).toEqual({ ok: false, reason: "type_mismatch" });

    // Eine Antwort aus einem eingebetteten Rahmen.
    expect(verifyPasskeyAssertion({
      ...valid,
      clientDataJSON: Buffer.from(JSON.stringify({
        type: "webauthn.get", challenge: next, origin: "https://app.test", crossOrigin: true,
      }), "utf8").toString("base64url"),
      challenge: next, allowedOrigins: ORIGINS, credential,
    })).toEqual({ ok: false, reason: "cross_origin" });

    // Etwas, das gar kein base64url ist, faellt schon an der Form der Antwort
    // und nicht erst an den Client-Daten: Die Antwort wird als Ganzes gelesen,
    // bevor irgendetwas darin geprueft wird.
    expect(verifyPasskeyAssertion({
      ...valid, clientDataJSON: "nicht base64url!", challenge: next,
      allowedOrigins: ORIGINS, credential,
    })).toEqual({ ok: false, reason: "malformed_response" });
    // Gueltiges base64url, aber kein JSON: das ist eine Ablehnung der
    // Client-Daten.
    expect(verifyPasskeyAssertion({
      ...valid, clientDataJSON: Buffer.from("kein json", "utf8").toString("base64url"),
      challenge: next, allowedOrigins: ORIGINS, credential,
    })).toEqual({ ok: false, reason: "malformed_client_data" });
    expect(verifyPasskeyRegistration({
      attestationObject: Buffer.from("das ist kein cbor", "utf8").toString("base64url"),
      clientDataJSON: clientData("webauthn.create", challenge, "https://app.test"),
      challenge, allowedOrigins: ORIGINS,
    })).toEqual({ ok: false, reason: "malformed_response" });
  });

  it("refuses a wrong rpIdHash and a response nobody touched the device for", () => {
    const authenticator = certificationAuthenticator();
    const challenge = randomBytes(32).toString("base64url");
    const registered = verifyPasskeyRegistration({
      attestationObject: authenticator.attestation({ challenge, signCount: 1 }),
      clientDataJSON: clientData("webauthn.create", challenge, "https://app.test"),
      challenge, allowedOrigins: ORIGINS,
    });
    if (!registered.ok) throw new Error("registration should have been accepted");
    const credential = { publicKey: registered.value.publicKey, algorithm: -7, signCount: 1 };
    const next = randomBytes(32).toString("base64url");

    // Der `rpIdHash` einer anderen Domäne, mit einer gültigen Unterschrift.
    // Die erlaubte Herkunft allein reicht nicht: Beide Angaben müssen
    // zusammenpassen.
    const foreign = certificationAssertion({
      privateKey: authenticator.privateKey,
      rpIdHash: createHash("sha256").update("angreifer.test", "utf8").digest(),
      signCount: 2, challenge: next, origin: "https://app.test",
    });
    expect(verifyPasskeyAssertion({
      ...foreign, challenge: next, allowedOrigins: ORIGINS, credential,
    })).toEqual({ ok: false, reason: "rp_id_hash_mismatch" });

    // Ohne das Bit für die Anwesenheit hat niemand das Gerät berührt.
    const absent = certificationAssertion({
      privateKey: authenticator.privateKey, rpIdHash: RP_ID_HASH, signCount: 2,
      challenge: next, origin: "https://app.test", flags: 0x00,
    });
    expect(verifyPasskeyAssertion({
      ...absent, challenge: next, allowedOrigins: ORIGINS, credential,
    })).toEqual({ ok: false, reason: "user_not_present" });
  });

  it("lets a counter that stays at zero through and refuses one that does not grow", () => {
    const authenticator = certificationAuthenticator();
    const challenge = randomBytes(32).toString("base64url");
    const registered = verifyPasskeyRegistration({
      attestationObject: authenticator.attestation({ challenge, signCount: 0 }),
      clientDataJSON: clientData("webauthn.create", challenge, "https://app.test"),
      challenge, allowedOrigins: ORIGINS,
    });
    if (!registered.ok) throw new Error("registration should have been accepted");
    const publicKey = registered.value.publicKey;
    const next = randomBytes(32).toString("base64url");

    // Beide Stände auf 0: Dieser Authenticator führt keinen Zähler, und dann
    // gibt es nichts zu vergleichen. Das ist die eine Stelle, an der diese
    // Prüfung durchlässt, und sie steht als Satz auf der Seite.
    expect(verifyPasskeyAssertion({
      ...authenticator.assertion({ challenge: next, signCount: 0, origin: "https://app.test" }),
      challenge: next, allowedOrigins: ORIGINS,
      credential: { publicKey, algorithm: -7, signCount: 0 },
    })).toEqual({ ok: true, value: { signCount: 0, userVerified: true } });

    // Ein abgelegter Stand von 5 und eine Antwort mit 5: derselbe Schlüssel
    // zweimal.
    expect(verifyPasskeyAssertion({
      ...authenticator.assertion({ challenge: next, signCount: 5, origin: "https://app.test" }),
      challenge: next, allowedOrigins: ORIGINS,
      credential: { publicKey, algorithm: -7, signCount: 5 },
    })).toEqual({ ok: false, reason: "sign_count_regressed" });

    // Und ein Stand von 0 gegen einen abgelegten von 5 ist ein Rückfall und
    // keine Ausnahme: Wer schon gezählt hat, zählt weiter.
    expect(verifyPasskeyAssertion({
      ...authenticator.assertion({ challenge: next, signCount: 0, origin: "https://app.test" }),
      challenge: next, allowedOrigins: ORIGINS,
      credential: { publicKey, algorithm: -7, signCount: 5 },
    })).toEqual({ ok: false, reason: "sign_count_regressed" });
  });

  it("refuses a signature from a different key", () => {
    const authenticator = certificationAuthenticator();
    const impostor = certificationAuthenticator();
    const challenge = randomBytes(32).toString("base64url");
    const registered = verifyPasskeyRegistration({
      attestationObject: authenticator.attestation({ challenge, signCount: 1 }),
      clientDataJSON: clientData("webauthn.create", challenge, "https://app.test"),
      challenge, allowedOrigins: ORIGINS,
    });
    if (!registered.ok) throw new Error("registration should have been accepted");
    const next = randomBytes(32).toString("base64url");
    expect(verifyPasskeyAssertion({
      ...impostor.assertion({ challenge: next, signCount: 9, origin: "https://app.test" }),
      challenge: next, allowedOrigins: ORIGINS,
      credential: { publicKey: registered.value.publicKey, algorithm: -7, signCount: 1 },
    })).toEqual({ ok: false, reason: "signature_invalid" });
  });

  it("stays a pure module: no database, no clock, no colour and no dependency", async () => {
    const source = await readFile(
      path.resolve(process.cwd(), "lib/server/project-auth/passkeys.ts"), "utf8");
    // Der einzige Import ist `node:crypto`. Eine fremde Bibliothek für WebAuthn
    // gibt es nicht und soll es nicht geben.
    const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]);
    expect(imports).toEqual(["node:crypto"]);
    expect(source).not.toContain("Date.now");
    expect(source).not.toContain("new Date");
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    // Die Vergleiche, auf die es ankommt, laufen zeitgleichlang.
    expect(source).toContain("timingSafeEqual");
  });
});

/** Ein Authenticator mit einem echten P-256-Paar, der wie einer antwortet. */
function certificationAuthenticator() {
  const keyPair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = keyPair.publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const coseKey = cborMap([
    [cborUnsigned(1), cborUnsigned(2)],
    [cborUnsigned(3), cborNegative(-7)],
    [cborNegative(-1), cborUnsigned(1)],
    [cborNegative(-2), cborBytes(Buffer.from(jwk.x, "base64url"))],
    [cborNegative(-3), cborBytes(Buffer.from(jwk.y, "base64url"))],
  ]);
  const credentialId = randomBytes(32);
  return {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    credentialId,
    attestation(input: { challenge: string; signCount: number }): string {
      return attestationObject({
        rpIdHash: RP_ID_HASH, signCount: input.signCount, credentialId, coseKey,
      }).toString("base64url");
    },
    assertion(input: { challenge: string; signCount: number; origin: string }) {
      return certificationAssertion({
        privateKey: keyPair.privateKey, rpIdHash: RP_ID_HASH, ...input,
      });
    },
  };
}

function certificationAssertion(input: {
  privateKey: KeyObject;
  rpIdHash: Buffer;
  signCount: number;
  challenge: string;
  origin: string;
  flags?: number;
}): { authenticatorData: string; clientDataJSON: string; signature: string } {
  const authenticatorData = authData({
    rpIdHash: input.rpIdHash, signCount: input.signCount, flags: input.flags,
  });
  const clientDataJSON = Buffer.from(JSON.stringify({
    type: "webauthn.get", challenge: input.challenge, origin: input.origin, crossOrigin: false,
  }), "utf8");
  const signed = Buffer.concat([
    authenticatorData, createHash("sha256").update(clientDataJSON).digest(),
  ]);
  return {
    authenticatorData: authenticatorData.toString("base64url"),
    clientDataJSON: clientDataJSON.toString("base64url"),
    signature: createSign("sha256").update(signed).sign(input.privateKey).toString("base64url"),
  };
}

function clientData(
  type: "webauthn.create" | "webauthn.get",
  challenge: string,
  origin: string,
): string {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), "utf8")
    .toString("base64url");
}

function authData(input: {
  rpIdHash: Buffer;
  signCount: number;
  flags?: number;
  credentialId?: Buffer;
  coseKey?: Buffer;
}): Buffer {
  const attested = Boolean(input.credentialId && input.coseKey);
  const header = Buffer.alloc(5);
  header[0] = (input.flags ?? (0x01 | 0x04)) | (attested ? 0x40 : 0);
  header.writeUInt32BE(input.signCount, 1);
  if (!attested) return Buffer.concat([input.rpIdHash, header]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(input.credentialId!.length);
  return Buffer.concat([
    input.rpIdHash, header, Buffer.alloc(16, 0), length, input.credentialId!, input.coseKey!,
  ]);
}

function attestationObject(input: {
  rpIdHash: Buffer;
  signCount: number;
  credentialId: Buffer;
  coseKey: Buffer;
}): Buffer {
  return cborMap([
    [cborText("fmt"), cborText("none")],
    [cborText("attStmt"), cborMap([])],
    [cborText("authData"), cborBytes(authData(input))],
  ]);
}

function cborHead(major: number, value: number): Buffer {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 256) return Buffer.from([(major << 5) | 24, value]);
  const head = Buffer.alloc(3);
  head[0] = (major << 5) | 25;
  head.writeUInt16BE(value, 1);
  return head;
}

const cborUnsigned = (value: number) => cborHead(0, value);
const cborNegative = (value: number) => cborHead(1, -1 - value);
const cborBytes = (value: Buffer) => Buffer.concat([cborHead(2, value.length), value]);
const cborText = (value: string) => Buffer.concat([
  cborHead(3, Buffer.byteLength(value, "utf8")), Buffer.from(value, "utf8"),
]);
const cborMap = (entries: Array<[Buffer, Buffer]>) => Buffer.concat([
  cborHead(5, entries.length), ...entries.flatMap(([key, value]) => [key, value]),
]);
