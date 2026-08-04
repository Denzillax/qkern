import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ProjectAuthOidcCatalog,
  ProjectAuthOidcClient,
  ProjectAuthOidcError,
  type ProjectAuthOidcProvider,
} from "@/lib/server/project-auth/oidc";

const provider: ProjectAuthOidcProvider = {
  id: "example", issuer: "https://identity.example.test",
  authorizationEndpoint: "https://identity.example.test/oauth/authorize",
  tokenEndpoint: "https://identity.example.test/oauth/token",
  jwksUri: "https://identity.example.test/.well-known/jwks.json",
  clientId: "qkern-test-client", scopes: ["openid", "email", "profile"],
};

describe("Project Auth OIDC", () => {
  it("uses authorization code + PKCE and verifies the exact provider JWT without redirects", async () => {
    const identityKey = generateKeyPairSync("ed25519");
    const publicJwk = identityKey.publicKey.export({ format: "jwk" });
    let idToken = "";
    let tokenRequest = "";
    const client = new ProjectAuthOidcClient({}, async (input, init) => {
      expect(init?.redirect).toBe("manual");
      if (String(input) === provider.tokenEndpoint) {
        tokenRequest = String(init?.body);
        return new Response(JSON.stringify({ id_token: idToken }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      if (String(input) === provider.jwksUri) {
        return new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: "provider-key", alg: "EdDSA" }] }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      throw new Error("unexpected URL");
    });
    const authorization = client.createAuthorization(provider, {
      callbackUri: "https://qkern.test/api/auth/callback", state: `qk_oidc_${"a".repeat(43)}`,
    });
    const url = new URL(authorization.url);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("nonce")).toBe(authorization.nonce);
    idToken = jwt(identityKey.privateKey, {
      iss: provider.issuer, aud: provider.clientId, sub: "provider-user-1",
      exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000),
      nonce: authorization.nonce, email: "User@Example.Test", email_verified: true, name: "Example User",
    });
    await expect(client.exchange(provider, {
      code: "authorization-code", codeVerifier: authorization.codeVerifier,
      nonce: authorization.nonce, callbackUri: "https://qkern.test/api/auth/callback",
    })).resolves.toEqual({
      subject: "provider-user-1", email: "user@example.test", emailVerified: true, name: "Example User",
    });
    expect(tokenRequest).toContain("code_verifier=");
    expect(tokenRequest).toContain("grant_type=authorization_code");
  });

  it("rejects unsafe provider endpoints and non-verified emails", async () => {
    expect(() => new ProjectAuthOidcCatalog([{ ...provider, tokenEndpoint: "http://127.0.0.1/token" }]))
      .toThrow(ProjectAuthOidcError);
    const client = new ProjectAuthOidcClient({}, async () => new Response("{}", { status: 500 }));
    await expect(client.verifyIdToken(provider, "not-a-token", "nonce"))
      .rejects.toBeInstanceOf(ProjectAuthOidcError);
  });
});

function jwt(privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"], claims: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: "provider-key" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const input = `${header}.${payload}`;
  return `${input}.${sign(null, Buffer.from(input), privateKey).toString("base64url")}`;
}
