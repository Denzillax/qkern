import {
  X509Certificate, createHash, createPrivateKey, randomBytes, sign as createSignature,
  timingSafeEqual, verify as verifySignature, type KeyObject,
} from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { recognisedByName } from "@/lib/server/errors/identity";
import { isIP } from "node:net";
import {
  attributeValue, canonicalizeExclusive, childElements, collectIds, directText, onlyChild,
  parseXml, walkElements, xmlAttributeText, XmlFormatError, type XmlElement,
} from "@/lib/server/project-auth/saml-xml";

/**
 * SAML 2.0 als Anmeldeweg fuer Project Auth (2.99), als reines Modul.
 *
 * Abgedeckt ist das **Web Browser SSO Profile, SP-initiiert**: QKERN baut eine
 * `AuthnRequest`, schickt den Browser mit dem HTTP-Redirect-Binding zum
 * Identitaetsanbieter, und der Anbieter bringt die Antwort mit dem
 * **HTTP-POST-Binding** an den Assertion Consumer Service zurueck. Was hier
 * hereinkommt, ist der base64-Text aus dem Formularfeld `SAMLResponse`; was
 * herausgeht, ist ein Urteil mit Grund.
 *
 * Kein Netzwerkzugriff, keine Ablage, keine Uhr aus dem Modul: Die Zeit kommt
 * als Parameter, der Riegel gegen Wiedereinreichung liegt beim Aufrufer in der
 * Datenbank. Ein Modul, das man ohne Stack ausrechnen kann, laesst sich auch
 * ohne Stack pruefen.
 *
 * ## Warum ohne fremde SAML-Bibliothek
 *
 * Dieselbe Linie wie GraphQL, WebAuthn und SigV4. Der schwierige Teil ist die
 * **XML-Signatur**: Kanonisierung, Digest, Signatur, und vor allem die Frage,
 * *welches* Element die Signatur eigentlich deckt. Genau dort scheitern
 * SAML-Umsetzungen, und genau dort hilft eine Bibliothek am wenigsten: Sie
 * prueft die Signatur und laesst die Anwendung danach ein anderes Element
 * lesen. Diese Datei loest beides an einer Stelle — sie gibt die Ansprueche
 * **aus dem Element zurueck, das die Signatur gedeckt hat**, und nicht aus dem
 * Dokument.
 *
 * ## Welche XML-Formen geprueft werden
 *
 * Der Leser in `saml-xml.ts` nennt seine Teilmenge vollstaendig. Dazu kommen
 * hier die Algorithmen, und auch die sind eine abgeschlossene Liste:
 *
 * - Kanonisierung: **nur** `http://www.w3.org/2001/10/xml-exc-c14n#`
 *   (exklusiv, ohne Kommentare), mit `InclusiveNamespaces PrefixList`.
 *   Abgelehnt werden `xml-c14n` 1.0 und 1.1, jede Variante mit Kommentaren und
 *   jede XPath-Transformation.
 * - Transformationen: **genau zwei**, in dieser Reihenfolge —
 *   `…xmldsig#enveloped-signature`, dann `…xml-exc-c14n#`.
 * - Digest: **nur** `…xmlenc#sha256`.
 * - Signatur: **nur** `…xmldsig-more#rsa-sha256` und `…xmldsig-more#ecdsa-sha256`.
 * - Referenz: **genau eine**, als `#<ID>` auf ein Element desselben Dokuments.
 * - Verschluesselte Assertions (`EncryptedAssertion`, `EncryptedID`,
 *   `EncryptedAttribute`) werden **abgelehnt**. Dieses Produkt hat keinen
 *   Entschluesselungsweg, und eine Antwort, die es nicht lesen kann, gilt nicht
 *   als geprueft.
 *
 * Eine Antwort in einer Form, die hier nicht steht, wird abgewiesen. Sie wird
 * nicht bestmoeglich gelesen.
 */

export const SAML_NS = {
  assertion: "urn:oasis:names:tc:SAML:2.0:assertion",
  protocol: "urn:oasis:names:tc:SAML:2.0:protocol",
  signature: "http://www.w3.org/2000/09/xmldsig#",
} as const;

const ALGORITHMS = {
  c14nExclusive: "http://www.w3.org/2001/10/xml-exc-c14n#",
  envelopedSignature: "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
  digestSha256: "http://www.w3.org/2001/04/xmlenc#sha256",
  rsaSha256: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
  ecdsaSha256: "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256",
} as const;

const STATUS_SUCCESS = "urn:oasis:names:tc:SAML:2.0:status:Success";
const BEARER = "urn:oasis:names:tc:SAML:2.0:cm:bearer";
const NAMEID_EMAIL = "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress";

/** Die Form einer Kennung, die QKERN selbst vergibt: `xsd:ID`-faehig. */
export const SAML_REQUEST_ID = /^_[0-9a-f]{40}$/;

/**
 * Wieviel Uhrabweichung zwischen QKERN und dem Anbieter geduldet wird.
 *
 * 60 Sekunden, in beide Richtungen, und diese Zahl steht hier und nicht in
 * einer Umgebungsvariablen: Ein Betreiber, der sein Zeitfenster aufzieht, um
 * einen Anbieter mit falscher Uhr zum Laufen zu bringen, zieht die
 * Gueltigkeitsdauer jeder Assertion mit auf.
 */
export const SAML_CLOCK_SKEW_MS = 60_000;

