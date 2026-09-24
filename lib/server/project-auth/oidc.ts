import { createHash, createPublicKey, randomBytes, verify as verifySignature, type JsonWebKey } from "node:crypto";
import { isIP } from "node:net";

export type ProjectAuthOidcProvider = {
  id: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  clientId: string;
  clientSecretEnv?: string;
  scopes: string[];
  /**
   * "required" (Voreinstellung): Das ID-Token muss `email_verified: true`
   * tragen. "trusted": Der Operator buergt fuer einen Provider, der den
   * Claim nicht sendet — ein **fehlender** Claim wird akzeptiert, ein
   * explizites `false` bleibt in jedem Modus eine Abweisung. Trusted heisst
   * "ohne Claim", nie "gegen den Claim".
   */
  emailVerification?: "required" | "trusted";
};

export type ProjectAuthOidcIdentityClaims = {
  subject: string;
  email: string;
  emailVerified: true;
  name?: string;
};

export class ProjectAuthOidcError extends Error {
  constructor() {
    super("PROJECT_AUTH_OIDC_ERROR");
    this.name = "ProjectAuthOidcError";
  }
}

export class ProjectAuthOidcCatalog {
  private readonly providers = new Map<string, ProjectAuthOidcProvider>();

  constructor(providers: ProjectAuthOidcProvider[]) {
    if (providers.length > 10) throw new ProjectAuthOidcError();
    for (const provider of providers) {
      validateProvider(provider);
      if (this.providers.has(provider.id)) throw new ProjectAuthOidcError();
      this.providers.set(provider.id, { ...provider, scopes: [...provider.scopes] });
    }
  }

  get(id: string): ProjectAuthOidcProvider | null {
    const provider = this.providers.get(id);
    return provider ? { ...provider, scopes: [...provider.scopes] } : null;
  }

  list(): string[] { return [...this.providers.keys()].sort(); }
}

export class ProjectAuthOidcClient {
  constructor(
    private readonly environment: Readonly<Record<string, string | undefined>> = process.env,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  createAuthorization(provider: ProjectAuthOidcProvider, input: {
    callbackUri: string;
    state: string;
  }): { url: string; codeVerifier: string; nonce: string } {
    validateProvider(provider);
    const callbackUri = callbackUrl(input.callbackUri, this.environment);
    const codeVerifier = randomBytes(32).toString("base64url");
    const nonce = randomBytes(24).toString("base64url");
    const challenge = createHash("sha256").update(codeVerifier, "utf8").digest("base64url");
    const url = new URL(provider.authorizationEndpoint);
    url.search = new URLSearchParams({
      response_type: "code", client_id: provider.clientId, redirect_uri: callbackUri,
      scope: provider.scopes.join(" "), state: input.state, nonce,
      code_challenge: challenge, code_challenge_method: "S256",
    }).toString();
    return { url: url.toString(), codeVerifier, nonce };
  }

  async exchange(provider: ProjectAuthOidcProvider, input: {
    code: string;
    codeVerifier: string;
    nonce: string;
    callbackUri: string;
  }): Promise<ProjectAuthOidcIdentityClaims> {
    validateProvider(provider);
    if (!/^[\x21-\x7E]{1,4096}$/.test(input.code) || !/^[A-Za-z0-9_-]{43}$/.test(input.codeVerifier) ||
        !/^[A-Za-z0-9_-]{32}$/.test(input.nonce)) throw new ProjectAuthOidcError();
    const secret = provider.clientSecretEnv ? this.environment[provider.clientSecretEnv]?.trim() : undefined;
    if (provider.clientSecretEnv && !secret) throw new ProjectAuthOidcError();
    const body = new URLSearchParams({
      grant_type: "authorization_code", code: input.code, client_id: provider.clientId,
      redirect_uri: callbackUrl(input.callbackUri, this.environment), code_verifier: input.codeVerifier,
      ...(secret ? { client_secret: secret } : {}),
    });
    const response = await this.fetchExact(provider.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
    });
    const payload = await boundedJson(response, 64 * 1024);
    if (!response.ok || typeof payload.id_token !== "string") throw new ProjectAuthOidcError();
    return this.verifyIdToken(provider, payload.id_token, input.nonce);
  }

