import { ConfigurationError } from "@/lib/server/db/errors";
import {
  BackupRestoreEvidenceVerifier,
  backupRestoreEvidenceFileReader,
  backupRestoreVerifierKeyFileReader,
  type BackupRestoreEvidenceFileProvider,
} from "@/lib/server/backup/restore-evidence";

export function createBackupRestoreEvidenceVerifierFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: {
    evidenceProvider?: BackupRestoreEvidenceFileProvider;
    keyProvider?: BackupRestoreEvidenceFileProvider;
    now?: () => Date;
  } = {},
): BackupRestoreEvidenceVerifier {
  if (env.QKERN_BACKUP_RESTORE_EVIDENCE?.trim() ||
      env.QKERN_BACKUP_RESTORE_VERIFIER_KEY?.trim()) {
    throw new ConfigurationError("Inline backup/restore evidence authority is forbidden.");
  }
  const evidencePath = env.QKERN_BACKUP_RESTORE_EVIDENCE_FILE?.trim() ?? "";
  const keyPath = env.QKERN_BACKUP_RESTORE_VERIFIER_KEY_FILE?.trim() ?? "";
  if (evidencePath && keyPath && evidencePath === keyPath) {
    throw new ConfigurationError("Backup/restore evidence and verifier key files must be distinct.");
  }
  const authorityPaths = [
    env.QKERN_VAULT_TOKEN_FILE,
    env.QKERN_PROVISIONING_BROKER_SIGNING_KEY_FILE,
    env.QKERN_PROVISIONING_METRICS_TOKEN_FILE,
    env.QKERN_APPLY_BROKER_SIGNING_KEY_FILE,
    env.QKERN_INCIDENT_WEBHOOK_SIGNING_KEY_FILE,
    env.QKERN_PRODUCTION_APPLY_AUTHORIZATION_FILE,
    env.QKERN_PRODUCTION_APPLY_VERIFIER_KEY_FILE,
    env.QKERN_PROVIDER_E2E_EVIDENCE_FILE,
    env.QKERN_PROVIDER_E2E_VERIFIER_KEY_FILE,
    env.QKERN_SECURITY_ASSESSMENT_EVIDENCE_FILE,
    env.QKERN_SECURITY_ASSESSMENT_VERIFIER_KEY_FILE,
    env.QKERN_RELEASE_ARTIFACT_FILE,
  ].map((candidate) => candidate?.trim()).filter(Boolean);
  if ((evidencePath && authorityPaths.includes(evidencePath)) ||
      (keyPath && authorityPaths.includes(keyPath))) {
    throw new ConfigurationError(
      "Backup/restore verification files cannot reuse another authority path.",
    );
  }
  const production = env.NODE_ENV === "production";
  return new BackupRestoreEvidenceVerifier(
    dependencies.evidenceProvider ?? backupRestoreEvidenceFileReader(evidencePath, production),
    dependencies.keyProvider ?? backupRestoreVerifierKeyFileReader(keyPath, production),
    env.QKERN_BACKUP_RESTORE_VERIFIER_KEY_SHA256?.trim() ?? "",
    dependencies.now,
  );
}