export type ProjectAuthSamlProvider = {
  id: string;
  /** Die `entityID` des Anbieters. Genau der Wert, der im `Issuer` stehen muss. */
  entityId: string;
  /** Der SSO-Endpunkt fuer das HTTP-Redirect-Binding. Exaktes HTTPS. */
  singleSignOnUrl: string;
  /**
   * Das hinterlegte Zertifikat des Anbieters, PEM. Gegen **dieses** Zertifikat
   * wird geprueft, nie gegen ein Zertifikat aus dem `KeyInfo` der Antwort. Ein
   * `KeyInfo`, das ein anderes Zertifikat nennt, ist eine Abweisung und kein
   * Hinweis.
   */
  certificate: string;
  /**
   * Wie bei OIDC seit 1.85: "required" (Voreinstellung) verlangt ein
   * Attribut `email_verified` mit `true`. "trusted" laesst ein **fehlendes**
   * Attribut zu, weil der Betreiber fuer den Anbieter buergt. Ein
   * ausdrueckliches `false` ist in jedem Modus eine Abweisung.
   */
  emailVerification?: "required" | "trusted";
  /** Name des Attributs mit der Adresse. Voreinstellung `email`. */
  emailAttribute?: string;
  /** Name des Attributs mit dem Ja zur Adresse. Voreinstellung `email_verified`. */
  emailVerifiedAttribute?: string;
  /**
   * Ob QKERN die `AuthnRequest` fuer diesen Anbieter unterschreibt.
   * Voreinstellung **aus**, und der Schalter steht je Anbieter: Ein Anbieter,
   * der eine unsignierte Anfrage erwartet, weist eine signierte ab, und
   * umgekehrt. Eingeschaltet ohne hinterlegten eigenen Schluessel ist ein
   * Konfigurationsfehler und keine stillschweigend unsignierte Anfrage.
   */
  signAuthnRequest?: boolean;
};

export class ProjectAuthSamlError extends Error {
  constructor() {
    super("PROJECT_AUTH_SAML_ERROR");
    this.name = "ProjectAuthSamlError";
  }
}
recognisedByName(ProjectAuthSamlError, "ProjectAuthSamlError");

/** Die Signaturverfahren, mit denen QKERN als SP unterschreiben kann. */
const SIG_ALG = {
  rsaSha256: ALGORITHMS.rsaSha256,
  ecdsaSha256: ALGORITHMS.ecdsaSha256,
} as const;

/**
 * Der eigene Schluessel, mit dem QKERN als Service Provider unterschreibt.
 *
 * ## Warum Zertifikat **und** Schluessel, und warum beide zusammen geprueft werden
 *
 * Die Metadaten nennen das Zertifikat, die `AuthnRequest` traegt die Signatur
 * des Schluessels, und der Anbieter prueft die eine mit dem anderen. Passen sie
 * nicht zueinander, laeuft alles durch: QKERN baut eine tadellose Signatur, die
 * Metadaten sehen tadellos aus, und jede Anfrage scheitert erst beim Anbieter,
 * mit einer Meldung, die QKERN nie sieht. Darum prueft dieser Konstruktor mit
 * `checkPrivateKey`, dass der Schluessel zu genau diesem Zertifikat gehoert,
 * und weist ein Paar ab, das das nicht tut.
 *
 * ## Warum keine Kette
 *
 * Dasselbe wie beim Zertifikat des Anbieters: Es gibt genau ein Zertifikat, es
 * steht in der Konfiguration, und es steht in den Metadaten. Eine Kette waere
 * eine Behauptung ueber eine Pruefung, die hier niemand macht.
 */
export class ProjectAuthSamlSigningKey {
  /** Das DER des Zertifikats als base64, wie es in die Metadaten gehoert. */
  readonly certificateBase64: string;
  /** Die `SigAlg`-URI, die zu diesem Schluesseltyp gehoert. */
  readonly signatureAlgorithm: string;
  private readonly certificate: X509Certificate;
  private readonly privateKey: KeyObject;

  constructor(input: { certificate: string; privateKey: string }) {
    if (typeof input?.certificate !== "string" || typeof input?.privateKey !== "string" ||
        !input.certificate.includes("-----BEGIN CERTIFICATE-----") ||
        input.certificate.length > 16_384 || input.privateKey.length > 16_384) {
      throw new ProjectAuthSamlError();
    }
    try {
      this.certificate = new X509Certificate(input.certificate);
      this.privateKey = createPrivateKey(input.privateKey);
    } catch {
      throw new ProjectAuthSamlError();
    }
    // Der Riegel gegen ein Paar, das nicht zusammengehoert. Ohne ihn nennen die
    // Metadaten ein anderes Zertifikat als das, mit dem geprueft wird.
    if (!this.certificate.checkPrivateKey(this.privateKey)) throw new ProjectAuthSamlError();
    // Dieselbe abgeschlossene Liste wie bei der Pruefung einer Antwort. Eine
    // EC-Kurve ausser P-256 waere `ecdsa-sha256` nur dem Namen nach.
    if (this.privateKey.asymmetricKeyType === "rsa") {
      this.signatureAlgorithm = SIG_ALG.rsaSha256;
    } else if (this.privateKey.asymmetricKeyType === "ec" &&
               this.privateKey.asymmetricKeyDetails?.namedCurve === "prime256v1") {
      this.signatureAlgorithm = SIG_ALG.ecdsaSha256;
    } else {
      throw new ProjectAuthSamlError();
    }
    this.certificateBase64 = this.certificate.raw.toString("base64");
  }

