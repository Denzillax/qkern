import {
  PROJECT_AUTH_MAIL_INTROS,
  PROJECT_AUTH_MAIL_SUBJECTS,
  projectAuthMailBody,
} from "@/lib/server/project-auth/smtp-delivery";
import type { ProjectAuthDeliveryPurpose } from "@/lib/server/project-auth/service";

/**
 * Was der Mailweg von Project Auth heute wirklich ist (2.54) — als Lesewert,
 * nicht als Einstellung.
 *
 * Der Platzhalter versprach zwei Seiten: SMTP und E-Mail-Vorlagen. Beide
 * werden hier ehrlich beantwortet statt erfunden:
 *
 * - **SMTP** liegt in der Umgebung des Prozesses
 *   (`QKERN_PROJECT_AUTH_SMTP_*`), nicht in der Datenbank und nicht je
 *   Projekt. Eine Console, die daran schriebe, schriebe ins Leere: der Dienst
 *   liest die Werte beim Start und baut daraus einen Adapter. Also gibt es
 *   hier keinen Schreibweg, sondern eine Ansicht mit Herkunft je Wert.
 * - **Vorlagen** gibt es nicht. Die drei Aktionsmails haben einen festen
 *   Text, auf Englisch, ohne Sprachvarianten. Aendern heisst: Quelltext
 *   aendern und ausliefern.
 *
 * Das Passwort verlaesst dieses Modul nie, auch nicht gekuerzt, und es gibt
 * keine zusammengesetzte Verbindungszeichenkette: Eine DSN mit Benutzer und
 * Passwort waere genau das, was aus einer Leseansicht ein Leck macht. Was
 * herausgeht, ist Host, Port, Transportsicherheit, Absender, Aktionsadresse
 * und die Frage, ob ueberhaupt angemeldet wird — ja oder nein.
 *
 * Das Modul ist rein: kein Netz, keine Datenbank, kein React. Es bekommt die
 * Umgebung als Argument und gibt einen Wert zurueck.
 */

/** Woher ein Wert stammt. */
export type ProjectAuthMailOrigin = "environment" | "default" | "unset";

export type ProjectAuthMailValue = {
  /** Der Wert, oder null, wenn es keinen gibt. Nie ein Geheimnis. */
  value: string | null;
  origin: ProjectAuthMailOrigin;
};

/** Wie Mails heute hinausgehen, wenn ueberhaupt. */
export type ProjectAuthMailMode = "smtp" | "development_noop" | "disabled";

export type ProjectAuthMailTemplate = {
  purpose: ProjectAuthDeliveryPurpose;
  subject: string;
  intro: string;
  /** Der volle Rumpf, mit einem Beispiel-Link und einer Beispiel-Frist. */
  body: string;
};

export type ProjectAuthMailSettings = {
  mode: ProjectAuthMailMode;
  host: ProjectAuthMailValue;
  port: ProjectAuthMailValue;
  security: ProjectAuthMailValue;
  sender: ProjectAuthMailValue;
  actionBaseUrl: ProjectAuthMailValue;
  /** Ob der Dienst sich am Mailserver anmeldet. Nie mit welchem Namen. */
  authenticated: boolean;
  /** Ob die Texte aus der Console aenderbar sind. Heute: nein. */
  templatesEditable: false;
  /** Die Sprachen, die es gibt. Heute genau eine. */
  languages: readonly string[];
  templates: readonly ProjectAuthMailTemplate[];
};

/** Der Port, den der Adapter ohne ausdruecklichen Wert nimmt. */
function defaultPort(security: string): string {
  return security === "implicit_tls" ? "465" : "587";
}

/** Ein Beispiel-Link fuer die Vorschau. Er traegt nie ein echtes Token. */
const SAMPLE_TOKEN = "qk_example_token";
const SAMPLE_EXPIRY = new Date("2026-01-01T00:00:00.000Z");

function sampleLink(base: string | null, purpose: ProjectAuthDeliveryPurpose): string {
  const raw = base ?? "https://app.example/auth/action";
  try {
    const url = new URL(raw);
    url.searchParams.set("token", SAMPLE_TOKEN);
    url.searchParams.set("type", purpose);
    url.searchParams.set("redirect_to", "https://app.example/willkommen");
    return url.toString();
  } catch {
    return raw;
  }
}

export function projectAuthMailTemplates(actionBaseUrl: string | null): ProjectAuthMailTemplate[] {
  const purposes: ProjectAuthDeliveryPurpose[] = ["email_verification", "magic_link", "password_reset"];
  return purposes.map((purpose) => ({
    purpose,
    subject: PROJECT_AUTH_MAIL_SUBJECTS[purpose],
    intro: PROJECT_AUTH_MAIL_INTROS[purpose],
    body: projectAuthMailBody(purpose, sampleLink(actionBaseUrl, purpose), SAMPLE_EXPIRY),
  }));
}

export function projectAuthMailSettings(
  env: Readonly<Record<string, string | undefined>>,
): ProjectAuthMailSettings {
  const host = env.QKERN_PROJECT_AUTH_SMTP_HOST?.trim() || null;
  const sender = env.QKERN_PROJECT_AUTH_SMTP_SENDER?.trim() || null;
  const base = env.QKERN_PROJECT_AUTH_ACTION_BASE_URL?.trim() || null;
  const rawSecurity = env.QKERN_PROJECT_AUTH_SMTP_SECURITY?.trim() || null;
  const security = rawSecurity ?? "starttls";
  const rawPort = env.QKERN_PROJECT_AUTH_SMTP_PORT?.trim() || null;
  // Dieselbe Reihenfolge wie in `smtpProjectAuthDeliveryFromEnv`: ohne Host
  // gibt es keinen SMTP-Adapter. Dann entscheidet die Entwickler-Abkuerzung,
  // ob Mails still verschwinden oder ob der Dienst gar kein Token ausgibt.
  const mode: ProjectAuthMailMode = host
    ? "smtp"
    : env.QKERN_PROJECT_AUTH_DEV_EXPOSE_TOKENS === "true" ? "development_noop" : "disabled";
  const both = env.QKERN_PROJECT_AUTH_SMTP_USERNAME !== undefined &&
    env.QKERN_PROJECT_AUTH_SMTP_PASSWORD !== undefined;
  return {
    mode,
    host: { value: host, origin: host ? "environment" : "unset" },
    port: rawPort
      ? { value: rawPort, origin: "environment" }
      : { value: host ? defaultPort(security) : null, origin: host ? "default" : "unset" },
    security: rawSecurity
      ? { value: rawSecurity, origin: "environment" }
      : { value: host ? "starttls" : null, origin: host ? "default" : "unset" },
    sender: { value: sender, origin: sender ? "environment" : "unset" },
    actionBaseUrl: { value: base, origin: base ? "environment" : "unset" },
    authenticated: mode === "smtp" && both,
    templatesEditable: false,
    languages: ["en"],
    templates: projectAuthMailTemplates(base),
  };
}
