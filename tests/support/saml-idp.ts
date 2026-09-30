import { createSign, generateKeyPairSync, createHash, type KeyObject } from "node:crypto";
import { canonicalizeExclusive, parseXml } from "@/lib/server/project-auth/saml-xml";

/**
 * Ein SAML-Identitaetsanbieter fuer die Zertifizierung (2.99), gebaut aus
 * `node:crypto` und sonst nichts.
 *
 * ## Was dieser Anbieter ist und was er nicht ist
 *
 * Er ist eine **echte Gegenstelle im kryptografischen Sinn**: ein eigenes
 * RSA-Schluesselpaar, ein selbst erzeugtes X.509-Zertifikat, eine echte
 * XML-Signatur nach `rsa-sha256` ueber der exklusiv kanonisierten Assertion.
 * Das Produkt bekommt davon nur das Zertifikat und den base64-Text; es kennt
 * diese Datei nicht.
 *
 * Er ist **keine fremde Software**. Keine SimpleSAMLphp-, Keycloak- oder
 * Shibboleth-Instanz hat hier mitgespielt. Was dieser Anbieter belegt, ist die
 * Pruefung: dass QKERN eine richtig signierte Antwort annimmt und jede der
 * bekannten Faelschungen abweist. Was er **nicht** belegt, ist
 * Interoperabilitaet mit einem Produkt, das jemand anders geschrieben hat. Das
 * steht so im Handbuch und nicht nur hier.
 *
 * Das Zertifikat entsteht als DER von Hand, weil `node:crypto` X.509 lesen
 * aber nicht schreiben kann und `openssl` im Testcontainer nicht vorausgesetzt
 * werden soll. Es ist ein v1-Zertifikat ohne Erweiterungen: QKERN prueft eine
 * Signatur gegen ein hinterlegtes Zertifikat und baut keine Kette, also gibt
 * es hier auch keine Kette zu behaupten.
 */

const NS = {
  assertion: "urn:oasis:names:tc:SAML:2.0:assertion",
  protocol: "urn:oasis:names:tc:SAML:2.0:protocol",
  ds: "http://www.w3.org/2000/09/xmldsig#",
} as const;

export type SamlIdpOptions = {
  entityId?: string;
  validFrom?: Date;
  validTo?: Date;
};

export class TestSamlIdp {
  readonly entityId: string;
  readonly certificatePem: string;
  readonly certificateBase64: string;
  private readonly privateKey: KeyObject;

  constructor(options: SamlIdpOptions = {}) {
    this.entityId = options.entityId ?? "https://idp.qkern.test/metadata";
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    this.privateKey = privateKey;
    const der = selfSignedCertificate({
      commonName: "idp.qkern.test",
      publicKeySpki: publicKey.export({ type: "spki", format: "der" }) as Buffer,
      privateKey,
      validFrom: options.validFrom ?? new Date(Date.now() - 60 * 60 * 1_000),
      validTo: options.validTo ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000),
    });
    this.certificateBase64 = der.toString("base64");
    this.certificatePem = `-----BEGIN CERTIFICATE-----\n${
      this.certificateBase64.replace(/(.{64})/g, "$1\n").replace(/\n$/, "")
    }\n-----END CERTIFICATE-----\n`;
  }

  /** Signiert ein Element und gibt das eingesetzte `ds:Signature` zurueck. */
  signature(elementXml: string, id: string, options: { keyInfo?: boolean } = {}): string {
    const digest = createHash("sha256")
      .update(canonicalizeExclusive(parseXml(elementXml)), "utf8").digest("base64");
    const signedInfo = canonicalizeExclusive(parseXml(
      `<ds:SignedInfo xmlns:ds="${NS.ds}">` +
      `<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>` +
      `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>` +
      `<ds:Reference URI="#${id}">` +
      `<ds:Transforms>` +
      `<ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>` +
      `<ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>` +
      `</ds:Transforms>` +
      `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>` +
      `<ds:DigestValue>${digest}</ds:DigestValue>` +
      `</ds:Reference></ds:SignedInfo>`,
    ));
    const value = createSign("sha256").update(signedInfo, "utf8").sign(this.privateKey).toString("base64");
    const keyInfo = options.keyInfo === false ? "" :
      `<ds:KeyInfo><ds:X509Data><ds:X509Certificate>${this.certificateBase64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>`;
    return `<ds:Signature xmlns:ds="${NS.ds}">${signedInfo}<ds:SignatureValue>${value}</ds:SignatureValue>${keyInfo}</ds:Signature>`;
  }
}

