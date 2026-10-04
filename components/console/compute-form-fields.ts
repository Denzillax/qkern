import { t } from "@/components/console/console-i18n";
import type { FormPanelField } from "@/components/console/form-panel";

/**
 * Die Felder fuer Cron-Job, Webhook und Function (2.166), an einer Stelle,
 * weil der Cron-Job aus zwei Ansichten angelegt wird. Beschriftungen und
 * Hinweise sind die Saetze, die vorher in den `window.prompt`-Fenstern standen;
 * die Beispiele daraus sind jetzt Platzhalter.
 */
const COMPUTE_FORM_TEXTS = {
  cronName: "Name des Cron-Jobs (Kleinbuchstaben, Ziffern, Bindestrich)",
  cronExpression: "Ausdruck: fünf Felder, Namen wie MON-FRI oder JAN, oder ein Kürzel wie @daily",
  cronTimeZone: "Zeitzone des Zeitplans (IANA-Name wie Europe/Berlin)",
  cronQueue: "Bestehende Projekt-Queue",
  webhookName: "Name des Webhooks (Kleinbuchstaben, Ziffern, Bindestrich)",
  webhookUrl: "Exaktes öffentliches HTTPS-Ziel, ohne Query und Fragment",
  webhookEvents: "Ereignistypen, kommagetrennt",
  webhookSecret: "Vault-Referenz des Signaturschlüssels, nie das Geheimnis selbst",
  functionName: "Name der Function (Kleinbuchstaben, Ziffern, Bindestrich)",
  functionImage: "Image per Digest, zum Beispiel registry.example.com/app/fn@sha256:…",
  functionEntrypoint: "Entrypoint im Image",
} as const;

/** Fuer den i18n-Vertrag: `t(variable)` sieht er im Quelltext nicht. */
export function computeFormTexts(): string[] {
  return Object.values(COMPUTE_FORM_TEXTS);
}

export function cronFields(): FormPanelField[] {
  return [
    { name: "name", label: t(COMPUTE_FORM_TEXTS.cronName), placeholder: "nightly-report", required: true, mono: true },
    { name: "expression", label: t(COMPUTE_FORM_TEXTS.cronExpression), placeholder: "*/15 * * * *", required: true, mono: true },
    // Die Zeitzone gehoert zum Plan (2.66). Leer heisst UTC, wie bei jedem
    // Plan von vorher; darum ist sie die eine echte Vorbelegung.
    { name: "timeZone", label: t(COMPUTE_FORM_TEXTS.cronTimeZone), initial: "UTC", mono: true },
    { name: "queue", label: t(COMPUTE_FORM_TEXTS.cronQueue), placeholder: "email_jobs", required: true, mono: true },
  ];
}

export function cronBody(values: Record<string, string>): string {
  return JSON.stringify({
    name: values.name.trim(), expression: values.expression.trim(),
    queue: values.queue.trim(), timeZone: values.timeZone.trim() || "UTC",
  });
}

export function webhookFields(): FormPanelField[] {
  return [
    { name: "name", label: t(COMPUTE_FORM_TEXTS.webhookName), placeholder: "order-events", required: true, mono: true },
    { name: "url", label: t(COMPUTE_FORM_TEXTS.webhookUrl), placeholder: "https://receiver.example.com/hooks", required: true, mono: true },
    { name: "events", label: t(COMPUTE_FORM_TEXTS.webhookEvents), placeholder: "order.created", required: true, mono: true },
    // Nur die Referenz. Das Geheimnis selbst liegt im Vault und darf diese
    // Flaeche nie beruehren.
    { name: "signingSecretRef", label: t(COMPUTE_FORM_TEXTS.webhookSecret), placeholder: "vault:webhook/orders", required: true, mono: true },
  ];
}

export function webhookBody(values: Record<string, string>): string {
  return JSON.stringify({
    name: values.name.trim(), url: values.url.trim(),
    eventTypes: values.events.split(",").map((entry) => entry.trim()).filter(Boolean),
    signingSecretRef: values.signingSecretRef.trim(),
  });
}

export function functionFields(): FormPanelField[] {
  return [
    { name: "name", label: t(COMPUTE_FORM_TEXTS.functionName), placeholder: "resize-image", required: true, mono: true },
    // Digest statt Tag: Ein Tag koennte morgen einen anderen Inhalt bezeichnen.
    { name: "image", label: t(COMPUTE_FORM_TEXTS.functionImage), placeholder: "registry.example.com/app/fn@sha256:…", required: true, mono: true },
    { name: "entrypoint", label: t(COMPUTE_FORM_TEXTS.functionEntrypoint), placeholder: "handler.mjs", required: true, mono: true },
  ];
}

export function functionBody(values: Record<string, string>): string {
  return JSON.stringify({ name: values.name.trim(), image: values.image.trim(), entrypoint: values.entrypoint.trim() });
}
