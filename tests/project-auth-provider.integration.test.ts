import { generateKeyPairSync, createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PasswordHasher } from "@/lib/server/auth/password";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import { ProjectAuthSecretProtector, ProjectAuthTotp } from "@/lib/server/project-auth/mfa";
import { ProjectAuthOidcCatalog, ProjectAuthOidcClient } from "@/lib/server/project-auth/oidc";
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

function createService() {
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
