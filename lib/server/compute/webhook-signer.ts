import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookSignerPort } from "@/lib/server/compute/webhooks";

const SECRET_REF = /^[A-Za-z][A-Za-z0-9_./:-]{2,127}$/;
const KEY_ID = /^[A-Za-z0-9._:-]{1,64}$/;
const MIN_SECRET_BYTES = 32;

export type WebhookSigningKey = Readonly<{ keyId: string; secret: Buffer }>;

export interface WebhookSecretProvider {
  /**
   * Löst eine Geheimnisreferenz auf, oder `null`, wenn es sie nicht gibt.
   *
   * Das Geheimnis verlässt diesen Aufruf nur als Material für den HMAC. Es
   * gehört in keine Fehlermeldung, kein Log und keine Antwort.
   */
  resolve(secretRef: string): Promise<WebhookSigningKey | null>;
}

/** Bewusst ohne `cause`: Referenz, Schlüssel und Geheimnis bleiben draußen. */
export class WebhookSigningError extends Error {
  constructor() {
    super("The webhook signing key is unavailable or invalid.");
    this.name = "WebhookSigningError";
  }
}

/**
 * Signiert mit HMAC-SHA256 über `<zeitstempel>.<körper>`.
 *
 * Der Zeitstempel steht **im** signierten Text, nicht nur im Header: Sonst
 * könnte ein Angreifer eine abgefangene Nachricht später erneut senden, und die
 * Signatur wäre weiterhin gültig. Der Empfänger prüft ihn gegen sein eigenes
 * Zeitfenster.
 *
 * Der Schlüssel trägt eine `keyId`, damit ein Empfänger während einer Rotation
 * beide Schlüssel kennen kann, ohne raten zu müssen, mit welchem signiert wurde.
 */
export class HmacWebhookSigner implements WebhookSignerPort {
  constructor(private readonly secrets: WebhookSecretProvider) {}

  async sign(secretRef: string, canonicalPayload: string) {
    if (!SECRET_REF.test(secretRef)) throw new WebhookSigningError();
    let key: WebhookSigningKey | null;
    try {
      key = await this.secrets.resolve(secretRef);
    } catch {
      // Die Ursache kann die Referenz oder eine Vault-Meldung tragen.
      throw new WebhookSigningError();
    }
    if (!key || !KEY_ID.test(key.keyId) || key.secret.length < MIN_SECRET_BYTES) {
      throw new WebhookSigningError();
    }
    return Object.freeze({
      keyId: key.keyId,
      signature: createHmac("sha256", key.secret).update(canonicalPayload, "utf8").digest("base64url"),
    });
  }
}

/**
 * Geheimnisse aus der Umgebung. **Nur für lokale Entwicklung.**
 *
 * Ausdrücklich freizuschalten und in der Produktion abgewiesen: Ein
 * Signaturgeheimnis in einer Umgebungsvariable steht in jedem Prozessabbild und
 * in jeder Container-Definition. Der Vault-gestützte Provider ist noch offen und
 * ist in `docs/CLAUDE_HANDOFF.md` als solcher verzeichnet.
 */
export class EnvWebhookSecretProvider implements WebhookSecretProvider {
  private readonly keys: ReadonlyMap<string, WebhookSigningKey>;

  constructor(env: Readonly<Record<string, string | undefined>> = process.env) {
    if (env.NODE_ENV === "production") {
      throw new WebhookSigningError();
    }
    if (env.QKERN_ALLOW_LOCAL_WEBHOOK_SIGNING_SECRETS !== "true") {
      throw new WebhookSigningError();
    }
    this.keys = parseKeys(env.QKERN_LOCAL_WEBHOOK_SIGNING_SECRETS_JSON);
  }

  async resolve(secretRef: string): Promise<WebhookSigningKey | null> {
    return this.keys.get(secretRef) ?? null;
  }
}

/**
 * Prüft eine Signatur so, wie ein Empfänger es tun sollte.
 *
 * Liegt hier, weil sonst jeder Empfänger — auch die Zertifizierung — den
 * Vergleich selbst schreibt und dabei `===` benutzt. Der Vergleich muss
 * zeitkonstant sein, sonst verrät die Laufzeit die Signatur Zeichen für Zeichen.
 */
export function verifyWebhookSignature(input: {
  secret: Buffer; canonicalPayload: string; signature: string;
}): boolean {
  const expected = createHmac("sha256", input.secret)
    .update(input.canonicalPayload, "utf8").digest();
  const presented = Buffer.from(input.signature, "base64url");
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

function parseKeys(raw: string | undefined): ReadonlyMap<string, WebhookSigningKey> {
  const keys = new Map<string, WebhookSigningKey>();
  if (!raw?.trim()) return keys;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new WebhookSigningError();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new WebhookSigningError();
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > 32) throw new WebhookSigningError();

  for (const [secretRef, value] of entries) {
    if (!SECRET_REF.test(secretRef) || !value || typeof value !== "object" || Array.isArray(value)) {
      throw new WebhookSigningError();
    }
    const { keyId, secret } = value as { keyId?: unknown; secret?: unknown };
    if (typeof keyId !== "string" || !KEY_ID.test(keyId) || typeof secret !== "string") {
      throw new WebhookSigningError();
    }
    const material = Buffer.from(secret, "base64url");
    if (material.length < MIN_SECRET_BYTES) throw new WebhookSigningError();
    keys.set(secretRef, Object.freeze({ keyId, secret: material }));
  }
  return keys;
}