  /**
   * Prueft, ob dieser Schluessel jetzt benutzt werden darf.
   *
   * Ein abgelaufenes eigenes Zertifikat ist derselbe Fall wie ein abgelaufenes
   * des Anbieters: Die Signatur waere rechnerisch richtig und beim Anbieter
   * trotzdem wertlos. Es faellt hier auf und nicht dort.
   */
  assertUsable(now: Date): void {
    const validFrom = Date.parse(this.certificate.validFrom);
    const validTo = Date.parse(this.certificate.validTo);
    if (!Number.isFinite(validFrom) || !Number.isFinite(validTo) ||
        now.getTime() + SAML_CLOCK_SKEW_MS < validFrom || now.getTime() > validTo) {
      throw new ProjectAuthSamlError();
    }
  }

  /** Der Signaturwert ueber genau diesen Bytes. */
  sign(data: Buffer): Buffer {
    return this.signatureAlgorithm === SIG_ALG.ecdsaSha256
      ? createSignature("sha256", data, { key: this.privateKey, dsaEncoding: "ieee-p1363" })
      : createSignature("sha256", data, this.privateKey);
  }
}

/**
 * Der eigene Schluessel aus der Prozessumgebung, oder `null`.
 *
 * Beide Haelften oder keine. Ein hinterlegtes Zertifikat ohne Schluessel waere
 * ein Zertifikat, das in den Metadaten steht und mit dem niemand
 * unterschreiben kann; ein Schluessel ohne Zertifikat waere eine Signatur, die
 * niemand pruefen kann. Beides faellt beim Start auf.
 */
export function projectAuthSamlSigningKeyFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProjectAuthSamlSigningKey | null {
  const certificate = env.QKERN_PROJECT_AUTH_SAML_SP_CERTIFICATE_PEM?.trim();
  const privateKey = env.QKERN_PROJECT_AUTH_SAML_SP_PRIVATE_KEY_PEM?.trim();
  if (!certificate && !privateKey) return null;
  if (!certificate || !privateKey) throw new ProjectAuthSamlError();
  return new ProjectAuthSamlSigningKey({ certificate, privateKey });
}

/**
 * Warum eine Antwort abgelehnt wurde. Jeder Grund steht fuer genau eine
 * Pruefung, die wirklich laeuft.
 */
export type SamlRefusal =
  | "malformed_response"
  | "unsupported_xml_form"
  | "unsupported_algorithm"
  | "encrypted_assertion"
  | "assertion_not_unique"
  | "status_not_success"
  | "issuer_mismatch"
  | "destination_mismatch"
  | "in_response_to_mismatch"
  | "recipient_mismatch"
  | "audience_mismatch"
  | "signature_missing"
  | "signature_scope_mismatch"
  | "digest_mismatch"
  | "signature_invalid"
  | "certificate_mismatch"
  | "certificate_not_valid"
  | "condition_not_yet_valid"
  | "condition_expired"
  | "subject_confirmation_expired"
  | "email_missing"
  | "email_not_verified";

export type SamlIdentity = {
  /** Die `ID` der Assertion. Der Riegel gegen Wiedereinreichung haengt daran. */
  assertionId: string;
  /** Der `NameID` der Assertion. Die Identitaet des Anbieters, nie die Adresse. */
  subject: string;
  email: string;
  emailVerified: true;
  name?: string;
  sessionIndex?: string;
  /** Bis wann die Assertion gilt. Der Aufrufer legt den Riegel so lange. */
  notOnOrAfter: Date;
};

export type SamlVerdict =
  | { ok: true; value: SamlIdentity }
  | { ok: false; reason: SamlRefusal; detail?: string };

export class ProjectAuthSamlCatalog {
  private readonly providers = new Map<string, ProjectAuthSamlProvider>();

  constructor(providers: ProjectAuthSamlProvider[]) {
    if (providers.length > 10) throw new ProjectAuthSamlError();
    for (const provider of providers) {
      validateProvider(provider);
      if (this.providers.has(provider.id)) throw new ProjectAuthSamlError();
      this.providers.set(provider.id, { ...provider });
    }
  }

  get(id: string): ProjectAuthSamlProvider | null {
    const provider = this.providers.get(id);
    return provider ? { ...provider } : null;
  }

  list(): string[] { return [...this.providers.keys()].sort(); }
}

export function projectAuthSamlCatalogFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProjectAuthSamlCatalog {
  const raw = env.QKERN_PROJECT_AUTH_SAML_PROVIDERS_JSON?.trim();
  if (!raw) return new ProjectAuthSamlCatalog([]);
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error("invalid");
    return new ProjectAuthSamlCatalog(parsed as ProjectAuthSamlProvider[]);
  } catch {
    throw new ProjectAuthSamlError();
  }
}

/** Eine neue Kennung fuer eine `AuthnRequest`. `xsd:ID` faengt nie mit einer Ziffer an. */
export function newSamlRequestId(): string {
  return `_${randomBytes(20).toString("hex")}`;
}

/**
 * Baut die `AuthnRequest` und die Adresse des HTTP-Redirect-Bindings.
 *
 * ## Wann unterschrieben wird, und mit was
 *
 * Voreingestellt gar nicht. Eine signierte Anfrage schuetzt den Anbieter davor,
 * dass jemand in QKERNs Namen Anmeldungen anstoesst; sie schuetzt QKERN nicht.
 * Was QKERN schuetzt, ist die Bindung der Antwort an die eigene Anfrage
 * (`InResponseTo`), und die haengt an der Kennung und an keiner Signatur. Ein
 * Anbieter, der eine signierte Anfrage **verlangt**, bekommt sie ueber
 * `signAuthnRequest` je Anbieter, und dann muss ein eigener Schluessel
 * hinterlegt sein.
 *
 * ## Warum die Signatur in der Adresse steht und nicht im XML
 *
 * Weil das Binding sie dort verlangt. Das HTTP-Redirect-Binding unterschreibt
 * die Abfragezeichenkette (`SAMLBind`, 3.4.4.1): den Text
 * `SAMLRequest=…&RelayState=…&SigAlg=…` in genau dieser Reihenfolge, genau so
 * kodiert, wie er dann in der Adresse steht. Ein eingebettetes `ds:Signature`
 * im `AuthnRequest` waere eine Form, die kein Anbieter pruefen muss: Das XML
 * verschwindet beim Redirect-Binding in DEFLATE und base64, und der Anbieter
 * sieht die Abfragezeichenkette. QKERN hat die exklusive Kanonisierung fuer
 * genau solche eingebetteten Signaturen, und sie bleibt hier ungenutzt, weil
 * sie hier die falsche Antwort waere.
 *
 * Deshalb wird die Abfragezeichenkette hier von Hand gebaut. Der unterschriebene
 * Text und der Text in der Adresse muessen Zeichen fuer Zeichen derselbe sein;
 * zwei Stellen, die beide kodieren, waeren zwei Stellen, an denen sie
 * auseinanderlaufen koennen.
 */
