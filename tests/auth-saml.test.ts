import { describe, expect, it } from "vitest";
import {
  createSamlAuthnRequest, newSamlRequestId, ProjectAuthSamlCatalog, ProjectAuthSamlError,
  verifySamlResponse, type ProjectAuthSamlProvider,
} from "@/lib/server/project-auth/saml";
import {
  canonicalizeExclusive, collectIds, parseXml, XmlFormatError,
} from "@/lib/server/project-auth/saml-xml";
import { samlResponse, samlResponseXml, TestSamlIdp } from "@/tests/support/saml-idp";
import { inflateRawSync } from "node:zlib";

/**
 * SAML 2.0 als reines Modul (2.99).
 *
 * Diese Faelle laufen ohne Stack. Sie pruefen den Leser, die exklusive
 * Kanonisierung und jede einzelne Abweisung. Der Nachweis gegen einen
 * Anbieter, der wirklich unterschreibt, und gegen die echte Route steht im
 * Auth-Zertifizierungslauf; hier stehen die Formen, fuer die es keinen Stack
 * braucht.
 */

const ACS = "http://localhost:3000/api/v1/projects/p/environments/development/auth/saml/idp/acs";
const SP = "http://localhost:3000/api/v1/projects/p/environments/development/auth/saml";

function providerFor(idp: TestSamlIdp, extra: Partial<ProjectAuthSamlProvider> = {}): ProjectAuthSamlProvider {
  return {
    id: "idp", entityId: idp.entityId, singleSignOnUrl: "https://idp.qkern.test/sso",
    certificate: idp.certificatePem, ...extra,
  };
}

describe("exclusive canonicalisation", () => {
  it("renders only the namespaces an element visibly uses", () => {
    // `unused` wird von nichts benutzt und darf darum nicht in der
    // kanonischen Form stehen. Genau das ist der Unterschied zwischen
    // exklusiver und der Kanonisierung 1.0, und genau daran haengt, ob eine
    // Assertion ihre Signatur behaelt, wenn sie in eine andere Huelle wandert.
    const source = '<a:root xmlns:a="urn:a" xmlns:unused="urn:u"><a:child b="2" a="1"/></a:root>';
    expect(canonicalizeExclusive(parseXml(source)))
      .toBe('<a:root xmlns:a="urn:a"><a:child a="1" b="2"></a:child></a:root>');
  });

  it("sorts attributes by namespace and local name and escapes as the specification says", () => {
    const source = '<r xmlns:z="urn:z" z:b="1" a="&lt;&amp;&quot;" xml:lang="de">te&gt;xt</r>';
    expect(canonicalizeExclusive(parseXml(source)))
      .toBe('<r xmlns:z="urn:z" a="&lt;&amp;&quot;" xml:lang="de" z:b="1">te&gt;xt</r>');
  });

  it("leaves a subtree independent of the namespaces of its new parent", () => {
    const inner = '<a:leaf xmlns:a="urn:a">x</a:leaf>';
    const nested = parseXml(`<outer xmlns="urn:o" xmlns:other="urn:x">${inner}</outer>`);
    const moved = nested.children.find((child) => child.kind === "element");
    expect(moved && moved.kind === "element" ? canonicalizeExclusive(moved) : "")
      .toBe(canonicalizeExclusive(parseXml(inner)));
  });

  it("refuses every form the reader does not cover", () => {
    const refused: Array<[string, string]> = [
      ["<r><!-- hi --></r>", "comment"],
      ["<!DOCTYPE r><r/>", "doctype_or_declaration"],
      ["<r><![CDATA[x]]></r>", "cdata"],
      ["<r><?work here?></r>", "processing_instruction"],
      ["<r>&nbsp;</r>", "named_entity"],
      ['<r a:b="1"/>', "undeclared_namespace_prefix"],
      ["<r></other>", "mismatched_end_tag"],
      ["<r>", "unclosed_element"],
      ['<r a="1" a="2"/>', "duplicate_attribute"],
    ];
    for (const [source, detail] of refused) {
      let caught: unknown;
      try { parseXml(source); } catch (error) { caught = error; }
      expect(caught, source).toBeInstanceOf(XmlFormatError);
      expect((caught as XmlFormatError).detail, source).toBe(detail);
    }
  });

  it("refuses a document that hands the same ID to two elements", () => {
    const twice = parseXml('<r ID="x"><c ID="x"/></r>');
    expect(() => collectIds(twice)).toThrow(XmlFormatError);
  });
});

