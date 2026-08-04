import { createProductionReadinessVerifierFromEnv } from
  "@/lib/server/operations/production-readiness-runtime";

async function main(): Promise<void> {
  try {
    const readiness = await createProductionReadinessVerifierFromEnv().verify();
    process.stdout.write(`${JSON.stringify({
      data: { productionReadiness: readiness },
    })}\n`);
  } catch {
    process.stderr.write(`${JSON.stringify({
      error: "Production readiness is not ready",
      code: "PRODUCTION_READINESS_NOT_READY",
    })}\n`);
    process.exitCode = 1;
  }
}

void main();
