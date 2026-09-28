import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { createConsoleSettingsHandlers } from "@/app/api/v1/auth/console-settings/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { InMemorySessionRepository, InMemoryUserRepository } from "@/lib/server/auth/memory-repositories";
import { InMemoryConsoleDisplaySettingsRepository } from "@/lib/server/auth/console-settings";
import type { PasswordHasher } from "@/lib/server/auth/password";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import { AuthService } from "@/lib/server/auth/service";
import { CONSOLE_DISPLAY_DEFAULTS } from "@/lib/console/display-settings";

/**
 * Die Route der eigenen Darstellung (2.55). Sie geht durch dieselbe Tuer wie
 * die Nachbarrouten des Kontos: Session-Cookie, `AuthService`, kein
 * Organisationsbezug. Geprueft wird genau das -- wer ohne Sitzung kommt,
 * bekommt 401 und keine Vorgaben; wer einen Koerper schickt, aus dem sich
 * keine Darstellung bauen laesst, bekommt 400 mit dem Grund; und jede Antwort
 * traegt `private, no-store`, weil sie zu einer Person gehoert.
 */
class FastHasher implements PasswordHasher {
  readonly dummyHash = "test-hash:dummy";
  async hash(password: string) { return `test-hash:${createHash("sha256").update(password).digest("hex")}`; }
  async verify(password: string, hash: string) { return hash === await this.hash(password); }
}

async function fixture() {
  const auth = new AuthService({
    users: new InMemoryUserRepository(),
    sessions: new InMemorySessionRepository(),
    passwords: new FastHasher(),
    rateLimiter: new InMemoryRateLimiter(),
    token: (() => { let n = 0; return () => `console-settings-token-${++n}`; })(),
    id: (() => { let n = 0; return () => String(++n); })(),
  });
  const first = await auth.register({ email: "owner@qkern.ch", password: "correct horse battery staple", rateLimitKey: "console-settings-test" });
  const second = await auth.register({ email: "other@qkern.ch", password: "correct horse battery staple", rateLimitKey: "console-settings-test" });
  const repository = new InMemoryConsoleDisplaySettingsRepository();
  return { handlers: createConsoleSettingsHandlers(auth, repository), first, second, repository };
}

function request(method: "GET" | "PUT", options: { token?: string; body?: unknown; origin?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.origin !== null) headers.origin = options.origin ?? "https://qkern.test";
  if (options.token) headers.cookie = `${SESSION_COOKIE_NAME}=${options.token}`;
  return new NextRequest("https://qkern.test/api/v1/auth/console-settings", {
    method,
    headers,
    body: method === "PUT" ? JSON.stringify(options.body ?? {}) : undefined,
  });
}

const CHOSEN = {
  language: "fr", formatLocale: "fr-CH", timeZone: "Asia/Singapore",
  startView: "logs", theme: "dark",
} as const;

describe("console display settings route", () => {
  it("refuses to say anything without a session", async () => {
    const { handlers } = await fixture();
    for (const response of [await handlers.GET(request("GET")), await handlers.PUT(request("PUT", { body: CHOSEN }))]) {
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ error: "Authentication required" });
    }
    const stale = await handlers.GET(request("GET", { token: "not-a-session" }));
    expect(stale.status).toBe(401);
  });

  it("answers with the defaults for somebody who never chose anything", async () => {
    const { handlers, first } = await fixture();
    const response = await handlers.GET(request("GET", { token: first.token }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ data: CONSOLE_DISPLAY_DEFAULTS });
  });

  it("stores a choice and gives it back on the next read", async () => {
    const { handlers, first } = await fixture();
    const written = await handlers.PUT(request("PUT", { token: first.token, body: CHOSEN }));
    expect(written.status).toBe(200);
    expect(written.headers.get("cache-control")).toBe("private, no-store");
    expect(await written.json()).toEqual({ data: CHOSEN });
    expect(await (await handlers.GET(request("GET", { token: first.token }))).json())
      .toEqual({ data: CHOSEN });
  });

  it("fills a partial body from the defaults", async () => {
    const { handlers, first } = await fixture();
    const response = await handlers.PUT(request("PUT", { token: first.token, body: { timeZone: "UTC" } }));
    expect(await response.json()).toEqual({ data: { ...CONSOLE_DISPLAY_DEFAULTS, timeZone: "UTC" } });
  });

  it("answers 400 with the reason for a body it cannot display", async () => {
    const { handlers, first } = await fixture();
    for (const [body, reason] of [
      [{ language: "es" }, "Diese Sprache gibt es in der Console nicht."],
      [{ formatLocale: "de-AT" }, "Dieses Zahlen- und Datumsformat steht nicht zur Auswahl."],
      [{ timeZone: "Mars/Olympus" }, "Diese Zeitzone kennt die Laufzeit nicht."],
      // Ein Platzhalter, der noch einer ist: "set-compute" stand hier bis 2.88
      // und ist seitdem eine echte Seite.
      [{ startView: "storage-vectors" }, "Diese Startseite gibt es nicht oder sie ist noch nicht verbunden."],
      [{ theme: "sepia" }, "Dieses Aussehen gibt es nicht."],
      ["kein Objekt", "Aus dieser Eingabe lässt sich keine Darstellung bauen."],
    ] as const) {
      const response = await handlers.PUT(request("PUT", { token: first.token, body }));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ error: reason });
    }
    // Und nichts davon hat etwas gespeichert.
    expect(await (await handlers.GET(request("GET", { token: first.token }))).json())
      .toEqual({ data: CONSOLE_DISPLAY_DEFAULTS });
  });

  it("rejects a mutation without a trusted origin before it looks at the session", async () => {
    const { handlers, first } = await fixture();
    for (const origin of [null, "https://evil.test"]) {
      const response = await handlers.PUT(request("PUT", { token: first.token, body: CHOSEN, origin }));
      expect(response.status).toBe(403);
    }
  });

  it("keeps the display of one person out of the display of another", async () => {
    const { handlers, first, second } = await fixture();
    await handlers.PUT(request("PUT", { token: first.token, body: CHOSEN }));
    expect(await (await handlers.GET(request("GET", { token: second.token }))).json())
      .toEqual({ data: CONSOLE_DISPLAY_DEFAULTS });
  });
});