describe("SAML AuthnRequest", () => {
  it("deflates an SP-initiated request that names its own consumer service", () => {
    const idp = new TestSamlIdp();
    const requestId = newSamlRequestId();
    const built = createSamlAuthnRequest(providerFor(idp), {
      requestId, acsUrl: ACS, spEntityId: SP, relayState: requestId, issueInstant: new Date(),
    });
    const url = new URL(built.url);
    expect(url.origin + url.pathname).toBe("https://idp.qkern.test/sso");
    expect(url.searchParams.get("RelayState")).toBe(requestId);
    const inflated = inflateRawSync(Buffer.from(url.searchParams.get("SAMLRequest") ?? "", "base64")).toString("utf8");
    expect(inflated).toBe(built.request);
    expect(inflated).toContain(`AssertionConsumerServiceURL="${ACS}"`);
    expect(inflated).toContain("ProtocolBinding=\"urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST\"");
    expect(inflated).toContain(`<saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${SP}</saml:Issuer>`);
  });

  it("refuses a provider whose endpoint is not exact HTTPS and a catalogue with two of the same slug", () => {
    const idp = new TestSamlIdp();
    expect(() => new ProjectAuthSamlCatalog([providerFor(idp, { singleSignOnUrl: "http://idp.qkern.test/sso" })]))
      .toThrow(ProjectAuthSamlError);
    expect(() => new ProjectAuthSamlCatalog([providerFor(idp, { singleSignOnUrl: "https://localhost/sso" })]))
      .toThrow(ProjectAuthSamlError);
    expect(() => new ProjectAuthSamlCatalog([providerFor(idp), providerFor(idp)]))
      .toThrow(ProjectAuthSamlError);
    expect(() => new ProjectAuthSamlCatalog([providerFor(idp, { certificate: "not a certificate" })]))
      .toThrow(ProjectAuthSamlError);
    expect(new ProjectAuthSamlCatalog([providerFor(idp)]).list()).toEqual(["idp"]);
  });
});