export function createSamlAuthnRequest(provider: ProjectAuthSamlProvider, input: {
  requestId: string;
  acsUrl: string;
  spEntityId: string;
  relayState: string;
  issueInstant: Date;
  /** Der eigene Schluessel. Pflicht, wenn der Anbieter eine Signatur verlangt. */
  signingKey?: ProjectAuthSamlSigningKey | null;
}): { url: string; request: string; signed: boolean } {
  validateProvider(provider);
  if (!SAML_REQUEST_ID.test(input.requestId)) throw new ProjectAuthSamlError();
  if (input.relayState.length < 1 || input.relayState.length > 80) throw new ProjectAuthSamlError();
  assertEntityId(input.spEntityId);
  const acs = exactCallbackUrl(input.acsUrl);
  const request = `<samlp:AuthnRequest xmlns:samlp="${SAML_NS.protocol}"` +
    ` ID="${xmlAttributeText(input.requestId)}" Version="2.0"` +
    ` IssueInstant="${instant(input.issueInstant)}"` +
    ` Destination="${xmlAttributeText(provider.singleSignOnUrl)}"` +
    ` ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"` +
    ` AssertionConsumerServiceURL="${xmlAttributeText(acs)}">` +
    `<saml:Issuer xmlns:saml="${SAML_NS.assertion}">${xmlAttributeText(input.spEntityId)}</saml:Issuer>` +
    `<samlp:NameIDPolicy Format="${NAMEID_EMAIL}" AllowCreate="true"/>` +
    `</samlp:AuthnRequest>`;
  const deflated = deflateRawSync(Buffer.from(request, "utf8")).toString("base64");
  const query = `SAMLRequest=${encodeURIComponent(deflated)}` +
    `&RelayState=${encodeURIComponent(input.relayState)}`;
  const url = new URL(provider.singleSignOnUrl);
  if (!provider.signAuthnRequest) {
    url.search = query;
    return { url: url.toString(), request, signed: false };
  }
  // Eingeschaltet ohne Schluessel ist ein Fehlschlag und keine Anfrage, die
  // stillschweigend unsigniert hinausgeht: Der Anbieter wuerde sie abweisen,
  // und der Betreiber suchte die Ursache bei ihm.
  const key = input.signingKey;
  if (!key) throw new ProjectAuthSamlError();
  key.assertUsable(input.issueInstant);
  const signedQuery = `${query}&SigAlg=${encodeURIComponent(key.signatureAlgorithm)}`;
  const signature = key.sign(Buffer.from(signedQuery, "utf8")).toString("base64");
  url.search = `${signedQuery}&Signature=${encodeURIComponent(signature)}`;
  return { url: url.toString(), request, signed: true };
}

/** Der Namensraum der SAML-Metadaten. */
export const SAML_METADATA_NS = "urn:oasis:names:tc:SAML:2.0:metadata";
const BINDING_POST = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST";

/**
 * Die Metadaten dieser Projektumgebung fuer genau einen Anbieter.
 *
 * Ein `EntityDescriptor` mit einem `SPSSODescriptor`, und darin genau das, was
 * ein Anbieter braucht, um QKERN einzutragen, ohne dass ein Mensch Felder
 * abtippt: die `entityID` der Umgebung, die Consumer-Adresse dieses Anbieters
 * mit dem HTTP-POST-Binding, und das eigene Zertifikat, falls eines hinterlegt
 * ist.
 *
 * ## Warum je Anbieter und nicht je Umgebung
 *
 * Die `entityID` gilt je Projektumgebung, die Consumer-Adresse traegt den Slug
 * des Anbieters. Ein Dokument fuer die ganze Umgebung muesste darum zehn
 * `AssertionConsumerService`-Eintraege aufzaehlen, und jeder Anbieter muesste
 * sich den seinen heraussuchen. Ein Dokument je Anbieter nennt genau einen.
 *
 * ## Was das Zertifikat hier ist
 *
 * Das **eigene** Zertifikat von QKERN, mit dem eine `AuthnRequest`
 * unterschrieben wird, und nicht das hinterlegte des Anbieters. Es ist dasselbe
 * Zertifikat, das zum Schluessel dieser Signatur gehoert; dafuer sorgt
 * `ProjectAuthSamlSigningKey`, und deshalb kann hier nichts anderes stehen.
 * Ohne hinterlegten Schluessel gibt es keinen `KeyDescriptor`, und
 * `AuthnRequestsSigned` steht auf `false`.
 *
 * `WantAssertionsSigned` steht immer auf `true`, weil es keine Einstellung ist:
 * `verifySamlResponse` weist eine Assertion ohne eigene Signatur in jedem Fall
 * ab, auch wenn die Antworthuelle eine traegt.
 */
