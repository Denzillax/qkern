import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import type {
  ProjectAuthScope,
  ProjectAuthSession,
  ProjectAuthUser,
} from "@/lib/server/project-auth/model";

export type ProjectAuthAccessClaims = {
  iss: string;
  aud: string;
  sub: string;
  exp: number;
  iat: number;
  nbf: number;
  jti: string;
  token_use: "access";
  project_id: string;
  environment: ProjectAuthScope["environment"];
  role: "authenticated";
  email: string;
  email_verified: boolean;
  aal: ProjectAuthSession["assurance"];
  session_id: string;
  user_metadata: Record<string, unknown>;
  app_metadata: Record<string, unknown>;
};

export type ProjectAuthIssuedAccess = {
  accessToken: string;
  accessTokenExpiresAt: Date;
};

export class ProjectAuthTokenError extends Error {
  constructor() {
    super("INVALID_PROJECT_AUTH_TOKEN");
    this.name = "ProjectAuthTokenError";
  }
}

export class ProjectAuthTokenService {
  private readonly publicKeys = new Map<string, KeyObject>();
  private readonly publicJwks = new Map<string, JsonWebKey & { kid: string; alg: "EdDSA"; use: "sig" }>();

  constructor(
    private readonly current: { kid: string; privateKey: KeyObject },
    private readonly issuerBaseUrl: string,
    previousJwks: JsonWebKey[] = [],
    private readonly accessTtlSeconds = 15 * 60,
  ) {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(current.kid) ||
        !/^https:\/\//.test(issuerBaseUrl) || accessTtlSeconds < 60 || accessTtlSeconds > 3600) {
      throw new ProjectAuthTokenError();
    }
    this.addPublicKey(current.kid, createPublicKey(current.privateKey));
    for (const jwk of previousJwks) {
      const kid = typeof jwk.kid === "string" ? jwk.kid : "";
      if (!/^[A-Za-z0-9._-]{1,80}$/.test(kid) || jwk.kty !== "OKP" || jwk.crv !== "Ed25519") {
        throw new ProjectAuthTokenError();
      }
      this.addPublicKey(kid, createPublicKey({ key: jwk, format: "jwk" }));
    }
  }

  issue(scope: ProjectAuthScope, user: ProjectAuthUser, session: ProjectAuthSession, now = new Date()): ProjectAuthIssuedAccess {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const claims: ProjectAuthAccessClaims = {
      iss: issuer(scope, this.issuerBaseUrl), aud: audience(scope), sub: user.id,
      exp: issuedAt + this.accessTtlSeconds, iat: issuedAt, nbf: issuedAt - 5,
      jti: randomUUID(), token_use: "access", project_id: scope.projectId,
      environment: scope.environment, role: "authenticated", email: user.email,
      email_verified: Boolean(user.emailVerifiedAt), aal: session.assurance, session_id: session.id,
      user_metadata: safeMetadata(user.userMetadata), app_metadata: safeMetadata(user.appMetadata),
    };
    const header = { alg: "EdDSA", typ: "JWT", kid: this.current.kid };
    const encodedHeader = encodeJson(header);
    const encodedClaims = encodeJson(claims);
    const signingInput = `${encodedHeader}.${encodedClaims}`;
    const signature = sign(null, Buffer.from(signingInput, "utf8"), this.current.privateKey).toString("base64url");
    return {
      accessToken: `${signingInput}.${signature}`,
      accessTokenExpiresAt: new Date(claims.exp * 1000),
    };
  }

  verify(token: string, scope: ProjectAuthScope, now = new Date()): ProjectAuthAccessClaims {
    if (token.length > 16_384) throw new ProjectAuthTokenError();
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
      throw new ProjectAuthTokenError();
    }
    const decodedParts = parts.map(decodeBase64UrlCanonical);
    const header = decodeJson(parts[0]);
    const claims = decodeJson(parts[1]);
    const kid = header.kid;
    if (header.alg !== "EdDSA" || header.typ !== "JWT" || typeof kid !== "string") {
      throw new ProjectAuthTokenError();
    }
    const key = this.publicKeys.get(kid);
    if (!key || !verify(null, Buffer.from(`${parts[0]}.${parts[1]}`, "utf8"), key, decodedParts[2])) {
      throw new ProjectAuthTokenError();
    }
    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (!isClaims(claims) || claims.iss !== issuer(scope, this.issuerBaseUrl) || claims.aud !== audience(scope) ||
        claims.project_id !== scope.projectId || claims.environment !== scope.environment ||
        claims.exp <= nowSeconds || claims.nbf > nowSeconds + 5 || claims.iat > nowSeconds + 5 ||
        claims.exp - claims.iat > this.accessTtlSeconds + 5) {
      throw new ProjectAuthTokenError();
    }
    return claims;
  }

  jwks(): { keys: Array<JsonWebKey & { kid: string; alg: "EdDSA"; use: "sig" }> } {
    return { keys: [...this.publicJwks.values()].map((key) => ({ ...key })) };
  }

  private addPublicKey(kid: string, key: KeyObject): void {
    if (this.publicKeys.has(kid)) throw new ProjectAuthTokenError();
    const jwk = key.export({ format: "jwk" });
    this.publicKeys.set(kid, key);
    this.publicJwks.set(kid, { ...jwk, kid, alg: "EdDSA", use: "sig" });
  }
}

