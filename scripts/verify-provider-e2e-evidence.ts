import { createProviderE2EEvidenceVerifierFromEnv } from
  "@/lib/server/operations/provider-e2e-evidence-runtime";

/**
 * Warum die Ablehnung jetzt einen Grund nennt (2.152).
 *
 * Dieses Skript fing jeden Fehler und schrieb denselben Satz, und der Leser
 * darunter tat dasselbe. Auf dem Ubuntu-Runner faellt der Fall dazu seit 2.23
 * gelegentlich aus; beide Male stand im Protokoll nur, dass die Evidenz nicht
 * bereit sei, und damit liess sich nichts untersuchen. Ein falscher Pfad, eine
 * zu kleine Datei, ein nicht passender Schluessel und eine abgelaufene Frist
 * sahen von aussen gleich aus.
 *
 * **Was hier stehen darf.** Der Name der Fehlerklasse, ihr Code und, wo der
 * Leser ihn kennt, der gescheiterte Schritt in einem Wort. **Was nicht:** der
 * Pfad der Evidenzdatei, ihr Inhalt, der Schluesselabdruck und jede Meldung,
 * die davon etwas enthalten koennte. Darum wird die Meldung der Ursache nicht
 * durchgereicht, sondern nur ihr Name.
 */
function reasonOf(cause: unknown): Record<string, string> {
  if (!(cause instanceof Error)) return { reason: "unknown" };
  const step = (cause as { step?: unknown }).step;
  const code = (cause as { code?: unknown }).code;
  return {
    reason: cause.name,
    ...(typeof code === "string" ? { causeCode: code } : {}),
    ...(typeof step === "string" ? { step } : {}),
  };
}

async function main(): Promise<void> {
  try {
    const readiness = await createProviderE2EEvidenceVerifierFromEnv().verify();
    process.stdout.write(`${JSON.stringify({
      data: { providerE2EEvidenceReadiness: readiness },
    })}\n`);
  } catch (cause) {
    process.stderr.write(`${JSON.stringify({
      error: "Provider E2E evidence is not ready",
      code: "PROVIDER_E2E_EVIDENCE_NOT_READY",
      ...reasonOf(cause),
    })}\n`);
    process.exitCode = 1;
  }
}

void main();
