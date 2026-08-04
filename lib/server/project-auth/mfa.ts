import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export class ProjectAuthMfaError extends Error {
  constructor() {
    super("PROJECT_AUTH_MFA_ERROR");
    this.name = "ProjectAuthMfaError";
  }
}

export class ProjectAuthSecretProtector {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new ProjectAuthMfaError();
  }

  encrypt(secret: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return ["v1", nonce.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
  }

  decrypt(encrypted: string): string {
    try {
      const [version, nonce, ciphertext, tag, extra] = encrypted.split(".");
      if (version !== "v1" || extra !== undefined) throw new Error("invalid");
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(nonce, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new ProjectAuthMfaError();
    }
  }

  recoveryHash(code: string): string {
    return createHmac("sha256", this.key).update(normalizeRecoveryCode(code), "utf8").digest("base64url");
  }
}

export class ProjectAuthTotp {
  createEnrollment(input: { issuer: string; account: string }): {
    secret: string;
    uri: string;
    recoveryCodes: string[];
  } {
    const secret = base32Encode(randomBytes(20));
    const label = `${input.issuer}:${input.account}`;
    const uri = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(input.issuer)}&algorithm=SHA1&digits=6&period=30`;
    const recoveryCodes = Array.from({ length: 10 }, () => {
      const raw = randomBytes(8).toString("hex").toUpperCase();
      return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`;
    });
    return { secret, uri, recoveryCodes };
  }

  verify(secret: string, code: string, now = new Date()): boolean {
    if (!/^\d{6}$/.test(code)) return false;
    const step = Math.floor(now.getTime() / 30_000);
    return [-1, 0, 1].some((offset) => safeEqual(code, totpCode(secret, step + offset)));
  }
}

export function projectAuthSecretProtectorFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProjectAuthSecretProtector {
  const encoded = env.QKERN_PROJECT_AUTH_MFA_ENCRYPTION_KEY?.trim();
  if (env.NODE_ENV === "production" && !encoded) throw new ProjectAuthMfaError();
  const key = encoded ? Buffer.from(encoded, "base64url") : randomBytes(32);
  return new ProjectAuthSecretProtector(key);
}

function totpCode(secret: string, step: number): string {
  try {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
    return binary.toString().padStart(6, "0");
  } catch {
    return "invalid";
  }
}

function base32Encode(input: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of input.replace(/=+$/g, "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new ProjectAuthMfaError();
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeRecoveryCode(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}
