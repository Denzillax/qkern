import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

export interface PasswordHasher {
  readonly dummyHash: string;
  hash(password: string): Promise<string>;
  verify(password: string, encodedHash: string): Promise<boolean>;
}

type Argon2idOptions = {
  memoryKiB?: number;
  passes?: number;
  parallelism?: number;
  tagLength?: number;
  pepper?: string | Buffer;
};

type ParsedHash = {
  memory: number;
  passes: number;
  parallelism: number;
  salt: Buffer;
  tag: Buffer;
};

const DUMMY_HASH = "$argon2id$v=19$m=65536,t=3,p=4$cWtlcm4tZHVtbXktc2FsdA$m+VcteNKOL2bwkXlskMpPADKcK/rsmRqCxFFWh4HJTw";

function phcBase64Encode(value: Buffer): string {
  return value.toString("base64").replace(/=+$/, "");
}

function parseHash(value: string): ParsedHash | null {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(value);
  if (!match) return null;

  const memory = Number(match[1]);
  const passes = Number(match[2]);
  const parallelism = Number(match[3]);
  const salt = Buffer.from(match[4], "base64");
  const tag = Buffer.from(match[5], "base64");
  if (
    !Number.isSafeInteger(memory) || memory < 32 || memory > 1_048_576 ||
    !Number.isSafeInteger(passes) || passes < 2 || passes > 10 ||
    !Number.isSafeInteger(parallelism) || parallelism < 2 || parallelism > 16 ||
    salt.length < 16 || tag.length < 16 || tag.length > 128
  ) return null;

  return { memory, passes, parallelism, salt, tag };
}

function derive(
  password: string,
  parameters: { memory: number; passes: number; parallelism: number; salt: Buffer; tagLength: number },
  pepper?: string | Buffer,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2("argon2id", {
      message: password,
      nonce: parameters.salt,
      memory: parameters.memory,
      passes: parameters.passes,
      parallelism: parameters.parallelism,
      tagLength: parameters.tagLength,
      ...(pepper ? { secret: pepper } : {}),
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/** Native Node.js Argon2id (available since Node 24.7). */
export class Argon2idPasswordHasher implements PasswordHasher {
  readonly dummyHash = DUMMY_HASH;
  private readonly memoryKiB: number;
  private readonly passes: number;
  private readonly parallelism: number;
  private readonly tagLength: number;
  private readonly pepper?: string | Buffer;

  constructor(options: Argon2idOptions = {}) {
    this.memoryKiB = options.memoryKiB ?? 65_536;
    this.passes = options.passes ?? 3;
    this.parallelism = options.parallelism ?? 4;
    this.tagLength = options.tagLength ?? 32;
    this.pepper = options.pepper;
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const tag = await derive(password, {
      memory: this.memoryKiB,
      passes: this.passes,
      parallelism: this.parallelism,
      salt,
      tagLength: this.tagLength,
    }, this.pepper);
    return `$argon2id$v=19$m=${this.memoryKiB},t=${this.passes},p=${this.parallelism}$${phcBase64Encode(salt)}$${phcBase64Encode(tag)}`;
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    const parsed = parseHash(encodedHash);
    if (!parsed) return false;
    try {
      const actual = await derive(password, {
        memory: parsed.memory,
        passes: parsed.passes,
        parallelism: parsed.parallelism,
        salt: parsed.salt,
        tagLength: parsed.tag.length,
      }, this.pepper);
      return actual.length === parsed.tag.length && timingSafeEqual(actual, parsed.tag);
    } catch {
      return false;
    }
  }
}
