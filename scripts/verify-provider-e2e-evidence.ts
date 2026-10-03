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
 * **Was hier stehen darf.** Zwei Woerter aus zwei geschlossenen Mengen: der
 * Name einer bekannten Fehlerklasse und der gescheiterte Schritt. **Was
 * nicht:** der Pfad der Evidenzdatei, ihr Inhalt, der Schluesselabdruck und
 * jede Meldung, die davon etwas enthalten koennte. Die Meldung der Ursache wird
 * nie durchgereicht, und ein unbekannter Klassenname wird zu `UnknownError`.
 * Damit bleibt die Ablehnung ursachenfrei im Sinne der Zusage aus 2.23: Es
 * steht nichts darin, was aus einem fremden Text stammen koennte.
 */
/**
 * Die Namen, die hier stehen duerfen, und sonst keiner.
 *
 * Eine geschlossene Menge und nicht `cause.name`: Der Name einer unbekannten
 * Klasse kaeme aus fremdem Code, und was dort steht, weiss dieses Skript nicht.
 * Mit der Menge ist die Ausgabe nachweislich frei von allem, was aus einer
 * Meldung, einem Pfad oder einem Abdruck stammen koennte.
 */
const KNOWN_REASONS = new Set([
  "ProviderE2EEvidenceUnavailableError",
  "ConfigurationError",
]);

const KNOWN_STEPS = new Set([
  "open", "size", "read", "aborted", "envelope", "key", "signature", "readiness", "unknown",
]);

function reasonOf(cause: unknown): Record<string, string> {
  if (!(cause instanceof Error)) return { reason: "UnknownError" };
  const step = (cause as { step?: unknown }).step;
  return {
    reason: KNOWN_REASONS.has(cause.name) ? cause.name : "UnknownError",
    ...(typeof step === "string" && KNOWN_STEPS.has(step) ? { step } : {}),
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
