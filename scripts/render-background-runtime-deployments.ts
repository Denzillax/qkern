import { serializeRuntimeDeploymentBundle } from
  "@/lib/server/operations/runtime-deployment";
import { runtimeDeploymentOptionsFromEnv } from
  "@/lib/server/operations/runtime-deployment-runtime";

try {
  process.stdout.write(serializeRuntimeDeploymentBundle(runtimeDeploymentOptionsFromEnv()));
} catch {
  process.stderr.write(`${JSON.stringify({
    error: "Background runtime deployment rendering failed",
    code: "RUNTIME_DEPLOYMENT_RENDER_FAILED",
  })}\n`);
  process.exitCode = 1;
}