describe("SAML response verification", () => {
  const idp = new TestSamlIdp();
  const requestId = newSamlRequestId();
  const now = new Date();
  const base = { idp, acsUrl: ACS, spEntityId: SP, requestId, email: "person@qkern.test", now } as const;
  const check = (
    response: string,
    provider: ProjectAuthSamlProvider = providerFor(idp),
    at: Date = now,
    request = requestId,
  ) => verifySamlResponse(provider, { response, requestId: request, acsUrl: ACS, spEntityId: SP, now: at });

  it("accepts a signed assertion and reads the claims the signature covers", () => {
    const verdict = check(samlResponse({ ...base }));
    if (!verdict.ok) throw new Error(`${verdict.reason}:${verdict.detail ?? ""}`);
    expect(verdict.value).toMatchObject({
      email: "person@qkern.test", subject: "person@qkern.test", emailVerified: true, name: "SAML Person",
    });
    expect(verdict.value.assertionId).toMatch(/^_a[0-9a-f]{32}$/);
  });

  it("accepts a response that is signed twice: over the envelope and over the assertion", () => {
    expect(check(samlResponse({ ...base, signResponse: true })).ok).toBe(true);
  });

  it("refuses an assertion without a signature, even when the envelope carries one", () => {
    expect(check(samlResponse({ ...base, signAssertion: false })))
      .toMatchObject({ ok: false, reason: "signature_missing" });
    expect(check(samlResponse({ ...base, signAssertion: false, signResponse: true })))
      .toMatchObject({ ok: false, reason: "signature_missing" });
  });

  it("refuses a second, unsigned assertion next to the signed one", () => {
    expect(check(samlResponse({ ...base, wrapWith: { email: "attacker@qkern.test" } })))
      .toMatchObject({ ok: false, reason: "assertion_not_unique" });
  });

  it("refuses a signature made with a key the provider did not register", () => {
    const other = new TestSamlIdp({ entityId: idp.entityId });
    // Mit Zertifikat im KeyInfo faellt es schon dort auf, ohne erst an der
    // Unterschrift. Beide Wege muessen abweisen, und zwar aus eigenem Grund.
    expect(check(samlResponse({ ...base, signWith: other })))
      .toMatchObject({ ok: false, reason: "certificate_mismatch" });
    expect(check(samlResponse({ ...base, signWith: other, keyInfo: false })))
      .toMatchObject({ ok: false, reason: "signature_invalid" });
  });

  it("refuses a changed assertion whose signature still verifies over the old bytes", () => {
    const original = samlResponseXml({ ...base });
    const tampered = original.replace("person@qkern.test</saml:AttributeValue>", "root@qkern.test</saml:AttributeValue>");
    expect(tampered).not.toBe(original);
    expect(check(Buffer.from(tampered, "utf8").toString("base64")))
      .toMatchObject({ ok: false, reason: "digest_mismatch" });
  });

  it("refuses a time window that has not opened and one that has closed", () => {
    const future = new Date(now.getTime() + 10 * 60 * 1_000);
    expect(check(samlResponse({ ...base, notBefore: future, notOnOrAfter: new Date(future.getTime() + 60_000) })))
      .toMatchObject({ ok: false, reason: "condition_not_yet_valid" });
    // Die zwei Zeitfenster der Assertion werden getrennt geprueft. Erst das
    // der Bestaetigung, dann das der Bedingungen — darum steht jeder Fall hier
    // mit dem anderen Fenster offen.
    const past = new Date(now.getTime() - 60 * 60 * 1_000);
    expect(check(samlResponse({
      ...base, notBefore: new Date(past.getTime() - 60_000), notOnOrAfter: past,
      confirmationNotOnOrAfter: new Date(now.getTime() + 5 * 60 * 1_000),
    }))).toMatchObject({ ok: false, reason: "condition_expired" });
    expect(check(samlResponse({ ...base, confirmationNotOnOrAfter: past })))
      .toMatchObject({ ok: false, reason: "subject_confirmation_expired" });
    // Dieselbe, gueltige Antwort zehn Minuten spaeter gelesen: abgelaufen.
    expect(check(samlResponse({ ...base }), providerFor(idp), new Date(now.getTime() + 10 * 60 * 1_000)))
      .toMatchObject({ ok: false, reason: "subject_confirmation_expired" });
  });

  it("refuses a destination, a recipient and an audience that point somewhere else", () => {
    expect(check(samlResponse({ ...base, destination: `${ACS}x` })))
      .toMatchObject({ ok: false, reason: "destination_mismatch" });
    expect(check(samlResponse({ ...base, recipient: "https://elsewhere.qkern.test/acs" })))
      .toMatchObject({ ok: false, reason: "recipient_mismatch" });
    expect(check(samlResponse({ ...base, audience: "https://someone-else.qkern.test" })))
      .toMatchObject({ ok: false, reason: "audience_mismatch" });
  });

  it("refuses a response that answers a different request, in the envelope and in the confirmation", () => {
    const other = newSamlRequestId();
    expect(check(samlResponse({ ...base, responseInResponseTo: other })))
      .toMatchObject({ ok: false, reason: "in_response_to_mismatch" });
    expect(check(samlResponse({ ...base, assertionInResponseTo: other })))
      .toMatchObject({ ok: false, reason: "in_response_to_mismatch" });
    expect(check(samlResponse({ ...base }), providerFor(idp), now, newSamlRequestId()))
      .toMatchObject({ ok: false, reason: "in_response_to_mismatch" });
  });

  it("refuses an issuer that is not the registered one", () => {
    expect(check(samlResponse({ ...base, issuer: "https://someone-else.qkern.test/metadata" })))
      .toMatchObject({ ok: false, reason: "issuer_mismatch" });
  });

  it("holds the email_verified rule of 1.85: missing only passes for a vouched provider, false never", () => {
    expect(check(samlResponse({ ...base, emailVerified: null })))
      .toMatchObject({ ok: false, reason: "email_not_verified", detail: "absent" });
    expect(check(samlResponse({ ...base, emailVerified: null }), providerFor(idp, { emailVerification: "trusted" })).ok)
      .toBe(true);
    expect(check(samlResponse({ ...base, emailVerified: "false" })))
      .toMatchObject({ ok: false, reason: "email_not_verified", detail: "false" });
    expect(check(samlResponse({ ...base, emailVerified: "false" }), providerFor(idp, { emailVerification: "trusted" })))
      .toMatchObject({ ok: false, reason: "email_not_verified", detail: "false" });
  });

  it("refuses an expired certificate and one that does not parse", () => {
    const expired = new TestSamlIdp({
      validFrom: new Date(now.getTime() - 48 * 60 * 60 * 1_000),
      validTo: new Date(now.getTime() - 24 * 60 * 60 * 1_000),
    });
    expect(verifySamlResponse(providerFor(expired), {
      response: samlResponse({ ...base, idp: expired }), requestId, acsUrl: ACS, spEntityId: SP, now,
    })).toMatchObject({ ok: false, reason: "certificate_not_valid" });
  });

  it("refuses an encrypted assertion instead of pretending to read it", () => {
    const xml = samlResponseXml({ ...base })
      .replace("<saml:Assertion", "<saml:EncryptedAssertion><saml:Assertion")
      .replace("</saml:Assertion>", "</saml:Assertion></saml:EncryptedAssertion>");
    expect(check(Buffer.from(xml, "utf8").toString("base64")))
      .toMatchObject({ ok: false, reason: "encrypted_assertion" });
  });

  it("refuses an algorithm it cannot check instead of skipping the check", () => {
    for (const [from, to] of [
      [
        "<ds:CanonicalizationMethod Algorithm=\"http://www.w3.org/2001/10/xml-exc-c14n#\">",
        "<ds:CanonicalizationMethod Algorithm=\"http://www.w3.org/TR/2001/REC-xml-c14n-20010315\">",
      ],
      ["xmldsig-more#rsa-sha256", "xmldsig#rsa-sha1"],
      ["xmlenc#sha256", "xmldsig#sha1"],
    ] as const) {
      const xml = samlResponseXml({ ...base }).replace(from, to);
      expect(check(Buffer.from(xml, "utf8").toString("base64")), from)
        .toMatchObject({ ok: false, reason: "unsupported_algorithm" });
    }
  });

  it("refuses a reference that points at something other than the assertion", () => {
    const xml = samlResponseXml({ ...base });
    const assertionId = /<saml:Assertion [^>]*ID="([^"]+)"/.exec(xml)?.[1] ?? "";
    const responseId = /<samlp:Response [^>]*ID="([^"]+)"/.exec(xml)?.[1] ?? "";
    expect(assertionId && responseId).toBeTruthy();
    const moved = xml.replace(`URI="#${assertionId}"`, `URI="#${responseId}"`);
    expect(check(Buffer.from(moved, "utf8").toString("base64")))
      .toMatchObject({ ok: false, reason: "signature_scope_mismatch" });
  });

  it("refuses text that is not a response at all", () => {
    expect(check("not base64 $$")).toMatchObject({ ok: false, reason: "malformed_response" });
    expect(check(Buffer.from("<other/>", "utf8").toString("base64")))
      .toMatchObject({ ok: false, reason: "malformed_response", detail: "not_a_response" });
    expect(check(Buffer.from("<samlp:Response xmlns:samlp=\"urn:oasis:names:tc:SAML:2.0:protocol\"><!-- x --></samlp:Response>", "utf8").toString("base64")))
      .toMatchObject({ ok: false, reason: "unsupported_xml_form", detail: "comment" });
  });
});