export function samlServiceProviderMetadata(input: {
  spEntityId: string;
  acsUrl: string;
  signAuthnRequest: boolean;
  signingKey?: ProjectAuthSamlSigningKey | null;
  now: Date;
}): string {
  assertEntityId(input.spEntityId);
  const acs = exactCallbackUrl(input.acsUrl);
  const key = input.signAuthnRequest ? input.signingKey ?? null : null;
  if (input.signAuthnRequest && !key) throw new ProjectAuthSamlError();
  if (key) key.assertUsable(input.now);
  const keyDescriptor = key
    ? `<md:KeyDescriptor use="signing">` +
      `<ds:KeyInfo xmlns:ds="${SAML_NS.signature}"><ds:X509Data>` +
      `<ds:X509Certificate>${key.certificateBase64}</ds:X509Certificate>` +
      `</ds:X509Data></ds:KeyInfo></md:KeyDescriptor>`
    : "";
  // Die Reihenfolge der Kinder ist die des Schemas: KeyDescriptor,
  // NameIDFormat, AssertionConsumerService. Ein Anbieter, der gegen das Schema
  // prueft, weist eine andere Reihenfolge ab.
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<md:EntityDescriptor xmlns:md="${SAML_METADATA_NS}"` +
    ` entityID="${xmlAttributeText(input.spEntityId)}">` +
    `<md:SPSSODescriptor AuthnRequestsSigned="${key ? "true" : "false"}"` +
    ` WantAssertionsSigned="true"` +
    ` protocolSupportEnumeration="${SAML_NS.protocol}">` +
    keyDescriptor +
    `<md:NameIDFormat>${NAMEID_EMAIL}</md:NameIDFormat>` +
    `<md:AssertionConsumerService Binding="${BINDING_POST}"` +
    ` Location="${xmlAttributeText(acs)}" index="0" isDefault="true"/>` +
    `</md:SPSSODescriptor></md:EntityDescriptor>`;
}

/**
 * Prueft eine Antwort und gibt die Ansprueche **des gedeckten Elements**
 * zurueck.
 *
 * Die Reihenfolge ist Absicht. Zuerst die Form, dann die Eindeutigkeit der
 * Assertion, dann die Signatur, und erst danach alles, was in der Assertion
 * steht. So kann kein Wert aus einer Assertion gelesen werden, deren Signatur
 * noch nicht geprueft ist, und kein Grund verraet etwas ueber einen Inhalt,
 * den niemand unterschrieben hat.
 */
export function verifySamlResponse(provider: ProjectAuthSamlProvider, input: {
  response: string;
  requestId: string;
  acsUrl: string;
  spEntityId: string;
  now: Date;
}): SamlVerdict {
  validateProvider(provider);
  if (!SAML_REQUEST_ID.test(input.requestId)) return refuse("malformed_response", "request_id");
  const acs = exactCallbackUrl(input.acsUrl);
  assertEntityId(input.spEntityId);

  if (input.response.length > 4 * 1024 * 1024 || !/^[A-Za-z0-9+/=\s]+$/.test(input.response)) {
    return refuse("malformed_response", "not_base64");
  }
  const xml = Buffer.from(input.response.replace(/\s+/g, ""), "base64").toString("utf8");

  let certificate: X509Certificate;
  try { certificate = new X509Certificate(provider.certificate); }
  catch { return refuse("certificate_not_valid", "unreadable"); }
  const validFrom = Date.parse(certificate.validFrom);
  const validTo = Date.parse(certificate.validTo);
  if (!Number.isFinite(validFrom) || !Number.isFinite(validTo) ||
      input.now.getTime() + SAML_CLOCK_SKEW_MS < validFrom || input.now.getTime() > validTo) {
    return refuse("certificate_not_valid", "outside_validity");
  }

  let root: XmlElement;
  let ids: Map<string, XmlElement>;
  try {
    root = parseXml(xml);
    ids = collectIds(root);
  } catch (error) {
    return error instanceof XmlFormatError
      ? refuse("unsupported_xml_form", error.detail)
      : refuse("malformed_response", "unreadable");
  }

  if (root.namespaceUri !== SAML_NS.protocol || root.localName !== "Response") {
    return refuse("malformed_response", "not_a_response");
  }

  const all = walkElements(root);
  for (const encrypted of ["EncryptedAssertion", "EncryptedID", "EncryptedAttribute"]) {
    if (all.some((element) => element.namespaceUri === SAML_NS.assertion && element.localName === encrypted)) {
      return refuse("encrypted_assertion", encrypted);
    }
  }

  // Der Riegel gegen XML Signature Wrapping, und er sitzt vor allem anderen:
  // Das Dokument darf **genau eine** Assertion enthalten, irgendwo. Eine
  // zweite, unsignierte Assertion daneben — ob im Signature-Element, in einem
  // Extensions-Block oder als zweites Kind der Response — macht die Antwort
  // ungueltig, und nicht bloss die zweite Assertion.
  const assertions = all.filter((element) =>
    element.namespaceUri === SAML_NS.assertion && element.localName === "Assertion");
  if (assertions.length !== 1) return refuse("assertion_not_unique", String(assertions.length));
  const assertion = assertions[0];
  if (assertion.parent !== root) return refuse("assertion_not_unique", "not_a_direct_child");

  const responseId = attributeValue(root, "ID");
  const destination = attributeValue(root, "Destination");
  const inResponseTo = attributeValue(root, "InResponseTo");
  if (attributeValue(root, "Version") !== "2.0" || !responseId) return refuse("malformed_response", "response_header");
  if (destination !== acs) return refuse("destination_mismatch", destination ?? "absent");
  if (inResponseTo !== input.requestId) return refuse("in_response_to_mismatch", inResponseTo ?? "absent");

  const status = onlyChild(root, SAML_NS.protocol, "Status");
  const statusCode = status ? onlyChild(status, SAML_NS.protocol, "StatusCode") : null;
  if (!statusCode || attributeValue(statusCode, "Value") !== STATUS_SUCCESS) {
    return refuse("status_not_success", statusCode ? attributeValue(statusCode, "Value") ?? "absent" : "absent");
  }

  const responseIssuer = onlyChild(root, SAML_NS.assertion, "Issuer");
  if (responseIssuer && directText(responseIssuer).trim() !== provider.entityId) {
    return refuse("issuer_mismatch", "response");
  }

  // Eine Signatur ueber der Antworthuelle ist erlaubt und wird geprueft, aber
  // sie **ersetzt** die Signatur ueber der Assertion nicht. Genau das ist die
  // Falle: Wer nur die Huelle unterschreibt, hat die Assertion nicht gedeckt.
  const responseSignatures = childElements(root, SAML_NS.signature, "Signature");
  if (responseSignatures.length > 1) return refuse("signature_scope_mismatch", "two_response_signatures");
  if (responseSignatures.length === 1) {
    const checked = checkSignature(responseSignatures[0], root, responseId, certificate, ids);
    if (!checked.ok) return checked;
  }

  const assertionId = attributeValue(assertion, "ID");
  if (attributeValue(assertion, "Version") !== "2.0" || !assertionId || assertionId.length > 256) {
    return refuse("malformed_response", "assertion_header");
  }
  const assertionSignatures = childElements(assertion, SAML_NS.signature, "Signature");
  if (assertionSignatures.length !== 1) {
    return refuse("signature_missing", String(assertionSignatures.length));
  }
  const signed = checkSignature(assertionSignatures[0], assertion, assertionId, certificate, ids);
  if (!signed.ok) return signed;

  // Ab hier ist jeder gelesene Wert von der gepruefte Signatur gedeckt.
  const issuer = onlyChild(assertion, SAML_NS.assertion, "Issuer");
  if (!issuer || directText(issuer).trim() !== provider.entityId) return refuse("issuer_mismatch", "assertion");

  const subjectElement = onlyChild(assertion, SAML_NS.assertion, "Subject");
  const nameId = subjectElement ? onlyChild(subjectElement, SAML_NS.assertion, "NameID") : null;
  const subject = nameId ? directText(nameId).trim() : "";
  if (!subjectElement || !nameId || subject.length < 1 || subject.length > 512) {
    return refuse("malformed_response", "subject");
  }

  const confirmations = childElements(subjectElement, SAML_NS.assertion, "SubjectConfirmation")
    .filter((element) => attributeValue(element, "Method") === BEARER);
  if (confirmations.length !== 1) return refuse("malformed_response", "subject_confirmation");
  const data = onlyChild(confirmations[0], SAML_NS.assertion, "SubjectConfirmationData");
  if (!data) return refuse("malformed_response", "subject_confirmation_data");
  if (attributeValue(data, "Recipient") !== acs) {
    return refuse("recipient_mismatch", attributeValue(data, "Recipient") ?? "absent");
  }
  if (attributeValue(data, "InResponseTo") !== input.requestId) {
    return refuse("in_response_to_mismatch", "subject_confirmation");
  }
  const confirmationExpiry = parseInstant(attributeValue(data, "NotOnOrAfter"));
  if (!confirmationExpiry) return refuse("malformed_response", "subject_confirmation_expiry");
  if (confirmationExpiry.getTime() <= input.now.getTime() - SAML_CLOCK_SKEW_MS) {
    return refuse("subject_confirmation_expired");
  }

  const conditions = onlyChild(assertion, SAML_NS.assertion, "Conditions");
  if (!conditions) return refuse("malformed_response", "conditions");
  const notBefore = parseInstant(attributeValue(conditions, "NotBefore"));
  const notOnOrAfter = parseInstant(attributeValue(conditions, "NotOnOrAfter"));
  if (!notBefore || !notOnOrAfter) return refuse("malformed_response", "condition_window");
  if (notBefore.getTime() > input.now.getTime() + SAML_CLOCK_SKEW_MS) return refuse("condition_not_yet_valid");
  if (notOnOrAfter.getTime() <= input.now.getTime() - SAML_CLOCK_SKEW_MS) return refuse("condition_expired");
  if (notOnOrAfter.getTime() - notBefore.getTime() > 24 * 60 * 60 * 1_000) {
    return refuse("malformed_response", "condition_window_too_wide");
  }

  const restrictions = childElements(conditions, SAML_NS.assertion, "AudienceRestriction");
  const audiences = restrictions.flatMap((restriction) =>
    childElements(restriction, SAML_NS.assertion, "Audience").map((element) => directText(element).trim()));
  if (restrictions.length < 1 || !audiences.includes(input.spEntityId)) {
    return refuse("audience_mismatch", String(restrictions.length));
  }

  const authnStatements = childElements(assertion, SAML_NS.assertion, "AuthnStatement");
  if (authnStatements.length !== 1 || !parseInstant(attributeValue(authnStatements[0], "AuthnInstant"))) {
    return refuse("malformed_response", "authn_statement");
  }
  const sessionIndex = attributeValue(authnStatements[0], "SessionIndex");

  const attributes = readAttributes(assertion);
  const emailName = provider.emailAttribute ?? "email";
  const verifiedName = provider.emailVerifiedAttribute ?? "email_verified";
  const emailFromAttribute = attributes.get(emailName);
  const emailFromNameId = attributeValue(nameId, "Format") === NAMEID_EMAIL ? subject : undefined;
  const email = (emailFromAttribute ?? emailFromNameId ?? "").trim().toLowerCase();
  if (!email || email.length > 320 || !email.includes("@")) return refuse("email_missing");

  // Dieselbe Regel wie bei OIDC seit 1.85, Wort fuer Wort: Ein ausdrueckliches
  // "false" ist immer eine Abweisung, ein fehlendes Ja nur dann keine, wenn der
  // Betreiber fuer den Anbieter buergt.
  const verified = attributes.get(verifiedName);
  const trusted = provider.emailVerification === "trusted";
  if (verified !== undefined ? verified.trim().toLowerCase() !== "true" : !trusted) {
    return refuse("email_not_verified", verified === undefined ? "absent" : "false");
  }

  const displayName = attributes.get("name") ?? attributes.get("displayName");
  return {
    ok: true,
    value: {
      assertionId, subject, email, emailVerified: true,
      ...(displayName && displayName.length <= 200 ? { name: displayName } : {}),
      ...(sessionIndex && sessionIndex.length <= 256 ? { sessionIndex } : {}),
      notOnOrAfter,
    },
  };
}

/**
 * Prueft eine `ds:Signature` gegen genau das Element, das sie umhuellt.
 *
 * Die zwei Pruefungen, an denen die bekannten Umgehungen haengen, stehen hier
 * unmittelbar beieinander: Die Referenz muss auf die `ID` **dieses** Elements
 * zeigen, und die aufgeloeste `ID` muss **dieses** Element sein. Eine
 * Referenz, die woandershin zeigt, ist keine Signatur ueber diesem Element.
 */
function checkSignature(
  signature: XmlElement,
  covered: XmlElement,
  coveredId: string,
  certificate: X509Certificate,
  ids: ReadonlyMap<string, XmlElement>,
): { ok: true } | { ok: false; reason: SamlRefusal; detail?: string } {
  const signedInfo = onlyChild(signature, SAML_NS.signature, "SignedInfo");
  const signatureValue = onlyChild(signature, SAML_NS.signature, "SignatureValue");
  if (!signedInfo || !signatureValue) return refuse("malformed_response", "signature_shape");

  const c14nMethod = onlyChild(signedInfo, SAML_NS.signature, "CanonicalizationMethod");
  if (!c14nMethod || attributeValue(c14nMethod, "Algorithm") !== ALGORITHMS.c14nExclusive) {
    return refuse("unsupported_algorithm", "canonicalization");
  }
  const signatureMethod = onlyChild(signedInfo, SAML_NS.signature, "SignatureMethod");
  const signatureAlgorithm = signatureMethod ? attributeValue(signatureMethod, "Algorithm") : null;
  if (signatureAlgorithm !== ALGORITHMS.rsaSha256 && signatureAlgorithm !== ALGORITHMS.ecdsaSha256) {
    return refuse("unsupported_algorithm", signatureAlgorithm ?? "absent");
  }

  const references = childElements(signedInfo, SAML_NS.signature, "Reference");
  if (references.length !== 1) return refuse("signature_scope_mismatch", `references=${references.length}`);
  const reference = references[0];
  if (attributeValue(reference, "URI") !== `#${coveredId}`) {
    return refuse("signature_scope_mismatch", attributeValue(reference, "URI") ?? "absent");
  }
  if (ids.get(coveredId) !== covered) return refuse("signature_scope_mismatch", "id_resolves_elsewhere");

  const transformsElement = onlyChild(reference, SAML_NS.signature, "Transforms");
  const transforms = transformsElement ? childElements(transformsElement, SAML_NS.signature, "Transform") : [];
  if (transforms.length !== 2 ||
      attributeValue(transforms[0], "Algorithm") !== ALGORITHMS.envelopedSignature ||
      attributeValue(transforms[1], "Algorithm") !== ALGORITHMS.c14nExclusive) {
    return refuse("unsupported_algorithm", "transforms");
  }
  const digestMethod = onlyChild(reference, SAML_NS.signature, "DigestMethod");
  if (!digestMethod || attributeValue(digestMethod, "Algorithm") !== ALGORITHMS.digestSha256) {
    return refuse("unsupported_algorithm", "digest");
  }
  const digestValue = onlyChild(reference, SAML_NS.signature, "DigestValue");
  if (!digestValue) return refuse("malformed_response", "digest_value");

  const referencePrefixes = inclusivePrefixes(transforms[1]);
  const signedInfoPrefixes = inclusivePrefixes(c14nMethod);

  const digest = createHash("sha256")
    .update(canonicalizeExclusive(covered, { omit: signature, inclusivePrefixes: referencePrefixes }), "utf8")
    .digest();
  const claimed = base64Bytes(directText(digestValue));
  if (!claimed || claimed.length !== digest.length || !timingSafeEqual(claimed, digest)) {
    return refuse("digest_mismatch");
  }

  const bytes = base64Bytes(directText(signatureValue));
  if (!bytes || bytes.length < 32 || bytes.length > 1024) return refuse("malformed_response", "signature_value");
  const data = Buffer.from(canonicalizeExclusive(signedInfo, { inclusivePrefixes: signedInfoPrefixes }), "utf8");

  // Das hinterlegte Zertifikat entscheidet. Ein `KeyInfo` in der Antwort darf
  // dasselbe Zertifikat wiederholen und sonst nichts: Ein anderes Zertifikat
  // dort ist eine Abweisung, weil es eine Antwort ist, die ein anderer
  // Aussteller unterschrieben hat.
  const keyInfo = onlyChild(signature, SAML_NS.signature, "KeyInfo");
  if (keyInfo) {
    const presented = walkElements(keyInfo)
      .filter((element) => element.namespaceUri === SAML_NS.signature && element.localName === "X509Certificate");
    for (const element of presented) {
      const der = base64Bytes(directText(element));
      if (!der || der.length !== certificate.raw.length || !timingSafeEqual(der, certificate.raw)) {
        return refuse("certificate_mismatch");
      }
    }
  }

  let valid = false;
  try {
    valid = signatureAlgorithm === ALGORITHMS.ecdsaSha256
      ? verifySignature("sha256", data, { key: certificate.publicKey, dsaEncoding: "ieee-p1363" }, bytes)
      : verifySignature("sha256", data, certificate.publicKey, bytes);
  } catch { valid = false; }
  return valid ? { ok: true } : refuse("signature_invalid");
}

