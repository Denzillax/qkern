import { generateKeyPairSync, createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PasswordHasher } from "@/lib/server/auth/password";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import { ProjectAuthSecretProtector, ProjectAuthTotp } from "@/lib/server/project-auth/mfa";
import { ProjectAuthOidcCatalog, ProjectAuthOidcClient } from "@/lib/server/project-auth/oidc";
import { ProjectAuthSamlCatalog, type ProjectAuthSamlProvider } from "@/lib/server/project-auth/saml";
import { createProjectAuthSamlAcsHandler } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/auth/saml/[provider]/acs/route";
import { samlResponse, samlResponseXml, TestSamlIdp } from "@/tests/support/saml-idp";
import { NextRequest } from "next/server";
import { MemoryProjectAuthAuditSink } from "@/lib/server/project-auth/audit";
import type { ProjectAuthService as ProjectAuthServiceType } from "@/lib/server/project-auth/service";
import { MemoryProjectAuthRepository } from "@/lib/server/project-auth/repository";
import { ProjectAuthService } from "@/lib/server/project-auth/service";
import { SmtpProjectAuthDelivery } from "@/lib/server/project-auth/smtp-delivery";
import { ProjectAuthTokenService } from "@/lib/server/project-auth/tokens";

/**
 * Provider-E2E für Stufe 1.3.
 *
 * Diese Fälle laufen ausschließlich im Wegwerfstack aus
 * `docker-compose.auth-certification.yml` gegen einen echten SMTP-Server
 * (Mailpit) und einen echten OIDC-Provider (Dex über TLS).
 *
 * Entscheidend ist `exposeDeliveryTokens: false`: Der Dienst gibt kein Token
 * zurück. Der einzige Weg an einen Verifikations-, Magic-Link- oder
 * Reset-Token führt über eine tatsächlich zugestellte Nachricht. Genau das
 * unterscheidet diesen Nachweis von den lokalen Tests.
 */

const enabled = process.env.QKERN_TEST_PROJECT_AUTH_PROVIDER_E2E === "true";

const SMTP_HOST = process.env.QKERN_TEST_AUTH_SMTP_HOST ?? "mailpit";
const SMTP_PORT = Number.parseInt(process.env.QKERN_TEST_AUTH_SMTP_PORT ?? "1025", 10);
const MAILBOX = process.env.QKERN_TEST_AUTH_MAILBOX_URL ?? "http://mailpit:8025";
const ISSUER = process.env.QKERN_TEST_AUTH_OIDC_ISSUER ?? "";
const CLIENT_ID = process.env.QKERN_TEST_AUTH_OIDC_CLIENT_ID ?? "";
const OIDC_USER = process.env.QKERN_TEST_AUTH_OIDC_USER ?? "";
const PARTNER_ISSUER = process.env.QKERN_TEST_AUTH_OIDC_PARTNER_ISSUER ?? "";
const PARTNER_CLIENT_ID = process.env.QKERN_TEST_AUTH_OIDC_PARTNER_CLIENT_ID ?? "";
const OIDC_PASSWORD = process.env.QKERN_TEST_AUTH_OIDC_PASSWORD ?? "";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const CALLBACK_BASE = "http://localhost:3000";
const scope = {
  organizationId: randomUUID(),
  projectId: PROJECT_ID,
  environment: "development" as const,
};

class FastHasher implements PasswordHasher {
  readonly dummyHash = "fast:dummy";
  async hash(password: string) { return `fast:${createHash("sha256").update(password).digest("hex")}`; }
  async verify(password: string, hash: string) { return hash === await this.hash(password); }
}

