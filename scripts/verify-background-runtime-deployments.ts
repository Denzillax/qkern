import { createRuntimeDeploymentVerifierFromEnv } from
  "@/lib/server/operations/runtime-deployment-runtime";

async function main(): Promise<void> {
  try {
    const readiness = await createRuntimeDeploymentVerifierFromEnv().verify();
    process.stdout.write(`${JSON.stringify({
      data: { backgroundRuntimeDeploymentReadiness: readiness },
    })}\n`);
  } catch {
    process.stderr.write(`${JSON.stringify({
      error: "Background runtime deployment is not ready",
      code: "RUNTIME_DEPLOYMENT_NOT_READY",
    })}\n`);
    process.exitCode = 1;
  }
}

void main();