/** Die `PrefixList` einer Transformation, oder eine leere Liste. */
function inclusivePrefixes(element: XmlElement): string[] {
  const inclusive = element.children.find((child): child is XmlElement =>
    child.kind === "element" && child.localName === "InclusiveNamespaces" &&
    child.namespaceUri === ALGORITHMS.c14nExclusive);
  const list = inclusive ? attributeValue(inclusive, "PrefixList") ?? "" : "";
  return list.split(/\s+/).filter(Boolean).slice(0, 32);
}

/**
 * Die Attribute der Assertion als Name auf Wert.
 *
 * Ein Attribut mit mehreren Werten faellt auf den ersten zusammen, und ein
 * zweimal gelieferter Name gewinnt nicht: Er wird verworfen. Ein Anbieter, der
 * `email` zweimal schickt, hat zwei Aussagen ueber dieselbe Person gemacht, und
 * QKERN waehlt zwischen ihnen nicht aus.
 */
function readAttributes(assertion: XmlElement): Map<string, string> {
  const values = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const statement of childElements(assertion, SAML_NS.assertion, "AttributeStatement")) {
    for (const attribute of childElements(statement, SAML_NS.assertion, "Attribute")) {
      const name = attributeValue(attribute, "Name");
      if (!name || name.length > 256) continue;
      if (values.has(name)) { duplicates.add(name); continue; }
      const first = childElements(attribute, SAML_NS.assertion, "AttributeValue")[0];
      if (!first) continue;
      const text = directText(first).trim();
      if (text.length > 1024) continue;
      values.set(name, text);
    }
  }
  for (const name of duplicates) values.delete(name);
  return values;
}