function createService(saml: ProjectAuthSamlProvider[] = []) {
  const { privateKey } = generateKeyPairSync("ed25519");
  return new ProjectAuthService({
    repository: new MemoryProjectAuthRepository(),
    passwords: new FastHasher(),
    rateLimiter: new InMemoryRateLimiter(),
    tokens: new ProjectAuthTokenService({ kid: "provider-e2e", privateKey }, "https://qkern.test"),
    mfa: new ProjectAuthTotp(),
    secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 7)),
    delivery: new SmtpProjectAuthDelivery({
      host: SMTP_HOST,
      port: SMTP_PORT,
      security: "plaintext",
      sender: "no-reply@qkern.test",
      actionBaseUrl: `${CALLBACK_BASE}/auth/callback`,
      production: false,
    }),
    oidcCatalog: new ProjectAuthOidcCatalog([{
      id: "certification",
      issuer: ISSUER,
      authorizationEndpoint: `${ISSUER}/auth`,
      tokenEndpoint: `${ISSUER}/token`,
      jwksUri: `${ISSUER}/keys`,
      clientId: CLIENT_ID,
      clientSecretEnv: "QKERN_PROJECT_AUTH_OIDC_SECRET_CERTIFICATION",
      scopes: ["openid", "email", "profile"],
    }, {
      // Der zweite echte Provider (eigener Dex, eigene Schluessel). Er steht
      // im Katalog wie ein Social-Login stuende: eigener Slug, eigener Client.
      id: "partner",
      issuer: PARTNER_ISSUER,
      authorizationEndpoint: `${PARTNER_ISSUER}/auth`,
      tokenEndpoint: `${PARTNER_ISSUER}/token`,
      jwksUri: `${PARTNER_ISSUER}/keys`,
      clientId: PARTNER_CLIENT_ID,
      clientSecretEnv: "QKERN_PROJECT_AUTH_OIDC_SECRET_PARTNER",
      scopes: ["openid", "email", "profile"],
    }]),
    oidcClient: new ProjectAuthOidcClient(process.env),
    samlCatalog: new ProjectAuthSamlCatalog(saml),
    // Ein Audit-Sink, weil die SAML-Faelle ihre Gruende dort nachlesen: Nach
    // aussen antwortet die Route auf jede Faelschung dasselbe.
    audit: new MemoryProjectAuthAuditSink(),
    callbackBaseUrl: CALLBACK_BASE,
    allowedRedirectOrigins: new Set([CALLBACK_BASE]),
    // Kein lokaler Abkuerzungspfad: das Token existiert nur in der Mail.
    exposeDeliveryTokens: false,
  });
}

type MailpitMessage = { ID: string; To: Array<{ Address: string }>; Subject: string };

