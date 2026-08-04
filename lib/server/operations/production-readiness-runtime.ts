import { createReleaseEvidenceVerifierFromEnv } from
  "@/lib/server/operations/release-evidence-readiness-runtime";
import type { ReleaseEvidenceVerifier } from
  "@/lib/server/operations/release-evidence-readiness";
import { createRuntimeDeploymentVerifierFromEnv } from
  "@/lib/server/operations/runtime-deployment-runtime";
import type { RuntimeDeploymentVerifier } from
  "@/lib/server/operations/runtime-deployment";
import {
  ProductionEnvironmentVerifier,
  ProductionReadinessVerifier,
} from "@/lib/server/operations/production-readiness";

export function createProductionReadinessVerifierFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: {
    runtimeDeploymentVerifier?: RuntimeDeploymentVerifier;
    releaseEvidenceVerifier?: ReleaseEvidenceVerifier;
  } = {},
): ProductionReadinessVerifier {
  return new ProductionReadinessVerifier(
    new ProductionEnvironmentVerifier(env),
    dependencies.runtimeDeploymentVerifier ??
      createRuntimeDeploymentVerifierFromEnv(env),
    dependencies.releaseEvidenceVerifier ??
      createReleaseEvidenceVerifierFromEnv(env),
  );
}