function base64Bytes(value: string): Buffer | null {
  const trimmed = value.replace(/\s+/g, "");
  if (!trimmed || trimmed.length > 200_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return null;
  return Buffer.from(trimmed, "base64");
}

/**
 * `xsd:dateTime` in UTC, so wie SAML es verlangt. Eine Zeitangabe mit
 * Zonenversatz wird abgelehnt und nicht umgerechnet: Zwei Schreibweisen fuer
 * denselben Zeitpunkt sind zwei Stellen, an denen sich ein Fehler versteckt.
 */
function parseInstant(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function instant(value: Date): string {
  return `${value.toISOString().slice(0, 19)}Z`;
}

function refuse(reason: SamlRefusal, detail?: string): { ok: false; reason: SamlRefusal; detail?: string } {
  return { ok: false, reason, ...(detail ? { detail } : {}) };
}

function validateProvider(provider: ProjectAuthSamlProvider): void {
  if (!provider || !/^[a-z][a-z0-9_-]{0,62}$/.test(provider.id) ||
      typeof provider.certificate !== "string" ||
      !provider.certificate.includes("-----BEGIN CERTIFICATE-----") ||
      provider.certificate.length > 16_384 ||
      (provider.emailVerification !== undefined &&
        !["required", "trusted"].includes(provider.emailVerification)) ||
      (provider.emailAttribute !== undefined && !/^[\x21-\x7E]{1,256}$/.test(provider.emailAttribute)) ||
      (provider.emailVerifiedAttribute !== undefined &&
        !/^[\x21-\x7E]{1,256}$/.test(provider.emailVerifiedAttribute)) ||
      (provider.signAuthnRequest !== undefined &&
        typeof provider.signAuthnRequest !== "boolean")) {
    throw new ProjectAuthSamlError();
  }
  assertEntityId(provider.entityId);
  exactHttpsUrl(provider.singleSignOnUrl);
}

/**
 * Eine `entityID` ist ein URI und keine Adresse, die jemand abruft. Geprueft
 * wird darum die Form und die Laenge, nicht das Schema.
 */
function assertEntityId(value: string): void {
  if (typeof value !== "string" || value.length < 8 || value.length > 1024 ||
      /[\s<>"']/.test(value) || !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
    throw new ProjectAuthSamlError();
  }
}

function exactHttpsUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash ||
        url.hostname === "localhost" || url.hostname.endsWith(".localhost") || isIP(url.hostname)) {
      throw new Error("invalid");
    }
    return url.toString();
  } catch {
    throw new ProjectAuthSamlError();
  }
}

/**
 * Der Assertion Consumer Service liegt bei QKERN, nicht beim Anbieter. Er
 * darf darum in der Entwicklung auf `localhost` liegen, genau wie der
 * OIDC-Callback, und in Produktion nie.
 */
function exactCallbackUrl(value: string): string {
  try {
    const url = new URL(value);
    const localHttp = process.env.NODE_ENV !== "production" && url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !localHttp) || url.username || url.password ||
        url.hash || url.search) throw new Error("invalid");
    return url.toString();
  } catch {
    throw new ProjectAuthSamlError();
  }
}
