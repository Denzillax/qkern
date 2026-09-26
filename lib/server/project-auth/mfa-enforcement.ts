import type { ProjectAuthAssurance } from "@/lib/server/project-auth/model";

/**
 * Die Entscheidung, ob eine Anmeldung ohne zweiten Faktor eine brauchbare
 * Sitzung ergeben darf (2.52).
 *
 * Das Modul ist rein: keine Datenbank, kein Zeitbegriff, kein React. Genau
 * darum steht die Entscheidung hier und nicht verstreut im Dienst — sie ist
 * der tragende Teil dieses Slices und muss einzeln pruefbar sein.
 *
 * Zwei Fragen, zwei Funktionen:
 *
 * 1. `projectAuthMfaOutcome` beantwortet eine frische Anmeldung: Wer einen
 *    bestaetigten Faktor hat, bekommt eine Challenge, egal ob die Umgebung
 *    den Faktor verlangt. Wer keinen hat, bekommt eine Sitzung — ausser die
 *    Umgebung verlangt ihn; dann bekommt er den Einrichtungsschein.
 * 2. `projectAuthSessionUsable` beantwortet eine schon bestehende Sitzung:
 *    Wird der Faktor verlangt, ist nur `aal2` brauchbar. Das trifft die
 *    Sitzungen, die vor dem Einschalten des Schalters entstanden sind; ohne
 *    diese zweite Frage lebten sie bis zum Ablauf ihres Refresh Tokens
 *    weiter, und der steht auf 30 Tagen.
 *
 * Ein eingerichteter, aber nie bestaetigter Faktor zaehlt nicht. Bestaetigt
 * heisst: Der Nutzer hat einmal einen gueltigen Code eingegeben; erst dann
 * ist bewiesen, dass er das Geheimnis wirklich in seiner App hat.
 */
export type ProjectAuthMfaOutcome = "session" | "challenge" | "enrollment_required";

export type ProjectAuthMfaEnforcementInput = {
  /** Was die Umgebung verlangt. */
  required: boolean;
  /** Der Faktor des Nutzers, oder null. Nur `verifiedAt` zaehlt. */
  factor: { verifiedAt: Date | null } | null;
};

export function projectAuthMfaOutcome(input: ProjectAuthMfaEnforcementInput): ProjectAuthMfaOutcome {
  if (input.factor?.verifiedAt) return "challenge";
  return input.required ? "enrollment_required" : "session";
}

export function projectAuthSessionUsable(input: {
  required: boolean;
  assurance: ProjectAuthAssurance;
}): boolean {
  return !input.required || input.assurance === "aal2";
}