  async verifyIdToken(
    provider: ProjectAuthOidcProvider,
    token: string,
    nonce: string,
    now = new Date(),
  ): Promise<ProjectAuthOidcIdentityClaims> {
    if (token.length > 32_768) throw new ProjectAuthOidcError();
    const [encodedHeader, encodedClaims, encodedSignature, extra] = token.split(".");
    if (extra !== undefined || !encodedHeader || !encodedClaims || !encodedSignature) throw new ProjectAuthOidcError();
    const header = decodeObject(encodedHeader);
    const claims = decodeObject(encodedClaims);
    const kid = typeof header.kid === "string" ? header.kid : "";
    const alg = typeof header.alg === "string" ? header.alg : "";
    if (!kid || !["RS256", "ES256", "EdDSA"].includes(alg)) throw new ProjectAuthOidcError();
    const jwksResponse = await this.fetchExact(provider.jwksUri, { headers: { accept: "application/json" } });
    const jwks = await boundedJson(jwksResponse, 128 * 1024);
    if (!jwksResponse.ok || !Array.isArray(jwks.keys) || jwks.keys.length > 20) throw new ProjectAuthOidcError();
    const jwk = jwks.keys.find((candidate) => isObject(candidate) && candidate.kid === kid &&
      (candidate.alg === undefined || candidate.alg === alg)) as (JsonWebKey & { kid?: string; alg?: string }) | undefined;
    if (!jwk) throw new ProjectAuthOidcError();
    let key;
    try { key = createPublicKey({ key: jwk, format: "jwk" }); } catch { throw new ProjectAuthOidcError(); }
    const data = Buffer.from(`${encodedHeader}.${encodedClaims}`, "utf8");
    const signature = Buffer.from(encodedSignature, "base64url");
    const valid = alg === "EdDSA"
      ? verifySignature(null, data, key, signature)
      : alg === "ES256"
        ? verifySignature("sha256", data, { key, dsaEncoding: "ieee-p1363" }, signature)
        : verifySignature("RSA-SHA256", data, key, signature);
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const audience = typeof claims.aud === "string" ? [claims.aud] : Array.isArray(claims.aud) ? claims.aud : [];
    if (!valid || claims.iss !== provider.issuer || !audience.includes(provider.clientId) ||
        typeof claims.sub !== "string" || claims.sub.length < 1 || claims.sub.length > 512 ||
        typeof claims.exp !== "number" || claims.exp <= nowSeconds || claims.exp > nowSeconds + 24 * 60 * 60 ||
        typeof claims.iat !== "number" || claims.iat > nowSeconds + 60 || claims.nonce !== nonce ||
        typeof claims.email !== "string" ||
        !(claims.email_verified === true ||
          (provider.emailVerification === "trusted" && claims.email_verified === undefined))) {
      throw new ProjectAuthOidcError();
    }
    return {
      subject: claims.sub,
      email: claims.email.trim().toLowerCase(),
      emailVerified: true,
      ...(typeof claims.name === "string" && claims.name.length <= 200 ? { name: claims.name } : {}),
    };
  }

  private async fetchExact(url: string, init: RequestInit): Promise<Response> {
    const expected = exactHttpsUrl(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await this.fetcher(expected, { ...init, redirect: "manual", signal: controller.signal });
      if (response.status >= 300 && response.status < 400) throw new ProjectAuthOidcError();
      return response;
    } catch (error) {
      if (error instanceof ProjectAuthOidcError) throw error;
      throw new ProjectAuthOidcError();
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function projectAuthOidcCatalogFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProjectAuthOidcCatalog {
  const raw = env.QKERN_PROJECT_AUTH_OIDC_PROVIDERS_JSON?.trim();
  if (!raw) return new ProjectAuthOidcCatalog([]);
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error("invalid");
    return new ProjectAuthOidcCatalog(parsed as ProjectAuthOidcProvider[]);
  } catch {
    throw new ProjectAuthOidcError();
  }
}

async function boundedJson(response: Response, maxBytes: number): Promise<Record<string, unknown>> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new ProjectAuthOidcError();
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new ProjectAuthOidcError();
  try {
    const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    if (!isObject(parsed)) throw new Error("invalid");
    return parsed;
  } catch {
    throw new ProjectAuthOidcError();
  }
}

function validateProvider(provider: ProjectAuthOidcProvider): void {
  if (!provider || !/^[a-z][a-z0-9_-]{0,62}$/.test(provider.id) ||
      typeof provider.clientId !== "string" || provider.clientId.length < 1 || provider.clientId.length > 512 ||
      (provider.clientSecretEnv !== undefined && !/^QKERN_PROJECT_AUTH_OIDC_SECRET_[A-Z0-9_]{1,80}$/.test(provider.clientSecretEnv)) ||
      !Array.isArray(provider.scopes) || provider.scopes.length < 2 || provider.scopes.length > 10 ||
      !provider.scopes.includes("openid") || !provider.scopes.includes("email") ||
      provider.scopes.some((scope) => !/^[A-Za-z0-9:._/-]{1,80}$/.test(scope)) ||
      (provider.emailVerification !== undefined &&
        !["required", "trusted"].includes(provider.emailVerification))) {
    throw new ProjectAuthOidcError();
  }
  if (provider.issuer.endsWith("/")) throw new ProjectAuthOidcError();
  exactHttpsUrl(provider.issuer);
  exactHttpsUrl(provider.authorizationEndpoint);
  exactHttpsUrl(provider.tokenEndpoint);
  exactHttpsUrl(provider.jwksUri);
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
    throw new ProjectAuthOidcError();
  }
}

function callbackUrl(value: string, environment: Readonly<Record<string, string | undefined>>): string {
  try {
    const url = new URL(value);
    const localHttp = environment.NODE_ENV !== "production" && url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !localHttp) || url.username || url.password || url.hash) throw new Error("invalid");
    return url.toString();
  } catch {
    throw new ProjectAuthOidcError();
  }
}

function decodeObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!isObject(parsed)) throw new Error("invalid");
    return parsed;
  } catch {
    throw new ProjectAuthOidcError();
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
