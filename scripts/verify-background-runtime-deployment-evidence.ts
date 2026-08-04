import { createRuntimeDeploymentEvidenceVerifierFromEnv } from
  "@/lib/server/operations/runtime-deployment-evidence-runtime";

async function main(): Promise<void> {
  try {
    const readiness = await createRuntimeDeploymentEvidenceVerifierFromEnv().verify();
    process.stdout.write(`${JSON.stringify({
      data: { backgroundRuntimeDeploymentEvidenceReadiness: readiness },
    })}\n`);
  } catch {
    process.stderr.write(`${JSON.stringify({
      error: "Background runtime deployment evidence is not ready",
      code: "RUNTIME_DEPLOYMENT_EVIDENCE_NOT_READY",
    })}\n`);
    process.exitCode = 1;
  }
}

void main();