/** Wartet auf genau eine zugestellte Nachricht an diese Adresse. */
async function waitForMail(recipient: string, timeoutMs = 20_000): Promise<{ subject: string; text: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const listing = await fetch(`${MAILBOX}/api/v1/messages?limit=200`);
    if (listing.ok) {
      const body = await listing.json() as { messages?: MailpitMessage[] };
      const match = (body.messages ?? []).find(
        (message) => message.To?.some((to) => to.Address.toLowerCase() === recipient.toLowerCase()),
      );
      if (match) {
        const detail = await fetch(`${MAILBOX}/api/v1/message/${match.ID}`);
        const content = await detail.json() as { Text?: string };
        return { subject: match.Subject, text: content.Text ?? "" };
      }
    }
    if (Date.now() > deadline) throw new Error(`no mail delivered to ${recipient}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Liest den Aktionslink aus dem Nachrichtenkoerper und gibt seinen Token zurueck. */
function tokenFromMail(text: string, expectedType: string): string {
  const link = /https?:\/\/\S+/.exec(text.replace(/=\r?\n/g, ""));
  if (!link) throw new Error("message carries no action link");
  const url = new URL(link[0].replace(/[).,]+$/, ""));
  expect(url.searchParams.get("type")).toBe(expectedType);
  const token = url.searchParams.get("token");
  if (!token) throw new Error("action link carries no token");
  return token;
}

/**
 * Fuehrt den Authorization-Code-Flow gegen den echten Dex aus: Login-Formular
 * abrufen, Zugangsdaten senden und den Weiterleitungen bis zur Callback-URI
 * folgen. Die Formularadresse wird aus dem HTML gelesen statt geraten, damit
 * der Nachweis nicht an einem Versionsdetail von Dex haengt.
 */
async function authorizeWithDex(authorizationUrl: string, issuer = ISSUER): Promise<{ code: string; state: string }> {
  const origin = new URL(issuer).origin;
  const callbackOrigin = new URL(CALLBACK_BASE).origin;
  let current = authorizationUrl;

  /** Der Callback wird nie abgerufen: dort lauscht in diesem Stack niemand. */
  const arrived = (candidate: URL) => {
    if (candidate.origin !== callbackOrigin) return null;
    const code = candidate.searchParams.get("code");
    const state = candidate.searchParams.get("state");
    if (!code || !state) throw new Error(`callback without code: ${candidate.search}`);
    return { code, state };
  };

  for (let hop = 0; hop < 10; hop += 1) {
    // Mit skipApprovalScreen leitet der Provider direkt nach dem Login auf die
    // Callback-URI. Die Pruefung muss deshalb vor jedem Abruf stehen, nicht nur
    // beim Auswerten einer Antwort.
    const reached = arrived(new URL(current));
    if (reached) return reached;

    const response = await fetch(current, { redirect: "manual" });
    const location = response.headers.get("location");

    if (location) {
      const next = new URL(location, current);
      const done = arrived(next);
      if (done) return done;
      current = next.toString();
      continue;
    }

    const html = await response.text();
    const action = /<form[^>]+action="([^"]+)"/i.exec(html);
    if (!action) throw new Error(`no login form at ${current}`);

    const form = new URL(action[1].replace(/&amp;/g, "&"), current);
    if (form.origin !== origin) throw new Error("login form leaves the provider origin");

    const submitted = await fetch(form.toString(), {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ login: OIDC_USER, password: OIDC_PASSWORD }),
    });
    const submittedLocation = submitted.headers.get("location");
    if (!submittedLocation) throw new Error("provider rejected the credentials");
    current = new URL(submittedLocation, form).toString();
  }

  throw new Error("authorization did not reach the callback");
}

describe.runIf(enabled)("Project Auth provider certification", () => {
  it("delivers a verification mail over real SMTP and only the mail carries the token", async () => {
    const service = createService();
    const email = `verify-${randomUUID()}@qkern.test`;

    const signup = await service.signUp(scope, {
      email, password: "a sufficiently long password",
      redirectTo: `${CALLBACK_BASE}/welcome`, rateLimitKey: randomUUID(),
    });
    expect(signup.debugToken).toBeUndefined();

    const mail = await waitForMail(email);
    expect(mail.subject).toBe("Confirm your email address");

    const session = await service.consumeEmailToken(scope, {
      token: tokenFromMail(mail.text, "email_verification"), purpose: "email_verification",
    });
    expect(session).not.toHaveProperty("mfaRequired");
  });

  it("delivers a magic link that signs the user in", async () => {
    const service = createService();
    const email = `magic-${randomUUID()}@qkern.test`;

    await service.signUp(scope, {
      email, password: "a sufficiently long password",
      redirectTo: `${CALLBACK_BASE}/welcome`, rateLimitKey: randomUUID(),
    });
    const verification = await waitForMail(email);
    await service.consumeEmailToken(scope, {
      token: tokenFromMail(verification.text, "email_verification"), purpose: "email_verification",
    });

    await service.requestMagicLink(scope, {
      email, redirectTo: `${CALLBACK_BASE}/welcome`, rateLimitKey: randomUUID(),
    });
    const magic = await waitForMailWithSubject(email, "Your sign-in link");

    const session = await service.consumeEmailToken(scope, {
      token: tokenFromMail(magic, "magic_link"), purpose: "magic_link",
    });
    expect(session).not.toHaveProperty("mfaRequired");
  });

  it("delivers a password reset that a new password can be set with", async () => {
    const service = createService();
    const email = `reset-${randomUUID()}@qkern.test`;

    await service.signUp(scope, {
      email, password: "a sufficiently long password",
      redirectTo: `${CALLBACK_BASE}/welcome`, rateLimitKey: randomUUID(),
    });
    const verification = await waitForMail(email);
    await service.consumeEmailToken(scope, {
      token: tokenFromMail(verification.text, "email_verification"), purpose: "email_verification",
    });

    await service.requestPasswordReset(scope, {
      email, redirectTo: `${CALLBACK_BASE}/welcome`, rateLimitKey: randomUUID(),
    });
    const reset = await waitForMailWithSubject(email, "Reset your password");

    await service.resetPassword(scope, {
      token: tokenFromMail(reset, "password_reset"), password: "an even longer replacement password",
    });
    const signIn = await service.passwordSignIn(scope, {
      email, password: "an even longer replacement password", rateLimitKey: randomUUID(),
    });
    expect(signIn).not.toHaveProperty("mfaRequired");
  });

  it("completes a real OIDC authorization code flow with PKCE against Dex", async () => {
    const service = createService();

    const started = await service.startOidc(scope, {
      provider: "certification", redirectTo: `${CALLBACK_BASE}/welcome`, rateLimitKey: randomUUID(),
    });
    expect(started.authorizationUrl).toContain("code_challenge_method=S256");

    const { code, state } = await authorizeWithDex(started.authorizationUrl);
    const session = await service.completeOidc(scope, { provider: "certification", state, code });

    expect(session).not.toHaveProperty("mfaRequired");
    if ("mfaRequired" in session) throw new Error("unexpected MFA");
    const principal = await service.verifyAccess(scope, session.accessToken);
    expect(principal.user.email).toBe(OIDC_USER);
  });

  it("refuses a replayed authorization state", async () => {
    const service = createService();
    const started = await service.startOidc(scope, {
      provider: "certification", redirectTo: `${CALLBACK_BASE}/welcome`, rateLimitKey: randomUUID(),
    });
    const { code, state } = await authorizeWithDex(started.authorizationUrl);

    await service.completeOidc(scope, { provider: "certification", state, code });
    await expect(service.completeOidc(scope, { provider: "certification", state, code }))
      .rejects.toMatchObject({ name: "ProjectAuthError" });
  });

  /**
   * Der Provider-Katalog mit zwei **echten** Gegenstellen — Sprosse 8.
   *
   * Derselbe Mensch existiert bei beiden Providern unter derselben E-Mail,
   * aber mit verschiedenen Subjects. Die Verknuepfung laeuft ueber die
   * verifizierte E-Mail; ein State des einen Providers ist beim anderen
   * nichts wert — genau diese Bindung nimmt die Mutationsprobe dieses
   * Releases heraus.
   */
  it("keeps two real providers separate and links identities by verified mail", async () => {
    const service = createService();

    const first = await service.startOidc(scope, {
      provider: "certification", redirectTo: `${CALLBACK_BASE}/welcome`, rateLimitKey: randomUUID(),
    });
    const certification = await authorizeWithDex(first.authorizationUrl);
    const sessionA = await service.completeOidc(scope, {
      provider: "certification", state: certification.state, code: certification.code,
    });
    if ("mfaRequired" in sessionA) throw new Error("unexpected MFA");
    const principalA = await service.verifyAccess(scope, sessionA.accessToken);

    const second = await service.startOidc(scope, {
      provider: "partner", redirectTo: `${CALLBACK_BASE}/welcome`, rateLimitKey: randomUUID(),
    });
    const partner = await authorizeWithDex(second.authorizationUrl, PARTNER_ISSUER);
    const sessionB = await service.completeOidc(scope, {
      provider: "partner", state: partner.state, code: partner.code,
    });
    if ("mfaRequired" in sessionB) throw new Error("unexpected MFA");
    const principalB = await service.verifyAccess(scope, sessionB.accessToken);

    // Gleiche verifizierte E-Mail bei zwei Providern: ein Konto, zwei
    // Identitaeten — nicht zwei Konten und nicht eine uebernommene Identitaet.
    expect(principalB.user.id).toBe(principalA.user.id);
    expect(principalB.user.email).toBe(OIDC_USER);

    // Ein State, der fuer den einen Provider ausgestellt wurde, ist beim
    // anderen genau das: ungueltig.
    const crossed = await service.startOidc(scope, {
      provider: "certification", redirectTo: `${CALLBACK_BASE}/welcome`, rateLimitKey: randomUUID(),
    });
    const crossedLogin = await authorizeWithDex(crossed.authorizationUrl);
    await expect(service.completeOidc(scope, {
      provider: "partner", state: crossedLogin.state, code: crossedLogin.code,
    })).rejects.toMatchObject({ code: "INVALID_TOKEN" });

    // Ein Provider, den der Katalog nicht kennt, existiert nicht.
    await expect(service.startOidc(scope, {
      provider: "github", redirectTo: `${CALLBACK_BASE}/welcome`, rateLimitKey: randomUUID(),
    })).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  }, 60_000);

  /**
   * SAML 2.0 gegen einen Anbieter, der wirklich unterschreibt — Sprosse 8.
   *
   * ## Wer hier mitspielt, und wer nicht
   *
   * Die Gegenstelle ist `tests/support/saml-idp.ts`: ein eigenes
   * RSA-Schluesselpaar, ein selbst aus DER gebautes X.509-Zertifikat, eine
   * echte XML-Signatur nach `rsa-sha256` ueber der exklusiv kanonisierten
   * Assertion. Kryptografisch ist das eine echte Gegenstelle; QKERN bekommt
   * nur das Zertifikat und den base64-Text und kennt die Datei nicht.
   *
   * **Keine fremde Software hat mitgespielt.** Kein SimpleSAMLphp, kein
   * Keycloak, kein Shibboleth. Was diese Faelle belegen, ist die Pruefung.
   * Was sie nicht belegen, ist Interoperabilitaet mit einem Produkt, das
   * jemand anders geschrieben hat, und das steht auch so im Handbuch.
   *
   * Die Antwort geht durch die **echte Route**: `createProjectAuthSamlAcsHandler`
   * ist derselbe Handler, den `POST .../auth/saml/{provider}/acs` ausfuehrt,
   * mit demselben Rumpf aus einem Formular und demselben Weg ueber
   * `resolveSamlScope`.
   */
  const samlIdp = () => new TestSamlIdp({ entityId: "https://saml-idp.qkern.test/metadata" });
  const samlProvider = (idp: TestSamlIdp, extra: Partial<ProjectAuthSamlProvider> = {}): ProjectAuthSamlProvider => ({
    id: "federation", entityId: idp.entityId, singleSignOnUrl: "https://saml-idp.qkern.test/sso",
    certificate: idp.certificatePem, ...extra,
  });
  const ACS_URL = `${CALLBACK_BASE}/api/v1/projects/${PROJECT_ID}/environments/development/auth/saml/federation/acs`;
  const SP_ENTITY = `${CALLBACK_BASE}/api/v1/projects/${PROJECT_ID}/environments/development/auth/saml`;

  /** Reicht eine Antwort durch die echte ACS-Route ein. */
  async function postToAcs(service: ProjectAuthServiceType, response: string, relayState: string) {
    const handler = createProjectAuthSamlAcsHandler(() => service);
    const request = new NextRequest(new URL(ACS_URL), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ SAMLResponse: response, RelayState: relayState }).toString(),
    });
    const answer = await handler(request, {
      params: Promise.resolve({ projectId: PROJECT_ID, environment: "development", provider: "federation" }),
    });
    return { status: answer.status, body: await answer.json() as { data?: { accessToken?: string }; error?: string } };
  }

  it("signs a person in over a real SP-initiated SAML flow and ends in a session the access check accepts", async () => {
    const idp = samlIdp();
    const service = createService([samlProvider(idp)]);
    const email = `saml-${randomUUID()}@qkern.test`;

    const started = await service.startSaml(scope, {
      provider: "federation", redirectTo: `${CALLBACK_BASE}/welcome`, rateLimitKey: randomUUID(),
    });
    // Die Anfrage geht mit dem HTTP-Redirect-Binding zum Anbieter, deflatiert
    // und base64 in der Adresse, und der RelayState ist die Kennung.
    const authorization = new URL(started.redirectUrl);
    expect(authorization.origin).toBe("https://saml-idp.qkern.test");
    expect(authorization.searchParams.get("RelayState")).toBe(started.requestId);
    expect(authorization.searchParams.get("SAMLRequest")).toBeTruthy();

    const answer = await postToAcs(service, samlResponse({
      idp, acsUrl: ACS_URL, spEntityId: SP_ENTITY, requestId: started.requestId, email,
    }), started.requestId);
    expect(answer.status).toBe(200);
    const accessToken = answer.body.data?.accessToken;
    if (!accessToken) throw new Error(`no session: ${JSON.stringify(answer.body)}`);

    const principal = await service.verifyAccess(scope, accessToken);
    expect(principal.user.email).toBe(email);
    expect(principal.user.emailVerifiedAt).not.toBeNull();

    // Die Identitaet liegt unter `saml:<slug>` und nicht unter dem Slug allein:
    // Ein Subject ist die Zusage **eines** Ausstellers.
    expect(principal.user.appMetadata).toMatchObject({ providers: ["saml:federation"] });

    // Der Anbieter steht in der Projektion, ohne Zertifikat und ohne Endpunkt.
    const listed = service.listSamlProviders();
    expect(listed).toEqual([{ id: "federation", entityId: idp.entityId, requiresVerifiedEmail: true }]);
    expect(JSON.stringify(listed)).not.toMatch(/CERTIFICATE|sso|certificate/i);
  }, 60_000);

  it("refuses every known SAML forgery at the real consumer route: unsigned, envelope-only, wrapped, expired, misdirected, unbound and foreign-signed", async () => {
    const idp = samlIdp();
    const other = new TestSamlIdp({ entityId: idp.entityId });
    const service = createService([samlProvider(idp)]);
    const email = `saml-forge-${randomUUID()}@qkern.test`;

    /** Jede Faelschung bekommt eine eigene, frische Anfrage. */
    const forge = async (
      build: (requestId: string, now: Date) => string,
      readAt?: (now: Date) => Date,
    ) => {
      const now = new Date();
      const flow = await service.startSaml(scope, {
        provider: "federation", redirectTo: `${CALLBACK_BASE}/welcome`, rateLimitKey: randomUUID(),
      });
      void readAt;
      return postToAcs(service, build(flow.requestId, now), flow.requestId);
    };
    const base = (requestId: string, now: Date) => ({
      idp, acsUrl: ACS_URL, spEntityId: SP_ENTITY, requestId, email, now,
    });

    // 1. Keine Signatur ueber der Assertion.
    expect((await forge((id, now) => samlResponse({ ...base(id, now), signAssertion: false }))).status).toBe(401);
    // 2. Signatur nur ueber der Antworthuelle. Sie ist echt, sie prueft auch
    //    durch, und sie deckt die Assertion trotzdem nicht.
    expect((await forge((id, now) =>
      samlResponse({ ...base(id, now), signAssertion: false, signResponse: true }))).status).toBe(401);
    // 3. XML Signature Wrapping: die echte Assertion in einem Extensions-Block,
    //    eine erfundene an ihrer Stelle.
    expect((await forge((id, now) =>
      samlResponse({ ...base(id, now), wrapWith: { email: "angreifer@qkern.test" } }))).status).toBe(401);
    // 4. Abgelaufenes NotOnOrAfter der Bedingungen.
    expect((await forge((id, now) => samlResponse({
      ...base(id, now),
      notBefore: new Date(now.getTime() - 2 * 60 * 60 * 1_000),
      notOnOrAfter: new Date(now.getTime() - 60 * 60 * 1_000),
      confirmationNotOnOrAfter: new Date(now.getTime() + 5 * 60 * 1_000),
    }))).status).toBe(401);
    // 5. NotBefore noch nicht erreicht.
    expect((await forge((id, now) => samlResponse({
      ...base(id, now),
      notBefore: new Date(now.getTime() + 60 * 60 * 1_000),
      notOnOrAfter: new Date(now.getTime() + 2 * 60 * 60 * 1_000),
    }))).status).toBe(401);
    // 6. Abgelaufene SubjectConfirmationData bei offenen Bedingungen.
    expect((await forge((id, now) => samlResponse({
      ...base(id, now), confirmationNotOnOrAfter: new Date(now.getTime() - 60 * 60 * 1_000),
    }))).status).toBe(401);
    // 7. Destination zeigt woandershin.
    expect((await forge((id, now) => samlResponse({
      ...base(id, now), destination: `${CALLBACK_BASE}/api/v1/elsewhere`,
    }))).status).toBe(401);
    // 8. Recipient zeigt woandershin.
    expect((await forge((id, now) => samlResponse({
      ...base(id, now), recipient: "https://elsewhere.qkern.test/acs",
    }))).status).toBe(401);
    // 9. Audience ist nicht diese Projektumgebung.
    expect((await forge((id, now) => samlResponse({
      ...base(id, now), audience: "https://someone-else.qkern.test",
    }))).status).toBe(401);
    // 10. InResponseTo passt nicht zur eigenen Anfrage — in der Huelle.
    expect((await forge((id, now) => samlResponse({
      ...base(id, now), responseInResponseTo: "_0000000000000000000000000000000000000000",
    }))).status).toBe(401);
    // 11. ... und in der Bestaetigung.
    expect((await forge((id, now) => samlResponse({
      ...base(id, now), assertionInResponseTo: "_0000000000000000000000000000000000000000",
    }))).status).toBe(401);
    // 12. Ein Zertifikat, das nicht das hinterlegte ist — mit KeyInfo faellt es
    //     dort auf, ohne KeyInfo an der Unterschrift.
    expect((await forge((id, now) => samlResponse({ ...base(id, now), signWith: other }))).status).toBe(401);
    expect((await forge((id, now) =>
      samlResponse({ ...base(id, now), signWith: other, keyInfo: false }))).status).toBe(401);
    // 13. Fehlendes email_verified bei einem Anbieter, der dafuer buergen muss.
    expect((await forge((id, now) => samlResponse({ ...base(id, now), emailVerified: null }))).status).toBe(401);
    expect((await forge((id, now) => samlResponse({ ...base(id, now), emailVerified: "false" }))).status).toBe(401);
    // 14. Eine Assertion, deren Bytes nach der Signatur geaendert wurden.
    expect((await forge((id, now) => Buffer.from(
      samlResponseXml(base(id, now)).replace(`${email}</saml:AttributeValue>`, "root@qkern.test</saml:AttributeValue>"),
      "utf8").toString("base64"))).status).toBe(401);

    // Keine dieser Antworten hat einen Nutzer angelegt. Waere eine
    // durchgekommen, stuende hier eine Sitzung.
    await expect(service.passwordSignIn(scope, {
      email, password: "a sufficiently long password", rateLimitKey: randomUUID(),
    })).rejects.toMatchObject({ name: "ProjectAuthError" });

    // Jede Abweisung steht mit ihrem Grund im Audit, und keiner der Gruende
    // ging nach aussen: Die Route hat vierzehnmal dasselbe geantwortet.
    const audit = await service.listAuditEvents(scope, 100);
    const reasons = audit.events
      .filter((event) => event.action === "project_auth.login.failed" &&
        (event.metadata as { method?: unknown }).method === "saml")
      .map((event) => String((event.metadata as { reason?: unknown }).reason ?? ""));
    expect(new Set(reasons)).toEqual(new Set([
      "signature_missing", "assertion_not_unique", "condition_expired", "condition_not_yet_valid",
      "subject_confirmation_expired", "destination_mismatch", "recipient_mismatch", "audience_mismatch",
      "in_response_to_mismatch", "certificate_mismatch", "signature_invalid", "email_not_verified",
      "digest_mismatch",
    ]));
  }, 120_000);

  it("refuses the very same assertion a second time on the replay bar, and the bar is what refuses it", async () => {
    const idp = samlIdp();
    const service = createService([samlProvider(idp)]);
    const email = `saml-replay-${randomUUID()}@qkern.test`;

    const started = await service.startSaml(scope, {
      provider: "federation", redirectTo: `${CALLBACK_BASE}/welcome`, rateLimitKey: randomUUID(),
    });
    const response = samlResponse({
      idp, acsUrl: ACS_URL, spEntityId: SP_ENTITY, requestId: started.requestId, email,
    });

    const first = await postToAcs(service, response, started.requestId);
    expect(first.status).toBe(200);
    // Dieselbe Antwort, dieselbe offene Anfrage, dieselbe Route. Die Anfrage
    // wird absichtlich nicht verbraucht, damit die zweite Einreichung
    // ueberhaupt bis zum Riegel kommt.
    const second = await postToAcs(service, response, started.requestId);
    expect(second.status).toBe(401);

    const audit = await service.listAuditEvents(scope, 50);
    const failed = audit.events.find((event) => event.action === "project_auth.login.failed");
    expect(failed?.metadata).toMatchObject({ method: "saml", provider: "federation", reason: "assertion_replayed" });

    // Genau eine Sitzung, nicht zwei. Und eine neue Anfrage mit einer neuen
    // Assertion geht weiter durch: Der Riegel sperrt eine `ID`, nicht den Weg.
    const again = await service.startSaml(scope, {
      provider: "federation", redirectTo: `${CALLBACK_BASE}/welcome`, rateLimitKey: randomUUID(),
    });
    const fresh = await postToAcs(service, samlResponse({
      idp, acsUrl: ACS_URL, spEntityId: SP_ENTITY, requestId: again.requestId, email,
      assertionId: `_a${randomUUID().replace(/-/g, "")}`,
    }), again.requestId);
    expect(fresh.status).toBe(200);
  }, 60_000);

  /**
   * Die Auswahlflaeche aus 1.83: Der Katalog kannte `list()` seit 1.76 —
   * gerufen hat es bis jetzt niemand, weder Console noch App. Die Liste ist
   * eine **Projektion**: Slug und Issuer, nichts sonst. Die Mutationsprobe
   * dieses Releases reicht stattdessen die vollen Provider-Objekte durch —
   * dann faellt genau dieser Fall, am Geheimnis-Muster und an der Form.
   */
  it("lists exactly the configured providers as a three-field projection", () => {
    // Seit 2.52 traegt die Projektion ein drittes Feld: einen Wahrheitswert,
    // den der Sicherheitsberater braucht. Er ist ein Vergleichsergebnis und
    // hat keine Stelle, an der eine Kennung oder ein Geheimnis stehen koennte.
    // Die oeffentliche Route verengt weiterhin auf zwei Felder; das prueft der
    // zweite Teil, sonst waere die Verengung nur eine Behauptung.
    const service = createService();
    const listed = service.listOidcProviders();
    expect(listed).toEqual([
      { id: "certification", issuer: ISSUER, requiresVerifiedEmail: true },
      { id: "partner", issuer: PARTNER_ISSUER, requiresVerifiedEmail: true },
    ]);
    expect(JSON.stringify(listed)).not.toMatch(/client|secret|endpoint|jwks/i);

    const publicProjection = listed.map((provider) => ({ id: provider.id, issuer: provider.issuer }));
    for (const entry of publicProjection) {
      expect(Object.keys(entry).sort()).toEqual(["id", "issuer"]);
    }
  });

});

/** Wie waitForMail, aber wartet auf eine bestimmte Betreffzeile an diese Adresse. */
async function waitForMailWithSubject(recipient: string, subject: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const listing = await fetch(`${MAILBOX}/api/v1/messages?limit=200`);
    if (listing.ok) {
      const body = await listing.json() as { messages?: MailpitMessage[] };
      const match = (body.messages ?? []).find(
        (message) => message.Subject === subject
          && message.To?.some((to) => to.Address.toLowerCase() === recipient.toLowerCase()),
      );
      if (match) {
        const detail = await fetch(`${MAILBOX}/api/v1/message/${match.ID}`);
        const content = await detail.json() as { Text?: string };
        return content.Text ?? "";
      }
    }
    if (Date.now() > deadline) throw new Error(`no "${subject}" mail delivered to ${recipient}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