export type SamlResponseOptions = {
  idp: TestSamlIdp;
  /** Wer unterschreibt. Voreinstellung: derselbe Anbieter. Sonst die Falle. */
  signWith?: TestSamlIdp;
  acsUrl: string;
  spEntityId: string;
  requestId: string;
  email: string;
  subject?: string;
  now?: Date;
  assertionId?: string;
  responseId?: string;
  /** Falsche Werte fuer die Fallen. */
  destination?: string;
  recipient?: string;
  audience?: string;
  issuer?: string;
  assertionInResponseTo?: string;
  responseInResponseTo?: string;
  notBefore?: Date;
  notOnOrAfter?: Date;
  /** Eigenes Ablaufdatum der SubjectConfirmationData, damit sich die zwei
   *  Zeitfenster der Assertion getrennt pruefen lassen. */
  confirmationNotOnOrAfter?: Date;
  emailVerified?: "true" | "false" | null;
  /** Keine Signatur ueber der Assertion. */
  signAssertion?: boolean;
  /** Signatur nur ueber der Antworthuelle. */
  signResponse?: boolean;
  /** Eine zweite, unsignierte Assertion daneben (XML Signature Wrapping). */
  wrapWith?: { email: string; subject?: string };
  /** Das Zertifikat im KeyInfo weglassen. */
  keyInfo?: boolean;
};

/** Baut eine vollstaendige `samlp:Response` als base64, wie ein Formular sie traegt. */
export function samlResponse(options: SamlResponseOptions): string {
  return Buffer.from(samlResponseXml(options), "utf8").toString("base64");
}

export function samlResponseXml(options: SamlResponseOptions): string {
  const now = options.now ?? new Date();
  const signer = options.signWith ?? options.idp;
  const issuer = options.issuer ?? options.idp.entityId;
  const assertionId = options.assertionId ?? `_a${createHash("sha256")
    .update(`${options.requestId}:${options.email}:${now.toISOString()}`).digest("hex").slice(0, 32)}`;
  const responseId = options.responseId ?? `_r${assertionId.slice(2)}`;
  const notBefore = options.notBefore ?? new Date(now.getTime() - 5 * 60 * 1_000);
  const notOnOrAfter = options.notOnOrAfter ?? new Date(now.getTime() + 5 * 60 * 1_000);
  const subject = options.subject ?? options.email;
  const verified = options.emailVerified === undefined ? "true" : options.emailVerified;

  const assertionBody = (id: string, mail: string, nameId: string) =>
    `<saml:Issuer>${issuer}</saml:Issuer>` +
    `<saml:Subject>` +
    `<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${nameId}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
    `<saml:SubjectConfirmationData NotOnOrAfter="${instant(options.confirmationNotOnOrAfter ?? notOnOrAfter)}"` +
    ` Recipient="${options.recipient ?? options.acsUrl}"` +
    ` InResponseTo="${options.assertionInResponseTo ?? options.requestId}"/>` +
    `</saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions NotBefore="${instant(notBefore)}" NotOnOrAfter="${instant(notOnOrAfter)}">` +
    `<saml:AudienceRestriction><saml:Audience>${options.audience ?? options.spEntityId}</saml:Audience>` +
    `</saml:AudienceRestriction></saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${instant(now)}" SessionIndex="${id}">` +
    `<saml:AuthnContext><saml:AuthnContextClassRef>` +
    `urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport` +
    `</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
    `<saml:AttributeStatement>` +
    `<saml:Attribute Name="email"><saml:AttributeValue>${mail}</saml:AttributeValue></saml:Attribute>` +
    (verified === null ? "" :
      `<saml:Attribute Name="email_verified"><saml:AttributeValue>${verified}</saml:AttributeValue></saml:Attribute>`) +
    `<saml:Attribute Name="name"><saml:AttributeValue>SAML Person</saml:AttributeValue></saml:Attribute>` +
    `</saml:AttributeStatement>`;

  const head = (id: string) =>
    `<saml:Assertion xmlns:saml="${NS.assertion}" ID="${id}" Version="2.0" IssueInstant="${instant(now)}">`;

  // Die Signatur entsteht ueber der Assertion **ohne** Signature-Element und
  // wird danach als zweites Kind eingesetzt, genau dort, wo das Schema sie
  // erwartet. Dass beide Wege dieselben Bytes kanonisieren, ist der Punkt der
  // Transformation `enveloped-signature`.
  const unsigned = `${head(assertionId)}${assertionBody(assertionId, options.email, subject)}</saml:Assertion>`;
  const signedAssertion = options.signAssertion === false ? unsigned :
    `${head(assertionId)}${signer.signature(unsigned, assertionId, { keyInfo: options.keyInfo })}` +
    `${assertionBody(assertionId, options.email, subject)}</saml:Assertion>`;

  // XML Signature Wrapping: die echte, signierte Assertion wandert in einen
  // Extensions-Block, und an ihrer Stelle steht eine erfundene ohne Signatur.
  const forgedId = `_f${assertionId.slice(2)}`;
  const forged = options.wrapWith
    ? `${head(forgedId)}${assertionBody(forgedId, options.wrapWith.email, options.wrapWith.subject ?? options.wrapWith.email)}</saml:Assertion>`
    : "";
  const payload = options.wrapWith
    ? `<samlp:Extensions>${signedAssertion}</samlp:Extensions>${forged}`
    : signedAssertion;

  const responseHead = `<samlp:Response xmlns:samlp="${NS.protocol}" xmlns:saml="${NS.assertion}"` +
    ` ID="${responseId}" Version="2.0" IssueInstant="${instant(now)}"` +
    ` Destination="${options.destination ?? options.acsUrl}"` +
    ` InResponseTo="${options.responseInResponseTo ?? options.requestId}">`;
  const responseBody = `<saml:Issuer>${issuer}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    payload;

  if (!options.signResponse) return `${responseHead}${responseBody}</samlp:Response>`;
  const unsignedResponse = `${responseHead}${responseBody}</samlp:Response>`;
  const responseSignature = signer.signature(unsignedResponse, responseId, { keyInfo: options.keyInfo });
  return `${responseHead}${responseSignature}${responseBody}</samlp:Response>`;
}

