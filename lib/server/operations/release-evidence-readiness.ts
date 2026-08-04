import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ConfigurationError } from "@/lib/server/db/errors";

const SHA256 = /^[a-f0-9]{64}$/;
const MIN_FILE_BYTES = 2;
const MAX_RELEASE_ARTIFACT_BYTES = 100 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 64 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

export type ReleaseEvidenceExpectation = Readonly<{
  releaseArtifactSha256: string;
  backupRestoreEvidenceSha256: string;
  runtimeDeploymentEvidenceSha256: string;
  providerE2EEvidenceSha256: string;
  securityAssessmentSha256: string;
}>;

export type ReleaseEvidenceReadiness = Readonly<{
  status: "ready";
  deployment: "production";
  scope: "release_evidence";
  evidenceCount: 4;
  artifactCount: 5;
}>;

export interface ReleaseEvidenceComponentVerifier {
  verify(signal?: AbortSignal): Promise<unknown>;
}

export interface ReleaseEvidenceDigestProvider {
  digest(options?: { signal?: AbortSignal }): string | Promise<string>;
}

export class ReleaseEvidenceNotReadyError extends Error {
  readonly code = "RELEASE_EVIDENCE_NOT_READY";

  constructor() {
    super("Release evidence is not ready.");
    this.name = "ReleaseEvidenceNotReadyError";
  }
}

/** Hashes one immutable release input from an already no-follow-opened file. */
export class ReleaseEvidenceFileDigester
implements ReleaseEvidenceDigestProvider {
  constructor(
    private readonly path: string,
    private readonly maxBytes: number,
    private readonly production = false,
  ) {
    if (!path.startsWith("/") || path.length > 1_024 || path.includes("\0") ||
        !Number.isSafeInteger(maxBytes) || maxBytes < MIN_FILE_BYTES) {
      throw new ConfigurationError(
        "Release evidence digest files require bounded absolute paths.",
      );
    }
  }

  async digest(options: { signal?: AbortSignal } = {}): Promise<string> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      if (options.signal?.aborted) throw new Error("Aborted");
      handle = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const metadata = await handle.stat();
      if (!metadata.isFile() ||
          metadata.size < MIN_FILE_BYTES ||
          metadata.size > this.maxBytes ||
          (this.production && (metadata.mode & 0o022) !== 0)) {
        throw new Error("Invalid release input");
      }
      const hash = createHash("sha256");
      const buffer = Buffer.alloc(Math.min(READ_CHUNK_BYTES, metadata.size));
      let position = 0;
      while (position < metadata.size) {
        if (options.signal?.aborted) throw new Error("Aborted");
        const length = Math.min(buffer.length, metadata.size - position);
        const result = await handle.read(buffer, 0, length, position);
        if (result.bytesRead !== length) throw new Error("Incomplete release input");
        hash.update(buffer.subarray(0, result.bytesRead));
        position += result.bytesRead;
      }
      return hash.digest("hex");
    } catch {
      throw new ReleaseEvidenceNotReadyError();
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}

export function releaseArtifactFileDigester(
  path: string,
  production = false,
): ReleaseEvidenceFileDigester {
  return new ReleaseEvidenceFileDigester(
    path,
    MAX_RELEASE_ARTIFACT_BYTES,
    production,
  );
}

export function releaseEvidenceFileDigester(
  path: string,
  production = false,
): ReleaseEvidenceFileDigester {
  return new ReleaseEvidenceFileDigester(path, MAX_EVIDENCE_BYTES, production);
}

export class ReleaseEvidenceVerifier {
  private readonly expectedPins: readonly string[];

  constructor(
    private readonly componentVerifiers: readonly ReleaseEvidenceComponentVerifier[],
    private readonly digestProviders: readonly ReleaseEvidenceDigestProvider[],
    expectation: ReleaseEvidenceExpectation,
  ) {
    const pins = expectation && [
      expectation.releaseArtifactSha256,
      expectation.backupRestoreEvidenceSha256,
      expectation.runtimeDeploymentEvidenceSha256,
      expectation.providerE2EEvidenceSha256,
      expectation.securityAssessmentSha256,
    ];
    if (!Array.isArray(componentVerifiers) ||
        componentVerifiers.length !== 4 ||
        componentVerifiers.some((verifier) =>
          !verifier || typeof verifier.verify !== "function") ||
        !Array.isArray(digestProviders) ||
        digestProviders.length !== 5 ||
        digestProviders.some((provider) =>
          !provider || typeof provider.digest !== "function") ||
        !pins ||
        pins.some((pin) => !SHA256.test(pin)) ||
        new Set(pins).size !== 5) {
      throw new ConfigurationError(
        "Release evidence requires four verifiers, five digest providers and five distinct Production Apply pins.",
      );
    }
    this.expectedPins = Object.freeze([...pins]);
  }

  async verify(signal?: AbortSignal): Promise<ReleaseEvidenceReadiness> {
    try {
      const results = await Promise.all([
        ...this.componentVerifiers.map((verifier) => verifier.verify(signal)),
        ...this.digestProviders.map((provider) => provider.digest({ signal })),
      ]);
      if (signal?.aborted) throw new Error("Aborted");
      const digests = results.slice(4);
      if (digests.length !== 5 ||
          digests.some((digest, index) =>
            typeof digest !== "string" || digest !== this.expectedPins[index])) {
        throw new Error("Release artifact pin mismatch");
      }
      return Object.freeze({
        status: "ready",
        deployment: "production",
        scope: "release_evidence",
        evidenceCount: 4,
        artifactCount: 5,
      });
    } catch {
      throw new ReleaseEvidenceNotReadyError();
    }
  }
}
