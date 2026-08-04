import { createBackupRestoreEvidenceVerifierFromEnv } from
  "@/lib/server/backup/restore-evidence-runtime";

async function main(): Promise<void> {
  try {
    const verifier = createBackupRestoreEvidenceVerifierFromEnv();
    const readiness = await verifier.verify();
    process.stdout.write(`${JSON.stringify({ data: { backupRestoreReadiness: readiness } })}\n`);
  } catch {
    process.stderr.write(`${JSON.stringify({
      error: "Backup/restore evidence is not ready",
      code: "BACKUP_RESTORE_EVIDENCE_NOT_READY",
    })}\n`);
    process.exitCode = 1;
  }
}

void main();