function instant(value: Date): string {
  return `${value.toISOString().slice(0, 19)}Z`;
}

/* ------------------------------------------------------------------------ *
 * Ein selbst signiertes X.509-Zertifikat, DER von Hand.
 *
 * Nur so viel ASN.1, wie ein v1-Zertifikat braucht: Laengen, INTEGER,
 * SEQUENCE, SET, OID, NULL, UTCTime, UTF8String, BIT STRING. Der oeffentliche
 * Schluessel kommt fertig als SPKI-DER von `node:crypto` und wird unveraendert
 * eingesetzt.
 * ------------------------------------------------------------------------ */

function selfSignedCertificate(input: {
  commonName: string;
  publicKeySpki: Buffer;
  privateKey: KeyObject;
  validFrom: Date;
  validTo: Date;
}): Buffer {
  const algorithm = sequence(Buffer.concat([oid("1.2.840.113549.1.1.11"), nullValue()]));
  const name = sequence(set(sequence(Buffer.concat([oid("2.5.4.3"), utf8(input.commonName)]))));
  const validity = sequence(Buffer.concat([utcTime(input.validFrom), utcTime(input.validTo)]));
  const tbs = sequence(Buffer.concat([
    integer(Buffer.from([0x01])), algorithm, name, validity, name, input.publicKeySpki,
  ]));
  const signature = createSign("sha256").update(tbs).sign(input.privateKey);
  return sequence(Buffer.concat([tbs, algorithm, bitString(signature)]));
}

function tag(byte: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([byte]), length(content.length), content]);
}

function length(value: number): Buffer {
  if (value < 0x80) return Buffer.from([value]);
  const bytes: number[] = [];
  for (let rest = value; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

const sequence = (content: Buffer) => tag(0x30, content);
const set = (content: Buffer) => tag(0x31, content);
const integer = (content: Buffer) => tag(0x02, content);
const nullValue = () => Buffer.from([0x05, 0x00]);
const utf8 = (value: string) => tag(0x0c, Buffer.from(value, "utf8"));
const bitString = (content: Buffer) => tag(0x03, Buffer.concat([Buffer.from([0x00]), content]));

/** `YYMMDDHHMMSSZ`, wie UTCTime es verlangt. Gilt bis 2049 und reicht hier. */
function utcTime(value: Date): Buffer {
  const iso = value.toISOString();
  const text = `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}` +
    `${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  return tag(0x17, Buffer.from(text, "ascii"));
}

function oid(value: string): Buffer {
  const parts = value.split(".").map(Number);
  const bytes = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    const group: number[] = [part % 128];
    for (let rest = Math.floor(part / 128); rest > 0; rest = Math.floor(rest / 128)) {
      group.unshift((rest % 128) | 0x80);
    }
    bytes.push(...group);
  }
  return tag(0x06, Buffer.from(bytes));
}