export function projectAuthTokenServiceFromEnv(env: Readonly<Record<string, string | undefined>> = process.env) {
  const kid = env.QKERN_PROJECT_AUTH_SIGNING_KEY_ID?.trim() || "development-ephemeral";
  const encoded = env.QKERN_PROJECT_AUTH_SIGNING_PRIVATE_KEY_BASE64?.trim();
  if (env.NODE_ENV === "production" && !encoded) {
    throw new ProjectAuthTokenError();
  }
  const privateKey = encoded
    ? createPrivateKey({ key: Buffer.from(encoded, "base64"), format: "der", type: "pkcs8" })
    : generateKeyPairSync("ed25519").privateKey;
  const previous = parsePreviousJwks(env.QKERN_PROJECT_AUTH_PREVIOUS_JWKS_JSON);
  const issuerBase = normalizedIssuerBase(
    env.QKERN_PROJECT_AUTH_ISSUER_BASE_URL ?? env.NEXT_PUBLIC_APP_URL,
    env.NODE_ENV === "production",
  );
  const ttl = numberSetting(env.QKERN_PROJECT_AUTH_ACCESS_TTL_SECONDS, 900, 60, 3600);
  return new ProjectAuthTokenService({ kid, privateKey }, issuerBase, previous, ttl);
}

export function hashProjectAuthToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

function issuer(scope: ProjectAuthScope, base: string): string {
  return `${base}/api/v1/projects/${scope.projectId}/environments/${scope.environment}/auth`;
}

function audience(scope: ProjectAuthScope): string {
  return `qkern:${scope.projectId}:${scope.environment}`;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeJson(encoded: string): Record<string, unknown> {
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    return value as Record<string, unknown>;
  } catch {
    throw new ProjectAuthTokenError();
  }
}

function decodeBase64UrlCanonical(encoded: string): Buffer {
  try {
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.length < 1 || decoded.toString("base64url") !== encoded) throw new Error("invalid");
    return decoded;
  } catch {
    throw new ProjectAuthTokenError();
  }
}

function isClaims(value: Record<string, unknown>): value is ProjectAuthAccessClaims {
  return typeof value.iss === "string" && typeof value.aud === "string" && typeof value.sub === "string" &&
    typeof value.exp === "number" && typeof value.iat === "number" && typeof value.nbf === "number" &&
    typeof value.jti === "string" && value.token_use === "access" && typeof value.project_id === "string" &&
    ["development", "staging", "production"].includes(String(value.environment)) &&
    value.role === "authenticated" && typeof value.email === "string" &&
    typeof value.email_verified === "boolean" && ["aal1", "aal2"].includes(String(value.aal)) &&
    typeof value.session_id === "string" && isObject(value.user_metadata) && isObject(value.app_metadata);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const encoded = JSON.stringify(metadata);
  if (Buffer.byteLength(encoded, "utf8") > 512) throw new ProjectAuthTokenError();
  return JSON.parse(encoded) as Record<string, unknown>;
}

function parsePreviousJwks(value: string | undefined): JsonWebKey[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { keys?: unknown }).keys) ||
        (parsed as { keys: unknown[] }).keys.length > 5) throw new Error("invalid");
    return (parsed as { keys: JsonWebKey[] }).keys;
  } catch {
    throw new ProjectAuthTokenError();
  }
}

function normalizedIssuerBase(value: string | undefined, production: boolean): string {
  const fallback = production ? "" : "http://localhost:3000";
  try {
    const url = new URL(value?.trim() || fallback);
    const localHttp = !production && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !localHttp) || url.username || url.password || url.search || url.hash) throw new Error("invalid");
    return url.origin;
  } catch {
    throw new ProjectAuthTokenError();
  }
}

function numberSetting(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new ProjectAuthTokenError();
  return parsed;
}
