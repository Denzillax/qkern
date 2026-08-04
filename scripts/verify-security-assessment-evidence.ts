import { createSecurityAssessmentEvidenceVerifierFromEnv } from
  "@/lib/server/security/security-assessment-evidence-runtime";

async function main(): Promise<void> {
  try {
    const readiness = await createSecurityAssessmentEvidenceVerifierFromEnv().verify();
    process.stdout.write(`${JSON.stringify({
      data: { securityAssessmentEvidenceReadiness: readiness },
    })}\n`);
  } catch {
    process.stderr.write(`${JSON.stringify({
      error: "Security assessment evidence is not ready",
      code: "SECURITY_ASSESSMENT_EVIDENCE_NOT_READY",
    })}\n`);
    process.exitCode = 1;
  }
}

void main();
