import { createProviderE2EEvidenceVerifierFromEnv } from
  "@/lib/server/operations/provider-e2e-evidence-runtime";

async function main(): Promise<void> {
  try {
    const readiness = await createProviderE2EEvidenceVerifierFromEnv().verify();
    process.stdout.write(`${JSON.stringify({
      data: { providerE2EEvidenceReadiness: readiness },
    })}\n`);
  } catch {
    process.stderr.write(`${JSON.stringify({
      error: "Provider E2E evidence is not ready",
      code: "PROVIDER_E2E_EVIDENCE_NOT_READY",
    })}\n`);
    process.exitCode = 1;
  }
}

void main();
