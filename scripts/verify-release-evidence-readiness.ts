import { createReleaseEvidenceVerifierFromEnv } from
  "@/lib/server/operations/release-evidence-readiness-runtime";

async function main(): Promise<void> {
  try {
    const readiness = await createReleaseEvidenceVerifierFromEnv().verify();
    process.stdout.write(`${JSON.stringify({
      data: { releaseEvidenceReadiness: readiness },
    })}\n`);
  } catch {
    process.stderr.write(`${JSON.stringify({
      error: "Release evidence is not ready",
      code: "RELEASE_EVIDENCE_NOT_READY",
    })}\n`);
    process.exitCode = 1;
  }
}

void main();
