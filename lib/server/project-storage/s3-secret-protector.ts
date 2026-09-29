import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { recognisedByName } from "@/lib/server/errors/identity";
import { ConfigurationError } from "@/lib/server/db/errors";

/**
 * Das Geheimnis eines S3-Schluesselpaars, verschluesselt abgelegt (2.96).
 *
 * Bis 2.65 lag nur der SHA-256-Hash, und die Seite sagte darum ehrlich, dass
 * kein Endpunkt das Paar annimmt: Eine SigV4-Signatur ist eine HMAC-Kette aus
 * dem Geheimnis, und aus einem Hash kommt es nicht zurueck. Der Endpunkt
 * braucht es also. Es liegt jetzt AES-256-GCM-verschluesselt in
 * `secret_ciphertext`, gebunden an den oeffentlichen Teil des Paars, damit ein
 * Chiffrat nicht an eine andere Zeile wandern kann. Der Schluessel dazu kommt
 * aus `QKERN_PROJECT_STORAGE_S3_KEY_ENCRYPTION_KEY` und liegt nie in der
 * Datenbank.
 *
 * Ohne diesen Schluessel gibt es weiterhin Paare, aber ohne Chiffrat; sie
 * oeffnen nichts, und die Seite sagt es je Paar.
 */
export class ProjectStorageS3SecretError extends Error {
  constructor() {
    super("PROJECT_STORAGE_S3_SECRET_ERROR");
    this.name = "ProjectStorageS3SecretError";
  }
}
recognisedByName(ProjectStorageS3SecretError, "ProjectStorageS3SecretError");

export const S3_SECRET_CIPHERTEXT = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9_-]{22}$/;

export class ProjectStorageS3SecretProtector {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new ProjectStorageS3SecretError();
  }

  encrypt(secret: string, accessKeyId: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(accessKeyId, "utf8"));
    const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return ["v1", nonce.toString("base64url"), encrypted.toString("base64url"),
      cipher.getAuthTag().toString("base64url")].join(".");
  }

  decrypt(ciphertext: string, accessKeyId: string): string {
    try {
      const [version, nonce, encrypted, tag, extra] = ciphertext.split(".");
      if (version !== "v1" || extra !== undefined) throw new Error("invalid");
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(nonce, "base64url"));
      decipher.setAAD(Buffer.from(accessKeyId, "utf8"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      throw new ProjectStorageS3SecretError();
    }
  }
}

/**
 * `undefined`, wenn kein Schluessel gesetzt ist: Dann werden Paare ohne
 * Chiffrat ausgegeben, und der Endpunkt nimmt keines an. In Produktion ist
 * ein fehlender Schluessel ein Konfigurationsfehler, kein stiller Rueckfall.
 */
export function projectStorageS3SecretProtectorFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProjectStorageS3SecretProtector | undefined {
  const encoded = env.QKERN_PROJECT_STORAGE_S3_KEY_ENCRYPTION_KEY?.trim();
  if (!encoded) {
    if (env.NODE_ENV === "production" && env.QKERN_PROJECT_STORAGE_ENABLED === "true") {
      throw new ConfigurationError(
        "QKERN_PROJECT_STORAGE_S3_KEY_ENCRYPTION_KEY is required for Project Storage in production.",
      );
    }
    return undefined;
  }
  const key = /^[a-f0-9]{64}$/i.test(encoded) ? Buffer.from(encoded, "hex") : Buffer.from(encoded, "base64url");
  if (key.byteLength !== 32) {
    throw new ConfigurationError(
      "QKERN_PROJECT_STORAGE_S3_KEY_ENCRYPTION_KEY must be 32 bytes encoded as hex or base64url.",
    );
  }
  return new ProjectStorageS3SecretProtector(key);
}
