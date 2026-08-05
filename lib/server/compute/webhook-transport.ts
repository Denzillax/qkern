import type { WebhookTransportPort } from "@/lib/server/compute/webhooks";

const ACKNOWLEDGEMENT_HEADER = "x-qkern-delivery-id";
const MAX_ACKNOWLEDGEMENT_LENGTH = 128;

export type FetchWebhookTransportOptions = {
  fetchFn?: typeof fetch;
  /** Erlaubt `http://` gegen localhost. Nur für lokale Empfänger in Tests. */
  allowInsecureLoopback?: boolean;
};

/**
 * HTTPS-Transport für Webhook-Zustellungen.
 *
 * **Der Antwortkörper wird nie gelesen.** Er kommt von einem fremden Empfänger,
 * kann beliebig groß sein und trüge nichts bei: Die Bestätigung steht im Header
 * `x-qkern-delivery-id`, den der Empfänger aus der Anfrage zurückspiegelt. Ein
 * Empfänger, der die falsche Zustellung bestätigt oder gar nicht bestätigt, gilt
 * als Fehlschlag — sonst würde eine Zustellung als erfolgreich abgehakt, weil
 * irgendein Proxy mit 200 geantwortet hat.
 *
 * Weiterleitungen sind ausgeschlossen. Eine Umleitung würde die signierte
 * Nachricht an ein Ziel tragen, das der Betreiber nie eingetragen hat.
 */
export class FetchWebhookTransport implements WebhookTransportPort {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: FetchWebhookTransportOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async send(request: Readonly<{
    url: string;
    method: "POST";
    headers: Readonly<Record<string, string>>;
    body: string;
    redirect: "error";
  }>, options: { signal: AbortSignal }): Promise<{ status: number; acknowledgementId: string | null }> {
    this.assertAllowed(request.url);
    const response = await this.fetchFn(request.url, {
      method: request.method,
      headers: { ...request.headers },
      body: request.body,
      redirect: "error",
      cache: "no-store",
      signal: options.signal,
    });
    await response.body?.cancel().catch(() => undefined);
    return {
      status: response.status,
      acknowledgementId: acknowledgement(response.headers.get(ACKNOWLEDGEMENT_HEADER)),
    };
  }

  private assertAllowed(url: string): void {
    // Der Zusteller prueft die URL bereits. Diese Pruefung steht hier trotzdem:
    // Der Transport ist eine eigene Grenze und darf sich nicht darauf verlassen,
    // dass ein Aufrufer sie schon eingehalten hat.
    const target = new URL(url);
    const loopback = this.options.allowInsecureLoopback === true &&
      target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.host.split(":")[0]);
    if (target.protocol !== "https:" && !loopback) {
      throw new Error("Webhook delivery requires HTTPS.");
    }
    if (target.username || target.password) throw new Error("Webhook delivery requires HTTPS.");
  }
}

function acknowledgement(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_ACKNOWLEDGEMENT_LENGTH) return null;
  return trimmed;
}
